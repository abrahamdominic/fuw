// Starts a real Marketplace payment.
//
// The browser says "I want to pay for order X". This function decides what that
// means: it asks the database to fix the amount (mp_begin_payment_attempt
// re-derives it from the order total and refuses anything that has drifted),
// then relays that exact figure to Paystack. The client never names an amount,
// a currency, a reference or a vendor.
//
// It does not and cannot mark anything paid. The only two writers of payment
// state are the signed webhook and the server-side verify endpoint.

import {
  config,
  corsFor,
  json,
  returnUrl,
  serviceClient,
  userClient
} from '../_shared/payments.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The channel is only a record of what the buyer *intended* to use. It never
 * authorises anything, and it is overwritten with the provider's own channel
 * once money is confirmed, so it is restricted to a small fixed set rather than
 * taken on trust.
 */
const REQUESTABLE_CHANNELS = ['card', 'ussd', 'bank_transfer'] as const;
type RequestableChannel = (typeof REQUESTABLE_CHANNELS)[number];

function requestedChannel(body: unknown): RequestableChannel {
  const raw =
    typeof body === 'object' && body !== null && 'channel' in body
      ? String((body as { channel: unknown }).channel).trim().toLowerCase()
      : '';
  const match = REQUESTABLE_CHANNELS.find((c) => c === raw);
  return match ?? 'card';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const cfg = config();
  if (!cfg.ok) return json({ error: cfg.error }, cfg.status, req);

  const authorization = req.headers.get('Authorization') ?? '';
  const user = userClient(cfg.supabaseUrl, cfg.anonKey, authorization);
  const { data: userData, error: authError } = await user.auth.getUser();
  if (authError || !userData?.user) {
    return json({ error: 'Sign in to pay for your order.' }, 401, req);
  }
  if (!userData.user.email) {
    return json({ error: 'A verified email address is required before you can pay.' }, 400, req);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  const paymentId =
    typeof body === 'object' && body !== null && 'paymentId' in body
      ? String((body as { paymentId: unknown }).paymentId).trim()
      : '';
  if (!UUID.test(paymentId)) {
    return json({ error: 'Invalid payment reference.' }, 400, req);
  }

  // The database decides the amount, the currency and the provider reference.
  // A caller's own figure is never consulted.
  const { data: attempt, error: attemptError } = await user.rpc('mp_begin_payment_attempt', {
    p_payment_id: paymentId,
    p_channel: requestedChannel(body)
  });

  if (attemptError) {
    console.error('mp_begin_payment_attempt failed:', attemptError.message);
    return json(
      { error: attemptError.message || 'This order cannot be paid right now.' },
      400,
      req
    );
  }

  const reference = String(attempt?.reference ?? '');
  const amountKobo = Number(attempt?.amount_kobo ?? 0);
  const currency = String(attempt?.currency ?? 'NGN');
  if (!reference || !Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    return json({ error: 'The order total could not be determined.' }, 500, req);
  }

  const callback = returnUrl(`/order/${attempt.order_id}?payment=returned`);
  const service = serviceClient(cfg.supabaseUrl, cfg.serviceKey);

  try {
    const providerResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: userData.user.email,
        amount: amountKobo,
        currency,
        reference,
        ...(callback ? { callback_url: callback } : {}),
        metadata: {
          source: 'fuw_marketplace',
          payment_id: String(attempt.payment_id),
          order_id: String(attempt.order_id),
          order_number: String(attempt.order_number ?? ''),
          buyer_id: userData.user.id
        }
      })
    });

    const providerPayload = await providerResponse.json().catch(() => null);
    const checkout = providerPayload?.data;

    // Never hand back a URL we have not checked came from Paystack's checkout.
    if (
      !providerResponse.ok ||
      providerPayload?.status !== true ||
      checkout?.reference !== reference ||
      typeof checkout?.authorization_url !== 'string' ||
      !checkout.authorization_url.startsWith('https://checkout.paystack.com/')
    ) {
      throw new Error(
        providerPayload?.message ?? 'The payment provider could not open a checkout session.'
      );
    }

    return json(
      {
        authorization_url: checkout.authorization_url,
        reference,
        amount_kobo: amountKobo,
        currency,
        payment_id: String(attempt.payment_id),
        order_id: String(attempt.order_id)
      },
      200,
      req
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'Checkout could not be started.';
    const reused = (attempt as { reused?: unknown } | null)?.reused === true;
    console.error('paystack initialize failed:', reason, reused ? '(reused reference)' : '(new reference)');

    if (reused) {
      // A reference already reached Paystack on an earlier attempt, so a live
      // charge may exist for it at the provider. Paystack rejects a second
      // initialize for the same reference, which is what lands us here. The
      // reference MUST be kept: the webhook reconciles strictly by
      // provider_reference, so clearing it here would leave a genuinely
      // successful charge unreconcilable and the buyer paying into an order
      // that can never be marked paid.
      //
      // The payment stays `processing` on purpose. The order is still at
      // pending_payment, and the return-from-Paystack verification plus the
      // signed webhook both resolve against the retained reference.
      return json(
        {
          error:
            'A checkout for this order is already open. Complete the payment, then return to your orders.',
          reference,
          checkout_already_open: true
        },
        409,
        req
      );
    }

    // First attempt failed, so nothing exists at the provider under this
    // reference. Unwind it so the order stays payable and the buyer can retry
    // cleanly. The order is deliberately left at pending_payment.
    const { error: resetError } = await service.rpc('mp_reset_payment_attempt', {
      p_payment_id: paymentId,
      p_reason: reason
    });
    if (resetError) {
      console.error('mp_reset_payment_attempt failed:', resetError.message);
    }
    return json(
      { error: 'The payment could not be started. You have not been charged.' },
      502,
      req
    );
  }
});