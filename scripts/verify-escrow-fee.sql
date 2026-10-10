-- =============================================================================
-- BEHAVIOURAL TEST: escrow fee pricing, holding, recognition and unwind
-- =============================================================================
-- Runs entirely inside a transaction that is rolled back, so live data is never
-- touched. Exercises the real pricing helper and the real wallet triggers with
-- synthetic orders owned by an existing buyer/vendor pair.
--
-- Run with:  node scripts/pg.mjs --file scripts/verify-escrow-fee.sql --dry-run
--
-- NEVER run this with --yes: it writes real order/payment/escrow/settlement rows
-- and drives the live wallet triggers. Only --dry-run is correct.
DO $$
BEGIN
  IF current_setting('marketplace.allow_commit', TRUE) IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION
      'verify-escrow-fee.sql must run inside a rolled-back transaction (--dry-run). Refusing to run.';
  END IF;
END $$;

CREATE TEMP TABLE pg_temp.transcript (
  seq  BIGSERIAL PRIMARY KEY,
  line TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.log(line TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.transcript (line) VALUES (line);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect(condition BOOLEAN, label TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF condition THEN
    PERFORM pg_temp.log('PASS  ' || label);
  ELSE
    RAISE EXCEPTION 'FAIL  %', label;
  END IF;
END $$;

-- ── 1. Pure pricing table ────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(0, 150, 10000, 500000) = 0,          'fee: NGN 0 -> 0');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(100000, 150, 10000, 500000) = 10000,  'fee: NGN 1,000 -> 100 (floor)');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(200000, 150, 10000, 500000) = 10000,  'fee: NGN 2,000 -> 100 (floor)');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(500000, 150, 10000, 500000) = 10000,  'fee: NGN 5,000 -> 100 (floor)');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(1000000, 150, 10000, 500000) = 15000, 'fee: NGN 10,000 -> 150');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(2000000, 150, 10000, 500000) = 30000, 'fee: NGN 20,000 -> 300');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(10000000, 150, 10000, 500000) = 150000,'fee: NGN 100,000 -> 1,500');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(20000000, 150, 10000, 500000) = 300000,'fee: NGN 200,000 -> 3,000');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(33333300, 150, 10000, 500000) = 500000,'fee: NGN 333,333 -> 5,000 (rounding)');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(50000000, 150, 10000, 500000) = 500000,'fee: NGN 500,000 -> 5,000 (cap)');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(100000000, 150, 10000, 500000) = 500000,'fee: NGN 1,000,000 -> 5,000 (cap)');
  PERFORM pg_temp.expect(public.mp_escrow_fee_for(0, 0, 0, 0) = 0, 'fee: zero subtotal ignores floor');
END $$;

-- ── 2. Wallet booking: hold on funding, unwind on refund ─────────────────────
DO $$
DECLARE
  v_buyer UUID;
  v_vendor UUID;
  v_vendor_owner UUID;
  v_platform UUID;
  v_vendor_wallet UUID;
  v_sub BIGINT := 1000000;
  v_pfee BIGINT := 80000;
  v_efee BIGINT := public.mp_escrow_fee_for(1000000, 150, 10000, 500000);
  v_payout BIGINT := 920000;
  v_total BIGINT := 1015000;
  v_order UUID;
  v_pay UUID;
  v_pa0 BIGINT; v_pe0 BIGINT;
  v_pa1 BIGINT; v_pe1 BIGINT;
BEGIN
  SELECT p.id INTO v_buyer FROM public.profiles p
   WHERE EXISTS (SELECT 1 FROM public.marketplace_vendors v WHERE v.owner_id <> p.id)
   LIMIT 1;
  SELECT v.id, v.owner_id INTO v_vendor, v_vendor_owner
    FROM public.marketplace_vendors v WHERE v.owner_id <> v_buyer LIMIT 1;
  IF v_buyer IS NULL OR v_vendor IS NULL THEN
    RAISE EXCEPTION 'No usable buyer/vendor fixture pair found';
  END IF;

  v_platform := public.mp_wallet_ensure();
  v_vendor_wallet := public.mp_wallet_ensure(p_vendor_id => v_vendor);
  SELECT available_kobo, pending_kobo INTO v_pa0, v_pe0
    FROM public.marketplace_wallets WHERE id = v_platform;

  INSERT INTO public.marketplace_orders
    (order_number, buyer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo,
     platform_fee_kobo, escrow_fee_kobo, total_kobo, vendor_payout_kobo, fulfilment)
  VALUES
    (public.mp_order_number(), v_buyer, v_vendor, 'pending_payment', v_sub, 0,
     v_pfee, v_efee, v_total, v_payout, 'pickup')
  RETURNING id INTO v_order;

  INSERT INTO public.marketplace_payments
    (order_id, buyer_id, provider, provider_reference, amount_kobo, currency, status, channel)
  VALUES
    (v_order, v_buyer, 'paystack', 'srcfee_a_' || substr(md5(random()::text), 1, 12),
     v_total, 'NGN', 'awaiting_payment', 'none')
  RETURNING id INTO v_pay;
  UPDATE public.marketplace_orders SET payment_id = v_pay WHERE id = v_order;

  -- Fund the escrow: the payment trigger creates the escrow, which books wallets.
  UPDATE public.marketplace_payments
     SET status = 'succeeded', captured_at = now(), authorised_at = now()
   WHERE id = v_pay;

  SELECT available_kobo, pending_kobo INTO v_pa1, v_pe1
    FROM public.marketplace_wallets WHERE id = v_platform;

  PERFORM pg_temp.expect(v_pe1 = v_pe0 + v_efee,
    'funding: escrow fee held in platform PENDING (non-withdrawable)');
  PERFORM pg_temp.expect(v_pa1 = v_pa0 + v_pfee,
    'funding: platform share recognised in platform AVAILABLE');

  -- Refund before any settlement: the fee and the hold must both come back.
  UPDATE public.marketplace_escrows
     SET status = 'refunded', refunded_at = now()
   WHERE payment_id = v_pay;

  SELECT available_kobo, pending_kobo INTO v_pa1, v_pe1
    FROM public.marketplace_wallets WHERE id = v_platform;
  PERFORM pg_temp.expect(v_pe1 = v_pe0,
    'refund before settlement: escrow fee pending released');
  PERFORM pg_temp.expect(v_pa1 = v_pa0,
    'refund before settlement: platform share released');
