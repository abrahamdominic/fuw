// FUW E-Library — AI Assistant endpoint (RAG).
// POST { message, conversationId?, materialId?, clearScope?, mode?, filters? { department, level, courseCode } }
// Requires an authenticated student/admin JWT. Secrets stay server-side.
//
// Correctness rules enforced here:
//   * The exact question the student asked is what gets answered — never a
//     keyword-matched reinterpretation.
//   * Follow-up questions ("who discovered it?") carry the recent conversation
//     context into retrieval so they resolve against the current topic.
//   * Topic/scope switches work: a conversation can be re-scoped to another
//     material or cleared back to the whole library.
//   * If the answer is not in the sources, the assistant says so instead of
//     inventing content.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { aiConfig, chatComplete, embedTexts, corsFor, json, ChatMessage } from '../_shared/ai.ts';

const MAX_MESSAGE_LENGTH = 2000;

const MODE_HINTS: Record<string, string> = {
  explainer:
    'The student chose the EXPLAINER mode — break concepts down simply, use analogies, and check understanding.',
  exam:
    'The student chose EXAM PREP mode — focus on likely examinable points, definitions, formulas, and practice questions.',
  summary:
    'The student chose SUMMARY mode — produce concise, structured summaries with clear headings.',
  quiz:
    'The student chose QUIZ mode — generate questions with answers and mark them clearly as practice questions.'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500, req);

  // RLS-scoped client for user-identity checks; service client for writes the
  // user cannot perform directly (assistant messages, conversations bookkeeping).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Authentication required' }, 401, req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  const message = String(body.message ?? '').trim();
  if (!message) return json({ error: 'A question is required.' }, 400, req);
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` }, 413, req);
  }

  const { data: assistantEnabled, error: assistantFeatureError } = await userClient.rpc('premium_feature_enabled', {
    p_feature_key: 'ai_assistant'
  });
  if (assistantFeatureError) {
    console.error('ai-chat feature check failed:', assistantFeatureError.message);
    return json({ error: 'FEATURE_CHECK_FAILED', message: 'AI availability could not be verified.' }, 503, req);
  }
  if (assistantEnabled !== true) {
    return json({ error: 'FEATURE_DISABLED', message: 'The AI Assistant is currently disabled.' }, 403, req);
  }

  const mode =
    typeof body.mode === 'string' && MODE_HINTS[body.mode] ? body.mode : null;
  const premiumFeaturesByMode: Record<string, string[]> = {
    explainer: ['ai_explanations'],
    exam: ['advanced_exam_preparation', 'advanced_question_analysis'],
    quiz: ['advanced_exam_preparation']
  };
  if (mode && premiumFeaturesByMode[mode]) {
    for (const featureKey of premiumFeaturesByMode[mode]) {
      const { data: modeAllowed, error: modeFeatureError } = await userClient.rpc('has_premium_feature', {
        p_feature_key: featureKey
      });
      if (modeFeatureError) {
        console.error('ai-chat mode authorization failed:', modeFeatureError.message);
        return json({ error: 'FEATURE_CHECK_FAILED', message: 'Premium access could not be verified.' }, 503, req);
      }
      if (modeAllowed !== true) {
        return json({ error: 'PREMIUM_FEATURE_REQUIRED', message: 'This AI study mode requires an active Premium entitlement.' }, 403, req);
      }
    }
  }

  const cfg = aiConfig();
  if (!cfg.configured) {
    return json({ error: 'AI_NOT_CONFIGURED', message: 'The AI assistant is not configured yet. Please contact the library administrator.' }, 503, req);
  }

  const { data: usage, error: usageError } = await userClient.rpc('consume_ai_message');
  if (usageError) {
    console.error('ai-chat rate limit check failed:', usageError.message);
    return json({ error: 'RATE_LIMIT_CHECK_FAILED', message: 'AI usage could not be verified.' }, 503, req);
  }
  if (usage?.allowed !== true) {
    if (usage?.reason === 'feature_disabled') {
      return json({ error: 'FEATURE_DISABLED', message: 'The AI Assistant is currently disabled.' }, 403, req);
    }
    return json({ error: 'RATE_LIMITED', message: 'You have reached your hourly AI limit. Please try again later.' }, 429, req);
  }

  try {
    // ---- Conversation resolution ----
    let conversationId: string | null = body.conversationId ? String(body.conversationId) : null;
    const hasExplicitMaterial = body.materialId !== undefined && body.materialId !== null && body.materialId !== '';
    const explicitMaterialId = hasExplicitMaterial ? String(body.materialId) : null;
    const clearScope = body.clearScope === true;
    let materialId: string | null = explicitMaterialId;
    let existingScopeMaterialId: string | null | undefined;

    if (conversationId) {
      const { data: convo } = await serviceClient
        .from('ai_conversations')
        .select('id, material_id, title')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!convo) {
        // Stale/foreign conversation id — start fresh.
        conversationId = null;
        materialId = explicitMaterialId;
      } else {
        existingScopeMaterialId = convo.material_id;
        if (clearScope) materialId = null;
        else if (!hasExplicitMaterial) materialId = convo.material_id;
      }
    }

    // ---- Recent history (used for both the LLM context and, for short
    //      follow-ups, to anchor retrieval to the current topic) ----
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (conversationId) {
      const { data: rows } = await serviceClient
        .from('ai_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(10);
      history = (rows ?? []).reverse().map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: String(m.content ?? '').slice(0, 1500)
      }));
    }

    // ---- Retrieval keeps the CONVERSATION TOPIC, not just the current turn.
    //      A short follow-up ("Who discovered it?") is anchored to the previous
    //      user question so the query still describes the topic. ----
    const priorUserQuestions = history
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .slice(-2)
      .join(' ');
    const isLikelyFollowUp = conversationId !== null && message.length < 80;
    const retrievalQuery =
      isLikelyFollowUp && priorUserQuestions
        ? `${priorUserQuestions.slice(0, 400)}\n${message}`
        : message;

    const [queryEmbedding] = await embedTexts(cfg, [retrievalQuery]);
    const filters = body.filters ?? {};
    const { data: chunks, error: matchError } = await serviceClient.rpc('match_material_chunks', {
      query_embedding: queryEmbedding,
      match_count: materialId ? 8 : 6,
      p_material_id: materialId,
      p_department: filters.department || null,
      p_level: filters.level || null,
      p_course_code: filters.courseCode || null
    });
    if (matchError) throw new Error(`RETRIEVAL_FAILED:${matchError.message}`);

    type Chunk = { id: string; material_id: string; content: string; page_number: number | null; similarity: number };
    const matched = (chunks ?? []) as Chunk[];

    // Resolve titles for citations.
    const matIds = [...new Set(matched.map((c) => c.material_id))];
    const titleMap = new Map<string, string>();
    if (matIds.length) {
      const { data: mats } = await serviceClient
        .from('materials')
        .select('id, title, course_code')
        .in('id', matIds);
      for (const m of mats ?? []) titleMap.set(m.id, `${m.title}${m.course_code ? ` (${m.course_code})` : ''}`);
    }

    const contextBlock = matched.length
      ? matched
          .map(
            (c, i) =>
              `[${i + 1}] Source: ${titleMap.get(c.material_id) ?? 'Library material'}${
                c.page_number ? `, page ${c.page_number}` : ''
              }\n${c.content}`
          )
          .join('\n\n---\n\n')
      : '';

    const systemPrompt: string = [
      'You are the FUW E-Library Study Assistant for Federal University Wukari students.',
      'Answer clearly and educationally, like a patient university tutor.',
      'Answer the EXACT question the student asked. Do not substitute a different topic or question even if a keyword overlaps.',
      'If asked about something you cannot determine, say plainly that you do not know rather than guessing.',
      'PRIORITY: base answers on the retrieved e-library excerpts below when they are relevant.',
      'Cite them like: "According to <material title>, page N ...".',
      'If the retrieved materials do not contain the answer, say so explicitly, then optionally add clearly-labelled general knowledge.',
      'Never invent content that is not in the sources while claiming it comes from a source document.',
      'Use the conversation history to answer follow-up questions about the same topic, and switch topics cleanly when the student clearly asks about something new.',
      'Use markdown formatting. Keep answers concise but complete.'
    ].join('\n');

    const messagesForModel: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (mode) messagesForModel.push({ role: 'system', content: MODE_HINTS[mode] });

    if (contextBlock) {
      messagesForModel.push({
        role: 'system',
        content: `Retrieved e-library excerpts:\n\n${contextBlock}`
      });
    } else if (history.length > 0) {
      // A follow-up with no fresh matches: rely on the conversation already in
      // context, but stay honest about what the library covers.
      messagesForModel.push({
        role: 'system',
        content:
          'No new e-library excerpts matched this follow-up. Answer using the conversation history above; label general knowledge clearly as such. If neither the conversation nor the library clearly covers the question, say you could not find it in the library materials yet.'
      });
    } else {
      messagesForModel.push({
        role: 'system',
        content:
          'No relevant e-library excerpts were found for this question. Tell the student you could not find this topic in the library materials yet, answer briefly with general knowledge clearly labelled as such, and suggest uploading related materials.'
      });
    }

    // Conversation history for the model (already sliced/truncated above).
    for (const m of history) messagesForModel.push(m);
    messagesForModel.push({ role: 'user', content: message });

    // ---- Generate answer ----
    const answer = await chatComplete(cfg, messagesForModel);

    // ---- Persist conversation + both messages ----
    if (!conversationId) {
      const { data: created, error: createErr } = await serviceClient
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          material_id: materialId,
          title: message.slice(0, 60)
        })
        .select('id')
        .single();
      if (createErr) throw new Error(`CONVERSATION_FAILED:${createErr.message}`);
      conversationId = created.id;
    } else if (
      (clearScope || hasExplicitMaterial) &&
      existingScopeMaterialId !== (materialId ?? null)
    ) {
      // The student re-scoped (or unscoped) this conversation — persist it so
      // it survives refreshes and future turns use the new scope.
      await serviceClient
        .from('ai_conversations')
        .update({ material_id: materialId })
        .eq('id', conversationId);
    }

    const citations = matched.slice(0, 5).map((c) => ({
      material_id: c.material_id,
      title: titleMap.get(c.material_id) ?? '',
      page: c.page_number,
      similarity: Number(c.similarity?.toFixed?.(3) ?? 0)
    }));

    await serviceClient.from('ai_messages').insert([
      { conversation_id: conversationId, role: 'user', content: message },
      { conversation_id: conversationId, role: 'assistant', content: answer, citations }
    ]);
    await serviceClient
      .from('ai_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return json({
      conversationId,
      answer,
      citations,
      usedContext: matched.length > 0
    }, 200, req);
  } catch (err) {
    const raw = String(err?.message ?? err);
    if (raw.startsWith('AI_NOT_CONFIGURED')) {
      return json({ error: 'AI_NOT_CONFIGURED', message: 'The AI assistant is not configured yet.' }, 503, req);
    }
    console.error('ai-chat error:', raw);
    return json({ error: 'AI_REQUEST_FAILED', message: 'The AI service is temporarily unavailable. Please try again shortly.' }, 502, req);
  }
});