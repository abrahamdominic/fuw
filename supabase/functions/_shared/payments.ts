// Shared plumbing for the FUW Marketplace payment edge functions.
//
// The split of responsibility is deliberate and is the whole point of the
// payment design: the browser may start a payment, but only the functions in
// this folder know the provider secret. Every state change to a payment comes
// from one of:
//
//   marketplace-paystack-webhook   — the provider's signed event
//   marketplace-paystack-verify    — a server-side lookup of a reference
//   marketplace-paystack-initialize — only ever *starts* a charge
//
// Nothing here accepts a status, an amount, a reference or a "paid" flag from
// the client and writes it to the database.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_API = 'https://api.paystack.co';

const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

export function allowedOrigins(): string[] {
  const envOrigins = (Deno.env.get('MARKETPLACE_ORIGINS') ?? Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...envOrigins, ...LOCAL_DEV_ORIGINS]));
}

export function corsFor(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') ?? '').toLowerCase();
  const base = {
    'Access-Control-Allow-Headers':
      'authorization, apikey, x-client-info, content-type, prefer',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Cache': '0'
  };
  // No allow-listed origin -> no CORS headers at all, so the browser blocks it.
  if (origin && allowedOrigins().includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin, 'Access-Control-Max-Age': '86400' };
  }
  return base;
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(req ? corsFor(req) : { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export type PaymentConfig =
  | { ok: true; supabaseUrl: string; anonKey: string; serviceKey: string; secretKey: string }
  | { ok: false; status: number; error: string };

export function config(): PaymentConfig {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, status: 500, error: 'Server misconfigured.' };
  }
  if (!anonKey) {
    // Without the anon key the caller's own token cannot be resolved to a user,
    // so every request would fail as if it were unauthenticated.
    return { ok: false, status: 500, error: 'Server misconfigured.' };
  }
  if (!secretKey) {
    // Deliberately a 503 rather than a silent no-op. If the secret is missing
    // the honest answer is "payments are unavailable", never "paid".
    return { ok: false, status: 503, error: 'Card payments are not configured yet.' };
  }
  return { ok: true, supabaseUrl, anonKey, serviceKey, secretKey };
}

export function serviceClient(supabaseUrl: string, serviceKey: string) {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export function userClient(supabaseUrl: string, anonKey: string, authorization: string) {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
}

/** Paystack signs the raw request body with HMAC-SHA512 keyed by the secret. */
export async function verifyPaystackSignature(
  secretKey: string,
  rawBody: Uint8Array,
  signature: string | null
): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['verify']
  );
  const signatureBytes = Uint8Array.from(
    signature.match(/.{2}/g) ?? [],
    (hex) => Number.parseInt(hex, 16)
  );
  return crypto.subtle.verify('HMAC', key, signatureBytes, rawBody);
}

/** Read the body with a hard size cap so a webhook cannot exhaust memory. */
export async function readCappedBody(req: Request, limit = 1024 * 1024): Promise<Uint8Array | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export type PaystackTransaction = {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  channel?: string | null;
  paid_at?: string | null;
  gateway_response?: { message?: string } | null;
};

/**
 * Paystack names its channels differently from the marketplace enum. Anything we
 * do not recognise becomes `none` rather than a guess: this value is for
 * reporting only and is never used to decide whether money moved.
 */
export function mapPaystackChannel(channel: string | null | undefined): string {
  switch ((channel ?? '').trim().toLowerCase()) {
    case 'card':
      return 'card';
    case 'bank':
    case 'transfer':
    case 'bank_transfer':
    case 'account':
      return 'bank_transfer';
    case 'ussd':
      return 'ussd';
    case 'mobile_money':
      return 'mobile_money';
    default:
      return 'none';
  }
}

/**
 * Ask Paystack what actually happened to a reference. The provider's answer —
 * not the request that started the payment, and not anything the browser says —
 * is the only thing that decides whether money moved.
 */
export async function fetchPaystackTransaction(
  secretKey: string,
  reference: string
): Promise<{ ok: true; transaction: PaystackTransaction } | { ok: false; error: string }> {
  const response = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  const payload = await response.json().catch(() => null);
  const data = payload?.data;
  if (!response.ok || payload?.status !== true || !data || typeof data !== 'object') {
    return { ok: false, error: 'The payment provider could not confirm this reference.' };
  }
  if (
    data.reference !== reference ||
    !Number.isSafeInteger(data.amount) ||
    typeof data.currency !== 'string' ||
    typeof data.status !== 'string'
  ) {
    return { ok: false, error: 'The payment provider returned an unusable verification payload.' };
  }
  return { ok: true, transaction: data as PaystackTransaction };
}

/**
 * Where the student lands after paying or abandoning the provider's page.
 *
 * `MARKETPLACE_RETURN_URL` / `APP_ORIGIN` are treated as the app's *base* URL,
 * not as a fixed destination: the per-order path is always appended, otherwise
 * every buyer would be sent to the same page and lose their order context.
 */
export function returnUrl(path: string): string | undefined {
  const base = (Deno.env.get('MARKETPLACE_RETURN_URL') ?? Deno.env.get('APP_ORIGIN') ?? '').trim();
  if (!base) return undefined;
  try {
    const root = new URL(base);
    if (root.protocol !== 'https:' && root.protocol !== 'http:') return undefined;
    // Drop any query or hash so they cannot corrupt the per-order path.
    root.search = '';
    root.hash = '';
    // Preserve a sub-path deployment (e.g. /marketplace) by making it a
    // directory, then resolve the order path *relative* to it.
    if (!root.pathname.endsWith('/')) root.pathname += '/';
    const relative = path.replace(/^\/+/, '');
    return new URL(relative, root).toString();
  } catch {
    return undefined;
  }
}