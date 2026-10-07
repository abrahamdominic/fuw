-- =============================================================================
-- Migration: 20261006190000_platform_security_and_repairs.sql
-- Description:
--   1. Expand bank code regex in fuw_request_wallet_withdrawal to 3-6 digits
--      to support Nigerian fintechs & microfinance banks (Kuda, Moniepoint, OPay, PalmPay).
--   2. Authorize admin platform statistics RPCs for all active admins (is_admin() OR has_permission('view_analytics')).
--   3. Update materials RLS policy to allow students to edit & resubmit rejected materials (resetting status to pending).
-- =============================================================================

BEGIN;

-- 1. Expand bank code check in fuw_request_wallet_withdrawal to ^[0-9]{3,6}$
CREATE OR REPLACE FUNCTION public.fuw_request_wallet_withdrawal(
  p_amount_kobo bigint,
  p_bank_code text,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_idempotency_key text DEFAULT NULL::text,
  p_request_ip text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_wallet         public.marketplace_wallets%ROWTYPE;
  v_fee_kobo       BIGINT;
  v_net_kobo       BIGINT;
  v_reference       TEXT;
  v_clean_account  TEXT;
  v_clean_code     TEXT;
  v_clean_name     TEXT;
  v_withdrawal_id  UUID;
  v_ledger_entry   UUID;
  v_existing       public.wallet_withdrawals%ROWTYPE;
  v_idem           TEXT;
  v_balance_after  BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Replay guard
  v_idem := NULLIF(left(trim(COALESCE(p_idempotency_key, '')), 120), '');
  IF v_idem IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.wallet_withdrawals
     WHERE user_id = v_uid
       AND idempotency_key = v_idem;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'replayed', true,
        'withdrawal_id', v_existing.id,
        'reference', v_existing.reference,
        'amount_kobo', v_existing.amount_kobo,
        'fee_kobo', v_existing.fee_kobo,
        'net_amount_kobo', v_existing.net_amount_kobo,
        'status', v_existing.status,
        'provider_recipient_code', v_existing.provider_recipient_code,
        'provider_transfer_code', v_existing.provider_transfer_code,
        'balance_after_kobo', (
          SELECT available_kobo FROM public.marketplace_wallets
           WHERE id = v_existing.wallet_id
        )
      );
    END IF;
  END IF;

  IF p_amount_kobo IS NULL OR p_amount_kobo < 50000 THEN -- Min N500
    RAISE EXCEPTION 'Minimum withdrawal is N500' USING ERRCODE = '22023';
  END IF;

  IF p_amount_kobo > 50000000 THEN -- Max N500,000 per request
    RAISE EXCEPTION 'Maximum single withdrawal is N500,000' USING ERRCODE = '22023';
  END IF;

  v_clean_account := regexp_replace(COALESCE(p_account_number, ''), '[^0-9]', '', 'g');
  IF length(v_clean_account) <> 10 THEN
    RAISE EXCEPTION 'Bank account number must be exactly 10 digits' USING ERRCODE = '22023';
  END IF;

  v_clean_code := trim(COALESCE(p_bank_code, ''));
  -- Support commercial banks (3 digits) as well as Nigerian microfinance / fintech banks (5-6 digits)
  IF v_clean_code !~ '^[0-9]{3,6}$' THEN
    RAISE EXCEPTION 'Please select a valid bank' USING ERRCODE = '22023';
  END IF;

  v_clean_name := trim(COALESCE(p_bank_name, ''));
  IF v_clean_name = '' OR char_length(v_clean_name) > 120 THEN
    RAISE EXCEPTION 'Please select a valid bank' USING ERRCODE = '22023';
  END IF;

  v_clean_name := NULLIF(v_clean_name, '');
  IF NULLIF(trim(COALESCE(p_account_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Account holder name could not be verified' USING ERRCODE = '22023';
  END IF;

  v_fee_kobo := public.fuw_withdrawal_fee_kobo(p_amount_kobo);
  v_net_kobo := p_amount_kobo - v_fee_kobo;
  IF v_net_kobo <= 0 THEN
    RAISE EXCEPTION 'Amount is too low after withdrawal processing fees' USING ERRCODE = '22023';
  END IF;

  -- Lock first
  SELECT * INTO v_wallet
    FROM public.marketplace_wallets
   WHERE owner_user_id = v_uid
     AND vendor_id IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User wallet not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_wallet.is_frozen THEN
    RAISE EXCEPTION 'Wallet is currently suspended. Contact support.' USING ERRCODE = '55000';
  END IF;

  IF v_wallet.available_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Available: N%, Requested: N%',
      (v_wallet.available_kobo / 100)::text, (p_amount_kobo / 100)::text
      USING ERRCODE = '55000';
  END IF;

  v_reference := 'fuw_wth_' || lower(encode(extensions.gen_random_bytes(10), 'hex'));

  INSERT INTO public.wallet_withdrawals (
    user_id, wallet_id, amount_kobo, fee_kobo, net_amount_kobo, currency,
    bank_code, bank_name, account_number, account_name, status, reference,
    provider, idempotency_key, requested_ip, metadata
  ) VALUES (
    v_uid, v_wallet.id, p_amount_kobo, v_fee_kobo, v_net_kobo, 'NGN',
    v_clean_code, left(v_clean_name, 120), v_clean_account,
    left(trim(COALESCE(p_account_name, '')), 120), 'pending', v_reference,
    'paystack', v_idem, left(COALESCE(p_request_ip, ''), 64),
    jsonb_build_object(
      'client_request_ts', now(),
      'amount_kobo', p_amount_kobo,
      'fee_kobo', v_fee_kobo,
      'net_amount_kobo', v_net_kobo
    )
  ) RETURNING id INTO v_withdrawal_id;

  v_ledger_entry := public.mp_wallet_post(
    p_wallet_id        => v_wallet.id,
    p_direction        => 'debit'::public.marketplace_ledger_direction,
    p_bucket           => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo      => p_amount_kobo,
    p_entry_type       => 'withdrawal'::public.marketplace_ledger_entry_type,
    p_reference_type   => 'wallet_withdrawal',
    p_reference_id     => v_withdrawal_id,
    p_idempotency_key  => 'wth:' || v_withdrawal_id::text,
    p_description      => 'Withdrawal to ' || left(v_clean_name, 120) || ' ('
                          || right(v_clean_account, 4) || ')',
    p_metadata         => jsonb_build_object(
                           'provider', 'paystack',
                           'reference', v_reference,
                           'withdrawal_id', v_withdrawal_id,
                           'fee_kobo', v_fee_kobo,
                           'net_amount_kobo', v_net_kobo
                         ),
    p_actor_id         => v_uid
  );

  UPDATE public.wallet_withdrawals
     SET metadata = metadata || jsonb_build_object('ledger_entry_id', v_ledger_entry)
   WHERE id = v_withdrawal_id;

  SELECT available_kobo INTO v_balance_after
    FROM public.marketplace_wallets
   WHERE id = v_wallet.id;

  RETURN jsonb_build_object(
    'success', true,
    'replayed', false,
    'withdrawal_id', v_withdrawal_id,
    'reference', v_reference,
    'amount_kobo', p_amount_kobo,
    'fee_kobo', v_fee_kobo,
    'net_amount_kobo', v_net_kobo,
    'status', 'pending',
    'balance_after_kobo', v_balance_after,
    'ledger_entry_id', v_ledger_entry
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fuw_request_wallet_withdrawal(bigint, text, text, text, text, text, text) TO authenticated;

-- 2. Authorize platform student statistics for all authenticated administrators
CREATE OR REPLACE FUNCTION public.count_students_total_registered()
RETURNS TABLE(total_registered bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('view_analytics')) THEN
    RAISE EXCEPTION 'Insufficient permission to view analytics' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT COUNT(*) FILTER (WHERE role = 'student')::bigint
  FROM public.profiles;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_students_verified()
RETURNS TABLE(verified_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('view_analytics')) THEN
    RAISE EXCEPTION 'Insufficient permission to view analytics' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT COUNT(*) FILTER (
           WHERE role = 'student'
             AND (verified IS TRUE OR verification_status = 'verified')
         )::bigint
  FROM public.profiles;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_students_pending_approval()
RETURNS TABLE(pending_approval_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('view_analytics')) THEN
    RAISE EXCEPTION 'Insufficient permission to view analytics' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT COUNT(*)::bigint
  FROM public.profiles
  WHERE role = 'student'
    AND (verification_status IN ('submitted', 'pending')
         OR (verification_status IS NULL AND verified IS FALSE));
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_students_by_gender()
RETURNS TABLE(gender text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('view_analytics')) THEN
    RAISE EXCEPTION 'Insufficient permission to view analytics' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN lower(btrim(coalesce(pr.gender, ''))) = 'male'   THEN 'Male'
      WHEN lower(btrim(coalesce(pr.gender, ''))) = 'female' THEN 'Female'
      WHEN lower(btrim(coalesce(pr.gender, ''))) IN ('other', 'non-binary', 'nonbinary') THEN 'Other'
      ELSE 'Unspecified'
    END::text AS gender,
    COUNT(*)::bigint AS count
  FROM public.profiles pr
  WHERE pr.role = 'student'
  GROUP BY 1
  ORDER BY 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.count_students_total_registered() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_students_verified() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_students_pending_approval() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_students_by_gender() TO authenticated;

-- 3. Allow students to edit their pending or rejected material uploads and resubmit as pending
DROP POLICY IF EXISTS materials_owner_pending_update_policy ON public.materials;

CREATE POLICY materials_owner_pending_update_policy ON public.materials
  FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid() AND status IN ('pending'::material_status, 'rejected'::material_status))
  WITH CHECK (uploaded_by = auth.uid() AND status = 'pending'::material_status);

COMMIT;
