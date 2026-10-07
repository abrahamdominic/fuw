-- =============================================================================
-- FUW Centralized Wallet: Funding, Cross-Platform Payments, Ledger & Webhooks
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. EXTEND MARKETPLACE LEDGER ENTRIES FOR FULL AUDITABILITY (Section 16)
-- =============================================================================

ALTER TABLE public.marketplace_ledger_entries
  ADD COLUMN IF NOT EXISTS balance_before BIGINT CHECK (balance_before IS NULL OR balance_before >= 0),
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS mp_ledger_user_created_idx
  ON public.marketplace_ledger_entries (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mp_ledger_provider_ref_idx
  ON public.marketplace_ledger_entries (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- =============================================================================
-- 2. WALLET FUNDING TRANSACTIONS TABLE (Sections 3, 4, 5)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wallet_funding_transactions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallet_id               UUID NOT NULL REFERENCES public.marketplace_wallets(id) ON DELETE CASCADE,
  reference               TEXT NOT NULL UNIQUE,
  amount_kobo             BIGINT NOT NULL CHECK (amount_kobo >= 10000 AND amount_kobo <= 50000000), -- ₦100 to ₦500,000
  currency                TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'abandoned')),
  provider                TEXT NOT NULL DEFAULT 'paystack',
  channel                 TEXT DEFAULT 'card',
  provider_transaction_id TEXT,
  provider_reference      TEXT,
  authorization_url       TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::JSONB,
  failure_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallet_funding_user ON public.wallet_funding_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_funding_ref ON public.wallet_funding_transactions (reference);
CREATE INDEX IF NOT EXISTS idx_wallet_funding_status ON public.wallet_funding_transactions (status, created_at DESC);

ALTER TABLE public.wallet_funding_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_funding_read_own_or_admin" ON public.wallet_funding_transactions;
CREATE POLICY "wallet_funding_read_own_or_admin" ON public.wallet_funding_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.mp_is_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.wallet_funding_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallet_funding_transactions TO authenticated;

-- =============================================================================
-- 3. GLOBAL PAYMENT WEBHOOK EVENTS TABLE (Sections 11, 12)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'paystack',
  reference       TEXT,
  amount_kobo     BIGINT,
  currency        TEXT,
  status          TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed', 'duplicate')),
  outcome         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pwebhook_ref ON public.payment_webhook_events (reference);
