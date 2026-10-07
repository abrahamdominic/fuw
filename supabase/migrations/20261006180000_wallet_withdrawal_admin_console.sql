-- Super-admin wallet withdrawal console (spec Phase 19 "wallet systems").
--
-- The listing RPC already existed and was correctly gated by is_admin(); what
-- was missing was the two pieces of information the console needs to render a
-- useful decision surface:
--
--   1. the provider's raw status (`metadata->>'provider_status_raw'`), which is
--      what distinguishes a transfer Paystack parked behind an OTP from one it
--      is simply still processing, and
--   2. an aggregate summary so the tab can show totals without shipping every
--      row to the browser.
--
-- Nothing here moves money. Reversals stay service_role only, and the only
-- money-moving client entry point (finalize_transfer) lives in the
-- wallet-paystack-withdraw Edge Function behind is_super_admin().

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. fuw_admin_list_withdrawals -- expose provider status + updated_at
-- -----------------------------------------------------------------------------
-- Signature is unchanged, so PostgREST keeps the same RPC route and the
-- existing grant/revoke set still applies.

CREATE OR REPLACE FUNCTION public.fuw_admin_list_withdrawals(
  p_status TEXT DEFAULT NULL,
  p_limit  INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total INT;
  v_items JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::INT INTO v_total
    FROM public.wallet_withdrawals
   WHERE p_status IS NULL OR status = p_status;

  SELECT COALESCE(jsonb_agg(w_row ORDER BY w_row.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT w.id, w.user_id, w.amount_kobo, w.fee_kobo, w.net_amount_kobo, w.currency,
             w.bank_code, w.bank_name, w.account_number, w.account_name, w.status, w.reference,
             w.provider, w.provider_transfer_code, w.provider_approval_url,
             w.provider_authorization_code, w.failure_reason,
             w.created_at, w.updated_at, w.processed_at,
             left(COALESCE(w.metadata->>'provider_status_raw', ''), 40) AS provider_status,
             p.full_name, p.email, p.matric_number
        FROM public.wallet_withdrawals w
        LEFT JOIN public.profiles p ON p.id = w.user_id
       WHERE p_status IS NULL OR w.status = p_status
       ORDER BY w.created_at DESC
       LIMIT v_limit
      OFFSET v_offset
    ) w_row;

  RETURN jsonb_build_object('total', v_total, 'withdrawals', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_admin_list_withdrawals(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuw_admin_list_withdrawals(TEXT, INT, INT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. fuw_admin_withdrawal_summary -- totals for the console header
-- -----------------------------------------------------------------------------
-- Read-only aggregate. Same authorization contract as the list RPC: an active
-- admin or super admin session, never anon.

CREATE OR REPLACE FUNCTION public.fuw_admin_withdrawal_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  WITH per_status AS (
    SELECT status,
           COUNT(*)::INT AS count,
           COALESCE(SUM(amount_kobo), 0)::BIGINT AS amount_kobo,
           COALESCE(SUM(fee_kobo), 0)::BIGINT AS fee_kobo,
           COALESCE(SUM(net_amount_kobo), 0)::BIGINT AS net_amount_kobo,
           MAX(created_at) AS last_requested_at
      FROM public.wallet_withdrawals
     GROUP BY status
  ),
  agg AS (
    SELECT COALESCE(SUM(count), 0)::INT AS total_count,
           COALESCE(SUM(amount_kobo), 0)::BIGINT AS total_amount_kobo,
           COALESCE(SUM(fee_kobo), 0)::BIGINT AS total_fee_kobo,
           COALESCE(SUM(net_amount_kobo), 0)::BIGINT AS total_net_kobo,
           MAX(last_requested_at) AS last_requested_at
      FROM per_status
  )
  SELECT jsonb_build_object(
           'total_count', a.total_count,
           'total_amount_kobo', a.total_amount_kobo,
           'total_fee_kobo', a.total_fee_kobo,
           'total_net_kobo', a.total_net_kobo,
           'last_requested_at', a.last_requested_at,
           'awaiting_otp_count', (
             SELECT COUNT(*)::INT
               FROM public.wallet_withdrawals
              WHERE status = 'processing'
                AND metadata->>'provider_status_raw' = 'otp'
           ),
           'by_status', (
             SELECT COALESCE(
                      jsonb_object_agg(
                        s.status,
                        jsonb_build_object(
                          'count', s.count,
                          'amount_kobo', s.amount_kobo,
                          'fee_kobo', s.fee_kobo,
                          'net_amount_kobo', s.net_amount_kobo
                        )
                      ),
                      '{}'::jsonb
                    )
               FROM per_status s
           )
         )
    INTO v_result
    FROM agg a;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_admin_withdrawal_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuw_admin_withdrawal_summary() TO authenticated;

-- Re-read the schema cache so PostgREST sees the new function immediately
-- instead of waiting for its next poll.
NOTIFY pgrst, 'reload schema';
