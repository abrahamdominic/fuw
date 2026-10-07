-- =============================================================================
-- Marketplace: ledger-based wallet architecture
-- =============================================================================
-- Requires 20261006090000_marketplace_wallet_payment_provider.sql, which commits
-- the 'wallet' enum value in a transaction of its own. This file uses it.
--
-- WHAT THIS FIXES
-- --------------
-- The marketplace held money in three tables that did not add up to a balance:
--
--   marketplace_escrows       the buyer's money, held until receipt is confirmed
--   marketplace_settlements   what the vendor earned
--   marketplace_withdrawals  bank transfers out
--
-- None of them was an account. A vendor's "available balance" was only ever a
-- hand-written SUM in the UI over settlements whose status equalled 'scheduled'
-- -- a status only mp_release_eligible_settlements() ever wrote, and that job
-- required a server context and had no scheduler to run it, so the sum was
-- permanently zero and a vendor could never request a payout. A student had no
-- record at all: a refund left the order and vanished.
--
-- WHAT THIS DOES
-- ---------------
-- A. marketplace_wallets is the authoritative balance. One row per FUW profile
--    plus exactly one platform row. Both balances are non-negative by CHECK, so
--    an overdraw is impossible rather than merely discouraged.
--
-- B. marketplace_ledger_entries is an append-only journal. Every balance change
--    is one row, carrying an idempotency_key that is UNIQUE across the whole
--    table. Replaying a webhook, re-running a trigger or retrying a request
--    cannot move money twice: the second attempt collides on the key and the
--    original entry is returned.
--
-- C. There is exactly ONE writer -- mp_wallet_post -- which is SECURITY DEFINER
--    with EXECUTE revoked from anon and authenticated. No client can write a
--    ledger row or set a balance, whatever it sends. Balances are server-derived
--    and never client-supplied.
--
-- D. The escrow/settlement tables stay exactly where they are. They are the
--    operational record (what happened to this order); the wallet is the
--    financial record (what this account holds). Triggers bridge the two, and
--    every bridge is idempotent, so the two can never drift:
--
--      escrow -> locked        vendor  pending    += order.vendor_payout_kobo
--                             platform available += platform_fee_kobo
--                                                 + delivery_fee_kobo
--      settlement net reduced  vendor  pending    -= the reduced net   (refund)
--                             platform available -= the reduced commission
--      settlement -> cancelled vendor/platform unwind what is left
--      settlement -> scheduled vendor  shift pending -> available   (payout)
--      withdrawal -> requested vendor  shift available -> pending   (reserved)
--      withdrawal -> paid      vendor  pending     -= amount      (money gone)
--      withdrawal -> rejected  vendor  shift pending -> available  (promise broken)
--      payment refunded_kobo+  buyer   available  += the exact delta
--
--    Every one of those keys is derived from the entity it belongs to, NOT from
--    the status transition that caused it. That matters because the settlement
--    status is not one-directional in this codebase: a rejected payout pushes a
--    settlement from 'processing' back to 'scheduled', and a stable key means
--    the earning shift is booked once no matter how many times it is entered.
--
-- E. A refund credits the buyer's own wallet rather than disappearing, so a
--    student account has a real, spendable balance. mp_pay_order_from_wallet is
--    the one client-callable debit; it can only ever debit the caller's own
--    wallet for the caller's own order, and it books the capture through the
--    same mp_apply_payment_event() path a verified Paystack webhook uses, so a
--    wallet payment and a card payment fund escrow by identical machinery.
--
-- F. The platform wallet is a real row, so marketplace revenue is visible
--    instead of being an implied subtraction. Finance staff only.
-- =============================================================================

BEGIN;

-- =============================================================================
-- A. TYPES
-- =============================================================================

CREATE TYPE public.marketplace_wallet_bucket    AS ENUM ('available', 'pending');
CREATE TYPE public.marketplace_ledger_direction AS ENUM ('credit', 'debit');
CREATE TYPE public.marketplace_ledger_status    AS ENUM ('posted', 'reversed');

CREATE TYPE public.marketplace_ledger_entry_type AS ENUM (
  -- money held on the vendor's behalf until the buyer confirms receipt
  'escrow_funded',
  -- that hold unwound: order cancelled, refunded, or returned
  'escrow_refund',
  -- the hold became the vendor's withdrawable money
  'vendor_earning',
  -- platform commission and delivery, held and then recognised
  'platform_fee',
  'platform_fee_refund',
  -- an in-flight bank payout: reserved, settled, or released
  'payout_hold',
  'payout_paid',
  'payout_reversed',
  -- advert packages bought from the wallet
  'advert_spend',
  'advert_refund',
  -- student-side money movement
  'refund_credit',
  'wallet_payment',
  -- finance-initiated corrections
  'manual_credit',
  'manual_debit'
);

-- =============================================================================
-- B. TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_wallets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  vendor_id             UUID UNIQUE REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  currency             TEXT NOT NULL DEFAULT 'NGN',
  available_kobo       BIGINT NOT NULL DEFAULT 0 CHECK (available_kobo >= 0),
  pending_kobo         BIGINT NOT NULL DEFAULT 0 CHECK (pending_kobo   >= 0),
  lifetime_credit_kobo BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_credit_kobo >= 0),
  lifetime_debit_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_debit_kobo  >= 0),
  is_frozen            BOOLEAN NOT NULL DEFAULT FALSE,
  frozen_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A wallet belongs either to a person or to the platform. A row with no owner
  -- must have no storefront either, so "belongs to nobody" is expressible for
  -- the platform alone and nowhere else.
  CONSTRAINT mp_wallets_owner_present_chk
    CHECK (owner_user_id IS NOT NULL OR vendor_id IS NULL)
);

-- Exactly one platform wallet, enforced by index rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS mp_wallets_single_platform_idx
  ON public.marketplace_wallets ((TRUE)) WHERE owner_user_id IS NULL AND vendor_id IS NULL;

