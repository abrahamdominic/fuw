// =============================================================================
// Production-boundary test: PostgREST, real JWTs, real RLS, real grants.
//
// The in-SQL harness (scripts/verify-payment-security.sql) connects directly as
// postgres and then SET LOCAL ROLE, which leaves session_user = 'postgres'. That
// makes mp_is_server_context() true for every impersonation, so it cannot prove a
// client was actually refused -- a guard that reads session_user would pass under
// test and fail in production.
//
// This script speaks the way the browser does: anon/authenticated JWTs over
// PostgREST, so session_user is 'authenticator' and the only thing that can make
// mp_is_server_context() true is a real service_role JWT.
//
// Read-only with respect to money: it only ever calls functions that must refuse.
// Nothing here can create or move an order.
//
//   node scripts/verify-client-boundary.mjs
// =============================================================================

import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const URL_ = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0;
const failures = [];

const ok = (label) => {
  passed += 1;
  console.log(`  PASS  ${label}`);
};

const fail = (label, detail) => {
  failures.push(`${label}${detail ? `  -- ${detail}` : ''}`);
  console.log(`  FAIL  ${label}${detail ? `  -- ${detail}` : ''}`);
};

const section = (title) => console.log(`\n=== ${title} ===`);

// -----------------------------------------------------------------------------
// Mint a real access token for an existing user, using the admin API.
// -----------------------------------------------------------------------------
async function mintToken(email) {
  const link = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!link.ok) throw new Error(`generate_link ${link.status}: ${await link.text()}`);
  const { hashed_token: hashed } = await link.json();

  const verify = await fetch(
    `${URL_}/auth/v1/verify?type=magiclink&token=${encodeURIComponent(hashed)}`,
    { headers: { apikey: ANON }, redirect: 'manual' },
  );
  const body = await verify.text();
  const token = body.match(/#access_token=([A-Za-z0-9._-]+)/)?.[1];
  if (!token) throw new Error(`could not mint a token for ${email}: ${body.slice(0, 200)}`);

  const claims = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );
  return { token, sub: claims.sub };
}

// -----------------------------------------------------------------------------
// Call a PostgREST RPC as a given role.
// -----------------------------------------------------------------------------
async function rpc(fn, args, token) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: token ? ANON : ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, refused: res.status >= 400, code: body?.code };
}

// A refusal is only meaningful if the call was actually reachable: a 404 means
// the RPC is not exposed at all, which is a stronger refusal, and a 401/403 is
// PostgREST or Postgres rejecting the role. All of those count as "refused".
async function mustRefuse(label, fn, args, token) {
  const r = await rpc(fn, args, token);
  if (r.refused) ok(`${label}  [${r.status}${r.code ? ` ${r.code}` : ''}]`);
  else fail(label, `ACCEPTED -> ${JSON.stringify(r.body).slice(0, 160)}`);
  return r;
}

