-- =============================================================================
-- FUW STUDENT MARKETPLACE — MIGRATION 03: ORDER STATE MACHINE, PAYMENTS,
--                              SETTLEMENTS AND WITHDRAWALS
-- =============================================================================
-- This is the anti-scam core. Three properties are enforced here and nowhere
-- else:
--
--   A. Status is server-determined. mp_transition_order() consults the
--      marketplace_order_transitions matrix, resolves the caller's real role
--      from the data (never from a parameter), and refuses anything the matrix
--      does not allow. There is no UPDATE policy on marketplace_orders.status.
--
--   B. Payment is server-verified. Only mp_apply_payment_event() can mark an
--      order paid, it requires a provider event id that is UNIQUE in the
--      database (replay defence), and it cross-checks the amount against the
--      order. A client that "reports" a successful payment changes nothing.
--
--   C. Money stays put while a dispute is open. Settlement rows are created at
--      completion but stay 'pending'; a dispute flips them to 'on_hold', and
--      release only ever moves rows whose eligible_at has passed, whose order
--      is completed, and which are not held.
-- =============================================================================

-- =============================================================================
-- ORDER TRANSITION
-- =============================================================================

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
        SELECT id, -quantity, quantity_total - quantity_sold, 'sale', v_uid, p_order_id,
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
       SET settlement_status = CASE WHEN v_rule.marks_refunded THEN 'cancelled'
                                   ELSE 'on_hold' END
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

    IF v_notif NOT IN ('payment_confirmed','payment_failed','payment_opened') THEN
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
END $$;

COMMENT ON FUNCTION public.mp_transition_order IS
  'The only writer of marketplace_orders.status. Resolves the caller role from stored relationships, validates the move against marketplace_order_transitions, applies stock/settlement/notification side effects and writes an immutable history row.';

-- =============================================================================
-- PAYMENT WEBHOOK PROCESSING
-- =============================================================================

-- Called ONLY by the marketplace-webhook edge function, which holds the
-- service-role key and has already verified the provider HMAC signature.
--
-- Replay defence is two-layered:
--   1. marketplace_payment_events.provider_event_id is UNIQUE. A replayed
--      webhook fails on insert and aborts before any state changes.
--   2. A payment already in a terminal state ('succeeded') is a no-op.
--
-- Amount is re-derived from the order, never taken from the webhook body, and a
-- mismatch raises rather than partially applying.
CREATE OR REPLACE FUNCTION public.mp_apply_payment_event_inner(
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_payment_id UUID DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL,
  p_amount_kobo BIGINT DEFAULT NULL,
  p_channel public.marketplace_payment_channel DEFAULT NULL,
  p_status public.marketplace_payment_status DEFAULT NULL,
  p_signature_ok BOOLEAN DEFAULT TRUE,
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
BEGIN
  IF char_length(COALESCE(p_provider_event_id, '')) < 4 THEN
    RAISE EXCEPTION 'Missing provider event id' USING ERRCODE = '22023';
  END IF;

  IF NOT p_signature_ok THEN
    RAISE EXCEPTION 'Rejected: signature verification failed' USING ERRCODE = '42501';
  END IF;

  -- ── REPLAY GUARD ─────────────────────────────────────────────────────────
  -- If this event id was already processed, report it and change nothing.
  SELECT EXISTS (SELECT 1 FROM public.marketplace_payment_events
                  WHERE provider_event_id = p_provider_event_id) INTO v_exists;
  IF v_exists THEN
    RETURN jsonb_build_object('duplicate', TRUE, 'applied', FALSE);
  END IF;

  -- Resolve the payment row.
  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = p_payment_id FOR UPDATE;
  ELSE
    SELECT * INTO v_payment FROM public.marketplace_payments
     WHERE provider_reference = p_provider_reference FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    -- Unknown payment: log the attempt under a synthetic id so it is auditable
    -- and replay-protected, but touch no order.
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, event_type, signature_ok, payload)
    VALUES (p_provider_event_id, left(p_event_type, 80), p_signature_ok,
            coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('unmatched', TRUE));
    RETURN jsonb_build_object('matched', FALSE, 'applied', FALSE);
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = v_payment.order_id FOR UPDATE;
  v_before := v_payment.status;

  -- ── AMOUNT CROSS-CHECK ───────────────────────────────────────────────────
  -- The webhook amount is advisory. The order total is authoritative. A
  -- provider that reports a different number is a red flag, not a correction.
  IF p_amount_kobo IS NOT NULL AND p_amount_kobo <> v_payment.amount_kobo THEN
    INSERT INTO public.marketplace_payment_events
      (provider_event_id, payment_id, event_type, from_status, amount_kobo, signature_ok, payload)
    VALUES (p_provider_event_id, v_payment.id, left(p_event_type, 80), v_before,
            p_amount_kobo, p_signature_ok,
            coalesce(p_meta, '{}'::JSONB) || jsonb_build_object('amount_mismatch', TRUE));
    PERFORM public.mp_audit('payment.amount_mismatch', 'payment', v_payment.id, NULL,
      jsonb_build_object('expected_kobo', v_payment.amount_kobo, 'reported_kobo', p_amount_kobo),
      'Provider amount did not match the order total', 'system');
    RAISE EXCEPTION 'Payment amount does not match the order total' USING ERRCODE = '22023';
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
            p_amount_kobo, p_signature_ok, coalesce(p_meta, '{}'::JSONB));
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
          COALESCE(p_amount_kobo, v_payment.amount_kobo), p_signature_ok,
          coalesce(p_meta, '{}'::JSONB));

  -- ── ORDER STATE ──────────────────────────────────────────────────────────
  IF v_next = 'succeeded' AND v_order.status = 'pending_payment' THEN
    -- Only the 'system' row of the transition matrix allows this, so the
    -- frontend cannot reach paid by any route.
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
    jsonb_build_object('status', v_next, 'event', p_event_type),
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
  'Body of the payment webhook processor. Never called directly: it runs inside mp_apply_payment_event, which establishes the system actor.';

