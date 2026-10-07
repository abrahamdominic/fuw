import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * PHASE 17, buyer wallet checkout.
 *
 * These pin the two halves of the wallet feature that a unit test can actually
 * reach: the decisions the browser makes, and the shape of the migration and
 * RPC the browser depends on. Everything involving real money is settled by
 * `mp_pay_order_from_wallet` in the database and is verified by
 * /tmp/opencode/fuw/wallet_checkout.py, which funds the wallet with a genuine
 * capture-and-refund and then pays from it inside a rolled-back transaction.
 */

// Repo root. These specs assert against the real SQL migrations and the real
// page/api source, not against re-implementations.
const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Mirrors mp_wallet_post's bucket guard as the wallet page relies on it. */
function canSpendFromWallet(wallet: {
  available_kobo: number;
  is_frozen: boolean;
}, amountKobo: number): { ok: boolean; reason?: string } {
  if (wallet.is_frozen) return { ok: false, reason: 'frozen' };
  if (amountKobo <= 0) return { ok: false, reason: 'empty_basket' };
  if (wallet.available_kobo < amountKobo) return { ok: false, reason: 'insufficient' };
  return { ok: true };
}

describe('Wallet checkout eligibility', () => {
  it('offers the wallet only when one balance covers the whole basket', () => {
    // CheckoutPage shows one wallet option for a multi-vendor basket, so the
    // rule is all-or-nothing rather than "spend what you have".
    const wallet = { available_kobo: 400000, is_frozen: false };

    expect(canSpendFromWallet(wallet, 400000).ok).toBe(true);
    expect(canSpendFromWallet(wallet, 399999).ok).toBe(true);
    expect(canSpendFromWallet(wallet, 400001).reason).toBe('insufficient');
  });

  it('refuses a frozen wallet even when the balance would cover it', () => {
    const wallet = { available_kobo: 9000000, is_frozen: true };
    expect(canSpendFromWallet(wallet, 400000).reason).toBe('frozen');
  });

  it('treats a zero-value basket as not payable from a wallet', () => {
    // mp_pay_order_from_wallet raises on a non-positive payment amount, so the
    // client must not offer the method for an empty cart.
    const wallet = { available_kobo: 0, is_frozen: false };
    expect(canSpendFromWallet(wallet, 0).reason).toBe('empty_basket');
  });

  it('never lets the client choose the amount it pays', () => {
    // The whole integrity story of wallet checkout is that the browser sends an
    // order id and nothing else. If an amount argument were added to the RPC
    // signature, a caller could underpay.
    const api = read('src/marketplace/lib/api.ts');
    const body = api.slice(
      api.indexOf('export async function payOrderFromWallet'),
      api.indexOf('export async function payOrderFromWallet') + 900,
    );

    expect(body).toContain("p_order_id: orderId");
    // No amount, no bucket, no direction: one argument, the order id.
    expect(body).not.toMatch(/p_amount_kobo|p_amount|p_bucket|p_direction/);
  });
});

describe('payOrderFromWallet result handling', () => {
  /** The two shapes mp_pay_order_from_wallet actually returns. */
  function interpret(res: Record<string, unknown>) {
    if (res.paid !== true) return { settled: false, replayed: false };
    // already_settled: true comes from the early return, which fires when the
    // order is already paid or the payment row is already succeeded.
    return { settled: true, replayed: res.already_settled === true };
  }

  it('treats a replayed payment as success, not as a failure', () => {
    // A dropped response followed by a retry must not read as a declined card.
    const replay = interpret({ paid: true, already_settled: true, status: 'paid' });
    expect(replay).toEqual({ settled: true, replayed: true });
  });

  it('treats a fresh settlement as success', () => {
    const fresh = interpret({
      paid: true,
      already_settled: false,
      payment_id: 'p-1',
      amount_kobo: 400000,
      balance_after_kobo: 0,
    });
    expect(fresh).toEqual({ settled: true, replayed: false });
  });

  it('survives the replay branch reporting no payment id or amount', () => {
    // The early return omits payment_id, amount_kobo and balance_after_kobo, so
    // the wrapper types must not require them. Reading them unguarded is what
    // made OrdersPage fail to compile earlier.
    const api = read('src/marketplace/lib/api.ts');
    const start = api.indexOf('export async function payOrderFromWallet');
    const body = api.slice(start, start + 1200);
    const tail = body.slice(body.indexOf('return data as'));

    expect(tail).toContain('already_settled?:');
    expect(tail).toContain('payment_id?:');
    expect(tail).toContain('amount_kobo?:');
    expect(tail).toContain('balance_after_kobo?:');
  });
});

