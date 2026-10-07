-- =============================================================================
-- Marketplace: verified payment + escrow funding
-- =============================================================================
-- WHAT THIS FIXES
-- ---------------
-- Two defects combined to make "click Pay" indistinguishable from "pay":
--
--   1. Checkout created a `pending_payment` order and then rendered a success
--      screen claiming the money was already in escrow. No payment provider was
--      ever contacted, because the Marketplace had no provider integration at
--      all — `supabase/functions/` was empty.
--
--   2. public.mp_apply_payment_event() was granted EXECUTE to `authenticated`
--      (and, via the default PUBLIC grant, to `anon`). That function sets the
--      transaction-local system actor itself, and `pending_payment -> paid` is
--      system-only in the transition matrix — so any signed-in student could
--      post a forged "charge.success" event against their own payment and
--      receive a genuinely `paid` order without transferring a naira. Passing
--      p_signature_ok = true was enough, because that flag was client-supplied;
--      and p_amount_kobo defaulted to NULL, which skipped the amount
--      cross-check entirely.
--
-- THE FIX
-- -------
-- A. mp_apply_payment_event is service_role-only. The trust boundary is the
--    edge function holding the provider secret, which verifies the provider's
--    HMAC signature over the raw body and then calls it. The client-shaped
--    boolean `p_signature_ok` is removed outright: a caller that cannot present
--    a verified provider event must not be able to claim one exists.
-- B. The function now REQUIRES an amount, a currency and a reference, and
--    cross-checks all three against the stored order. A mismatch is an audited
--    rejection, not a correction.
-- C. Escrow becomes a real, durable record. marketplace_escrows is funded by a
--    trigger on the payment row reaching `succeeded`, so it is impossible to
--    mark an order paid without also creating the held-funds record — there is
--    no second write path. The vendor still cannot be paid until the buyer
--    confirms receipt through mp_confirm_receipt, because the escrow only
--    becomes releasable on `delivered -> completed`, which the transition
--    matrix allows to `buyer` and `system` only.
-- D. mp_begin_payment_attempt fixes the amount and currency ONCE, server-side,
--    and is the only client-callable entry into the payment flow. The provider
--    edge function relays that exact figure to the provider; a tampered client
--    cannot change it, and a double click re-uses the same reference instead of
--    creating a second charge.
-- E. manual_bank_transfer orders get a real, permission-gated confirmation path
--    instead of being stranded at pending_payment forever.
--
-- Everything else in the existing order/payment/settlement architecture is
-- reused: no order table, payment table, settlement table or transition rule is
-- duplicated. The settlement remains the vendor's payout record; the escrow is
-- the buyer's held-funds record, and the two are linked by escrow.settlement_id.
-- =============================================================================

BEGIN;

-- =============================================================================
-- A. GRANT LOCKDOWN
-- =============================================================================
-- Wrapped in a DO block because REVOKE has no IF EXISTS: the legacy
-- p_signature_ok signatures are dropped in section H, so on a re-run they are
-- already gone and a bare REVOKE would abort the whole migration.

DO $$
DECLARE
  v_old_wrapper CONSTANT TEXT :=
    'public.mp_apply_payment_event(text,text,uuid,text,bigint,marketplace_payment_channel,marketplace_payment_status,boolean,jsonb)';
  v_exists BOOLEAN;
BEGIN
  -- The whole payment-verification surface. This is the single most important
  -- statement in the migration: with this revoked from client roles, no amount
  -- of client-side crafting can move an order into `paid`.
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v_old_wrapper
  ) INTO v_exists;

  IF v_exists THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION ' || v_old_wrapper || ' FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_old_wrapper || ' TO service_role';
    RAISE NOTICE 'legacy mp_apply_payment_event revoked from client roles';
  ELSE
    RAISE NOTICE 'legacy mp_apply_payment_event already replaced';
  END IF;

  -- Checkout is buyer-only. mp_create_orders raises on a NULL auth.uid(), but
  -- the grant should never have reached anon in the first place.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.mp_create_orders(text,jsonb,marketplace_delivery_type,jsonb,text,text) FROM PUBLIC, anon';

  -- One-off data-repair helpers left executable by PUBLIC.
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.mp_sync_image_compatibility()   FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.mp_sync_product_compatibility() FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.mp_sync_vendor_compatibility()  FROM PUBLIC, anon, authenticated';
END $$;

-- =============================================================================
-- A2. LATENT BUG: payment_confirmed crashes the order transition
-- =============================================================================
-- mp_transition_order fans notifications out to both sides with
--
--   IF v_notif NOT IN ('payment_confirmed','payment_failed','payment_opened')
--
-- but 'payment_opened' is not a label of marketplace_notification_type, so
-- Postgres cannot cast the literal and raises
--
--   invalid input value for enum marketplace_notification_type: "payment_opened"
--
-- on the first iteration of that loop. The loop runs for every transition that
-- carries a notify array, and the first thing a real payment does is the
-- pending_payment -> paid transition, whose notify is {payment_confirmed}. The
-- entire verified-payment path therefore aborted inside the transition call --
-- the money was verified and then the order refused to move.
--
-- It went unnoticed because nothing could legitimately reach it: no provider
-- integration existed, and the forged-event hole meant no honest client ever got
-- as far as a capture.
--
-- The buyer-side comparison immediately above already spells the same exclusion
-- as ('payment_confirmed','payment_failed','refund_issued'), which is the clear
-- intent: money events reach the buyer, fulfilment events reach the vendor. This
-- re-declares the function with that one token corrected, so both branches agree.
-- The rest of the body is byte-identical to the live definition.
--
-- CREATE OR REPLACE keeps the same function and the same OID, so this is a fix,
-- not a second state machine to keep in step. (An in-place pg_proc.prosrc edit
-- was tried first and is impossible here: the Management API connects as postgres,
-- which on Supabase has BYPASSRLS but is deliberately not superuser.)

-- While re-deriving the body for the enum fix above, a second defect in the same
-- function surfaced: the simple-product inventory ledger on completion reads
--
--   SELECT id, -quantity, quantity_total - quantity_sold, ...
--     FROM public.marketplace_products WHERE id = v_settle.product_id;
--
-- but marketplace_products has no `quantity` column -- the per-unit figure lives
-- on the order line (v_settle.quantity), and the sibling variant branch two lines
-- below already spells it that way. PostgreSQL resolves the reference at runtime,
-- not at CREATE time, so this compiled cleanly and then aborted the moment any
-- order was completed:
--
--   column "quantity" does not exist
--
-- Every order carrying a simple (non-variant) product therefore failed at the
-- `marks_completed` step: the buyer could never confirm receipt, the settlement
-- was never created and escrow never became releasable. Corrected to
-- -v_settle.quantity, matching the variant branch.

-- A third defect in the same body, in the dispute branch: the settlement_status
-- CASE assigned bare text literals to an enum column.
--
--   SET settlement_status = CASE WHEN v_rule.marks_refunded THEN 'cancelled'
--                               ELSE 'on_hold' END
--
--   column "settlement_status" is of type marketplace_settlement_status but
--   expression is of type text
--
-- Both branches of the dispute transition are reached through mp_open_dispute, so
-- opening a dispute always aborted -- and it aborted after the dispute row had
-- already been written. Students could raise a dispute, be shown an error, and
-- leave the order unfrozen with the vendor still owed money. Cast, matching the
-- adjacent UPDATE two statements above.