-- The only entry point. A verified webhook has no user session, so the call is
-- wrapped in the transaction-local system actor — that is what lets it use the
-- system-only pending_payment -> paid rule. The flag is cleared on every exit
-- path, including exceptions, so it can never leak to a later pooled request.
CREATE OR REPLACE FUNCTION public.mp_apply_payment_event(
  p_provider_event_id TEXT,
  p_event_type TEXT,
  p_payment_id UUID DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL,
  p_amount_kobo BIGINT DEFAULT NULL,
  p_channel public.marketplace_payment_channel DEFAULT NULL,
  p_status public.marketplace_payment_status DEFAULT NULL,
  p_signature_ok BOOLEAN DEFAULT TRUE,
  p_meta JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  -- A caller-supplied "signature_ok = true" is meaningless. Verification must
  -- have happened in the edge function that holds the provider secret; the
  -- privilege to claim it is revoked from every client role in migration 05.
  IF NOT COALESCE(p_signature_ok, FALSE) THEN
    RAISE EXCEPTION 'Rejected: signature verification failed' USING ERRCODE = '42501';
  END IF;

  PERFORM public.mp_set_system_actor(TRUE);
  BEGIN
    v_result := public.mp_apply_payment_event_inner(
      p_provider_event_id, p_event_type, p_payment_id, p_provider_reference,
      p_amount_kobo, p_channel, p_status, p_signature_ok, p_meta);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.mp_set_system_actor(FALSE);
    RAISE;
  END;
  PERFORM public.mp_set_system_actor(FALSE);

  RETURN v_result;
END $$;

COMMENT ON FUNCTION public.mp_apply_payment_event IS
  'Server-side payment verification. UNIQUE(provider_event_id) blocks webhook replay, the provider amount is cross-checked against the order total, and only this function can move an order into paid (via the system-only transition rule).';

-- Finance-side manual refund. Staff only, bounded by what was captured, and it
-- cannot exceed the order total.
CREATE OR REPLACE FUNCTION public.mp_issue_refund(
  p_order_id UUID,
  p_amount_kobo BIGINT,
  p_reason TEXT,
  p_dispute_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_payment public.marketplace_payments%ROWTYPE;
  v_settle public.marketplace_settlements%ROWTYPE;
  v_refundable BIGINT;
  v_new_gross BIGINT;
  v_new_comm BIGINT;
  v_new_net BIGINT;
BEGIN
  IF NOT public.mp_has_perm('issue_refunds') THEN
    RAISE EXCEPTION 'You do not have permission to issue refunds' USING ERRCODE = '42501';
  END IF;
  IF char_length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'A refund needs a written reason' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = v_order.payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Only a captured payment can be refunded' USING ERRCODE = '23514';
  END IF;

  v_refundable := v_payment.amount_kobo - v_payment.refunded_kobo;
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'Enter a refund amount' USING ERRCODE = '22023';
  END IF;
  IF p_amount_kobo > v_refundable THEN
    RAISE EXCEPTION 'Refund exceeds the refundable balance of NGN %s',
      to_char(v_refundable / 100.0, 'FM999999999990.00') USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_payments
     SET refunded_kobo = refunded_kobo + p_amount_kobo,
         status = CASE WHEN refunded_kobo + p_amount_kobo >= amount_kobo
                       THEN 'refunded'::public.marketplace_payment_status
                       ELSE 'partially_refunded'::public.marketplace_payment_status END,
         updated_at = now()
   WHERE id = v_payment.id;

  -- A full refund cancels the vendor's receivable immediately. A partial refund
  -- reduces it so the vendor is paid only what the buyer actually kept.
  --
  -- The three columns are computed in variables, not in the UPDATE list. In a
  -- single UPDATE every expression reads the OLD row, so writing the reduced
  -- gross, the proportional commission and the net in the same statement would
  -- mix old and new figures and trip mp_settlement_math.
  SELECT * INTO v_settle FROM public.marketplace_settlements
   WHERE order_id = p_order_id AND status <> 'paid_out'
   FOR UPDATE;

  IF FOUND THEN
    IF p_amount_kobo >= v_order.subtotal_kobo THEN
      UPDATE public.marketplace_settlements
         SET status = 'cancelled', hold_reason = left(p_reason, 400), updated_at = now()
       WHERE id = v_settle.id;
      UPDATE public.marketplace_orders SET settlement_status = 'cancelled' WHERE id = p_order_id;
    ELSE
      v_new_gross := GREATEST(0, v_settle.gross_kobo - p_amount_kobo);
      -- Commission is refunded in proportion to the goods returned, rounded
      -- down, so the platform never keeps commission on an item the buyer
      -- never received. min() guards the case where a previous refund already
      -- drove commission to zero.
      v_new_comm := LEAST(v_settle.commission_kobo,
                          trunc(v_settle.gross_kobo::NUMERIC * v_new_gross
                                / GREATEST(v_settle.gross_kobo, 1))::BIGINT);
      v_new_net  := v_new_gross - v_new_comm;

      UPDATE public.marketplace_settlements
         SET gross_kobo = v_new_gross,
             commission_kobo = v_new_comm,
             net_kobo = v_new_net,
             updated_at = now()
       WHERE id = v_settle.id;
    END IF;
  END IF;

  IF p_dispute_id IS NOT NULL THEN
    UPDATE public.marketplace_disputes
       SET refund_amount_kobo = COALESCE(refund_amount_kobo, 0) + p_amount_kobo,
           updated_at = now()
     WHERE id = p_dispute_id;
  END IF;

  PERFORM public.mp_audit('payment.refund', 'order', p_order_id,
    jsonb_build_object('refunded_kobo', v_payment.refunded_kobo, 'status', v_payment.status),
    jsonb_build_object('refund_kobo', p_amount_kobo), p_reason, 'admin');

  PERFORM public.mp_notify(v_order.buyer_id, 'refund_issued',
    'Refund issued for ' || v_order.order_number,
    format('NGN %s is being returned to your payment method.',
      to_char(p_amount_kobo / 100.0, 'FM999999999990.00')),
    '/orders/' || p_order_id::TEXT, 'order', p_order_id);

  PERFORM public.mp_notify(
    (SELECT owner_id FROM public.marketplace_vendors WHERE id = v_order.vendor_id),
    'refund_issued',
    'Refund issued on ' || v_order.order_number,
    format('A refund of NGN %s was issued. The amount has been deducted from your settlement.',
      to_char(p_amount_kobo / 100.0, 'FM999999999990.00')),
    '/vendor/orders/' || p_order_id::TEXT, 'order', p_order_id);

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'refunded_kobo', p_amount_kobo,
    'payment_status', (SELECT status FROM public.marketplace_payments WHERE id = v_payment.id)
  );
END $$;

COMMENT ON FUNCTION public.mp_issue_refund IS
  'Finance-only refund. Requires issue_refunds permission, a captured payment, and an amount within the unrefunded balance. Never callable by a buyer or a vendor.';

-- =============================================================================
-- SCHEDULED WORK (called by the marketplace-cron edge function)
-- =============================================================================

-- Cancels expired unpaid reservations so stock returns to the shelf.
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
END $$;

-- Auto-confirms delivered orders past their confirmation window.
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
END $$;

-- Moves matured, un-held settlements to 'scheduled' so finance can pay them out.
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
END $$;

COMMENT ON FUNCTION public.mp_release_eligible_settlements IS
  'Marks matured settlements payable. Requires a completed order with no open dispute and no prior allocation, so funds cannot be released out from under a dispute or a withdrawal.';

-- =============================================================================
-- SYSTEM ACTOR
-- =============================================================================
-- Scheduled jobs need to act as 'system'. This is a transaction-local flag on
-- a SECURITY DEFINER helper, never a client-settable variable: it is only
-- readable by SECURITY DEFINER code, and it is always reset by the caller.
CREATE OR REPLACE FUNCTION public.mp_set_system_actor(p_on BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Store on the transaction so it cannot leak between pooled connections.
  PERFORM set_config('mp.system_actor', CASE WHEN p_on THEN 'on' ELSE 'off' END, TRUE);
END $$;

CREATE OR REPLACE FUNCTION public.mp_is_system_actor()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN COALESCE(current_setting('mp.system_actor', TRUE), 'off') = 'on';
END $$;

-- =============================================================================
-- WITHDRAWALS
-- =============================================================================

-- A vendor requests a payout. The amount is validated against the sum of their
-- own unsettled, matured settlements — not against a client-supplied balance.
CREATE OR REPLACE FUNCTION public.mp_request_withdrawal(
  p_amount_kobo BIGINT,
  p_bank_name TEXT,
  p_account_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor public.marketplace_vendors%ROWTYPE;
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_available BIGINT;
  v_withdrawal public.marketplace_withdrawals%ROWTYPE;
  v_settle RECORD;
  v_remaining BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to request a payout' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_vendor FROM public.marketplace_vendors
   WHERE owner_id = auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have a storefront' USING ERRCODE = 'P0002';
  END IF;
  IF v_vendor.status <> 'active' THEN
    RAISE EXCEPTION 'Your storefront is not trading, so payouts are unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;

  IF p_amount_kobo IS NULL OR p_amount_kobo < v_settings.min_withdrawal_kobo THEN
    RAISE EXCEPTION 'Minimum payout is NGN %s',
      to_char(v_settings.min_withdrawal_kobo / 100.0, 'FM999999999990.00') USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_bank_name, ''))) < 2
     OR char_length(trim(COALESCE(p_account_number, ''))) < 8 THEN
    RAISE EXCEPTION 'Enter the account name and a full account number' USING ERRCODE = '22023';
  END IF;

  -- Only digits in an account number; blocks injected payloads reaching finance.
  IF trim(p_account_number) !~ '^[0-9]{8,20}$' THEN
    RAISE EXCEPTION 'Account number must be 8-20 digits' USING ERRCODE = '22023';
  END IF;

  -- One in-flight request at a time, so the available balance cannot be
  -- double-promised across two requests.
  IF EXISTS (
    SELECT 1 FROM public.marketplace_withdrawals w
     WHERE w.vendor_id = v_vendor.id
       AND w.status IN ('requested','under_review','approved','processing')
  ) THEN
    RAISE EXCEPTION 'You already have a payout in progress' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(sum(s.net_kobo), 0) INTO v_available
    FROM public.marketplace_settlements s
    JOIN public.marketplace_orders o ON o.id = s.order_id
   WHERE s.vendor_id = v_vendor.id
     AND s.status = 'scheduled'
     AND o.status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM public.marketplace_withdrawal_allocations a
                      WHERE a.settlement_id = s.id);

  IF p_amount_kobo > v_available THEN
    RAISE EXCEPTION 'You have NGN %s available to withdraw',
      to_char(v_available / 100.0, 'FM999999999990.00') USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.marketplace_withdrawals (vendor_id, amount_kobo, status, destination)
  VALUES (v_vendor.id, p_amount_kobo, 'requested',
          jsonb_build_object('bank_name', left(trim(p_bank_name), 80),
                             'account_number', left(trim(p_account_number), 20),
                             'requested_at', now()))
  RETURNING * INTO v_withdrawal;

  -- Allocate greedily from oldest eligible settlement so a balance is always
  -- fully traceable to the orders that earned it.
  v_remaining := p_amount_kobo;
  FOR v_settle IN
    SELECT s.id, s.net_kobo
      FROM public.marketplace_settlements s
      JOIN public.marketplace_orders o ON o.id = s.order_id
     WHERE s.vendor_id = v_vendor.id
       AND s.status = 'scheduled'
       AND o.status = 'completed'
       AND NOT EXISTS (SELECT 1 FROM public.marketplace_withdrawal_allocations a
                        WHERE a.settlement_id = s.id)
     ORDER BY s.eligible_at
  LOOP
    EXIT WHEN v_remaining <= 0;
    INSERT INTO public.marketplace_withdrawal_allocations (withdrawal_id, settlement_id, amount_kobo)
    VALUES (v_withdrawal.id, v_settle.id, LEAST(v_settle.net_kobo, v_remaining));
    v_remaining := v_remaining - LEAST(v_settle.net_kobo, v_remaining);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Could not allocate the full payout amount' USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_settlements SET status = 'processing', updated_at = now()
   WHERE id IN (SELECT settlement_id FROM public.marketplace_withdrawal_allocations
                 WHERE withdrawal_id = v_withdrawal.id);

  PERFORM public.mp_audit('withdrawal.request', 'withdrawal', v_withdrawal.id, NULL,
    jsonb_build_object('amount_kobo', p_amount_kobo), NULL, 'vendor');

  RETURN jsonb_build_object(
    'id', v_withdrawal.id,
    'amount_kobo', v_withdrawal.amount_kobo,
    'status', v_withdrawal.status,
    'requested_at', v_withdrawal.requested_at
  );
