-- =============================================================================
-- Part 8: ₦500 escrow fee credit — secure, exactly-once issuance
--
-- The ₦500 credit already ships (20261009170000 set defaults 50000). This
-- migration closes the remaining gaps:
--   1. Entitlement-only premium users (no active subscription row) could be
--      issued a credit twice by concurrent calls, because their ledger rows have
--      subscription_id NULL and no uniqueness covered them.
--   2. Legacy rows still carrying the old ₦2,000 grant for credits that were
--      never touched are reconciled down to the configured ₦500. Used credits are
--      history and are never rewritten; the maths check keeps every row honest.
--   3. Issuance is atomic (single INSERT ... ON CONFLICT), so a retry can never
--      mint a second credit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Maintenance: collapse duplicate active rows to the most recent one
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.marketplace_escrow_credit_ledger
   WHERE is_active = true
)
UPDATE public.marketplace_escrow_credit_ledger l
   SET is_active = false, updated_at = now()
  FROM ranked r
 WHERE r.id = l.id AND r.rn > 1;

-- Exactly one active entitlement-only credit per user. This is the missing lock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_escrow_credit_entitlement_user
  ON public.marketplace_escrow_credit_ledger (user_id)
  WHERE is_active = true AND subscription_id IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Reconcile un-touched legacy ₦2,000 grants to the configured ₦500
-- -----------------------------------------------------------------------------
-- Only rows that were never consumed (credit_used_kobo = 0) are moved; a row
-- that has been partially or fully spent stays exactly as it was.
UPDATE public.marketplace_escrow_credit_ledger l
   SET credit_granted_kobo = s.premium_escrow_credit_kobo,
       credit_remaining_kobo = s.premium_escrow_credit_kobo,
       updated_at = now()
  FROM public.marketplace_platform_settings s
 WHERE s.id = 1
   AND l.credit_used_kobo = 0
   AND l.credit_granted_kobo = 200000
   AND l.credit_remaining_kobo = 200000
   AND s.premium_escrow_credit_kobo = 50000;

-- -----------------------------------------------------------------------------
-- 3. mp_get_user_escrow_credit: exactly-once issuance for BOTH user classes
-- -----------------------------------------------------------------------------
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
  v_inserted uuid;
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

  -- Look for an active escrow credit record
  SELECT * INTO v_credit
    FROM public.marketplace_escrow_credit_ledger
   WHERE user_id = v_uid
     AND is_active = true
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY created_at DESC
   LIMIT 1;

  -- Issue when missing. Exactly-once by construction:
  --   * subscription-backed rows are unique on subscription_id (index exists);
  --   * entitlement-only rows are unique on (user_id) where active & no sub.
  -- A concurrent winner simply makes our INSERT a no-op and the re-select below
  -- picks up their row, so two calls can never mint two credits.
  IF NOT FOUND THEN
    IF v_sub.id IS NOT NULL THEN
      INSERT INTO public.marketplace_escrow_credit_ledger (
        user_id, subscription_id, credit_granted_kobo, credit_used_kobo,
        credit_remaining_kobo, starts_at, expires_at, is_active
      ) VALUES (
        v_uid, v_sub.id, v_granted, 0, v_granted,
        COALESCE(v_sub.starts_at, now()), v_sub.expires_at, true
      )
      ON CONFLICT (subscription_id) WHERE subscription_id IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_inserted;
    ELSE
      INSERT INTO public.marketplace_escrow_credit_ledger (
        user_id, subscription_id, credit_granted_kobo, credit_used_kobo,
        credit_remaining_kobo, starts_at, is_active
      ) VALUES (
        v_uid, NULL, v_granted, 0, v_granted, now(), true
      )
      ON CONFLICT (user_id) WHERE is_active = true AND subscription_id IS NULL
      DO NOTHING
      RETURNING id INTO v_inserted;
    END IF;

    SELECT * INTO v_credit
      FROM public.marketplace_escrow_credit_ledger
     WHERE user_id = v_uid
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_credit.id IS NULL THEN
    RETURN jsonb_build_object(
      'has_premium', true,
      'credit_granted_kobo', 0,
      'credit_used_kobo', 0,
      'credit_remaining_kobo', 0,
      'discount_pct', v_disc_pct,
      'is_active', false,
      'expires_at', null
    );
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

COMMENT ON INDEX public.idx_mp_escrow_credit_entitlement_user IS
  'One active entitlement-only escrow credit per user; concurrent issuance cannot double-mint.';
COMMENT ON FUNCTION public.mp_get_user_escrow_credit(UUID) IS
  'Returns the premium escrow fee credit ledger row, issuing it exactly once when
  missing. Issuance is atomic (INSERT ... ON CONFLICT), so retries and races are
  safe for both subscription-backed and entitlement-only premium users.';