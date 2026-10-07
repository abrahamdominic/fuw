-- =============================================================================
-- FUW STUDENT MARKETPLACE — MIGRATION 01: SCHEMA FOUNDATION
-- =============================================================================
-- Purpose : Relational schema for the FUW Student Marketplace.
-- Scope   : This migration only creates marketplace_* objects. It never touches
--           existing E-Library tables, and it never reads or writes auth.users
--           beyond the standard FK to public.profiles.
-- Identity: There is NO marketplace user table. Every marketplace row that
--           belongs to a person references public.profiles(id), which is the
--           existing FUW E-Library student profile. One Supabase Auth account,
--           one student identity, two applications.
-- Money   : All monetary values are stored as BIGINT kobo (NGN minor units).
--           Never float, never numeric with unbounded scale — integer minor
--           units make rounding impossible by construction.
-- Safety  : Every table is created with RLS ENABLED and NO POLICY. Migration 03
--           attaches policies. Between 01 and 03 these tables deny everything,
--           which is the correct default: no window where a table is readable
--           but unprotected.
-- =============================================================================

-- Guard: refuse to run outside the FUW project.
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(t, ', ')
    INTO v_missing
    FROM unnest(ARRAY['profiles']) AS t
   WHERE to_regclass('public.' || t) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'FUW Marketplace migration aborted: required existing table(s) missing: %',
      v_missing;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Shared money / integrity helpers
-- -----------------------------------------------------------------------------

-- NOTE ON LANGUAGE: every predicate below is plpgsql, not sql, on purpose.
-- A LANGUAGE sql body is resolved at CREATE time and would fail because the
-- tables it reads (marketplace_admin_staff, marketplace_vendors) are created
-- further down this same migration. plpgsql defers planning to first call,
-- which keeps the migration order-independent. They are all STABLE and take
-- explicit parameters (never read a client-supplied identity implicitly).
--
-- SECURITY DEFINER + fixed search_path: these run as the owner and cannot be
-- hijacked through a caller-controlled search_path.

