// Advertisement fee maths — the client-side mirror of the SQL helpers
// `public.acc_annual_rent_kobo` and `public.acc_advert_fee_kobo`.
//
// These functions exist so the listing form can show the fee before anything is
// submitted. The server never trusts a client-supplied amount: it recomputes the
// fee with the same formulas inside `acc_submit_advert`, so this file is a
// display convenience, not an authority. Any change here MUST be mirrored in the
// migration, and `advertFee.test.ts` pins both the annualisation and the
// rounding.

export type RentPeriod = 'annual' | 'semester' | 'monthly';

/** How many semesters or months make a year. Kept as a plain map so the SQL
 *  CASE expression and this one can be read side by side. */
const PERIOD_MULTIPLIER: Record<RentPeriod, number> = {
  annual: 1,
  semester: 2,
  monthly: 12
};

/**
 * Convert an advertised rent for one period into an annual figure in kobo.
 *
 * Returns `null` for an unknown or empty period so the caller can require the
 * user to choose a valid period rather than silently guessing (a wrong guess
 * would under- or over-charge the fee).
 */
export function annualRentKobo(
  amountKobo: number | null | undefined,
  period: string | null | undefined
): number | null {
  if (amountKobo === null || amountKobo === undefined || !Number.isFinite(amountKobo)) return null;
  const key = (period ?? '').trim().toLowerCase() as RentPeriod;
  const multiplier = PERIOD_MULTIPLIER[key];
  if (!multiplier) return null;
  return Math.trunc(amountKobo) * multiplier;
}

/**
 * The advertisement fee: `bps` basis points of the annual rent, rounded to the
 * nearest whole naira (100 kobo). Zero rent or a zero rate yields zero. No
 * hidden floor, cap, tax or processing charge is added.
 */
export function advertFeeKobo(
  annualRentKoboAmount: number | null | undefined,
  bps: number | null | undefined
): number {
  const annual = Math.trunc(annualRentKoboAmount ?? 0);
  const rate = Math.trunc(bps ?? 0);
  if (annual <= 0 || rate <= 0) return 0;
  // round to the nearest naira, then back to kobo, matching the SQL
  // `round(x * bps / 10000 / 100) * 100`.
  return Math.round((annual * rate) / 10000 / 100) * 100;
}

export interface AdvertFeePreview {
  /** Annualised rent the fee was computed from, in kobo. */
  annualKobo: number;
  /** The fee in kobo. */
  feeKobo: number;
  /** The rate used, in basis points. */
  feeBps: number;
}

/**
 * Full preview for the listing form. Returns `null` when the period is missing
 * or the amount is not a positive number of kobo, so the UI can prompt instead
 * of showing "₦0".
 */
export function previewAdvertFee(
  amountKobo: number | null | undefined,
  period: string | null | undefined,
  feeBps: number
): AdvertFeePreview | null {
  if (amountKobo === null || amountKobo === undefined || amountKobo <= 0) return null;
  const annualKobo = annualRentKobo(amountKobo, period);
  if (annualKobo === null || annualKobo <= 0) return null;
  return { annualKobo, feeKobo: advertFeeKobo(annualKobo, feeBps), feeBps };
}

/** Naira (not kobo) for a kobo integer, formatted for display. */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** Format a kobo amount as a whole-naira currency string (no kobo shown). */
export function formatKoboAsNaira(kobo: number, currency = 'NGN'): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(koboToNaira(kobo));
}
