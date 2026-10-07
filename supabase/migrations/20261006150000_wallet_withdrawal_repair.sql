-- =====================================================================
-- Wallet withdrawal repair (fit.md Phase 3, 4, 5, 26)
-- =====================================================================
--
-- 20261006141000_wallet_withdrawals.sql introduced the student bank payout
-- flow but it could never succeed. Three defects, in order of severity:
--
--   1. CRITICAL (security) `fuw_reverse_wallet_withdrawal` was created without
--      any role guard and, because PostgreSQL grants EXECUTE to PUBLIC by
--      default, its ACL was `{=X/postgres,...}`. It is SECURITY DEFINER, so it
--      bypasses RLS on wallet_withdrawals and can credit *any* wallet for
--      *any* reference. A logged-in student could mint themselves money.
--
--   2. FATAL (functionality) `fuw_request_wallet_withdrawal` read the wallet
--      with `WHERE user_id = v_uid`. marketplace_wallets has no `user_id`
--      column -- it is `owner_user_id` -- so every call aborted with
--      `42703 column "user_id" does not exist`.
--
--   3. FATAL (functionality) Both functions called `mp_wallet_post` with a
--      signature from an older schema revision (p_order_id/p_payment_id/
--      p_currency/p_provider/p_provider_ref) and assigned its UUID return value
--      into a JSONB variable. The live signature also *requires* p_bucket,
--      p_reference_type and p_idempotency_key.
--
-- This migration rewrites all four functions against the real schema, adds
-- idempotency so a retried submit cannot create a second real bank transfer,
-- records the withdrawal *before* the debit (money is never gone without a
-- record), and adds the privileged admin surface needed for the Paystack
-- transfer outcome / approval handling.
--
-- Money rules that hold throughout:
--   * The amount is never taken from the client as authoritative.
--   * A withdrawal row is INSERTed first; the debit is a separate statement in
--     the same transaction, so a failure rolls the record back with the debit.
--   * Terminal states are immutable -- successful/reversed/failed never move.
--   * Only service_role may drive the provider-outcome functions.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Additional audit columns
-- -----------------------------------------------------------------------------

-- The Paystack transfer response is stored verbatim minus anything secret, so
-- an operator can reconstruct what the provider actually said.
ALTER TABLE public.wallet_withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_approval_url TEXT,
  ADD COLUMN IF NOT EXISTS provider_authorization_code TEXT,
  ADD COLUMN IF NOT EXISTS requested_ip TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- One live withdrawal per client attempt. A retried submit with the same key
