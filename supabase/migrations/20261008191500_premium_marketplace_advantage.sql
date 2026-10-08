-- =============================================================================
-- Migration: 20261008191500_premium_marketplace_advantage.sql
-- Description: Implement Premium Marketplace Advantage:
--              1. ₦2,000 Marketplace Escrow Credit per Premium Subscription Period
--              2. 50% Escrow Fee Reduction post-credit
--              3. Verified Scholar badge & Premium member badge logic
--              4. Auditable Escrow Credit Ledger & Consumption Tracking
--              5. Authoritative Server-side Escrow calculations in mp_create_orders
--              6. Admin Configuration & Revenue Analytics RPC
-- =============================================================================

BEGIN;

-- 1. ADD CONFIGURATION COLUMNS TO marketplace_platform_settings
ALTER TABLE public.marketplace_platform_settings
  ADD COLUMN IF NOT EXISTS escrow_fee_kobo BIGINT NOT NULL DEFAULT 120000 CHECK (escrow_fee_kobo >= 0),
  ADD COLUMN IF NOT EXISTS premium_escrow_credit_kobo BIGINT NOT NULL DEFAULT 200000 CHECK (premium_escrow_credit_kobo >= 0),
  ADD COLUMN IF NOT EXISTS premium_escrow_discount_pct INTEGER NOT NULL DEFAULT 50 CHECK (premium_escrow_discount_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS premium_marketplace_benefits_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verified_scholar_badge_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS premium_visibility_enabled BOOLEAN NOT NULL DEFAULT true;

-- 2. CREATE ESCROW CREDIT LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.marketplace_escrow_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  credit_granted_kobo BIGINT NOT NULL DEFAULT 200000 CHECK (credit_granted_kobo >= 0),
  credit_used_kobo BIGINT NOT NULL DEFAULT 0 CHECK (credit_used_kobo >= 0),
  credit_remaining_kobo BIGINT NOT NULL DEFAULT 200000 CHECK (credit_remaining_kobo >= 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_credit_used_le_granted CHECK (credit_used_kobo <= credit_granted_kobo),
  CONSTRAINT mp_credit_math_consistent CHECK (credit_remaining_kobo = credit_granted_kobo - credit_used_kobo)
);

CREATE INDEX IF NOT EXISTS idx_mp_escrow_credit_user_active
  ON public.marketplace_escrow_credit_ledger (user_id, is_active)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_escrow_credit_sub_unique
  ON public.marketplace_escrow_credit_ledger (subscription_id)
  WHERE subscription_id IS NOT NULL;

ALTER TABLE public.marketplace_escrow_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own escrow credit ledger" ON public.marketplace_escrow_credit_ledger;
CREATE POLICY "Users can read own escrow credit ledger"
  ON public.marketplace_escrow_credit_ledger
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

GRANT SELECT ON public.marketplace_escrow_credit_ledger TO authenticated, service_role;

-- 3. CREATE ESCROW CREDIT CONSUMPTIONS TABLE (Auditable History)
CREATE TABLE IF NOT EXISTS public.marketplace_escrow_credit_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_credit_id UUID NOT NULL REFERENCES public.marketplace_escrow_credit_ledger(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  normal_escrow_fee_kobo BIGINT NOT NULL CHECK (normal_escrow_fee_kobo >= 0),
  credit_applied_kobo BIGINT NOT NULL CHECK (credit_applied_kobo >= 0),
  discount_applied_kobo BIGINT NOT NULL DEFAULT 0 CHECK (discount_applied_kobo >= 0),
  final_escrow_fee_kobo BIGINT NOT NULL CHECK (final_escrow_fee_kobo >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_escrow_consumptions_user
  ON public.marketplace_escrow_credit_consumptions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mp_escrow_consumptions_order
  ON public.marketplace_escrow_credit_consumptions (order_id);

ALTER TABLE public.marketplace_escrow_credit_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own escrow consumptions" ON public.marketplace_escrow_credit_consumptions;
CREATE POLICY "Users can read own escrow consumptions"
  ON public.marketplace_escrow_credit_consumptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

GRANT SELECT ON public.marketplace_escrow_credit_consumptions TO authenticated, service_role;

-- 4. ADD ESCROW COLUMNS TO marketplace_orders AND UPDATE TOTALS CONSTRAINT
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS escrow_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (escrow_fee_kobo >= 0),
  ADD COLUMN IF NOT EXISTS escrow_credit_applied_kobo BIGINT NOT NULL DEFAULT 0 CHECK (escrow_credit_applied_kobo >= 0),
  ADD COLUMN IF NOT EXISTS escrow_discount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (escrow_discount_kobo >= 0);

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS mp_order_totals_consistent;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT mp_order_totals_consistent
  CHECK (total_kobo = subtotal_kobo + delivery_fee_kobo + escrow_fee_kobo);

-- 5. RPC FUNCTION: GET OR INITIALIZE USER ESCROW CREDIT
CREATE OR REPLACE FUNCTION public.mp_get_user_escrow_credit(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_credit public.marketplace_escrow_credit_ledger%ROWTYPE;
  v_has_prem BOOLEAN := false;
  v_granted BIGINT := 200000;
  v_disc_pct INT := 50;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'has_premium', false,
      'credit_granted_kobo', 0,
      'credit_used_kobo', 0,
      'credit_remaining_kobo', 0,
      'discount_pct', 0,
      'is_active', false,
      'expires_at', null
    );
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.id IS NOT NULL THEN
    v_granted := v_settings.premium_escrow_credit_kobo;
    v_disc_pct := v_settings.premium_escrow_discount_pct;
  END IF;

  -- Check if user has active premium subscription
  SELECT * INTO v_sub
    FROM public.subscriptions s
    JOIN public.plans p ON p.id = s.plan_id
   WHERE s.user_id = v_uid
     AND s.status = 'active'
     AND p.is_premium = true
     AND (s.expires_at IS NULL OR s.expires_at > now())
   ORDER BY s.expires_at DESC NULLS FIRST
   LIMIT 1;

  IF FOUND THEN
    v_has_prem := true;
  ELSE
    -- Also check global premium grant or entitlements
    IF EXISTS (
      SELECT 1 FROM public.premium_entitlements
       WHERE user_id = v_uid
         AND is_active = true
         AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      v_has_prem := true;
    END IF;
  END IF;

  IF NOT v_has_prem THEN
    RETURN jsonb_build_object(
      'has_premium', false,
      'credit_granted_kobo', 0,
      'credit_used_kobo', 0,
      'credit_remaining_kobo', 0,
      'discount_pct', 0,
      'is_active', false,
      'expires_at', null
    );
  END IF;

  -- Look for active escrow credit record matching subscription or user
  SELECT * INTO v_credit
    FROM public.marketplace_escrow_credit_ledger
   WHERE user_id = v_uid
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC
   LIMIT 1;

  -- If premium is active but credit record not yet created for this period, create it
  IF NOT FOUND THEN
    INSERT INTO public.marketplace_escrow_credit_ledger (
      user_id,
      subscription_id,
      credit_granted_kobo,
      credit_used_kobo,
      credit_remaining_kobo,
      starts_at,
      expires_at,
      is_active
    )
    VALUES (
      v_uid,
      v_sub.id,
      v_granted,
      0,
      v_granted,
      COALESCE(v_sub.starts_at, now()),
      v_sub.expires_at,
      true
    )
    RETURNING * INTO v_credit;
  END IF;

  RETURN jsonb_build_object(
    'has_premium', true,
    'credit_granted_kobo', v_credit.credit_granted_kobo,
    'credit_used_kobo', v_credit.credit_used_kobo,
    'credit_remaining_kobo', v_credit.credit_remaining_kobo,
    'discount_pct', v_disc_pct,
    'is_active', v_credit.is_active,
    'expires_at', v_credit.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mp_get_user_escrow_credit(UUID) TO authenticated, service_role, anon;

-- 6. RPC FUNCTION: PREVIEW CHECKOUT ESCROW BREAKDOWN (Read-Only)
CREATE OR REPLACE FUNCTION public.mp_preview_checkout_escrow(
  p_subtotal_kobo BIGINT,
  p_buyer_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := COALESCE(p_buyer_id, auth.uid());
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_credit_info JSONB;
  v_normal_fee BIGINT := 120000;
  v_credit_avail BIGINT := 0;
  v_credit_applied BIGINT := 0;
  v_remainder BIGINT := 0;
  v_discount BIGINT := 0;
  v_final_fee BIGINT := 120000;
  v_has_prem BOOLEAN := false;
  v_disc_pct INT := 50;
BEGIN
  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.id IS NOT NULL THEN
    v_normal_fee := v_settings.escrow_fee_kobo;
    v_disc_pct   := v_settings.premium_escrow_discount_pct;
  END IF;

  -- Default for free users
  v_final_fee := v_normal_fee;

  IF v_uid IS NOT NULL AND COALESCE(v_settings.premium_marketplace_benefits_enabled, true) THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.mp_preview_checkout_escrow(BIGINT, UUID) TO authenticated, service_role, anon;

-- 7. REVISE mp_create_orders TO ENFORCE AUTHORITATIVE ESCROW PRICING AND ATOMIC CREDIT LEDGER
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

  v_normal_escrow := COALESCE(v_settings.escrow_fee_kobo, 120000);

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

    -- Calculate Escrow Fee for this order
    IF v_has_prem AND COALESCE(v_settings.premium_marketplace_benefits_enabled, true) AND v_credit_row.id IS NOT NULL THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.mp_create_orders(TEXT, JSONB, public.marketplace_delivery_type, JSONB, TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_create_orders(TEXT, JSONB, public.marketplace_delivery_type, JSONB, TEXT, TEXT) TO service_role;

-- 8. RPC FUNCTION: GET ADMIN ESCROW & REVENUE ANALYTICS
CREATE OR REPLACE FUNCTION public.mp_get_admin_escrow_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    'total_subscribers_with_credit', COALESCE((SELECT count(DISTINCT user_id) FROM public.marketplace_escrow_credit_ledger), 0),
    'total_orders_benefiting', COALESCE((SELECT count(DISTINCT order_id) FROM public.marketplace_escrow_credit_consumptions), 0)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mp_get_admin_escrow_analytics() TO authenticated, service_role;

COMMIT;
