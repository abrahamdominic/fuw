-- =====================================================================
-- FUW Wallet Student Bank Withdrawals (pay.md Phase 4.3)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wallet_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.marketplace_wallets(id),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  net_amount_kobo BIGINT NOT NULL CHECK (net_amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  bank_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'successful', 'failed', 'reversed')) DEFAULT 'pending',
  reference TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'paystack',
  provider_transfer_code TEXT,
  provider_recipient_code TEXT,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_user ON public.wallet_withdrawals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_ref ON public.wallet_withdrawals (reference);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_status ON public.wallet_withdrawals (status);

ALTER TABLE public.wallet_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_withdrawals_select_policy ON public.wallet_withdrawals;
CREATE POLICY wallet_withdrawals_select_policy ON public.wallet_withdrawals
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin', 'super_admin')
    )
  );

-- =====================================================================
-- Request a withdrawal from the FUW Wallet
-- Atomically validates balance, calculates fees, debits wallet, creates record
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fuw_request_wallet_withdrawal(
  p_amount_kobo BIGINT,
  p_bank_code TEXT,
  p_bank_name TEXT,
  p_account_number TEXT,
  p_account_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_wallet public.marketplace_wallets%ROWTYPE;
  v_fee_kobo BIGINT;
  v_net_kobo BIGINT;
  v_reference TEXT;
  v_clean_account TEXT;
  v_withdrawal_id UUID;
  v_post_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  v_clean_account := regexp_replace(COALESCE(p_account_number, ''), '[^0-9]', '', 'g');
  IF length(v_clean_account) <> 10 THEN
    RAISE EXCEPTION 'Bank account number must be exactly 10 digits' USING ERRCODE = '22023';
  END IF;

  IF trim(COALESCE(p_bank_code, '')) = '' OR trim(COALESCE(p_bank_name, '')) = '' THEN
    RAISE EXCEPTION 'Please select a valid bank' USING ERRCODE = '22023';
  END IF;

  IF trim(COALESCE(p_account_name, '')) = '' THEN
    RAISE EXCEPTION 'Account holder name could not be verified' USING ERRCODE = '22023';
  END IF;

  IF p_amount_kobo < 50000 THEN -- Min ₦500
    RAISE EXCEPTION 'Minimum withdrawal is ₦500' USING ERRCODE = '22023';
  END IF;

  IF p_amount_kobo > 50000000 THEN -- Max ₦500,000 per request
    RAISE EXCEPTION 'Maximum single withdrawal is ₦500,000' USING ERRCODE = '22023';
  END IF;

  -- Fee structure: ₦25 for transfers up to ₦5,000; ₦50 up to ₦50,000; ₦100 above
  IF p_amount_kobo <= 500000 THEN
    v_fee_kobo := 2500; -- ₦25
  ELSIF p_amount_kobo <= 5000000 THEN
    v_fee_kobo := 5000; -- ₦50
  ELSE
    v_fee_kobo := 10000; -- ₦100
  END IF;

  v_net_kobo := p_amount_kobo - v_fee_kobo;
  IF v_net_kobo <= 0 THEN
    RAISE EXCEPTION 'Amount is too low after withdrawal processing fees' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wallet
    FROM public.marketplace_wallets
   WHERE user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User wallet not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_wallet.is_frozen THEN
    RAISE EXCEPTION 'Wallet is currently suspended. Contact support.' USING ERRCODE = '55000';
  END IF;

  IF v_wallet.available_kobo < p_amount_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Available: ₦%, Requested: ₦%'
      , (v_wallet.available_kobo / 100)::text, (p_amount_kobo / 100)::text
      USING ERRCODE = '55000';
  END IF;

  v_reference := 'fuw_wth_' || lower(encode(extensions.gen_random_bytes(10), 'hex'));

  -- Atomically debit the wallet
  v_post_result := public.mp_wallet_post(
    p_wallet_id := v_wallet.id,
    p_entry_type := 'withdrawal'::public.marketplace_ledger_entry_type,
    p_direction := 'debit',
    p_amount_kobo := p_amount_kobo,
    p_description := 'Withdrawal to ' || p_bank_name || ' (' || right(v_clean_account, 4) || ')',
    p_order_id := NULL,
    p_payment_id := NULL,
    p_currency := 'NGN',
    p_provider := 'paystack',
    p_provider_ref := v_reference
  );

  INSERT INTO public.wallet_withdrawals (
    user_id,
    wallet_id,
    amount_kobo,
    fee_kobo,
    net_amount_kobo,
    currency,
    bank_code,
    bank_name,
    account_number,
    account_name,
    status,
    reference,
    provider,
    metadata
  ) VALUES (
    v_uid,
    v_wallet.id,
    p_amount_kobo,
    v_fee_kobo,
    v_net_kobo,
    'NGN',
    trim(p_bank_code),
    trim(p_bank_name),
    v_clean_account,
    trim(p_account_name),
    'pending',
    v_reference,
    'paystack',
    jsonb_build_object('client_request_ts', now())
  ) RETURNING id INTO v_withdrawal_id;

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'reference', v_reference,
    'amount_kobo', p_amount_kobo,
    'fee_kobo', v_fee_kobo,
    'net_amount_kobo', v_net_kobo,
    'status', 'pending',
    'balance_after_kobo', (v_post_result->>'balance_after')::bigint
  );
