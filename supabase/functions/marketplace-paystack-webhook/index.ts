import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_API = 'https://api.paystack.co';

function allowedOrigins(): string[] {
  return (Deno.env.get('MARKETPLACE_ORIGINS') ?? Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
}

function corsFor(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') ?? '').toLowerCase();
  const base = {
    'Access-Control-Allow-Headers':
      'authorization, apikey, x-client-info, content-type, x-paystack-signature, prefer',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };
  if (origin && allowedOrigins().includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin };
  }
  return base;
}

function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(req ? corsFor(req) : {}),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

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

  const signature = req.headers.get('x-paystack-signature');
  if (!(await isValidSignature(secretKey, rawBody, signature))) {
    console.warn('[marketplace-paystack-webhook] Rejected invalid signature');
    return json({ error: 'Invalid webhook signature' }, 401, req);
  }

  let event: {
    event?: string;
    data?: {
      id?: number | string;
      reference?: string;
      amount?: number;
      currency?: string;
      status?: string;
      channel?: string;
      paid_at?: string;
      metadata?: Record<string, unknown>;
    };
  };

  try {
    event = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json({ error: 'Invalid webhook payload' }, 400, req);
  }

  const eventType = String(event.event ?? '').trim();
  const eventData = event.data ?? {};
  const reference = String(eventData.reference ?? '').trim();
  const providerEventId = String(eventData.id ? `psx_evt_${eventData.id}` : `psx_ref_${reference}_${Date.now()}`);

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: recordRes } = await serviceClient.rpc('record_payment_webhook_event', {
    p_event_id: providerEventId,
    p_event_type: eventType,
    p_reference: reference || null,
    p_amount_kobo: eventData.amount ? Number(eventData.amount) : null,
    p_currency: eventData.currency ? String(eventData.currency) : null,
    p_status: 'received',
    p_outcome: null,
    p_metadata: {
      channel: eventData.channel ?? null,
      status: eventData.status ?? null,
      has_metadata: !!eventData.metadata
    }
  });

  if (recordRes?.duplicate === true) {
    console.log(`[marketplace-paystack-webhook] Duplicate event ignored: ${providerEventId}`);
    return json({ received: true, duplicate: true }, 200, req);
  }

  if (eventType === 'charge.success') {
    if (!reference) {
      console.warn('[marketplace-paystack-webhook] charge.success missing reference');
      return json({ error: 'Missing payment reference' }, 400, req);
    }

    try {
      const verifyRes = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` }
      });
      const verification = await verifyRes.json();
      const payment = verification?.data;

      if (!verifyRes.ok || verification?.status !== true || payment?.status !== 'success' || payment?.reference !== reference) {
        console.warn(`[marketplace-paystack-webhook] Verification failed for reference: ${reference}`);
        return json({ error: 'Provider verification did not confirm this transaction' }, 400, req);
      }

      const verifiedAmount = Number(payment.amount);
      const verifiedCurrency = String(payment.currency || 'NGN').toUpperCase();
      const providerTxId = String(payment.id);
      const channel = mapPaystackChannel(payment.channel);

      // Route A: FUW Wallet Funding
      if (reference.startsWith('fuw_fund_')) {
        const { data: fundRes, error: fundErr } = await serviceClient.rpc('fuw_complete_wallet_funding', {
          p_reference: reference,
          p_provider_transaction_id: providerTxId,
          p_provider_status: payment.status,
          p_amount_kobo: verifiedAmount,
          p_currency: verifiedCurrency,
          p_channel: channel,
          p_metadata: {
            channel: payment.channel,
            paid_at: payment.paid_at ?? null,
            gateway_response: payment.gateway_response ?? null
          }
        });

        if (fundErr) {
          console.error(`[marketplace-paystack-webhook] Wallet funding error: ${fundErr.message}`);
          return json({ error: 'Could not reconcile wallet funding' }, 500, req);
        }

        console.log(`[marketplace-paystack-webhook] Wallet funding success for ${reference}: balance_after = ${fundRes?.balance_after_kobo}`);
        return json({ received: true, type: 'wallet_funding', outcome: 'success', status: fundRes }, 200, req);
      }

      // Route B: Marketplace Order Payment
      if (reference.startsWith('fmp_')) {
        const { data: mpRes, error: mpErr } = await serviceClient.rpc('mp_apply_payment_event', {
          p_provider_event_id: `psx_${payment.id}`,
          p_event_type: 'charge.success',
          p_payment_id: null,
          p_provider_reference: payment.reference,
          p_amount_kobo: verifiedAmount,
          p_currency: verifiedCurrency,
          p_channel: channel,
          p_status: 'succeeded',
          p_meta: {
            provider: 'paystack',
            provider_transaction_id: providerTxId,
            provider_status: payment.status,
            paid_at: payment.paid_at ?? null,
            verified_via: 'webhook'
          }
        });

        if (mpErr) {
          console.error(`[marketplace-paystack-webhook] Marketplace order error: ${mpErr.message}`);
          return json({ error: 'Could not reconcile marketplace order' }, 500, req);
        }

        console.log(`[marketplace-paystack-webhook] Marketplace payment success for ${reference}`);
        return json({ received: true, type: 'marketplace_order', outcome: 'success', status: mpRes }, 200, req);
      }

      // Route C: eLibrary Premium Plan Subscription
      const { data: elibRes, error: elibErr } = await serviceClient.rpc('complete_paystack_transaction', {
        p_reference: reference,
        p_provider_transaction_id: providerTxId,
        p_provider_status: payment.status,
        p_amount_kobo: verifiedAmount,
        p_currency: verifiedCurrency
      });

      if (elibErr) {
        console.error(`[marketplace-paystack-webhook] eLibrary payment error: ${elibErr.message}`);
        return json({ error: 'Could not reconcile eLibrary transaction' }, 500, req);
      }

      console.log(`[marketplace-paystack-webhook] eLibrary payment success for ${reference}`);
      return json({ received: true, type: 'elibrary_premium', outcome: 'success', status: elibRes }, 200, req);
    } catch (cause) {
      console.error('[marketplace-paystack-webhook] Processing failed:', cause instanceof Error ? cause.message : cause);
      return json({ error: 'Payment processing error' }, 502, req);
    }
  }

  // Route D: Transfer / Withdrawal updates (pay.md Phase 4.3)
  if (eventType === 'transfer.success') {
    if (reference) {
      await serviceClient
        .from('wallet_withdrawals')
        .update({
          status: 'successful',
          processed_at: new Date().toISOString(),
          metadata: { transfer_success: eventData }
        })
        .eq('reference', reference);
    }
    return json({ received: true, type: 'transfer_success', reference }, 200, req);
  }

  if (eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
    if (reference) {
      const reason = eventData.reason || eventData.message || 'Transfer failed or reversed by provider';
      await serviceClient.rpc('fuw_reverse_wallet_withdrawal', {
        p_reference: reference,
        p_reason: reason
      });
    }
    return json({ received: true, type: eventType, reference, outcome: 'reversed' }, 200, req);
  }

  if (['subscription.create', 'subscription.disable', 'invoice.payment_failed'].includes(eventType)) {
    console.log(`[marketplace-paystack-webhook] Monitored event processed: ${eventType}, reference: ${reference || 'n/a'}`);
    return json({ received: true, event: eventType, acknowledged: true }, 200, req);
  }

  console.log(`[marketplace-paystack-webhook] Unhandled event acknowledged: ${eventType}`);
  return json({ received: true, ignored: true }, 200, req);
});