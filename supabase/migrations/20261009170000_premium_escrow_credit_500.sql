-- Premium Marketplace escrow credit benefit is ₦500 (50,000 kobo), not ₦2,000.
-- This corrects the configured grant amount, the column defaults, and the
-- in-function fallback. Already-granted ledger rows are deliberately left
-- untouched: they are an auditable history and may already be fully consumed
-- (credit_granted_kobo >= credit_used_kobo must keep holding).
BEGIN;

ALTER TABLE public.marketplace_platform_settings
  ALTER COLUMN premium_escrow_credit_kobo SET DEFAULT 50000;

ALTER TABLE public.marketplace_escrow_credit_ledger
  ALTER COLUMN credit_granted_kobo SET DEFAULT 50000,
  ALTER COLUMN credit_remaining_kobo SET DEFAULT 50000;

-- Move the live configuration off the old ₦2,000 default.
UPDATE public.marketplace_platform_settings
   SET premium_escrow_credit_kobo = 50000,
       updated_at = now()
 WHERE id = 1
   AND premium_escrow_credit_kobo = 200000;

-- Keep the function fallback (used only when no settings row exists) in sync.
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
  v_granted BIGINT := 50000;
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

COMMIT;