END $$;

-- ── 3. Wallet booking: recognise on settlement, unwind on cancellation ────────
DO $$
DECLARE
  v_buyer UUID;
  v_vendor UUID;
  v_platform UUID;
  v_sub BIGINT := 500000;
  v_pfee BIGINT := 40000;
  v_efee BIGINT := public.mp_escrow_fee_for(500000, 150, 10000, 500000);
  v_payout BIGINT := 460000;
  v_total BIGINT := 510000;
  v_order UUID;
  v_pay UUID;
  v_pa0 BIGINT; v_pe0 BIGINT;
  v_pa BIGINT; v_pe BIGINT;
BEGIN
  SELECT p.id INTO v_buyer FROM public.profiles p
   WHERE EXISTS (SELECT 1 FROM public.marketplace_vendors v WHERE v.owner_id <> p.id)
   LIMIT 1;
  SELECT v.id INTO v_vendor
    FROM public.marketplace_vendors v WHERE v.owner_id <> v_buyer LIMIT 1;

  v_platform := public.mp_wallet_ensure();
  SELECT available_kobo, pending_kobo INTO v_pa0, v_pe0
    FROM public.marketplace_wallets WHERE id = v_platform;

  INSERT INTO public.marketplace_orders
    (order_number, buyer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo,
     platform_fee_kobo, escrow_fee_kobo, total_kobo, vendor_payout_kobo, fulfilment)
  VALUES
    (public.mp_order_number(), v_buyer, v_vendor, 'pending_payment', v_sub, 0,
     v_pfee, v_efee, v_total, v_payout, 'pickup')
  RETURNING id INTO v_order;

  INSERT INTO public.marketplace_payments
    (order_id, buyer_id, provider, provider_reference, amount_kobo, currency, status, channel)
  VALUES
    (v_order, v_buyer, 'paystack', 'srcfee_b_' || substr(md5(random()::text), 1, 12),
     v_total, 'NGN', 'awaiting_payment', 'none')
  RETURNING id INTO v_pay;
  UPDATE public.marketplace_orders SET payment_id = v_pay WHERE id = v_order;

  UPDATE public.marketplace_payments
     SET status = 'succeeded', captured_at = now(), authorised_at = now()
   WHERE id = v_pay;

  SELECT available_kobo, pending_kobo INTO v_pa, v_pe
    FROM public.marketplace_wallets WHERE id = v_platform;
  PERFORM pg_temp.expect(v_pe = v_pe0 + v_efee, 'funding: escrow fee held in PENDING');

  INSERT INTO public.marketplace_settlements
    (order_id, vendor_id, gross_kobo, commission_kobo, net_kobo, status, eligible_at)
  VALUES
    (v_order, v_vendor, v_sub, v_pfee, v_payout, 'pending', now());

  UPDATE public.marketplace_orders
     SET status = 'completed', completed_at = now(), paid_at = COALESCE(paid_at, now())
   WHERE id = v_order;
  UPDATE public.marketplace_settlements SET status = 'scheduled', released_at = now()
   WHERE order_id = v_order;

  SELECT available_kobo, pending_kobo INTO v_pa, v_pe
    FROM public.marketplace_wallets WHERE id = v_platform;
  PERFORM pg_temp.expect(v_pe = v_pe0,
    'settlement scheduled: escrow fee moved out of PENDING');
  PERFORM pg_temp.expect(v_pa = v_pa0 + v_pfee + v_efee,
    'settlement scheduled: escrow fee recognised to AVAILABLE');

  -- Full refund after settlement: commission and escrow fee both unwind.
  UPDATE public.marketplace_orders
     SET status = 'refunded', refunded_at = now(), paid_at = COALESCE(paid_at, now())
   WHERE id = v_order;

  SELECT available_kobo, pending_kobo INTO v_pa, v_pe
    FROM public.marketplace_wallets WHERE id = v_platform;
  PERFORM pg_temp.expect(v_pe = v_pe0,
    'refund after settlement: nothing left in PENDING');
  PERFORM pg_temp.expect(v_pa = v_pa0,
    'refund after settlement: platform share and escrow fee unwound');
END $$;

-- Final statement: the Management API returns only this result set.
SELECT line FROM pg_temp.transcript ORDER BY seq;
