-- =============================================================================
-- Marketplace: correct escrow and wallet behaviour on a partial refund
-- =============================================================================
-- THE BUG
-- -------
-- mp_sync_escrow_from_payment flipped the escrow to 'refunded' whenever a
-- succeeded payment moved to 'refunded' OR 'partially_refunded':
--
--     IF OLD.status = 'succeeded' AND NEW.status IN ('refunded','partially_refunded') THEN
--       UPDATE marketplace_escrows SET status = 'refunded' ...
--
-- A partial refund is money returned for goods the buyer did not keep. It is not
-- a reversal of the whole payment, and two things followed from treating it as
-- one:
--
--   * mp_sync_escrow_from_settlement only releases an escrow that sits in
--     'releasable', 'locked' or 'disputed'. An escrow parked at 'refunded' was
--     therefore permanently un-payable: a vendor could never be paid for the part
--     of the order that WAS honoured, even though the settlement covering it was
--     reduced correctly and sat in the release queue.
--
--   * The wallet bridge read that escrow as "the vendor's receivable is void" and
--     unwound the vendor's entire pending hold and the platform's whole share,
--     while the buyer was credited only the fraction actually refunded. On a
--     ₦198,500 order a ₦20,000 refund would have destroyed ₦181,700 of vendor
--     earnings and ₦16,800 of platform revenue.
--
-- THE FIX
-- -------
-- 1. Only a FULL reversal -- refunded_kobo >= amount_kobo -- closes the escrow.
--    A provider refund event always sets refunded_kobo to the full amount, so
--    genuine reversals are unaffected.
--
-- 2. mp_sync_wallet_from_payment_refund now books the vendor's and the
--    platform's share of a partial refund itself, using exactly the arithmetic
--    mp_issue_refund uses, and only when nothing else owns that unwind:
--
--       settlement exists            -> mp_sync_wallet_from_settlement (D3)
--       escrow already refunded      -> mp_sync_wallet_on_escrow_unwound (D2)
--       neither                      -> here
--
--    The retained figures are computed cumulatively from the refund total, which
--    is what makes a sequence of small refunds add up to the same answer as one
--    large refund.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. A partial refund is not a reversal
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_sync_escrow_from_payment()
RETURNS trigger
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

  -- A reversal of the capture releases the hold -- but only a FULL one. A
  -- partial refund leaves the order live and its escrow intact, so the part of
  -- the order that was honoured can still be released to the vendor.
  IF OLD.status = 'succeeded' AND NEW.status IN ('refunded', 'partially_refunded') THEN
    IF COALESCE(NEW.refunded_kobo, 0) >= COALESCE(NEW.amount_kobo, 0) THEN
      UPDATE public.marketplace_escrows
         SET status = 'refunded', refunded_at = COALESCE(refunded_at, now())
       WHERE payment_id = NEW.id AND status NOT IN ('refunded', 'cancelled');
    END IF;
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
END;
$$;

-- =============================================================================
-- 2. The refund bridge: credit the buyer, and unwind the vendor's and the
--    platform's share when, and only when, nothing else has already done it
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_sync_wallet_from_payment_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delta            BIGINT;
  v_wallet           UUID;
  v_order            public.marketplace_orders%ROWTYPE;
  v_escrow           public.marketplace_escrows%ROWTYPE;
  v_settlement_lives BOOLEAN;
  v_gross_before     BIGINT;
  v_gross_after      BIGINT;
  v_comm_before      BIGINT;
  v_comm_after       BIGINT;
  v_net_before       BIGINT;
  v_net_after        BIGINT;
  v_net_drop         BIGINT;
  v_comm_drop        BIGINT;
  v_delivery_drop    BIGINT;
  v_order_number     TEXT;