CREATE INDEX IF NOT EXISTS idx_pwebhook_type_created ON public.payment_webhook_events (event_type, created_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pwebhook_admin_read" ON public.payment_webhook_events;
CREATE POLICY "pwebhook_admin_read" ON public.payment_webhook_events
  FOR SELECT TO authenticated
  USING (public.mp_is_admin(auth.uid()) OR public.is_super_admin());

REVOKE INSERT, UPDATE, DELETE ON public.payment_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_webhook_events TO authenticated;

-- =============================================================================
-- 4. UPDATE MP_WALLET_POST TO POPULATE EXTENDED AUDIT FIELDS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_wallet_post(
  p_wallet_id       UUID,
  p_direction       public.marketplace_ledger_direction,
  p_bucket          public.marketplace_wallet_bucket,
  p_amount_kobo     BIGINT,
  p_entry_type      public.marketplace_ledger_entry_type,
  p_reference_type  TEXT,
  p_reference_id    UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_description     TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT '{}'::JSONB,
  p_actor_id        UUID DEFAULT NULL,
  p_transfer_group  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet public.marketplace_wallets%ROWTYPE;
  v_existing UUID;
  v_balance BIGINT;
  v_new_balance BIGINT;
  v_entry UUID;
  v_user_id UUID;
  v_provider TEXT;
  v_provider_tx TEXT;
  v_provider_ref TEXT;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'A ledger entry needs a positive amount' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_idempotency_key, '')) < 8 THEN
    RAISE EXCEPTION 'A ledger entry needs an idempotency key' USING ERRCODE = '22023';
  END IF;

  -- Cheap pre-check, so a duplicate does not take a row lock.
  SELECT id INTO v_existing FROM public.marketplace_ledger_entries
   WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Lock the wallet. Every post to a given wallet is serialised from here on.
  SELECT * INTO v_wallet FROM public.marketplace_wallets
   WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-check under the lock.
  SELECT id INTO v_existing FROM public.marketplace_ledger_entries
   WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_wallet.is_frozen AND p_direction = 'debit' THEN
    RAISE EXCEPTION 'This wallet is frozen: %',
      COALESCE(v_wallet.frozen_reason, 'contact support')
      USING ERRCODE = '42501';
  END IF;

  v_balance := CASE WHEN p_bucket = 'available'
                    THEN v_wallet.available_kobo ELSE v_wallet.pending_kobo END;

  IF p_direction = 'debit' THEN
    IF v_balance < p_amount_kobo THEN
      RAISE EXCEPTION 'Insufficient % balance: % available, % needed',
        p_bucket, v_balance, p_amount_kobo USING ERRCODE = '23514';
    END IF;
    v_new_balance := v_balance - p_amount_kobo;
  ELSE
    v_new_balance := v_balance + p_amount_kobo;
  END IF;

  UPDATE public.marketplace_wallets
     SET available_kobo = CASE WHEN p_bucket = 'available' THEN v_new_balance ELSE available_kobo END,
         pending_kobo   = CASE WHEN p_bucket = 'pending'   THEN v_new_balance ELSE pending_kobo   END,
         lifetime_credit_kobo = lifetime_credit_kobo
                                + CASE WHEN p_direction = 'credit' THEN p_amount_kobo ELSE 0 END,
         lifetime_debit_kobo  = lifetime_debit_kobo
                                + CASE WHEN p_direction = 'debit'  THEN p_amount_kobo ELSE 0 END,
         updated_at = now()
   WHERE id = p_wallet_id;

  v_user_id := COALESCE(p_actor_id, v_wallet.owner_user_id);
  v_provider := COALESCE(p_metadata->>'provider', 'internal');
  v_provider_tx := p_metadata->>'provider_transaction_id';
  v_provider_ref := COALESCE(p_metadata->>'provider_reference', p_metadata->>'reference');

  INSERT INTO public.marketplace_ledger_entries
    (wallet_id, direction, bucket, amount_kobo, balance_before, balance_after,
     entry_type, reference_type, reference_id, idempotency_key, transfer_group,
     description, metadata, actor_id, user_id, currency,
     provider, provider_transaction_id, provider_reference, updated_at, processed_at)
  VALUES
    (p_wallet_id, p_direction, p_bucket, p_amount_kobo, v_balance, v_new_balance,
     p_entry_type,
     left(COALESCE(p_reference_type, 'unknown'), 40),
     p_reference_id,
     p_idempotency_key, p_transfer_group,
     left(COALESCE(p_description, ''), 300),
     COALESCE(p_metadata, '{}'::JSONB),
     p_actor_id, v_user_id, COALESCE(v_wallet.currency, 'NGN'),
     v_provider, v_provider_tx, v_provider_ref, now(), now())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_entry;

  IF v_entry IS NULL THEN
    -- A concurrent writer took the key between the check above and this INSERT.
    -- Revert the moved balance and return existing entry.
    UPDATE public.marketplace_wallets
       SET available_kobo = CASE WHEN p_bucket = 'available' THEN v_balance
                                 WHEN p_direction = 'credit' THEN available_kobo - p_amount_kobo
                                 ELSE available_kobo END,
           pending_kobo   = CASE WHEN p_bucket = 'pending'   THEN v_balance
                                 WHEN p_direction = 'credit' THEN pending_kobo - p_amount_kobo
                                 ELSE pending_kobo END,
           lifetime_credit_kobo = lifetime_credit_kobo
                                  - CASE WHEN p_direction = 'credit' THEN p_amount_kobo ELSE 0 END,
           lifetime_debit_kobo  = lifetime_debit_kobo
                                  - CASE WHEN p_direction = 'debit'  THEN p_amount_kobo ELSE 0 END
     WHERE id = p_wallet_id;

    SELECT id INTO v_existing FROM public.marketplace_ledger_entries
     WHERE idempotency_key = p_idempotency_key;
    RETURN v_existing;
  END IF;

  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.mp_wallet_post(
  UUID, public.marketplace_ledger_direction, public.marketplace_wallet_bucket,
  BIGINT, public.marketplace_ledger_entry_type, TEXT, UUID, TEXT, TEXT, JSONB, UUID, UUID
) FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 5. UPDATE MP_WALLET_STATEMENT TO EXPOSE EXTENDED LEDGER FIELDS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_wallet_statement(
  p_user_id UUID DEFAULT NULL,
  p_limit   INTEGER DEFAULT 50,
  p_offset  INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target UUID;
  v_wallet UUID;
  v_rows JSONB;
  v_total BIGINT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view your transactions' USING ERRCODE = '28000';
  END IF;

  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    v_target := v_uid;
  ELSIF public.mp_has_perm('manage_payments') OR public.mp_is_admin(v_uid) THEN
    v_target := p_user_id;
  ELSE
    RAISE EXCEPTION 'You can only view your own transactions' USING ERRCODE = '42501';
  END IF;

  SELECT w.id INTO v_wallet FROM public.marketplace_wallets w WHERE w.owner_user_id = v_target;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('entries', '[]'::JSONB, 'total', 0);
  END IF;

  SELECT count(*) INTO v_total
    FROM public.marketplace_ledger_entries e WHERE e.wallet_id = v_wallet;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC, s.id DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT e.id, e.direction, e.bucket, e.amount_kobo,
             COALESCE(e.balance_before, CASE WHEN e.direction = 'credit' THEN e.balance_after - e.amount_kobo ELSE e.balance_after + e.amount_kobo END) AS balance_before,
             e.balance_after,
             e.entry_type, e.status, e.reference_type, e.reference_id,
             COALESCE(e.currency, 'NGN') AS currency,
             e.provider, e.provider_transaction_id, e.provider_reference,
             e.description, e.metadata, e.created_at, e.updated_at, e.processed_at
        FROM public.marketplace_ledger_entries e
       WHERE e.wallet_id = v_wallet
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
       OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) s;

  RETURN jsonb_build_object('entries', v_rows, 'total', v_total, 'wallet_id', v_wallet);
