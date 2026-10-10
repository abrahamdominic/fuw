-- =============================================================================
-- FUW Marketplace: Reconcile escrow release with the buyer-paid escrow fee
-- =============================================================================
-- The buyer now pays an escrow fee on top of the goods and delivery:
--
--   total_kobo = subtotal_kobo + delivery_fee_kobo + escrow_fee_kobo
--
-- mp_guard_escrow_release still asserted the pre-fee arithmetic
-- (total = subtotal + delivery) and so refused every legitimate release. This
-- restates the real invariants, keeping the final identity that proves no kobo
-- is invented or lost: what the buyer paid is exactly the vendor payout, plus
-- the platform commission, plus delivery, plus the escrow fee.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.mp_guard_escrow_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order   public.marketplace_orders%ROWTYPE;
  v_payment public.marketplace_payments%ROWTYPE;
  v_escrow_fee BIGINT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  SELECT * INTO v_payment FROM public.marketplace_payments WHERE id = v_order.payment_id;
  v_escrow_fee := COALESCE(v_order.escrow_fee_kobo, 0);

  -- A real capture.
  IF v_payment.id IS NULL OR v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'Refusing to release order %: there is no captured payment', NEW.order_id
      USING ERRCODE = '23514';
  END IF;

  -- The money reconciles with what was charged and owed.
  --
  -- The order's arithmetic, as mp_create_orders fixes it:
  --     total_kobo    = subtotal_kobo + delivery_fee_kobo + escrow_fee_kobo
  --     vendor_payout = subtotal_kobo - platform_fee_kobo
  -- The settlement mirrors the goods: gross is the goods subtotal, commission
  -- is the platform cut, net is the vendor's payout. Delivery and the escrow
  -- fee are platform income outside the vendor's receivable.
  IF NEW.gross_kobo <> v_order.subtotal_kobo
     OR NEW.gross_kobo <> v_payment.amount_kobo - v_order.delivery_fee_kobo - v_escrow_fee
     OR NEW.commission_kobo <> v_order.platform_fee_kobo
     OR NEW.net_kobo <> v_order.vendor_payout_kobo
     OR NEW.gross_kobo - NEW.commission_kobo <> NEW.net_kobo
     OR v_payment.amount_kobo <> NEW.net_kobo + NEW.commission_kobo
                              + v_order.delivery_fee_kobo + v_escrow_fee THEN
    RAISE EXCEPTION 'Refusing to release order %: the settlement does not reconcile with the order', NEW.order_id
      USING ERRCODE = '23514';
  END IF;

  -- The buyer confirmed receipt and nothing is in dispute.
  IF v_order.status <> 'completed' OR v_order.dispute_id IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to release order %: the buyer has not confirmed receipt', NEW.order_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $function$;

COMMIT;