BEGIN
  v_delta := COALESCE(NEW.refunded_kobo, 0) - COALESCE(OLD.refunded_kobo, 0);
  IF v_delta <= 0 THEN
    RETURN NULL;
  END IF;
  IF NEW.buyer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.* INTO v_order FROM public.marketplace_orders o WHERE o.id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_order_number := v_order.order_number;

  -- The buyer always gets exactly what was returned to them. Keyed on the running
  -- refunded total, so each refund is its own entry and none can be replayed.
  v_wallet := public.mp_wallet_ensure(p_owner_user_id => NEW.buyer_id);
  PERFORM public.mp_wallet_post(
    v_wallet, 'credit', 'available', v_delta, 'refund_credit',
    'payment', NEW.id,
    'payment:' || NEW.id::TEXT || ':refund:' || NEW.refunded_kobo::TEXT,
    format('Refund for order %s', COALESCE(v_order_number, NEW.order_id::TEXT)),
    jsonb_build_object('order_id', NEW.order_id, 'refund_kobo', v_delta,
                       'payment_status', NEW.status),
    auth.uid());

  -- Anything past this point is about the vendor's and the platform's share of
  -- the SAME refund, and only one bridge may act on it.
  IF v_order.vendor_id IS NULL OR v_order.subtotal_kobo <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.marketplace_settlements s
                  WHERE s.order_id = NEW.order_id) INTO v_settlement_lives;
  IF v_settlement_lives THEN
    -- mp_issue_refund rewrote the settlement, and D3 already unwound the drop.
    RETURN NULL;
  END IF;

  SELECT * INTO v_escrow FROM public.marketplace_escrows e WHERE e.payment_id = NEW.id;
  IF v_escrow.id IS NULL OR v_escrow.status IN ('refunded', 'cancelled') THEN
    -- D2 unwound the whole hold on this event, or there is nothing held.
    RETURN NULL;
  END IF;

  -- Cumulative retained figures, mirroring mp_issue_refund's own arithmetic:
  --   goods still kept        = subtotal - refunded
  --   commission still earned = LEAST(platform_fee, goods still kept)
  --   vendor's still earned   = goods still kept - that commission
  -- Computed before and after, and the difference is what this refund took.
  v_gross_before := GREATEST(LEAST(v_order.subtotal_kobo - COALESCE(OLD.refunded_kobo, 0),
                                   v_order.subtotal_kobo), 0);
  v_gross_after  := GREATEST(LEAST(v_order.subtotal_kobo - COALESCE(NEW.refunded_kobo, 0),
                                   v_order.subtotal_kobo), 0);

  v_comm_before := LEAST(COALESCE(v_order.platform_fee_kobo, 0), v_gross_before);
  v_comm_after  := LEAST(COALESCE(v_order.platform_fee_kobo, 0), v_gross_after);

  v_net_before  := v_gross_before - v_comm_before;
  v_net_after   := v_gross_after  - v_comm_after;

  v_net_drop  := GREATEST(v_net_before  - v_net_after,  0);
  v_comm_drop := GREATEST(v_comm_before - v_comm_after, 0);

  -- Delivery is only given back once the refund has eaten the whole goods
  -- subtotal: before that the order is still partly delivered, and a partial
  -- goods return does not refund the courier.
  IF COALESCE(NEW.refunded_kobo, 0) >= v_order.subtotal_kobo
     AND COALESCE(OLD.refunded_kobo, 0) < v_order.subtotal_kobo THEN
    v_delivery_drop := COALESCE(v_order.delivery_fee_kobo, 0);
  ELSE
    v_delivery_drop := 0;
  END IF;

  IF v_net_drop > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(p_vendor_id => v_order.vendor_id),
      v_net_drop, 'escrow_refund', 'payment', NEW.id,
      'payment:' || NEW.id::TEXT || ':refund_net:' || NEW.refunded_kobo::TEXT,
      format('Goods returned on order %s', v_order.order_number),
      jsonb_build_object('order_id', NEW.order_id, 'net_drop', v_net_drop,
                         'refunded_kobo', NEW.refunded_kobo), auth.uid());
  END IF;

  IF v_comm_drop + v_delivery_drop > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(),
      v_comm_drop + v_delivery_drop, 'platform_fee_refund', 'payment', NEW.id,
      'payment:' || NEW.id::TEXT || ':refund_platform:' || NEW.refunded_kobo::TEXT,
      format('Commission and delivery reversed on order %s', v_order.order_number),
      jsonb_build_object('order_id', NEW.order_id, 'commission_drop', v_comm_drop,
                         'delivery_drop', v_delivery_drop), auth.uid());
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.mp_sync_wallet_from_payment_refund() IS
  'Credits the buyer for a refund and, when no settlement or escrow unwind owns it, deducts the vendor and platform share of that same refund.';

