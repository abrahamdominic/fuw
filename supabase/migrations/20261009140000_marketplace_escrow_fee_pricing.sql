-- =============================================================================
-- FUW Marketplace: Percentage escrow fee with floor and cap
-- =============================================================================
-- The escrow fee is buyer-paid, charged on the merchandise subtotal of each
-- vendor order, and never on the delivery fee or on the fee itself:
--
--   escrow_fee = min(max(round(subtotal * escrow_fee_bps / 10000),
--                        escrow_fee_min_kobo),
--                    escrow_fee_max_kobo)
--
-- Defaults are 1.5% (150 bps), floor NGN 100 (10 000 kobo), cap NGN 5 000
-- (500 000 kobo) for NGN. A zero subtotal is never charged a floor.
--
-- Accounting: the fee is part of the buyer's total but is NOT part of the
-- vendor payout or mp_platform_share. It is credited to the platform wallet in
-- the `pending` (non-withdrawable) bucket when the escrow funds, shifted to
-- `available` when the order's settlement matures, and unwound in full when the
-- order is refunded or cancelled.
-- =============================================================================

BEGIN;

-- ── SETTINGS COLUMNS ────────────────────────────────────────────────────────
ALTER TABLE public.marketplace_platform_settings
  ADD COLUMN IF NOT EXISTS escrow_fee_bps       INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS escrow_fee_min_kobo  BIGINT  NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS escrow_fee_max_kobo  BIGINT  NOT NULL DEFAULT 500000,
  ADD COLUMN IF NOT EXISTS escrow_fee_currency  TEXT    NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS escrow_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_platform_settings_escrow_fee_bps_check'
  ) THEN
    ALTER TABLE public.marketplace_platform_settings
      ADD CONSTRAINT marketplace_platform_settings_escrow_fee_bps_check
      CHECK (escrow_fee_bps >= 0 AND escrow_fee_bps <= 5000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketplace_platform_settings_escrow_fee_bounds_check'
  ) THEN
    ALTER TABLE public.marketplace_platform_settings
      ADD CONSTRAINT marketplace_platform_settings_escrow_fee_bounds_check
      CHECK (escrow_fee_min_kobo >= 0 AND escrow_fee_max_kobo >= escrow_fee_min_kobo);
  END IF;
END $$;

COMMENT ON COLUMN public.marketplace_platform_settings.escrow_fee_bps IS
  'Escrow fee in basis points of the merchandise subtotal (150 = 1.5%).';
COMMENT ON COLUMN public.marketplace_platform_settings.escrow_fee_min_kobo IS
  'Minimum buyer-paid escrow fee in kobo (10000 = NGN 100). Never applied to a zero subtotal.';
COMMENT ON COLUMN public.marketplace_platform_settings.escrow_fee_max_kobo IS
  'Maximum buyer-paid escrow fee in kobo (500000 = NGN 5000).';
COMMENT ON COLUMN public.marketplace_platform_settings.escrow_fee_currency IS
  'Currency the escrow fee is charged in. Only NGN is supported today.';
COMMENT ON COLUMN public.marketplace_platform_settings.escrow_enabled IS
  'When false, checkout charges no escrow fee at all.';
COMMENT ON COLUMN public.marketplace_platform_settings.escrow_fee_kobo IS
  'DEPRECATED. Legacy flat escrow fee. Superseded by escrow_fee_bps/min/max; retained only so older clients keep reading a value.';

-- ── PURE PRICING HELPER ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_escrow_fee_for(
  p_subtotal_kobo BIGINT,
  p_bps           INTEGER,
  p_min_kobo      BIGINT,
  p_max_kobo      BIGINT
)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(p_subtotal_kobo, 0) <= 0 THEN 0
    ELSE LEAST(
           GREATEST(
             ROUND(COALESCE(p_subtotal_kobo, 0)::NUMERIC
                   * COALESCE(p_bps, 0)::NUMERIC / 10000.0)::BIGINT,
             COALESCE(p_min_kobo, 0)
           ),
           GREATEST(COALESCE(p_max_kobo, 0), COALESCE(p_min_kobo, 0))
         )
  END;
$function$;

COMMENT ON FUNCTION public.mp_escrow_fee_for(BIGINT, INTEGER, BIGINT, BIGINT) IS
  'Authoritative escrow fee calculator. Rounds half away from zero, then clamps to the floor and cap. Zero subtotal returns zero.';

-- ── PREVIEW ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_preview_checkout_escrow(
  p_subtotal_kobo BIGINT,
  p_buyer_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_buyer_id, auth.uid());
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_credit_info JSONB;
  v_normal_fee BIGINT := 0;
  v_credit_avail BIGINT := 0;
  v_credit_applied BIGINT := 0;
  v_remainder BIGINT := 0;
  v_discount BIGINT := 0;
  v_final_fee BIGINT := 0;
  v_has_prem BOOLEAN := false;
  v_disc_pct INT := 50;