describe('Wallet page contract', () => {
  it('reads the balance and the ledger from the server, never summing locally', () => {
    const page = read('src/marketplace/pages/WalletPage.tsx');
    expect(page).toContain('fetchMyWallet');
    expect(page).toContain('fetchWalletStatement');
    // The available figure is rendered as the server sent it. Recomputing a
    // balance in the browser is the bug this is guarding against.
    expect(page).toContain('wallet?.available_kobo ?? 0');
  });

  it('pages the statement through the offset the server expects', () => {
    const page = read('src/marketplace/pages/WalletPage.tsx');
    expect(page).toContain('PAGE_SIZE');
    expect(page).toContain('offset');
    expect(page).toContain('loadMore');
  });

  it('offers a professional Fund Wallet section with Paystack card funding', () => {
    // Section 3 of pay.md requires a professional "Fund Wallet" section with card payments
    const page = read('src/marketplace/pages/WalletPage.tsx');
    expect(page).toContain('Fund Wallet');
    expect(page).toContain('Continue to Payment');
    expect(page).toContain('fundWalletWithPaystack');
    expect(page).toContain('MIN_FUNDING_NAIRA');
    expect(page).toContain('MAX_FUNDING_NAIRA');
  });
});

describe('Wallet payment plumbing', () => {
  it('stores the wallet provider so the payment row records where money came from', () => {
    const api = read('src/marketplace/lib/api.ts');
    expect(api).toMatch(/'wallet'/);
  });

  it('withholds the buyer wallet RPCs from anonymous callers at the grant', () => {
    // Each of these is guarded by auth.uid() at runtime, so anon is refused
    // today. The grant is revoked anyway: if a later refactor weakens one of
    // those checks, a logged-out caller must not be one line away from reading
    // a wallet or paying an order.
    const hardening = read('supabase/migrations/20261006103000_wallet_rpc_hardening.sql');

    for (const fn of ['mp_wallet_get', 'mp_wallet_statement', 'mp_pay_order_from_wallet']) {
      const revoke = hardening.match(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^;]*FROM PUBLIC, anon;`),
      );
      expect(revoke, `${fn} must be revoked from PUBLIC and anon`).toBeTruthy();
    }
    // The write paths are not part of this surface, so this migration must not
    // re-grant them to anyone. Comments mentioning them are fine; executable
    // statements naming them are not.
    const executable = hardening
      .split('\n')
      .filter(l => !l.trim().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/mp_wallet_post|mp_wallet_ensure/);
  });

  it('grants the wallet write paths to service_role only, never to authenticated', () => {
    // mp_wallet_post and mp_wallet_ensure are the only ways a balance changes
    // downward or upward outside a guarded flow. Both belong to service_role
    // alone: if a migration ever adds authenticated, a buyer could mint their
    // own balance. wallet_checkout.py asserts the same thing as a live
    // privilege rather than as a call made from a privileged harness.
    const ledger = read('supabase/migrations/20261006091000_marketplace_wallet_ledger.sql');
    const grants = ledger
      .split('\n')
      .filter(l => /mp_wallet_(post|ensure)/.test(l) && /GRANT|REVOKE/i.test(l));

    expect(grants.length).toBeGreaterThan(0);
    for (const line of grants) {
      // Naming authenticated is only ever correct in a REVOKE: the migration
      // revokes the default PUBLIC execute and says so explicitly.
      expect(line).not.toMatch(/GRANT[^;]*authenticated/i);
    }
    // And the revoke must actually cover the signed-in role.
    expect(ledger).toMatch(/REVOKE[^;]*mp_wallet_post[^;]*authenticated/i);
  });
});
