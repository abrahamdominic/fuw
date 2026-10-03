import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsFor, json } from '../_shared/ai.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const authorization = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500, req);
  if (!secretKey) return json({ error: 'Automatic payments are not configured.' }, 503, req);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'Authentication required' }, 401, req);

  let body: { reference?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  if (!reference || reference.length > 120) return json({ error: 'Invalid payment reference.' }, 400, req);

  const { data: transaction, error: transactionError } = await userClient
    .from('payment_transactions')
    .select('payment_reference, provider, payment_method, status')
    .eq('user_id', user.id)
    .eq('payment_reference', reference)
    .maybeSingle();
  if (transactionError) {
    console.error('paystack-verify transaction lookup failed:', transactionError.message);
    return json({ error: 'Could not load this payment.' }, 500, req);
  }
  if (!transaction || transaction.provider !== 'paystack' || transaction.payment_method !== 'automatic') {
    return json({ error: 'Payment transaction not found.' }, 404, req);
  }
  if (transaction.status === 'verified') return json({ status: 'verified' }, 200, req);
  if (transaction.status !== 'pending') return json({ status: transaction.status }, 200, req);

  try {
    const verificationResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const verification = await verificationResponse.json();
    const payment = verification?.data;
    if (!verificationResponse.ok || verification?.status !== true) {
      return json({ error: 'The payment provider could not verify this transaction.' }, 502, req);
    }
    if (payment?.status === 'failed' || payment?.status === 'abandoned') {
      const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      const { error } = await serviceClient.rpc('fail_paystack_transaction', {
        p_reference: reference,
        p_reason: 'The payment provider reported a failed or abandoned transaction.'
      });
      if (error) throw new Error(`Could not save provider failure: ${error.message}`);
      return json({ status: 'failed' }, 200, req);
    }
    if (payment?.status !== 'success') return json({ status: 'pending' }, 200, req);
    if (payment.reference !== reference || !Number.isSafeInteger(payment.amount) ||
      typeof payment.currency !== 'string' || !['string', 'number'].includes(typeof payment.id)) {
      return json({ error: 'Provider verification did not match the transaction.' }, 400, req);
    }

    const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await serviceClient.rpc('complete_paystack_transaction', {
      p_reference: reference,
      p_provider_transaction_id: String(payment.id),
      p_provider_status: payment.status,
      p_amount_kobo: payment.amount,
      p_currency: payment.currency
    });
    if (error) throw new Error(`Could not activate verified payment: ${error.message}`);
    return json({ status: data?.status ?? 'verified' }, 200, req);
  } catch (cause) {
    console.error('paystack-verify failed:', cause instanceof Error ? cause.message : cause);
    return json({ error: 'Payment verification is temporarily unavailable.' }, 502, req);
  }
});
