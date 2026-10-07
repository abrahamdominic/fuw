-- =============================================================================
-- BEHAVIOURAL TEST: verified payment -> escrow -> delivery -> release
-- =============================================================================
-- Runs entirely inside a transaction that is rolled back, so live data is never
-- touched. Exercises the real functions, the real triggers and the real grants,
-- impersonating each role in turn.
--
-- Run with:  node scripts/pg.mjs --file scripts/verify-payment-security.sql --dry-run
--
-- NEVER run this with --yes. This file drives real orders through the real
-- state machine, so committing it consumes the fixture orders and permanently
-- poisons marketplace_payment_events with this file's FIXED event ids
-- (psx_998877665544, psx_111111111111, psx_dispute_00001). The replay guard
-- then rejects them forever and the suite can never reach `paid` again, while
-- leaving dispute_id and receipt stamps behind that make mp_confirm_receipt
-- refuse with "This order is under dispute". Recovery needs manual data repair.
-- Only --dry-run is correct; the guard below enforces it.
DO $$
BEGIN
  IF current_setting('marketplace.allow_commit', TRUE) IS DISTINCT FROM 'off' THEN
    RAISE EXCEPTION
      'verify-payment-security.sql must run inside a rolled-back transaction (--dry-run). Refusing to run.';
  END IF;
END $$;

-- =============================================================================

-- The Management API used by scripts/pg.mjs returns only the final statement's
-- result set and discards RAISE NOTICE, so every check writes a line into a
-- session-local transcript which the last statement of this file selects. That is
-- what makes the individual results visible; a FAIL still aborts immediately.
CREATE TEMP TABLE pg_temp.transcript (
  seq  BIGSERIAL PRIMARY KEY,
  line TEXT NOT NULL
);

-- The impersonated roles below must be able to append to the transcript, which
-- means the table and its identity sequence.
GRANT INSERT, SELECT ON pg_temp.transcript TO authenticated, anon;
GRANT USAGE, SELECT ON SEQUENCE pg_temp.transcript_seq_seq TO authenticated, anon;

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