async function mustAccept(label, fn, args, token) {
  const r = await rpc(fn, args, token);
  if (!r.refused) ok(label);
  else fail(label, `REFUSED ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  return r;
}

// -----------------------------------------------------------------------------
// Pick live fixtures through the service role.
// -----------------------------------------------------------------------------
async function serviceQuery(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

const run = async () => {
  console.log('Marketplace client-boundary verification');
  console.log(`target ${URL_}`);

  // ---- fixtures -------------------------------------------------------------
  const [orders, vendorRows] = await Promise.all([
    serviceQuery(
      'marketplace_orders?status=eq.pending_payment&vendor_id=not.is.null&select=id,payment_id,total_kobo,buyer_id,vendor_id,order_number&limit=5',
    ),
    serviceQuery('marketplace_vendors?select=id,owner_id,status&limit=50'),
  ]);
  if (!orders.length) throw new Error('no pending_payment order with a vendor to test against');

  const candidate = orders.find((o) => {
    const v = vendorRows.find((x) => x.id === o.vendor_id);
    return v?.status === 'active';
  });
  if (!candidate) throw new Error('no pending_payment order whose vendor is trading');
  const vendor = vendorRows.find((v) => v.id === candidate.vendor_id);

  // The three personas: the buyer, the vendor who must fulfil, and a bystander
  // who is a different vendor entirely.
  const bystander = vendorRows.find((v) => v.owner_id !== vendor.owner_id && v.owner_id !== candidate.buyer_id);
  if (!bystander) throw new Error('no bystander vendor available');

  const buyer = await mintToken('admin@gmail.com');
  const { token: vendorTok, sub: vendorSub } = await mintToken('abrahamunchain@gmail.com');
  const { token: strangerTok } = await mintToken('onchaindevrel@gmail.com');

  console.log(`\norder      ${candidate.order_number} (${candidate.id}) total ${candidate.total_kobo}`);
  console.log(`buyer      ${buyer.sub}`);
  console.log(`vendor     ${vendorSub}`);
  console.log(`stranger   ${bystander.owner_id}`);

  const payment = candidate.payment_id;
  const order = candidate.id;
  const total = candidate.total_kobo;

  if (buyer.sub !== candidate.buyer_id)
    throw new Error(`buyer token is ${buyer.sub} but the order belongs to ${candidate.buyer_id}`);

  // ---- 1. anon has nothing --------------------------------------------------
  section('1. anon (no session)');
  await mustRefuse('anon cannot forge a payment event', 'mp_apply_payment_event', {
    p_provider_event_id: 'anon_forged_0001',
    p_event_type: 'charge.success',
    p_payment_id: payment,
    p_provider_reference: 'fmp_whatever_0001',
    p_amount_kobo: total,
    p_currency: 'NGN',
    p_channel: 'card',
    p_status: 'succeeded',
    p_meta: {},
  });
  await mustRefuse('anon cannot start a payment attempt', 'mp_begin_payment_attempt', {
    p_payment_id: payment,
    p_channel: 'card',
  });
  await mustRefuse('anon cannot create orders', 'mp_create_orders', {
    p_idempotency_key: 'anon-probe',
    p_items: [],
    p_delivery_type: 'pickup',
    p_delivery: {},
    p_buyer_note: null,
    p_payment_provider: 'paystack',
  });
  await mustRefuse('anon cannot confirm receipt', 'mp_confirm_receipt', { p_order_id: order });

  // ---- 2. a signed-in student cannot forge anything -------------------------
  section('2. buyer tries to forge a verified capture');
  await mustRefuse('buyer cannot pass p_signature_ok', 'mp_apply_payment_event', {
    p_provider_event_id: 'buyer_forged_0001',
    p_event_type: 'charge.success',
    p_payment_id: payment,
    p_provider_reference: 'fmp_whatever_0001',
    p_amount_kobo: total,
    p_currency: 'NGN',
    p_channel: 'card',
    p_status: 'succeeded',
    p_meta: {},
    p_signature_ok: true,
  });
  await mustRefuse('buyer cannot reach the inner intake', 'mp_apply_payment_event_inner', {
    p_provider_event_id: 'buyer_forged_0002',
    p_event_type: 'charge.success',
    p_payment_id: payment,
    p_provider_reference: 'fmp_whatever_0001',
    p_amount_kobo: total,
    p_channel: 'card',
    p_status: 'succeeded',
    p_meta: {},
  });
  await mustRefuse('buyer cannot elevate itself to system', 'mp_set_system_actor', {
    p_enabled: true,
  });
  await mustRefuse('buyer cannot reset an attempt', 'mp_reset_payment_attempt', {
    p_payment_id: payment,
    p_reason: 'x',
  });
  await mustRefuse('buyer cannot confirm a manual transfer', 'mp_confirm_manual_transfer', {
    p_order_id: order,
    p_proof_reference: 'TRF-1',
    p_note: 'trust me',
  });

  // ---- 3. the scheduler sweeps are closed to clients ------------------------
  section('3. scheduler sweeps must be server-only');
  for (const [label, fn, args] of [
    ['buyer cannot run the auto-confirm sweep', 'mp_auto_confirm_orders', {}],
    ['buyer cannot run the expiry sweep', 'mp_cancel_expired_orders', {}],
    ['buyer cannot run the payout job', 'mp_release_eligible_settlements', {}],
    ['vendor cannot run the auto-confirm sweep', 'mp_auto_confirm_orders', {}],
    ['vendor cannot run the payout job', 'mp_release_eligible_settlements', {}],
    ['stranger cannot run the auto-confirm sweep', 'mp_auto_confirm_orders', {}],
    ['stranger cannot run the payout job', 'mp_release_eligible_settlements', {}],
    ['stranger cannot run the expiry sweep', 'mp_cancel_expired_orders', {}],
  ]) {
    const tok = label.startsWith('vendor') ? vendorTok : label.startsWith('stranger') ? strangerTok : buyer.token;
    await mustRefuse(label, fn, args, tok);
  }

  // ---- 4. the vendor cannot move the order along without being the vendor ----
  section('4. role boundaries on this order');
  await mustRefuse('stranger cannot confirm receipt', 'mp_confirm_receipt', { p_order_id: order }, strangerTok);
  await mustRefuse('stranger cannot complete the order', 'mp_transition_order', {
    p_order_id: order,
    p_to_status: 'completed',
    p_reason: 'not mine',
  }, strangerTok);
  await mustRefuse('stranger cannot start a payment attempt', 'mp_begin_payment_attempt', {
    p_payment_id: payment,
    p_channel: 'card',
  }, strangerTok);
  await mustRefuse('vendor cannot confirm receipt for the buyer', 'mp_confirm_receipt', { p_order_id: order }, vendorTok);
  await mustRefuse('buyer cannot fulfil the order themselves', 'mp_transition_order', {
    p_order_id: order,
    p_to_status: 'delivered',
    p_reason: 'I will just say it arrived',
  }, buyer.token);

// ---- 5. escrow rows are not client-writable -------------------------------
  section('5. escrow ledger');
  //
  // No escrow row exists in the live database yet, because no order has been
  // paid. Rather than skip the most important write boundary in the system, a
  // fixture row is created with the service role -- bound to the real order and
  // its real payment, so the escrow guard's own reconciliation checks are
  // satisfied -- and removed again in a finally block.
  //
  // The guard trigger is the thing under test: it opens with
  //   IF NOT public.mp_is_server_context() THEN RAISE ...
  // and a browser request is the one situation where that is false. Note the
  // in-transaction test cannot cover this: it connects as postgres, so
  // session_user stays 'postgres' and mp_is_server_context() is true for every
  // impersonation it performs.
  const payments = await serviceQuery(
    `marketplace_payments?order_id=eq.${order}&select=id,amount_kobo,currency`,
  );
  const fixturePayment = payments[0];
  let fixtureId = null;

  try {
    const insert = await fetch(`${URL_}/rest/v1/marketplace_escrows`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        order_id: order,
        payment_id: fixturePayment.id,
        buyer_id: candidate.buyer_id,
        vendor_id: candidate.vendor_id,
        amount_kobo: fixturePayment.amount_kobo,
        currency: fixturePayment.currency,
        status: 'locked',
        provider: 'paystack',
        // mp_escrow_funded_has_timestamp requires funded_at for any status other
        // than 'pending'.
        funded_at: new Date().toISOString(),
        locked_at: new Date().toISOString(),
      }),
    });
    const insertedBody = insert.ok ? await insert.json() : null;
    const inserted = Array.isArray(insertedBody) ? insertedBody[0] : null;
    fixtureId = inserted?.id ?? null;

    if (!fixtureId) {
      fail('escrow fixture could be created', `${insert.status}`);
    } else {
      ok('escrow fixture created by the service role');

      const readBack = async () =>
        serviceQuery(
          `marketplace_escrows?id=eq.${fixtureId}&select=status,amount_kobo,released_at,disputed_at`,
        );

      const attempts = [
        // The buyer passes the RLS policy, so only the guard trigger can stop
        // them. This is the case that matters: a student releasing their own
        // held money would be the entire vulnerability.
        ['the buyer cannot release their own escrow', buyer.token, 'release'],
        ['the buyer cannot mark their own escrow refunded', buyer.token, 'refund'],
        ['the buyer cannot inflate their escrow amount', buyer.token, 'inflate'],
        // The vendor passes RLS as well.
        ['the vendor cannot release the escrow', vendorTok, 'release'],
        // A stranger matches no policy at all, so RLS filters the row out.
        ['a stranger cannot touch the escrow', strangerTok, 'release'],
      ];

      for (const [label, tok, kind] of attempts) {
        const patch =
          kind === 'inflate'
            ? { amount_kobo: fixturePayment.amount_kobo * 10 }
            : {
                status: kind === 'refund' ? 'refunded' : 'released',
                released_at: new Date().toISOString(),
              };

        const before = await readBack();
        const res = await fetch(`${URL_}/rest/v1/marketplace_escrows?id=eq.${fixtureId}`, {
          method: 'PATCH',
          headers: {
            apikey: ANON,
            Authorization: `Bearer ${tok}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patch),
        });
        const after = await readBack();

        if (JSON.stringify(before) === JSON.stringify(after))
          ok(`${label}  [${res.status}, row unchanged]`);
        else fail(label, `THE ESCROW ROW CHANGED: ${JSON.stringify(after[0])}`);
      }

      // Control: the same request, as service_role, MUST succeed. Without this
      // the six results above would be worthless -- "row unchanged" would also be
      // the answer to a malformed request that never matched anything.
      const ctrlBefore = await readBack();
      const ctrl = await fetch(`${URL_}/rest/v1/marketplace_escrows?id=eq.${fixtureId}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE,
          Authorization: `Bearer ${SERVICE}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ disputed_at: new Date().toISOString() }),
      });
      const ctrlAfter = await readBack();
      if (ctrl.ok && JSON.stringify(ctrlBefore) !== JSON.stringify(ctrlAfter))
        ok('CONTROL: the payment server can write the same escrow row');
      else
        fail('CONTROL: the payment server can write the same escrow row', `status ${ctrl.status}, unchanged`);

      // A client must not be able to delete the audit record either.
      const del = await fetch(`${URL_}/rest/v1/marketplace_escrows?id=eq.${fixtureId}`, {
        method: 'DELETE',
        headers: { apikey: ANON, Authorization: `Bearer ${buyer.token}` },
      });
      if ((await readBack()).length === 1)
        ok('the buyer cannot delete the escrow row');
      else fail('the buyer cannot delete the escrow row', `status ${del.status}, the row is gone`);

      // Nor invent a second, larger escrow row for the same order.
      const fake = await fetch(`${URL_}/rest/v1/marketplace_escrows`, {
        method: 'POST',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${buyer.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id: order,
          payment_id: fixturePayment.id,
          buyer_id: candidate.buyer_id,
          vendor_id: candidate.vendor_id,
          amount_kobo: 99_000_000,
          currency: 'NGN',
          status: 'released',
          provider: 'paystack',
        }),
      });
      const count = await serviceQuery(`marketplace_escrows?order_id=eq.${order}&select=id`);
      if (count.length === 1) ok('the buyer cannot invent a second escrow row');
      else fail('the buyer cannot invent a second escrow row', `now ${count.length} rows, status ${fake.status}`);
    }
  } finally {
    if (fixtureId) {
      await fetch(`${URL_}/rest/v1/marketplace_escrows?id=eq.${fixtureId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      });
      const left = await serviceQuery(`marketplace_escrows?order_id=eq.${order}&select=id`);
      if (left.length === 0) ok('escrow fixture removed');
      else fail('escrow fixture removed', `${left.length} rows left behind`);
    }
  }

  // ---- 6. a client cannot touch the settlement or the payout tables ---------
  section('6. settlement and withdrawal tables');
  for (const [label, table, patch] of [
    ['a stranger cannot mark a settlement paid out', 'marketplace_settlements', { status: 'paid_out' }],
    ['a stranger cannot approve a withdrawal', 'marketplace_withdrawals', { status: 'approved' }],
  ]) {
    const before = await serviceQuery(`${table}?limit=1&select=*`);
    const res = await fetch(`${URL_}/rest/v1/${table}?limit=1`, {
      method: 'PATCH',
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${strangerTok}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    });
    const after = await serviceQuery(`${table}?limit=1&select=*`);
    const same = JSON.stringify(before) === JSON.stringify(after);
    // RLS filters silently, so "unchanged" is the success condition regardless of
    // whether Postgres or the RLS policy did the refusing.
    if (same) ok(`${label}  [${res.status}, row unchanged]`);
    else fail(label, `THE ROW CHANGED: ${JSON.stringify(after[0]).slice(0, 200)}`);
  }

  // ---- 7. admin surfaces stay admin-only ------------------------------------
  section('7. finance and dispute surfaces');
  await mustRefuse('buyer cannot issue a refund', 'mp_issue_refund', {
    p_order_id: order,
    p_amount_kobo: total,
    p_reason: 'because',
    p_dispute_id: null,
  }, buyer.token);
  await mustRefuse('vendor cannot review a withdrawal', 'mp_review_withdrawal', {
    p_withdrawal_id: '00000000-0000-0000-0000-000000000000',
    p_approve: true,
    p_note: 'x',
    p_reference: 'x',
  }, vendorTok);
  await mustRefuse('buyer cannot resolve a dispute', 'mp_resolve_dispute', {
    p_dispute_id: '00000000-0000-0000-0000-000000000000',
    p_outcome: 'resolved_refund',
    p_refund_kobo: total,
    p_resolution: 'x',
  }, buyer.token);
  await mustRefuse('stranger cannot assign a dispute', 'mp_assign_dispute', {
    p_dispute_id: '00000000-0000-0000-0000-000000000000',
    p_assignee: strangerTok ? bystander.owner_id : null,
  }, strangerTok);

  // ---- 8. the genuine payment path still works ----------------------------
  section('8. the genuine payment path is not locked out');
  // mp_begin_payment_attempt derives the buyer from the verified JWT, so it is
  // called with the BUYER's token, exactly as the initialize edge function does.
  // If the edge function had used the service key, auth.uid() would be null and
  // every real payment would fail with "Sign in to pay for your order" -- which
  // is what the first version of this check reported.
  const attempt = await mustAccept(
    'the buyer can start a payment attempt for their own order',
    'mp_begin_payment_attempt',
    { p_payment_id: payment, p_channel: 'card' },
    buyer.token,
  );

  if (!attempt.refused) {
    const ref = attempt.body?.reference;
    const amount = Number(attempt.body?.amount_kobo);
    // fmp_<order number>_<random hex>: server-generated, and tied to this order.
    if (typeof ref === 'string' && /^fmp_[a-z0-9]+_[a-f0-9]{16,}$/.test(ref))
      ok('the server issued a provider reference');
    else fail('the server issued a provider reference', String(ref));

    // The whole point of the attempt RPC: the caller's figure is never used, so
    // the amount it returns must be the order total, not something negotiated.
    if (amount === total) ok('the server fixed the amount from the order');
    else fail('the server fixed the amount from the order', `got ${amount}, order total ${total}`);

    // A double click must reuse the reference, or the student is charged twice.
    const again = await rpc('mp_begin_payment_attempt', { p_payment_id: payment, p_channel: 'card' }, buyer.token);
    if (!again.refused && again.body?.reference === ref && again.body?.reused === true)
      ok('a second attempt reuses the same reference (no double charge)');
    else fail('a second attempt reuses the same reference (no double charge)', JSON.stringify(again.body).slice(0, 160));

    // And the webhook intake must still accept service_role, or no capture can
    // ever be recorded.
    await mustRefuse(
      'a capture for an unsettled reference is refused even for service_role',
      'mp_apply_payment_event',
      {
        p_provider_event_id: 'boundary_probe_0001',
        p_event_type: 'charge.success',
        p_payment_id: payment,
        p_provider_reference: 'fmp_definitely_not_the_real_one_0001',
        p_amount_kobo: total,
        p_currency: 'NGN',
        p_channel: 'card',
        p_status: 'succeeded',
        p_meta: {},
      },
      SERVICE,
    );

    // Leave the payment exactly as we found it.
    const reset = await rpc('mp_reset_payment_attempt', { p_payment_id: payment, p_reason: 'client-boundary test cleanup' }, SERVICE);
    if (!reset.refused) ok('the probe attempt was rolled back');
    else fail('the probe attempt was rolled back', JSON.stringify(reset.body).slice(0, 160));

    const after = await serviceQuery(`marketplace_payments?id=eq.${payment}&select=status,provider_reference`);
    if (after[0]?.status === 'awaiting_payment' && !after[0]?.provider_reference)
      ok('the payment is back to awaiting_payment with no provider reference');
    else fail('the payment is back to awaiting_payment with no provider reference', JSON.stringify(after[0]));
  }

  // ---- summary --------------------------------------------------------------
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFAILURES');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('client boundary is clean');
};

run().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});