CREATE INDEX IF NOT EXISTS mp_wallets_vendor_idx ON public.marketplace_wallets (vendor_id)
  WHERE vendor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.marketplace_ledger_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id          UUID NOT NULL REFERENCES public.marketplace_wallets(id) ON DELETE CASCADE,
  direction         public.marketplace_ledger_direction NOT NULL,
  bucket            public.marketplace_wallet_bucket NOT NULL,
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  balance_after     BIGINT NOT NULL CHECK (balance_after >= 0),
  entry_type        public.marketplace_ledger_entry_type NOT NULL,
  status            public.marketplace_ledger_status NOT NULL DEFAULT 'posted',

  -- What this entry is about. A type + id pair rather than six nullable
  -- foreign keys: one journal records escrows, settlements, payouts, adverts
  -- and refunds.
  reference_type    TEXT NOT NULL,
  reference_id      UUID,

  -- The replay guard. UNIQUE across the whole table, so no event can reach a
  -- wallet twice regardless of which trigger, job or retry produced it.
  idempotency_key   TEXT NOT NULL UNIQUE,

  -- Set on the credit leg of a bucket-to-bucket move, tying the pair together.
  transfer_group    UUID,
  reverses_entry_id UUID REFERENCES public.marketplace_ledger_entries(id),

  description       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::JSONB,
  actor_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_ledger_wallet_created_idx
  ON public.marketplace_ledger_entries (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_ledger_reference_idx
  ON public.marketplace_ledger_entries (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mp_ledger_type_idx
  ON public.marketplace_ledger_entries (entry_type, created_at DESC);

-- =============================================================================
-- C. THE SINGLE WRITER
-- =============================================================================
-- mp_wallet_ensure  -- get (or lazily create) the wallet for an owner
-- mp_wallet_post    -- one credit or debit against one bucket, atomically
-- mp_wallet_shift   -- move an amount between a wallet's own two buckets
-- mp_wallet_unwind  -- give back a hold of a known size, pending bucket first
--
-- All are SECURITY DEFINER with EXECUTE revoked from every client role in
-- section G. They are reachable only from the triggers below and from the
-- guarded RPCs.

-- NOTE ON ARGUMENTS: the first parameter is a PROFILE id, the second a STOREFRONT
-- id. They are different tables with different id spaces, and passing a vendor id
-- where a profile id belongs silently creates a wallet for the wrong principal --
-- or fails the foreign key. Every call below names its argument.
CREATE OR REPLACE FUNCTION public.mp_wallet_ensure(
  p_owner_user_id UUID DEFAULT NULL,
  p_vendor_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet UUID;
  v_owner  UUID;
BEGIN
  IF p_owner_user_id IS NOT NULL THEN
    INSERT INTO public.marketplace_wallets (owner_user_id, vendor_id)
    VALUES (
      p_owner_user_id,
      (SELECT v.id FROM public.marketplace_vendors v
        WHERE v.owner_id = p_owner_user_id AND v.deleted_at IS NULL LIMIT 1)
    )
    ON CONFLICT (owner_user_id) DO UPDATE
      -- Refresh the storefront pointer without touching money: a user who just
      -- registered a storefront gets one wallet, not two.
      SET vendor_id = COALESCE(EXCLUDED.vendor_id, public.marketplace_wallets.vendor_id),
          updated_at = now()
    RETURNING id INTO v_wallet;
    RETURN v_wallet;
  END IF;

  IF p_vendor_id IS NOT NULL THEN
    SELECT v.owner_id INTO v_owner FROM public.marketplace_vendors v
     WHERE v.id = p_vendor_id AND v.deleted_at IS NULL;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Storefront not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN public.mp_wallet_ensure(p_owner_user_id => v_owner, p_vendor_id => p_vendor_id);
  END IF;

  -- The single platform wallet.
  INSERT INTO public.marketplace_wallets (owner_user_id, vendor_id, currency)
  VALUES (NULL, NULL, 'NGN')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_wallet FROM public.marketplace_wallets
   WHERE owner_user_id IS NULL AND vendor_id IS NULL;

  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'The platform wallet is missing' USING ERRCODE = 'XX000';
  END IF;
  RETURN v_wallet;
END;
$$;

COMMENT ON FUNCTION public.mp_wallet_ensure(UUID, UUID) IS
  'Wallet id for a profile owner, a storefront owner, or the platform. p_owner_user_id is a profiles.id and p_vendor_id is a marketplace_vendors.id. Never callable by a client.';

CREATE OR REPLACE FUNCTION public.mp_wallet_post(
  p_wallet_id       UUID,
  p_direction       public.marketplace_ledger_direction,
  p_bucket          public.marketplace_wallet_bucket,
  p_amount_kobo     BIGINT,
  p_entry_type      public.marketplace_ledger_entry_type,
  p_reference_type  TEXT,
  p_reference_id    UUID DEFAULT NULL,
  -- No default is wanted, but one is required: everything after it has one, and
  -- PostgreSQL rejects a required parameter that follows an optional one. The
  -- validation below turns an omitted key into the same error an empty one gets.
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
  v_entry UUID;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'A ledger entry needs a positive amount' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_idempotency_key, '')) < 8 THEN
    RAISE EXCEPTION 'A ledger entry needs an idempotency key' USING ERRCODE = '22023';
  END IF;

  -- Cheap pre-check, so a duplicate does not even take a row lock.
  SELECT id INTO v_existing FROM public.marketplace_ledger_entries
   WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Lock the wallet. Every post to a given wallet is serialised from here on,
  -- so two concurrent events cannot read the same balance and both write.
  SELECT * INTO v_wallet FROM public.marketplace_wallets
   WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-check under the lock. The pre-check above can pass while another
  -- transaction is mid-flight on the same key; this closes that window for the
  -- single-wallet case that actually occurs, because a key names one wallet.
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
      -- Refuse rather than clamp. A clamped debit would write a ledger entry
      -- that does not match the balance change and the money would vanish.
      RAISE EXCEPTION 'Insufficient % balance: % available, % needed',
        p_bucket, v_balance, p_amount_kobo USING ERRCODE = '23514';
    END IF;
    v_balance := v_balance - p_amount_kobo;
  ELSE
    v_balance := v_balance + p_amount_kobo;
  END IF;

  UPDATE public.marketplace_wallets
     SET available_kobo = CASE WHEN p_bucket = 'available' THEN v_balance ELSE available_kobo END,
         pending_kobo   = CASE WHEN p_bucket = 'pending'   THEN v_balance ELSE pending_kobo   END,
         lifetime_credit_kobo = lifetime_credit_kobo
                                + CASE WHEN p_direction = 'credit' THEN p_amount_kobo ELSE 0 END,
         lifetime_debit_kobo  = lifetime_debit_kobo
                                + CASE WHEN p_direction = 'debit'  THEN p_amount_kobo ELSE 0 END,
         updated_at = now()
   WHERE id = p_wallet_id;

  INSERT INTO public.marketplace_ledger_entries
    (wallet_id, direction, bucket, amount_kobo, balance_after, entry_type,
     reference_type, reference_id, idempotency_key, transfer_group,
     description, metadata, actor_id)
  VALUES
    (p_wallet_id, p_direction, p_bucket, p_amount_kobo, v_balance, p_entry_type,
     left(COALESCE(p_reference_type, 'unknown'), 40),
     p_reference_id,
     p_idempotency_key, p_transfer_group,
     left(COALESCE(p_description, ''), 300),
     COALESCE(p_metadata, '{}'::JSONB),
     p_actor_id)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_entry;

  IF v_entry IS NULL THEN
    -- A concurrent writer took the key between the check above and this INSERT.
    -- Undo the balance this transaction just moved and hand back their entry.
    UPDATE public.marketplace_wallets
       SET available_kobo = CASE WHEN p_bucket = 'available' THEN v_balance - p_amount_kobo
                                 WHEN p_direction = 'credit' THEN available_kobo - p_amount_kobo
                                 ELSE available_kobo END,
           pending_kobo   = CASE WHEN p_bucket = 'pending'   THEN v_balance - p_amount_kobo
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

COMMENT ON FUNCTION public.mp_wallet_post(UUID, public.marketplace_ledger_direction,
  public.marketplace_wallet_bucket, BIGINT, public.marketplace_ledger_entry_type,
  TEXT, UUID, TEXT, TEXT, JSONB, UUID, UUID) IS
  'The only writer of a marketplace balance. Idempotent on idempotency_key. Never callable by a client.';

CREATE OR REPLACE FUNCTION public.mp_wallet_shift(
  p_wallet_id       UUID,
  p_from_bucket     public.marketplace_wallet_bucket,
  p_to_bucket       public.marketplace_wallet_bucket,
  p_amount_kobo     BIGINT,
  p_entry_type      public.marketplace_ledger_entry_type,
  p_reference_type  TEXT,
  p_reference_id    UUID,
  p_idempotency_key TEXT,
  p_description     TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT '{}'::JSONB,
  p_actor_id        UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group UUID := gen_random_uuid();
  v_unhold UUID;
  v_credit UUID;
BEGIN
  IF p_from_bucket = p_to_bucket THEN
    RAISE EXCEPTION 'A shift needs two different buckets' USING ERRCODE = '22023';
  END IF;

  -- The debit goes first so an insufficient balance aborts before any money
  -- moves, and both legs share one idempotency stem so a retry cannot leave an
  -- unpaired entry behind.
  v_unhold := public.mp_wallet_post(
    p_wallet_id, 'debit', p_from_bucket, p_amount_kobo, p_entry_type,
    p_reference_type, p_reference_id,
    p_idempotency_key || ':from', p_description, p_metadata, p_actor_id, v_group);

  v_credit := public.mp_wallet_post(
    p_wallet_id, 'credit', p_to_bucket, p_amount_kobo, p_entry_type,
    p_reference_type, p_reference_id,
    p_idempotency_key || ':to', p_description, p_metadata, p_actor_id, v_group);

  UPDATE public.marketplace_ledger_entries
     SET reverses_entry_id = v_unhold
   WHERE id = v_credit;

  RETURN v_credit;
END;
$$;

COMMENT ON FUNCTION public.mp_wallet_shift(UUID, public.marketplace_wallet_bucket,
  public.marketplace_wallet_bucket, BIGINT, public.marketplace_ledger_entry_type,
  TEXT, UUID, TEXT, TEXT, JSONB, UUID) IS
  'Moves an amount between a wallets own two buckets as one atomic, paired, idempotent operation.';

-- Give back a hold of a known size, taking from pending first and falling back to
-- available only when the hold has already been released to withdrawable money.
-- If neither bucket can cover it, the RAISE from mp_wallet_post propagates and the
-- whole transaction rolls back rather than the money quietly disappearing.
--
-- Both legs are keyed on the stem, so a replay of the same event finds them
-- already written and moves nothing.
CREATE OR REPLACE FUNCTION public.mp_wallet_unwind(
  p_wallet_id       UUID,
  p_amount_kobo     BIGINT,
  p_entry_type      public.marketplace_ledger_entry_type,
  p_reference_type  TEXT,
  p_reference_id    UUID,
  p_idempotency_key TEXT,
  p_description     TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT '{}'::JSONB,
  p_actor_id        UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pending BIGINT;
  v_available BIGINT;
BEGIN
  IF p_amount_kobo IS NULL OR p_amount_kobo <= 0 THEN
    RETURN;
  END IF;

  SELECT pending_kobo, available_kobo INTO v_pending, v_available
    FROM public.marketplace_wallets WHERE id = p_wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_pending > 0 THEN
    PERFORM public.mp_wallet_post(
      p_wallet_id, 'debit', 'pending', LEAST(v_pending, p_amount_kobo), p_entry_type,
      p_reference_type, p_reference_id,
      p_idempotency_key || ':pending', p_description, p_metadata, p_actor_id);
  END IF;

  IF p_amount_kobo > v_pending THEN
    PERFORM public.mp_wallet_post(
      p_wallet_id, 'debit', 'available', p_amount_kobo - v_pending, p_entry_type,
      p_reference_type, p_reference_id,
      p_idempotency_key || ':available', p_description, p_metadata, p_actor_id);
  END IF;
END;
$$;

-- =============================================================================
-- D. EVENT HOOKS
-- =============================================================================
-- The only places the operational tables and the financial tables meet, which is
-- what stops them drifting. Every lock is taken in the order vendor, platform,
-- buyer so two concurrent events can never deadlock against each other.

-- How much of a captured payment belongs to the platform rather than the vendor.
-- mp_guard_escrow_release already proves the identity on every release:
--     payment.amount_kobo = settlement.net_kobo + settlement.commission_kobo
--                            + order.delivery_fee_kobo
-- so commission plus delivery is exactly the platform's share of the money that
-- was taken. Delivery is credited because it is never part of a vendor's
-- receivable, and it is unwound again with the commission when a settlement is
-- cancelled, because a cancelled order means nothing was delivered.
CREATE OR REPLACE FUNCTION public.mp_platform_share(
  p_order public.marketplace_orders
)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_order.platform_fee_kobo, 0) + COALESCE(p_order.delivery_fee_kobo, 0);
$$;

-- D1. Escrow funded (row INSERTed at 'locked' by mp_sync_escrow_from_payment).
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_on_escrow_funded()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_vendor_wallet UUID;
  v_platform_wallet UUID;
  v_net BIGINT;
  v_platform BIGINT;
  v_actor UUID := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.vendor_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Both figures come from the order, never from the request, and they are the
  -- two halves of what the buyer paid:
  --   vendor_payout_kobo + platform_fee_kobo + delivery_fee_kobo == total_kobo
  v_net      := COALESCE(v_order.vendor_payout_kobo, 0);
  v_platform := public.mp_platform_share(v_order);

  IF v_net <= 0 AND v_platform <= 0 THEN
    RETURN NULL;
  END IF;

  v_vendor_wallet   := public.mp_wallet_ensure(p_vendor_id => v_order.vendor_id);
  v_platform_wallet := public.mp_wallet_ensure();

  IF v_net > 0 THEN
    PERFORM public.mp_wallet_post(
      v_vendor_wallet, 'credit', 'pending', v_net, 'escrow_funded',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':funded',
      format('Held for order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'payment_id', NEW.payment_id,
                         'order_total_kobo', NEW.amount_kobo, 'net_kobo', v_net),
      v_actor);
  END IF;

  IF v_platform > 0 THEN
    -- Recognised immediately: the platform has the money and owes nobody a share
    -- of it. A later refund takes exactly this figure back.
    PERFORM public.mp_wallet_post(
      v_platform_wallet, 'credit', 'available', v_platform, 'platform_fee',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':platform_share',
      format('Commission and delivery on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id,
                         'platform_fee_kobo', v_order.platform_fee_kobo,
                         'delivery_fee_kobo', v_order.delivery_fee_kobo,
                         'share_kobo', v_platform),
      v_actor);
  END IF;

  RETURN NULL;
END;
$$;

-- D2. Escrow unwound with no settlement to unwind it.
--
-- mp_issue_refund is what actually unwinds a receivable, and it does it on the
-- SETTLEMENT (D3). This path only covers the case it cannot: the buyer was
-- refunded or the order was cancelled after capture but before completion, so no
-- settlement was ever created and the hold would otherwise sit on the vendor's
-- balance forever.
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_on_escrow_unwound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_found_settlement BOOLEAN;
  v_net BIGINT;
  v_platform BIGINT;
  v_actor UUID := auth.uid();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status NOT IN ('refunded', 'cancelled') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.vendor_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.marketplace_settlements s
                  WHERE s.order_id = NEW.order_id) INTO v_found_settlement;

  IF v_found_settlement THEN
    -- D3 owns every settlement that exists; stepping in here as well would
    -- unwind the same kobo twice.
    RETURN NULL;
  END IF;

  v_net      := COALESCE(v_order.vendor_payout_kobo, 0);
  v_platform := public.mp_platform_share(v_order);

  IF v_net > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(p_vendor_id => v_order.vendor_id), v_net, 'escrow_refund',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':refund_vendor',
      format('Hold released on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'no_settlement', TRUE), v_actor);
  END IF;

  IF v_platform > 0 THEN
    PERFORM public.mp_wallet_unwind(
      public.mp_wallet_ensure(), v_platform, 'platform_fee_refund',
      'escrow', NEW.id,
      'escrow:' || NEW.id::TEXT || ':refund_platform',
      format('Commission reversed on order %s', v_order.order_number),
      jsonb_build_object('order_id', v_order.id, 'no_settlement', TRUE), v_actor);
  END IF;

  RETURN NULL;
END;
$$;

-- D3. Settlement: reduced by a partial refund, cancelled outright, or scheduled.
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_from_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet UUID;
  v_order public.marketplace_orders%ROWTYPE;
  v_net_drop BIGINT;
  v_comm_drop BIGINT;
  v_delivery BIGINT;
  v_actor UUID := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_wallet := public.mp_wallet_ensure(p_vendor_id => NEW.vendor_id);

  -- ── Partial refund: mp_issue_refund rewrote the settlement in place, so the
  --    receivable shrank and the hold has to shrink by exactly the same amount.
  --    The key includes the new net so two successive partial refunds each get
  --    their own entry instead of the second being swallowed as a replay.
  IF NEW.net_kobo < OLD.net_kobo THEN
    v_net_drop := OLD.net_kobo - NEW.net_kobo;
    v_comm_drop := GREATEST(OLD.commission_kobo - NEW.commission_kobo, 0);

    PERFORM public.mp_wallet_unwind(
      v_wallet, v_net_drop, 'escrow_refund', 'settlement', NEW.id,
      'settlement:' || NEW.id::TEXT || ':refund_net:' || NEW.net_kobo::TEXT,
      format('Goods returned on order %s', COALESCE(NEW.hold_reason, v_order.order_number)),
      jsonb_build_object('order_id', NEW.order_id, 'net_before', OLD.net_kobo,
                         'net_after', NEW.net_kobo, 'net_drop', v_net_drop),
      v_actor);

    IF v_comm_drop > 0 THEN
      PERFORM public.mp_wallet_unwind(
        public.mp_wallet_ensure(), v_comm_drop, 'platform_fee_refund',
        'settlement', NEW.id,
        'settlement:' || NEW.id::TEXT || ':refund_commission:' || NEW.commission_kobo::TEXT,
        format('Commission reversed on order %s', v_order.order_number),
        jsonb_build_object('order_id', NEW.order_id, 'commission_drop', v_comm_drop),
        v_actor);
    END IF;
  END IF;

  -- ── Outright cancellation: nothing was delivered, so the remaining hold and
  --    the whole platform share go back. Delivery is included here because a
  --    cancelled order is one the buyer never got.
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    v_delivery := COALESCE(v_order.delivery_fee_kobo, 0);

    PERFORM public.mp_wallet_unwind(
      v_wallet, NEW.net_kobo, 'escrow_refund', 'settlement', NEW.id,
      'settlement:' || NEW.id::TEXT || ':cancel_vendor',
      format('Receivable cancelled on order %s', v_order.order_number),
      jsonb_build_object('order_id', NEW.order_id, 'net_kobo', NEW.net_kobo,
                         'reason', left(COALESCE(NEW.hold_reason, ''), 200)),
      v_actor);

    IF NEW.commission_kobo + v_delivery > 0 THEN
      PERFORM public.mp_wallet_unwind(
        public.mp_wallet_ensure(), NEW.commission_kobo + v_delivery,
        'platform_fee_refund', 'settlement', NEW.id,
        'settlement:' || NEW.id::TEXT || ':cancel_platform',
        format('Commission and delivery reversed on order %s', v_order.order_number),
        jsonb_build_object('order_id', NEW.order_id,
                           'commission_kobo', NEW.commission_kobo,
                           'delivery_kobo', v_delivery),
        v_actor);
    END IF;
    RETURN NULL;
  END IF;

  -- ── Scheduled: the hold becomes withdrawable money. This is the only place
  --    vendor `available` grows from an order, so the figure the vendor dashboard
  --    shows and the figure mp_request_withdrawal will accept are the same number
  --    by construction. The key is derived from the settlement, not from the
  --    transition, because a rejected payout sends the settlement back to
  --    'scheduled' and the money must not be credited a second time.
  IF NEW.status = 'scheduled' AND OLD.status <> 'scheduled' THEN
    PERFORM public.mp_wallet_shift(
      v_wallet, 'pending', 'available', NEW.net_kobo, 'vendor_earning',
      'settlement', NEW.id,
      'settlement:' || NEW.id::TEXT || ':earning',
      format('Earnings from order %s', v_order.order_number),
      jsonb_build_object('gross_kobo', NEW.gross_kobo,
                         'commission_kobo', NEW.commission_kobo,
                         'net_kobo', NEW.net_kobo,
                         'order_id', NEW.order_id),
      v_actor);
  END IF;

  RETURN NULL;
END;
$$;

-- D4. Withdrawals: reserved when requested, settled when paid, released when refused.
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_from_withdrawal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet UUID;
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  v_wallet := public.mp_wallet_ensure(p_vendor_id => NEW.vendor_id);

  -- The promise is made: available -> pending, so the same money cannot be
  -- promised to a second payout.
  IF NEW.status = 'requested' THEN
    PERFORM public.mp_wallet_shift(
      v_wallet, 'available', 'pending', NEW.amount_kobo, 'payout_hold',
      'withdrawal', NEW.id,
      'withdrawal:' || NEW.id::TEXT || ':hold',
      'Reserved for bank payout',
      jsonb_build_object('amount_kobo', NEW.amount_kobo), v_actor);
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- The bank transfer actually happened: the money leaves the ledger.
    IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
      PERFORM public.mp_wallet_post(
        v_wallet, 'debit', 'pending', NEW.amount_kobo, 'payout_paid',
        'withdrawal', NEW.id,
        'withdrawal:' || NEW.id::TEXT || ':paid',
        'Payout sent to the bank',
        jsonb_build_object('amount_kobo', NEW.amount_kobo,
                           'reference', left(COALESCE(NEW.reference, ''), 120)),
        v_actor);
      RETURN NULL;
    END IF;

    -- The promise was broken: give the money back.
    IF NEW.status IN ('rejected', 'cancelled') AND OLD.status NOT IN ('rejected', 'cancelled') THEN
      PERFORM public.mp_wallet_shift(
        v_wallet, 'pending', 'available', NEW.amount_kobo, 'payout_reversed',
        'withdrawal', NEW.id,
        'withdrawal:' || NEW.id::TEXT || ':reversed',
        'Payout cancelled; funds released',
        jsonb_build_object('amount_kobo', NEW.amount_kobo,
                           'reason', left(COALESCE(NEW.failure_reason, NEW.reviewer_note, ''), 200)),
        v_actor);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- D5. Refunds reach the buyer, to the kobo.
--
-- The buyer's credit is keyed on the payment rather than the escrow because
-- mp_sync_escrow_from_payment flips the escrow to 'refunded' on the FIRST
-- partial refund, which would credit the full captured amount for a fraction of
-- it. refunded_kobo carries the exact figure and only ever moves upward, so the
-- delta is the honest amount and each refund gets its own entry.
CREATE OR REPLACE FUNCTION public.mp_sync_wallet_from_payment_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delta BIGINT;
  v_wallet UUID;
  v_order_number TEXT;
BEGIN
  v_delta := COALESCE(NEW.refunded_kobo, 0) - COALESCE(OLD.refunded_kobo, 0);
  IF v_delta <= 0 THEN
    RETURN NULL;
  END IF;

  IF NEW.buyer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.order_number INTO v_order_number
    FROM public.marketplace_orders o WHERE o.id = NEW.order_id;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => NEW.buyer_id);

  PERFORM public.mp_wallet_post(
    v_wallet, 'credit', 'available', v_delta, 'refund_credit',
    'payment', NEW.id,
    'payment:' || NEW.id::TEXT || ':refund:' || NEW.refunded_kobo::TEXT,
    format('Refund for order %s', COALESCE(v_order_number, NEW.order_id::TEXT)),
    jsonb_build_object('order_id', NEW.order_id, 'refund_kobo', v_delta,
                       'payment_status', NEW.status),
    auth.uid());

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mp_wallet_on_escrow_funded ON public.marketplace_escrows;
CREATE TRIGGER mp_wallet_on_escrow_funded
  AFTER INSERT ON public.marketplace_escrows
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_wallet_on_escrow_funded();

DROP TRIGGER IF EXISTS mp_wallet_on_escrow_unwound ON public.marketplace_escrows;
CREATE TRIGGER mp_wallet_on_escrow_unwound
  AFTER UPDATE ON public.marketplace_escrows
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_wallet_on_escrow_unwound();

DROP TRIGGER IF EXISTS mp_wallet_from_settlement ON public.marketplace_settlements;
CREATE TRIGGER mp_wallet_from_settlement
  AFTER UPDATE ON public.marketplace_settlements
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_wallet_from_settlement();

DROP TRIGGER IF EXISTS mp_wallet_from_withdrawal ON public.marketplace_withdrawals;
CREATE TRIGGER mp_wallet_from_withdrawal
  AFTER INSERT OR UPDATE ON public.marketplace_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_wallet_from_withdrawal();

DROP TRIGGER IF EXISTS mp_wallet_from_payment_refund ON public.marketplace_payments;
CREATE TRIGGER mp_wallet_from_payment_refund
  AFTER UPDATE ON public.marketplace_payments
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_wallet_from_payment_refund();

CREATE OR REPLACE FUNCTION public.mp_wallets_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mp_wallets_touch ON public.marketplace_wallets;
CREATE TRIGGER mp_wallets_touch BEFORE UPDATE ON public.marketplace_wallets
  FOR EACH ROW EXECUTE FUNCTION public.mp_wallets_touch();

-- =============================================================================
-- E. READ API (client-callable, read-only, ownership-checked)
-- =============================================================================
-- None of these creates a wallet. A balance appears the moment money moves, and
-- until then this reports zero. Keeping reads side-effect free means a dashboard
-- refresh can never write.

-- A balance sheet for the caller. p_user_id may only name somebody else for a
-- finance or moderation permission; otherwise it is silently the caller.
CREATE OR REPLACE FUNCTION public.mp_wallet_get(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_target UUID;
  v_vendor UUID;
  v_row public.marketplace_wallets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view a wallet' USING ERRCODE = '28000';
  END IF;

  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    v_target := v_uid;
  ELSIF public.mp_has_perm('manage_payments') OR public.mp_is_admin(v_uid) THEN
    v_target := p_user_id;
  ELSE
    RAISE EXCEPTION 'You can only view your own wallet' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.marketplace_wallets WHERE owner_user_id = v_target;

  SELECT v.id INTO v_vendor FROM public.marketplace_vendors v
   WHERE v.owner_id = v_target AND v.deleted_at IS NULL LIMIT 1;

  RETURN jsonb_build_object(
    'wallet_id',      v_row.id,
    'owner_user_id',  v_target,
    'vendor_id',      COALESCE(v_row.vendor_id, v_vendor),
    'is_vendor',      COALESCE(v_row.vendor_id, v_vendor) IS NOT NULL,
    'currency',       COALESCE(v_row.currency, 'NGN'),
    'available_kobo', COALESCE(v_row.available_kobo, 0),
    'pending_kobo',   COALESCE(v_row.pending_kobo, 0),
    'total_kobo',     COALESCE(v_row.available_kobo, 0) + COALESCE(v_row.pending_kobo, 0),
    'lifetime_credit_kobo', COALESCE(v_row.lifetime_credit_kobo, 0),
    'lifetime_debit_kobo',  COALESCE(v_row.lifetime_debit_kobo, 0),
    'is_frozen',      COALESCE(v_row.is_frozen, FALSE),
    'frozen_reason',  v_row.frozen_reason
  );
END;
$$;

-- The platform's own revenue balance. Finance and marketplace admins only.
CREATE OR REPLACE FUNCTION public.mp_wallet_platform_totals()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.marketplace_wallets%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL
     OR NOT (public.mp_has_perm('manage_payments') OR public.mp_is_admin(v_uid)) THEN
    RAISE EXCEPTION 'Only marketplace finance staff may view platform revenue'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.marketplace_wallets
   WHERE owner_user_id IS NULL AND vendor_id IS NULL;

  RETURN jsonb_build_object(
    'currency', COALESCE(v_row.currency, 'NGN'),
    'available_kobo', COALESCE(v_row.available_kobo, 0),
    'pending_kobo',   COALESCE(v_row.pending_kobo, 0),
    'lifetime_credit_kobo', COALESCE(v_row.lifetime_credit_kobo, 0),
    'lifetime_debit_kobo',  COALESCE(v_row.lifetime_debit_kobo, 0)
  );
END;
$$;

-- A paginated statement. Own ledger only, unless finance.
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
      SELECT e.id, e.direction, e.bucket, e.amount_kobo, e.balance_after,
             e.entry_type, e.status, e.reference_type, e.reference_id,
             e.description, e.metadata, e.created_at
        FROM public.marketplace_ledger_entries e
       WHERE e.wallet_id = v_wallet
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
       OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) s;

  RETURN jsonb_build_object('entries', v_rows, 'total', v_total, 'wallet_id', v_wallet);
END;
$$;

-- Aggregates for the vendor dashboard, so no figure on that screen is hand-summed.
CREATE OR REPLACE FUNCTION public.mp_vendor_wallet_summary(p_vendor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_vendor UUID;
  v_owner UUID;
  v_wallet UUID;
  v_available BIGINT := 0;
  v_pending BIGINT := 0;
  v_currency TEXT := 'NGN';
  v_earned BIGINT := 0;
  v_paid BIGINT := 0;
  v_adverts BIGINT := 0;
BEGIN
  IF p_vendor_id IS NULL THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Sign in to view earnings' USING ERRCODE = '28000';
    END IF;
    SELECT v.id INTO v_vendor FROM public.marketplace_vendors v
     WHERE v.owner_id = v_uid AND v.deleted_at IS NULL LIMIT 1;
    IF v_vendor IS NULL THEN
      RAISE EXCEPTION 'You do not have a storefront' USING ERRCODE = 'P0002';
    END IF;
    SELECT v.owner_id INTO v_owner FROM public.marketplace_vendors v WHERE v.id = v_vendor;
  ELSE
    v_vendor := p_vendor_id;
    SELECT v.owner_id INTO v_owner FROM public.marketplace_vendors v WHERE v.id = v_vendor;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Storefront not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_owner IS DISTINCT FROM v_uid
       AND NOT (public.mp_has_perm('manage_withdrawals') OR public.mp_is_admin(v_uid)) THEN
      RAISE EXCEPTION 'You can only view your own earnings' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- One wallet per person, so the storefront row and its owner resolve to the
  -- same account. vendor_id is matched too, because a wallet can have been
  -- created before the storefront existed.
  SELECT w.id, w.available_kobo, w.pending_kobo, w.currency
    INTO v_wallet, v_available, v_pending, v_currency
    FROM public.marketplace_wallets w
   WHERE w.vendor_id = v_vendor OR w.owner_user_id = v_owner
   ORDER BY (w.owner_user_id = v_owner) DESC
   LIMIT 1;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object(
      'vendor_id', v_vendor, 'wallet_id', NULL, 'currency', 'NGN',
      'available_kobo', 0, 'pending_kobo', 0,
      'lifetime_earned_kobo', 0, 'lifetime_paid_out_kobo', 0, 'advert_spend_kobo', 0);
  END IF;

  -- Lifetime throughput is netted, not gross: a shift writes a debit and a
  -- credit, so counting every entry would report the same kobo twice.
  SELECT COALESCE(sum(e.amount_kobo), 0) INTO v_earned
    FROM public.marketplace_ledger_entries e
   WHERE e.wallet_id = v_wallet AND e.entry_type = 'vendor_earning'
     AND e.direction = 'credit' AND e.bucket = 'available';

  SELECT COALESCE(sum(e.amount_kobo), 0) INTO v_paid
    FROM public.marketplace_ledger_entries e
   WHERE e.wallet_id = v_wallet AND e.entry_type = 'payout_paid';

  SELECT COALESCE(sum(e.amount_kobo), 0) INTO v_adverts
    FROM public.marketplace_ledger_entries e
   WHERE e.wallet_id = v_wallet AND e.entry_type = 'advert_spend';

  RETURN jsonb_build_object(
    'vendor_id', v_vendor,
    'wallet_id', v_wallet,
    'currency', COALESCE(v_currency, 'NGN'),
    'available_kobo', COALESCE(v_available, 0),
    'pending_kobo',   COALESCE(v_pending, 0),
    'lifetime_earned_kobo', v_earned,
    'lifetime_paid_out_kobo', v_paid,
    'advert_spend_kobo', v_adverts
  );
END;
$$;

-- =============================================================================
-- F. WALLET AS A PAYMENT METHOD
-- =============================================================================
-- A refund lands in the buyer's available balance. Without a way to spend it, the
-- wallet is a receipt rather than an account. This is the ONLY client-callable
-- path that debits a wallet, and it can only debit the caller's own wallet for
-- the caller's own order.
--
-- The capture is booked through mp_apply_payment_event(), the same entry point
-- the signed Paystack webhook uses. It is not reimplemented here, which means a
-- wallet payment gets the identical amount cross-check, currency cross-check,
-- replay protection, payment-event audit row, escrow trigger and
-- pending_payment -> paid transition that a card payment gets. Only the 'system'
-- row of the transition matrix allows that move, so no caller can reach it by
-- calling mp_transition_order() directly.

CREATE OR REPLACE FUNCTION public.mp_pay_order_from_wallet(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order public.marketplace_orders%ROWTYPE;
  v_payment public.marketplace_payments%ROWTYPE;
  v_wallet UUID;
  v_entry UUID;
  v_result JSONB;
  v_reference TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to pay for your order' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.buyer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can only pay for your own orders' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_payment FROM public.marketplace_payments
   WHERE id = v_order.payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This order has no payment record' USING ERRCODE = 'P0002';
  END IF;

  -- Already captured, by card or by wallet. Report success so a retry after a
  -- dropped response is not an error.
  IF v_payment.status = 'succeeded' OR v_order.status <> 'pending_payment' THEN
    RETURN jsonb_build_object(
      'paid', TRUE, 'already_settled', TRUE,
      'order_id', v_order.id, 'status', v_order.status,
      'payment_status', v_payment.status);
  END IF;

  -- The stored amount is the authority and mp_apply_payment_event will enforce
  -- it again against the order total; this is the early, friendly version.
  IF v_payment.amount_kobo <= 0 OR v_payment.amount_kobo <> v_order.total_kobo THEN
    RAISE EXCEPTION 'This order has nothing to pay' USING ERRCODE = '23514';
  END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_uid);

  -- Debit first. If anything below fails the whole transaction unwinds, so the
  -- buyer is never charged for an unpaid order.
  v_entry := public.mp_wallet_post(
    v_wallet, 'debit', 'available', v_payment.amount_kobo, 'wallet_payment',
    'order', v_order.id,
    'order:' || v_order.id::TEXT || ':wallet_payment',
    format('Paid for order %s from your wallet', v_order.order_number),
    jsonb_build_object('order_id', v_order.id, 'total_kobo', v_order.total_kobo,
                       'payment_id', v_payment.id),
    v_uid);

  -- Label the payment before the capture lands so the escrow it creates records
  -- provider = 'wallet' rather than inheriting whatever was there before.
  v_reference := COALESCE(v_payment.provider_reference,
                           'wallet_' || left(v_entry::TEXT, 18));

  UPDATE public.marketplace_payments
     SET provider = 'wallet'::public.marketplace_payment_provider,
         channel = 'wallet'::public.marketplace_payment_channel,
         provider_reference = v_reference,
         updated_at = now()
   WHERE id = v_payment.id;

  v_result := public.mp_apply_payment_event(
    'wallet_' || v_entry::TEXT,          -- provider_event_id, replay-protected
    'wallet_payment_succeeded',
    v_payment.id,
    v_reference,
    v_payment.amount_kobo,
    'NGN',
    'wallet'::public.marketplace_payment_channel,
    'succeeded'::public.marketplace_payment_status,
    jsonb_build_object('method', 'wallet', 'wallet_entry_id', v_entry,
                       'paid_by', v_uid, 'paid_at', now()));

  IF NOT (COALESCE((v_result ->> 'applied')::BOOLEAN, FALSE)
          OR COALESCE((v_result ->> 'duplicate')::BOOLEAN, FALSE)) THEN
    RAISE EXCEPTION 'The wallet payment could not be applied: %',
      COALESCE(v_result ->> 'reason', 'the order was not in a payable state')
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'paid', TRUE,
    'already_settled', NOT COALESCE((v_result ->> 'applied')::BOOLEAN, FALSE),
    'order_id', v_order.id,
    'payment_id', v_payment.id,
    'amount_kobo', v_payment.amount_kobo,
    'balance_after_kobo',
      (SELECT available_kobo FROM public.marketplace_wallets WHERE id = v_wallet),
    'ledger_entry_id', v_entry
  );
END;
$$;

COMMENT ON FUNCTION public.mp_pay_order_from_wallet(UUID) IS
  'Pays one of the callers own orders from their own wallet balance. The only client-callable wallet debit.';

-- =============================================================================
-- G. RLS + GRANTS
-- =============================================================================

ALTER TABLE public.marketplace_wallets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mp_wallets_select_own ON public.marketplace_wallets;
CREATE POLICY mp_wallets_select_own ON public.marketplace_wallets
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS mp_wallets_select_finance ON public.marketplace_wallets;
CREATE POLICY mp_wallets_select_finance ON public.marketplace_wallets
  FOR SELECT TO authenticated
  USING (public.mp_has_perm('manage_payments')
         OR public.mp_has_perm('manage_withdrawals')
         OR public.mp_is_admin(auth.uid()));

DROP POLICY IF EXISTS mp_wallet_entries_select_own ON public.marketplace_ledger_entries;
CREATE POLICY mp_wallet_entries_select_own ON public.marketplace_ledger_entries
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_wallets w
                  WHERE w.id = marketplace_ledger_entries.wallet_id
                    AND w.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS mp_wallet_entries_select_finance ON public.marketplace_ledger_entries;
CREATE POLICY mp_wallet_entries_select_finance ON public.marketplace_ledger_entries
  FOR SELECT TO authenticated
  USING (public.mp_has_perm('manage_payments')
         OR public.mp_has_perm('manage_withdrawals')
         OR public.mp_is_admin(auth.uid()));

GRANT SELECT ON public.marketplace_wallets, public.marketplace_ledger_entries TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_wallets, public.marketplace_ledger_entries
  FROM PUBLIC, anon, authenticated;

-- Internal writers: never reachable from a client.
REVOKE EXECUTE ON FUNCTION public.mp_wallet_ensure(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_wallet_post(UUID, public.marketplace_ledger_direction,
  public.marketplace_wallet_bucket, BIGINT, public.marketplace_ledger_entry_type,
  TEXT, UUID, TEXT, TEXT, JSONB, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_wallet_shift(UUID, public.marketplace_wallet_bucket,
  public.marketplace_wallet_bucket, BIGINT, public.marketplace_ledger_entry_type,
  TEXT, UUID, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_wallet_unwind(UUID, BIGINT,
  public.marketplace_ledger_entry_type, TEXT, UUID, TEXT, TEXT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_platform_share(public.marketplace_orders)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_wallet_on_escrow_funded()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_wallet_on_escrow_unwound() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_wallet_from_settlement()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_wallet_from_withdrawal()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_sync_wallet_from_payment_refund() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_wallets_touch() FROM PUBLIC, anon, authenticated;

-- Client-callable reads, plus the one guarded wallet payment.
GRANT EXECUTE ON FUNCTION public.mp_wallet_get(UUID)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_wallet_statement(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_vendor_wallet_summary(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_wallet_platform_totals()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_pay_order_from_wallet(UUID)       TO authenticated;

-- =============================================================================
-- H. SEED THE PLATFORM WALLET
-- =============================================================================
SELECT public.mp_wallet_ensure();

COMMIT;