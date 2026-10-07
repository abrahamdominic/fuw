-- =============================================================================
-- Migration: 20261005210000_fix_marketplace_create_orders_rpc.sql
-- Description: Standardize mp_create_orders RPC parameter signature for frontend checkout
-- =============================================================================

-- Ensure enum values include manual_bank_transfer and none
DO $$ BEGIN
  CREATE TYPE public.marketplace_payment_provider AS ENUM ('paystack', 'manual_bank_transfer', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Drop previous signature before recreating with canonical p_delivery_type
DROP FUNCTION IF EXISTS public.mp_create_orders(text,jsonb,public.marketplace_delivery_type,jsonb,text,public.marketplace_payment_provider) CASCADE;
DROP FUNCTION IF EXISTS public.mp_create_orders(text,jsonb,public.marketplace_delivery_type,jsonb,text,text) CASCADE;

-- Canonical mp_create_orders matching frontend signature (p_delivery_type)
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
AS $$
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
  v_item_count INT;
  v_grand_total BIGINT := 0;
  v_grand_sub   BIGINT := 0;
  v_grand_fee   BIGINT := 0;
  v_grand_pfee  BIGINT := 0;
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

  -- Normalize stringified items if passed as string scalar
  IF jsonb_typeof(v_actual_items) = 'string' THEN
    v_actual_items := (v_actual_items #>> '{}')::JSONB;
  END IF;

  -- Normalize stringified delivery object
  IF jsonb_typeof(v_actual_delivery) = 'string' THEN
    v_actual_delivery := (v_actual_delivery #>> '{}')::JSONB;
  END IF;

  -- Map payment provider text to enum
  v_provider := CASE
    WHEN p_payment_provider IN ('manual_bank_transfer', 'bank_transfer') THEN 'manual_bank_transfer'::public.marketplace_payment_provider
    WHEN p_payment_provider = 'paystack' THEN 'paystack'::public.marketplace_payment_provider
    -- A wallet order still starts as awaiting_payment. mp_pay_order_from_wallet
    -- settles it in one transaction later, so the money is never left reserved
    -- against a balance that may not cover it.
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
             'shop_name', v.shop_name
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
      'total_kobo',        (SELECT COALESCE(sum(total_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'payments_enabled', v_settings.payments_enabled
    );
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.marketplace_checkouts (buyer_id, idempotency_key)
    VALUES (v_uid, p_idempotency_key)
    RETURNING * INTO v_checkout;
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
    v_total := v_sub + v_fee;
    v_payout := v_sub - v_pfee;

    IF v_total <= 0 THEN
      RAISE EXCEPTION 'Order total must be greater than zero' USING ERRCODE = '22023';
    END IF;

    v_grand_total  := v_grand_total + v_total;
    v_grand_sub    := v_grand_sub + v_sub;
    v_grand_fee    := v_grand_fee + v_fee;
    v_grand_pfee   := v_grand_pfee + v_pfee;

    SELECT owner_id INTO v_vendor_owner
      FROM public.marketplace_vendors WHERE id = (v_group->>'vendor_id')::UUID;

    INSERT INTO public.marketplace_orders
      (checkout_id, order_number, buyer_id, vendor_id, status,
       subtotal_kobo, delivery_fee_kobo, platform_fee_kobo, total_kobo, vendor_payout_kobo,
       fulfilment, delivery_snapshot, buyer_note, campus_area, auto_confirm_at)
    VALUES
      (v_checkout.id, public.mp_order_number(), v_uid, (v_group->>'vendor_id')::UUID, 'pending_payment',
       v_sub, v_fee, v_pfee, v_total, v_payout,
       p_delivery_type, v_delivery_snapshot, nullif(left(trim(COALESCE(p_buyer_note, '')), 800), ''),
       nullif(left(COALESCE(v_delivery_snapshot->>'campus_area', ''), 80), ''),
       now() + make_interval(hours => COALESCE(v_settings.auto_confirm_hours, 48)))
    RETURNING * INTO v_order;

    v_order_id := v_order.id;
    v_item_count := 0;

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

      -- Reserve physical stock (services skip stock reservation)
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
       jsonb_build_object('total_kobo', v_total, 'items', v_item_count));

    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order.order_number,
      'vendor_id', v_order.vendor_id,
      'shop_name', v_group->>'shop_name',
      'subtotal_kobo', v_sub,
      'delivery_fee_kobo', v_fee,
      'platform_fee_kobo', v_pfee,
      'total_kobo', v_total,
      'vendor_payout_kobo', v_payout,
      'status', 'pending_payment',
      'payment_id', v_payment_id
    ));

    PERFORM public.mp_notify(
      v_vendor_owner,
      'order_placed',
      'New order ' || v_order.order_number,
      format('%s placed an order for NGN %s.', COALESCE(v_buyer_name, 'A student'), to_char(v_total / 100.0, 'FM999999999990.00')),
      '/vendor/orders/' || v_order_id::TEXT,
      'order', v_order_id,
      'order_placed:' || v_order_id::TEXT);
  END LOOP;

  UPDATE public.marketplace_checkouts
     SET status = 'placed', order_count = jsonb_array_length(v_orders)
   WHERE id = v_checkout.id;

  RETURN jsonb_build_object(
    'checkout_id', v_checkout.id,
    'payment_id', v_payment_id,
    'orders', v_orders,
    'order_count', jsonb_array_length(v_orders),
    'subtotal_kobo', v_grand_sub,
    'delivery_fee_kobo', v_grand_fee,
    'platform_fee_kobo', v_grand_pfee,
    'total_kobo', v_grand_total,
    'fulfilment', p_delivery_type,
    'replayed', FALSE,
    'payments_enabled', COALESCE(v_settings.payments_enabled, TRUE)
  );
END $$;

-- Grant permissions to authenticated and anon
GRANT EXECUTE ON FUNCTION public.mp_create_orders(TEXT, JSONB, public.marketplace_delivery_type, JSONB, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_create_orders(TEXT, JSONB, public.marketplace_delivery_type, JSONB, TEXT, TEXT) TO service_role;

-- Notify PostgREST to immediately refresh its schema cache
NOTIFY pgrst, 'reload schema';