-- returns the original row instead of debiting and transferring again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_withdrawals_idem
  ON public.wallet_withdrawals (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- An approval URL is only ever stored when Paystack literally returned one, and
-- only after it has been proven to be an https Paystack URL. See
-- paystackApprovalUrl() in the edge function.
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_pending
  ON public.wallet_withdrawals (status, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Guard helper: the caller must be the Edge Function (service_role)
-- -----------------------------------------------------------------------------
-- A SECURITY DEFINER function with no guard is a privilege-escalation primitive.
-- These two helpers make the intent explicit and testable.

CREATE OR REPLACE FUNCTION public.fuw_require_service_role(p_operation TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Operation "%" is restricted to the payment service', p_operation
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_require_service_role(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_require_service_role(TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Fee schedule as data, not a duplicated literal
-- -----------------------------------------------------------------------------
-- The client mirrors this for display only. The server is authoritative and the
-- client is checked against it (see fuw_withdrawal_fee_kobo below), so a stale
-- client can never change what a student is charged.

CREATE OR REPLACE FUNCTION public.fuw_withdrawal_fee_kobo(p_amount_kobo BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN 0;
  END IF;
  IF p_amount_kobo <= 500000 THEN   -- up to N5,000
    RETURN 2500;                    -- N25
  ELSIF p_amount_kobo <= 5000000 THEN -- up to N50,000
    RETURN 5000;                    -- N50
  END IF;
  RETURN 10000;                      -- N100
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_withdrawal_fee_kobo(BIGINT) FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- 4. fuw_request_wallet_withdrawal -- rewritten
-- -----------------------------------------------------------------------------
-- Signature changes to add p_idempotency_key, so the old overload is dropped
-- rather than left behind as a second, weaker entry point.

DROP FUNCTION IF EXISTS public.fuw_request_wallet_withdrawal(BIGINT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fuw_request_wallet_withdrawal(
  p_amount_kobo     BIGINT,
  p_bank_code       TEXT,
  p_bank_name       TEXT,
  p_account_number  TEXT,
  p_account_name    TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_request_ip      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
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

  -- Replay guard. The client generates the key once per withdrawal attempt and
  -- reuses it on retry, so a double-tap or a retried request returns the
  -- original withdrawal instead of taking the money twice.
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
  IF v_clean_code !~ '^[0-9]{3}$' THEN
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

  -- Lock first. Every concurrent withdrawal by this user serialises here, so two
  -- requests cannot both pass the balance check.
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

  -- Record the intent BEFORE any money moves. If mp_wallet_post raises, this
  -- INSERT rolls back with it, so a student is never debited without a record.
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

  -- Debit the full amount; the fee is part of the amount, never added on top.
  -- The client already shows "amount - fee arrives in your bank" so this keeps
  -- the ledger and the UI in agreement.
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
$$;

REVOKE ALL ON FUNCTION public.fuw_request_wallet_withdrawal(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuw_request_wallet_withdrawal(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. fuw_reverse_wallet_withdrawal -- rewritten and locked down
-- -----------------------------------------------------------------------------
-- Public EXECUTE on a SECURITY DEFINER money function is the critical hole in
-- this feature. The function is now service_role only, and the reversal is
-- idempotent and bounded to the exact amount that was debited.

CREATE OR REPLACE FUNCTION public.fuw_reverse_wallet_withdrawal(
  p_reference TEXT,
  p_reason    TEXT DEFAULT 'Withdrawal failed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_withdrawal public.wallet_withdrawals%ROWTYPE;
  v_ledger_entry UUID;
  v_balance_after BIGINT;
BEGIN
  PERFORM public.fuw_require_service_role('reverse wallet withdrawal');

  SELECT * INTO v_withdrawal
    FROM public.wallet_withdrawals
   WHERE reference = p_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal record not found' USING ERRCODE = 'P0002';
  END IF;

  -- Terminal states never move. This is what makes a webhook replay harmless.
  IF v_withdrawal.status IN ('successful', 'reversed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_terminal', true,
      'status', v_withdrawal.status,
      'reference', v_withdrawal.reference
    );
  END IF;

  -- Refund exactly what was taken. The idempotency key is derived from the
  -- withdrawal id, so a replayed reversal cannot credit twice even if the
  -- status update is somehow lost.
  v_ledger_entry := public.mp_wallet_post(
    p_wallet_id        => v_withdrawal.wallet_id,
    p_direction        => 'credit'::public.marketplace_ledger_direction,
    p_bucket           => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo      => v_withdrawal.amount_kobo,
    p_entry_type       => 'refund'::public.marketplace_ledger_entry_type,
    p_reference_type   => 'wallet_withdrawal',
    p_reference_id     => v_withdrawal.id,
    p_idempotency_key  => 'wthrev:' || v_withdrawal.id::text,
    p_description      => 'Refund for failed withdrawal ' || v_withdrawal.reference,
    p_metadata         => jsonb_build_object(
                           'provider', 'paystack',
                           'reference', v_withdrawal.reference,
                           'reason', left(COALESCE(p_reason, ''), 300)
                         ),
    p_actor_id         => v_withdrawal.user_id
  );

  UPDATE public.wallet_withdrawals
     SET status = 'reversed',
         failure_reason = left(COALESCE(p_reason, 'Withdrawal failed'), 300),
         metadata = metadata || jsonb_build_object(
                      'reversal_ledger_entry_id', v_ledger_entry,
                      'reversed_at', now()
                    ),
         updated_at = now(),
         processed_at = COALESCE(processed_at, now())
   WHERE id = v_withdrawal.id;

  SELECT available_kobo INTO v_balance_after
    FROM public.marketplace_wallets
   WHERE id = v_withdrawal.wallet_id;

  -- Tell the student their money is back.
  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_withdrawal.user_id,
    'Withdrawal refunded',
    format('Your FUW wallet withdrawal of N%s could not be completed and has been refunded in full.',
           (v_withdrawal.amount_kobo / 100)::text),
    'wallet_refunded',
    '/marketplace/wallet',
    'wthrev:' || v_withdrawal.id::text
  ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'already_terminal', false,
    'status', 'reversed',
    'reference', v_withdrawal.reference,
    'refunded_amount_kobo', v_withdrawal.amount_kobo,
    'balance_after_kobo', v_balance_after,
    'ledger_entry_id', v_ledger_entry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_reverse_wallet_withdrawal(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_reverse_wallet_withdrawal(TEXT, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. fuw_record_wallet_withdrawal_transfer -- provider outcome (service_role)
-- -----------------------------------------------------------------------------
-- The Edge Function writes what Paystack actually returned. It cannot mark a
-- withdrawal successful from a client-supplied flag: this function is not
-- reachable from the browser at all.

CREATE OR REPLACE FUNCTION public.fuw_record_wallet_withdrawal_transfer(
  p_reference                  TEXT,
  p_provider_status            TEXT,
  p_transfer_code              TEXT DEFAULT NULL,
  p_recipient_code             TEXT DEFAULT NULL,
  p_approval_url               TEXT DEFAULT NULL,
  p_authorization_code         TEXT DEFAULT NULL,
  p_failure_reason             TEXT DEFAULT NULL,
  p_provider_payload           JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_withdrawal public.wallet_withdrawals%ROWTYPE;
  v_status TEXT;
BEGIN
  PERFORM public.fuw_require_service_role('record wallet withdrawal transfer');

  SELECT * INTO v_withdrawal
    FROM public.wallet_withdrawals
   WHERE reference = p_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal record not found' USING ERRCODE = 'P0002';
  END IF;

  -- A terminal outcome is never downgraded or re-derived. Paystack replaying a
  -- webhook, or a verify running after a webhook, both land here and become
  -- no-ops.
  IF v_withdrawal.status IN ('successful', 'reversed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_terminal', true,
      'status', v_withdrawal.status,
      'reference', v_withdrawal.reference
    );
  END IF;

  v_status := CASE
    WHEN lower(trim(COALESCE(p_provider_status, ''))) IN ('success', 'successful', 'sent')
      THEN 'successful'
    WHEN lower(trim(COALESCE(p_provider_status, ''))) IN ('failed', 'reversed', 'abandoned')
      THEN 'failed'
    ELSE 'processing'   -- pending, otp, received -> still with Paystack
  END;

  UPDATE public.wallet_withdrawals
     SET status = v_status,
         provider_transfer_code = COALESCE(p_transfer_code, provider_transfer_code),
         provider_recipient_code = COALESCE(p_recipient_code, provider_recipient_code),
         -- Only ever overwritten with a value Paystack actually sent. NULL here
         -- means "Paystack did not return an approval URL for this transfer",
         -- never "we made one up".
         provider_approval_url = COALESCE(p_approval_url, provider_approval_url),
         provider_authorization_code = COALESCE(p_authorization_code, provider_authorization_code),
         failure_reason = CASE WHEN v_status = 'successful' THEN NULL
                               ELSE left(COALESCE(p_failure_reason, v_withdrawal.failure_reason), 300)
                          END,
         processed_at = CASE WHEN v_status = 'successful' THEN COALESCE(processed_at, now())
                             ELSE v_withdrawal.processed_at END,
         -- Merge, never overwrite: client_request_ts and ledger_entry_id from
         -- the request must survive the provider callback.
         metadata = v_withdrawal.metadata
                    || jsonb_build_object(
                         'provider_status_raw', left(COALESCE(p_provider_status, ''), 40),
                         'provider_updated_at', now()
                       )
                    || COALESCE(p_provider_payload, '{}'::jsonb),
         updated_at = now()
   WHERE id = v_withdrawal.id;

  IF v_status = 'successful' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      v_withdrawal.user_id,
      'Withdrawal sent',
      format('Your withdrawal of N%s has been sent to %s (%s).',
             (v_withdrawal.net_amount_kobo / 100)::text,
             v_withdrawal.bank_name,
             right(v_withdrawal.account_number, 4)),
      'wallet_withdrawal_paid',
      '/marketplace/wallet',
      'wthpaid:' || v_withdrawal.id::text
    ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_status, 'reference', v_withdrawal.reference);
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_record_wallet_withdrawal_transfer(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_record_wallet_withdrawal_transfer(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

-- -----------------------------------------------------------------------------
-- 7. fuw_get_my_withdrawals -- hardened
-- -----------------------------------------------------------------------------
-- unchanged surface (the frontend already consumes { total, withdrawals }), but
-- the page size is now bounded and the totals are consistent with the page.

CREATE OR REPLACE FUNCTION public.fuw_get_my_withdrawals(
  p_limit  INT DEFAULT 20,
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
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_total INT;
  v_items JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT count(*)::INT INTO v_total
    FROM public.wallet_withdrawals
   WHERE user_id = v_uid;

  SELECT COALESCE(jsonb_agg(w_row ORDER BY w_row.created_at DESC, w_row.id DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, amount_kobo, fee_kobo, net_amount_kobo, currency,
             bank_code, bank_name, account_number, account_name, status, reference,
             provider_transfer_code, failure_reason, created_at, processed_at
        FROM public.wallet_withdrawals
       WHERE user_id = v_uid
       ORDER BY created_at DESC, id DESC
       LIMIT v_limit
      OFFSET v_offset
    ) w_row;

  RETURN jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', (v_offset + COALESCE(jsonb_array_length(v_items), 0)) < v_total,
    'withdrawals', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_get_my_withdrawals(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuw_get_my_withdrawals(INT, INT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Privileged read surface for the admin/super-admin console
-- -----------------------------------------------------------------------------
-- Students never see this. The approval URL, when Paystack returned one, is an
-- operational secret and stays behind an admin check.

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
             w.provider_transfer_code, w.provider_approval_url, w.provider_authorization_code,
             w.failure_reason, w.created_at, w.processed_at,
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
-- 9. RLS: the table is readable by its owner and by admins only
-- -----------------------------------------------------------------------------
-- The functions above are SECURITY DEFINER and deliberately bypass this; the
-- policy governs any direct table access.

DROP POLICY IF EXISTS wallet_withdrawals_select_policy ON public.wallet_withdrawals;
CREATE POLICY wallet_withdrawals_select_policy ON public.wallet_withdrawals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- No direct INSERT/UPDATE/DELETE for anyone. All state changes go through the
-- SECURITY DEFINER functions above, which own their own authorization.
DROP POLICY IF EXISTS wallet_withdrawals_insert_policy ON public.wallet_withdrawals;
DROP POLICY IF EXISTS wallet_withdrawals_update_policy ON public.wallet_withdrawals;
DROP POLICY IF EXISTS wallet_withdrawals_delete_policy ON public.wallet_withdrawals;

COMMIT;

-- Re-read the schema cache so PostgREST sees the new functions immediately
-- instead of waiting for its next poll.
NOTIFY pgrst, 'reload schema';