-- Runs a statement that MUST be refused. Anything the database rejects counts as
-- a pass; a message beginning with FAIL is our own assertion leaking through and
-- is deliberately re-raised.
CREATE OR REPLACE FUNCTION pg_temp.must_fail(label TEXT, stmt TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
    PERFORM pg_temp.log('PASS  ' || rpad(label, 56, '.') || ' refused: ' || left(SQLERRM, 60));
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % was accepted', label;
END $$;

DO $$
DECLARE
  v_buyer   CONSTANT UUID := 'a357eee1-5117-4b7f-83f9-11f5a64fdcdb';
  v_other   CONSTANT UUID := 'c7fb1668-7009-4220-a0db-e7b72b535fbd';  -- a vendor owner, used as a non-buyer
  v_vendor  UUID;
  v_vendor_owner UUID;
  v_order   UUID;
  v_payment UUID;
  v_escrow  UUID;
  v_total   BIGINT;
  v_ref     TEXT;
  v_status  TEXT;
  v_attempt JSONB;
  v_result  JSONB;
BEGIN
  -- Pick a real paid-able order for this student, and read its own vendor. The
  -- vendor must be trading, so the fulfilment leg below exercises the genuine
  -- vendor path rather than the suspended-storefront guard.
  SELECT o.id, o.payment_id, o.total_kobo, o.vendor_id, v.owner_id
    INTO v_order, v_payment, v_total, v_vendor, v_vendor_owner
    FROM public.marketplace_orders o
    JOIN public.marketplace_vendors v ON v.id = o.vendor_id AND v.status = 'active'
   WHERE o.buyer_id = v_buyer
     AND o.status = 'pending_payment'
   LIMIT 1;
  IF v_order IS NULL THEN RAISE EXCEPTION 'no candidate order with a trading vendor'; END IF;

  PERFORM pg_temp.log(format('--- order %s, total %s kobo, vendor %s ---',
                              v_order, v_total, v_vendor));

  -- ═══════════════════════════════════════════════════════════════════════
  -- 1. A client cannot forge a payment event, and cannot self-elevate.
  -- ═══════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);

  PERFORM pg_temp.must_fail('forged payment event refused',
    format('SELECT public.mp_apply_payment_event(%L, %L, %L, %L, %L, %L, %L, %L, %L)',
      'forged_evt_0001', 'charge.success', v_payment, 'attacker_reference',
      v_total, 'NGN', 'card'::public.marketplace_payment_channel, 'succeeded'::public.marketplace_payment_status, '{}'));

  PERFORM pg_temp.must_fail('mp_set_system_actor unreachable by clients',
    'SELECT public.mp_set_system_actor(true)');

  PERFORM pg_temp.must_fail('mp_apply_payment_event_inner unreachable by clients',
    format('SELECT public.mp_apply_payment_event_inner(%L, %L, %L, %L, %L, %L, %L, %L)',
      'forged_evt_0002', 'charge.success', v_payment, 'x',
      v_total, 'card', 'succeeded', '{}'));

  PERFORM pg_temp.must_fail('mp_reset_payment_attempt unreachable by clients',
    format('SELECT public.mp_reset_payment_attempt(%L, %L)', v_payment, 'x'));

  SELECT status::text INTO v_status FROM public.marketplace_orders WHERE id = v_order;
  PERFORM pg_temp.expect(v_status = 'pending_payment',
    'order still pending_payment after the forged attempts');

  SELECT status::text INTO v_status FROM public.marketplace_payments WHERE id = v_payment;
  PERFORM pg_temp.expect(v_status = 'awaiting_payment', 'payment still awaiting_payment');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.marketplace_escrows WHERE order_id = v_order),
    'no escrow row exists for an unpaid order');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 2. A buyer cannot start a payment attempt for somebody else's order.
  -- ═══════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.must_fail('payment attempt refused for a non-buyer',
    format('SELECT public.mp_begin_payment_attempt(%L, %L)', v_payment, 'card'));

  -- ═══════════════════════════════════════════════════════════════════════
  -- 3. The real buyer starts the attempt. The amount comes from the order.
  -- ═══════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);

  v_attempt := public.mp_begin_payment_attempt(v_payment, 'card'::public.marketplace_payment_channel);
  v_ref := v_attempt->>'reference';
  PERFORM pg_temp.expect((v_attempt->>'amount_kobo')::BIGINT = v_total,
    'server-calculated amount equals the order total');
  PERFORM pg_temp.expect(v_ref LIKE 'fmp_%', 'server issued a provider reference');
  PERFORM pg_temp.expect((v_attempt->>'reused')::BOOLEAN IS FALSE,
    'the first attempt is a fresh reference');

  -- Double click: the same reference must come back, never a second charge.
  v_result := public.mp_begin_payment_attempt(v_payment, 'card'::public.marketplace_payment_channel);
  PERFORM pg_temp.expect(v_result->>'reference' = v_ref,
    'double-clicking Pay re-uses the same reference');
  PERFORM pg_temp.expect((v_result->>'reused')::BOOLEAN IS TRUE,
    'the second attempt is flagged as a re-use');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 4. The webhook refuses a wrong amount, currency, reference or none.
  -- ═══════════════════════════════════════════════════════════════════════
  RESET ROLE;

  PERFORM pg_temp.must_fail('under-payment refused',
    format('SELECT public.mp_apply_payment_event(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      'evt_amount_low_0001', 'charge.success', v_payment, v_ref,
      v_total - 100, 'NGN', 'card', 'succeeded', '{}'));

  PERFORM pg_temp.must_fail('over-payment refused',
    format('SELECT public.mp_apply_payment_event(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      'evt_amount_high_001', 'charge.success', v_payment, v_ref,
      v_total + 100, 'NGN', 'card', 'succeeded', '{}'));

  PERFORM pg_temp.must_fail('foreign currency refused',
    format('SELECT public.mp_apply_payment_event(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      'evt_bad_currency_001', 'charge.success', v_payment, v_ref,
      v_total, 'USD', 'card', 'succeeded', '{}'));

  PERFORM pg_temp.must_fail('foreign reference refused',
    format('SELECT public.mp_apply_payment_event(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      'evt_bad_ref_00001', 'charge.success', v_payment,
      'fmp_someoneelse_0011223344556677', v_total, 'NGN', 'card', 'succeeded', '{}'));

  PERFORM pg_temp.must_fail('amount-less event refused',
    format('SELECT public.mp_apply_payment_event(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      'evt_no_amount_00001', 'charge.success', v_payment, NULL,
      NULL, 'NGN', 'card', 'succeeded', '{}'));

  PERFORM pg_temp.must_fail('an unsigned-style short event id refused',
    format('SELECT public.mp_apply_payment_event(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
      'x', 'charge.success', v_payment, v_ref, v_total, 'NGN', 'card', 'succeeded', '{}'));

  SELECT status::text INTO v_status FROM public.marketplace_orders WHERE id = v_order;
  PERFORM pg_temp.expect(v_status = 'pending_payment',
    'order still pending_payment after six bad provider events');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.marketplace_escrows WHERE order_id = v_order),
    'still no escrow after the bad provider events');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 5. A genuinely verified capture.
  -- ═══════════════════════════════════════════════════════════════════════
  v_result := public.mp_apply_payment_event(
    'psx_998877665544', 'charge.success', v_payment, v_ref,
    v_total, 'NGN', 'card'::public.marketplace_payment_channel, 'succeeded'::public.marketplace_payment_status,
    (json_build_object('verified_via', 'transaction_verify_api'))::jsonb);

  SELECT status::text INTO v_status FROM public.marketplace_orders WHERE id = v_order;
  PERFORM pg_temp.expect(v_status = 'paid', 'order became paid after a verified capture');

  SELECT status::text INTO v_status FROM public.marketplace_payments WHERE id = v_payment;
  PERFORM pg_temp.expect(v_status = 'succeeded', 'payment is succeeded');

  SELECT e.id INTO v_escrow FROM public.marketplace_escrows e WHERE e.order_id = v_order;
  PERFORM pg_temp.expect(v_escrow IS NOT NULL, 'an escrow row was created by the payment trigger');
  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'locked',
    'escrow is locked right after payment, so the vendor cannot be paid');
  PERFORM pg_temp.expect(
    (SELECT amount_kobo FROM public.marketplace_escrows WHERE id = v_escrow) = v_total,
    'escrow holds exactly the captured amount');
  PERFORM pg_temp.expect(
    (SELECT currency FROM public.marketplace_escrows WHERE id = v_escrow) = 'NGN',
    'escrow records the currency');
  PERFORM pg_temp.expect(
    (SELECT buyer_id FROM public.marketplace_escrows WHERE id = v_escrow) = v_buyer
    AND (SELECT vendor_id FROM public.marketplace_escrows WHERE id = v_escrow) = v_vendor,
    'escrow records the buyer and the vendor');
  PERFORM pg_temp.expect(
    (SELECT provider_reference FROM public.marketplace_escrows WHERE id = v_escrow) = v_ref,
    'escrow records the payment reference');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 6. Replay is a no-op.
  -- ═══════════════════════════════════════════════════════════════════════
  v_result := public.mp_apply_payment_event(
    'psx_998877665544', 'charge.success', v_payment, v_ref,
    v_total, 'NGN', 'card'::public.marketplace_payment_channel, 'succeeded'::public.marketplace_payment_status, '{}');
  PERFORM pg_temp.expect((v_result->>'duplicate')::BOOLEAN IS TRUE,
    'a replayed webhook is recognised and ignored');
  PERFORM pg_temp.expect((v_result->>'applied')::BOOLEAN IS NOT TRUE,
    'a replayed webhook applies no change');

  -- A *different* event id for an already-settled payment is refused too.
  v_result := public.mp_apply_payment_event(
    'psx_111111111111', 'charge.success', v_payment, v_ref,
    v_total, 'NGN', 'card'::public.marketplace_payment_channel, 'succeeded'::public.marketplace_payment_status, '{}');
  PERFORM pg_temp.expect((v_result->>'applied')::BOOLEAN IS NOT TRUE,
    'a second capture for a settled payment is refused');
  PERFORM pg_temp.expect(v_result->>'reason' = 'payment_already_settled',
    'the refusal reason is payment_already_settled');

  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.marketplace_escrows WHERE order_id = v_order) = 1,
    'replay created no second escrow');
  PERFORM pg_temp.expect(
    (SELECT refunded_kobo FROM public.marketplace_payments WHERE id = v_payment) = 0,
    'replay moved no money');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 7. The vendor fulfils. Money must NOT move.
  -- ═══════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM pg_temp.must_fail('vendor cannot confirm receipt for the buyer',
    format('SELECT public.mp_confirm_receipt(%L)', v_order));

  PERFORM pg_temp.must_fail('vendor cannot move a paid order straight to completed',
    format('SELECT public.mp_transition_order(%L, %L, %L)', v_order, 'completed', 'nope'));
  RESET ROLE;

  -- The vendor fulfils in their own name, as a real storefront session would.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_vendor_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.mp_transition_order(v_order, 'order_confirmed', 'Accepted by vendor');
  PERFORM public.mp_transition_order(v_order, 'preparing', 'Packed');
  PERFORM public.mp_transition_order(v_order, 'ready_for_delivery', 'Ready');
  PERFORM public.mp_transition_order(v_order, 'delivered', 'Handed to the hostel porter');
  RESET ROLE;

  SELECT status::text INTO v_status FROM public.marketplace_orders WHERE id = v_order;
  PERFORM pg_temp.expect(v_status = 'delivered', 'vendor moved the order to delivered');

  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'locked',
    'escrow is STILL locked after delivery — the buyer has not confirmed');

  PERFORM pg_temp.expect(
    NOT EXISTS (SELECT 1 FROM public.marketplace_settlements WHERE order_id = v_order),
    'no vendor settlement exists before buyer confirmation');

  -- Nothing may pay out while the buyer has not confirmed receipt. Claims are
  -- still the vendor's, so these are genuine storefront-session attempts.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.must_fail('vendor cannot run the release job',
    'SELECT public.mp_release_eligible_settlements()');
  PERFORM pg_temp.must_fail('vendor cannot run the auto-confirm sweep',
    'SELECT public.mp_auto_confirm_orders()');
  PERFORM pg_temp.must_fail('vendor cannot run the expiry sweep',
    'SELECT public.mp_cancel_expired_orders()');
  RESET ROLE;

  -- ...and the genuine release job releases nothing at all, because no
  -- settlement has been created for an unconfirmed order.
  PERFORM public.mp_set_system_actor(true);
  v_result := public.mp_release_eligible_settlements();
  PERFORM pg_temp.expect((v_result->>'released')::INT = 0,
    'the release job moves nothing while the buyer has not confirmed');

  -- Even with the clock past the due date there is still nothing to pay.
  UPDATE public.marketplace_settlements SET eligible_at = now() - interval '1 day'
   WHERE order_id = v_order;
  v_result := public.mp_release_eligible_settlements();
  PERFORM pg_temp.expect((v_result->>'released')::INT = 0,
    'no settlement exists to pay out before confirmation');
  PERFORM public.mp_set_system_actor(false);

  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'locked', 'escrow is still locked after the release attempt');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 8. The buyer confirms receipt. This is what makes money releasable.
  -- ═══════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);

  v_result := public.mp_confirm_receipt(v_order);
  SELECT status::text INTO v_status FROM public.marketplace_orders WHERE id = v_order;
  PERFORM pg_temp.expect(v_status = 'completed', 'order is completed after buyer confirmation');

  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'releasable', 'escrow became releasable');

  PERFORM pg_temp.expect(
    (SELECT buyer_receipt_confirmed_by FROM public.marketplace_orders WHERE id = v_order) = v_buyer,
    'the confirming student is recorded');
  PERFORM pg_temp.expect(
    (SELECT buyer_receipt_confirmed_at FROM public.marketplace_orders WHERE id = v_order) IS NOT NULL,
    'the confirmation timestamp is recorded');
  PERFORM pg_temp.expect(
    EXISTS (SELECT 1 FROM public.marketplace_settlements WHERE order_id = v_order),
    'the vendor settlement now exists');

  -- ═══════════════════════════════════════════════════════════════════════
  -- 9. Double confirmation is harmless.
  -- ═══════════════════════════════════════════════════════════════════════
  PERFORM pg_temp.must_fail('double confirmation refused',
    format('SELECT public.mp_confirm_receipt(%L)', v_order));
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.marketplace_settlements WHERE order_id = v_order) = 1,
    'double confirmation created no second settlement');

  -- A different student cannot confirm this order.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.must_fail('a non-buyer cannot confirm this order',
    format('SELECT public.mp_confirm_receipt(%L)', v_order));

  -- ═══════════════════════════════════════════════════════════════════════
  -- 10. Only now can the matured settlement be released.
  -- ═══════════════════════════════════════════════════════════════════════
  RESET ROLE;
  UPDATE public.marketplace_settlements SET eligible_at = now() - interval '1 day'
   WHERE order_id = v_order;
  v_result := public.mp_release_eligible_settlements();

  SELECT status::text INTO v_status FROM public.marketplace_settlements WHERE order_id = v_order;
  PERFORM pg_temp.expect(v_status = 'scheduled',
    'the completed order''s settlement became payable');

  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'releasable',
    'escrow is still releasable, not released, until the payout settles');

  UPDATE public.marketplace_settlements SET status = 'paid_out' WHERE order_id = v_order;
  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'released', 'escrow is released once the payout settles');
  PERFORM pg_temp.expect(
    (SELECT released_at FROM public.marketplace_escrows WHERE id = v_escrow) IS NOT NULL,
    'the release timestamp is recorded');

  -- The vendor's amount reconciles with the order.
  PERFORM pg_temp.expect(
    (SELECT net_kobo FROM public.marketplace_settlements WHERE order_id = v_order)
      = (SELECT vendor_payout_kobo FROM public.marketplace_orders WHERE id = v_order),
    'the settlement equals the order''s vendor payout');

  -- And a plain signed-in student, who is not even a party, cannot reach the
  -- scheduler sweeps either. This is the escalation path the grant previously
  -- exposed: it let any account force orders closed and payouts running.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.must_fail('a student cannot run the auto-confirm sweep',
    'SELECT public.mp_auto_confirm_orders()');
  PERFORM pg_temp.must_fail('a student cannot run the release job',
    'SELECT public.mp_release_eligible_settlements()');
  PERFORM pg_temp.must_fail('a student cannot run the expiry sweep',
    'SELECT public.mp_cancel_expired_orders()');
  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 11. A client still cannot write the escrow or confirm a transfer.
  -- ═══════════════════════════════════════════════════════════════════════
  -- An unrelated signed-in student matches no escrow policy at all. RLS filters
  -- the row out rather than raising, so the assertion is that the write is a
  -- silent no-op: nothing changed and no trigger got a chance to run.
  SET LOCAL ROLE authenticated;
  UPDATE public.marketplace_escrows
     SET status = 'disputed', released_at = now()
   WHERE id = v_escrow;
  SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
  PERFORM pg_temp.expect(v_status = 'released', 'a stranger cannot write the escrow (RLS filtered it)');

  -- The buyer does pass the RLS policy, so from here on the escrow guard
  -- trigger is the only thing between them and their own money. That boundary
  -- cannot be asserted here: this harness connects as postgres and uses
  -- SET LOCAL ROLE, which leaves session_user = 'postgres', and
  -- mp_is_server_context() reads session_user. Every impersonation below
  -- therefore still looks like the payment server to the guard.
  --
  -- scripts/verify-client-boundary.mjs covers it properly, over PostgREST with
  -- real user JWTs, where session_user is 'authenticator'.

  -- As a stranger, even the INSERT is refused by RLS.
  PERFORM pg_temp.must_fail('a client cannot fake a new escrow',
    format($q$INSERT INTO public.marketplace_escrows
             (order_id, payment_id, buyer_id, vendor_id, amount_kobo, status, provider)
           VALUES (%L, %L, %L, %L, 1, 'released', 'paystack')$q$,
           v_order, v_payment, v_buyer, v_vendor));

  -- And no escrow row was created by any of the attempts above.
  PERFORM pg_temp.expect(
    (SELECT count(*) FROM public.marketplace_escrows WHERE order_id = v_order) = 1,
    'still exactly one escrow row after every write attempt');

  -- The buyer cannot confirm a manual bank transfer, which is the finance-only
  -- route into the same capture pipeline.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.must_fail('manual transfer confirmation requires manage_payments',
    format('SELECT public.mp_confirm_manual_transfer(%L, %L, %L)', v_order, 'TRF-12345', 'looks fine'));

  -- A vendor is not finance either.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_vendor_owner, 'role', 'authenticated')::text, true);
  PERFORM pg_temp.must_fail('a vendor cannot confirm a manual transfer',
    format('SELECT public.mp_confirm_manual_transfer(%L, %L, %L)', v_order, 'TRF-12345', 'looks fine'));
  RESET ROLE;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 12. A dispute freezes the escrow.
  -- ═══════════════════════════════════════════════════════════════════════
  -- This needs its own order. The one above has already been paid out, and a
  -- dispute against an escrow that is already 'released' is correctly a no-op --
  -- the sync trigger deliberately ignores released, refunded and cancelled rows.
  -- Disputing that order would prove nothing.
  DECLARE
    v_order2  UUID;
    v_pay2    UUID;
    v_total2  BIGINT;
    v_ref2    TEXT;
    v_esc2    UUID;
  BEGIN
    SELECT o.id, o.payment_id, o.total_kobo, o.vendor_id
      INTO v_order2, v_pay2, v_total2, v_vendor
      FROM public.marketplace_orders o
      JOIN public.marketplace_vendors v ON v.id = o.vendor_id AND v.status = 'active'
     WHERE o.buyer_id = v_buyer
       AND o.status = 'pending_payment'
       AND o.id <> v_order
     LIMIT 1;
    IF v_order2 IS NULL THEN
      RAISE NOTICE 'SKIP  no second pending_payment order available for the dispute check';
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
      v_attempt := public.mp_begin_payment_attempt(v_pay2, 'card'::public.marketplace_payment_channel);
      v_ref2 := v_attempt->>'reference';
      RESET ROLE;

      PERFORM public.mp_apply_payment_event(
        'psx_dispute_00001', 'charge.success', v_pay2, v_ref2, v_total2, 'NGN',
        'card'::public.marketplace_payment_channel,
        'succeeded'::public.marketplace_payment_status, '{}'::jsonb);

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_vendor_owner, 'role', 'authenticated')::text, true);
      PERFORM public.mp_transition_order(v_order2, 'order_confirmed', 'Accepted');
      PERFORM public.mp_transition_order(v_order2, 'preparing', 'Packed');
      PERFORM public.mp_transition_order(v_order2, 'ready_for_delivery', 'Ready');
      PERFORM public.mp_transition_order(v_order2, 'delivered', 'Left at the porter');
      RESET ROLE;

      -- delivered -> completed is buyer-or-system only, so the vendor cannot
      -- finish their own order; the student has to confirm receipt.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
      PERFORM public.mp_confirm_receipt(v_order2);
      RESET ROLE;

      SELECT id INTO v_esc2 FROM public.marketplace_escrows WHERE order_id = v_order2;
      SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_esc2;
      PERFORM pg_temp.expect(v_status = 'releasable',
        'the second order reaches releasable once the buyer confirms');

      -- Backdate the settlement so release is due, and prove it IS released.
      UPDATE public.marketplace_settlements SET eligible_at = now() - interval '1 day'
       WHERE order_id = v_order2;
      PERFORM public.mp_set_system_actor(true);
      v_result := public.mp_release_eligible_settlements();
      PERFORM public.mp_set_system_actor(false);
      PERFORM pg_temp.expect((v_result->>'released')::INT >= 1,
        'the undisputed settlement is released');

      -- Now a dispute on the FIRST order, whose escrow is released. It must be a
      -- no-op rather than an error, and must not resurrect anything.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
      PERFORM public.mp_open_dispute(
        v_order,
        'item_not_received'::public.marketplace_dispute_reason,
        'Disputing an order that was already paid out');

      SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_escrow;
      PERFORM pg_temp.expect(v_status = 'released',
        'disputing an already-released escrow does not reopen it');

      -- And a dispute on the SECOND order, whose settlement is now scheduled.
      -- The settlement is frozen again and nothing more is released.
      PERFORM public.mp_open_dispute(
        v_order2,
        'item_not_received'::public.marketplace_dispute_reason,
        'The package never arrived');

      SELECT status::text INTO v_status FROM public.marketplace_escrows WHERE id = v_esc2;
      PERFORM pg_temp.expect(v_status = 'disputed', 'an opened dispute freezes the escrow');

      PERFORM pg_temp.expect(
        (SELECT status::text FROM public.marketplace_settlements WHERE order_id = v_order2) = 'on_hold',
        'the settlement is held while the dispute is open');

      UPDATE public.marketplace_settlements SET eligible_at = now() - interval '1 day'
       WHERE order_id = v_order2;
      PERFORM public.mp_set_system_actor(true);
      v_result := public.mp_release_eligible_settlements();
      PERFORM pg_temp.expect((v_result->>'released')::INT = 0,
        'nothing is released while a dispute is open');
      PERFORM public.mp_set_system_actor(false);

      -- The order itself is frozen too: a disputed order cannot be completed.
      PERFORM pg_temp.expect(
        (SELECT status::text FROM public.marketplace_orders WHERE id = v_order2) = 'disputed',
        'the order moved to disputed');
    END IF;
  END;

  RAISE NOTICE '=== all checks completed ===';
END $$;

-- The one statement the Management API hands back.
SELECT line FROM pg_temp.transcript ORDER BY seq;
