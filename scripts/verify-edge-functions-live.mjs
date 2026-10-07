#!/usr/bin/env node
/**
 * Live smoke test for the deployed marketplace Paystack edge functions.
 *
 * Read-only against payments: it never marks anything paid. It checks that the
 * functions are reachable, that CORS is limited to the allow-list, that an
 * unauthenticated caller is rejected, that a malformed reference is rejected,
 * that another user's payment cannot be checked, and that the webhook refuses
 * an unsigned body.
 *
 * Requires PAYSTACK_SECRET_KEY only to report whether card payments are live.
 * With no secret the functions are expected to answer 503, which this treats as
 * a pass for the "not configured" case and reports plainly.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

for (const file of ['.env']) {
  const envPath = path.join(REPO_ROOT, file);
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of [['SUPABASE_URL', URL_], ['SUPABASE_ANON_KEY', ANON], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE]]) {
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(2);
  }
}

const FN_BASE = `${URL_}/functions/v1`;
const ALLOWED_ORIGIN = 'http://localhost:5173';
const DENIED_ORIGIN = 'https://evil.example.com';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? `  [${detail}]` : ''}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? `  [${detail}]` : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/**
 * Detect whether the *deployed* functions have PAYSTACK_SECRET_KEY configured.
 *
 * The secret only exists inside Supabase's secret store and is never readable
 * (the CLI exposes digests only), so a local `process.env` check is useless —
 * it reported "NOT SET" even while the functions were correctly configured.
 *
 * Instead, probe the running function. `config()` short-circuits in a fixed
 * order: missing secret -> 503 "Card payments are not configured yet",
 * otherwise the anonymous request is rejected with 401. So the status code
 * alone reports the real server-side state without handling the secret.
 */
async function probeSecretConfigured() {
  const res = await post('marketplace-paystack-initialize', { paymentId: crypto.randomUUID() });
  return {
    configured: res.status !== 503,
    status: res.status,
    error: res.json?.error ?? null
  };
}

let SECRET_SET = false;

async function post(fn, body, { token, origin } = {}) {
  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, acao: res.headers.get('access-control-allow-origin') };
}

