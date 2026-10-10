/**
 * Client-side mirror of the authoritative escrow-fee formula.
 *
 * The only source of truth is `public.mp_escrow_fee_for` in the database; the
 * amount actually charged is recomputed server-side inside `mp_create_orders`.
 * This helper exists purely so checkout can show an estimate before the
 * `mp_preview_checkout_escrow` round-trip resolves (and if it fails), keeping the
 * screen honest instead of flashing a stale hard-coded figure.
 *
 * Formula: `clamp(round(subtotal * bps / 10000), min, max)`, with a zero
 * subtotal yielding zero. Matches Postgres `round()` for non-negative values.
 */

export interface EscrowFeeParams {
  /** Fee in basis points (1.5% = 150). */
  bps: number;
  /** Floor in kobo. */
  minKobo: number;
  /** Cap in kobo. */
  maxKobo: number;
}

export const DEFAULT_ESCROW_FEE_PARAMS: EscrowFeeParams = {
  bps: 150,
  minKobo: 10000,
  maxKobo: 500000,
};

export function computeEscrowFeeKobo(subtotalKobo: number, params: EscrowFeeParams = DEFAULT_ESCROW_FEE_PARAMS): number {
  if (!Number.isFinite(subtotalKobo) || subtotalKobo <= 0) return 0;
  const { bps, minKobo, maxKobo } = params;
  const raw = Math.round((subtotalKobo * bps) / 10000);
  return Math.min(Math.max(raw, minKobo), maxKobo);
}
