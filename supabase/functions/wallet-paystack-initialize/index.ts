import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const authorization = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500, req);
  if (!secretKey) return json({ error: 'Card funding is currently unavailable.' }, 503, req);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Authentication required' }, 401, req);
  if (!user.email) return json({ error: 'A verified email address is required for Paystack funding.' }, 400, req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  const rawAmount = typeof body === 'object' && body !== null && 'amountKobo' in body
    ? Number((body as { amountKobo: unknown }).amountKobo)
    : 0;

  if (!Number.isSafeInteger(rawAmount) || rawAmount < 10000 || rawAmount > 50000000) {
    return json({ error: 'Funding amount must be between ₦100 and ₦500,000.' }, 400, req);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 1. Server creates pending funding record & fixes expected amount (Section 4, 5)
  const { data: funding, error: fundingError } = await userClient.rpc('fuw_begin_wallet_funding', {
    p_amount_kobo: rawAmount
  });

  if (fundingError || !funding?.reference) {
    console.error('fuw_begin_wallet_funding error:', fundingError?.message);
    return json({ error: fundingError?.message || 'Could not initiate wallet funding.' }, 400, req);
  }

  const reference = String(funding.reference);
  const amountKobo = Number(funding.amount_kobo);

  try {
    // 2. Initialize Paystack charge with official card flow (Section 4, 14, 38)
    const callbackUrl = Deno.env.get('PAYSTACK_CALLBACK_URL') || 'https://fuwtest.netlify.app/marketplace/wallet';

    const providerResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: amountKobo,
        currency: 'NGN',
        reference: reference,
        callback_url: callbackUrl,
        channels: ['card'],
        metadata: {
          type: 'wallet_funding',
          funding_id: funding.funding_id,
          user_id: user.id,
          reference: reference
        }
      })
    });

    const providerResult = await providerResponse.json().catch(() => null);
    const paymentData = providerResult?.data;

    if (
      !providerResponse.ok ||
      providerResult?.status !== true ||
      paymentData?.reference !== reference ||
      typeof paymentData?.authorization_url !== 'string' ||
      !paymentData.authorization_url.startsWith('https://checkout.paystack.com/')
    ) {
      throw new Error(providerResult?.message || 'Paystack could not initialize a valid checkout session.');
    }

    const { error: checkoutError } = await serviceClient.rpc('fuw_set_wallet_funding_checkout', {
      p_reference: reference,
      p_authorization_url: paymentData.authorization_url
    });
    if (checkoutError) {
      console.warn('Could not save checkout url:', checkoutError.message);
    }

    return json({
      authorization_url: paymentData.authorization_url,
      reference: reference,
      amount_kobo: amountKobo
    }, 200, req);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'Paystack initialization failed.';
    console.error('wallet-paystack-initialize failed:', reason);

    await serviceClient.rpc('fuw_fail_wallet_funding', {
      p_reference: reference,
      p_reason: reason
    }).catch(() => undefined);

    return json({ error: 'Could not initialize Paystack card payment. Please try again.' }, 502, req);
  }
});
