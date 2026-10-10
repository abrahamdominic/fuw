import { describe, it, expect } from 'vitest';
import {
  annualRentKobo,
  advertFeeKobo,
  previewAdvertFee,
  koboToNaira
} from '../lib/advertFee';

/**
 * The advertisement fee is money the platform holds against a listing, so the
 * arithmetic is pinned here in both directions:
 *
 *  - the annualisation (a monthly rent is multiplied by 12, a semester rent by
 *    2) because guessing the wrong basis silently over- or under-charges;
 *  - the rounding (nearest whole naira) because student rents produce fractions
 *    that must not accumulate into kobo dust;
 *  - an unknown period returns null instead of defaulting to a wrong answer.
 *
 * The expected figures below are the exact values verified against the SQL
 * functions on the production database.
 */
describe('accommodation advert fee', () => {
  describe('annualRentKobo', () => {
    it('treats an annual rent as-is', () => {
      expect(annualRentKobo(10_000_000, 'annual')).toBe(10_000_000); // ₦100,000
    });

    it('doubles a semester rent', () => {
      expect(annualRentKobo(12_500_000, 'semester')).toBe(25_000_000); // ₦125,000 -> ₦250,000
    });

    it('multiplies a monthly rent by twelve', () => {
      expect(annualRentKobo(2_500_000, 'monthly')).toBe(30_000_000); // ₦25,000 -> ₦300,000
    });

    it('is case- and whitespace-insensitive', () => {
      expect(annualRentKobo(2_500_000, '  Monthly ')).toBe(30_000_000);
    });

    it('returns null for an unknown or empty period rather than guessing', () => {
      expect(annualRentKobo(2_500_000, 'weekly')).toBeNull();
      expect(annualRentKobo(2_500_000, '')).toBeNull();
      expect(annualRentKobo(2_500_000, null)).toBeNull();
    });

    it('returns null for a missing amount', () => {
      expect(annualRentKobo(null, 'annual')).toBeNull();
      expect(annualRentKobo(undefined, 'annual')).toBeNull();
    });
  });

  describe('advertFeeKobo at 150 bps (1.5%)', () => {
    const cases: Array<[number, number]> = [
      [10_000_000, 150_000], // ₦100,000 -> ₦1,500
      [15_000_000, 225_000], // ₦150,000 -> ₦2,250
      [20_000_000, 300_000], // ₦200,000 -> ₦3,000
      [30_000_000, 450_000], // ₦300,000 -> ₦4,500
      [50_000_000, 750_000], // ₦500,000 -> ₦7,500
      [100_000_000, 1_500_000] // ₦1,000,000 -> ₦15,000
    ];

    it.each(cases)('charges 1.5%% of %i kobo', (annualKobo, expectedFeeKobo) => {
      expect(advertFeeKobo(annualKobo, 150)).toBe(expectedFeeKobo);
    });

    it('charges nothing when the rent or the rate is zero', () => {
      expect(advertFeeKobo(0, 150)).toBe(0);
      expect(advertFeeKobo(50_000_000, 0)).toBe(0);
    });

    it('rounds to the nearest whole naira', () => {
      // 1.5% of ₦1,333.33 (133,333 kobo) = 1,999.995 kobo -> ₦20 (2,000 kobo)
      expect(advertFeeKobo(133_333, 150)).toBe(2_000);
    });
  });

  describe('previewAdvertFee', () => {
    it('annualises a monthly rent before charging', () => {
      // ₦25,000/month => ₦300,000/year => ₦4,500 fee
      expect(previewAdvertFee(2_500_000, 'monthly', 150)).toEqual({
        annualKobo: 30_000_000,
        feeKobo: 450_000,
        feeBps: 150
      });
    });

    it('returns null when the form is incomplete', () => {
      expect(previewAdvertFee(0, 'annual', 150)).toBeNull();
      expect(previewAdvertFee(null, 'annual', 150)).toBeNull();
      expect(previewAdvertFee(2_500_000, 'weekly', 150)).toBeNull();
    });
  });

  it('exposes a naira view for display', () => {
    expect(koboToNaira(450_000)).toBe(4_500);
  });
});
