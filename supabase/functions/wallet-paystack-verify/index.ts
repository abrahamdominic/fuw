import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_API = 'https://api.paystack.co';

// Origin allow-list, matching every other payment function.
//
// This previously reflected whatever Origin the caller sent (falling back to
// `*`), which made CORS a no-op: any site on the internet could drive these
// endpoints from a victim's browser and read the JSON responses. `corsFor`
// from _shared/payments.ts is the hardened implementation -- it emits an
// Access-Control-Allow-Origin only for an allow-listed origin and omits the
// header entirely otherwise, so the browser blocks the request.
import { corsFor, json as jsonResponse } from '../_shared/payments.ts';

// Re-exported from _shared so the allow-list logic has exactly one
// implementation; kept as a local alias so the call sites below are unchanged.
const json = jsonResponse;

function mapPaystackChannel(channel: string | null | undefined): string {
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
      return 'card';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const authorization = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500, req);
  if (!secretKey) return json({ error: 'Card funding verification is currently unavailable.' }, 503, req);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Authentication required' }, 401, req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  const reference = typeof body === 'object' && body !== null && 'reference' in body
    ? String((body as { reference: unknown }).reference).trim()
    : '';

  if (!reference || !reference.startsWith('fuw_fund_')) {
    return json({ error: 'Invalid wallet funding reference.' }, 400, req);
  }

  // 1. Ownership & existence check (caller can only check their own transaction)
  const { data: funding, error: fundingError } = await userClient.rpc('fuw_get_wallet_funding_status', {
    p_reference: reference
  });

  if (fundingError || !funding) {
    return json({ error: fundingError?.message || 'Funding transaction not found.' }, 404, req);
  }

  if (funding.status === 'succeeded') {
    return json({
      status: 'succeeded',
      amount_kobo: funding.amount_kobo,
      balance_after_kobo: funding.balance_after_kobo
    }, 200, req);
  }

  if (funding.status === 'failed') {
    return json({ status: 'failed', reason: funding.failure_reason }, 200, req);
  }

  // 2. Ask Paystack API for authoritative status (Section 13)
  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const verifyRes = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    const verification = await verifyRes.json();
    const payment = verification?.data;

    if (!verifyRes.ok || verification?.status !== true) {
      return json({ error: 'Could not verify transaction with payment provider.' }, 502, req);
    }

    if (payment?.status === 'failed' || payment?.status === 'abandoned') {
      await serviceClient.rpc('fuw_fail_wallet_funding', {
        p_reference: reference,
        p_reason: `Provider reported status: ${payment.status}`
      });
      return json({ status: 'failed', reason: payment.gateway_response || payment.status }, 200, req);
    }

    if (payment?.status !== 'success') {
      return json({ status: 'pending' }, 200, req);
    }

    // Amount and currency check against stored expectation
    const verifiedAmount = Number(payment.amount);
    const verifiedCurrency = String(payment.currency || 'NGN').toUpperCase();
    const providerTxId = String(payment.id);
    const channel = mapPaystackChannel(payment.channel);

    const { data: completeData, error: completeError } = await serviceClient.rpc('fuw_complete_wallet_funding', {
      p_reference: reference,
      p_provider_transaction_id: providerTxId,
      p_provider_status: payment.status,
      p_amount_kobo: verifiedAmount,
      p_currency: verifiedCurrency,
      p_channel: channel,
      p_metadata: {
        verified_via: 'return_check',
        paid_at: payment.paid_at ?? null,
        gateway_response: payment.gateway_response ?? null
      }
    });

    if (completeError) {
      console.error('fuw_complete_wallet_funding failed in verify:', completeError.message);
      return json({ error: 'Failed to reconcile wallet funding.' }, 500, req);
    }

    return json({
      status: 'succeeded',
      amount_kobo: completeData?.amount_kobo ?? funding.amount_kobo,
      balance_after_kobo: completeData?.balance_after_kobo
    }, 200, req);
  } catch (cause) {
    console.error('wallet-paystack-verify error:', cause instanceof Error ? cause.message : cause);
    return json({ error: 'Verification service temporarily unavailable.' }, 502, req);
  }
});