END $$;

COMMENT ON FUNCTION public.mp_request_withdrawal IS
  'Vendor-initiated payout request. The amount is checked against the vendor''s own matured settlements and atomically allocated against them, so the same funds can never be promised twice.';

-- Finance decision on a withdrawal.
CREATE OR REPLACE FUNCTION public.mp_review_withdrawal(
  p_withdrawal_id UUID,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_w public.marketplace_withdrawals%ROWTYPE;
  v_owner UUID;
  v_next public.marketplace_withdrawal_status;
BEGIN
  IF NOT public.mp_has_perm('manage_withdrawals') THEN
    RAISE EXCEPTION 'You do not have permission to review payouts' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_w FROM public.marketplace_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_w.status NOT IN ('requested','under_review') THEN
    RAISE EXCEPTION 'This payout has already been decided' USING ERRCODE = '23514';
  END IF;

  v_next := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_w.vendor_id;

  UPDATE public.marketplace_withdrawals
     SET status = v_next,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         reviewer_note = left(p_note, 600),
         reference = left(COALESCE(p_reference, ''), 120)
   WHERE id = p_withdrawal_id;

  -- Only a REJECTION releases the funds. On approval the settlements must stay
  -- in 'processing': they are now earmarked to this payout and are marked
  -- paid_out only when finance confirms the transfer.
  IF NOT p_approve THEN
    -- The allocations are read by the two updates below, so they are deleted last.
    UPDATE public.marketplace_orders o
       SET settlement_status = 'scheduled'
      FROM public.marketplace_settlements s
     WHERE s.order_id = o.id
       AND s.id IN (SELECT settlement_id FROM public.marketplace_withdrawal_allocations
                     WHERE withdrawal_id = p_withdrawal_id);

    UPDATE public.marketplace_settlements s
       SET status = 'scheduled', hold_reason = NULL, updated_at = now()
     WHERE s.id IN (SELECT settlement_id FROM public.marketplace_withdrawal_allocations
                     WHERE withdrawal_id = p_withdrawal_id)
       AND s.status = 'processing';

    DELETE FROM public.marketplace_withdrawal_allocations WHERE withdrawal_id = p_withdrawal_id;
  END IF;

  PERFORM public.mp_audit('withdrawal.review', 'withdrawal', p_withdrawal_id,
    jsonb_build_object('status', v_w.status), jsonb_build_object('status', v_next),
    p_note, 'admin');

  PERFORM public.mp_notify(v_owner, 'withdrawal_updated',
    'Payout ' || CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
    format('Your payout of NGN %s was %s.%s',
      to_char(v_w.amount_kobo / 100.0, 'FM999999999990.00'),
      CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
      CASE WHEN p_note IS NOT NULL AND length(p_note) > 0 THEN ' Note: ' || left(p_note, 200) ELSE '' END),
    '/vendor/earnings', 'withdrawal', p_withdrawal_id);

  RETURN jsonb_build_object('id', p_withdrawal_id, 'status', v_next);
END $$;

-- Finance marks a payout as actually transferred.
CREATE OR REPLACE FUNCTION public.mp_mark_withdrawal_paid(
  p_withdrawal_id UUID,
  p_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_w public.marketplace_withdrawals%ROWTYPE; v_owner UUID;
BEGIN
  IF NOT public.mp_has_perm('manage_withdrawals') THEN
    RAISE EXCEPTION 'You do not have permission to complete payouts' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_w FROM public.marketplace_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.status <> 'approved' AND v_w.status <> 'processing' THEN
    RAISE EXCEPTION 'Only an approved payout can be marked paid' USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_withdrawals
     SET status = 'paid', paid_at = now(), reference = left(COALESCE(p_reference, v_w.reference, ''), 120)
   WHERE id = p_withdrawal_id;

  UPDATE public.marketplace_settlements s
     SET status = 'paid_out', released_at = COALESCE(s.released_at, now()), updated_at = now()
   WHERE s.id IN (SELECT settlement_id FROM public.marketplace_withdrawal_allocations
                   WHERE withdrawal_id = p_withdrawal_id);

  UPDATE public.marketplace_orders o
     SET settlement_status = 'paid_out'
    FROM public.marketplace_settlements s
   WHERE s.order_id = o.id
     AND s.id IN (SELECT settlement_id FROM public.marketplace_withdrawal_allocations
                   WHERE withdrawal_id = p_withdrawal_id);

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_w.vendor_id;

  PERFORM public.mp_audit('withdrawal.paid', 'withdrawal', p_withdrawal_id, NULL,
    jsonb_build_object('reference', left(COALESCE(p_reference,''),120)), NULL, 'admin');

  PERFORM public.mp_notify(v_owner, 'withdrawal_updated', 'Payout sent',
    format('NGN %s has been transferred to your account.', to_char(v_w.amount_kobo / 100.0, 'FM999999999990.00')),
    '/vendor/earnings', 'withdrawal', p_withdrawal_id);

  RETURN jsonb_build_object('id', p_withdrawal_id, 'status', 'paid');
END $$;