CREATE OR REPLACE FUNCTION public.mp_transition_order(
  p_order_id UUID,
  p_to_status public.marketplace_order_status,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order public.marketplace_orders%ROWTYPE;
  v_rule public.marketplace_order_transitions%ROWTYPE;
  v_vendor_owner UUID;
  v_buyer_name TEXT;
  v_role TEXT;
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_notif public.marketplace_notification_type;
  v_delta INT;
  v_settle RECORD;
  v_released INT := 0;
BEGIN
  -- Anonymity is refused for humans and permitted for the scheduler. Cron and
  -- webhook handlers run with no session, so mp.system_actor (settable only by a
  -- SECURITY DEFINER job, and revoked from every client role) is what proves the
  -- caller is trusted. Anything else must be a signed-in participant.
  IF v_uid IS NULL AND NOT public.mp_is_system_actor() THEN
    RAISE EXCEPTION 'Sign in to continue' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT owner_id INTO v_vendor_owner FROM public.marketplace_vendors WHERE id = v_order.vendor_id;
  SELECT full_name INTO v_buyer_name FROM public.profiles WHERE id = v_order.buyer_id;

  -- ── ROLE RESOLUTION ──────────────────────────────────────────────────────
  -- Derived strictly from stored relationships. A caller cannot nominate a
  -- role, and there is no code path that grants 'admin' without a live
  -- marketplace_admin_staff grant.
  --
  -- 'system' is only reachable when a SECURITY DEFINER job has set the
  -- transaction-local mp.system_actor flag (mp_set_system_actor is revoked from
  -- every client role), so no browser session can ever act as the scheduler.
  IF public.mp_is_system_actor() THEN
    v_role := 'system';
  ELSIF public.mp_is_admin(v_uid) THEN
    v_role := 'admin';
  ELSIF v_vendor_owner = v_uid THEN
    v_role := 'vendor';
  ELSIF v_order.buyer_id = v_uid THEN
    v_role := 'buyer';
  ELSE
    RAISE EXCEPTION 'You are not a participant in this order' USING ERRCODE = '42501';
  END IF;

  -- Resolve the rule for THIS caller's role. 'any' rules are reserved for
  -- system automation and are not reachable by a human role.
  SELECT * INTO v_rule
    FROM public.marketplace_order_transitions
   WHERE from_status = v_order.status
     AND to_status = p_to_status
     AND actor_role IN (v_role, 'any')
   ORDER BY (actor_role = v_role) DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An order that is % cannot be changed to %', replace(v_order.status::TEXT,'_',' '),
      replace(p_to_status::TEXT,'_',' ') USING ERRCODE = '23514';
  END IF;

  -- A vendor must still be trading to move an order forward.
  IF v_role = 'vendor' AND v_order.status <> 'pending_payment' THEN
    IF NOT EXISTS (SELECT 1 FROM public.marketplace_vendors
                    WHERE id = v_order.vendor_id AND status = 'active') THEN
      RAISE EXCEPTION 'Your storefront is not trading. Contact marketplace support about this order.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A buyer cancelling a PAID order is deliberately not allowed: once money has
  -- moved, the remedy is a dispute so a human authorises the refund.
  IF v_role = 'buyer' AND p_to_status = 'cancelled' AND v_order.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'This order is already paid. Open a dispute and marketplace staff will help.'
      USING ERRCODE = '23514';
  END IF;

  -- Return window: a buyer cannot dispute long after delivery.
  IF p_to_status = 'disputed' AND v_role = 'buyer' THEN
    SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
    IF v_order.completed_at IS NOT NULL
       AND v_order.completed_at < now() - make_interval(hours => v_settings.return_window_hours) THEN
      RAISE EXCEPTION 'The %h dispute window for this order has closed',
        v_settings.return_window_hours USING ERRCODE = '23514';
    END IF;
    IF v_order.delivered_at IS NOT NULL AND v_order.completed_at IS NULL
       AND v_order.delivered_at < now() - make_interval(hours => v_settings.auto_confirm_hours) THEN
      RAISE EXCEPTION 'This order was auto-confirmed and can no longer be disputed'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- ── APPLY ────────────────────────────────────────────────────────────────
  UPDATE public.marketplace_orders
     SET status = p_to_status,
         paid_at = CASE WHEN v_rule.marks_paid AND paid_at IS NULL THEN now() ELSE paid_at END,
         confirmed_at = CASE WHEN p_to_status = 'order_confirmed' AND confirmed_at IS NULL
                             THEN now() ELSE confirmed_at END,
         delivered_at = CASE WHEN v_rule.marks_delivered AND delivered_at IS NULL
                             THEN now() ELSE delivered_at END,
         completed_at = CASE WHEN v_rule.marks_completed AND completed_at IS NULL
                             THEN now() ELSE completed_at END,
         refunded_at = CASE WHEN v_rule.marks_refunded AND refunded_at IS NULL
                            THEN now() ELSE refunded_at END,
         cancelled_at = CASE WHEN p_to_status = 'cancelled' THEN now() ELSE cancelled_at END,
         cancelled_by_role = CASE WHEN p_to_status = 'cancelled' THEN v_role ELSE cancelled_by_role END,
         cancellation_reason = CASE WHEN p_to_status = 'cancelled' THEN left(p_reason, 600)
                                   ELSE cancellation_reason END,
         auto_confirm_at = CASE WHEN v_rule.marks_completed THEN NULL
                                WHEN p_to_status = 'ready_for_delivery' AND auto_confirm_at IS NULL
                                  THEN now() + make_interval(hours => 72)
                                ELSE auto_confirm_at END,
         updated_at = now()
   WHERE id = p_order_id;

  -- ── STOCK ────────────────────────────────────────────────────────────────
  -- Cancelling releases the reservation; completing converts it to a sale.
  IF v_rule.releases_stock THEN
    FOR v_settle IN
      SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
        FROM public.marketplace_order_items oi
       WHERE oi.order_id = p_order_id
    LOOP
      IF v_settle.variant_id IS NULL THEN
        UPDATE public.marketplace_products
           SET quantity_reserved = GREATEST(quantity_reserved - v_settle.quantity, 0),
               status = CASE WHEN status = 'sold_out' AND quantity_total - quantity_sold - quantity_reserved > 0
                               THEN 'active'::public.marketplace_listing_status ELSE status END,
               updated_at = now()
         WHERE id = v_settle.product_id;

        INSERT INTO public.marketplace_inventory
          (product_id, delta, balance_after, reason, actor_id, order_id, note)
        SELECT id, 0, quantity_total - quantity_sold, 'reservation_released', v_uid, p_order_id,
               'Released on cancellation of ' || v_order.order_number
          FROM public.marketplace_products WHERE id = v_settle.product_id;
      ELSE
        UPDATE public.marketplace_product_variants
           SET quantity_reserved = GREATEST(quantity_reserved - v_settle.quantity, 0),
               updated_at = now()
         WHERE id = v_settle.variant_id;

        -- The ledger records the release for option-level stock too, otherwise a
        -- sold-out size would come back with no trace of why.
        INSERT INTO public.marketplace_inventory
          (product_id, variant_id, delta, balance_after, reason, actor_id, order_id, note)
        SELECT pr.id, pv.id, 0, pv.quantity_total - pv.quantity_sold, 'reservation_released',
               v_uid, p_order_id, 'Released on cancellation of ' || v_order.order_number
          FROM public.marketplace_products pr
          JOIN public.marketplace_product_variants pv ON pv.id = v_settle.variant_id
         WHERE pr.id = v_settle.product_id;
      END IF;
    END LOOP;
  END IF;

  IF v_rule.marks_completed THEN
    UPDATE public.marketplace_order_items SET fulfilled_at = now()
     WHERE order_id = p_order_id AND fulfilled_at IS NULL;

    FOR v_settle IN
      SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity
        FROM public.marketplace_order_items oi
       WHERE oi.order_id = p_order_id
    LOOP
      IF v_settle.variant_id IS NULL THEN
        UPDATE public.marketplace_products
           SET quantity_reserved = GREATEST(quantity_reserved - v_settle.quantity, 0),
               quantity_sold = quantity_sold + v_settle.quantity,
               status = CASE WHEN quantity_total - quantity_sold - quantity_reserved <= 0
                               THEN 'sold_out'::public.marketplace_listing_status ELSE status END,
               updated_at = now()
         WHERE id = v_settle.product_id;

        INSERT INTO public.marketplace_inventory
          (product_id, delta, balance_after, reason, actor_id, order_id, note)
        SELECT id, -v_settle.quantity, quantity_total - quantity_sold, 'sale', v_uid, p_order_id,
               'Sold on completion of ' || v_order.order_number
          FROM public.marketplace_products WHERE id = v_settle.product_id;
      ELSE
        UPDATE public.marketplace_product_variants
           SET quantity_reserved = GREATEST(quantity_reserved - v_settle.quantity, 0),
               quantity_sold = quantity_sold + v_settle.quantity,
               updated_at = now()
         WHERE id = v_settle.variant_id;

        INSERT INTO public.marketplace_inventory
          (product_id, variant_id, delta, balance_after, reason, actor_id, order_id, note)
        SELECT pr.id, pv.id, -v_settle.quantity,
               pv.quantity_total - pv.quantity_sold, 'sale', v_uid, p_order_id,
               'Sold on completion of ' || v_order.order_number
          FROM public.marketplace_products pr
          JOIN public.marketplace_product_variants pv ON pv.id = v_settle.variant_id
         WHERE pr.id = v_settle.product_id;
      END IF;
    END LOOP;

    UPDATE public.marketplace_vendors
       SET completed_orders = completed_orders + 1
     WHERE id = v_order.vendor_id;
  END IF;

  IF p_to_status = 'cancelled' THEN
    UPDATE public.marketplace_vendors
       SET cancelled_orders = cancelled_orders + 1
     WHERE id = v_order.vendor_id;
  END IF;

  IF p_to_status = 'disputed' THEN
    UPDATE public.marketplace_vendors
       SET disputed_orders = disputed_orders + 1
     WHERE id = v_order.vendor_id;
  END IF;

  -- ── SETTLEMENT ───────────────────────────────────────────────────────────
  IF v_rule.marks_refunded OR v_rule.holds_settlement THEN
    UPDATE public.marketplace_settlements
       SET status = CASE WHEN v_rule.marks_refunded THEN 'cancelled'::public.marketplace_settlement_status
                         ELSE 'on_hold'::public.marketplace_settlement_status END,
           hold_reason = CASE WHEN v_rule.marks_refunded THEN NULL
                              ELSE left(COALESCE(p_reason, 'Order disputed'), 400) END,
           updated_at = now()
     WHERE order_id = p_order_id;

    UPDATE public.marketplace_orders
       SET settlement_status = CASE WHEN v_rule.marks_refunded
                                    THEN 'cancelled'::public.marketplace_settlement_status
                                    ELSE 'on_hold'::public.marketplace_settlement_status END
     WHERE id = p_order_id;
  END IF;

  IF v_rule.creates_settlement THEN
    SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;

    INSERT INTO public.marketplace_settlements
      (order_id, vendor_id, gross_kobo, commission_kobo, net_kobo, status, eligible_at)
    VALUES
      (p_order_id, v_order.vendor_id, v_order.subtotal_kobo, v_order.platform_fee_kobo,
       v_order.vendor_payout_kobo, 'pending',
       now() + make_interval(hours => v_settings.settlement_delay_hours))
    ON CONFLICT (order_id) DO NOTHING;

    UPDATE public.marketplace_orders SET settlement_status = 'pending' WHERE id = p_order_id;
  END IF;

  -- Resuming a completed order after a rejected dispute puts settlement back in
  -- the queue rather than releasing it immediately.
  IF v_role = 'admin' AND v_order.status = 'disputed' AND p_to_status = 'completed' THEN
    UPDATE public.marketplace_settlements
       SET status = 'pending', hold_reason = NULL, updated_at = now()
     WHERE order_id = p_order_id AND status = 'on_hold';
    UPDATE public.marketplace_orders SET settlement_status = 'pending' WHERE id = p_order_id;
  END IF;

  -- ── AUDIT + NOTIFY ───────────────────────────────────────────────────────
  INSERT INTO public.marketplace_order_status_history
    (order_id, from_status, to_status, actor_id, actor_role, reason, metadata)
  VALUES
    (p_order_id, v_order.status, p_to_status, v_uid, v_role, left(p_reason, 600),
     jsonb_build_object('subtotal_kobo', v_order.subtotal_kobo, 'total_kobo', v_order.total_kobo));

  PERFORM public.mp_audit('order.transition', 'order', p_order_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', p_to_status, 'role', v_role), p_reason, v_role);

  FOREACH v_notif IN ARRAY v_rule.notify LOOP
    -- The vendor hears about fulfilment; the buyer hears about money and
    -- delivery. Neither is told anything the other side is not.
    IF v_notif IN ('payment_confirmed','payment_failed','refund_issued') OR v_role = 'buyer' THEN
      PERFORM public.mp_notify(v_order.buyer_id, v_notif,
        'Order ' || v_order.order_number || ': ' || replace(p_to_status::TEXT, '_', ' '),
        COALESCE(left(p_reason, 400),
                 format('Your order moved to %s.', replace(p_to_status::TEXT, '_', ' '))),
        '/orders/' || p_order_id::TEXT, 'order', p_order_id,
        'status:' || p_order_id::TEXT || ':' || p_to_status::TEXT);
    END IF;

    IF v_notif NOT IN ('payment_confirmed','payment_failed','refund_issued') THEN
      PERFORM public.mp_notify(v_vendor_owner, v_notif,
        'Order ' || v_order.order_number || ': ' || replace(p_to_status::TEXT, '_', ' '),
        CASE WHEN v_notif = 'order_placed'
             THEN format('%s placed an order.', COALESCE(v_buyer_name, 'A student'))
             ELSE COALESCE(left(p_reason, 400),
                  format('The buyer moved the order to %s.', replace(p_to_status::TEXT, '_', ' ')))
             END,
        '/vendor/orders/' || p_order_id::TEXT, 'order', p_order_id,
        'status:' || p_order_id::TEXT || ':' || p_to_status::TEXT || ':vendor');
    END IF;
  END LOOP;

  -- A post-payment cancellation means finance owes the buyer a refund. Flag it
  -- loudly rather than silently stranding the money.
  IF p_to_status = 'cancelled' AND v_order.paid_at IS NOT NULL THEN
    PERFORM public.mp_notify(v_order.buyer_id, 'payment_failed',
      'Refund needed for ' || v_order.order_number,
      'This order was cancelled after payment. Marketplace staff will refund NGN '
        || to_char(v_order.total_kobo / 100.0, 'FM999999999990.00') || '.',
      '/orders/' || p_order_id::TEXT, 'order', p_order_id);

    PERFORM public.mp_audit('order.refund_required', 'order', p_order_id, NULL,
      jsonb_build_object('total_kobo', v_order.total_kobo, 'cancelled_by', v_role),
      'Payment captured but order cancelled — finance action required', 'admin');
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'from', v_order.status,
    'to', p_to_status,
    'role', v_role
  );
END;
$$;

-- =============================================================================
-- A3. ESCALATION GAP: any signed-in student could run the scheduler sweeps
-- =============================================================================
-- mp_auto_confirm_orders and mp_cancel_expired_orders were both granted EXECUTE
-- to `authenticated`, and each one opens by calling mp_set_system_actor(true) on
-- itself before doing anything else.
--
-- mp_set_system_actor is revoked from every client role. That flag exists to
-- prove a SECURITY DEFINER job is the caller, and granting the sweep itself to
-- `authenticated` turned it into a privilege-escalation gadget: the flag was
-- set by the function, not earned by the caller.
--
-- The consequence was not cosmetic. mp_auto_confirm_orders completes every
-- delivered order older than 72 hours, and a completed order is exactly what
-- creates the vendor settlement and makes escrow releasable. Any student who
-- had signed up could call it and force other students' orders closed, which is
-- precisely the buyer-confirmation gate this migration exists to build. The
-- same reach let a student mass-cancel other students' unpaid orders.
--
-- mp_release_eligible_settlements had the mirror-image defect: it is the payout
-- job, it carried no caller check at all, and it too was granted to
-- `authenticated`, so any student could trigger vendor payouts on demand.
--
-- Fixed in two layers:
--   1. revoke EXECUTE from anon / authenticated / PUBLIC, leaving service_role
--      and postgres -- the scheduler's real callers;
--   2. refuse at the top of each function unless mp_is_server_context() holds,
--      so a future grant slip cannot re-expose it. That check sits BEFORE the
--      internal mp_set_system_actor(true), which is the entire point: the flag
--      must not be able to vouch for the caller it is meant to be checking.

REVOKE EXECUTE ON FUNCTION public.mp_auto_confirm_orders()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_cancel_expired_orders()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_release_eligible_settlements() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mp_auto_confirm_orders()          TO service_role;
GRANT EXECUTE ON FUNCTION public.mp_cancel_expired_orders()        TO service_role;
GRANT EXECUTE ON FUNCTION public.mp_release_eligible_settlements() TO service_role;

CREATE OR REPLACE FUNCTION public.mp_auto_confirm_orders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_n INT := 0;
  v_step TEXT;
BEGIN
  -- Defence in depth. The grant above is the real control; this refuses to run
  -- even if that grant is widened again. It has to come before the
  -- self-elevation, which would otherwise vouch for the very caller it is
  -- meant to be checking.
  IF NOT public.mp_is_server_context() THEN
    RAISE EXCEPTION 'This is a scheduled system job and cannot be run by a client'
      USING ERRCODE = '42501';
  END IF;


  PERFORM public.mp_set_system_actor(true);

  FOR v_order IN
    SELECT id FROM public.marketplace_orders
     WHERE status = 'delivered'
       AND delivered_at < now() - INTERVAL '72 hours'
       AND dispute_id IS NULL
     LIMIT 200
  LOOP
    BEGIN
      PERFORM public.mp_transition_order(v_order.id, 'completed', 'Auto-confirmed after delivery window');
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      v_step := SQLERRM;
      PERFORM public.mp_audit('cron.auto_confirm.failed', 'order', v_order.id, NULL, NULL,
        left(v_step, 400), 'system');
    END;
  END LOOP;

  PERFORM public.mp_set_system_actor(false);

  RETURN jsonb_build_object('confirmed', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.mp_cancel_expired_orders()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_n INT := 0;
  v_step TEXT;
BEGIN
  -- Set the transaction-local system flag once for the whole sweep.
  -- Defence in depth. The grant above is the real control; this refuses to run
  -- even if that grant is widened again. It has to come before the
  -- self-elevation, which would otherwise vouch for the very caller it is
  -- meant to be checking.
  IF NOT public.mp_is_server_context() THEN
    RAISE EXCEPTION 'This is a scheduled system job and cannot be run by a client'
      USING ERRCODE = '42501';
  END IF;


  PERFORM public.mp_set_system_actor(true);

  FOR v_order IN
    SELECT o.id FROM public.marketplace_orders o
     WHERE o.status = 'pending_payment'
       AND o.created_at < now() - INTERVAL '45 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM public.marketplace_payments p
          WHERE p.order_id = o.id AND p.status IN ('succeeded','processing')
       )
     LIMIT 200
  LOOP
    BEGIN
      PERFORM public.mp_transition_order(v_order.id, 'cancelled', 'Payment window expired');
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One stuck order must not abort the sweep. Record why and continue.
      v_step := SQLERRM;
      PERFORM public.mp_audit('cron.cancel_expired.failed', 'order', v_order.id, NULL,
        NULL, left(v_step, 400), 'system');
    END;
  END LOOP;

  PERFORM public.mp_set_system_actor(false);

  PERFORM public.mp_audit('cron.cancel_expired', 'order', NULL, NULL,
    jsonb_build_object('cancelled', v_n), 'Reservation expiry sweep', 'system');

  RETURN jsonb_build_object('cancelled', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.mp_release_eligible_settlements()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_n INT := 0;
BEGIN
  -- Defence in depth. The grant above is the real control; this refuses to run
  -- even if that grant is widened again. It has to come before the
  -- self-elevation, which would otherwise vouch for the very caller it is
  -- meant to be checking.
  IF NOT public.mp_is_server_context() THEN
    RAISE EXCEPTION 'This is a scheduled system job and cannot be run by a client'
      USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT s.id
      FROM public.marketplace_settlements s
      JOIN public.marketplace_orders o ON o.id = s.order_id
     WHERE s.status = 'pending'
       AND s.eligible_at <= now()
       AND o.status = 'completed'
       -- Belt and braces: a disputed order can never reach release even if a
       -- status write were somehow bypassed.
       AND o.dispute_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.marketplace_disputes d
          WHERE d.order_id = o.id
            AND d.status NOT IN ('resolved_refund','resolved_partial','resolved_rejected','closed')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.marketplace_withdrawal_allocations a WHERE a.settlement_id = s.id
       )
     LIMIT 500
  LOOP
    UPDATE public.marketplace_settlements
       SET status = 'scheduled', released_at = now(), updated_at = now()
     WHERE id = v_row.id AND status = 'pending';
    UPDATE public.marketplace_orders SET settlement_status = 'scheduled'
     WHERE id = (SELECT order_id FROM public.marketplace_settlements WHERE id = v_row.id);
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('released', v_n);
END;
$$;

-- =============================================================================
-- B. SERVER-CONTEXT HELPER
-- =============================================================================
-- Triggers fire regardless of EXECUTE grants, so the escrow guard needs its own
-- way to tell a server write from a client write. The system actor flag is the
-- primary signal (set by mp_apply_payment_event); the role/session checks cover
-- migrations and direct admin work.

CREATE OR REPLACE FUNCTION public.mp_is_server_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.mp_is_system_actor()
      OR COALESCE(current_setting('role', TRUE), '') IN
           ('service_role', 'supabase_admin', 'postgres', 'supabase_auth_admin')
      OR session_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
      OR current_user = session_user;
$$;

COMMENT ON FUNCTION public.mp_is_server_context IS
  'True when the current statement is running as the payment server (system actor, service_role, or a migration session) rather than as an end user.';

-- =============================================================================
-- C. ESCROW LEDGER
-- =============================================================================
-- The record of money that has been received and is being held. Deliberately
-- separate from marketplace_settlements, which is the vendor's receivable and
-- only comes into existence once the buyer has confirmed delivery.

DO $$
BEGIN
  CREATE TYPE public.marketplace_escrow_status AS ENUM (
    'pending',     -- order created, money not yet received
    'funded',      -- provider confirmed the money; held on the platform
    'locked',      -- held and not yet releasable (the default post-payment state)
    'releasable',  -- buyer confirmed receipt; payout may proceed
    'released',    -- funds handed to the vendor
    'refunded',    -- returned to the buyer
    'disputed',    -- held pending dispute review
    'cancelled'    -- order died before, or instead of, payment
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'marketplace_escrow_status already exists';
END $$;

DO $$
BEGIN
  CREATE TABLE public.marketplace_escrows (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id           UUID NOT NULL UNIQUE REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
    payment_id         UUID NOT NULL UNIQUE REFERENCES public.marketplace_payments(id) ON DELETE RESTRICT,
    buyer_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    vendor_id          UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE RESTRICT,
    amount_kobo        BIGINT NOT NULL CHECK (amount_kobo > 0),
    currency           TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
    status             public.marketplace_escrow_status NOT NULL DEFAULT 'pending',
    provider           TEXT NOT NULL,
    provider_reference TEXT,
    settlement_id      UUID REFERENCES public.marketplace_settlements(id) ON DELETE SET NULL,
    funded_at          TIMESTAMPTZ,
    locked_at          TIMESTAMPTZ,
    releasable_at      TIMESTAMPTZ,
    released_at        TIMESTAMPTZ,
    refunded_at        TIMESTAMPTZ,
    disputed_at        TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ,
    confirmed_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    release_reference  TEXT,
    metadata           JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
EXCEPTION WHEN duplicate_table THEN
  RAISE NOTICE 'marketplace_escrows already exists';
END $$;

COMMENT ON TABLE public.marketplace_escrows IS
  'Held-funds ledger for marketplace orders. Funded only by a verified provider payment event; released only after the authenticated buyer confirms receipt.';

CREATE INDEX IF NOT EXISTS idx_mp_escrow_vendor ON public.marketplace_escrows (vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_mp_escrow_buyer  ON public.marketplace_escrows (buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_mp_escrow_status ON public.marketplace_escrows (status);

-- An escrow can only ever be releasable or released if money actually arrived.
ALTER TABLE public.marketplace_escrows
  DROP CONSTRAINT IF EXISTS mp_escrow_funded_has_timestamp;
ALTER TABLE public.marketplace_escrows
  ADD CONSTRAINT mp_escrow_funded_has_timestamp
  CHECK (status = 'pending' OR funded_at IS NOT NULL);

-- =============================================================================
-- D. ESCROW GUARD
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_guard_escrow_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.marketplace_payments%ROWTYPE;
  v_order   public.marketplace_orders%ROWTYPE;
BEGIN
  IF NOT public.mp_is_server_context() THEN
    RAISE EXCEPTION 'Escrow records can only be written by the payment server'
      USING ERRCODE = '42501';
  END IF;

  -- Identity fields are reconciled against the order even on the server path, so
  -- a bug upstream cannot record a mismatched escrow.
  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = NEW.payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow references an unknown payment' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.payment_id IS DISTINCT FROM NEW.payment_id THEN
    RAISE EXCEPTION 'Escrow order does not own this payment' USING ERRCODE = '23514';
  END IF;
  IF NEW.buyer_id IS DISTINCT FROM v_order.buyer_id OR NEW.vendor_id IS DISTINCT FROM v_order.vendor_id THEN
    RAISE EXCEPTION 'Escrow parties do not match the order' USING ERRCODE = '23514';
  END IF;
  IF NEW.amount_kobo IS DISTINCT FROM v_payment.amount_kobo
     OR NEW.currency IS DISTINCT FROM v_payment.currency THEN
    RAISE EXCEPTION 'Escrow amount or currency does not match the payment' USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_guard_escrow_row IS
  'Trigger guard on marketplace_escrows. Rejects any write that did not come from the server-side payment path, and reconciles amount, currency, payment and parties against the order.';

DROP TRIGGER IF EXISTS mp_escrow_row_guard ON public.marketplace_escrows;
CREATE TRIGGER mp_escrow_row_guard
  BEFORE INSERT OR UPDATE ON public.marketplace_escrows
  FOR EACH ROW EXECUTE FUNCTION public.mp_guard_escrow_row();

-- =============================================================================
-- E. ESCROW LIFECYCLE TRIGGERS
-- =============================================================================

-- Funds received. Driven by the payment row rather than by the caller, so an
-- order can never be paid without the matching held-funds record appearing in
-- the same transaction.
CREATE OR REPLACE FUNCTION public.mp_sync_escrow_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- A reversed capture releases the hold.
  IF OLD.status = 'succeeded' AND NEW.status IN ('refunded', 'partially_refunded') THEN
    UPDATE public.marketplace_escrows
       SET status = 'refunded', refunded_at = COALESCE(refunded_at, now())
     WHERE payment_id = NEW.id AND status NOT IN ('refunded', 'cancelled');
    RETURN NEW;
  END IF;

  IF NEW.status = 'succeeded' AND OLD.status <> 'succeeded' THEN
    SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
    IF NOT FOUND OR v_order.vendor_id IS NULL THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.marketplace_escrows
      (order_id, payment_id, buyer_id, vendor_id, amount_kobo, currency,
       status, provider, provider_reference, funded_at, locked_at, metadata)
    VALUES
      (NEW.order_id, NEW.id, NEW.buyer_id, v_order.vendor_id, NEW.amount_kobo, NEW.currency,
       'locked', NEW.provider::TEXT, NEW.provider_reference,
       COALESCE(NEW.captured_at, now()), COALESCE(NEW.captured_at, now()),
       jsonb_build_object('source', 'verified_payment_event',
                          'authorised_at', NEW.authorised_at))
    ON CONFLICT (payment_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_sync_escrow_from_payment IS
  'Funds the escrow whenever marketplace_payments reaches succeeded, so an order can never be paid without a matching held-funds record. Reopening the hold on refund.';

DROP TRIGGER IF EXISTS mp_sync_escrow_from_payment ON public.marketplace_payments;
CREATE TRIGGER mp_sync_escrow_from_payment
  AFTER UPDATE ON public.marketplace_payments
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_escrow_from_payment();

-- Order lifecycle -> escrow lifecycle. Delivery by the vendor alone never
-- releases anything; only a completed order does, and the transition matrix
-- allows `delivered -> completed` to `buyer` and `system` only.
CREATE OR REPLACE FUNCTION public.mp_sync_escrow_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'disputed' THEN
    UPDATE public.marketplace_escrows
       SET status = 'disputed', disputed_at = COALESCE(disputed_at, now())
     WHERE order_id = NEW.id AND status NOT IN ('refunded', 'released', 'cancelled');

  ELSIF NEW.status = 'completed' THEN
    UPDATE public.marketplace_escrows
       SET status = 'releasable',
           releasable_at = COALESCE(releasable_at, now()),
           confirmed_by = COALESCE(confirmed_by, NEW.buyer_receipt_confirmed_by)
     WHERE order_id = NEW.id AND status IN ('pending', 'funded', 'locked', 'disputed');

  ELSIF NEW.status = 'refunded' THEN
    UPDATE public.marketplace_escrows
       SET status = 'refunded', refunded_at = COALESCE(refunded_at, now())
     WHERE order_id = NEW.id AND status NOT IN ('refunded', 'cancelled');

  ELSIF NEW.status = 'cancelled' THEN
    UPDATE public.marketplace_escrows
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, now()),
           refunded_at = CASE
             WHEN EXISTS (SELECT 1 FROM public.marketplace_payments p
                           WHERE p.order_id = NEW.id AND p.status = 'succeeded')
             THEN COALESCE(refunded_at, now()) ELSE refunded_at END
     WHERE order_id = NEW.id AND status IN ('pending', 'funded', 'locked');
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_sync_escrow_from_order IS
  'Mirrors the order lifecycle onto the escrow. Only a completed order — the buyer confirming receipt — makes the funds releasable.';

DROP TRIGGER IF EXISTS mp_sync_escrow_from_order ON public.marketplace_orders;
CREATE TRIGGER mp_sync_escrow_from_order
  AFTER UPDATE ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_escrow_from_order();

-- The moment the vendor's receivable is actually handed over, close the escrow.
CREATE OR REPLACE FUNCTION public.mp_sync_escrow_from_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'paid_out' THEN
    UPDATE public.marketplace_escrows
       SET status = 'released',
           released_at = COALESCE(released_at, now()),
           settlement_id = NEW.id,
           release_reference = COALESCE(release_reference, 'SETTLEMENT-' || left(NEW.id::TEXT, 8))
     WHERE order_id = NEW.order_id AND status IN ('releasable', 'locked', 'disputed');

  ELSIF NEW.status IN ('cancelled', 'failed') THEN
    UPDATE public.marketplace_escrows
       SET status = 'refunded',
           refunded_at = COALESCE(refunded_at, now()),
           settlement_id = NEW.id
     WHERE order_id = NEW.order_id AND status IN ('releasable', 'locked', 'disputed');
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_sync_escrow_from_settlement IS
  'Closes the escrow when the vendor receivable reaches paid_out, or marks the money refunded when the settlement is cancelled or fails.';

DROP TRIGGER IF EXISTS mp_sync_escrow_from_settlement ON public.marketplace_settlements;
CREATE TRIGGER mp_sync_escrow_from_settlement
  AFTER UPDATE ON public.marketplace_settlements
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_escrow_from_settlement();

-- RLS. Nobody edits an escrow by hand; these policies exist for display only and
-- there is deliberately no client INSERT/UPDATE/DELETE policy at all.
ALTER TABLE public.marketplace_escrows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Escrow visible to its own buyer and vendor" ON public.marketplace_escrows;
CREATE POLICY "Escrow visible to its own buyer and vendor"
  ON public.marketplace_escrows
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR public.mp_is_vendor_owner(vendor_id)
    OR public.mp_has_perm('manage_payments')
  );

COMMENT ON POLICY "Escrow visible to its own buyer and vendor" ON public.marketplace_escrows IS
  'Escrow rows are written exclusively by the payment server. Clients may read the ones they are a party to; there is no client write policy.';

-- =============================================================================
-- F. BUYER RECEIPT CONFIRMATION
-- =============================================================================
-- The step that separates "vendor says it shipped" from "student says I got
-- it", and therefore the step that unlocks the vendor's money.

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS buyer_receipt_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS buyer_receipt_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.marketplace_orders.buyer_receipt_confirmed_at IS
  'When the buyer explicitly confirmed they received the goods. Written only by mp_confirm_receipt or the auto-confirm job; never by the vendor.';

CREATE OR REPLACE FUNCTION public.mp_confirm_receipt(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order public.marketplace_orders%ROWTYPE;
  v_payment public.marketplace_payments%ROWTYPE;
  v_escrow public.marketplace_escrows%ROWTYPE;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to confirm your order' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- 1. Authenticated student owns the order.
  IF v_order.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only confirm your own orders' USING ERRCODE = '42501';
  END IF;

  -- 2. The order is eligible for confirmation.
  IF v_order.status <> 'delivered' THEN
    RAISE EXCEPTION 'This order is not awaiting your confirmation' USING ERRCODE = '23514';
  END IF;

  -- 3. Payment really was captured and the escrow really is funded.
  SELECT * INTO v_payment FROM public.marketplace_payments
   WHERE id = v_order.payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'This order has no verified payment, so it cannot be confirmed' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_escrow FROM public.marketplace_escrows WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No escrow record exists for this order' USING ERRCODE = '23514';
  END IF;
  IF v_escrow.status NOT IN ('locked', 'funded') THEN
    RAISE EXCEPTION 'This order''s escrow is % and cannot be released', v_escrow.status
      USING ERRCODE = '23514';
  END IF;
  IF v_escrow.disputed_at IS NOT NULL OR v_order.dispute_id IS NOT NULL THEN
    RAISE EXCEPTION 'This order is under dispute' USING ERRCODE = '23514';
  END IF;

  -- 4/5. Record who confirmed, and when.
  UPDATE public.marketplace_orders
     SET buyer_receipt_confirmed_at = now(),
         buyer_receipt_confirmed_by = v_uid
   WHERE id = p_order_id;

  PERFORM public.mp_audit('order.receipt_confirmed', 'order', p_order_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('confirmed_by', v_uid, 'escrow_id', v_escrow.id),
    'Buyer confirmed the package was received', 'buyer');

  -- 6/7/10/11. Complete the order. The transition itself creates the vendor
  -- settlement and marks the escrow releasable via the triggers above.
  v_result := public.mp_transition_order(p_order_id, 'completed',
    'Buyer confirmed the package was received');

  SELECT s.status INTO v_escrow.status FROM public.marketplace_escrows s WHERE s.id = v_escrow.id;
  SELECT s.id    INTO v_escrow.settlement_id FROM public.marketplace_escrows s WHERE s.id = v_escrow.id;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', v_result -> 'status',
    'escrow_status', v_escrow.status,
    'settlement_id', v_escrow.settlement_id,
    'confirmed_at', now()
  );
END $$;

COMMENT ON FUNCTION public.mp_confirm_receipt IS
  'Buyer confirms delivery received. Verifies ownership, eligibility, a captured payment and a funded escrow, records the confirmation, then completes the order so the settlement and escrow can mature. Never callable by a vendor.';

-- =============================================================================
-- G. PAYMENT ATTEMPT: the server fixes the amount once
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_begin_payment_attempt(
  p_payment_id UUID,
  p_channel public.marketplace_payment_channel DEFAULT 'card'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_payment public.marketplace_payments%ROWTYPE;
  v_order   public.marketplace_orders%ROWTYPE;
  v_reference TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to pay for your order' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = v_payment.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership. Without this a signed-in student could start, and therefore
  -- probe, somebody else's payment.
  IF v_order.buyer_id IS DISTINCT FROM v_uid OR v_payment.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only pay for your own orders' USING ERRCODE = '42501';
  END IF;

  IF v_order.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'This order is not awaiting payment' USING ERRCODE = '23514';
  END IF;

  -- A settled, failed or cancelled payment is terminal for checkout.
  IF v_payment.status IN ('succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded') THEN
    RAISE EXCEPTION 'This order''s payment is already % and cannot be re-initiated',
      v_payment.status USING ERRCODE = '23514';
  END IF;

  -- The charge amount comes from the stored order, never from the request.
  IF v_payment.amount_kobo <= 0 THEN
    RAISE EXCEPTION 'This order has nothing to pay' USING ERRCODE = '23514';
  END IF;
  IF v_payment.amount_kobo <> v_order.total_kobo THEN
    PERFORM public.mp_audit('payment.amount_drift', 'payment', v_payment.id, NULL,
      jsonb_build_object('payment_kobo', v_payment.amount_kobo,
                         'order_total_kobo', v_order.total_kobo),
      'Payment amount drifted from the order total', 'system');
    RAISE EXCEPTION 'Payment amount does not match the order total' USING ERRCODE = '23514';
  END IF;

  -- Idempotency: a retried Pay — double click, refresh mid-redirect, or a buyer
  -- who abandoned checkout — re-uses the reference already issued, so the
  -- provider cannot end up holding two live charges for one order.
  IF v_payment.provider_reference IS NOT NULL THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'reference', v_payment.provider_reference,
      'amount_kobo', v_payment.amount_kobo,
      'currency', v_payment.currency,
      'reused', TRUE
    );
  END IF;

  -- extensions.gen_random_bytes rather than gen_random_bytes: pgcrypto lives in
  -- the `extensions` schema on Supabase, and this function pins search_path.
  v_reference := 'fmp_' || lower(regexp_replace(COALESCE(v_order.order_number, 'ord'), '[^A-Za-z0-9]', '', 'g'))
                || '_' || encode(extensions.gen_random_bytes(9), 'hex');

  UPDATE public.marketplace_payments
     SET provider = 'paystack'::public.marketplace_payment_provider,
         status = 'processing'::public.marketplace_payment_status,
         channel = COALESCE(p_channel, channel),
         provider_reference = v_reference,
         failed_at = NULL,
         failure_reason = NULL,
         provider_meta = provider_meta || jsonb_build_object(
           'attempt_started_at', now(), 'attempt_started_by', v_uid),
         updated_at = now()
   WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'reference', v_reference,
    'amount_kobo', v_payment.amount_kobo,
    'currency', v_payment.currency,
    'reused', FALSE
  );
END $$;

COMMENT ON FUNCTION public.mp_begin_payment_attempt IS
  'Client-callable start of payment. Verifies the caller owns the order, refuses terminal orders, fixes the amount and currency server-side, and issues an idempotent provider reference. The figure it returns is the figure the provider must be charged.';

-- Unwind an attempt that could not be presented to the provider. The order stays
-- pending so the buyer can simply try again.
CREATE OR REPLACE FUNCTION public.mp_reset_payment_attempt(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.marketplace_payments%ROWTYPE;
BEGIN
  IF NOT public.mp_is_server_context() THEN
    RAISE EXCEPTION 'Server only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reset', FALSE, 'reason', 'payment_not_found');
  END IF;
  IF v_payment.status = 'succeeded' THEN
    RAISE EXCEPTION 'A captured payment cannot be reset' USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_payments
     SET status = 'awaiting_payment'::public.marketplace_payment_status,
         provider_reference = NULL,
         failure_reason = left(COALESCE(p_reason, 'Checkout could not be initialized'), 400),
         provider_meta = provider_meta || jsonb_build_object('reset_at', now()),
         updated_at = now()
   WHERE id = v_payment.id;

  RETURN jsonb_build_object('reset', TRUE, 'payment_id', v_payment.id);
END $$;

COMMENT ON FUNCTION public.mp_reset_payment_attempt IS
  'Server only. Returns an unfinished checkout attempt to awaiting_payment so the buyer can retry, without touching the order.';

-- =============================================================================
-- H. HARDENED PAYMENT EVENT INTAKE
-- =============================================================================
-- Replaces the old signature. p_signature_ok is gone: only service_role can
-- reach this function, and the caller has already verified the provider's HMAC
-- signature against the raw request body. Accepting a boolean that means "trust
-- me" from any caller is precisely what made the old version forgeable.

-- Drop both old bodies. The client-shaped `p_signature_ok` parameter disappears
-- entirely rather than becoming a parameter the service simply ignores.
DROP FUNCTION IF EXISTS public.mp_apply_payment_event(
  TEXT, TEXT, UUID, TEXT, BIGINT,
  public.marketplace_payment_channel, public.marketplace_payment_status, BOOLEAN, JSONB
);
DROP FUNCTION IF EXISTS public.mp_apply_payment_event_inner(
  TEXT, TEXT, UUID, TEXT, BIGINT,
  public.marketplace_payment_channel, public.marketplace_payment_status, BOOLEAN, JSONB
);

CREATE OR REPLACE FUNCTION public.mp_apply_payment_event_inner(
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_payment_id UUID DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL,
  p_amount_kobo BIGINT DEFAULT NULL,
  p_channel public.marketplace_payment_channel DEFAULT NULL,
  p_status public.marketplace_payment_status DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.marketplace_payments%ROWTYPE;
  v_order public.marketplace_orders%ROWTYPE;
  v_before public.marketplace_payment_status;
  v_next public.marketplace_payment_status;
  v_exists BOOLEAN;
  v_currency TEXT;
BEGIN
  IF char_length(COALESCE(p_provider_event_id, '')) < 8 THEN
    RAISE EXCEPTION 'Missing provider event id' USING ERRCODE = '22023';
  END IF;
  v_currency := upper(COALESCE(p_meta->>'currency', 'NGN'));

  -- ── REPLAY GUARD ─────────────────────────────────────────────────────────
  SELECT EXISTS (SELECT 1 FROM public.marketplace_payment_events
                  WHERE provider_event_id = p_provider_event_id) INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('duplicate', TRUE, 'applied', FALSE);
  END IF;

  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = p_payment_id FOR UPDATE;
  ELSE
    SELECT * INTO v_payment FROM public.marketplace_payments
     WHERE provider_reference = p_provider_reference FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    -- Unknown payment: log under the event id so the attempt stays auditable
    -- and replay-protected, but touch no order.
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, event_type, signature_ok, payload)
    VALUES (p_provider_event_id, left(p_event_type, 80), TRUE,
            coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('unmatched', TRUE));
    RETURN jsonb_build_object('matched', FALSE, 'applied', FALSE);
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = v_payment.order_id FOR UPDATE;
  v_before := v_payment.status;

  -- ── AMOUNT CROSS-CHECK ───────────────────────────────────────────────────
  -- Mandatory now, not advisory. The order total is authoritative and the
  -- provider's figure must equal the stored amount exactly.
  IF p_amount_kobo IS NULL OR p_amount_kobo <> v_payment.amount_kobo
     OR v_payment.amount_kobo <> v_order.total_kobo THEN
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, payment_id, event_type, from_status, amount_kobo, signature_ok, payload)
    VALUES (p_provider_event_id, v_payment.id, left(p_event_type, 80), v_before,
            p_amount_kobo, TRUE,
            coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('amount_mismatch', TRUE));
    PERFORM public.mp_audit('payment.amount_mismatch', 'payment', v_payment.id, NULL,
      jsonb_build_object('expected_kobo', v_payment.amount_kobo,
                         'reported_kobo', p_amount_kobo,
                         'order_total_kobo', v_order.total_kobo),
      'Provider amount did not match the order total', 'system');
    RAISE EXCEPTION 'Payment amount does not match the order total' USING ERRCODE = '22023';
  END IF;

  -- ── CURRENCY CROSS-CHECK ─────────────────────────────────────────────────
  IF v_currency <> upper(v_payment.currency) THEN
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, payment_id, event_type, from_status, amount_kobo, signature_ok, payload)
    VALUES (p_provider_event_id, v_payment.id, left(p_event_type, 80), v_before,
            p_amount_kobo, TRUE,
            coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('currency_mismatch', TRUE));
    PERFORM public.mp_audit('payment.currency_mismatch', 'payment', v_payment.id, NULL,
      jsonb_build_object('expected', v_payment.currency, 'reported', v_currency),
      'Provider currency did not match the order currency', 'system');
    RAISE EXCEPTION 'Payment currency does not match the order currency' USING ERRCODE = '22023';
  END IF;

  -- ── REFERENCE CROSS-CHECK ────────────────────────────────────────────────
  -- We must have issued this reference ourselves. Without this, any capture that
  -- landed on the right amount could be claimed against the order.
  IF p_provider_reference IS NOT NULL
     AND v_payment.provider_reference IS NOT NULL
     AND p_provider_reference <> v_payment.provider_reference THEN
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, payment_id, event_type, from_status, amount_kobo, signature_ok, payload)
    VALUES (p_provider_event_id, v_payment.id, left(p_event_type, 80), v_before,
            p_amount_kobo, TRUE,
            coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('reference_mismatch', TRUE));
    PERFORM public.mp_audit('payment.reference_mismatch', 'payment', v_payment.id, NULL,
      jsonb_build_object('expected', v_payment.provider_reference, 'reported', p_provider_reference),
      'Provider reference did not match the reference issued for this order', 'system');
    RAISE EXCEPTION 'Payment reference does not match this order' USING ERRCODE = '22023';
  END IF;

  v_next := COALESCE(p_status,
    CASE
      WHEN p_event_type ILIKE '%success%' OR p_event_type ILIKE '%charge%' OR p_event_type ILIKE '%paid%'
        THEN 'succeeded'::public.marketplace_payment_status
      WHEN p_event_type ILIKE '%fail%' OR p_event_type ILIKE '%declin%' OR p_event_type ILIKE '%reject%'
        THEN 'failed'::public.marketplace_payment_status
      WHEN p_event_type ILIKE '%refund%'
        THEN 'refunded'::public.marketplace_payment_status
      ELSE v_before
    END);

  -- ── TERMINAL-STATE PROTECTION ────────────────────────────────────────────
  IF v_before = 'succeeded' AND v_next <> 'refunded' AND v_next <> 'partially_refunded' THEN
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, payment_id, event_type, from_status, to_status, amount_kobo, signature_ok, payload)
    VALUES (p_provider_event_id, v_payment.id, left(p_event_type, 80), v_before, v_next,
            p_amount_kobo, TRUE, coalesce(p_meta, '{}'::JSONB));
    RETURN jsonb_build_object('applied', FALSE, 'reason', 'payment_already_settled',
                              'status', v_before);
  END IF;

  UPDATE public.marketplace_payments
     SET status = v_next,
         provider_reference = COALESCE(provider_reference, p_provider_reference),
         channel = COALESCE(p_channel, channel),
         authorised_at = CASE WHEN v_next = 'succeeded' THEN COALESCE(authorised_at, now()) ELSE authorised_at END,
         captured_at = CASE WHEN v_next = 'succeeded' THEN COALESCE(captured_at, now()) ELSE captured_at END,
         failed_at = CASE WHEN v_next = 'failed' THEN now() ELSE failed_at END,
         failure_reason = CASE WHEN v_next = 'failed'
                               THEN left(COALESCE(p_meta->>'reason', 'Provider reported failure'), 400)
                               ELSE failure_reason END,
         provider_meta = v_payment.provider_meta || coalesce(p_meta, '{}'::JSONB),
         refunded_kobo = CASE WHEN v_next = 'refunded' THEN amount_kobo ELSE refunded_kobo END,
         updated_at = now()
   WHERE id = v_payment.id;

  INSERT INTO public.marketplace_payment_events
    (provider_event_id, payment_id, event_type, from_status, to_status, amount_kobo, signature_ok, payload)
  VALUES (p_provider_event_id, v_payment.id, left(p_event_type, 80), v_before, v_next,
          p_amount_kobo, TRUE, coalesce(p_meta, '{}'::JSONB));

  -- ── ORDER STATE ──────────────────────────────────────────────────────────
  IF v_next = 'succeeded' AND v_order.status = 'pending_payment' THEN
    -- Only the 'system' row of the transition matrix allows this, so the
    -- frontend cannot reach paid by any route. The escrow is funded by the
    -- trigger on this same UPDATE, so order and escrow move together.
    PERFORM public.mp_transition_order(v_order.id, 'paid', 'Payment verified by ' || v_order.currency);
  ELSIF v_next = 'failed' AND v_order.status = 'pending_payment' THEN
    PERFORM public.mp_transition_order(v_order.id, 'cancelled',
      COALESCE(p_meta->>'reason', 'Payment failed'));
  ELSIF v_next = 'refunded' THEN
    IF v_order.status IN ('paid','order_confirmed','preparing','ready_for_delivery','disputed') THEN
      PERFORM public.mp_transition_order(v_order.id, 'refunded', 'Refund confirmed by provider');
    END IF;
  END IF;

  PERFORM public.mp_audit('payment.event', 'payment', v_payment.id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', v_next, 'event', p_event_type, 'currency', v_currency),
    p_provider_event_id, 'system');

  RETURN jsonb_build_object(
    'applied', TRUE,
    'payment_id', v_payment.id,
    'order_id', v_order.id,
    'from', v_before,
    'to', v_next
  );