/** Mint a real session for an existing user via the admin magiclink endpoint. */
async function signIn(email) {
  const link = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!link.ok) throw new Error(`generate_link ${link.status}: ${await link.text()}`);
  const payload = await link.json();
  const hashed = payload.hashed_token ?? payload.properties?.hashed_token;
  if (!hashed) throw new Error('no hashed_token in generate_link response');

  // `redirect: 'manual'` keeps the token in the Location fragment instead of
  // following it away, which is why this reads the fragment rather than JSON.
  const verify = await fetch(
    `${URL_}/auth/v1/verify?type=magiclink&token=${encodeURIComponent(hashed)}`,
    { headers: { apikey: ANON }, redirect: 'manual' }
  );
  const raw = await verify.text();
  const location = verify.headers.get('location') ?? '';
  const token =
    raw.match(/"access_token"\s*:\s*"([^"]+)"/)?.[1] ??
    raw.match(/#access_token=([A-Za-z0-9._-]+)/)?.[1] ??
    location.match(/#access_token=([A-Za-z0-9._-]+)/)?.[1];
  if (!token) {
    throw new Error(
      `could not mint a token for ${email} (${verify.status}): ${raw.slice(0, 200) || location.slice(0, 200)}`
    );
  }
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return { token, userId: claims.sub };
}

async function pickPair() {
  const res = await fetch(
    `${URL_}/rest/v1/marketplace_payments?select=id,buyer_id,order_id,status,provider_reference&status=eq.awaiting_payment&limit=50`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  if (!res.ok) throw new Error(`payment lookup ${res.status}`);
  const rows = await res.json();

  const emails = await fetch(
    `${URL_}/rest/v1/profiles?select=id,email&limit=200`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const profiles = await emails.json();
  const emailById = new Map(profiles.map((p) => [p.id, p.email]));

  for (const row of rows) {
    const ownerEmail = emailById.get(row.buyer_id);
    const otherEmail = emailById.get(
      profiles.find((p) => p.id !== row.buyer_id && p.email)?.id
    );
    if (ownerEmail && otherEmail) {
      return { row, ownerEmail, otherEmail };
    }
  }
  return null;
}

async function pickCardPayment() {
  const res = await fetch(
    `${URL_}/rest/v1/marketplace_payments?select=id,buyer_id,order_id,amount_kobo,provider,provider_reference,order:marketplace_orders!marketplace_payments_order_id_fkey(id,status)&status=eq.awaiting_payment&provider=eq.paystack&limit=50`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  if (!res.ok) throw new Error(`payment lookup ${res.status}`);
  const rows = await res.json();
  const profiles = await (
    await fetch(`${URL_}/rest/v1/profiles?select=id,email&limit=200`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
  ).json();
  const emailById = new Map(profiles.map((p) => [p.id, p.email]));
  for (const row of rows) {
    if (row.order?.status !== 'pending_payment') continue;
    const ownerEmail = emailById.get(row.buyer_id);
    if (ownerEmail) return { row, ownerEmail };
  }
  return null;
}

section('configuration');
const probe = await probeSecretConfigured();
SECRET_SET = probe.configured;
console.log(`PAYSTACK_SECRET_KEY: ${SECRET_SET ? 'present (probed)' : 'NOT SET (probed)'}`);
console.log(`  probe: initialize -> ${probe.status} ${JSON.stringify(probe.error)}`);
if (!SECRET_SET) {
  console.log(
    'Card checkout will answer 503 "Card payments are not configured yet".\n' +
    'This is the intended honest failure: no secret means no charge can be made.'
  );
}

section('CORS is limited to the allow-list');
for (const fn of ['marketplace-paystack-initialize', 'marketplace-paystack-verify', 'marketplace-paystack-webhook']) {
  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  });
  const acao = res.headers.get('access-control-allow-origin');
  check(
    `${fn} allows the configured origin`,
    acao === ALLOWED_ORIGIN,
    `status ${res.status}, ACAO ${JSON.stringify(acao)}`
  );
}

for (const fn of ['marketplace-paystack-initialize', 'marketplace-paystack-verify', 'marketplace-paystack-webhook']) {
  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: 'OPTIONS',
    headers: { Origin: DENIED_ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  const acao = res.headers.get('access-control-allow-origin');
  check(`${fn} refuses an unknown origin`, acao === null, `ACAO ${JSON.stringify(acao)}`);
}

section('unauthenticated callers are rejected');
{
  const res = await post('marketplace-paystack-initialize', { paymentId: crypto.randomUUID() });
  const refused = res.status === 401 || res.status === 503;
  check('initialize refuses an anonymous caller', refused, `status ${res.status}`);
  check(
    'initialize never returns an authorization URL',
    typeof res.json?.authorization_url !== 'string',
    JSON.stringify(res.json).slice(0, 80)
  );
}

{
  const res = await post('marketplace-paystack-verify', {
    paymentId: crypto.randomUUID(),
    reference: `fmp_card_${'0'.repeat(18)}`,
  });
  const refused = res.status === 401 || res.status === 503;
  check('verify refuses an anonymous caller', refused, `status ${res.status}`);
}

section('the webhook cannot be forged');
{
  const forged = JSON.stringify({
    event: 'charge.success',
    data: { reference: `fmp_card_${'1'.repeat(18)}`, id: 1, status: 'success' },
  });
  const res = await fetch(`${FN_BASE}/marketplace-paystack-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      'x-paystack-signature': 'a'.repeat(128),
    },
    body: forged,
  });
  const json = await res.json().catch(() => null);
  check(
    'an invalid HMAC signature is rejected',
    res.status === 401 || res.status === 503,
    `status ${res.status} ${JSON.stringify(json).slice(0, 60)}`
  );
}

{
  const unsigned = await fetch(`${FN_BASE}/marketplace-paystack-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ event: 'charge.success', data: { reference: 'fmp_x_' + '2'.repeat(18) } }),
  });
  const json = await unsigned.json().catch(() => null);
  check(
    'a missing signature is rejected',
    unsigned.status === 401 || unsigned.status === 503,
    `status ${unsigned.status}`
  );
}

section('ownership and input validation with a real session');
if (!SECRET_SET) {
  // config() deliberately refuses before touching auth or the database, so with
  // no secret every request is a 503 and the checks below cannot be evaluated.
  // Asserting on them here would be asserting on the wrong code path.
  console.log(
    '  SKIP  ownership and reference validation are not exercised until\n' +
    '        PAYSTACK_SECRET_KEY is set: without it the functions answer 503\n' +
    '        before authenticating anyone. Set the secret and re-run to cover\n' +
    '        these seven checks.'
  );
} else {
const pair = await pickPair();
if (!pair) {
  console.log('  SKIP  no suitable buyer pair found to test ownership');
} else {
  const { row, ownerEmail, otherEmail } = pair;
  const owner = await signIn(ownerEmail);
  const stranger = await signIn(otherEmail);

  check('the owner session was minted', Boolean(owner.token));
  check('the stranger session was minted', Boolean(stranger.token));

  {
    const res = await post('marketplace-paystack-verify', {
      paymentId: row.id,
      reference: `fmp_card_${'3'.repeat(18)}`,
    }, { token: stranger.token });
    check(
      "a stranger cannot check someone else's payment",
      res.status === 403,
      `status ${res.status}`
    );
  }

  {
    const res = await post('marketplace-paystack-verify', {
      paymentId: row.id,
      reference: 'not-a-marketplace-reference',
    }, { token: owner.token });
    check(
      'a reference in the wrong shape is refused',
      res.status === 400,
      `status ${res.status}`
    );
  }

  {
    const res = await post('marketplace-paystack-verify', {
      paymentId: 'not-a-uuid',
      reference: `fmp_card_${'4'.repeat(18)}`,
    }, { token: owner.token });
    check('a malformed payment id is refused', res.status === 400, `status ${res.status}`);
  }

  {
    // No payment may be reported as paid unless the provider agrees. The
    // honest outcomes are deliberately wide:
    //   200 + applied:false -> provider consulted, nothing to apply
    //   409 / 502          -> already settled, or provider unreachable
    //   403                -> the presented reference is not this order's,
    //                         which is the correct answer whenever the stored
    //                         provider_reference is NULL (an uninitialised
    //                         payment) and the caller presents a guess
    //   400                -> the reference failed shape validation
    // Anything reporting a succeeded payment without provider agreement is a
    // failure, and so is any 2xx that claims success.
    const res = await post(
      'marketplace-paystack-verify',
      { paymentId: row.id, reference: row.provider_reference ?? `fmp_card_${'5'.repeat(18)}` },
      { token: owner.token }
    );
    const honest =
      res.status === 502 ||
      res.status === 409 ||
      res.status === 403 ||
      res.status === 400 ||
      (res.status === 200 && res.json?.applied === false);
    check(
      'an unverifiable payment is never reported as paid',
      honest,
      `status ${res.status} applied=${res.json?.applied} error=${JSON.stringify(res.json?.error ?? null)}`
    );
  }
}
}

section('a real provider checkout opens');
if (!SECRET_SET) {
  console.log('  SKIP  no PAYSTACK_SECRET_KEY, so no checkout can be opened');
} else {
  const card = await pickCardPayment();
  if (!card) {
    console.log('  SKIP  no awaiting_payment paystack row to initialize');
  } else {
    const { row, ownerEmail } = card;
    const owner = await signIn(ownerEmail);

    const res = await post(
      'marketplace-paystack-initialize',
      // The client also volunteers a bogus amount/reference. Both must be ignored:
      // mp_begin_payment_attempt re-derives them from the order total.
      { paymentId: row.id, channel: 'card', amount_kobo: 1, reference: 'fmp_card_client_supplied' },
      { token: owner.token }
    );

    const url = res.json?.authorization_url;
    check(
      'initialize opens a genuine Paystack checkout',
      res.status === 200 &&
        typeof url === 'string' &&
        url.startsWith('https://checkout.paystack.com/'),
      `status ${res.status} error=${JSON.stringify(res.json?.error ?? null)}`
    );

    if (res.status === 200) {
      check(
        'the server-derived amount is returned, not the client-supplied one',
        res.json?.amount_kobo === Number(row.amount_kobo),
        `server=${res.json?.amount_kobo} expected=${row.amount_kobo}`
      );
      check(
        'the reference is server-generated, not the client string',
        res.json?.reference !== 'fmp_card_client_supplied' &&
          typeof res.json?.reference === 'string' &&
          res.json.reference.startsWith('fmp_'),
        `reference=${JSON.stringify(res.json?.reference)}`
      );
    }

    // Opening a checkout must never move the order to paid. Only the signed
    // webhook or a provider-confirmed verification may do that.
    const after = await fetch(
      `${URL_}/rest/v1/marketplace_payments?id=eq.${row.id}&select=status,provider_reference`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    );
    const state = (await after.json())?.[0];
    check(
      'opening a checkout does not mark the payment succeeded',
      state?.status !== 'succeeded',
      `status=${state?.status}`
    );

    // Regression guard. Clicking "Pay" twice used to fail on the second click
    // and, worse, clear provider_reference. The webhook reconciles strictly by
    // provider_reference, so clearing it after the provider had already issued
    // a charge left a genuinely paid order permanently unreconcilable.
    // The reference must therefore survive a refused retry.
    const second = await post(
      'marketplace-paystack-initialize',
      { paymentId: row.id, channel: 'card' },
      { token: owner.token }
    );
    const afterSecond = await fetch(
      `${URL_}/rest/v1/marketplace_payments?id=eq.${row.id}&select=status,provider_reference`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    );
    const state2 = (await afterSecond.json())?.[0];

    check(
      'a refused retry never orphans the provider reference',
      typeof state2?.provider_reference === 'string' &&
        state2.provider_reference === state?.provider_reference,
      `before=${state?.provider_reference ?? 'NULL'} after=${state2?.provider_reference ?? 'NULL'} retry_status=${second.status}`
    );

    check(
      'a refused retry reports the checkout as already open',
      second.status === 409 || second.status === 200,
      `status ${second.status} ${JSON.stringify(second.json?.error ?? null)}`
    );

    // Restore the fixture so this section is repeatable. mp_reset_payment_attempt
    // is server-only, but mp_is_server_context() accepts service_role, which is
    // what this script authenticates with. The Paystack transactions created
    // here are test-mode and were never paid, so nothing real is discarded.
    const reset = await fetch(
      `${URL_}/rest/v1/rpc/mp_reset_payment_attempt`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SERVICE,
          Authorization: `Bearer ${SERVICE}`,
        },
        body: JSON.stringify({
          p_payment_id: row.id,
          p_reason: 'live smoke test fixture reset',
        }),
      }
    );
    check(
      'the fixture is restored for the next run',
      reset.ok,
      `status ${reset.status} ${(await reset.text()).slice(0, 120)}`
    );
  }
}

section('no live data was written');
{
  const before = await fetch(
    `${URL_}/rest/v1/marketplace_payments?select=status&status=eq.succeeded`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const succeeded = await before.json();
  const escrows = await fetch(
    `${URL_}/rest/v1/marketplace_escrows?select=id`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const escrowRows = await escrows.json();
  check('no payment was marked succeeded', succeeded.length === 0, `count ${succeeded.length}`);
  check('no escrow was created', escrowRows.length === 0, `count ${escrowRows.length}`);
}

console.log(`\n======================================================================`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('edge function smoke test FAILED');
  process.exit(1);
}
console.log('edge function smoke test passed');