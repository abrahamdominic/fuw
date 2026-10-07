// Server-side payment check, used after the student returns from the provider.
//
// A browser redirect is not evidence of anything — the student can reload it,
// edit the query string, or never visit it at all. This endpoint lets the
// *server* go and ask the provider what really happened to a reference it issued
// itself. That is safe because:
//   * the caller must be signed in,
//   * the reference must belong to an order that caller owns,
//   * the reference must be one we generated (it carries the fmp_ prefix and is
//     stored against a payment the caller owns),
//   * the amount and currency still have to match inside mp_apply_payment_event.
//
// Its purpose is to settle the payment promptly when a webhook is slow, not to
// replace the webhook. Both paths are idempotent.

import {
  config,
  corsFor,
  fetchPaystackTransaction,
  json,
  mapPaystackChannel,
  serviceClient,
  userClient
} from '../_shared/payments.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^fmp_[a-z0-9]{1,40}_[0-9a-f]{18}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const cfg = config();
  if (!cfg.ok) return json({ error: cfg.error }, cfg.status, req);

  const authorization = req.headers.get('Authorization') ?? '';
  const user = userClient(cfg.supabaseUrl, cfg.anonKey, authorization);
  const { data: userData, error: authError } = await user.auth.getUser();
  if (authError || !userData?.user) {
    return json({ error: 'Sign in to check your payment.' }, 401, req);
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
  const reference =
    typeof body === 'object' && body !== null && 'reference' in body
      ? String((body as { reference: unknown }).reference).trim()
      : '';

  if (!UUID.test(paymentId)) return json({ error: 'Invalid payment reference.' }, 400, req);
  if (!REFERENCE.test(reference)) {
    return json({ error: 'That is not a marketplace payment reference.' }, 400, req);
  }

  // Ownership check. The buyer must own this payment, and the stored provider
  // reference must be the one presented — otherwise this becomes a lookup
  // oracle for other people's orders.
  const service = serviceClient(cfg.supabaseUrl, cfg.serviceKey);
  const { data: rows, error: lookupError } = await service
    .from('marketplace_payments')
    .select('id, order_id, buyer_id, provider, provider_reference, amount_kobo, currency, status')
    .eq('id', paymentId)
    .limit(1);

  if (lookupError) {
    console.error('payment lookup failed:', lookupError.message);
    return json({ error: 'The payment could not be checked right now.' }, 500, req);
  }

  const record = rows?.[0];
  if (!record || record.buyer_id !== userData.user.id) {
    return json({ error: 'You can only check your own payments.' }, 403, req);
  }
  if (record.provider_reference !== reference) {
    return json({ error: 'That reference does not belong to this order.' }, 403, req);
  }

  // Already settled: nothing to ask the provider about.
  if (record.status === 'succeeded') {
    return json({ status: 'succeeded', applied: false }, 200, req);
  }

  const verified = await fetchPaystackTransaction(cfg.secretKey, reference);
  if (!verified.ok) {
    return json({ error: verified.error }, 502, req);
  }
  const payment = verified.transaction;

  if (payment.status !== 'success') {
    return json(
      { status: payment.status, applied: false, message: 'The provider has not confirmed this payment yet.' },
      200,
      req
    );
  }

  const { data, error } = await service.rpc('mp_apply_payment_event', {
    p_provider_event_id: `psx_${payment.id}`,
    p_event_type: 'charge.success',
    p_payment_id: record.id,
    p_provider_reference: payment.reference,
    p_amount_kobo: payment.amount,
    p_currency: payment.currency,
    p_channel: mapPaystackChannel(payment.channel),
    p_status: 'succeeded',
    p_meta: {
      provider: 'paystack',
      provider_transaction_id: String(payment.id),
      provider_status: payment.status,
      paid_at: payment.paid_at ?? null,
      verified_via: 'return_check'
    }
  });

  if (error) {
    // An amount or reference mismatch lands here. It has already been refused
    // and audited inside the database; do not paper over it.
    console.error('return-check reconciliation refused:', error.message);
    return json({ error: error.message, applied: false }, 409, req);
  }

  const applied = (data as { applied?: boolean } | null)?.applied === true;
  return json({ status: 'succeeded', applied }, 200, req);
});