// Shared AI provider abstraction + helpers for FUW E-Library edge functions.
// Provider is OpenAI-compatible and configurable via environment variables:
//   AI_API_KEY      (required for AI features — server-side only, never in frontend)
//   AI_BASE_URL     (optional, default https://api.openai.com/v1)
//   AI_MODEL        (optional, default gpt-4o-mini)
//   EMBEDDING_MODEL (optional, default text-embedding-3-small)

// CORS: respond only to a request whose Origin is allow-listed. These edge
// functions authenticate via the Authorization header (never cookies), so the
// practical risk of `*` was low, but echoing a vetted origin is stricter (F6).
// Allowed origins come from the APP_ORIGIN env (comma-separated); a permissive
// default is NOT supplied — an Origin with no explicit match gets no CORS
// headers, so cross-origin callers fail at the browser.
const allowedOrigins = (): string[] =>
  (Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function corsFor(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') ?? '').toLowerCase();
  const allowed = allowedOrigins();
  if (origin && allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers':
        'authorization, apikey, x-client-info, content-type, prefer',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400'
    };
  }
  // No matching origin -> omit CORS headers entirely (non-CORS same-origin
  // requests still work; browser cross-origin requests are blocked).
  return {
    'Access-Control-Allow-Headers':
      'authorization, apikey, x-client-info, content-type, prefer',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(req ? corsFor(req) : corsHeaders),
      'Content-Type': 'application/json'
    }
  });
}

export function aiConfig() {
  const apiKey = Deno.env.get('AI_API_KEY') ?? '';
  return {
    apiKey,
    baseUrl: (Deno.env.get('AI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, ''),
    chatModel: Deno.env.get('AI_MODEL') || 'gpt-4o-mini',
    embeddingModel: Deno.env.get('EMBEDDING_MODEL') || 'text-embedding-3-small',
    configured: Boolean(apiKey)
  };
}

export async function embedTexts(
  cfg: ReturnType<typeof aiConfig>,
  texts: string[]
): Promise<number[][]> {
  if (!cfg.configured) throw new Error('AI_NOT_CONFIGURED');
  // Batch to keep requests within provider limits.
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.embeddingModel, input: batch })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`EMBEDDING_FAILED:${res.status}:${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    for (const item of data.data) out.push(item.embedding);
  }
  return out;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatComplete(
  cfg: ReturnType<typeof aiConfig>,
  messages: ChatMessage[],
  maxTokens = 1200
): Promise<string> {
  if (!cfg.configured) throw new Error('AI_NOT_CONFIGURED');
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.chatModel,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`CHAT_FAILED:${res.status}:${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** Split raw text into overlapping chunks suitable for retrieval. */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < 400) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf('.', end);
      if (breakAt > start + size * 0.5) end = breakAt + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (end >= clean.length) break;
  }
  return chunks.filter((c) => c.length > 40);
}