-- =============================================================================
-- 3. Grant hygiene: the recreated trigger function keeps its revoke.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.mp_sync_escrow_from_payment() FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 4. mp_issue_refund: a payment must be refundable more than once.
--
-- The live function refuses any payment whose status is not exactly
-- 'succeeded'. But issuing a partial refund moves the payment to
-- 'partially_refunded', so from that moment on *every* further refund dies with
-- "Only a captured payment can be refunded". A buyer who receives 2,000 and
-- agrees to return the remaining 17,850 could never be refunded in full: the
-- vendor keeps a hold on goods that were sent back, and the order can never be
-- closed out.
--
-- It also decided whether to cancel the vendor's receivable by comparing the
-- *new* tranche against the order subtotal:
--
--     IF p_amount_kobo >= v_order.subtotal_kobo THEN  -- cancel
--
-- Cumulative refunds can reach the order total through several tranches, none of
-- which is individually as large as the subtotal. For MP-20261004-A2B20BF4:
-- subtotal 19,750,000, total 19,850,000, and refunds of 2,000,000 + 17,850,000
-- refund the payment in full while neither tranche reaches 19,750,000. The
-- settlement was therefore reduced to a zero net and left 'pending' -- money owed
-- to nobody, still held, never paid out and never released.
--
-- Both decisions are now made on the cumulative total, which is what the money
-- is actually measured against. Everything else, including the commission
-- arithmetic, is deliberately left exactly as it was.
-- =============================================================================
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
  v_cumulative BIGINT;
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
  IF NOT FOUND OR v_payment.status NOT IN ('succeeded', 'partially_refunded') THEN
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

  -- What this order will have given back once this tranche is applied.
  v_cumulative := v_payment.refunded_kobo + p_amount_kobo;

  UPDATE public.marketplace_payments
     SET refunded_kobo = refunded_kobo + p_amount_kobo,
         status = CASE WHEN refunded_kobo + p_amount_kobo >= amount_kobo
                       THEN 'refunded'::public.marketplace_payment_status
                       ELSE 'partially_refunded'::public.marketplace_payment_status END,
         updated_at = now()
   WHERE id = v_payment.id;

  -- A refund that consumes the whole goods value cancels the vendor's
  -- receivable immediately. A refund smaller than that reduces it so the vendor
  -- is paid only what the buyer actually kept.
  --
  -- The three columns are computed in variables, not in the UPDATE list. In a
  -- single UPDATE every expression reads the OLD row, so writing the reduced
  -- gross, the proportional commission and the net in the same statement would
  -- mix old and new figures and trip mp_settlement_math.
  SELECT * INTO v_settle FROM public.marketplace_settlements
   WHERE order_id = p_order_id AND status <> 'paid_out'
   FOR UPDATE;

  IF FOUND THEN
    IF v_cumulative >= v_settle.gross_kobo THEN
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
    jsonb_build_object('refunded_kobo', v_cumulative, 'status', v_payment.status),
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
    'refunded_total_kobo', v_cumulative,
    'payment_status', (SELECT status FROM public.marketplace_payments WHERE id = v_payment.id)
  );
END;
$$;

COMMIT;