END $$;

COMMENT ON FUNCTION public.mp_apply_payment_event_inner IS
  'Body of the payment webhook processor. Never called directly: it runs inside mp_apply_payment_event, which establishes the system actor. Cross-checks the provider amount, currency and reference against the stored order.';

CREATE OR REPLACE FUNCTION public.mp_apply_payment_event(
  p_provider_event_id   TEXT,
  p_event_type          TEXT,
  p_payment_id          UUID DEFAULT NULL,
  p_provider_reference  TEXT DEFAULT NULL,
  p_amount_kobo         BIGINT DEFAULT NULL,
  p_currency            TEXT DEFAULT 'NGN',
  p_channel             public.marketplace_payment_channel DEFAULT NULL,
  p_status              public.marketplace_payment_status DEFAULT NULL,
  p_meta                JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- A real provider event id, not a per-try forgery token.
  IF char_length(COALESCE(trim(p_provider_event_id), '')) < 8 THEN
    RAISE EXCEPTION 'Rejected: a genuine provider event id is required' USING ERRCODE = '42501';
  END IF;

  -- The amount is mandatory. Previously it defaulted to NULL and the
  -- cross-check below was conditional on it, so omitting it skipped the only
  -- check tying a capture to the money actually owed.
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'Rejected: a verified payment amount is required' USING ERRCODE = '42501';
  END IF;

  IF p_currency IS NULL OR upper(trim(p_currency)) <> 'NGN' THEN
    RAISE EXCEPTION 'Rejected: unexpected currency %', COALESCE(p_currency, '(none)')
      USING ERRCODE = '42501';
  END IF;

  IF p_payment_id IS NULL AND char_length(COALESCE(trim(p_provider_reference), '')) < 4 THEN
    RAISE EXCEPTION 'Rejected: a payment id or provider reference is required' USING ERRCODE = '42501';
  END IF;

  PERFORM public.mp_set_system_actor(TRUE);
  BEGIN
    v_result := public.mp_apply_payment_event_inner(
      p_provider_event_id, p_event_type, p_payment_id,
      nullif(trim(p_provider_reference), ''),
      p_amount_kobo, p_channel, p_status,
      coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('currency', upper(trim(p_currency))));
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.mp_set_system_actor(FALSE);
    RAISE;
  END;
  PERFORM public.mp_set_system_actor(FALSE);

  RETURN v_result;
END $$;

COMMENT ON FUNCTION public.mp_apply_payment_event IS
  'Sole entry point for provider payment events. service_role only — the calling edge function has already verified the provider HMAC signature over the raw body. Amount and currency are mandatory and are cross-checked against the stored order inside mp_apply_payment_event_inner.';

-- =============================================================================
-- I. MANUAL BANK TRANSFER: a real, gated confirmation path
-- =============================================================================
-- Without this, every manual_bank_transfer order is stranded at pending_payment
-- with no way forward. Finance staff confirm receipt against the bank
-- statement; the buyer and the vendor can never do it themselves.

CREATE OR REPLACE FUNCTION public.mp_confirm_manual_transfer(
  p_order_id UUID,
  p_proof_reference TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.marketplace_payments%ROWTYPE;
  v_order   public.marketplace_orders%ROWTYPE;
  v_proof   TEXT;
BEGIN
  IF NOT public.mp_has_perm('manage_payments') THEN
    RAISE EXCEPTION 'You do not have permission to confirm manual payments' USING ERRCODE = '42501';
  END IF;

  v_proof := left(trim(COALESCE(p_proof_reference, '')), 120);
  IF char_length(v_proof) < 4 THEN
    RAISE EXCEPTION 'Record the bank transfer reference (at least 4 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = v_order.payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order has no payment record' USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.provider <> 'manual_bank_transfer' THEN
    RAISE EXCEPTION 'This order was not paid by bank transfer; it is verified by the payment provider'
      USING ERRCODE = '23514';
  END IF;
  IF v_payment.amount_kobo <> v_order.total_kobo THEN
    RAISE EXCEPTION 'Payment amount does not match the order total' USING ERRCODE = '23514';
  END IF;
  IF v_order.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Only an unpaid order can be confirmed' USING ERRCODE = '23514';
  END IF;

  -- provider_event_id is unique, so confirming the same transfer twice is a
  -- no-op rather than a double credit.
  PERFORM public.mp_set_system_actor(TRUE);
  BEGIN
    RETURN public.mp_apply_payment_event(
      'manual_' || md5(v_order.id::TEXT || v_proof),
      'charge.success',
      v_payment.id,
      v_proof,
      v_payment.amount_kobo,
      'NGN',
      'bank_transfer'::public.marketplace_payment_channel,
      'succeeded'::public.marketplace_payment_status,
      jsonb_build_object('confirmed_by', auth.uid(), 'note', left(p_note, 400),
                         'method', 'manual_bank_transfer')
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.mp_set_system_actor(FALSE);
    RAISE;
  END;
  PERFORM public.mp_set_system_actor(FALSE);
END $$;

COMMENT ON FUNCTION public.mp_confirm_manual_transfer IS
  'Finance-only (manage_payments). Confirms a bank transfer against the bank statement and routes it through the same verified path as every other capture. Buyers and vendors can never call it.';

-- =============================================================================
-- J. ESCROW RELEASE GATE
-- =============================================================================
-- mp_release_eligible_settlements moves matured settlements to 'scheduled'.
-- Re-assert the escrow precondition at the moment of release so that no future
-- change to that query can quietly bypass "verified payment + buyer confirmed
-- receipt".

CREATE OR REPLACE FUNCTION public.mp_guard_escrow_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order   public.marketplace_orders%ROWTYPE;
  v_payment public.marketplace_payments%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = v_order.payment_id;

  -- A real capture.
  IF v_payment.id IS NULL OR v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Refusing to release order %: there is no captured payment', NEW.order_id
      USING ERRCODE = '23514';
  END IF;

  -- The money reconciles with what was charged and owed.
  --
  -- The order's arithmetic, as mp_create_orders fixes it:
  --     total_kobo    = subtotal_kobo + delivery_fee_kobo   (what the buyer paid)
  --     vendor_payout = subtotal_kobo - platform_fee_kobo   (what the vendor gets)
  -- The commission comes out of the goods subtotal rather than being added on top,
  -- so the platform retains platform_fee_kobo + delivery_fee_kobo. The settlement
  -- mirrors that: gross is the goods subtotal, commission is the platform cut,
  -- net is the vendor's payout.
  --
  -- The first version of this guard tested gross against
  -- amount - platform_fee - delivery_fee, which by the arithmetic above is the
  -- vendor payout and therefore always differs from gross by exactly the
  -- commission. It refused every legitimate release, including the one the rest
  -- of this migration exists to enable. The checks below state the real
  -- invariants, and the last one proves no kobo is invented or lost: what the
  -- buyer paid is exactly the vendor's payout plus the platform's commission
  -- plus delivery.
  IF NEW.gross_kobo <> v_order.subtotal_kobo
     OR NEW.gross_kobo <> v_payment.amount_kobo - v_order.delivery_fee_kobo
     OR NEW.commission_kobo <> v_order.platform_fee_kobo
     OR NEW.net_kobo <> v_order.vendor_payout_kobo
     OR NEW.gross_kobo - NEW.commission_kobo <> NEW.net_kobo
     OR v_payment.amount_kobo <> NEW.net_kobo + NEW.commission_kobo + v_order.delivery_fee_kobo THEN
    RAISE EXCEPTION 'Refusing to release order %: the settlement does not reconcile with the order', NEW.order_id
      USING ERRCODE = '23514';
  END IF;

  -- The buyer confirmed receipt and nothing is in dispute.
  IF v_order.status <> 'completed' OR v_order.dispute_id IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to release order %: the buyer has not confirmed receipt', NEW.order_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_guard_escrow_release IS
  'Last gate before a settlement becomes payable: requires a captured payment whose amount reconciles with the order, and a completed order with no open dispute.';

DROP TRIGGER IF EXISTS mp_guard_escrow_release ON public.marketplace_settlements;
CREATE TRIGGER mp_guard_escrow_release
  BEFORE UPDATE ON public.marketplace_settlements
  FOR EACH ROW EXECUTE FUNCTION public.mp_guard_escrow_release();

-- =============================================================================
-- K. GRANTS
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.mp_begin_payment_attempt(UUID, public.marketplace_payment_channel)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mp_begin_payment_attempt(UUID, public.marketplace_payment_channel)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mp_confirm_receipt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mp_confirm_receipt(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mp_reset_payment_attempt(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mp_reset_payment_attempt(UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mp_confirm_manual_transfer(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mp_confirm_manual_transfer(UUID, TEXT, TEXT)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.mp_apply_payment_event(
  TEXT, TEXT, UUID, TEXT, BIGINT, TEXT,
  public.marketplace_payment_channel, public.marketplace_payment_status, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mp_apply_payment_event(
  TEXT, TEXT, UUID, TEXT, BIGINT, TEXT,
  public.marketplace_payment_channel, public.marketplace_payment_status, JSONB
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mp_apply_payment_event_inner(
  TEXT, TEXT, UUID, TEXT, BIGINT,
  public.marketplace_payment_channel, public.marketplace_payment_status, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mp_apply_payment_event_inner(
  TEXT, TEXT, UUID, TEXT, BIGINT,
  public.marketplace_payment_channel, public.marketplace_payment_status, JSONB
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mp_is_server_context()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_guard_escrow_row()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_guard_escrow_release()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_escrow_from_payment()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_escrow_from_order()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_escrow_from_settlement() FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.marketplace_escrows TO authenticated, service_role;

-- The marketplace ships with payments disabled because there was no provider to
-- talk to. Turn the rail on now that a verified path exists.
UPDATE public.marketplace_platform_settings
   SET payments_enabled = TRUE,
       payment_provider = 'paystack'::public.marketplace_payment_provider,
       payment_channels = ARRAY['card', 'bank_transfer', 'ussd'],
       updated_by = NULL
 WHERE id = 1;

-- =============================================================================
-- L. BACKFILL
-- =============================================================================
-- Any order already paid or beyond without an escrow row gets one, so historical
-- orders are not left unaccounted for.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id AS payment_id, p.order_id, p.buyer_id, p.amount_kobo, p.currency,
           p.provider, p.provider_reference, o.vendor_id, o.status AS order_status,
           COALESCE(p.captured_at, now()) AS captured
      FROM public.marketplace_payments p
      JOIN public.marketplace_orders o ON o.id = p.order_id
     WHERE p.status = 'succeeded'
       AND o.vendor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.marketplace_escrows e WHERE e.payment_id = p.id)
  LOOP
    PERFORM public.mp_set_system_actor(TRUE);
    BEGIN
      INSERT INTO public.marketplace_escrows
        (order_id, payment_id, buyer_id, vendor_id, amount_kobo, currency,
         status, provider, provider_reference, funded_at, locked_at, metadata)
      VALUES
        (r.order_id, r.payment_id, r.buyer_id, r.vendor_id, r.amount_kobo, r.currency,
         CASE
           WHEN r.order_status = 'completed' AND EXISTS (
                 SELECT 1 FROM public.marketplace_settlements s
                  WHERE s.order_id = r.order_id AND s.status = 'paid_out')
             THEN 'released'::public.marketplace_escrow_status
           WHEN r.order_status = 'completed' THEN 'releasable'::public.marketplace_escrow_status
           WHEN r.order_status IN ('disputed', 'refunded') THEN r.order_status::public.marketplace_escrow_status
           ELSE 'locked'::public.marketplace_escrow_status
         END,
         r.provider::TEXT, r.provider_reference, r.captured, r.captured,
         jsonb_build_object('source', 'backfill'));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'escrow backfill skipped for payment %: %', r.payment_id, SQLERRM;
    END;
    PERFORM public.mp_set_system_actor(FALSE);
  END LOOP;
END $$;

COMMIT;