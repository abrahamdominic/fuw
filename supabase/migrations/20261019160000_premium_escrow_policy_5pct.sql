-- Premium escrow benefit policy correction.
-- The correct policy is: "Premium members receive 5% off eligible escrow fees
-- for the rest of the semester."
--
-- Changes:
--   1. premium_escrow_discount_pct: 50 -> 5
--   2. premium_escrow_credit_kobo:  50000 -> 0  (credit concept removed from UI;
--      setting to 0 makes the credit path inert so only the 5% discount applies)
--   3. Fallbacks in mp_get_user_escrow_credit and mp_preview_checkout_escrow
--      updated to match.
--
-- Historical ledger rows are deliberately left untouched — they are an
-- auditable financial record.
BEGIN;

-- 1. Update the authoritative settings row.
UPDATE public.marketplace_platform_settings
   SET premium_escrow_discount_pct = 5,
       premium_escrow_credit_kobo = 0,
       updated_at = now()
 WHERE id = 1;

-- 2. Update column defaults so new rows start at the corrected values.
ALTER TABLE public.marketplace_platform_settings
  ALTER COLUMN premium_escrow_discount_pct SET DEFAULT 5,
  ALTER COLUMN premium_escrow_credit_kobo SET DEFAULT 0;

ALTER TABLE public.marketplace_escrow_credit_ledger
  ALTER COLUMN credit_granted_kobo SET DEFAULT 0,
  ALTER COLUMN credit_remaining_kobo SET DEFAULT 0;

-- 3. Recreate mp_get_user_escrow_credit with corrected fallbacks.
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
  v_granted BIGINT := 0;
  v_disc_pct INT := 5;
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

  SELECT * INTO v_credit
    FROM public.marketplace_escrow_credit_ledger
   WHERE user_id = v_uid
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC
   LIMIT 1;

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

-- 4. Recreate mp_preview_checkout_escrow with corrected fallback.
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
  v_disc_pct INT := 5;
BEGIN
  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.id IS NOT NULL THEN
    v_disc_pct := COALESCE(v_settings.premium_escrow_discount_pct, 5);
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

GRANT EXECUTE ON FUNCTION public.mp_preview_checkout_escrow(BIGINT, UUID) TO authenticated, service_role, anon;

COMMIT;