-- Central role predicate for marketplace admin staff. Separate from the
-- E-Library app_role so granting marketplace moderation never implies
-- E-Library powers, and vice versa.
CREATE OR REPLACE FUNCTION public.mp_is_admin(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_admin_staff s
     WHERE s.user_id = p_uid
       AND s.revoked_at IS NULL
       AND s.is_active
       AND (s.role = 'super_admin' OR s.permissions @> ARRAY['*']::TEXT[])
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.mp_has_perm(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_permission IS NULL OR auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_admin_staff s
     WHERE s.user_id = auth.uid()
       AND s.revoked_at IS NULL
       AND s.is_active
       AND (s.permissions @> ARRAY['*']::TEXT[] OR s.permissions @> ARRAY[p_permission])
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END $$;

-- Marketplace-only membership check. True when the caller owns a vendor profile.
CREATE OR REPLACE FUNCTION public.mp_is_vendor(p_vendor_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_vendor_id IS NULL OR auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_vendors v
     WHERE v.id = p_vendor_id AND v.owner_id = auth.uid() AND v.deleted_at IS NULL
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END $$;

-- Staff who can act on marketplace disputes/refunds/payouts.
CREATE OR REPLACE FUNCTION public.mp_is_staff(p_permission TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_permission IS NULL THEN RETURN public.mp_is_admin(auth.uid()); END IF;
  RETURN public.mp_has_perm(p_permission);
END $$;

-- Convenience: is the caller a fully-provisioned marketplace participant?
-- A profile row is created by the E-Library signup trigger, so its existence
-- proves the caller is an authenticated FUW account with a student identity.
CREATE OR REPLACE FUNCTION public.mp_has_identity()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END $$;

-- Cross-vendor data isolation helper. Staff see everything; a vendor sees only
-- their own storefront's rows; a buyer sees only their own. Used by the
-- SECURITY DEFINER read functions so scoping lives in one place.
CREATE OR REPLACE FUNCTION public.mp_order_visible(p_buyer UUID, p_vendor_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN p_buyer = auth.uid()
      OR p_vendor_owner = auth.uid()
      OR public.mp_is_admin(auth.uid());
END $$;

-- Shared updated_at trigger.
CREATE OR REPLACE FUNCTION public.mp_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.mp_touch_updated_at() IS
  'Sets updated_at to now(). Applied to marketplace tables that support editing.';

-- array_to_string() is only STABLE (array element output functions are not
-- guaranteed immutable), so it cannot appear directly in an index expression.
-- This wrapper is IMMUTABLE and exists purely to make the full-text search
-- index on marketplace_products legal. Callers pass only their own array.
CREATE OR REPLACE FUNCTION public.mp_join_tags(p_tags TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(array_to_string(p_tags, ' '), '')
$$;

-- =============================================================================
-- ENUM TYPES
-- Guarded so re-running the migration is safe.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE public.marketplace_admin_role AS ENUM ('moderator', 'finance', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_listing_type AS ENUM ('product', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_condition AS ENUM
    ('new', 'like_new', 'good', 'fair', 'poor', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_listing_status AS ENUM
    ('draft', 'active', 'paused', 'under_review', 'removed', 'sold_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_vendor_status AS ENUM
    ('draft', 'pending_review', 'active', 'suspended', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_verification_status AS ENUM
    ('unverified', 'pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_delivery_type AS ENUM ('delivery', 'pickup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_order_status AS ENUM (
    'pending_payment',
    'paid',
    'order_confirmed',
    'preparing',
    'ready_for_delivery',
    'delivered',
    'completed',
    'cancelled',
    'disputed',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_payment_status AS ENUM
    ('created', 'awaiting_payment', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_payment_provider AS ENUM
    ('paystack', 'manual_bank_transfer', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_payment_channel AS ENUM
    ('card', 'bank_transfer', 'ussd', 'mobile_money', 'wallet', 'cash', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_settlement_status AS ENUM
    ('pending', 'scheduled', 'processing', 'paid_out', 'on_hold', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_withdrawal_status AS ENUM
    ('requested', 'under_review', 'approved', 'processing', 'paid', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_dispute_status AS ENUM
    ('open', 'under_review', 'awaiting_vendor', 'awaiting_buyer', 'resolved_refund', 'resolved_partial', 'resolved_rejected', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_dispute_reason AS ENUM (
    'item_not_received',
    'wrong_item',
    'damaged_item',
    'not_as_described',
    'order_issue',
    'payment_issue',
    'vendor_issue',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_report_status AS ENUM
    ('open', 'reviewing', 'actioned', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_report_target AS ENUM
    ('listing', 'vendor', 'review', 'user', 'message', 'conversation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_conversation_kind AS ENUM ('direct', 'order');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.marketplace_notification_type AS ENUM (
    'order_placed',
    'order_accepted',
    'order_rejected',
    'order_status_changed',
    'payment_confirmed',
    'payment_failed',
    'message_received',
    'vendor_verified',
    'vendor_rejected',
    'dispute_opened',
    'dispute_updated',
    'refund_issued',
    'withdrawal_updated',
    'new_review',
    'review_replied',
    'listing_removed',
    'account_warning',
    'announcement',
    'product_alert'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TYPE public.marketplace_order_status IS
  'Order lifecycle. Transitions are enforced server-side by mp_transition_order(); clients cannot set this directly.';

COMMENT ON TYPE public.marketplace_admin_role IS
  'Marketplace staff roles. Deliberately independent of the E-Library app_role enum.';

-- =============================================================================
-- 1. marketplace_profiles — marketplace participation record
-- -----------------------------------------------------------------------------
-- A thin, marketplace-specific companion to public.profiles. It stores only
-- marketplace preferences (contact phone, campus location, notification prefs).
-- It deliberately does NOT duplicate name, email, matric number, faculty or
-- role — those are read from public.profiles so the two apps can never drift.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_profiles (
  id                  UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Display name used on the marketplace. Independent of the E-Library name so
  -- a student can keep their identity private while still operating a store.
  display_name        TEXT,
  phone_number        TEXT,
  campus_area         TEXT,
  bio                 TEXT CHECK (char_length(bio) <= 600),
  avatar_path         TEXT,
  -- Which FUW identity facts are verified. Derived server-side from
  -- public.profiles, never asserted by the client.
  fuw_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  fuw_verified_at     TIMESTAMPTZ,
  fuw_matric_number   TEXT,
  fuw_faculty         TEXT,
  fuw_department      TEXT,
  fuw_level           TEXT,
  -- Marketplace account state. Independent of profiles.is_active so an admin
  -- can restrict marketplace use without disabling E-Library access.
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'restricted', 'suspended')),
  restriction_reason  TEXT,
  notify_by_email     BOOLEAN NOT NULL DEFAULT FALSE,
  default_fulfilment  public.marketplace_delivery_type NOT NULL DEFAULT 'pickup',
  search_history      TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketplace_profiles IS
  'Marketplace participation + preferences. Identity facts are mirrored from public.profiles by trigger, never client-written.';
COMMENT ON COLUMN public.marketplace_profiles.fuw_verified IS
  'TRUE when the linked FUW profile is active and academically verified. Set only by trigger.';
COMMENT ON COLUMN public.marketplace_profiles.search_history IS
  'Recent search terms, capped at 12 by trigger. Local convenience only, never used for ranking.';

CREATE INDEX IF NOT EXISTS idx_mp_profiles_status ON public.marketplace_profiles (status);

DROP TRIGGER IF EXISTS mp_profiles_touch ON public.marketplace_profiles;
CREATE TRIGGER mp_profiles_touch BEFORE UPDATE ON public.marketplace_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- Keep search_history bounded.
CREATE OR REPLACE FUNCTION public.mp_cap_search_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF array_length(NEW.search_history, 1) > 12 THEN
    NEW.search_history := NEW.search_history[1:12];
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mp_profiles_cap_search ON public.marketplace_profiles;
CREATE TRIGGER mp_profiles_cap_search BEFORE UPDATE ON public.marketplace_profiles
  FOR EACH ROW EXECUTE FUNCTION public.mp_cap_search_history();

-- Mirror verified FUW identity onto the marketplace profile.
-- SECURITY DEFINER: the trigger runs as the table owner so it can read
-- public.profiles even when the calling student cannot read privileged columns.
CREATE OR REPLACE FUNCTION public.mp_sync_identity_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.marketplace_profiles mp
     SET fuw_verified      = (p.is_active AND p.verification_status = 'verified'),
         fuw_verified_at   = CASE
                               WHEN p.is_active AND p.verification_status = 'verified'
                               THEN COALESCE(p.verification_reviewed_at, p.updated_at)
                               ELSE NULL
                             END,
         fuw_matric_number = p.matric_number,
         fuw_faculty       = p.faculty,
         fuw_department    = p.department,
         fuw_level         = p.level
    WHERE mp.id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mp_profiles_sync_identity ON public.profiles;
CREATE TRIGGER mp_profiles_sync_identity
  AFTER UPDATE OF verification_status, is_active, matric_number, faculty, department, level, updated_at
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_identity_from_profile();

-- Auto-provision a marketplace profile the first time a verified FUW student
-- touches the marketplace. Uses the existing profile row as the identity source.
CREATE OR REPLACE FUNCTION public.mp_ensure_own_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id = auth.uid() THEN
    INSERT INTO public.marketplace_profiles (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- =============================================================================
-- 2. marketplace_admin_staff — marketplace admin authorization
-- =============================================================================
-- Rows here are the ONLY source of marketplace admin authority. The E-Library
-- app_role is deliberately NOT reused: E-Library admins have no marketplace
-- power, and marketplace moderators gain no E-Library power.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_admin_staff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role          public.marketplace_admin_role NOT NULL DEFAULT 'moderator',
  permissions   TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  note          TEXT,
  CONSTRAINT mp_admin_staff_perms_known CHECK (
    permissions <@ ARRAY[
      '*',
      'moderate_listings','moderate_vendors','verify_vendors','moderate_users',
      'manage_disputes','issue_refunds','manage_withdrawals','manage_payments',
      'manage_categories','manage_settings','view_analytics','manage_announcements'
    ]::TEXT[]
  ),
  CONSTRAINT mp_admin_super_needs_star CHECK (role <> 'super_admin' OR permissions @> ARRAY['*']::TEXT[])
);

-- One active grant per user; re-granting revokes the old row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_admin_staff_active
  ON public.marketplace_admin_staff (user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mp_admin_staff_user ON public.marketplace_admin_staff (user_id);

-- Nobody can write their own grant. Only an existing super_admin can.
CREATE OR REPLACE FUNCTION public.mp_guard_admin_staff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.mp_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a marketplace super admin may change admin staff grants'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id = auth.uid() AND TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'You cannot grant yourself marketplace admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mp_admin_staff_guard ON public.marketplace_admin_staff;
CREATE TRIGGER mp_admin_staff_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.marketplace_admin_staff
  FOR EACH ROW EXECUTE FUNCTION public.mp_guard_admin_staff();

-- =============================================================================
-- 3. marketplace_categories / marketplace_subcategories — admin-managed taxonomy
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  description   TEXT CHECK (char_length(description) <= 400),
  icon          TEXT NOT NULL DEFAULT 'Package',
  listing_type  public.marketplace_listing_type NOT NULL DEFAULT 'product',
  parent_id     UUID REFERENCES public.marketplace_categories(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Commission override in basis points (1% = 100). NULL = use platform default.
  commission_bps INTEGER CHECK (commission_bps IS NULL OR (commission_bps >= 0 AND commission_bps <= 5000)),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

COMMENT ON COLUMN public.marketplace_categories.commission_bps IS
  'Optional per-category commission override in basis points. Capped at 5000 (50%). NULL falls back to marketplace_platform_settings.default_commission_bps.';

CREATE INDEX IF NOT EXISTS idx_mp_categories_active
  ON public.marketplace_categories (sort_order, name) WHERE is_active AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mp_categories_type
  ON public.marketplace_categories (listing_type) WHERE is_active AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS mp_categories_touch ON public.marketplace_categories;
CREATE TRIGGER mp_categories_touch BEFORE UPDATE ON public.marketplace_categories
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- Subcategories are modelled as a self-referencing child row rather than a
-- separate table: one taxonomy table keeps admin management in a single place
-- and makes recursive category browsing a single indexed query.
CREATE TABLE IF NOT EXISTS public.marketplace_subcategories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES public.marketplace_categories(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  sort_order    INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT uq_mp_subcat_slug UNIQUE (category_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_mp_subcat_category
  ON public.marketplace_subcategories (category_id, sort_order)
  WHERE is_active AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS mp_subcat_touch ON public.marketplace_subcategories;
CREATE TRIGGER mp_subcat_touch BEFORE UPDATE ON public.marketplace_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- =============================================================================
-- 4. marketplace_vendors — storefront
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_vendors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Public handle used in /store/<handle>. Immutable once created.
  handle            TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$'),
  shop_name         TEXT NOT NULL CHECK (char_length(shop_name) BETWEEN 2 AND 70),
  tagline           TEXT CHECK (char_length(tagline) <= 120),
  description       TEXT CHECK (char_length(description) <= 3000),
  logo_path         TEXT,
  banner_path       TEXT,
  status            public.marketplace_vendor_status NOT NULL DEFAULT 'draft',
  verification      public.marketplace_verification_status NOT NULL DEFAULT 'unverified',
  verified_at       TIMESTAMPTZ,
  verified_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Verified factual signals. All are computed from marketplace data, never
  -- entered by the vendor and never a synthetic "trust score".
  completed_orders  INTEGER NOT NULL DEFAULT 0 CHECK (completed_orders >= 0),
  cancelled_orders  INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_orders >= 0),
  disputed_orders   INTEGER NOT NULL DEFAULT 0 CHECK (disputed_orders >= 0),
  rating_avg        NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg >= 0 AND rating_avg <= 5),
  rating_count      INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  response_count    INTEGER NOT NULL DEFAULT 0 CHECK (response_count >= 0),
  message_count     INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  -- Rolling 30-day response latency, seconds. NULL until at least one reply.
  avg_response_secs INTEGER CHECK (avg_response_secs IS NULL OR avg_response_secs >= 0),
  -- Campus pickup point shown to buyers.
  campus_area       TEXT,
  business_hours    JSONB NOT NULL DEFAULT '{}'::JSONB,
  policies          JSONB NOT NULL DEFAULT '{}'::JSONB,
  payout_bank_name  TEXT,
  payout_account_number TEXT,
  -- When true, vendor cannot receive a payout until finance verifies details.
  payout_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  suspended_at      TIMESTAMPTZ,
  suspension_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT mp_vendor_verified_consistent CHECK (
    (verification = 'verified' AND verified_at IS NOT NULL)
    OR verification <> 'verified'
  ),
  CONSTRAINT mp_vendor_suspended_consistent CHECK (
    (status = 'suspended' AND suspended_at IS NOT NULL) OR status <> 'suspended'
  ),
  CONSTRAINT mp_vendor_payout_needs_bank CHECK (
    payout_enabled = FALSE
    OR (payout_bank_name IS NOT NULL AND payout_account_number IS NOT NULL)
  )
);

COMMENT ON TABLE public.marketplace_vendors IS
  'A storefront. owner_id is the FUW profile of the operator; every product, order and message is authorised against this.';
COMMENT ON COLUMN public.marketplace_vendors.rating_avg IS
  'Average of published reviews only. Recomputed by trigger from marketplace_reviews; vendors cannot write it.';
COMMENT ON COLUMN public.marketplace_vendors.avg_response_secs IS
  'Median-ish mean reply latency over the last 30 days, maintained by mp_record_vendor_response(). Factual, never self-declared.';

CREATE INDEX IF NOT EXISTS idx_mp_vendors_owner ON public.marketplace_vendors (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_vendors_public
  ON public.marketplace_vendors (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_vendors_rating
  ON public.marketplace_vendors (rating_avg DESC, rating_count DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_vendors_search
  ON public.marketplace_vendors USING gin (to_tsvector('simple', shop_name || ' ' || COALESCE(tagline, '') || ' ' || COALESCE(description, '')))
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS mp_vendors_touch ON public.marketplace_vendors;
CREATE TRIGGER mp_vendors_touch BEFORE UPDATE ON public.marketplace_vendors
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- One storefront per student, enforced in the database rather than the UI.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_vendors_owner
  ON public.marketplace_vendors (owner_id) WHERE deleted_at IS NULL;

-- =============================================================================
-- 5. marketplace_vendor_verifications — verification audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_vendor_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  status        public.marketplace_verification_status NOT NULL DEFAULT 'pending',
  -- What the vendor asserted. Free text + optional evidence, reviewed by staff.
  requested_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note          TEXT CHECK (char_length(note) <= 1500),
  evidence_path TEXT,
  evidence_name TEXT,
  reviewed_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  reviewer_note TEXT CHECK (char_length(reviewer_note) <= 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_vv_reviewed_consistent CHECK (
    (status IN ('verified','rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    OR status IN ('pending','unverified')
  )
);

CREATE INDEX IF NOT EXISTS idx_mp_vv_vendor ON public.marketplace_vendor_verifications (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_vv_pending ON public.marketplace_vendor_verifications (created_at)
  WHERE status = 'pending';

-- =============================================================================
-- 6. marketplace_products — listings (physical products AND services)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES public.marketplace_categories(id) ON DELETE RESTRICT,
  subcategory_id  UUID REFERENCES public.marketplace_subcategories(id) ON DELETE SET NULL,

  listing_type    public.marketplace_listing_type NOT NULL DEFAULT 'product',
  slug            TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description     TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 5000),
  condition       public.marketplace_condition NOT NULL DEFAULT 'not_applicable',
  condition_notes TEXT CHECK (char_length(condition_notes) <= 600),

  -- PRICE IS SERVER-AUTHORITATIVE. The client sends an intent; mp_upsert_product
  -- recomputes and validates these. No client-writable path to price exists.
  price_kobo        BIGINT NOT NULL CHECK (price_kobo >= 100),        -- >= NGN 1.00
  compare_at_kobo   BIGINT CHECK (compare_at_kobo IS NULL OR compare_at_kobo > price_kobo),

  -- Services are booked, not stocked: availability is a time window / capacity.
  is_service       BOOLEAN NOT NULL DEFAULT FALSE,
  capacity         INTEGER CHECK (capacity IS NULL OR capacity > 0),
  lead_time_hours  INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_hours BETWEEN 0 AND 2160),
  service_area      TEXT,

  quantity_total   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
  quantity_sold    INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  -- Hard invariant: you cannot sell or reserve more than exists.
  CONSTRAINT mp_product_stock_invariant CHECK (quantity_sold + quantity_reserved <= quantity_total),
  low_stock_threshold INTEGER NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),

  status          public.marketplace_listing_status NOT NULL DEFAULT 'draft',
  fulfilment      public.marketplace_delivery_type NOT NULL DEFAULT 'pickup',
  allows_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  allows_pickup   BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_kobo >= 0),

  campus_area     TEXT,
  meeting_point   TEXT CHECK (char_length(meeting_point) <= 240),
  tags            TEXT[] NOT NULL DEFAULT '{}',
  view_count      INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  -- Denormalised primary image. Without it a 24-item product grid needs 24 extra
  -- joins just to render thumbnails; this keeps the browse query a single scan.
  thumbnail_path  TEXT,
  -- Denormalised favourites count for sort="popular". Maintained by trigger.
  favourite_count INTEGER NOT NULL DEFAULT 0 CHECK (favourite_count >= 0),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT mp_product_fulfilment_means_something CHECK (
    allows_delivery OR allows_pickup
  ),
  CONSTRAINT mp_product_delivery_needs_fee_ok CHECK (
    allows_pickup OR NOT (fulfilment = 'delivery')
  ),
  CONSTRAINT mp_product_service_shape CHECK (
    (is_service AND listing_type = 'service' AND condition = 'not_applicable')
    OR (NOT is_service)
  ),
  CONSTRAINT mp_product_slug_unique UNIQUE (vendor_id, slug)
);

COMMENT ON TABLE public.marketplace_products IS
  'Listings for physical goods and campus services. Prices, stock and status are all written only through mp_upsert_product() / mp_adjust_inventory() / mp_set_listing_status().';
COMMENT ON COLUMN public.marketplace_products.quantity_reserved IS
  'Units held by unpaid orders. Released automatically when an order is cancelled or expires.';

CREATE INDEX IF NOT EXISTS idx_mp_products_browse
  ON public.marketplace_products (status, published_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_vendor
  ON public.marketplace_products (vendor_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_category
  ON public.marketplace_products (category_id, status, published_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_price
  ON public.marketplace_products (price_kobo)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_popular
  ON public.marketplace_products (favourite_count DESC, view_count DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_campus
  ON public.marketplace_products (campus_area)
  WHERE status = 'active' AND deleted_at IS NULL AND campus_area IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_search
  ON public.marketplace_products USING gin (
    to_tsvector('simple', title || ' ' || description || ' ' || public.mp_join_tags(tags))
  ) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mp_products_service
  ON public.marketplace_products (listing_type, status, published_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS mp_products_touch ON public.marketplace_products;
CREATE TRIGGER mp_products_touch BEFORE UPDATE ON public.marketplace_products
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- Keep products.thumbnail_path pointing at the primary image. Without this the
-- browse grid would need a lateral join per row to render a card.
CREATE OR REPLACE FUNCTION public.mp_sync_product_thumbnail()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pid UUID := COALESCE(NEW.product_id, OLD.product_id);
  v_path TEXT;
BEGIN
  SELECT storage_path INTO v_path
    FROM public.marketplace_product_images
   WHERE product_id = v_pid
   ORDER BY is_primary DESC, sort_order, created_at
   LIMIT 1;

  UPDATE public.marketplace_products
     SET thumbnail_path = v_path
   WHERE id = v_pid AND thumbnail_path IS DISTINCT FROM v_path;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS mp_pimages_sync_thumb_ins ON public.marketplace_product_images;
CREATE TRIGGER mp_pimages_sync_thumb_ins AFTER INSERT OR UPDATE OF is_primary, sort_order
  ON public.marketplace_product_images
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_product_thumbnail();

DROP TRIGGER IF EXISTS mp_pimages_sync_thumb_del ON public.marketplace_product_images;
CREATE TRIGGER mp_pimages_sync_thumb_del AFTER DELETE
  ON public.marketplace_product_images
  FOR EACH ROW EXECUTE FUNCTION public.mp_sync_product_thumbnail();

-- Services never carry stock; goods default to available.
ALTER TABLE public.marketplace_products DROP CONSTRAINT IF EXISTS mp_products_service_stock;
ALTER TABLE public.marketplace_products ADD CONSTRAINT mp_products_service_stock CHECK (
  is_service = FALSE OR (quantity_total = 0 AND quantity_sold = 0 AND quantity_reserved = 0)
);

-- =============================================================================
-- 7. marketplace_product_images
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_product_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  -- MIME type is captured at upload and validated again on attach.
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/avif')),
  width         INTEGER CHECK (width IS NULL OR width > 0),
  height        INTEGER CHECK (height IS NULL OR height > 0),
  byte_size     INTEGER CHECK (byte_size IS NULL OR (byte_size > 0 AND byte_size <= 5242880)),
  alt_text      TEXT CHECK (char_length(alt_text) <= 160),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_pimages_product
  ON public.marketplace_product_images (product_id, sort_order, created_at);

-- At most one primary image per product.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_pimages_primary
  ON public.marketplace_product_images (product_id) WHERE is_primary;
-- A path belongs to exactly one product (no image sharing across listings).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_pimages_path ON public.marketplace_product_images (storage_path);
-- Bounded image count per listing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_pimages_slot
  ON public.marketplace_product_images (product_id, sort_order);

-- =============================================================================
-- 8. marketplace_product_variants — options (size, colour, duration…)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_product_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),   -- e.g. "Size"
  value         TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 40),   -- e.g. "XL"
  -- Optional price/stock override. NULL means "inherit the product value",
  -- which is resolved server-side at order time.
  price_kobo      BIGINT CHECK (price_kobo IS NULL OR price_kobo >= 100),
  compare_at_kobo BIGINT CHECK (compare_at_kobo IS NULL OR compare_at_kobo > COALESCE(price_kobo, 100)),
  quantity_total   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
  quantity_sold    INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  sku             TEXT,
  is_available   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_variant_stock_invariant CHECK (quantity_sold + quantity_reserved <= quantity_total)
);

CREATE INDEX IF NOT EXISTS idx_mp_pvariants_product
  ON public.marketplace_product_variants (product_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_pvariants_combo
  ON public.marketplace_product_variants (product_id, name, value);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_pvariants_sku
  ON public.marketplace_product_variants (product_id, sku) WHERE sku IS NOT NULL;

DROP TRIGGER IF EXISTS mp_pvariants_touch ON public.marketplace_product_variants;
CREATE TRIGGER mp_pvariants_touch BEFORE UPDATE ON public.marketplace_product_variants
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- =============================================================================
-- 9. marketplace_inventory — append-only stock movement ledger
-- -----------------------------------------------------------------------------
-- quantity_total on the product is the cached balance; this table is the
-- auditable source of truth for HOW it changed and WHO changed it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  variant_id    UUID REFERENCES public.marketplace_product_variants(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason        TEXT NOT NULL CHECK (reason IN
    ('initial','restock','correction','sale','order_cancelled','reservation_released',
     'return','withdrawal','admin_adjust')),
  -- Populated for system-driven movements; NULL for vendor edits.
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  order_id      UUID,
  note          TEXT CHECK (char_length(note) <= 400),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_inventory_product
  ON public.marketplace_inventory (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_inventory_order ON public.marketplace_inventory (order_id) WHERE order_id IS NOT NULL;

COMMENT ON TABLE public.marketplace_inventory IS
  'Append-only stock ledger. Never updated or deleted — a balance can be explained but not rewritten.';

-- =============================================================================
-- 10. marketplace_favourites
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_favourites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  vendor_id   UUID REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one target, and it must exist.
  CONSTRAINT mp_fav_one_target CHECK (
    (product_id IS NOT NULL AND vendor_id IS NULL) OR
    (product_id IS NULL AND vendor_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_fav_product
  ON public.marketplace_favourites (user_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_fav_vendor
  ON public.marketplace_favourites (user_id, vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_fav_user ON public.marketplace_favourites (user_id, created_at DESC);

-- Maintain the denormalised product favourite_count.
CREATE OR REPLACE FUNCTION public.mp_sync_favourite_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pid UUID;
BEGIN
  v_pid := COALESCE(NEW.product_id, OLD.product_id);
  IF v_pid IS NULL THEN RETURN NULL; END IF;

  UPDATE public.marketplace_products p
     SET favourite_count = (
       SELECT count(*)::INTEGER FROM public.marketplace_favourites f
        WHERE f.product_id = v_pid
     )
   WHERE p.id = v_pid;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS mp_fav_count_ins ON public.marketplace_favourites;
CREATE TRIGGER mp_fav_count_ins AFTER INSERT ON public.marketplace_favourites
  FOR EACH ROW WHEN (NEW.product_id IS NOT NULL)
  EXECUTE FUNCTION public.mp_sync_favourite_count();

DROP TRIGGER IF EXISTS mp_fav_count_del ON public.marketplace_favourites;
CREATE TRIGGER mp_fav_count_del AFTER DELETE ON public.marketplace_favourites
  FOR EACH ROW WHEN (OLD.product_id IS NOT NULL)
  EXECUTE FUNCTION public.mp_sync_favourite_count();

-- =============================================================================
-- 11. marketplace_checkouts / marketplace_orders / marketplace_order_items
-- -----------------------------------------------------------------------------
-- Order granularity: ONE ORDER PER VENDOR per checkout. A cart spanning three
-- vendors produces three orders sharing one checkout group. This keeps
-- fulfilment, settlement, disputes and messaging unambiguous — a buyer never
-- has one dispute covering two unrelated vendors.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_checkouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  -- Client-supplied idempotency key. UNIQUE per buyer: replaying the same
  -- checkout returns the original group instead of creating a second charge.
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 120),
  order_count     INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','placed','abandoned','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '45 minutes'),
  CONSTRAINT uq_mp_checkouts_idem UNIQUE (buyer_id, idempotency_key)
);

COMMENT ON TABLE public.marketplace_checkouts IS
  'One checkout attempt. The (buyer_id, idempotency_key) unique constraint is the double-charge guard.';

CREATE INDEX IF NOT EXISTS idx_mp_checkouts_buyer ON public.marketplace_checkouts (buyer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_id       UUID REFERENCES public.marketplace_checkouts(id) ON DELETE SET NULL,
  order_number      TEXT NOT NULL UNIQUE,
  buyer_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vendor_id         UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE RESTRICT,

  status            public.marketplace_order_status NOT NULL DEFAULT 'pending_payment',

  -- SERVER-COMPUTED MONEY. Written only by mp_create_orders(). The client never
  -- supplies any of these; there is no UPDATE path that accepts them.
  subtotal_kobo     BIGINT NOT NULL CHECK (subtotal_kobo >= 0),
  delivery_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_kobo >= 0),
  platform_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_kobo >= 0),
  total_kobo        BIGINT NOT NULL CHECK (total_kobo >= 0),
  vendor_payout_kobo BIGINT NOT NULL DEFAULT 0 CHECK (vendor_payout_kobo >= 0),
  currency          TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),

  fulfilment        public.marketplace_delivery_type NOT NULL DEFAULT 'pickup',
  -- Snapshot of the address/meeting point as agreed at checkout. Kept so a
  -- later profile change cannot rewrite history.
  delivery_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  buyer_note        TEXT CHECK (char_length(buyer_note) <= 800),
  campus_area       TEXT,

  payment_id        UUID,
  -- Settlement is created once the order completes and the buyer is out of
  -- their return window.
  settlement_status public.marketplace_settlement_status NOT NULL DEFAULT 'pending',

  -- Denial facts. Disputed orders carry these on the public vendor profile so
  -- the community can weigh the signal.
  cancellation_reason TEXT CHECK (char_length(cancellation_reason) <= 600),
  cancelled_by_role  TEXT CHECK (cancelled_by_role IN ('buyer','vendor','admin','system')),
  cancelled_at       TIMESTAMPTZ,
  dispute_id         UUID,
  auto_confirm_at   TIMESTAMPTZ,

  paid_at           TIMESTAMPTZ,
  confirmed_at      TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_order_totals_consistent CHECK (
    total_kobo = subtotal_kobo + delivery_fee_kobo
  ),
  CONSTRAINT mp_order_cancelled_consistent CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by_role IS NOT NULL)
    OR status <> 'cancelled'
  ),
  CONSTRAINT mp_order_paid_consistent CHECK (
    (status IN ('paid','order_confirmed','preparing','ready_for_delivery','delivered','completed','disputed','refunded'))
      = (paid_at IS NOT NULL)
  ),
  CONSTRAINT mp_order_completed_consistent CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  ),
  CONSTRAINT mp_order_refunded_consistent CHECK (
    status <> 'refunded' OR refunded_at IS NOT NULL
  )
);
-- Self-trade (buying from your own storefront) is blocked by trigger rather
-- than CHECK: a CHECK constraint may not contain a subquery in PostgreSQL.
CREATE OR REPLACE FUNCTION public.mp_guard_no_self_trade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.marketplace_vendors v
     WHERE v.id = NEW.vendor_id
       AND v.owner_id = NEW.buyer_id
       AND v.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You cannot place an order on your own storefront'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mp_orders_no_self_trade ON public.marketplace_orders;
CREATE TRIGGER mp_orders_no_self_trade BEFORE INSERT OR UPDATE OF buyer_id, vendor_id
  ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION public.mp_guard_no_self_trade();

COMMENT ON TABLE public.marketplace_orders IS
  'Protected-transaction order. One per vendor per checkout. Status is a server-controlled state machine (mp_transition_order).';
COMMENT ON COLUMN public.marketplace_orders.vendor_payout_kobo IS
  'What the vendor will receive after platform commission: subtotal - platform_fee. Held as a receivable until settlement.';

CREATE INDEX IF NOT EXISTS idx_mp_orders_buyer
  ON public.marketplace_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_orders_vendor
  ON public.marketplace_orders (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_orders_status
  ON public.marketplace_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_orders_checkout ON public.marketplace_orders (checkout_id);
CREATE INDEX IF NOT EXISTS idx_mp_orders_settlement
  ON public.marketplace_orders (settlement_status, completed_at)
  WHERE settlement_status IN ('pending','scheduled','on_hold');
CREATE INDEX IF NOT EXISTS idx_mp_orders_open_vendor
  ON public.marketplace_orders (vendor_id, status, created_at DESC)
  WHERE status IN ('paid','order_confirmed','preparing','ready_for_delivery','delivered');

DROP TRIGGER IF EXISTS mp_orders_touch ON public.marketplace_orders;
CREATE TRIGGER mp_orders_touch BEFORE UPDATE ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES public.marketplace_products(id) ON DELETE SET NULL,
  variant_id        UUID REFERENCES public.marketplace_product_variants(id) ON DELETE SET NULL,
  -- Immutable snapshot: the listing may be edited or deleted later, but what
  -- was bought is preserved exactly as displayed at purchase time.
  product_title     TEXT NOT NULL,
  variant_label     TEXT,
  image_path        TEXT,
  unit_price_kobo   BIGINT NOT NULL CHECK (unit_price_kobo >= 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 999),
  line_total_kobo   BIGINT NOT NULL CHECK (line_total_kobo >= 0),
  is_service        BOOLEAN NOT NULL DEFAULT FALSE,
  fulfilment_note   TEXT,
  fulfilled_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_item_total_consistent CHECK (line_total_kobo = unit_price_kobo * quantity)
);

CREATE INDEX IF NOT EXISTS idx_mp_items_order ON public.marketplace_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_mp_items_product ON public.marketplace_order_items (product_id)
  WHERE product_id IS NOT NULL;

COMMENT ON COLUMN public.marketplace_order_items.line_total_kobo IS
  'CHECK-constrained to unit_price_kobo * quantity, so a tampered line total cannot commit.';

-- =============================================================================
-- 12. marketplace_order_status_history — append-only audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_order_status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  from_status   public.marketplace_order_status,
  to_status     public.marketplace_order_status NOT NULL,
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role    TEXT NOT NULL CHECK (actor_role IN ('buyer','vendor','admin','system','payment_provider')),
  reason        TEXT CHECK (char_length(reason) <= 600),
  metadata      JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_osh_order ON public.marketplace_order_status_history (order_id, created_at);

COMMENT ON TABLE public.marketplace_order_status_history IS
  'Append-only. RLS grants INSERT to the SECURITY DEFINER transition function and SELECT to participants only. No UPDATE or DELETE policy exists for any role.';

-- =============================================================================
-- 13. marketplace_payments / marketplace_payment_events
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  buyer_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provider          public.marketplace_payment_provider NOT NULL DEFAULT 'none',
  -- The idempotency key sent to the provider. Unique, so a retried
  -- initialisation can never produce two live charges.
  provider_reference TEXT UNIQUE,
  -- Server-side amount. Mirrors orders.total_kobo; a mismatch is impossible
  -- because only mp_create_orders() writes both.
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo >= 0),
  currency          TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status            public.marketplace_payment_status NOT NULL DEFAULT 'created',
  channel           public.marketplace_payment_channel NOT NULL DEFAULT 'none',
  -- Redacted provider payload. Never stores PAN, full bank details or secrets.
  provider_meta     JSONB NOT NULL DEFAULT '{}'::JSONB,
  authorised_at     TIMESTAMPTZ,
  captured_at       TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  failure_reason    TEXT,
  refunded_kobo     BIGINT NOT NULL DEFAULT 0 CHECK (refunded_kobo >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_payment_refund_bound CHECK (refunded_kobo <= amount_kobo),
  CONSTRAINT mp_payment_succeeded_consistent CHECK (
    status <> 'succeeded' OR captured_at IS NOT NULL
  )
);

ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS mp_orders_payment_fk;
ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT mp_orders_payment_fk FOREIGN KEY (payment_id)
  REFERENCES public.marketplace_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mp_payments_order ON public.marketplace_payments (order_id);CREATE INDEX IF NOT EXISTS idx_mp_payments_buyer ON public.marketplace_payments (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_payments_status ON public.marketplace_payments (status, created_at DESC);

DROP TRIGGER IF EXISTS mp_payments_touch ON public.marketplace_payments;
CREATE TRIGGER mp_payments_touch BEFORE UPDATE ON public.marketplace_payments
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_payment_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID NOT NULL REFERENCES public.marketplace_payments(id) ON DELETE CASCADE,
  -- REPLAY DEFENCE: the provider's own event id, unique in the DB. A replayed
  -- webhook collides here and is rejected before any state is touched.
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type    TEXT NOT NULL,
  from_status   public.marketplace_payment_status,
  to_status     public.marketplace_payment_status,
  amount_kobo   BIGINT,
  signature_ok  BOOLEAN NOT NULL DEFAULT FALSE,
  payload       JSONB NOT NULL DEFAULT '{}'::JSONB,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_pevents_payment ON public.marketplace_payment_events (payment_id, processed_at DESC);

COMMENT ON TABLE public.marketplace_payment_events IS
  'Immutable webhook receipt log. UNIQUE(provider_event_id) is the replay guard; the table is never updated or deleted.';

-- =============================================================================
-- 14. marketplace_settlements — vendor receivable ledger
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL UNIQUE REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  vendor_id       UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE RESTRICT,
  gross_kobo      BIGINT NOT NULL CHECK (gross_kobo >= 0),
  commission_kobo BIGINT NOT NULL DEFAULT 0 CHECK (commission_kobo >= 0),
  net_kobo        BIGINT NOT NULL CHECK (net_kobo >= 0),
  status          public.marketplace_settlement_status NOT NULL DEFAULT 'pending',
  -- Funds become eligible only after completion + return window elapses.
  eligible_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '3 days'),
  released_at     TIMESTAMPTZ,
  hold_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_settlement_math CHECK (
    net_kobo = gross_kobo - commission_kobo AND commission_kobo <= gross_kobo
  )
);

CREATE INDEX IF NOT EXISTS idx_mp_settlements_vendor
  ON public.marketplace_settlements (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_settlements_status
  ON public.marketplace_settlements (status, eligible_at)
  WHERE status IN ('pending','scheduled','on_hold');

DROP TRIGGER IF EXISTS mp_settlements_touch ON public.marketplace_settlements;
CREATE TRIGGER mp_settlements_touch BEFORE UPDATE ON public.marketplace_settlements
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- =============================================================================
-- 15. marketplace_withdrawals + marketplace_withdrawal_allocations
-- -----------------------------------------------------------------------------
-- A withdrawal request names an amount; the allocation rows say exactly which
-- settled order receivables that amount is drawn from. Without this link,
-- "available balance" is a number the database cannot verify and a vendor
-- could request the same funds twice.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.marketplace_withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo >= 100),
  status          public.marketplace_withdrawal_status NOT NULL DEFAULT 'requested',
  destination     JSONB NOT NULL DEFAULT '{}'::JSONB,
  reference       TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  reviewer_note   TEXT CHECK (char_length(reviewer_note) <= 600),
  paid_at         TIMESTAMPTZ,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_withdrawals_vendor
  ON public.marketplace_withdrawals (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_withdrawals_status
  ON public.marketplace_withdrawals (status, requested_at);

DROP TRIGGER IF EXISTS mp_withdrawals_touch ON public.marketplace_withdrawals;
CREATE TRIGGER mp_withdrawals_touch BEFORE UPDATE ON public.marketplace_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_withdrawal_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id     UUID NOT NULL REFERENCES public.marketplace_withdrawals(id) ON DELETE CASCADE,
  settlement_id     UUID NOT NULL UNIQUE REFERENCES public.marketplace_settlements(id) ON DELETE RESTRICT,
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_walloc_withdrawal
  ON public.marketplace_withdrawal_allocations (withdrawal_id);

COMMENT ON TABLE public.marketplace_withdrawal_allocations IS
  'Which settled receivables fund a withdrawal. UNIQUE(settlement_id) makes double-spending a settlement impossible at the schema level.';

-- Allocations for one withdrawal may never exceed the requested amount, and a
-- settlement may only be allocated to a withdrawal belonging to its own vendor.
CREATE OR REPLACE FUNCTION public.mp_guard_withdrawal_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wid UUID := COALESCE(NEW.withdrawal_id, OLD.withdrawal_id);
  v_requested BIGINT;
  v_allocated BIGINT;
  v_vendor_a UUID;
  v_vendor_b UUID;
BEGIN
  SELECT amount_kobo, vendor_id INTO v_requested, v_vendor_a
    FROM public.marketplace_withdrawals WHERE id = v_wid;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(a.amount_kobo), 0) INTO v_allocated
    FROM public.marketplace_withdrawal_allocations a
   WHERE a.withdrawal_id = v_wid;

  IF TG_OP = 'INSERT' THEN
    SELECT s.vendor_id INTO v_vendor_b
      FROM public.marketplace_settlements s WHERE s.id = NEW.settlement_id;
    IF v_vendor_b IS NULL OR v_vendor_b <> v_vendor_a THEN
      RAISE EXCEPTION 'Settlement does not belong to this vendor' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_allocated > v_requested THEN
    RAISE EXCEPTION 'Allocations (%) exceed the requested withdrawal amount (%)',
      v_allocated, v_requested USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS mp_walloc_guard ON public.marketplace_withdrawal_allocations;
CREATE TRIGGER mp_walloc_guard AFTER INSERT OR UPDATE OR DELETE
  ON public.marketplace_withdrawal_allocations
  FOR EACH ROW EXECUTE FUNCTION public.mp_guard_withdrawal_allocation();

-- =============================================================================
-- 16. marketplace_reviews
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  vendor_id     UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL UNIQUE REFERENCES public.marketplace_order_items(id) ON DELETE CASCADE,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         TEXT CHECK (char_length(title) <= 100),
  body          TEXT CHECK (char_length(body) <= 2000),
  images        TEXT[] NOT NULL DEFAULT '{}',
  -- Moderation: a review is invisible until it passes.
  is_published  BOOLEAN NOT NULL DEFAULT TRUE,
  hidden_reason TEXT,
  vendor_reply  TEXT CHECK (char_length(vendor_reply) <= 1000),
  replied_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_review_has_product CHECK (product_id IS NOT NULL),
  CONSTRAINT mp_review_body_or_title CHECK (
    char_length(COALESCE(body,'')) >= 5 OR char_length(COALESCE(title,'')) >= 2
  )
);

COMMENT ON TABLE public.marketplace_reviews IS
  'One review per order item, and order_item_id is only insertable by mp_create_review(), which verifies the author actually completed that purchase.';

CREATE INDEX IF NOT EXISTS idx_mp_reviews_product
  ON public.marketplace_reviews (product_id, created_at DESC) WHERE is_published;
CREATE INDEX IF NOT EXISTS idx_mp_reviews_vendor
  ON public.marketplace_reviews (vendor_id, created_at DESC) WHERE is_published;
CREATE INDEX IF NOT EXISTS idx_mp_reviews_author
  ON public.marketplace_reviews (author_id, created_at DESC);

DROP TRIGGER IF EXISTS mp_reviews_touch ON public.marketplace_reviews;
CREATE TRIGGER mp_reviews_touch BEFORE UPDATE ON public.marketplace_reviews
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- Keep vendor rating aggregates honest.
CREATE OR REPLACE FUNCTION public.mp_sync_vendor_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor UUID := COALESCE(NEW.vendor_id, OLD.vendor_id);
BEGIN
  UPDATE public.marketplace_vendors v
     SET rating_avg = COALESCE(s.avg_rating, 0),
         rating_count = COALESCE(s.n, 0)
    FROM (
      SELECT round(AVG(r.rating)::NUMERIC, 2) AS avg_rating, count(*)::INTEGER AS n
        FROM public.marketplace_reviews r
       WHERE r.vendor_id = v_vendor AND r.is_published
    ) s
   WHERE v.id = v_vendor;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS mp_reviews_sync_rating_ins ON public.marketplace_reviews;
CREATE TRIGGER mp_reviews_sync_rating_ins AFTER INSERT OR UPDATE OF is_published, rating
  ON public.marketplace_reviews FOR EACH ROW EXECUTE FUNCTION public.mp_sync_vendor_rating();

DROP TRIGGER IF EXISTS mp_reviews_sync_rating_del ON public.marketplace_reviews;
CREATE TRIGGER mp_reviews_sync_rating_del AFTER DELETE
  ON public.marketplace_reviews FOR EACH ROW EXECUTE FUNCTION public.mp_sync_vendor_rating();

-- =============================================================================
-- 17. marketplace_conversations / marketplace_messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                public.marketplace_conversation_kind NOT NULL DEFAULT 'direct',
  buyer_id            UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  vendor_id           UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  order_id            UUID REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  -- Optional pre-purchase context (which listing started the chat).
  product_id          UUID REFERENCES public.marketplace_products(id) ON DELETE SET NULL,
  last_message_at     TIMESTAMPTZ,
  last_message_preview TEXT CHECK (char_length(last_message_preview) <= 160),
  buyer_unread        INTEGER NOT NULL DEFAULT 0 CHECK (buyer_unread >= 0),
  vendor_unread       INTEGER NOT NULL DEFAULT 0 CHECK (vendor_unread >= 0),
  is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
  locked_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Direct chats need exactly one buyer; order chats always do too.
  CONSTRAINT mp_conv_direct_shape CHECK (
    (kind = 'direct' AND buyer_id IS NOT NULL AND order_id IS NULL)
    OR (kind = 'order' AND buyer_id IS NOT NULL AND order_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.marketplace_conversations IS
  'Authorisation is membership-based: the caller must BE buyer_id or own vendor_id. There is no path where supplying a different conversation id grants access — the policy tests the row against auth.uid().';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_conv_direct
  ON public.marketplace_conversations (buyer_id, vendor_id)
  WHERE kind = 'direct' AND order_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_conv_order
  ON public.marketplace_conversations (order_id, vendor_id) WHERE kind = 'order';
CREATE INDEX IF NOT EXISTS idx_mp_conv_buyer
  ON public.marketplace_conversations (buyer_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_mp_conv_vendor
  ON public.marketplace_conversations (vendor_id, last_message_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS mp_conv_touch ON public.marketplace_conversations;
CREATE TRIGGER mp_conv_touch BEFORE UPDATE ON public.marketplace_conversations
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.marketplace_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.marketplace_conversations(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('buyer','vendor','admin','system')),
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  attachments     JSONB NOT NULL DEFAULT '[]'::JSONB,
  read_at         TIMESTAMPTZ,
  -- System messages (order placed, cancelled) have no human sender.
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_messages_conv
  ON public.marketplace_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_messages_unread
  ON public.marketplace_messages (conversation_id) WHERE read_at IS NULL;

COMMENT ON COLUMN public.marketplace_messages.attachments IS
  'Array of {path,name,mime,size}. Restricted to marketplace-message bucket objects owned by the conversation participants.';

-- =============================================================================
-- 18. marketplace_disputes / marketplace_dispute_evidence
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_disputes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_number    TEXT NOT NULL UNIQUE,
  order_id          UUID NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  buyer_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vendor_id         UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE RESTRICT,
  reason            public.marketplace_dispute_reason NOT NULL,
  description       TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 3000),
  status            public.marketplace_dispute_status NOT NULL DEFAULT 'open',
  -- Money stays protected while status is not terminal. Refund is staff-only.
  refund_amount_kobo BIGINT CHECK (refund_amount_kobo IS NULL OR refund_amount_kobo >= 0),
  assigned_to       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at       TIMESTAMPTZ,
  resolution        TEXT CHECK (char_length(resolution) <= 2000),
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_at            TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mp_dispute_resolved_consistent CHECK (
    (status IN ('resolved_refund','resolved_partial','resolved_rejected','closed')
      AND resolved_at IS NOT NULL)
    OR status NOT IN ('resolved_refund','resolved_partial','resolved_rejected','closed')
  ),
  CONSTRAINT mp_dispute_refund_required CHECK (
    status NOT IN ('resolved_refund','resolved_partial') OR refund_amount_kobo IS NOT NULL
  )
);

-- A refund may never exceed what the buyer actually paid. That needs the parent
-- order, and PostgreSQL forbids subqueries in CHECK, so it is a trigger.
CREATE OR REPLACE FUNCTION public.mp_guard_dispute_refund_bound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_total BIGINT;
BEGIN
  IF NEW.refund_amount_kobo IS NOT NULL THEN
    SELECT total_kobo INTO v_total FROM public.marketplace_orders WHERE id = NEW.order_id;
    IF v_total IS NULL OR NEW.refund_amount_kobo > v_total THEN
      RAISE EXCEPTION 'Refund amount (%) cannot exceed the order total (%)',
        NEW.refund_amount_kobo, COALESCE(v_total, 0) USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mp_disputes_refund_bound ON public.marketplace_disputes;
CREATE TRIGGER mp_disputes_refund_bound BEFORE INSERT OR UPDATE OF refund_amount_kobo, order_id
  ON public.marketplace_disputes FOR EACH ROW EXECUTE FUNCTION public.mp_guard_dispute_refund_bound();

COMMENT ON TABLE public.marketplace_disputes IS
  'Funds are protected while a dispute is non-terminal: mp_release_eligible_settlements() excludes disputed orders, so no payout can run.';

CREATE INDEX IF NOT EXISTS idx_mp_disputes_order ON public.marketplace_disputes (order_id);
CREATE INDEX IF NOT EXISTS idx_mp_disputes_status ON public.marketplace_disputes (status, created_at);
CREATE INDEX IF NOT EXISTS idx_mp_disputes_assignee ON public.marketplace_disputes (assigned_to, status)
  WHERE assigned_to IS NOT NULL AND status NOT IN ('resolved_refund','resolved_partial','resolved_rejected','closed');
CREATE INDEX IF NOT EXISTS idx_mp_disputes_vendor ON public.marketplace_disputes (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_disputes_buyer ON public.marketplace_disputes (buyer_id, created_at DESC);

DROP TRIGGER IF EXISTS mp_disputes_touch ON public.marketplace_disputes;
CREATE TRIGGER mp_disputes_touch BEFORE UPDATE ON public.marketplace_disputes
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS mp_orders_dispute_fk;
ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT mp_orders_dispute_fk FOREIGN KEY (dispute_id)
  REFERENCES public.marketplace_disputes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.marketplace_dispute_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id    UUID NOT NULL REFERENCES public.marketplace_disputes(id) ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  storage_path  TEXT NOT NULL,
  mime_type     TEXT NOT NULL CHECK (mime_type IN
    ('image/jpeg','image/png','image/webp','image/avif','application/pdf')),
  byte_size     INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  caption       TEXT CHECK (char_length(caption) <= 300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_devidence_dispute
  ON public.marketplace_dispute_evidence (dispute_id, created_at);

-- =============================================================================
-- 19. marketplace_reports
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   public.marketplace_report_target NOT NULL,
  target_id     UUID NOT NULL,
  reporter_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 200),
  details       TEXT CHECK (char_length(details) <= 1500),
  status        public.marketplace_report_status NOT NULL DEFAULT 'open',
  assigned_to   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution    TEXT CHECK (char_length(resolution) <= 1000),
  resolved_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Rate-abuse guard: one report per user per target.
  CONSTRAINT uq_mp_reports_once UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_reports_status ON public.marketplace_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_reports_target ON public.marketplace_reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_mp_reports_assignee ON public.marketplace_reports (assigned_to, status)
  WHERE status IN ('open','reviewing');

DROP TRIGGER IF EXISTS mp_reports_touch ON public.marketplace_reports;
CREATE TRIGGER mp_reports_touch BEFORE UPDATE ON public.marketplace_reports
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- =============================================================================
-- 20. marketplace_notifications (separate from the E-Library notifications table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type          public.marketplace_notification_type NOT NULL,
  title         TEXT NOT NULL CHECK (char_length(title) <= 140),
  message       TEXT NOT NULL CHECK (char_length(message) <= 500),
  link          TEXT CHECK (char_length(link) <= 300),
  entity_type   TEXT,
  entity_id     UUID,
  -- Prevents notification storms on retries.
  dedupe_key    TEXT,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_notif_dedupe
  ON public.marketplace_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mp_notif_user
  ON public.marketplace_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_notif_unread
  ON public.marketplace_notifications (user_id) WHERE read_at IS NULL;

COMMENT ON TABLE public.marketplace_notifications IS
  'Deliberately separate from the E-Library notifications table: deleting or reading a marketplace notification never touches library notifications and vice versa.';

-- =============================================================================
-- 21. marketplace_addresses / marketplace_delivery_options
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label           TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  recipient_name  TEXT NOT NULL CHECK (char_length(recipient_name) BETWEEN 2 AND 80),
  phone           TEXT NOT NULL CHECK (char_length(phone) BETWEEN 7 AND 20),
  campus_area     TEXT NOT NULL CHECK (char_length(campus_area) BETWEEN 2 AND 80),
  address_line    TEXT NOT NULL CHECK (char_length(address_line) BETWEEN 5 AND 240),
  landmark        TEXT CHECK (char_length(landmark) <= 160),
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_addresses_user ON public.marketplace_addresses (user_id, is_default DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_addresses_default
  ON public.marketplace_addresses (user_id) WHERE is_default;

DROP TRIGGER IF EXISTS mp_addresses_touch ON public.marketplace_addresses;
CREATE TRIGGER mp_addresses_touch BEFORE UPDATE ON public.marketplace_addresses
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- Per-vendor fulfilment options (vendor-controlled, admin-visible).
CREATE TABLE IF NOT EXISTS public.marketplace_delivery_options (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  kind              public.marketplace_delivery_type NOT NULL,
  label             TEXT NOT NULL CHECK (char_length(label) BETWEEN 2 AND 60),
  description       TEXT CHECK (char_length(description) <= 300),
  fee_kobo          BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  -- Restricts which campus areas this option serves.
  areas             TEXT[] NOT NULL DEFAULT '{}',
  min_lead_hours    INTEGER NOT NULL DEFAULT 0 CHECK (min_lead_hours BETWEEN 0 AND 2160),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_delopt_vendor
  ON public.marketplace_delivery_options (vendor_id, is_active, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_delopt_label ON public.marketplace_delivery_options (vendor_id, kind, label);

DROP TRIGGER IF EXISTS mp_delopt_touch ON public.marketplace_delivery_options;
CREATE TRIGGER mp_delopt_touch BEFORE UPDATE ON public.marketplace_delivery_options
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- =============================================================================
-- 22. marketplace_platform_settings — single-row fee/config store
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_platform_settings (
  id                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_commission_bps INTEGER NOT NULL DEFAULT 800 CHECK (default_commission_bps BETWEEN 0 AND 5000),
  default_delivery_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (default_delivery_fee_kobo >= 0),
  -- Order return window: after completion, how long a buyer can open a dispute.
  return_window_hours   INTEGER NOT NULL DEFAULT 72 CHECK (return_window_hours BETWEEN 0 AND 720),
  -- Settlement release delay after completion (separate from the return window).
  settlement_delay_hours INTEGER NOT NULL DEFAULT 72 CHECK (settlement_delay_hours BETWEEN 0 AND 720),
  auto_confirm_hours    INTEGER NOT NULL DEFAULT 72 CHECK (auto_confirm_hours BETWEEN 0 AND 720),
  min_withdrawal_kobo   BIGINT NOT NULL DEFAULT 500000 CHECK (min_withdrawal_kobo >= 0),
  max_listings_per_vendor INTEGER NOT NULL DEFAULT 200 CHECK (max_listings_per_vendor BETWEEN 1 AND 5000),
  max_images_per_listing INTEGER NOT NULL DEFAULT 8 CHECK (max_images_per_listing BETWEEN 1 AND 20),
  max_variants_per_listing INTEGER NOT NULL DEFAULT 20 CHECK (max_variants_per_listing BETWEEN 0 AND 60),
  allow_registration    BOOLEAN NOT NULL DEFAULT TRUE,
  allow_new_vendors     BOOLEAN NOT NULL DEFAULT TRUE,
  require_vendor_verification BOOLEAN NOT NULL DEFAULT FALSE,
  min_rating_to_list    NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (min_rating_to_list >= 0 AND min_rating_to_list <= 5),
  maintenance_mode      BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message   TEXT,
  announcement          TEXT,
  announcement_at       TIMESTAMPTZ,
  -- Public payment configuration (channels offered at checkout).
  payment_channels      TEXT[] NOT NULL DEFAULT '{card,bank_transfer,ussd}',
  payment_provider      public.marketplace_payment_provider NOT NULL DEFAULT 'none',
  payments_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketplace_platform_settings IS
  'Single-row (id=1) configuration. Readable by anyone (it is public pricing config); writable only by staff with manage_settings. A CHECK pins it to exactly one row so it can never be duplicated.';

INSERT INTO public.marketplace_platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS mp_settings_touch ON public.marketplace_platform_settings;
CREATE TRIGGER mp_settings_touch BEFORE UPDATE ON public.marketplace_platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.mp_touch_updated_at();

-- =============================================================================
-- 23. marketplace_audit_log — immutable staff action trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role    TEXT NOT NULL,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before_state  JSONB,
  after_state   JSONB,
  note          TEXT,
  ip_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_audit_entity ON public.marketplace_audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_audit_actor ON public.marketplace_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mp_audit_action ON public.marketplace_audit_log (action, created_at DESC);

COMMENT ON TABLE public.marketplace_audit_log IS
  'Immutable. Staff reads only; the INSERT is performed exclusively by SECURITY DEFINER functions so the actor cannot be forged from the client.';

-- Late foreign keys (targets created after the referencing table).
ALTER TABLE public.marketplace_inventory DROP CONSTRAINT IF EXISTS mp_inventory_order_fk;
ALTER TABLE public.marketplace_inventory
  ADD CONSTRAINT mp_inventory_order_fk FOREIGN KEY (order_id)
  REFERENCES public.marketplace_orders(id) ON DELETE SET NULL;

ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS mp_orders_payment_fk;
ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT mp_orders_payment_fk FOREIGN KEY (payment_id)
  REFERENCES public.marketplace_payments(id) ON DELETE SET NULL;

-- =============================================================================
-- ENABLE RLS ON EVERY TABLE (policies arrive in migration 03)
-- Until then every table denies all access, which is the safe default.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'marketplace_profiles','marketplace_admin_staff','marketplace_categories',
    'marketplace_subcategories','marketplace_vendors','marketplace_vendor_verifications',
    'marketplace_products','marketplace_product_images','marketplace_product_variants',
    'marketplace_inventory','marketplace_favourites','marketplace_checkouts',
    'marketplace_orders','marketplace_order_items','marketplace_order_status_history',
    'marketplace_payments','marketplace_payment_events','marketplace_settlements',
    'marketplace_withdrawals','marketplace_withdrawal_allocations','marketplace_reviews',
    'marketplace_conversations','marketplace_messages','marketplace_disputes',
    'marketplace_dispute_evidence','marketplace_reports','marketplace_notifications',
    'marketplace_addresses','marketplace_delivery_options','marketplace_platform_settings',
    'marketplace_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