BEGIN
  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.id IS NOT NULL THEN
    v_disc_pct := COALESCE(v_settings.premium_escrow_discount_pct, 50);
    IF COALESCE(v_settings.escrow_enabled, true) THEN
      v_normal_fee := public.mp_escrow_fee_for(
        p_subtotal_kobo,
        COALESCE(v_settings.escrow_fee_bps, 150),
        COALESCE(v_settings.escrow_fee_min_kobo, 10000),
        COALESCE(v_settings.escrow_fee_max_kobo, 500000));
    END IF;
  ELSE
    v_normal_fee := public.mp_escrow_fee_for(p_subtotal_kobo, 150, 10000, 500000);
  END IF;

  -- Default for free users
  v_final_fee := v_normal_fee;

  IF v_uid IS NOT NULL AND v_normal_fee > 0
     AND COALESCE(v_settings.premium_marketplace_benefits_enabled, true) THEN
    v_credit_info := public.mp_get_user_escrow_credit(v_uid);
    v_has_prem := (v_credit_info->>'has_premium')::BOOLEAN;
    v_credit_avail := (v_credit_info->>'credit_remaining_kobo')::BIGINT;

    IF v_has_prem THEN
      IF v_credit_avail >= v_normal_fee THEN
        v_credit_applied := v_normal_fee;
        v_final_fee := 0;
      ELSE
        v_credit_applied := v_credit_avail;
        v_remainder := v_normal_fee - v_credit_applied;
        v_discount := round(v_remainder::NUMERIC * (v_disc_pct::NUMERIC / 100.0))::BIGINT;
        v_final_fee := v_remainder - v_discount;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'is_premium', v_has_prem,
    'normal_escrow_fee_kobo', v_normal_fee,
    'credit_available_kobo', v_credit_avail,
    'credit_applied_kobo', v_credit_applied,
    'discount_pct', CASE WHEN v_has_prem THEN v_disc_pct ELSE 0 END,
    'discount_applied_kobo', v_discount,
    'final_escrow_fee_kobo', v_final_fee,
    'credit_remaining_after_kobo', GREATEST(0, v_credit_avail - v_credit_applied)
  );
END;
$function$;

