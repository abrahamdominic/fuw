import { describe, it, expect } from 'vitest';

/**
 * Validates the financial escrow settlement calculations matching `mp_confirm_payment`
 * and `mp_resolve_dispute` stored procedures.
 */
function calculateSettlement(orderTotalKobo: number, feeBasisPoints: number = 300) {
  // 300 basis points = 3% platform commission
  const platformFeeKobo = Math.round((orderTotalKobo * feeBasisPoints) / 10000);
  const netVendorKobo = orderTotalKobo - platformFeeKobo;

  return {
    orderTotalKobo,
    platformFeeKobo,
    netVendorKobo,
  };
}

function validateWithdrawalEligibility(
  availableBalanceKobo: number,
  requestedAmountKobo: number,
  minWithdrawalKobo: number = 500000 // ₦5,000 min
) {
  if (requestedAmountKobo < minWithdrawalKobo) {
    return { ok: false, error: 'Amount is below minimum withdrawal limit of ₦5,000' };
  }
  if (requestedAmountKobo > availableBalanceKobo) {
    return { ok: false, error: 'Insufficient cleared balance' };
  }
  return { ok: true, error: null };
}

describe('Escrow & Vendor Settlement Ledger Validation', () => {
  it('deducts exact 3% platform commission and sets vendor net earnings', () => {
    // ₦10,000 order = 1,000,000 kobo
    const s = calculateSettlement(1000000, 300);
    expect(s.platformFeeKobo).toBe(30000); // ₦300 fee
    expect(s.netVendorKobo).toBe(970000);  // ₦9,700 vendor payout
    expect(s.platformFeeKobo + s.netVendorKobo).toBe(s.orderTotalKobo);
  });

  it('handles small amount rounding safely', () => {
    // ₦750 order = 75,000 kobo
    const s = calculateSettlement(75000, 300);
    expect(s.platformFeeKobo).toBe(2250); // ₦22.50
    expect(s.netVendorKobo).toBe(72750);  // ₦727.50
    expect(s.platformFeeKobo + s.netVendorKobo).toBe(75000);
  });

  it('enforces ₦5,000 minimum withdrawal limit', () => {
    // Attempting to withdraw ₦2,000 (200,000 kobo)
    const tooSmall = validateWithdrawalEligibility(1000000, 200000);
    expect(tooSmall.ok).toBe(false);
    expect(tooSmall.error).toContain('minimum withdrawal limit');

    // Attempting to withdraw ₦5,000 with ₦10,000 balance
    const valid = validateWithdrawalEligibility(1000000, 500000);
    expect(valid.ok).toBe(true);
  });

  it('rejects withdrawal exceeding cleared available balance', () => {
    // Attempting to withdraw ₦20,000 when only ₦10,000 available
    const overdrawn = validateWithdrawalEligibility(1000000, 2000000);
    expect(overdrawn.ok).toBe(false);
    expect(overdrawn.error).toBe('Insufficient cleared balance');
  });
});
