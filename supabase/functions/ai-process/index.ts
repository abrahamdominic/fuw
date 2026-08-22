// FUW E-Library — AI document processing (RAG indexing).
// POST { materialId }
// Admin-only. Downloads the stored file, extracts text, chunks it, generates
// embeddings and stores them in material_chunks. Job status is tracked in
// ai_processing_jobs: pending -> processing -> ready | failed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { aiConfig, embedTexts, chunkText, corsHeaders, json } from '../_shared/ai.ts';

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  // Verify the caller is an authenticated admin.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Authentication required' }, 401);
  const { data: profile } = await userClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'super_admin'].includes(profile.role) || !profile.is_active) {
    return json({ error: 'Administrator access required' }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const materialId = String(body.materialId ?? '');
  if (!materialId) return json({ error: 'materialId is required.' }, 400);

  const cfg = aiConfig();
  if (!cfg.configured) {
    return json({ error: 'AI_NOT_CONFIGURED', message: 'Set AI_API_KEY as a function secret to enable processing.' }, 503);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: material, error: matErr } = await serviceClient
      .from('materials')
      .select('*')
      .eq('id', materialId)
      .maybeSingle();
    if (matErr || !material) return json({ error: 'Material not found' }, 404);

    // Only approved materials are indexed for the AI.
    if (material.status !== 'approved') {
      return json({ error: 'Only approved materials can be processed for AI.' }, 409);
    }

    await serviceClient.from('ai_processing_jobs').upsert(
      {
        material_id: material.id,
        status: 'processing',
        attempts: 1,
        error: null
      },
      { onConflict: 'material_id' }
    );

    // ---- Fetch file bytes ----
    let bytes: Uint8Array;
    if ((material.file_url ?? '').includes('/storage/v1/object/')) {
      const res = await fetch(material.file_url);
      if (!res.ok) throw new Error(`DOWNLOAD_FAILED:${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      return await failJob(serviceClient, materialId, 'UNSUPPORTED_SOURCE: no storage-backed file for this material');
    }
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      return await failJob(serviceClient, materialId, `Document exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB AI processing limit`);
    }

    // ---- Extract text per format ----
    const name = (material.file_name || '').toLowerCase();
    let text = '';
    try {
      if (name.endsWith('.pdf')) {
        const { extractText, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
        const pdf = await getDocumentProxy(bytes);
        const { text: extracted } = await extractText(pdf, { mergePages: false });
        // extracted is string[] per page — keep page boundaries.
        const pages = Array.isArray(extracted) ? extracted : [String(extracted)];
        text = pages.map((p, i) => `[[page ${i + 1}]] ${p}`).join('\n\n');
      } else if (name.endsWith('.txt')) {
        text = new TextDecoder().decode(bytes);
      } else if (name.endsWith('.docx')) {
        const mammoth = await import('https://esm.sh/mammoth@1.8.0?deps=node:buffer@node-version');
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const result = await (mammoth as any).extractRawText({ arrayBuffer });
        text = result.value ?? '';
      } else {
        return await failJob(
          serviceClient,
          materialId,
          'Unsupported file type for AI processing. Supported: PDF, TXT, DOCX.'
        );
      }
    } catch (extractErr) {
      return await failJob(serviceClient, materialId, `TEXT_EXTRACTION_FAILED:${String(extractErr).slice(0, 300)}`);
    }

    if (!text.trim()) {
      return await failJob(serviceClient, materialId, 'No readable text found in this document (it may be a scanned image).');
    }

    // ---- Chunk + embed ----
    const chunks = chunkText(text);
    if (!chunks.length) {
      return await failJob(serviceClient, materialId, 'Document produced no usable text chunks.');
    }
    const embeddings = await embedTexts(cfg, chunks);

    // Replace any previous embeddings for this material.
    await serviceClient.from('material_chunks').delete().eq('material_id', material.id);

    const rows = chunks.map((content, i) => ({
      material_id: material.id,
      chunk_index: i,
      content,
      page_number: parsePageMarker(content),
      course_code: material.course_code ?? null,
      metadata: {
        faculty: material.faculty,
        department: material.department,
        level: material.level,
        semester: material.semester
      },
      embedding: embeddings[i]
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error: insertErr } = await serviceClient.from('material_chunks').insert(batch);
      if (insertErr) throw new Error(`CHUNK_INSERT_FAILED:${insertErr.message}`);
    }

    const { error: readyErr } = await serviceClient.from('ai_processing_jobs').upsert(
      {
        material_id: material.id,
        status: 'ready',
        chunks_created: chunks.length,
        error: null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'material_id' }
    );
    if (readyErr) throw new Error(readyErr.message);

    return json({ status: 'ready', chunks: chunks.length });
  } catch (err) {
    console.error('ai-process error:', err);
    try {
      await failJob(serviceClient, materialId, String(err?.message ?? err).slice(0, 400));
    } catch {
      /* ignore */
    }
    return json({ error: 'PROCESSING_FAILED', message: 'AI processing failed. See the job details in the admin dashboard.' }, 502);
  }
});

async function failJob(client: any, materialId: string, message: string): Promise<Response> {
  await client.from('ai_processing_jobs').upsert(
    {
      material_id: materialId,
      status: 'failed',
      error: message.slice(0, 400),
      updated_at: new Date().toISOString()
    },
    { onConflict: 'material_id' }
  );
  return json({ status: 'failed', error: message }, 200);
}

function parsePageMarker(content: string): number | null {
  const m = content.match(/\[\[page (\d+)\]\]/);
  return m ? Number(m[1]) : null;
}
