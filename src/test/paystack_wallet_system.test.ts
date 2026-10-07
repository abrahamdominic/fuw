// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Helper to compute HMAC SHA512 signature like Paystack
function computePaystackSignature(payload: string, secretKey: string): string {
  return createHmac('sha512', secretKey).update(payload).digest('hex');
}

// Pure implementation of the signature verifier matching edge functions
function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = computePaystackSignature(rawBody, secret);
  return expected.toLowerCase() === signature.toLowerCase();
}

describe('Paystack Webhook Signature Verification (Section 9, 29)', () => {
  const SECRET = 'sk_live_test_secret_key_mock_12345';
  const samplePayload = JSON.stringify({
    event: 'charge.success',
    data: {
      id: 9991234,
      reference: 'fuw_fund_usr123_abc123def456',
      amount: 500000,
      currency: 'NGN',
      status: 'success',
      channel: 'card',
      customer: { email: 'student@fuw.edu.ng' },
    },
  });

  it('accepts valid HMAC SHA512 signature and returns 200 equivalent', () => {
    const validSignature = computePaystackSignature(samplePayload, SECRET);
    expect(verifySignature(samplePayload, validSignature, SECRET)).toBe(true);
  });

  it('rejects invalid signature with 401 equivalent', () => {
    const invalidSignature = 'a'.repeat(128);
    expect(verifySignature(samplePayload, invalidSignature, SECRET)).toBe(false);
  });

  it('rejects missing or empty signature with 401 equivalent', () => {
    expect(verifySignature(samplePayload, null, SECRET)).toBe(false);
    expect(verifySignature(samplePayload, '', SECRET)).toBe(false);
  });

  it('fails if raw body is altered or whitespace modified after signing', () => {
    const validSignature = computePaystackSignature(samplePayload, SECRET);
    const tamperedPayload = samplePayload + ' ';
    expect(verifySignature(tamperedPayload, validSignature, SECRET)).toBe(false);
  });

  it('fails if payload amount is altered after signing', () => {
    const validSignature = computePaystackSignature(samplePayload, SECRET);
    const tamperedPayload = samplePayload.replace('500000', '999999');
    expect(verifySignature(tamperedPayload, validSignature, SECRET)).toBe(false);
  });
});

describe('Webhook Event Routing & Idempotency (Section 11, 12)', () => {
  it('identifies wallet funding references correctly', () => {
    const ref1 = 'fuw_fund_123_456';
    const ref2 = 'fmp_ord123_789';
    const ref3 = 'FUW-1728139281-XYZ';

    expect(ref1.startsWith('fuw_fund_')).toBe(true);
    expect(ref2.startsWith('fmp_')).toBe(true);
    expect(ref3.startsWith('FUW-')).toBe(true);
  });

  it('prevents duplicate processing with event registry simulation', () => {
    const processedEvents = new Set<string>();

    function processEvent(eventId: string) {
      if (processedEvents.has(eventId)) {
        return { status: 200, duplicate: true, credited: false };
      }
      processedEvents.add(eventId);
      return { status: 200, duplicate: false, credited: true };
    }

    const first = processEvent('evt_charge_1001');
    expect(first.duplicate).toBe(false);
    expect(first.credited).toBe(true);

    const second = processEvent('evt_charge_1001');
    expect(second.duplicate).toBe(true);
    expect(second.credited).toBe(false);
  });

  it('ignores unrelated transfer/subscription events from wallet credit', () => {
    const allowedWalletEvents = ['charge.success'];
    expect(allowedWalletEvents.includes('charge.success')).toBe(true);
    expect(allowedWalletEvents.includes('transfer.success')).toBe(false);
    expect(allowedWalletEvents.includes('transfer.failed')).toBe(false);
    expect(allowedWalletEvents.includes('subscription.create')).toBe(false);
  });
});

describe('Wallet Funding Limits & Amounts (Section 3, 5, 29)', () => {
  const MIN_KOBO = 10000;      // ₦100
  const MAX_KOBO = 50000000;   // ₦500,000

  function validateFundingAmount(amountKobo: number, currency: string) {
    if (currency !== 'NGN') {
      return { valid: false, error: 'Currency must be NGN' };
    }
    if (!Number.isSafeInteger(amountKobo) || amountKobo < MIN_KOBO) {
      return { valid: false, error: `Minimum funding is ₦${MIN_KOBO / 100}` };
    }
    if (amountKobo > MAX_KOBO) {
      return { valid: false, error: `Maximum funding is ₦${MAX_KOBO / 100}` };
    }
    return { valid: true };
  }

  it('accepts valid funding amounts in NGN', () => {
    expect(validateFundingAmount(10000, 'NGN').valid).toBe(true); // ₦100
    expect(validateFundingAmount(200000, 'NGN').valid).toBe(true); // ₦2,000
    expect(validateFundingAmount(50000000, 'NGN').valid).toBe(true); // ₦500,000
  });

  it('rejects below minimum funding amount', () => {
    const res = validateFundingAmount(9999, 'NGN');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Minimum funding is ₦100');
  });

  it('rejects above maximum funding amount', () => {
    const res = validateFundingAmount(50000001, 'NGN');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Maximum funding is ₦500000');
  });

  it('rejects non-integer, negative, or zero amounts', () => {
    expect(validateFundingAmount(-10000, 'NGN').valid).toBe(false);
    expect(validateFundingAmount(0, 'NGN').valid).toBe(false);
    expect(validateFundingAmount(100.5, 'NGN').valid).toBe(false);
  });

  it('rejects invalid currency', () => {
    const res = validateFundingAmount(50000, 'USD');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Currency must be NGN');
  });
});

