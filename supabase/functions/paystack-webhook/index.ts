import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsFor, json } from '../_shared/ai.ts';

async function isValidSignature(secret: string, rawBody: Uint8Array, signature: string | null): Promise<boolean> {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  if (!supabaseUrl || !serviceKey || !secretKey) return json({ error: 'Server misconfigured' }, 500, req);

  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 1024 * 1024) return json({ error: 'Webhook payload is too large.' }, 413, req);
  const reader = req.body?.getReader();
  if (!reader) return json({ error: 'Missing webhook payload.' }, 400, req);
  const chunks: Uint8Array[] = [];
  let bodySize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bodySize += value.byteLength;
    if (bodySize > 1024 * 1024) {
      await reader.cancel();
      return json({ error: 'Webhook payload is too large.' }, 413, req);
    }
    chunks.push(value);
  }
  const rawBody = new Uint8Array(bodySize);
  let bodyOffset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, bodyOffset);
    bodyOffset += chunk.byteLength;
  }
  if (!(await isValidSignature(secretKey, rawBody, req.headers.get('x-paystack-signature')))) {
    return json({ error: 'Invalid webhook signature' }, 401, req);
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json({ error: 'Invalid webhook payload' }, 400, req);
  }
  if (event.event !== 'charge.success') return json({ received: true, ignored: true }, 200, req);
  const reference = event.data?.reference?.trim();
  if (!reference || reference.length > 120) return json({ error: 'Missing payment reference' }, 400, req);

  try {
    const verificationResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const verification = await verificationResponse.json();
    const payment = verification?.data;
    if (!verificationResponse.ok || verification?.status !== true ||
      payment?.status !== 'success' || payment?.reference !== reference ||
      !Number.isSafeInteger(payment?.amount) || typeof payment?.currency !== 'string' ||
      !['string', 'number'].includes(typeof payment?.id)) {
      return json({ error: 'Provider verification did not confirm this payment.' }, 400, req);
    }

    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await serviceClient.rpc('complete_paystack_transaction', {
      p_reference: reference,
      p_provider_transaction_id: String(payment.id),
      p_provider_status: payment.status,
      p_amount_kobo: payment.amount,
      p_currency: payment.currency
    });
    if (error) {
      console.error('paystack-webhook completion failed:', error.message);
      return json({ error: 'Payment could not be reconciled.' }, 500, req);
    }
    return json({ received: true, status: data?.status ?? 'verified' }, 200, req);
  } catch (cause) {
    console.error('paystack-webhook verification failed:', cause instanceof Error ? cause.message : cause);
    return json({ error: 'Payment verification is temporarily unavailable.' }, 502, req);
  }
});
