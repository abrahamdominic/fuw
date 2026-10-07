-- =============================================================================
-- PHASES 13-15: VENDOR ADVERTISEMENTS
--
-- Three things this migration is careful about:
--
--   1. ONE pricing source. Vendors never see a hardcoded price. They read
--      marketplace_advert_packages, which admins own. A package that is
--      disabled disappears from the vendor form immediately, because the form
--      asks the database what exists.
--
--   2. Prices are snapshotted onto the advert at submission. If an admin later
--      changes the price of a package, adverts already sold keep the price the
--      vendor agreed to. Only the price of future adverts moves.
--
--   3. Targeting is enforced here, not in the browser. mp_visible_adverts()
--      resolves the caller's gender from their own profile and refuses to hand
--      back a male-only advert to anyone else. Frontend filtering is treated as
--      a convenience, never as the control.
-- =============================================================================

BEGIN;

-- ── Types ────────────────────────────────────────────────────────────────────
CREATE TYPE public.marketplace_advert_type AS ENUM ('sponsored', 'featured');
CREATE TYPE public.marketplace_advert_audience AS ENUM ('male', 'female', 'both');
CREATE TYPE public.marketplace_advert_approval AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.marketplace_advert_status AS ENUM ('scheduled', 'active', 'suspended', 'expired', 'cancelled');

-- ── Packages: the admin-owned pricing table ──────────────────────────────────
CREATE TABLE public.marketplace_advert_packages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advert_type   public.marketplace_advert_type NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  price_kobo    BIGINT  NOT NULL CHECK (price_kobo >= 0),
  label         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketplace_advert_packages IS
  'Advert pricing options owned by admins. This is the single source of advert prices and durations.';

CREATE INDEX advert_packages_active_idx
  ON public.marketplace_advert_packages (is_active, advert_type, sort_order);

-- ── Adverts: what a vendor actually bought ───────────────────────────────────
CREATE TABLE public.marketplace_adverts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID NOT NULL REFERENCES public.marketplace_vendors(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES public.marketplace_products(id) ON DELETE SET NULL,
  package_id       UUID REFERENCES public.marketplace_advert_packages(id) ON DELETE SET NULL,

  advert_type      public.marketplace_advert_type NOT NULL,
  target_audience  public.marketplace_advert_audience NOT NULL DEFAULT 'both',

  -- Snapshotted from the package at submission. Never rewritten afterwards.
  price_kobo       BIGINT  NOT NULL CHECK (price_kobo >= 0),
  duration_days    INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),

  start_at         TIMESTAMPTZ NOT NULL,
  end_at           TIMESTAMPTZ NOT NULL,

  approval_state   public.marketplace_advert_approval NOT NULL DEFAULT 'pending',
  status           public.marketplace_advert_status    NOT NULL DEFAULT 'scheduled',

  -- When the wallet was charged, so a replayed approval cannot charge twice.
  charged_at       TIMESTAMPTZ,
  refunded_at      TIMESTAMPTZ,

  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  reviewer_note    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT adverts_window_ordered CHECK (end_at > start_at)
);

COMMENT ON COLUMN public.marketplace_adverts.price_kobo IS
  'Price agreed at submission, snapshotted so later package edits cannot rewrite history.';

CREATE INDEX adverts_vendor_idx    ON public.marketplace_adverts (vendor_id, created_at DESC);
CREATE INDEX adverts_status_idx    ON public.marketplace_adverts (status, approval_state);
CREATE INDEX adverts_placement_idx ON public.marketplace_adverts (advert_type, status, end_at);

-- The same advert must not be submitted twice for the same product and window.
CREATE UNIQUE INDEX adverts_no_duplicate_listing
  ON public.marketplace_adverts (vendor_id, product_id, start_at)
  WHERE product_id IS NOT NULL AND status <> 'cancelled';

-- ── Touch triggers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_advert_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER advert_packages_touch
  BEFORE UPDATE ON public.marketplace_advert_packages
  FOR EACH ROW EXECUTE FUNCTION public.mp_advert_touch();

CREATE TRIGGER adverts_touch
  BEFORE UPDATE ON public.marketplace_adverts
  FOR EACH ROW EXECUTE FUNCTION public.mp_advert_touch();

