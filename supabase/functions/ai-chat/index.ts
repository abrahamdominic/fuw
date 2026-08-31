// FUW E-Library — AI Assistant endpoint (RAG).
// POST { message, conversationId?, materialId?, filters? { department, level, courseCode } }
// Requires an authenticated student/admin JWT. Secrets stay server-side.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { aiConfig, chatComplete, embedTexts, corsFor, json, ChatMessage } from '../_shared/ai.ts';

const MAX_MESSAGE_LENGTH = 2000;
const HOURLY_MESSAGE_LIMIT = 40;

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

  const cfg = aiConfig();
  if (!cfg.configured) {
    return json({ error: 'AI_NOT_CONFIGURED', message: 'The AI assistant is not configured yet. Please contact the library administrator.' }, 503, req);
  }

  try {
    // ---- Rate limiting (per user, per hour) ----
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: myConversations } = await serviceClient
      .from('ai_conversations')
      .select('id')
      .eq('user_id', user.id);
    let usedThisHour = 0;
    const convoIds = (myConversations ?? []).map((c: { id: string }) => c.id);
    if (convoIds.length) {
      const { count } = await serviceClient
        .from('ai_messages')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'user')
        .gte('created_at', hourAgo)
        .in('conversation_id', convoIds);
      usedThisHour = count ?? 0;
    }
    if (usedThisHour >= HOURLY_MESSAGE_LIMIT) {
      return json({ error: 'RATE_LIMITED', message: 'You have reached your hourly AI limit. Please try again later.' }, 429, req);
    }

    // ---- Conversation resolution ----
    let conversationId: string | null = body.conversationId ? String(body.conversationId) : null;
    let materialId: string | null = body.materialId ? String(body.materialId) : null;

    if (conversationId) {
      const { data: convo } = await serviceClient
        .from('ai_conversations')
        .select('id, material_id, title')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!convo) {
        conversationId = null;
      } else {
        materialId = materialId ?? convo.material_id;
      }
    }

    // ---- Retrieval (embed query -> similarity search) ----
    const [queryEmbedding] = await embedTexts(cfg, [message]);
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
      'PRIORITY: base answers on the retrieved e-library excerpts below when they are relevant.',
      'Cite them like: "According to <material title>, page N ...".',
      'If the retrieved materials do not contain the answer, say so explicitly, then optionally add clearly-labelled general knowledge.',
      'Never invent content that is not in the sources while claiming it comes from a source document.',
      'Use markdown formatting. Keep answers concise but complete.'
    ].join('\n');

    const messagesForModel: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (contextBlock) {
      messagesForModel.push({
        role: 'system',
        content: `Retrieved e-library excerpts:\n\n${contextBlock}`
      });
    } else if (!matched.length && !contextBlock) {
      messagesForModel.push({
        role: 'system',
        content:
          'No relevant e-library excerpts were found for this question. Tell the student you could not find this topic in the library materials yet, answer briefly with general knowledge clearly labelled as such, and suggest uploading related materials.'
      });
    }

    // Recent history for context (last 10 messages).
    if (conversationId) {
      const { data: history } = await serviceClient
        .from('ai_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(10);
      for (const m of (history ?? []).reverse()) {
        messagesForModel.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content.slice(0, 1500) });
      }
    }
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
