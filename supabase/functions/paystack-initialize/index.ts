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
  if (!user.email) return json({ error: 'A verified email address is required for Paystack checkout.' }, 400, req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }
  const planSlug = typeof body === 'object' && body !== null && 'planSlug' in body
    ? String((body as { planSlug: unknown }).planSlug).trim().toLowerCase()
    : '';
  if (!/^[a-z0-9-]{1,80}$/.test(planSlug)) return json({ error: 'Invalid Premium plan.' }, 400, req);

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: transaction, error: transactionError } = await userClient.rpc('create_paystack_transaction', {
    p_plan_slug: planSlug
  });
  if (transactionError || !transaction?.id || !transaction?.reference) {
    console.error('paystack-initialize transaction creation failed:', transactionError?.message ?? 'Invalid transaction response');
    return json({ error: transactionError?.message ?? 'Could not create the payment transaction.' }, 400, req);
  }

  try {
    const configuredCallbackUrl = Deno.env.get('PAYSTACK_CALLBACK_URL');
    const appOrigin = Deno.env.get('APP_ORIGIN');
    const callbackUrl = configuredCallbackUrl ||
      (appOrigin ? new URL('/student/subscription?payment=return', appOrigin).toString() : undefined);
    const providerResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: transaction.amount_kobo,
        currency: transaction.currency,
        reference: transaction.reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: {
          transaction_id: transaction.id,
          user_id: user.id,
          plan_slug: transaction.plan_slug
        }
      })
    });
    const providerResult = await providerResponse.json();
    const paymentData = providerResult?.data;
    if (!providerResponse.ok || providerResult?.status !== true ||
      paymentData?.reference !== transaction.reference ||
      typeof paymentData?.authorization_url !== 'string' ||
      !paymentData.authorization_url.startsWith('https://checkout.paystack.com/')) {
      throw new Error('Payment provider could not initialize a valid checkout session.');
    }

    const { error: checkoutError } = await serviceClient.rpc('set_paystack_checkout', {
      p_transaction_id: transaction.id,
      p_authorization_url: paymentData.authorization_url
    });
    if (checkoutError) throw new Error(`Could not save checkout state: ${checkoutError.message}`);
    return json({
      authorization_url: paymentData.authorization_url,
      reference: transaction.reference
    }, 200, req);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'Payment provider initialization failed.';
    const { error: failureError } = await serviceClient.rpc('fail_paystack_transaction', {
      p_reference: transaction.reference,
      p_reason: reason
    });
    if (failureError) console.error('paystack-initialize could not mark transaction failed:', failureError.message);
    console.error('paystack-initialize failed:', reason);
    return json({ error: 'Automatic checkout could not be initialized. No Premium access was granted.' }, 502, req);
  }
});