-- ── CHECKOUT CREATION ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_create_orders(
  p_idempotency_key TEXT,
  p_items JSONB,
  p_delivery_type public.marketplace_delivery_type DEFAULT 'pickup',
  p_delivery JSONB DEFAULT NULL,
  p_buyer_note TEXT DEFAULT NULL,
  p_payment_provider TEXT DEFAULT 'none'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_cart JSONB;
  v_group JSONB;
  v_item JSONB;
  v_checkout public.marketplace_checkouts%ROWTYPE;
  v_order public.marketplace_orders%ROWTYPE;
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_order_id UUID;
  v_payment_id UUID;
  v_orders JSONB := '[]'::JSONB;
  v_sub BIGINT; v_fee BIGINT; v_pfee BIGINT; v_total BIGINT; v_payout BIGINT;
  v_escrow_fee BIGINT; v_escrow_credit_app BIGINT; v_escrow_disc BIGINT;
  v_normal_escrow BIGINT;
  v_credit_row public.marketplace_escrow_credit_ledger%ROWTYPE;
  v_credit_info JSONB;
  v_has_prem BOOLEAN := false;
  v_item_count INT;
  v_grand_total BIGINT := 0;
  v_grand_sub   BIGINT := 0;
  v_grand_fee   BIGINT := 0;
  v_grand_pfee  BIGINT := 0;
  v_grand_escrow BIGINT := 0;
  v_delivery_snapshot JSONB;
  v_vendor_owner UUID;
  v_buyer_name TEXT;
  v_provider public.marketplace_payment_provider;
  v_actual_items JSONB := p_items;
  v_actual_delivery JSONB := p_delivery;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to check out' USING ERRCODE = '28000';
  END IF;

  IF char_length(COALESCE(p_idempotency_key, '')) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'Invalid checkout token (must be between 16 and 120 characters)' USING ERRCODE = '22023';
  END IF;

  -- Normalize stringified items
  IF jsonb_typeof(v_actual_items) = 'string' THEN
    v_actual_items := (v_actual_items #>> '{}')::JSONB;
  END IF;

  -- Normalize stringified delivery
  IF jsonb_typeof(v_actual_delivery) = 'string' THEN
    v_actual_delivery := (v_actual_delivery #>> '{}')::JSONB;
  END IF;

  v_provider := CASE
    WHEN p_payment_provider IN ('manual_bank_transfer', 'bank_transfer') THEN 'manual_bank_transfer'::public.marketplace_payment_provider
    WHEN p_payment_provider = 'paystack' THEN 'paystack'::public.marketplace_payment_provider
    WHEN p_payment_provider = 'wallet' THEN 'wallet'::public.marketplace_payment_provider
    ELSE 'none'::public.marketplace_payment_provider
  END;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.maintenance_mode THEN
    RAISE EXCEPTION 'Checkout is temporarily unavailable' USING ERRCODE = '55000';
  END IF;

  -- ── IDEMPOTENCY ──────────────────────────────────────────────────────────
  SELECT * INTO v_checkout FROM public.marketplace_checkouts
   WHERE buyer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND AND v_checkout.status = 'placed' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', o.id, 'order_number', o.order_number, 'status', o.status,
             'total_kobo', o.total_kobo, 'vendor_id', o.vendor_id,
             'payment_id', o.payment_id, 'payment_status', pay.status,
             'shop_name', v.shop_name,
             'escrow_fee_kobo', o.escrow_fee_kobo
           ) ORDER BY o.created_at), '[]'::JSONB)
      INTO v_orders
      FROM public.marketplace_orders o
      JOIN public.marketplace_vendors v ON v.id = o.vendor_id
      LEFT JOIN public.marketplace_payments pay ON pay.id = o.payment_id
     WHERE o.checkout_id = v_checkout.id;

    RETURN jsonb_build_object(
      'checkout_id', v_checkout.id,
      'payment_id', (SELECT o.payment_id FROM public.marketplace_orders o WHERE o.checkout_id = v_checkout.id LIMIT 1),
      'orders', v_orders,
      'order_count', jsonb_array_length(v_orders),
      'replayed', TRUE,
      'subtotal_kobo',     (SELECT COALESCE(sum(subtotal_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'delivery_fee_kobo', (SELECT COALESCE(sum(delivery_fee_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'platform_fee_kobo', (SELECT COALESCE(sum(platform_fee_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'escrow_fee_kobo',   (SELECT COALESCE(sum(escrow_fee_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'total_kobo',        (SELECT COALESCE(sum(total_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'payments_enabled', v_settings.payments_enabled
    );
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.marketplace_checkouts (buyer_id, idempotency_key)
    VALUES (v_uid, p_idempotency_key)
    RETURNING * INTO v_checkout;
  END IF;

  -- ── ATOMIC ESCROW CREDIT LOCK & RESOLUTION ────────────────────────────────
  v_credit_info := public.mp_get_user_escrow_credit(v_uid);
  v_has_prem := (v_credit_info->>'has_premium')::BOOLEAN;

  IF v_has_prem AND COALESCE(v_settings.premium_marketplace_benefits_enabled, true) THEN
    -- Lock active credit record for update to prevent concurrent double-spending
    SELECT * INTO v_credit_row
      FROM public.marketplace_escrow_credit_ledger
     WHERE user_id = v_uid
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
  END IF;

  -- ── AUTHORITATIVE PRICING + STOCK LOCKS ──────────────────────────────────
  v_cart := public.mp_compute_cart(v_actual_items);

  IF p_delivery_type IS NULL THEN
    RAISE EXCEPTION 'Choose pickup or delivery' USING ERRCODE = '22023';
  END IF;

  IF p_delivery_type = 'delivery' THEN
    IF v_actual_delivery IS NULL
       OR char_length(trim(COALESCE(v_actual_delivery->>'recipient_name', ''))) < 2
       OR char_length(trim(COALESCE(v_actual_delivery->>'phone', ''))) < 7
       OR char_length(trim(COALESCE(v_actual_delivery->>'campus_area', ''))) < 2
       OR char_length(trim(COALESCE(v_actual_delivery->>'address_line', ''))) < 3 THEN
      RAISE EXCEPTION 'Add a delivery name, phone number, campus area and address'
        USING ERRCODE = '22023';
    END IF;

    v_delivery_snapshot := jsonb_build_object(
      'recipient_name', left(trim(v_actual_delivery->>'recipient_name'), 80),
      'phone',           left(trim(v_actual_delivery->>'phone'), 20),
      'campus_area',     left(trim(v_actual_delivery->>'campus_area'), 80),
      'address_line',    left(trim(v_actual_delivery->>'address_line'), 240),
      'landmark',        left(COALESCE(v_actual_delivery->>'landmark', ''), 160)
    );
  ELSE
    v_delivery_snapshot := jsonb_build_object(
      'campus_area',   left(COALESCE(trim(v_actual_delivery->>'campus_area'), 'Main Campus'), 80),
      'meeting_point', left(COALESCE(v_actual_delivery->>'meeting_point', 'Vendor Storefront'), 240)
    );
  END IF;

  SELECT full_name INTO v_buyer_name FROM public.profiles WHERE id = v_uid;

  -- ── ONE ORDER PER VENDOR ─────────────────────────────────────────────────
  FOR v_group IN SELECT * FROM jsonb_array_elements(v_cart->'vendors') LOOP
    v_sub  := (v_group->>'subtotal_kobo')::BIGINT;
    v_pfee := (v_group->>'platform_fee_kobo')::BIGINT;
    v_fee  := CASE WHEN p_delivery_type = 'delivery'
                   THEN (v_group->>'delivery_fee_kobo')::BIGINT
                   ELSE 0 END;

    -- The escrow fee is charged on THIS order's merchandise subtotal, so a
    -- buyer splitting a cart across vendors pays a per-order floor and cap.
    IF COALESCE(v_settings.escrow_enabled, true) THEN
      v_normal_escrow := public.mp_escrow_fee_for(
        v_sub,
        COALESCE(v_settings.escrow_fee_bps, 150),
        COALESCE(v_settings.escrow_fee_min_kobo, 10000),
        COALESCE(v_settings.escrow_fee_max_kobo, 500000));
    ELSE
      v_normal_escrow := 0;
    END IF;

    -- Calculate Escrow Fee for this order
    IF v_has_prem AND v_normal_escrow > 0
       AND COALESCE(v_settings.premium_marketplace_benefits_enabled, true)
       AND v_credit_row.id IS NOT NULL THEN
      IF v_credit_row.credit_remaining_kobo >= v_normal_escrow THEN
        v_escrow_credit_app := v_normal_escrow;
        v_escrow_disc := 0;
        v_escrow_fee := 0;
        -- Deduct from credit row
        v_credit_row.credit_used_kobo := v_credit_row.credit_used_kobo + v_escrow_credit_app;
        v_credit_row.credit_remaining_kobo := v_credit_row.credit_granted_kobo - v_credit_row.credit_used_kobo;
      ELSIF v_credit_row.credit_remaining_kobo > 0 THEN
        v_escrow_credit_app := v_credit_row.credit_remaining_kobo;
        DECLARE
          v_rem BIGINT := v_normal_escrow - v_escrow_credit_app;
        BEGIN
          v_escrow_disc := round(v_rem::NUMERIC * (COALESCE(v_settings.premium_escrow_discount_pct, 50)::NUMERIC / 100.0))::BIGINT;
          v_escrow_fee  := v_rem - v_escrow_disc;
          v_credit_row.credit_used_kobo := v_credit_row.credit_granted_kobo;
          v_credit_row.credit_remaining_kobo := 0;
        END;
      ELSE
        -- Credit exhausted -> 50% discount
        v_escrow_credit_app := 0;
        v_escrow_disc := round(v_normal_escrow::NUMERIC * (COALESCE(v_settings.premium_escrow_discount_pct, 50)::NUMERIC / 100.0))::BIGINT;
        v_escrow_fee  := v_normal_escrow - v_escrow_disc;
      END IF;

      -- Update the locked credit row in the database
      UPDATE public.marketplace_escrow_credit_ledger
         SET credit_used_kobo = v_credit_row.credit_used_kobo,
             credit_remaining_kobo = v_credit_row.credit_remaining_kobo,
             updated_at = now()
       WHERE id = v_credit_row.id;
    ELSE
      -- Free user -> normal escrow fee
      v_escrow_credit_app := 0;
      v_escrow_disc := 0;
      v_escrow_fee := v_normal_escrow;
    END IF;

    v_total := v_sub + v_fee + v_escrow_fee;
    v_payout := v_sub - v_pfee;

    IF v_total <= 0 THEN
      RAISE EXCEPTION 'Order total must be greater than zero' USING ERRCODE = '22023';
    END IF;

    v_grand_total  := v_grand_total + v_total;
    v_grand_sub    := v_grand_sub + v_sub;
    v_grand_fee    := v_grand_fee + v_fee;
    v_grand_pfee   := v_grand_pfee + v_pfee;
    v_grand_escrow := v_grand_escrow + v_escrow_fee;

    SELECT owner_id INTO v_vendor_owner
      FROM public.marketplace_vendors WHERE id = (v_group->>'vendor_id')::UUID;

    INSERT INTO public.marketplace_orders
      (checkout_id, order_number, buyer_id, vendor_id, status,
       subtotal_kobo, delivery_fee_kobo, platform_fee_kobo, escrow_fee_kobo,
       escrow_credit_applied_kobo, escrow_discount_kobo, total_kobo, vendor_payout_kobo,
       fulfilment, delivery_snapshot, buyer_note, campus_area, auto_confirm_at)
    VALUES
      (v_checkout.id, public.mp_order_number(), v_uid, (v_group->>'vendor_id')::UUID, 'pending_payment',
       v_sub, v_fee, v_pfee, v_escrow_fee,
       v_escrow_credit_app, v_escrow_disc, v_total, v_payout,
       p_delivery_type, v_delivery_snapshot, nullif(left(trim(COALESCE(p_buyer_note, '')), 800), ''),
       nullif(left(COALESCE(v_delivery_snapshot->>'campus_area', ''), 80), ''),
       now() + make_interval(hours => COALESCE(v_settings.auto_confirm_hours, 48)))
    RETURNING * INTO v_order;

    v_order_id := v_order.id;
    v_item_count := 0;

    -- Record consumption into ledger if credit or discount was applied
    IF v_credit_row.id IS NOT NULL AND (v_escrow_credit_app > 0 OR v_escrow_disc > 0) THEN
      INSERT INTO public.marketplace_escrow_credit_consumptions
        (escrow_credit_id, order_id, user_id, normal_escrow_fee_kobo,
         credit_applied_kobo, discount_applied_kobo, final_escrow_fee_kobo)
      VALUES
        (v_credit_row.id, v_order_id, v_uid, v_normal_escrow,
         v_escrow_credit_app, v_escrow_disc, v_escrow_fee);
    END IF;

    -- Create payment record
    INSERT INTO public.marketplace_payments
      (order_id, buyer_id, provider, amount_kobo, currency, status, channel)
    VALUES
      (v_order_id, v_uid,
       v_provider,
       v_total, 'NGN',
       'awaiting_payment',
       'none')
    RETURNING id INTO v_payment_id;

    UPDATE public.marketplace_orders SET payment_id = v_payment_id WHERE id = v_order_id;

    -- Line items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_group->'items') LOOP
      INSERT INTO public.marketplace_order_items
        (order_id, product_id, variant_id, product_title, variant_label, image_path,
         unit_price_kobo, quantity, line_total_kobo, is_service)
      VALUES
        (v_order_id, (v_item->>'product_id')::UUID, (v_item->>'variant_id')::UUID,
         left(v_item->>'title', 200), v_item->>'variant_label', v_item->>'thumbnail_path',
         (v_item->>'unit_price_kobo')::BIGINT, (v_item->>'quantity')::INT,
         (v_item->>'line_total_kobo')::BIGINT, COALESCE((v_item->>'is_service')::BOOLEAN, false));

      v_item_count := v_item_count + 1;

      -- Reserve physical stock
      IF NOT COALESCE((v_item->>'is_service')::BOOLEAN, false) THEN
        IF (v_item->>'variant_id')::UUID IS NULL THEN
          UPDATE public.marketplace_products
             SET quantity_reserved = quantity_reserved + (v_item->>'quantity')::INT,
                 status = CASE
                            WHEN quantity_total - quantity_sold
                                 - (quantity_reserved + (v_item->>'quantity')::INT) <= 0
                              THEN 'sold_out'::public.marketplace_listing_status
                            ELSE status END,
                 updated_at = now()
           WHERE id = (v_item->>'product_id')::UUID;
        ELSE
          UPDATE public.marketplace_product_variants
             SET quantity_reserved = quantity_reserved + (v_item->>'quantity')::INT,
                 is_available = quantity_total - quantity_sold
                                 - (quantity_reserved + (v_item->>'quantity')::INT) > 0,
                 updated_at = now()
           WHERE id = (v_item->>'variant_id')::UUID;
        END IF;
      END IF;
    END LOOP;

    -- Open order conversation
    PERFORM public.mp_upsert_conversation(v_order_id, v_order.vendor_id, v_uid, 'order');

    INSERT INTO public.marketplace_order_status_history
      (order_id, from_status, to_status, actor_id, actor_role, reason, metadata)
    VALUES
      (v_order_id, NULL, 'pending_payment', v_uid, 'buyer', 'Order created at checkout',
       jsonb_build_object(
         'total_kobo', v_total,
         'escrow_fee_kobo', v_escrow_fee,
         'credit_applied_kobo', v_escrow_credit_app,
         'discount_applied_kobo', v_escrow_disc,
         'items', v_item_count
       ));

    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'status', v_order.status,
      'total_kobo', v_order.total_kobo,
      'escrow_fee_kobo', v_order.escrow_fee_kobo,
      'escrow_credit_applied_kobo', v_order.escrow_credit_applied_kobo,
      'escrow_discount_kobo', v_order.escrow_discount_kobo,
      'vendor_id', v_order.vendor_id,
      'payment_id', v_payment_id,
      'shop_name', v_group->>'shop_name'
    ));
  END LOOP;

  UPDATE public.marketplace_checkouts
     SET status = 'placed'
   WHERE id = v_checkout.id;

  RETURN jsonb_build_object(
    'checkout_id', v_checkout.id,
    'payment_id', (SELECT o.payment_id FROM public.marketplace_orders o WHERE o.checkout_id = v_checkout.id LIMIT 1),
    'orders', v_orders,
    'order_count', jsonb_array_length(v_orders),
    'replayed', FALSE,
    'subtotal_kobo', v_grand_sub,
    'delivery_fee_kobo', v_grand_fee,
    'platform_fee_kobo', v_grand_pfee,
    'escrow_fee_kobo', v_grand_escrow,
    'total_kobo', v_grand_total,
    'payments_enabled', v_settings.payments_enabled
  );
END;
$function$;

-- ── SETTINGS RPC ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mp_update_platform_settings(
  integer, integer, integer, integer, integer, integer, boolean, boolean, boolean, boolean, boolean,
  bigint, bigint, integer, boolean, boolean, boolean
) CASCADE;

CREATE OR REPLACE FUNCTION public.mp_update_platform_settings(
  p_default_commission_bps integer DEFAULT NULL,
  p_event_ticket_fee_kobo integer DEFAULT NULL,
  p_min_withdrawal_kobo integer DEFAULT NULL,
  p_settlement_delay_hours integer DEFAULT NULL,
  p_auto_confirm_hours integer DEFAULT NULL,
  p_return_window_hours integer DEFAULT NULL,
  p_require_vendor_verification boolean DEFAULT NULL,
  p_allow_registration boolean DEFAULT NULL,
  p_allow_new_vendors boolean DEFAULT NULL,
  p_payments_enabled boolean DEFAULT NULL,
  p_maintenance_mode boolean DEFAULT NULL,
  p_escrow_fee_kobo bigint DEFAULT NULL,
  p_premium_escrow_credit_kobo bigint DEFAULT NULL,
  p_premium_escrow_discount_pct integer DEFAULT NULL,
  p_premium_marketplace_benefits_enabled boolean DEFAULT NULL,
  p_verified_scholar_badge_enabled boolean DEFAULT NULL,
  p_premium_visibility_enabled boolean DEFAULT NULL,
  p_escrow_fee_bps integer DEFAULT NULL,
  p_escrow_fee_min_kobo bigint DEFAULT NULL,
  p_escrow_fee_max_kobo bigint DEFAULT NULL,
  p_escrow_fee_currency text DEFAULT NULL,
  p_escrow_enabled boolean DEFAULT NULL
)
RETURNS public.marketplace_platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated public.marketplace_platform_settings;
  v_before public.marketplace_platform_settings;
BEGIN
  IF NOT (public.is_admin()) THEN
    RAISE EXCEPTION 'Only administrators can modify marketplace platform settings.' USING ERRCODE = '42501';
  END IF;

  IF p_default_commission_bps IS NOT NULL AND (p_default_commission_bps < 0 OR p_default_commission_bps > 5000) THEN
    RAISE EXCEPTION 'Default commission must be between 0 and 5000 bps (0%% - 50%%).' USING ERRCODE = '22023';
  END IF;

  IF p_event_ticket_fee_kobo IS NOT NULL AND p_event_ticket_fee_kobo < 0 THEN
    RAISE EXCEPTION 'Event ticket fee cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_min_withdrawal_kobo IS NOT NULL AND p_min_withdrawal_kobo < 0 THEN
    RAISE EXCEPTION 'Minimum withdrawal cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_escrow_fee_kobo IS NOT NULL AND p_escrow_fee_kobo < 0 THEN
    RAISE EXCEPTION 'Escrow fee cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_escrow_fee_bps IS NOT NULL AND (p_escrow_fee_bps < 0 OR p_escrow_fee_bps > 5000) THEN
    RAISE EXCEPTION 'Escrow fee must be between 0 and 5000 bps (0%% - 50%%).' USING ERRCODE = '22023';
  END IF;

  IF p_escrow_fee_min_kobo IS NOT NULL AND p_escrow_fee_min_kobo < 0 THEN
    RAISE EXCEPTION 'Escrow fee floor cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_escrow_fee_max_kobo IS NOT NULL AND p_escrow_fee_max_kobo < 0 THEN
    RAISE EXCEPTION 'Escrow fee cap cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_escrow_fee_min_kobo, 0) > COALESCE(p_escrow_fee_max_kobo, p_escrow_fee_min_kobo, 0) THEN
    RAISE EXCEPTION 'Escrow fee floor cannot exceed the cap.' USING ERRCODE = '22023';
  END IF;

  IF p_escrow_fee_currency IS NOT NULL AND char_length(trim(p_escrow_fee_currency)) <> 3 THEN
    RAISE EXCEPTION 'Escrow fee currency must be a 3-letter code.' USING ERRCODE = '22023';
  END IF;

  IF p_premium_escrow_credit_kobo IS NOT NULL AND p_premium_escrow_credit_kobo < 0 THEN
    RAISE EXCEPTION 'Premium escrow credit cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF p_premium_escrow_discount_pct IS NOT NULL AND (p_premium_escrow_discount_pct < 0 OR p_premium_escrow_discount_pct > 100) THEN
    RAISE EXCEPTION 'Discount percentage must be between 0 and 100.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.marketplace_platform_settings WHERE id = 1;

  UPDATE public.marketplace_platform_settings
  SET
    default_commission_bps = COALESCE(p_default_commission_bps, default_commission_bps),
    event_ticket_fee_kobo = COALESCE(p_event_ticket_fee_kobo, event_ticket_fee_kobo),
    min_withdrawal_kobo = COALESCE(p_min_withdrawal_kobo, min_withdrawal_kobo),
    settlement_delay_hours = COALESCE(p_settlement_delay_hours, settlement_delay_hours),
    auto_confirm_hours = COALESCE(p_auto_confirm_hours, auto_confirm_hours),
    return_window_hours = COALESCE(p_return_window_hours, return_window_hours),
    require_vendor_verification = COALESCE(p_require_vendor_verification, require_vendor_verification),
    allow_registration = COALESCE(p_allow_registration, allow_registration),
    allow_new_vendors = COALESCE(p_allow_new_vendors, allow_new_vendors),
    payments_enabled = COALESCE(p_payments_enabled, payments_enabled),
    maintenance_mode = COALESCE(p_maintenance_mode, maintenance_mode),
    escrow_fee_kobo = COALESCE(p_escrow_fee_kobo, escrow_fee_kobo),
    escrow_fee_bps = COALESCE(p_escrow_fee_bps, escrow_fee_bps),
    escrow_fee_min_kobo = COALESCE(p_escrow_fee_min_kobo, escrow_fee_min_kobo),
    escrow_fee_max_kobo = COALESCE(p_escrow_fee_max_kobo, escrow_fee_max_kobo),
    escrow_fee_currency = COALESCE(upper(trim(p_escrow_fee_currency)), escrow_fee_currency),
    escrow_enabled = COALESCE(p_escrow_enabled, escrow_enabled),
    premium_escrow_credit_kobo = COALESCE(p_premium_escrow_credit_kobo, premium_escrow_credit_kobo),
    premium_escrow_discount_pct = COALESCE(p_premium_escrow_discount_pct, premium_escrow_discount_pct),
    premium_marketplace_benefits_enabled = COALESCE(p_premium_marketplace_benefits_enabled, premium_marketplace_benefits_enabled),
    verified_scholar_badge_enabled = COALESCE(p_verified_scholar_badge_enabled, verified_scholar_badge_enabled),
    premium_visibility_enabled = COALESCE(p_premium_visibility_enabled, premium_visibility_enabled),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO v_updated;

  -- Financial settings are audited with the before/after figures so a change to
  -- what every buyer pays is never a silent write.
  IF v_before.escrow_fee_bps IS DISTINCT FROM v_updated.escrow_fee_bps
     OR v_before.escrow_fee_min_kobo IS DISTINCT FROM v_updated.escrow_fee_min_kobo
     OR v_before.escrow_fee_max_kobo IS DISTINCT FROM v_updated.escrow_fee_max_kobo
     OR v_before.escrow_fee_currency IS DISTINCT FROM v_updated.escrow_fee_currency
     OR v_before.escrow_enabled IS DISTINCT FROM v_updated.escrow_enabled THEN
    PERFORM public.mp_audit('settings.escrow_fee_updated', 'platform_settings', 1,
      jsonb_build_object(
        'escrow_fee_bps', v_before.escrow_fee_bps,
        'escrow_fee_min_kobo', v_before.escrow_fee_min_kobo,
        'escrow_fee_max_kobo', v_before.escrow_fee_max_kobo,
        'escrow_fee_currency', v_before.escrow_fee_currency,
        'escrow_enabled', v_before.escrow_enabled),
      jsonb_build_object(
        'escrow_fee_bps', v_updated.escrow_fee_bps,
        'escrow_fee_min_kobo', v_updated.escrow_fee_min_kobo,
        'escrow_fee_max_kobo', v_updated.escrow_fee_max_kobo,
        'escrow_fee_currency', v_updated.escrow_fee_currency,
        'escrow_enabled', v_updated.escrow_enabled),
      'Escrow fee pricing updated', 'admin');
  END IF;

  IF v_before.default_commission_bps IS DISTINCT FROM v_updated.default_commission_bps THEN
    PERFORM public.mp_audit('settings.commission_updated', 'platform_settings', 1,
      jsonb_build_object('default_commission_bps', v_before.default_commission_bps),
      jsonb_build_object('default_commission_bps', v_updated.default_commission_bps),
      'Commission updated', 'admin');
  END IF;

  RETURN v_updated;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mp_update_platform_settings TO authenticated, service_role;

-- ── WALLET BOOKING: HOLD THE FEE ON FUNDING ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_on_escrow_funded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_vendor_wallet UUID;
  v_platform_wallet UUID;
  v_net BIGINT;
  v_platform BIGINT;
  v_escrow_fee BIGINT;
  v_actor UUID := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.vendor_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Three figures, all read from the order and never from the request, and they
  -- are exactly what the buyer paid:
  --   vendor_payout_kobo + platform_fee_kobo + delivery_fee_kobo
  --     + escrow_fee_kobo == total_kobo
  v_net        := COALESCE(v_order.vendor_payout_kobo, 0);
  v_platform   := public.mp_platform_share(v_order);
  v_escrow_fee := COALESCE(v_order.escrow_fee_kobo, 0);

  IF v_net <= 0 AND v_platform <= 0 AND v_escrow_fee <= 0 THEN
    RETURN NULL;
  END IF;

  v_vendor_wallet   := public.mp_wallet_ensure(p_vendor_id => v_order.vendor_id);
  v_platform_wallet := public.mp_wallet_ensure();

  IF v_net > 0 THEN
    PERFORM public.mp_wallet_post(
      v_vendor_wallet, 'credit', 'pending', v_net, 'escrow_funded',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':funded',
      format('Held for order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'payment_id', NEW.payment_id,
                         'order_total_kobo', NEW.amount_kobo, 'net_kobo', v_net),
      v_actor);
  END IF;

  IF v_platform > 0 THEN
    -- Commission and delivery are recognised immediately: the platform has the
    -- money and owes nobody a share of it. A later refund takes exactly this
    -- figure back.
    PERFORM public.mp_wallet_post(
      v_platform_wallet, 'credit', 'available', v_platform, 'platform_fee',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':platform_share',
      format('Commission and delivery on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id,
                         'platform_fee_kobo', v_order.platform_fee_kobo,
                         'delivery_fee_kobo', v_order.delivery_fee_kobo,
                         'share_kobo', v_platform),
      v_actor);
  END IF;

  IF v_escrow_fee > 0 THEN
    -- Held, not recognised: the buyer can still return the goods and reclaim
    -- the fee. It becomes withdrawable only when the settlement matures.
    PERFORM public.mp_wallet_post(
      v_platform_wallet, 'credit', 'pending', v_escrow_fee, 'escrow_fee',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':escrow_fee',
      format('Escrow fee held on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id,
                         'escrow_fee_kobo', v_escrow_fee,
                         'order_total_kobo', NEW.amount_kobo),
      v_actor);
  END IF;

  RETURN NULL;
END;
$function$;

-- ── WALLET BOOKING: UNWIND WITHOUT A SETTLEMENT ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_on_escrow_unwound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_found_settlement BOOLEAN;
  v_net BIGINT;
  v_platform BIGINT;
  v_escrow_fee BIGINT;
  v_actor UUID := auth.uid();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status NOT IN ('refunded', 'cancelled') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.vendor_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.marketplace_settlements s
                  WHERE s.order_id = NEW.order_id) INTO v_found_settlement;

  IF v_found_settlement THEN
    -- D3 owns every settlement that exists; stepping in here as well would
    -- unwind the same kobo twice.
    RETURN NULL;
  END IF;

  v_net        := COALESCE(v_order.vendor_payout_kobo, 0);
  v_platform   := public.mp_platform_share(v_order);
  v_escrow_fee := COALESCE(v_order.escrow_fee_kobo, 0);

  IF v_net > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(p_vendor_id => v_order.vendor_id), v_net, 'escrow_refund',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':refund_vendor',
      format('Hold released on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'no_settlement', TRUE), v_actor);
  END IF;

  IF v_platform > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(), v_platform, 'platform_fee_refund',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':refund_platform',
      format('Commission reversed on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'no_settlement', TRUE), v_actor);
  END IF;

  IF v_escrow_fee > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(), v_escrow_fee, 'escrow_fee_refund',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':refund_escrow_fee',
      format('Escrow fee reversed on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'escrow_fee_kobo', v_escrow_fee,
                         'no_settlement', TRUE), v_actor);
  END IF;

  RETURN NULL;
END;
$function$;

-- ── WALLET BOOKING: RECOGNISE ON SETTLEMENT, UNWIND ON CANCELLATION ─────────
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_from_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_wallet UUID;
  v_platform_wallet UUID;
  v_order public.marketplace_orders%ROWTYPE;
  v_net_drop BIGINT;
  v_comm_drop BIGINT;
  v_delivery BIGINT;
  v_escrow_fee BIGINT;
  v_actor UUID := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_wallet := public.mp_wallet_ensure(p_vendor_id => NEW.vendor_id);
  v_escrow_fee := COALESCE(v_order.escrow_fee_kobo, 0);

  -- ── Partial refund: mp_issue_refund rewrote the settlement in place, so the
  --    receivable shrank and the hold has to shrink by exactly the same amount.
  --    The escrow fee is left intact for the goods the buyer kept.
  IF NEW.net_kobo < OLD.net_kobo THEN
    v_net_drop := OLD.net_kobo - NEW.net_kobo;
    v_comm_drop := GREATEST(OLD.commission_kobo - NEW.commission_kobo, 0);

    PERFORM public.mp_wallet_unwind(
      v_wallet, v_net_drop, 'escrow_refund', 'settlement', NEW.id,
      'settlement:' || NEW.id::TEXT || ':refund_net:' || NEW.net_kobo::TEXT,
      format('Goods returned on order %s', COALESCE(NEW.hold_reason, v_order.order_number)),
      jsonb_build_object('order_id', NEW.order_id, 'net_before', OLD.net_kobo,
                         'net_after', NEW.net_kobo, 'net_drop', v_net_drop),
      v_actor);

    IF v_comm_drop > 0 THEN
      PERFORM public.mp_wallet_unwind(
        public.mp_wallet_ensure(), v_comm_drop, 'platform_fee_refund',
        'settlement', NEW.id,
        'settlement:' || NEW.id::TEXT || ':refund_commission:' || NEW.commission_kobo::TEXT,
        format('Commission reversed on order %s', v_order.order_number),
        jsonb_build_object('order_id', NEW.order_id, 'commission_drop', v_comm_drop),
        v_actor);
    END IF;
  END IF;

  -- ── Outright cancellation: nothing was delivered, so the remaining hold and
  --    the whole platform share go back. Delivery is included here because a
  --    cancelled order is one the buyer never got. The escrow fee is refunded
  --    in full from whichever bucket holds it.
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    v_delivery := COALESCE(v_order.delivery_fee_kobo, 0);

    PERFORM public.mp_wallet_unwind(
      v_wallet, NEW.net_kobo, 'escrow_refund', 'settlement', NEW.id,
      'settlement:' || NEW.id::TEXT || ':cancel_vendor',
      format('Receivable cancelled on order %s', v_order.order_number),
      jsonb_build_object('order_id', NEW.order_id, 'net_kobo', NEW.net_kobo,
                         'reason', left(COALESCE(NEW.hold_reason, ''), 200)),
      v_actor);

    IF NEW.commission_kobo + v_delivery > 0 THEN
      PERFORM public.mp_wallet_unwind(
        public.mp_wallet_ensure(), NEW.commission_kobo + v_delivery,
        'platform_fee_refund', 'settlement', NEW.id,
        'settlement:' || NEW.id::TEXT || ':cancel_platform',
        format('Commission and delivery reversed on order %s', v_order.order_number),
        jsonb_build_object('order_id', NEW.order_id,
                           'commission_kobo', NEW.commission_kobo,
                           'delivery_kobo', v_delivery),
        v_actor);
    END IF;

    IF v_escrow_fee > 0 THEN
      PERFORM public.mp_wallet_unwind(
        public.mp_wallet_ensure(), v_escrow_fee, 'escrow_fee_refund',
        'settlement', NEW.id,
        'settlement:' || NEW.id::TEXT || ':cancel_escrow_fee',
        format('Escrow fee reversed on order %s', v_order.order_number),
        jsonb_build_object('order_id', NEW.order_id, 'escrow_fee_kobo', v_escrow_fee),
        v_actor);
    END IF;
    RETURN NULL;
  END IF;

  -- ── Scheduled: the hold becomes withdrawable money. This is the only place
  --    vendor `available` grows from an order, so the figure the vendor
  --    dashboard shows and the figure mp_request_withdrawal will accept are the
  --    same number by construction. The escrow fee is recognised at the same
  --    moment: the return window has passed, so the platform may keep it.
  IF NEW.status = 'scheduled' AND OLD.status <> 'scheduled' THEN
    PERFORM public.mp_wallet_shift(
      v_wallet, 'pending', 'available', NEW.net_kobo, 'vendor_earning',
      'settlement', NEW.id,
      'settlement:' || NEW.id::TEXT || ':earning',
      format('Earnings from order %s', v_order.order_number),
      jsonb_build_object('gross_kobo', NEW.gross_kobo,
                         'commission_kobo', NEW.commission_kobo,
                         'net_kobo', NEW.net_kobo,
                         'order_id', NEW.order_id),
      v_actor);

    IF v_escrow_fee > 0 THEN
      v_platform_wallet := public.mp_wallet_ensure();
      PERFORM public.mp_wallet_shift(
        v_platform_wallet, 'pending', 'available', v_escrow_fee, 'escrow_fee_recognised',
        'settlement', NEW.id,
        'settlement:' || NEW.id::TEXT || ':escrow_fee_recognised',
        format('Escrow fee recognised on order %s', v_order.order_number),
        jsonb_build_object('order_id', NEW.order_id, 'escrow_fee_kobo', v_escrow_fee),
        v_actor);
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- ── ADMIN ANALYTICS ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_get_admin_escrow_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_escrow_credit_granted_kobo', COALESCE((SELECT sum(credit_granted_kobo) FROM public.marketplace_escrow_credit_ledger), 0),
    'total_escrow_credit_consumed_kobo', COALESCE((SELECT sum(credit_used_kobo) FROM public.marketplace_escrow_credit_ledger), 0),
    'total_escrow_credit_remaining_kobo', COALESCE((SELECT sum(credit_remaining_kobo) FROM public.marketplace_escrow_credit_ledger WHERE is_active = true), 0),
    'total_discounts_applied_kobo', COALESCE((SELECT sum(discount_applied_kobo) FROM public.marketplace_escrow_credit_consumptions), 0),
    'total_escrow_fees_collected_kobo', COALESCE((SELECT sum(escrow_fee_kobo) FROM public.marketplace_orders WHERE status NOT IN ('cancelled', 'refunded')), 0),
    'total_escrow_fee_recognised_kobo', COALESCE((
      SELECT sum(amount_kobo) FROM public.marketplace_ledger_entries
       WHERE entry_type = 'escrow_fee_recognised' AND direction = 'credit' AND bucket = 'available'), 0),
    'total_escrow_fee_refunded_kobo', COALESCE((
      SELECT sum(amount_kobo) FROM public.marketplace_ledger_entries
       WHERE entry_type = 'escrow_fee_refund' AND direction = 'debit'), 0),
    'total_subscribers_with_credit', COALESCE((SELECT count(DISTINCT user_id) FROM public.marketplace_escrow_credit_ledger), 0),
    'total_orders_benefiting', COALESCE((SELECT count(DISTINCT order_id) FROM public.marketplace_escrow_credit_consumptions), 0)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;

COMMIT;
