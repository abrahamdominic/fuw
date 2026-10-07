import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_API = 'https://api.paystack.co';

// Origin allow-list, matching every other payment function.
//
// This previously duplicated allow-list logic that already lived in
// _shared/payments.ts. It behaved correctly, but a local copy is one more place
// for the policy to drift, so it is imported instead.
import { corsFor } from '../_shared/payments.ts';

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

/**
 * Paystack transfer status -> our recorded status.
 *
 * `otp` and `received` are approval steps Paystack is still waiting on, not
 * outcomes: the money has not moved yet, so they map to `processing`.
 */
function toRecordableStatus(providerStatus: unknown): 'successful' | 'processing' | 'failed' {
  const s = String(providerStatus ?? '').toLowerCase();
  if (s === 'success' || s === 'successful' || s === 'sent') return 'successful';
  if (s === 'failed' || s === 'rejected' || s === 'abandoned' ||
      s === 'blocked' || s === 'reversed') return 'failed';
  return 'processing';
}

const HOLDING_MESSAGE =
  'Withdrawal received. Funds are held while the bank transfer is confirmed.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, req);
  }

  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!secretKey) {
    return json({ error: 'Paystack is not configured on the server' }, 503, req);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json({ error: 'Authentication required' }, 401, req);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return json({ error: 'Invalid authentication session' }, 401, req);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON request body' }, 400, req);
  }

  const action = String(body.action || 'submit_withdrawal');
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // 1. Fetch Nigerian banks list from Paystack
  if (action === 'get_banks') {
    try {
      const res = await fetch(`${PAYSTACK_API}/bank?country=nigeria&perPage=100`, {
        headers: { Authorization: `Bearer ${secretKey}` }
      });
      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.message || 'Could not fetch banks');
      }
      const banks = (data.data || []).map((b: any) => ({
        name: b.name,
        code: b.code,
        slug: b.slug,
        active: b.active
      }));
      return json({ success: true, banks }, 200, req);
    } catch (err: any) {
      return json({ error: err.message || 'Failed to retrieve banks' }, 502, req);
    }
  }

  // 2. Resolve account number with Paystack
  if (action === 'resolve_account') {
    const accountNumber = String(body.accountNumber || '').trim();
    const bankCode = String(body.bankCode || '').trim();

    if (!/^[0-9]{10}$/.test(accountNumber) || !bankCode) {
      return json({ error: 'Valid 10-digit account number and bank code required' }, 400, req);
    }

    try {
      const res = await fetch(
        `${PAYSTACK_API}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const data = await res.json();
      if (!res.ok || !data.status) {
        return json({ error: data.message || 'Could not verify account name. Check account number and bank.' }, 400, req);
      }
      return json({
        success: true,
        account_name: data.data?.account_name,
        account_number: data.data?.account_number,
        bank_id: data.data?.bank_id
      }, 200, req);
    } catch (err: any) {
      return json({ error: err.message || 'Account validation unavailable' }, 502, req);
    }
  }

  // 3. Submit withdrawal request
  if (action === 'submit_withdrawal') {
    const amountKobo = Number(body.amountKobo);
    const bankCode = String(body.bankCode || '').trim();
    const bankName = String(body.bankName || '').trim();
    const accountNumber = String(body.accountNumber || '').trim();

    if (!Number.isSafeInteger(amountKobo) || amountKobo < 50000) {
      return json({ error: 'Minimum withdrawal is ₦500' }, 400, req);
    }

    if (!bankCode || !bankName || !/^[0-9]{10}$/.test(accountNumber)) {
      return json({ error: 'Complete bank account details are required' }, 400, req);
    }

    // Server-side re-resolution. The client's `accountName` is display only and
    // is deliberately never used: a tampered browser could otherwise direct the
    // money to an account whose name it simply claimed. The name Paystack
    // returns here is what gets stored and what the recipient is created with.
    let resolvedName: string;
    try {
      const resolveRes = await fetch(
        `${PAYSTACK_API}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const resolveData = await resolveRes.json();
      resolvedName = String(resolveData?.data?.account_name ?? '').trim();
      if (!resolveRes.ok || !resolveData.status || !resolvedName) {
        return json({
          error: resolveData?.message ||
            'Bank account could not be verified. Check the account number and bank, then try again.'
        }, 400, req);
      }
    } catch {
      return json({ error: 'Bank account verification is temporarily unavailable. Please try again.' }, 502, req);
    }

    // Replay guard. The browser reuses the same key on retry so a double-tap
    // returns the original withdrawal instead of debiting the wallet twice.
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).slice(0, 120);
    const requestIp = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64);

    const { data: requestRes, error: rpcErr } = await userClient.rpc('fuw_request_wallet_withdrawal', {
      p_amount_kobo: amountKobo,
      p_bank_code: bankCode,
      p_bank_name: bankName,
      p_account_number: accountNumber,
      p_account_name: resolvedName,
      p_idempotency_key: idempotencyKey,
      p_request_ip: requestIp
    });

    if (rpcErr || !requestRes?.success) {
      return json({ error: rpcErr?.message || 'Withdrawal could not be processed' }, 400, req);
    }

    const reference = requestRes.reference;
    const amount = requestRes.net_amount_kobo;

    // A replay means this withdrawal already exists and was already handed to
    // (or attempted against) Paystack. Creating a second transfer here would
    // pay the student twice, so the stored outcome is returned as-is.
    if (requestRes.replayed) {
      return json({
        success: true,
        replayed: true,
        status: requestRes.status,
        reference,
        amount_kobo: amountKobo,
        fee_kobo: requestRes.fee_kobo,
        net_amount_kobo: amount,
        balance_after_kobo: requestRes.balance_after_kobo,
        message: 'This withdrawal was already submitted.'
      }, 200, req);
    }

    const recordTransfer = async (
      providerStatus: string,
      transferCode?: string | null,
      recipientCode?: string | null,
      approvalUrl?: string | null,
      authorizationCode?: string | null,
      failureReason?: string | null,
      payload: Record<string, unknown> = {}
    ) => {
      const { data, error } = await serviceClient.rpc('fuw_record_wallet_withdrawal_transfer', {
        p_reference: reference,
        p_provider_status: providerStatus,
        p_transfer_code: transferCode ?? null,
        p_recipient_code: recipientCode ?? null,
        // Stored only when Paystack actually sent one. Paystack does not return
        // an approval URL on a standard /transfer response, so this stays NULL
        // rather than being synthesised.
        p_approval_url: approvalUrl ?? null,
        p_authorization_code: authorizationCode ?? null,
        p_failure_reason: failureReason ?? null,
        p_provider_payload: payload
      });
      if (error) console.warn('Could not record transfer outcome:', error.message);
      return data;
    };

    const reverse = async (reason: string) => {
      const { error } = await serviceClient.rpc('fuw_reverse_wallet_withdrawal', {
        p_reference: reference,
        p_reason: reason
      });
      if (error) console.error('Could not reverse withdrawal:', error.message);
    };

    // Hand the transfer to Paystack. Everything below reports what Paystack
    // actually answered; no status is invented here.
    let transferData: any = null;
    let transferOk = false;
    let paystackError = '';

    try {
      const recRes = await fetch(`${PAYSTACK_API}/transferrecipient`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'nuban',
          name: resolvedName,
          account_number: accountNumber,
          bank_code: bankCode,
          currency: 'NGN',
          metadata: { user_id: user.id, reference }
        })
      });
      const recData = await recRes.json();

      if (recRes.ok && recData.status && recData.data?.recipient_code) {
        const recipientCode = recData.data.recipient_code;
        const trfRes = await fetch(`${PAYSTACK_API}/transfer`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source: 'balance',
            amount,
            recipient: recipientCode,
            reference,
            reason: `FUW Wallet Withdrawal (${reference})`
          })
        });
        transferData = await trfRes.json();
        transferOk = trfRes.ok && transferData?.status === true;

        if (transferOk) {
          const d = transferData.data ?? {};
          const providerStatus = String(d.status ?? 'pending');
          const recorded = await recordTransfer(
            providerStatus,
            d.transfer_code ?? null,
            recipientCode,
            d.approval_url ?? null,
            d.authorization ?? null,
            d.failures?.join?.(', ') ?? null,
            transferData
          );

          const outcome = toRecordableStatus(providerStatus);
          if (outcome === 'failed') {
            await reverse('Paystack rejected the transfer');
          }

          const messages: Record<string, string> = {
            successful: 'Withdrawal completed and has been sent to your bank account.',
            processing: HOLDING_MESSAGE,
            failed: 'The transfer was rejected by Paystack. Your wallet has been refunded in full.'
          };

          return json({
            success: true,
            status: outcome,
            replayed: false,
            reference,
            amount_kobo: amountKobo,
            fee_kobo: requestRes.fee_kobo,
            net_amount_kobo: amount,
            balance_after_kobo: requestRes.balance_after_kobo,
            // Only set when Paystack returned one; otherwise null, never a
            // fabricated link.
            approval_url: d.approval_url ?? null,
            provider_status: providerStatus,
            message: messages[outcome] ?? HOLDING_MESSAGE
          }, 200, req);
        }

        paystackError = String(transferData?.message || 'Paystack could not start the transfer.');
      } else {
        paystackError = String(recData?.message || 'Could not create the bank recipient.');
      }
    } catch (err: any) {
      paystackError = err?.message || 'Paystack is temporarily unreachable.';
    }

    // Paystack never accepted the transfer, so nothing has left the wallet on
    // the provider side. Record the failure and return the money now rather
    // than leaving the student in a permanent "processing" state.
    await recordTransfer('failed', null, null, null, null, paystackError, { error: paystackError });
    await reverse('Paystack transfer could not be initiated');

    return json({
      success: true,
      status: 'failed',
      replayed: false,
      reference,
      amount_kobo: amountKobo,
      fee_kobo: requestRes.fee_kobo,
      net_amount_kobo: amount,
      balance_after_kobo: requestRes.balance_after_kobo,
      approval_url: null,
      message: `${paystackError} Your wallet has been refunded in full.`
    }, 200, req);
  }

  // 4. Finalise a transfer that Paystack parked behind an OTP.
  //
  // This is a privileged operation: Paystack sends the OTP to the account
  // owner, so only the super administrator can supply it. Ordinary students
  // never see this path.
  if (action === 'finalize_transfer') {
    const transferCode = String(body.transferCode || '').trim();
    const otp = String(body.otp || '').trim();

    if (!transferCode || !otp) {
      return json({ error: 'Transfer code and OTP are required' }, 400, req);
    }

    const { data: isSuper, error: roleErr } = await userClient.rpc('is_super_admin');
    if (roleErr || !isSuper) {
      return json({ error: 'Super administrator privileges required' }, 403, req);
    }

    try {
      const res = await fetch(`${PAYSTACK_API}/transfer/finalize_transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transfer_code: transferCode, otp })
      });
      const data = await res.json();

      if (!res.ok || !data.status) {
        return json({ error: data?.message || 'Paystack rejected the OTP.' }, 400, req);
      }

      const d = data.data ?? {};
      await serviceClient.rpc('fuw_record_wallet_withdrawal_transfer', {
        p_reference: String(d.reference ?? ''),
        p_provider_status: String(d.status ?? 'pending'),
        p_transfer_code: d.transfer_code ?? transferCode,
        p_recipient_code: d.recipient?.recipient_code ?? null,
        p_approval_url: d.approval_url ?? null,
        p_authorization_code: d.authorization ?? null,
        p_failure_reason: null,
        p_provider_payload: data
      });

      return json({ success: true, status: d.status ?? 'pending', transfer_code: d.transfer_code ?? transferCode }, 200, req);
    } catch (err: any) {
      return json({ error: err?.message || 'Could not finalize the transfer.' }, 502, req);
    }
  }

  return json({ error: 'Unknown action' }, 400, req);
});