END;
$$;

-- =====================================================================
-- Reverse/Refund a failed withdrawal
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fuw_reverse_wallet_withdrawal(
  p_reference TEXT,
  p_reason TEXT DEFAULT 'Withdrawal failed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_withdrawal public.wallet_withdrawals%ROWTYPE;
  v_post_result JSONB;
BEGIN
  SELECT * INTO v_withdrawal
    FROM public.wallet_withdrawals
   WHERE reference = p_reference
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal record not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_withdrawal.status IN ('successful', 'reversed') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Already in terminal state: ' || v_withdrawal.status);
  END IF;

  -- Refund back to the wallet
  v_post_result := public.mp_wallet_post(
    p_wallet_id := v_withdrawal.wallet_id,
    p_entry_type := 'refund'::public.marketplace_ledger_entry_type,
    p_direction := 'credit',
    p_amount_kobo := v_withdrawal.amount_kobo,
    p_description := 'Reversal for failed withdrawal ' || v_withdrawal.reference,
    p_order_id := NULL,
    p_payment_id := NULL,
    p_currency := 'NGN',
    p_provider := 'paystack',
    p_provider_ref := v_withdrawal.reference
  );

  UPDATE public.wallet_withdrawals
     SET status = 'reversed',
         failure_reason = p_reason,
         updated_at = now()
   WHERE id = v_withdrawal.id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'reversed',
    'refunded_amount_kobo', v_withdrawal.amount_kobo,
    'balance_after_kobo', (v_post_result->>'balance_after')::bigint
  );
END;
$$;

-- =====================================================================
-- Fetch user withdrawals statement
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fuw_get_my_withdrawals(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total INT;
  v_items JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.wallet_withdrawals
   WHERE user_id = v_uid;

  SELECT COALESCE(jsonb_agg(w_row ORDER BY w_row.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, amount_kobo, fee_kobo, net_amount_kobo, currency,
             bank_name, account_number, account_name, status, reference,
             failure_reason, created_at, processed_at
        FROM public.wallet_withdrawals
       WHERE user_id = v_uid
       ORDER BY created_at DESC
       LIMIT LEAST(p_limit, 50)
      OFFSET GREATEST(p_offset, 0)
    ) w_row;

  RETURN jsonb_build_object(
    'total', v_total,
    'withdrawals', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fuw_request_wallet_withdrawal(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_get_my_withdrawals(INT, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fuw_request_wallet_withdrawal(BIGINT, TEXT, TEXT, TEXT, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fuw_get_my_withdrawals(INT, INT) FROM anon, public;