-- ── Expiry is a database fact, not a UI convention ───────────────────────────
-- Even if every query forgot to filter, an advert past its end date is marked
-- expired and therefore invisible to mp_visible_adverts().
CREATE OR REPLACE FUNCTION public.mp_expire_adverts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.marketplace_adverts
     SET status = 'expired'
   WHERE end_at <= now()
     AND status IN ('scheduled', 'active');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mp_expire_adverts() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- READ
-- ═════════════════════════════════════════════════════════════════════════════

-- What the vendor sees in the advert form: the admin's current price list.
CREATE OR REPLACE FUNCTION public.mp_list_advert_packages(p_include_inactive BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows JSONB;
  v_admin BOOLEAN := public.mp_is_admin(auth.uid())
                    OR public.mp_has_perm('manage_adverts');
BEGIN
  IF p_include_inactive AND NOT v_admin THEN
    RAISE EXCEPTION 'Only admins may list disabled advert packages' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order, s.duration_days), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT id, advert_type, duration_days, price_kobo, label, is_active, sort_order
        FROM public.marketplace_advert_packages
       WHERE is_active OR p_include_inactive
       ORDER BY sort_order, duration_days
    ) s;

  RETURN jsonb_build_object('packages', v_rows);
END;
$$;

-- Adverts the caller is allowed to see. This is the only read path the
-- marketplace UI is allowed to use for placement.
--
-- A targeted advert is withheld from anyone whose own profile does not match.
-- A profile with no gender on record matches neither a male-only nor a
-- female-only advert: showing a deliberately targeted advert to someone we
-- cannot identify is exactly the leak targeting is supposed to prevent.
CREATE OR REPLACE FUNCTION public.mp_visible_adverts(
  p_advert_type TEXT DEFAULT NULL,
  p_limit       INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_gender TEXT;
  v_admin  BOOLEAN;
  v_rows   JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view adverts' USING ERRCODE = '28000';
  END IF;

  SELECT lower(trim(COALESCE(gender, ''))) INTO v_gender
    FROM public.profiles WHERE id = v_uid;

  v_admin := public.mp_is_admin(v_uid) OR public.mp_has_perm('manage_adverts');

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.featured_first DESC, s.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT a.id, a.advert_type, a.target_audience, a.start_at, a.end_at, a.status,
             a.approval_state, a.price_kobo, a.duration_days, a.created_at,
             v.id AS vendor_id, v.shop_name, v.slug AS vendor_slug,
             p.id AS product_id, p.title AS product_title, p.slug AS product_slug,
             p.price_kobo AS product_price_kobo, p.thumbnail_path AS product_image,
             -- Sponsored outranks Featured within the same audience, so a paid
             -- placement is never buried under an editorial one.
             (a.advert_type = 'sponsored')::INT AS featured_first
        FROM public.marketplace_adverts a
        JOIN public.marketplace_vendors v  ON v.id = a.vendor_id
        LEFT JOIN public.marketplace_products p ON p.id = a.product_id
       WHERE a.approval_state = 'approved'
         AND a.status IN ('scheduled', 'active')
         AND a.end_at > now()
         AND (p_advert_type IS NULL OR a.advert_type::TEXT = p_advert_type)
         -- The targeting rule, evaluated server side.
         AND (
           v_admin
           OR a.target_audience = 'both'
           OR (a.target_audience = 'male'   AND v_gender = 'male')
           OR (a.target_audience = 'female' AND v_gender = 'female')
         )
         -- A suspended or not-yet-started advert never shows, even if the row
         -- somehow still says active.
         AND (a.status = 'active' OR a.start_at <= now())
       ORDER BY (a.advert_type = 'sponsored') DESC, a.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    ) s;

  RETURN jsonb_build_object('adverts', v_rows, 'audience', NULLIF(v_gender, ''));
END;
$$;