END;
$$;

REVOKE ALL ON FUNCTION public.mp_wallet_statement(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mp_wallet_statement(UUID, INTEGER, INTEGER) TO authenticated, service_role;

-- =============================================================================
-- 6. WALLET FUNDING RPCS (Sections 3, 4, 5, 17)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fuw_begin_wallet_funding(p_amount_kobo BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user public.profiles%ROWTYPE;
  v_wallet UUID;
  v_wallet_row public.marketplace_wallets%ROWTYPE;
  v_ref TEXT;
  v_funding public.wallet_funding_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to fund your wallet' USING ERRCODE = '28000';
  END IF;

  IF p_amount_kobo IS NULL OR p_amount_kobo < 10000 THEN
    RAISE EXCEPTION 'Minimum funding amount is ₦100 (10,000 kobo)' USING ERRCODE = '22023';
  END IF;
  IF p_amount_kobo > 50000000 THEN
    RAISE EXCEPTION 'Maximum funding amount per transaction is ₦500,000' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_user FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND OR NOT v_user.is_active THEN
    RAISE EXCEPTION 'Your account is inactive or not found' USING ERRCODE = '42501';
  END IF;
  IF v_user.email IS NULL OR trim(v_user.email) = '' THEN
    RAISE EXCEPTION 'A verified email is required for Paystack payment' USING ERRCODE = '22023';
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_uid);
  SELECT * INTO v_wallet_row FROM public.marketplace_wallets WHERE id = v_wallet;
  IF v_wallet_row.is_frozen THEN
    RAISE EXCEPTION 'Wallet is frozen: %', COALESCE(v_wallet_row.frozen_reason, 'contact support')
      USING ERRCODE = '42501';
  END IF;

  v_ref := 'fuw_fund_' || lower(replace(gen_random_uuid()::TEXT, '-', ''));

  INSERT INTO public.wallet_funding_transactions (
    user_id, wallet_id, reference, amount_kobo, currency, status, provider, metadata
  ) VALUES (
    v_uid, v_wallet, v_ref, p_amount_kobo, 'NGN', 'pending', 'paystack',
    jsonb_build_object('user_email', v_user.email, 'initiated_at', now())
  ) RETURNING * INTO v_funding;

  RETURN jsonb_build_object(
    'funding_id', v_funding.id,
    'reference', v_funding.reference,
    'amount_kobo', v_funding.amount_kobo,
    'currency', v_funding.currency,
    'email', v_user.email,
    'wallet_id', v_wallet
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_begin_wallet_funding(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuw_begin_wallet_funding(BIGINT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fuw_set_wallet_funding_checkout(
  p_reference TEXT,
  p_authorization_url TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_authorization_url IS NULL OR p_authorization_url !~ '^https://checkout\.paystack\.com/' THEN
    RAISE EXCEPTION 'Invalid Paystack checkout URL' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wallet_funding_transactions
     SET authorization_url = p_authorization_url,
         updated_at = now()
   WHERE reference = p_reference AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_set_wallet_funding_checkout(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_set_wallet_funding_checkout(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fuw_complete_wallet_funding(
  p_reference             TEXT,
  p_provider_transaction_id TEXT,
  p_provider_status       TEXT,
  p_amount_kobo           BIGINT,
  p_currency              TEXT,
  p_channel               TEXT DEFAULT 'card',
  p_metadata              JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_funding public.wallet_funding_transactions%ROWTYPE;
  v_wallet_row public.marketplace_wallets%ROWTYPE;
  v_entry UUID;
  v_bal_after BIGINT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_funding FROM public.wallet_funding_transactions
   WHERE reference = p_reference FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funding reference not found: %', p_reference USING ERRCODE = '22023';
  END IF;

  -- Idempotency check: if already succeeded, do NOT credit again!
  IF v_funding.status = 'succeeded' THEN
    SELECT * INTO v_wallet_row FROM public.marketplace_wallets WHERE id = v_funding.wallet_id;
    RETURN jsonb_build_object(
      'succeeded', TRUE,
      'already_processed', TRUE,
      'reference', v_funding.reference,
      'amount_kobo', v_funding.amount_kobo,
      'balance_after_kobo', v_wallet_row.available_kobo
    );
  END IF;

  IF v_funding.status <> 'pending' THEN
    RAISE EXCEPTION 'Funding transaction is not pending (status: %)', v_funding.status USING ERRCODE = '55000';
  END IF;

  -- Security cross-check: amount, currency and provider status
  IF p_provider_status <> 'success'
     OR p_amount_kobo IS DISTINCT FROM v_funding.amount_kobo
     OR upper(COALESCE(p_currency, '')) <> v_funding.currency
     OR p_provider_transaction_id IS NULL THEN
    UPDATE public.wallet_funding_transactions
       SET status = 'failed',
           failure_reason = 'Provider verification mismatch or unsuccessful payment',
           updated_at = now()
     WHERE id = v_funding.id;
    RETURN jsonb_build_object(
      'succeeded', FALSE,
      'already_processed', FALSE,
      'reference', v_funding.reference,
      'reason', 'Payment verification failed'
    );
  END IF;

  -- Atomic credit to the centralized FUW wallet
  v_entry := public.mp_wallet_post(
    p_wallet_id => v_funding.wallet_id,
    p_direction => 'credit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_funding.amount_kobo,
    p_entry_type => 'wallet_funding'::public.marketplace_ledger_entry_type,
    p_reference_type => 'wallet_funding',
    p_reference_id => v_funding.id,
    p_idempotency_key => 'fund:' || v_funding.reference,
    p_description => format('FUW Wallet funding of ₦%s via Paystack Card', (v_funding.amount_kobo / 100)::TEXT),
    p_metadata => jsonb_build_object(
      'reference', v_funding.reference,
      'provider', 'paystack',
      'provider_transaction_id', p_provider_transaction_id,
      'channel', COALESCE(p_channel, 'card')
    ) || p_metadata,
    p_actor_id => v_funding.user_id
  );

  UPDATE public.wallet_funding_transactions
     SET status = 'succeeded',
         provider_transaction_id = p_provider_transaction_id,
         provider_reference = p_reference,
         channel = COALESCE(p_channel, 'card'),
         completed_at = now(),
         updated_at = now(),
         metadata = metadata || p_metadata
   WHERE id = v_funding.id;

  SELECT available_kobo INTO v_bal_after
    FROM public.marketplace_wallets WHERE id = v_funding.wallet_id;

  -- In-app notification
  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_funding.user_id,
    'Wallet funded successfully',
    format('Your FUW wallet has been credited with ₦%s.', (v_funding.amount_kobo / 100)::TEXT),
    'wallet_funded',
    '/marketplace/wallet',
    'fund:' || v_funding.reference
  ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object(
    'succeeded', TRUE,
    'already_processed', FALSE,
    'reference', v_funding.reference,
    'amount_kobo', v_funding.amount_kobo,
    'balance_after_kobo', v_bal_after,
    'ledger_entry_id', v_entry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_complete_wallet_funding(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_complete_wallet_funding(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.fuw_fail_wallet_funding(
  p_reference TEXT,
  p_reason    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.wallet_funding_transactions
     SET status = 'failed',
         failure_reason = p_reason,
         updated_at = now()
   WHERE reference = p_reference AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_fail_wallet_funding(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuw_fail_wallet_funding(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fuw_get_wallet_funding_status(p_reference TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_funding public.wallet_funding_transactions%ROWTYPE;
  v_wallet_row public.marketplace_wallets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to check funding status' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_funding FROM public.wallet_funding_transactions
   WHERE reference = p_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funding reference not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_funding.user_id <> v_uid AND NOT public.mp_is_admin(v_uid) THEN
    RAISE EXCEPTION 'You can only check your own wallet funding' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_wallet_row FROM public.marketplace_wallets WHERE id = v_funding.wallet_id;

  RETURN jsonb_build_object(
    'reference', v_funding.reference,
    'status', v_funding.status,
    'amount_kobo', v_funding.amount_kobo,
    'currency', v_funding.currency,
    'channel', v_funding.channel,
    'created_at', v_funding.created_at,
    'completed_at', v_funding.completed_at,
    'failure_reason', v_funding.failure_reason,
    'balance_after_kobo', v_wallet_row.available_kobo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fuw_get_wallet_funding_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuw_get_wallet_funding_status(TEXT) TO authenticated, service_role;

-- =============================================================================
-- 7. ELIBRARY PREMIUM PLAN WALLET PAYMENT (Section 20)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.pay_premium_plan_from_wallet(p_plan_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_wallet UUID;
  v_wallet_row public.marketplace_wallets%ROWTYPE;
  v_entry UUID;
  v_ref TEXT;
  v_tx public.payment_transactions%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_config JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to purchase a plan' USING ERRCODE = '28000';
  END IF;

  IF NOT public.premium_system_enabled() THEN
    RAISE EXCEPTION 'Premium purchases are temporarily unavailable.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_user FROM public.profiles WHERE id = v_uid FOR SHARE;
  IF NOT FOUND OR v_user.role <> 'student' OR NOT v_user.is_active OR v_user.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Verify your active student account before purchasing Premium.' USING ERRCODE = '42501';
  END IF;

  IF public.has_premium_access() THEN
    RAISE EXCEPTION 'Premium access is already active on your account.' USING ERRCODE = '55000';
  END IF;

  -- Authoritative plan price from database
  SELECT * INTO v_plan FROM public.plans
   WHERE slug = lower(btrim(p_plan_slug)) AND is_active AND is_premium AND price_kobo > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That Premium plan is unavailable.' USING ERRCODE = '22023';
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_uid);
  SELECT * INTO v_wallet_row FROM public.marketplace_wallets WHERE id = v_wallet FOR UPDATE;

  IF v_wallet_row.is_frozen THEN
    RAISE EXCEPTION 'Your wallet is frozen: %', COALESCE(v_wallet_row.frozen_reason, 'contact support')
      USING ERRCODE = '42501';
  END IF;

  IF v_wallet_row.available_kobo < v_plan.price_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance. You have ₦%, but ₦% is required.',
      (v_wallet_row.available_kobo / 100)::TEXT, (v_plan.price_kobo / 100)::TEXT
      USING ERRCODE = '23514';
  END IF;

  v_ref := 'FUW-WLT-' || upper(replace(gen_random_uuid()::TEXT, '-', ''));

  -- Atomic debit from centralized wallet
  v_entry := public.mp_wallet_post(
    p_wallet_id => v_wallet,
    p_direction => 'debit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_plan.price_kobo,
    p_entry_type => 'elibrary_premium_purchase'::public.marketplace_ledger_entry_type,
    p_reference_type => 'plan',
    p_reference_id => v_plan.id,
    p_idempotency_key => 'plan:' || v_plan.id::TEXT || ':' || v_uid::TEXT || ':' || extract(epoch FROM now())::BIGINT,
    p_description => format('Subscription to %s from FUW Wallet', v_plan.name),
    p_metadata => jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_slug', v_plan.slug,
      'provider', 'wallet',
      'reference', v_ref
    ),
    p_actor_id => v_uid
  );

  v_config := public.get_payment_configuration();

  -- Record payment transaction
  INSERT INTO public.payment_transactions (
    user_id, payment_reference, plan_id, amount_kobo, currency,
    payment_method, provider, provider_transaction_id,
    status, verification_status, verified_at, metadata
  ) VALUES (
    v_uid, v_ref, v_plan.id, v_plan.price_kobo, COALESCE(v_config->>'currency', 'NGN'),
    'automatic', 'wallet', v_entry::TEXT,
    'verified', 'verified', now(),
    jsonb_build_object('wallet_entry_id', v_entry, 'wallet_id', v_wallet)
  ) RETURNING * INTO v_tx;

  -- Activate subscription (fires sync_premium_entitlement_from_subscription)
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, starts_at, expires_at, admin_note
  ) VALUES (
    v_uid, v_plan.id, 'active', now(),
    now() + make_interval(days => v_plan.duration_days),
    'Automatic payment ' || v_tx.id::TEXT
  ) RETURNING * INTO v_sub;

  UPDATE public.payment_transactions
     SET activated_at = v_sub.starts_at,
         expires_at = v_sub.expires_at,
         metadata = metadata || jsonb_build_object('subscription_id', v_sub.id),
         updated_at = now()
   WHERE id = v_tx.id;

  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_uid,
    'Premium plan activated',
    format('%s is now active from your wallet until %s.',
           v_plan.name,
           to_char(v_sub.expires_at AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY')),
    'plan_activated',
    '/student/subscription',
    'wallet_payment:' || v_tx.id::TEXT
  ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object(
    'success', TRUE,
    'plan_name', v_plan.name,
    'amount_kobo', v_plan.price_kobo,
    'balance_after_kobo', (SELECT available_kobo FROM public.marketplace_wallets WHERE id = v_wallet),
    'expires_at', v_sub.expires_at,
    'reference', v_ref
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_premium_plan_from_wallet(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_premium_plan_from_wallet(TEXT) TO authenticated, service_role;

-- =============================================================================
-- 8. RECORD WEBHOOK EVENT RPC (Section 12)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_payment_webhook_event(
  p_event_id    TEXT,
  p_event_type  TEXT,
  p_reference   TEXT DEFAULT NULL,
  p_amount_kobo BIGINT DEFAULT NULL,
  p_currency    TEXT DEFAULT NULL,
  p_status      TEXT DEFAULT 'received',
  p_outcome     TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.payment_webhook_events%ROWTYPE;
  v_new public.payment_webhook_events%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.payment_webhook_events WHERE event_id = p_event_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', TRUE,
      'event_id', v_existing.event_id,
      'status', v_existing.status,
      'created_at', v_existing.created_at
    );
  END IF;

  INSERT INTO public.payment_webhook_events (
    event_id, event_type, reference, amount_kobo, currency, status, outcome, metadata
  ) VALUES (
    p_event_id, p_event_type, p_reference, p_amount_kobo, p_currency, p_status, p_outcome, p_metadata
  ) RETURNING * INTO v_new;

  RETURN jsonb_build_object(
    'duplicate', FALSE,
    'event_id', v_new.event_id,
    'status', v_new.status,
    'created_at', v_new.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_webhook_event(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_webhook_event(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- =============================================================================
-- 9. ADMIN REFUND TO WALLET RPC (Section 23)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refund_payment_transaction_to_wallet(
  p_transaction_id UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_tx public.payment_transactions%ROWTYPE;
  v_wallet UUID;
  v_entry UUID;
  v_sub_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only administrators can issue refunds' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tx FROM public.payment_transactions
   WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tx.status <> 'verified' THEN
    RAISE EXCEPTION 'Only verified transactions can be refunded' USING ERRCODE = '55000';
  END IF;

  IF (v_tx.metadata->>'refunded')::BOOLEAN IS TRUE THEN
    RAISE EXCEPTION 'This transaction has already been refunded' USING ERRCODE = '55000';
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_tx.user_id);

  v_entry := public.mp_wallet_post(
    p_wallet_id => v_wallet,
    p_direction => 'credit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_tx.amount_kobo,
    p_entry_type => 'refund_credit'::public.marketplace_ledger_entry_type,
    p_reference_type => 'payment_transaction',
    p_reference_id => v_tx.id,
    p_idempotency_key => 'refund:tx:' || v_tx.id::TEXT,
    p_description => format('Refund for transaction %s: %s', v_tx.payment_reference, COALESCE(p_reason, 'Refund')),
    p_metadata => jsonb_build_object(
      'refund_reason', p_reason,
      'original_transaction_id', v_tx.id,
      'refunded_by', v_uid,
      'provider', 'wallet'
    ),
    p_actor_id => v_uid
  );

  UPDATE public.payment_transactions
     SET metadata = metadata || jsonb_build_object(
           'refunded', TRUE,
           'refund_reason', p_reason,
           'refunded_at', now(),
           'refunded_by', v_uid,
           'refund_wallet_entry_id', v_entry
         ),
         updated_at = now()
   WHERE id = v_tx.id;

  -- If subscription is linked, cancel it
  IF v_tx.metadata ? 'subscription_id' THEN
    BEGIN
      v_sub_id := (v_tx.metadata->>'subscription_id')::UUID;
      UPDATE public.subscriptions
         SET status = 'cancelled', updated_at = now()
       WHERE id = v_sub_id AND status = 'active';
    EXCEPTION WHEN OTHERS THEN
      -- Proceed even if subscription uuid conversion fails
      NULL;
    END;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_tx.user_id,
    'Payment refunded to wallet',
    format('Your payment of ₦%s has been refunded to your FUW wallet.', (v_tx.amount_kobo / 100)::TEXT),
    'refund_credited',
    '/marketplace/wallet',
    'refund:tx:' || v_tx.id::TEXT
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunded_amount_kobo', v_tx.amount_kobo,
    'wallet_entry_id', v_entry,
    'balance_after_kobo', (SELECT available_kobo FROM public.marketplace_wallets WHERE id = v_wallet)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_payment_transaction_to_wallet(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_payment_transaction_to_wallet(UUID, TEXT) TO authenticated, service_role;

COMMIT;
