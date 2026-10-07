-- =============================================================================
-- Normalise settlement state when an order reaches a terminal status
-- =============================================================================
--
-- The defect
-- ----------
-- `marketplace_orders.settlement_status` is a denormalised mirror of the
-- vendor's receivable, but nothing guaranteed it stayed in step with the order.
-- `mp_transition_order` only rewrites the mirror inside
--
--     IF v_rule.marks_refunded OR v_rule.holds_settlement THEN ...
--
-- and a `pending_payment -> cancelled` transition sets neither flag (stock is
-- released; no money ever moved). So the column kept the value the order row
-- was inserted with — 'pending' — on an order that was never paid and never
-- will be.
--
-- The result, measured on this project before the fix:
--
--     status     | settlement_status | count
--     -----------+-------------------+-------
--     cancelled  | pending           | 2
--
-- Two unpaid, expired orders claiming a pending vendor receivable. That is a
-- false statement about money: it inflates any "amount owed to vendors" figure
-- built from this column, and it hides the fact that the mirror is wrong at
-- all. (It was not a payout hole — `mp_release_eligible_settlements` requires
-- both a `marketplace_settlements` row and `o.status = 'completed', and neither
-- of these orders had either. That is luck, not design, so it is not a
-- reason to leave the column lying.)
--
-- The fix
-- -------
-- A BEFORE UPDATE trigger rather than another edit inside
-- `mp_transition_order`, for three reasons:
--
--   1. `mp_transition_order` is ~400 lines that this migration would otherwise
--      have to restate verbatim, adding a fourth copy to keep in sync.
--   2. A trigger covers *every* writer. `marketplace_orders.status` is also set
--      by the escrow/partial-refund paths, and a fix living inside one function
--      silently misses those.
--   3. It matches the shape the project already uses for the same job:
--      `mp_sync_escrow_from_order` mirrors the order lifecycle onto the
--      escrow. This does the same for the settlement mirror.
--
-- Money that already moved is never rewritten. A settlement that is `paid_out`,
-- `failed` or already `cancelled` is left alone: cancelling such an order means
-- a refund, and the existing `order.refund_required` audit plus buyer
-- notification is what handles that. Rewriting `paid_out` to `cancelled` would
-- erase the evidence that money left the platform.
--
-- No new function is granted to any client role: this is a trigger, and
-- triggers are not independently executable.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mp_normalize_settlement_on_terminal_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only a real status change can strand the mirror.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- 'cancelled' and 'refunded' are terminal: there is no longer a receivable to
  -- be scheduled, released or paid out.
  IF NEW.status NOT IN ('cancelled', 'refunded') THEN
    RETURN NEW;
  END IF;

  -- Never rewrite a settled or already-terminal figure. See the header note.
  IF NEW.settlement_status IN ('paid_out', 'cancelled', 'failed') THEN
    RETURN NEW;
  END IF;

  NEW.settlement_status := 'cancelled'::public.marketplace_settlement_status;

  -- Close the receivable itself, if one exists. Orders cancelled before payment
  -- never get a settlement row (mp_transition_order only creates one on a
  -- completing transition), so the NOT EXISTS case is the common one and must
  -- not be treated as an error.
  UPDATE public.marketplace_settlements
     SET status = 'cancelled'::public.marketplace_settlement_status,
         hold_reason = NULL,
         updated_at = now()
   WHERE order_id = NEW.id
     AND status NOT IN ('paid_out', 'cancelled', 'failed');

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_normalize_settlement_on_terminal_order() IS
  'Keeps marketplace_orders.settlement_status terminal when the order is cancelled or refunded. Closes any open settlement row. Never rewrites paid_out/failed/cancelled.';

DROP TRIGGER IF EXISTS mp_normalize_settlement_on_terminal_order ON public.marketplace_orders;
CREATE TRIGGER mp_normalize_settlement_on_terminal_order
  BEFORE UPDATE ON public.marketplace_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.mp_normalize_settlement_on_terminal_order();

-- -----------------------------------------------------------------------------
-- 2. Backfill the rows the trigger cannot reach retroactively
-- -----------------------------------------------------------------------------
-- The trigger fires on UPDATE, so the orders already stranded by the old code
-- would stay stranded forever. Fixed here rather than left for a sweep.

DO $$
DECLARE
  v_orders INT;
  v_settlements INT;
BEGIN
  UPDATE public.marketplace_orders
     SET settlement_status = 'cancelled'::public.marketplace_settlement_status,
         updated_at = now()
   WHERE status IN ('cancelled', 'refunded')
     AND settlement_status NOT IN ('paid_out', 'cancelled', 'failed');

  GET DIAGNOSTICS v_orders = ROW_COUNT;

  UPDATE public.marketplace_settlements s
     SET status = 'cancelled'::public.marketplace_settlement_status,
         hold_reason = NULL,
         updated_at = now()
    FROM public.marketplace_orders o
   WHERE o.id = s.order_id
     AND o.status IN ('cancelled', 'refunded')
     AND o.settlement_status = 'cancelled'::public.marketplace_settlement_status
     AND s.status NOT IN ('paid_out', 'cancelled', 'failed');

  GET DIAGNOSTICS v_settlements = ROW_COUNT;

  IF v_orders > 0 OR v_settlements > 0 THEN
    PERFORM public.mp_audit(
      'order.settlement_normalized',
      'order',
      NULL,
      NULL,
      jsonb_build_object('orders_normalized', v_orders,
                         'settlements_closed', v_settlements),
      'Backfilled terminal settlement state stranded before '
        || 'mp_normalize_settlement_on_terminal_order existed',
      'system'
    );
  END IF;

  RAISE NOTICE 'settlement normalisation: % orders, % settlements', v_orders, v_settlements;
END $$;

-- -----------------------------------------------------------------------------
-- 3. The partial index that drives the settlement queue only tracks live money
-- -----------------------------------------------------------------------------
-- `idx_mp_orders_settlement` is defined WHERE settlement_status IN
-- ('pending','scheduled','on_hold'). Now that a cancelled order can never hold
-- those values, the index is exactly the set of orders still awaiting money —
-- which is what every query against it is asking for.

COMMIT;
