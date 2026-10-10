import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { computeEscrowFeeKobo, DEFAULT_ESCROW_FEE_PARAMS } from '../lib/escrowFee';

/**
 * The escrow protection fee is a buyer-paid charge on the goods subtotal:
 * 1.5% by default, floored at ₦100 and capped at ₦5,000. It must never touch
 * delivery, and it must be computed identically by the client (for display) and
 * by Postgres (for what is actually charged).
 *
 * The behavioural half — that funding, settlement and refund move the fee
 * through the platform wallet correctly — was verified against the live project
 * in a rolled-back transaction (`scripts/verify-escrow-fee.sql`). These
 * assertions keep the formula and the migration wiring from drifting.
 */

const ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

const ENUM_MIGRATION = '20261009135000_marketplace_escrow_fee_entry_types.sql';
const PRICING_MIGRATION = '20261009140000_marketplace_escrow_fee_pricing.sql';
const RELEASE_FIX = '20261009150000_fix_escrow_release_with_escrow_fee.sql';

const enumSql = readFileSync(join(MIGRATIONS, ENUM_MIGRATION), 'utf8');
const pricing = readFileSync(join(MIGRATIONS, PRICING_MIGRATION), 'utf8');
const releaseFix = readFileSync(join(MIGRATIONS, RELEASE_FIX), 'utf8');

/**
 * The exact table required by the product spec. ₦ amounts in, kobo out.
 * The final case is deliberately ambiguous by construction (₦333,333 × 1.5%
 * lands on a half-kobo boundary) so the rounding rule is pinned in one place.
 */
const REQUIRED_CASES: Array<[number, number]> = [
  [0, 0],
  [100_000, 10_000],
  [200_000, 10_000],
  [500_000, 10_000],
  [1_000_000, 15_000],
  [2_000_000, 30_000],
  [10_000_000, 150_000],
  [20_000_000, 300_000],
  [33_333_300, 500_000],
  [50_000_000, 500_000],
  [100_000_000, 500_000],
];

describe('escrow fee formula', () => {
  it.each(REQUIRED_CASES)('charges the documented fee for %i kobo', (subtotal, expected) => {
    expect(computeEscrowFeeKobo(subtotal)).toBe(expected);
  });

  it('never charges a fee on a zero or negative subtotal', () => {
    expect(computeEscrowFeeKobo(0)).toBe(0);
    expect(computeEscrowFeeKobo(-5000)).toBe(0);
  });

  it('honours configurable bounds and rate', () => {
    const params = { bps: 200, minKobo: 50_000, maxKobo: 200_000 };
    expect(computeEscrowFeeKobo(100_000, params)).toBe(50_000); // floor
    expect(computeEscrowFeeKobo(5_000_000, params)).toBe(100_000); // 2%
    expect(computeEscrowFeeKobo(50_000_000, params)).toBe(200_000); // cap
  });

  it('defaults to the live platform values (1.5% / ₦100 / ₦5,000)', () => {
    expect(DEFAULT_ESCROW_FEE_PARAMS).toEqual({ bps: 150, minKobo: 10_000, maxKobo: 500_000 });
  });
});

describe('escrow fee migrations', () => {
  it('adds the ledger entry types in their own migration', () => {
    // Postgres cannot use an enum value in the same transaction that added it,
    // so the enum has to ship separately from the code that writes it.
    const files = readdirSync(MIGRATIONS);
    expect(files).toContain(ENUM_MIGRATION);
    for (const value of ['escrow_fee', 'escrow_fee_recognised', 'escrow_fee_refund']) {
      expect(enumSql).toMatch(new RegExp(`ADD VALUE IF NOT EXISTS '${value}'`));
    }
  });

  it('adds the configurable pricing columns with sane defaults and checks', () => {
    for (const column of [
      'escrow_fee_bps',
      'escrow_fee_min_kobo',
      'escrow_fee_max_kobo',
      'escrow_fee_currency',
      'escrow_enabled',
    ]) {
      expect(pricing).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    }
    expect(pricing).toMatch(/escrow_fee_bps\s+INTEGER NOT NULL DEFAULT 150/);
    expect(pricing).toMatch(/escrow_fee_min_kobo\s+BIGINT\s+NOT NULL DEFAULT 10000/);
    expect(pricing).toMatch(/escrow_fee_max_kobo\s+BIGINT\s+NOT NULL DEFAULT 500000/);
    expect(pricing).toContain('marketplace_platform_settings_escrow_fee_bps_check');
    expect(pricing).toContain('marketplace_platform_settings_escrow_fee_bounds_check');
  });

  it('defines the authoritative clamp as an immutable SQL helper', () => {
    expect(pricing).toMatch(/FUNCTION public\.mp_escrow_fee_for/);
    expect(pricing).toMatch(/LANGUAGE sql\s+IMMUTABLE/);
    expect(pricing).toMatch(/ROUND\(COALESCE\(p_subtotal_kobo, 0\)::NUMERIC/);
    expect(pricing).toMatch(/10000\.0\)/);
    expect(pricing).toMatch(/LEAST\(/);
    expect(pricing).toMatch(/GREATEST\(/);
    // A subtotal at or below zero must short-circuit to zero before the floor.
    expect(pricing).toMatch(/COALESCE\(p_subtotal_kobo, 0\) <= 0/);
  });

  it('charges the fee per order inside mp_create_orders', () => {
    expect(pricing).toMatch(/mp_escrow_fee_for\(/);
    expect(pricing).toMatch(/marketplace_orders[\s\S]*escrow_fee_kobo/);
    // The order total must include the fee or the totals check rejects the row.
    expect(pricing).toMatch(/v_total\s*:=\s*v_sub \+ v_fee \+ v_escrow_fee/);
  });

  it('keeps delivery out of the fee base', () => {
    // The helper only ever receives the merchandise subtotal.
    const calls = [...pricing.matchAll(/mp_escrow_fee_for\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const argument of calls) {
      expect(argument).not.toMatch(/delivery/i);
    }
  });

  it('recognises the fee only at settlement and unwinds it on refund', () => {
    expect(pricing).toMatch(/escrow_fee_recognised/);
    expect(pricing).toMatch(/escrow_fee_refund/);
    expect(pricing).toMatch(/mp_sync_wallet_on_escrow_funded/);
    expect(pricing).toMatch(/mp_sync_wallet_from_settlement/);
  });

  it('fixes the release guard so a fee does not block every release', () => {
    // The pre-fee guard asserted total = net + commission + delivery; once the
    // fee exists that check refuses every legitimate release.
    expect(releaseFix).toMatch(/delivery_fee_kobo \+ v_escrow_fee/);
    expect(releaseFix).toMatch(/mp_guard_escrow_release/);
  });

  it('pins search_path on every security-definer function it rewrites', () => {
    for (const sql of [pricing, releaseFix]) {
      const definers = sql.match(/SECURITY DEFINER/g)?.length ?? 0;
      const pinned = sql.match(/SET search_path/g)?.length ?? 0;
      expect(pinned).toBeGreaterThanOrEqual(definers);
    }
  });

  it('does not expose the write paths to client roles', () => {
    // `mp_create_orders` is reached through `mp_begin_payment_attempt`; it must
    // not be independently callable by an anon or authenticated JWT.
    expect(pricing).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.mp_create_orders/);
    expect(pricing).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.mp_sync_wallet/);
  });
});