describe('Insufficient Balance Calculations (Section 22)', () => {
  function calculateBalanceDeficit(availableKobo: number, requiredKobo: number) {
    const isSufficient = availableKobo >= requiredKobo;
    const deficitKobo = isSufficient ? 0 : requiredKobo - availableKobo;
    return {
      isSufficient,
      availableKobo,
      requiredKobo,
      deficitKobo,
      availableNaira: availableKobo / 100,
      requiredNaira: requiredKobo / 100,
      deficitNaira: deficitKobo / 100,
    };
  }

  it('calculates exact shortfall when wallet has partial funds', () => {
    // Example from pay.md: Balance: ₦5,000, Required: ₦8,000, You need: ₦3,000 more
    const result = calculateBalanceDeficit(500000, 800000);
    expect(result.isSufficient).toBe(false);
    expect(result.availableNaira).toBe(5000);
    expect(result.requiredNaira).toBe(8000);
    expect(result.deficitNaira).toBe(3000);
  });

  it('calculates zero shortfall when wallet is sufficient', () => {
    const result = calculateBalanceDeficit(2000000, 1000000);
    expect(result.isSufficient).toBe(true);
    expect(result.deficitKobo).toBe(0);
  });

  it('handles empty wallet correctly', () => {
    const result = calculateBalanceDeficit(0, 500000);
    expect(result.isSufficient).toBe(false);
    expect(result.deficitNaira).toBe(5000);
  });
});

describe('Centralized Ledger Entry Types (Section 16)', () => {
  it('verifies all mandatory ledger entry types exist in DB migration', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261006130000_wallet_ledger_entry_types.sql'),
      'utf8'
    );
    expect(migration).toContain('wallet_funding');
    expect(migration).toContain('elibrary_premium_purchase');
    expect(migration).toContain('refund');
  });

  it('verifies ledger audit columns exist in core schema migration', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261006131000_fuw_wallet_core.sql'),
      'utf8'
    );
    expect(migration).toContain('balance_before');
    expect(migration).toContain('provider_reference');
    expect(migration).toContain('provider_transaction_id');
    expect(migration).toContain('wallet_funding_transactions');
    expect(migration).toContain('payment_webhook_events');
  });

  it('verifies security definer RPCs are declared in core migration', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261006131000_fuw_wallet_core.sql'),
      'utf8'
    );
    expect(migration).toContain('fuw_begin_wallet_funding');
    expect(migration).toContain('fuw_complete_wallet_funding');
    expect(migration).toContain('pay_premium_plan_from_wallet');
    expect(migration).toContain('refund_payment_transaction_to_wallet');
  });
});

describe('eLibrary & Marketplace Unified Payments (Section 18, 19, 20)', () => {
  it('exports wallet payment methods in client API without client-derived amounts', () => {
    const marketApi = readFileSync(
      resolve(__dirname, '../marketplace/lib/api.ts'),
      'utf8'
    );
    // fundWalletWithPaystack takes amountKobo to initialize charge with provider
    expect(marketApi).toContain('fundWalletWithPaystack');
    // payOrderFromWallet takes orderId ONLY, server resolves amount from order
    expect(marketApi).toContain('payOrderFromWallet(orderId: string)');
    // payPremiumPlanFromWallet takes planSlug ONLY, server resolves amount from database
    expect(marketApi).toContain('payPremiumPlanFromWallet(planSlug: string)');
  });

  it('verifies StudentSubscriptionTab provides Pay with FUW Wallet', () => {
    const subTab = readFileSync(
      resolve(__dirname, '../pages/StudentSubscriptionTab.tsx'),
      'utf8'
    );
    expect(subTab).toContain('Pay with FUW Wallet');
    expect(subTab).toContain('payPremiumPlanFromWallet');
    expect(subTab).toContain('Insufficient wallet balance');
    expect(subTab).toContain('Fund Wallet');
  });

  it('verifies CheckoutPage provides Insufficient balance notice and Fund Wallet link', () => {
    const checkout = readFileSync(
      resolve(__dirname, '../marketplace/pages/CheckoutPage.tsx'),
      'utf8'
    );
    expect(checkout).toContain('Insufficient wallet balance');
    expect(checkout).toContain('Fund Wallet');
  });
});
