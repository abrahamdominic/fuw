// FUW E-Library — AI semantic search endpoint.
// POST { query, filters? { department, level, courseCode }, limit? }
// Embeds the natural-language query and returns the most relevant approved
// materials using pgvector similarity over material_chunks.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { aiConfig, embedTexts, corsHeaders, json } from '../_shared/ai.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  // Authenticated users only (students + admins).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Authentication required' }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const query = String(body.query ?? '').trim();
  if (!query) return json({ error: 'A search query is required.' }, 400);
  if (query.length > 500) return json({ error: 'Search queries are limited to 500 characters.' }, 413);

  const cfg = aiConfig();
  if (!cfg.configured) {
    return json({ error: 'AI_NOT_CONFIGURED', message: 'AI search is not configured yet.' }, 503);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const [embedding] = await embedTexts(cfg, [query]);
    const filters = body.filters ?? {};
    const limit = Math.min(Number(body.limit) || 8, 20);

    const { data: chunks, error } = await serviceClient.rpc('match_material_chunks', {
      query_embedding: embedding,
      match_count: limit * 3,
      p_material_id: null,
      p_department: filters.department || null,
      p_level: filters.level || null,
      p_course_code: filters.courseCode || null
    });
    if (error) throw new Error(`SEARCH_FAILED:${error.message}`);

    type Chunk = { id: string; material_id: string; content: string; page_number: number | null; similarity: number };
    const matched = (chunks ?? []) as Chunk[];

    // Aggregate best chunks per material.
    const bestPerMaterial = new Map<string, { similarity: number; snippet: string; page: number | null }>();
    for (const c of matched) {
      const existing = bestPerMaterial.get(c.material_id);
      if (!existing || c.similarity > existing.similarity) {
        bestPerMaterial.set(c.material_id, {
          similarity: c.similarity,
          snippet: c.content.slice(0, 220),
          page: c.page_number
        });
      }
    }

    const ids = [...bestPerMaterial.keys()].slice(0, limit);
    if (!ids.length) return json({ results: [] });

    const { data: materials, error: matErr } = await serviceClient
      .from('materials')
      .select(
        'id, title, description, faculty, department, level, course_code, course_title, semester, material_type, file_url, file_name, file_size, downloads, views, status, created_at'
      )
      .in('id', ids)
      .eq('status', 'approved');
    if (matErr) throw new Error(`MATERIALS_FAILED:${matErr.message}`);

    const results = (materials ?? [])
      .map((m: any) => ({
        ...m,
        relevance: Number((bestPerMaterial.get(m.id)?.similarity ?? 0).toFixed(4)),
        matchedSnippet: bestPerMaterial.get(m.id)?.snippet ?? '',
        matchedPage: bestPerMaterial.get(m.id)?.page ?? null
      }))
      .sort((a: any, b: any) => b.relevance - a.relevance);

    return json({ results });
  } catch (err) {
    const raw = String(err?.message ?? err);
    if (raw.startsWith('AI_NOT_CONFIGURED')) return json({ error: 'AI_NOT_CONFIGURED' }, 503);
    console.error('ai-search error:', raw);
    return json({ error: 'AI_SEARCH_FAILED', message: 'AI search is temporarily unavailable.' }, 502);
  }
});