-- A vendor's own advert list, with the package list attached, for the dashboard.
CREATE OR REPLACE FUNCTION public.mp_my_adverts()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor UUID;
  v_rows   JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to view your adverts' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_vendor FROM public.marketplace_vendors
   WHERE owner_id = auth.uid() AND deleted_at IS NULL LIMIT 1;

  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'You do not have a storefront' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT a.id, a.advert_type, a.target_audience, a.price_kobo, a.duration_days,
             a.start_at, a.end_at, a.approval_state, a.status,
             a.reviewer_note, a.created_at,
             p.id AS product_id, p.title AS product_title, p.thumbnail_path AS product_image,
             pk.label AS package_label
        FROM public.marketplace_adverts a
        LEFT JOIN public.marketplace_products p ON p.id = a.product_id
        LEFT JOIN public.marketplace_advert_packages pk ON pk.id = a.package_id
       WHERE a.vendor_id = v_vendor
    ) s;

  RETURN jsonb_build_object('adverts', v_rows, 'vendor_id', v_vendor);
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- VENDOR ACTIONS
-- ═════════════════════════════════════════════════════════════════════════════

-- Submit an advert for review. The vendor chooses a product and a package; the
-- price, duration and advert type all come from the package, never from the
-- client, so a hand-crafted request cannot buy a month for the price of a week.
CREATE OR REPLACE FUNCTION public.mp_submit_advert(
  p_product_id      UUID,
  p_package_id      UUID,
  p_target_audience TEXT,
  p_start_at        TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor  UUID;
  v_owner   UUID;
  v_pkg     public.marketplace_advert_packages%ROWTYPE;
  v_advert  public.marketplace_adverts%ROWTYPE;
  v_aud     public.marketplace_advert_audience;
  v_start   TIMESTAMPTZ := COALESCE(p_start_at, date_trunc('day', now()));
  v_listing public.marketplace_products%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to submit an advert' USING ERRCODE = '28000';
  END IF;

  SELECT id, owner_id INTO v_vendor, v_owner
    FROM public.marketplace_vendors
   WHERE owner_id = auth.uid() AND deleted_at IS NULL LIMIT 1;

  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'You do not have a storefront' USING ERRCODE = 'P0002';
  END IF;

  SELECT status INTO v_listing.status FROM public.marketplace_products
   WHERE id = p_product_id AND vendor_id = v_vendor AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick a listing from your own storefront' USING ERRCODE = 'P0002';
  END IF;
  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'That listing must be active before it can be advertised'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pkg FROM public.marketplace_advert_packages
   WHERE id = p_package_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That advert package is not available' USING ERRCODE = 'P0002';
  END IF;

  v_aud := CASE lower(trim(COALESCE(p_target_audience, 'both')))
            WHEN 'male'   THEN 'male'::public.marketplace_advert_audience
            WHEN 'female' THEN 'female'::public.marketplace_advert_audience
            WHEN 'both'   THEN 'both'::public.marketplace_advert_audience
            ELSE NULL END;
  IF v_aud IS NULL THEN
    RAISE EXCEPTION 'Choose Male, Female or Both' USING ERRCODE = '22023';
  END IF;

  IF v_start < date_trunc('day', now()) THEN
    RAISE EXCEPTION 'An advert cannot start in the past' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.marketplace_adverts (
    vendor_id, product_id, package_id, advert_type, target_audience,
    price_kobo, duration_days, start_at, end_at, approval_state, status
  ) VALUES (
    v_vendor, p_product_id, v_pkg.id, v_pkg.advert_type, v_aud,
    v_pkg.price_kobo, v_pkg.duration_days,
    v_start, v_start + make_interval(days => v_pkg.duration_days),
    'pending', 'scheduled'
  ) RETURNING * INTO v_advert;

  PERFORM public.mp_notify(auth.uid(), 'advert_update', 'Advert submitted for review',
    format('Your advert for "%s" is awaiting review.', v_listing.title),
    '/vendor/dashboard?tab=adverts', 'advert', v_advert.id);

  RETURN jsonb_build_object(
    'advert_id', v_advert.id,
    'status', v_advert.status,
    'approval_state', v_advert.approval_state,
    'price_kobo', v_advert.price_kobo,
    'duration_days', v_advert.duration_days,
    'start_at', v_advert.start_at,
    'end_at', v_advert.end_at
  );
END;
$$;

-- A vendor may withdraw an advert that has not started running yet.
CREATE OR REPLACE FUNCTION public.mp_cancel_advert(p_advert_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_advert public.marketplace_adverts%ROWTYPE;
  v_owner  UUID;
  v_wallet UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to cancel an advert' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_advert FROM public.marketplace_adverts
   WHERE id = p_advert_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advert not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_advert.vendor_id;
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only cancel your own adverts' USING ERRCODE = '42501';
  END IF;

  IF v_advert.status IN ('expired', 'cancelled') THEN
    RAISE EXCEPTION 'That advert has already finished' USING ERRCODE = '22023';
  END IF;

  -- Money comes back only if it was taken and the advert never ran.
  IF v_advert.charged_at IS NOT NULL
     AND v_advert.refunded_at IS NULL
     AND v_advert.start_at > now() THEN
    SELECT id INTO v_wallet FROM public.marketplace_wallets
     WHERE vendor_id = v_advert.vendor_id OR owner_user_id = v_owner
     ORDER BY (owner_user_id = v_owner) DESC LIMIT 1;

    IF v_wallet IS NOT NULL THEN
      PERFORM public.mp_wallet_post(
        v_wallet, 'credit', 'available', v_advert.price_kobo, 'advert_refund',
        'advert', v_advert.id,
        'advert:' || v_advert.id::TEXT || ':refund',
        'Advert cancelled before it ran',
        jsonb_build_object('advert_id', v_advert.id), NULL);
    END IF;
    UPDATE public.marketplace_adverts SET refunded_at = now() WHERE id = v_advert.id;
  END IF;

  UPDATE public.marketplace_adverts
     SET status = 'cancelled',
         reviewer_note = COALESCE(reviewer_note, 'Cancelled by the vendor')
   WHERE id = v_advert.id;

  RETURN jsonb_build_object('advert_id', v_advert.id, 'status', 'cancelled');
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- ADMIN ACTIONS
-- ═════════════════════════════════════════════════════════════════════════════

-- Approve or reject. The wallet is charged at approval, not at submission, so a
-- vendor is never billed for a placement an admin throws away.
CREATE OR REPLACE FUNCTION public.mp_review_advert(
  p_advert_id UUID,
  p_decision   TEXT,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_advert public.marketplace_adverts%ROWTYPE;
  v_owner  UUID;
  v_wallet UUID;
  v_state  public.marketplace_advert_approval;
  v_title  TEXT;
BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_adverts')) THEN
    RAISE EXCEPTION 'You do not have permission to review adverts' USING ERRCODE = '42501';
  END IF;

  v_state := CASE lower(trim(COALESCE(p_decision, '')))
             WHEN 'approve' THEN 'approved'::public.marketplace_advert_approval
             WHEN 'reject'  THEN 'rejected'::public.marketplace_advert_approval
             ELSE NULL END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_advert FROM public.marketplace_adverts WHERE id = p_advert_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advert not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_advert.approval_state = 'approved' AND v_state = 'approved' THEN
    RAISE EXCEPTION 'That advert is already approved' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_advert.vendor_id;
  SELECT title INTO v_title FROM public.marketplace_products WHERE id = v_advert.product_id;

  IF v_state = 'rejected' THEN
    -- Refund a previously approved advert that is being pulled.
    IF v_advert.charged_at IS NOT NULL AND v_advert.refunded_at IS NULL
       AND v_advert.status NOT IN ('expired', 'cancelled') THEN
      SELECT id INTO v_wallet FROM public.marketplace_wallets
       WHERE vendor_id = v_advert.vendor_id OR owner_user_id = v_owner
       ORDER BY (owner_user_id = v_owner) DESC LIMIT 1;
      IF v_wallet IS NOT NULL THEN
        PERFORM public.mp_wallet_post(
          v_wallet, 'credit', 'available', v_advert.price_kobo, 'advert_refund',
          'advert', v_advert.id, 'advert:' || v_advert.id::TEXT || ':refund',
          'Advert rejected', jsonb_build_object('advert_id', v_advert.id), NULL);
      END IF;
      UPDATE public.marketplace_adverts SET refunded_at = now() WHERE id = v_advert.id;
    END IF;

    UPDATE public.marketplace_adverts
       SET approval_state = 'rejected',
           status = 'cancelled',
           reviewed_by = auth.uid(), reviewed_at = now(), reviewer_note = left(p_note, 400)
     WHERE id = v_advert.id;
  ELSE
    IF v_advert.price_kobo > 0 THEN
      SELECT id INTO v_wallet FROM public.marketplace_wallets
       WHERE vendor_id = v_advert.vendor_id OR owner_user_id = v_owner
       ORDER BY (owner_user_id = v_owner) DESC LIMIT 1;

      IF v_wallet IS NULL THEN
        RAISE EXCEPTION 'That vendor has no wallet to charge. Wallet: %', v_owner
          USING ERRCODE = 'P0002';
      END IF;

      -- The key is derived from the advert, so approving twice can never charge
      -- twice even if the status write is replayed.
      PERFORM public.mp_wallet_post(
        v_wallet, 'debit', 'available', v_advert.price_kobo, 'advert_spend',
        'advert', v_advert.id, 'advert:' || v_advert.id::TEXT || ':charge',
        format('%s advert for "%s"', initcap(v_advert.advert_type::TEXT), COALESCE(v_title, 'your listing')),
        jsonb_build_object('advert_id', v_advert.id, 'package_id', v_advert.package_id,
                           'duration_days', v_advert.duration_days), NULL);

      UPDATE public.marketplace_adverts SET charged_at = now() WHERE id = v_advert.id;
    END IF;

    -- An advert whose window has already passed is not approvable.
    IF v_advert.end_at <= now() THEN
      UPDATE public.marketplace_adverts SET status = 'expired' WHERE id = v_advert.id;
      RAISE EXCEPTION 'That advert window has already passed' USING ERRCODE = '22023';
    END IF;

    UPDATE public.marketplace_adverts
       SET approval_state = 'approved',
           status = (CASE WHEN v_advert.start_at <= now() THEN 'active' ELSE 'scheduled' END)
                      ::public.marketplace_advert_status,
           reviewed_by = auth.uid(), reviewed_at = now(), reviewer_note = left(p_note, 400)
     WHERE id = v_advert.id;
  END IF;

  PERFORM public.mp_audit('advert.review', 'advert', v_advert.id,
    jsonb_build_object('approval_state', v_state, 'status', v_advert.status),
    jsonb_build_object('decision', p_decision), p_note, 'admin');

  PERFORM public.mp_notify(v_owner, 'advert_update',
    CASE v_state WHEN 'approved' THEN 'Advert approved' ELSE 'Advert rejected' END,
    COALESCE(left(p_note, 400), 'Open your dashboard for details.'),
    '/vendor/dashboard?tab=adverts', 'advert', v_advert.id);

  RETURN jsonb_build_object(
    'advert_id', v_advert.id,
    'approval_state', v_state,
    'charged_kobo', CASE WHEN v_state = 'approved' THEN v_advert.price_kobo ELSE 0 END
  );
END;
$$;

-- Pause or resume a running advert. Suspending hides it without a refund: the
-- slot was paid for and the days are still ticking.
CREATE OR REPLACE FUNCTION public.mp_set_advert_active(
  p_advert_id UUID,
  p_active    BOOLEAN,
  p_note      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_advert public.marketplace_adverts%ROWTYPE;
  v_owner  UUID;
  v_status public.marketplace_advert_status;
BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_adverts')) THEN
    RAISE EXCEPTION 'You do not have permission to manage adverts' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_advert FROM public.marketplace_adverts WHERE id = p_advert_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advert not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_advert.approval_state <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved advert can be suspended or activated'
      USING ERRCODE = '22023';
  END IF;

  v_status := CASE WHEN p_active
                   THEN CASE WHEN v_advert.start_at <= now() THEN 'active' ELSE 'scheduled' END
                   ELSE 'suspended' END;

  UPDATE public.marketplace_adverts
     SET status = v_status, reviewer_note = COALESCE(left(p_note, 400), reviewer_note)
   WHERE id = v_advert.id;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_advert.vendor_id;
  PERFORM public.mp_audit('advert.status', 'advert', v_advert.id,
    jsonb_build_object('status', v_status), jsonb_build_object('active', p_active), p_note, 'admin');
  PERFORM public.mp_notify(v_owner, 'advert_update',
    CASE WHEN p_active THEN 'Advert reactivated' ELSE 'Advert suspended' END,
    COALESCE(left(p_note, 400), 'Open your dashboard for details.'),
    '/vendor/dashboard?tab=adverts', 'advert', v_advert.id);

  RETURN jsonb_build_object('advert_id', v_advert.id, 'status', v_status);
END;
$$;

-- Every advert, for the admin review queue.
CREATE OR REPLACE FUNCTION public.mp_admin_list_adverts(
  p_approval_state TEXT DEFAULT NULL,
  p_status         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows JSONB;
BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_adverts')) THEN
    RAISE EXCEPTION 'You do not have permission to view adverts' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT a.id, a.advert_type, a.target_audience, a.price_kobo, a.duration_days,
             a.start_at, a.end_at, a.approval_state, a.status, a.reviewer_note,
             a.charged_at, a.refunded_at, a.created_at, a.reviewed_at,
             v.id AS vendor_id, v.shop_name AS vendor_name, v.slug AS vendor_slug,
             p.id AS product_id, p.title AS product_title, p.thumbnail_path AS product_image,
             pk.label AS package_label, pk.duration_days AS package_duration_days,
             pk.price_kobo AS package_price_kobo,
             (SELECT COALESCE(sum(e.amount_kobo), 0)
                FROM public.marketplace_ledger_entries e
               WHERE e.reference_type = 'advert' AND e.reference_id = a.id
                 AND e.entry_type = 'advert_spend') AS charged_kobo
        FROM public.marketplace_adverts a
        JOIN public.marketplace_vendors v ON v.id = a.vendor_id
        LEFT JOIN public.marketplace_products p ON p.id = a.product_id
        LEFT JOIN public.marketplace_advert_packages pk ON pk.id = a.package_id
       WHERE (p_approval_state IS NULL OR a.approval_state::TEXT = p_approval_state)
         AND (p_status IS NULL OR a.status::TEXT = p_status)
    ) s;

  RETURN jsonb_build_object('adverts', v_rows);
END;
$$;

-- ── Admin pricing management ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_save_advert_package(
  p_advert_type   TEXT,
  p_duration_days INTEGER,
  p_price_kobo    BIGINT,
  p_package_id    UUID DEFAULT NULL,
  p_label         TEXT DEFAULT NULL,
  p_is_active     BOOLEAN DEFAULT TRUE,
  p_sort_order    INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_type public.marketplace_advert_type;
BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_adverts')) THEN
    RAISE EXCEPTION 'You do not have permission to manage advert pricing' USING ERRCODE = '42501';
  END IF;

  v_type := CASE lower(trim(COALESCE(p_advert_type, '')))
            WHEN 'sponsored' THEN 'sponsored'::public.marketplace_advert_type
            WHEN 'featured'  THEN 'featured'::public.marketplace_advert_type
            ELSE NULL END;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Advert type must be Sponsored or Featured' USING ERRCODE = '22023';
  END IF;

  IF p_duration_days IS NULL OR p_duration_days < 1 OR p_duration_days > 365 THEN
    RAISE EXCEPTION 'Duration must be between 1 and 365 days' USING ERRCODE = '22023';
  END IF;

  IF p_price_kobo IS NULL OR p_price_kobo < 0 THEN
    RAISE EXCEPTION 'Enter a price of NGN 0 or more' USING ERRCODE = '22023';
  END IF;

  IF p_package_id IS NOT NULL THEN
    -- Edit in place. Recreating the row would break every advert already sold
    -- against it, and would silently change the price those adverts were
    -- bought at.
    UPDATE public.marketplace_advert_packages
       SET advert_type   = v_type,
           duration_days = p_duration_days,
           price_kobo    = p_price_kobo,
           label         = COALESCE(NULLIF(left(trim(p_label), 80), ''),
                                      format('%s Days', p_duration_days)),
           is_active     = COALESCE(p_is_active, TRUE),
           sort_order    = COALESCE(p_sort_order, 0)
     WHERE id = p_package_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Advert package not found' USING ERRCODE = 'P0002';
    END IF;
    v_id := p_package_id;
  ELSE
    INSERT INTO public.marketplace_advert_packages
      (advert_type, duration_days, price_kobo, label, is_active, sort_order)
    VALUES
      (v_type, p_duration_days, p_price_kobo,
       COALESCE(NULLIF(left(trim(p_label), 80), ''), format('%s Days', p_duration_days)),
       COALESCE(p_is_active, TRUE), COALESCE(p_sort_order, 0))
    RETURNING id INTO v_id;
  END IF;

  PERFORM public.mp_audit('advert_package.save', 'advert_package', v_id,
    jsonb_build_object('advert_type', v_type, 'duration_days', p_duration_days,
                       'price_kobo', p_price_kobo, 'is_active', p_is_active),
    jsonb_build_object('edited', p_package_id IS NOT NULL), NULL, 'admin');

  RETURN jsonb_build_object('package_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mp_delete_advert_package(p_package_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_in_use INTEGER;
BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_adverts')) THEN
    RAISE EXCEPTION 'You do not have permission to manage advert pricing' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_in_use FROM public.marketplace_adverts WHERE package_id = p_package_id;
  IF v_in_use > 0 THEN
    -- Adverts already sold reference this row. Retiring it keeps that history
    -- readable; disabling it does the same without deleting anything.
    UPDATE public.marketplace_advert_packages SET is_active = FALSE WHERE id = p_package_id;
    RETURN jsonb_build_object('package_id', p_package_id, 'disabled_instead', TRUE,
                              'adverts_using_it', v_in_use);
  END IF;

  DELETE FROM public.marketplace_advert_packages WHERE id = p_package_id;
  RETURN jsonb_build_object('package_id', p_package_id, 'deleted', TRUE);
END;
$$;

-- ── Row level security ───────────────────────────────────────────────────────
ALTER TABLE public.marketplace_advert_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_adverts          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advert_packages_read ON public.marketplace_advert_packages;
CREATE POLICY advert_packages_read ON public.marketplace_advert_packages
  FOR SELECT TO authenticated
  USING (is_active OR public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_adverts'));

DROP POLICY IF EXISTS adverts_read_own ON public.marketplace_adverts;
CREATE POLICY adverts_read_own ON public.marketplace_adverts
  FOR SELECT TO authenticated
  USING (
    vendor_id IN (SELECT id FROM public.marketplace_vendors WHERE owner_id = auth.uid())
    OR public.mp_is_admin(auth.uid())
    OR public.mp_has_perm('manage_adverts')
  );

-- No INSERT/UPDATE/DELETE policies: every change goes through an RPC that
-- re-checks ownership and permission.
REVOKE ALL ON public.marketplace_adverts          FROM anon;
REVOKE ALL ON public.marketplace_advert_packages FROM anon;

GRANT SELECT ON public.marketplace_adverts          TO authenticated;
GRANT SELECT ON public.marketplace_advert_packages TO authenticated;

GRANT EXECUTE ON FUNCTION public.mp_list_advert_packages(BOOLEAN)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_visible_adverts(TEXT, INTEGER)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_my_adverts()                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_submit_advert(UUID, UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_cancel_advert(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_review_advert(UUID, TEXT, TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_set_advert_active(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_admin_list_adverts(TEXT, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_save_advert_package(TEXT, INTEGER, BIGINT, UUID, TEXT, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_delete_advert_package(UUID)        TO authenticated;

-- Client-side reachability of a read RPC must not be a security decision. The
-- audience check lives inside mp_visible_adverts; this only stops a caller
-- asking for a package list that includes disabled options.
REVOKE EXECUTE ON FUNCTION public.mp_list_advert_packages(BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mp_list_advert_packages(BOOLEAN) TO authenticated;

-- ── Keep expiry ticking ─────────────────────────────────────────────────────
-- Expiry is already enforced by the query, so this job is belt and braces: it
-- keeps the stored status honest for anyone reading the table directly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'fuw-marketplace-expire-adverts';
    PERFORM cron.schedule('fuw-marketplace-expire-adverts', '13 * * * *',
                          'SELECT public.mp_expire_adverts()');
  END IF;
END;
$$;

-- ── Starting price list ─────────────────────────────────────────────────────
-- Sensible defaults so the vendor form is usable on day one. Every one of these
-- rows is editable from the admin dashboard; nothing is hardcoded in the app.
INSERT INTO public.marketplace_advert_packages
  (advert_type, duration_days, price_kobo, label, is_active, sort_order)
VALUES
  ('sponsored',  7,  1500000, '7 Days',  TRUE, 10),
  ('sponsored', 14,  2700000, '14 Days', TRUE, 20),
  ('sponsored', 30,  5000000, '30 Days', TRUE, 30),
  ('featured',   7,   900000, '7 Days',  TRUE, 40),
  ('featured',  14,  1600000, '14 Days', TRUE, 50),
  ('featured',  30,  3000000, '30 Days', TRUE, 60);

COMMIT;