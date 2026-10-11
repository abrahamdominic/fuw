-- =============================================================================
-- Part 1: Four required accommodation photos            (photo slots)
-- Part 2: Configurable accommodation connection fee     (verified landlord contact)
--
-- Covers MASTER PROMPT parts 1 and 2:
--   * Every published listing must carry one photo for each of four labelled
--     categories: main room, toilet, kitchen, front view.
--   * A configurable one-off connection fee (kobo) that a student pays once per
--     listing to unlock the verified landlord/caretaker contact details. Off by
--     default, so the current free-contact behaviour is unchanged until an
--     administrator enables it.
-- Money movement reuses the existing wallet ledger (single writer) and keeps a
-- receipt row + audit trail. It is never trusted to the client.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Photo slots on accommodation_properties
-- -----------------------------------------------------------------------------
ALTER TABLE public.accommodation_properties
  ADD COLUMN IF NOT EXISTS photo_slots JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Is a photo_slots array complete? Exactly the four required categories, each
-- with a non-empty url. IMMUTABLE so it can feed triggers and later a guard.
CREATE OR REPLACE FUNCTION public.acc_photo_slots_complete(p_slots JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_total INTEGER;
BEGIN
  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RETURN false;
  END IF;
  v_total := jsonb_array_length(p_slots);
  IF v_total <> 4 THEN
    RETURN false;
  END IF;
  RETURN (
    SELECT bool_and(
             e->>'key' IN ('main_room', 'toilet', 'kitchen', 'front_view')
             AND NULLIF(btrim(COALESCE(e->>'url', '')), '') IS NOT NULL
           )
      FROM jsonb_array_elements(p_slots) e
  ) AND (
    SELECT count(DISTINCT e->>'key') FROM jsonb_array_elements(p_slots) e
  ) = 4;
END;
$$;

-- Flat url array from slots (main_room first so it remains the card cover).
CREATE OR REPLACE FUNCTION public.acc_slot_urls(p_slots JSONB)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
           WHEN p_slots IS NULL THEN '{}'::text[]
           ELSE ARRAY(
             SELECT e->>'url'
               FROM jsonb_array_elements(p_slots) e
              ORDER BY CASE e->>'key'
                         WHEN 'main_room' THEN 1
                         WHEN 'front_view' THEN 2
                         WHEN 'toilet' THEN 3
                         ELSE 4
                       END
           )
         END;
$$;

-- Mirrors `photos_complete` from the stored photo_slots on every write path
-- (including direct admin inserts), so the flag can never drift.
ALTER TABLE public.accommodation_properties
  ADD COLUMN IF NOT EXISTS photos_complete BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.acc_sync_photos_complete()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.photo_slots IS NULL THEN
    NEW.photo_slots := '[]'::jsonb;
  END IF;
  NEW.photos_complete := public.acc_photo_slots_complete(NEW.photo_slots);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acc_sync_photos_complete ON public.accommodation_properties;
CREATE TRIGGER trg_acc_sync_photos_complete
  BEFORE INSERT OR UPDATE OF photo_slots ON public.accommodation_properties
  FOR EACH ROW EXECUTE FUNCTION public.acc_sync_photos_complete();

-- -----------------------------------------------------------------------------
-- 2. Per-listing opt-in flag + platform connection-fee configuration
-- -----------------------------------------------------------------------------
ALTER TABLE public.accommodation_properties
  ADD COLUMN IF NOT EXISTS connection_fee_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.marketplace_platform_settings
  ADD COLUMN IF NOT EXISTS accommodation_connection_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accommodation_connection_fee_kobo BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.marketplace_platform_settings.accommodation_connection_fee_enabled
  IS 'Master switch for the accommodation connection fee. Off by default so direct, free contact keeps working.';
COMMENT ON COLUMN public.marketplace_platform_settings.accommodation_connection_fee_kobo
  IS 'One-off connection fee in kobo charged once per student per listing that has connection_fee_required = true (when enabled).';

-- Repayment-proof receipt ledger. One row per (listing, student); the partial
-- unique index makes a second payment for the same pair impossible.
CREATE TABLE IF NOT EXISTS public.accommodation_connection_fees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      UUID NOT NULL REFERENCES public.accommodation_properties(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_kobo      BIGINT NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  status           TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
  idempotency_key  TEXT NOT NULL UNIQUE,
  ledger_entry_id  UUID REFERENCES public.marketplace_ledger_entries(id),
  refunded_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_conn_fee_one_per_student
  ON public.accommodation_connection_fees (property_id, student_id)
  WHERE status <> 'refunded';

CREATE INDEX IF NOT EXISTS idx_acc_conn_fee_property
  ON public.accommodation_connection_fees (property_id)
  WHERE status <> 'refunded';

COMMENT ON TABLE public.accommodation_connection_fees IS
  'One-off accommodation connection fee receipts. Row-level security forbids
  client writes; every row is produced by acc_pay_connection_fee() and backed by
  a wallet ledger entry. A refunded row is what un-grants access.';

ALTER TABLE public.accommodation_connection_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connection fees select own" ON public.accommodation_connection_fees;
CREATE POLICY "connection fees select own" ON public.accommodation_connection_fees
  FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_platform_admin() OR public.is_admin());
DROP POLICY IF EXISTS "connection fees admin manage" ON public.accommodation_connection_fees;
CREATE POLICY "connection fees admin manage" ON public.accommodation_connection_fees
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

REVOKE ALL ON public.accommodation_connection_fees FROM anon;
GRANT SELECT ON public.accommodation_connection_fees TO authenticated;

-- New ledger entry type for connection-fee debits.
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS
  'accommodation_connection_fee' AFTER 'advert_refund';

-- -----------------------------------------------------------------------------
-- 3. Connection-fee RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_connection_fee_config()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
             'enabled',      COALESCE(accommodation_connection_fee_enabled, false),
             'amount_kobo',  COALESCE(accommodation_connection_fee_kobo, 0),
             'currency',     'NGN'
           )
      FROM public.marketplace_platform_settings WHERE id = 1
  ), jsonb_build_object('enabled', false, 'amount_kobo', 0, 'currency', 'NGN'));
$$;

-- Whether THIS listing charges a fee and whether the current user already paid.
CREATE OR REPLACE FUNCTION public.acc_listing_connection_fee(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg  jsonb := public.acc_connection_fee_config();
  v_req  boolean;
  v_paid boolean := false;
BEGIN
  IF p_property_id IS NULL THEN
    RAISE EXCEPTION 'Listing id is required' USING ERRCODE = '22023';
  END IF;
  SELECT connection_fee_required INTO v_req
    FROM public.accommodation_properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;
  v_req := COALESCE(v_req, false) AND COALESCE((v_cfg->>'enabled')::boolean, false);

  IF auth.uid() IS NOT NULL AND v_req THEN
    SELECT EXISTS (
      SELECT 1 FROM public.accommodation_connection_fees f
       WHERE f.property_id = p_property_id AND f.student_id = auth.uid()
         AND f.status <> 'refunded'
    ) INTO v_paid;
  END IF;

  RETURN jsonb_build_object(
    'required',     v_req,
    'amount_kobo',  CASE WHEN v_req THEN COALESCE((v_cfg->>'amount_kobo')::bigint, 0) ELSE 0 END,
    'currency',     COALESCE(v_cfg->>'currency', 'NGN'),
    'paid',         v_paid
  );
END;
$$;

-- True when the current user may see the listing's contact details.
CREATE OR REPLACE FUNCTION public.acc_has_connection_access(p_property_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg  jsonb := public.acc_connection_fee_config();
  v_req  boolean;
  v_uid  uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(connection_fee_required, false) INTO v_req
    FROM public.accommodation_properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT v_req OR NOT COALESCE((v_cfg->>'enabled')::boolean, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.accommodation_connection_fees f
     WHERE f.property_id = p_property_id AND f.student_id = v_uid
       AND f.status <> 'refunded'
  );
END;
$$;

-- Pay the once-per-student connection fee. Idempotent; verifies server-side;
-- never accepts a client-supplied amount.
CREATE OR REPLACE FUNCTION public.acc_pay_connection_fee(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg      jsonb := public.acc_connection_fee_config();
  v_req      boolean;
  v_amount   bigint;
  v_prop     public.accommodation_properties%ROWTYPE;
  v_owner    uuid;
  v_wallet   uuid;
  v_fee      uuid;
  v_entry    uuid;
  v_uid      uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to connect with a landlord or caretaker' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_prop FROM public.accommodation_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  v_req := COALESCE(v_prop.connection_fee_required, false)
           AND COALESCE((v_cfg->>'enabled')::boolean, false);
  v_amount := CASE WHEN v_req THEN COALESCE((v_cfg->>'amount_kobo')::bigint, 0) ELSE 0 END;

  IF NOT v_req THEN
    RETURN jsonb_build_object('ok', true, 'required', false,
      'amount_kobo', 0, 'currency', COALESCE(v_cfg->>'currency', 'NGN'), 'paid', true);
  END IF;

  -- Exactly once: the partial unique index rejects a second active row.
  BEGIN
    INSERT INTO public.accommodation_connection_fees
      (property_id, student_id, amount_kobo, idempotency_key, created_by)
    VALUES (p_property_id, v_uid, v_amount,
            'accconn:' || p_property_id::TEXT || ':' || v_uid::TEXT, v_uid)
    RETURNING id INTO v_fee;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'required', true,
      'amount_kobo', v_amount, 'currency', COALESCE(v_cfg->>'currency', 'NGN'),
      'paid', true, 'already', true);
  END;

  IF v_amount > 0 THEN
    v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_uid);
    -- Single debit out of the available bucket into the ledger; key is derived
    -- from the receipt row, so a retry can never double-debit.
    v_entry := public.mp_wallet_post(
      v_wallet, 'debit', 'available', v_amount, 'accommodation_connection_fee',
      'accommodation_connection_fee', v_fee,
      'accconn:' || v_fee::TEXT || ':debit',
      'Accommodation connection fee', jsonb_build_object('property_id', p_property_id), v_uid);
    UPDATE public.accommodation_connection_fees
       SET ledger_entry_id = v_entry WHERE id = v_fee;
  END IF;

  PERFORM public.mp_audit('connection_fee.paid', 'accommodation_connection_fee', v_fee,
    NULL, jsonb_build_object('property_id', p_property_id, 'amount_kobo', v_amount),
    'Connection fee paid for a listing', 'student');

  SELECT user_id INTO v_owner FROM public.accommodation_providers WHERE id = v_prop.provider_id;
  IF v_owner IS NOT NULL THEN
    PERFORM public.queue_notification(v_owner, 'A student connected with your listing',
      'A student has paid the connection fee and can now reach you about ' || COALESCE(v_prop.title, 'your listing') || '.',
      'info', '/provider?tab=inbox', 'accommodation',
      'acc_conn_' || v_fee::TEXT);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'required', true,
    'amount_kobo', v_amount, 'currency', COALESCE(v_cfg->>'currency', 'NGN'),
    'paid', true, 'already', false, 'payment_id', v_fee
  );
END;
$$;

-- Server-controlled contact reveal. Non-paying students only ever receive a
-- masked payload, no matter what the client asks for.
CREATE OR REPLACE FUNCTION public.acc_get_contact_block(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_cfg      jsonb := public.acc_connection_fee_config();
  v_req      boolean;
  v_prop     record;
  v_allowed  boolean;
  v_provider uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view contact details' USING ERRCODE = '28000';
  END IF;

  SELECT p.connection_fee_required, p.contact_phone, p.contact_whatsapp,
         p.address_landmark, p.title, prov.full_name, prov.business_name,
         prov.id AS provider_id, prov.user_id AS provider_user_id
    INTO v_prop
    FROM public.accommodation_properties p
    JOIN public.accommodation_providers prov ON prov.id = p.provider_id
   WHERE p.id = p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  v_req := COALESCE(v_prop.connection_fee_required, false)
           AND COALESCE((v_cfg->>'enabled')::boolean, false);

  v_provider := public.acc_my_provider_id();
  v_allowed := public.is_platform_admin()
    OR v_prop.provider_user_id = v_uid
    OR EXISTS (
         SELECT 1 FROM public.caretaker_property_assignments a
          WHERE a.property_id = p_property_id
            AND a.caretaker_provider_id = v_provider AND a.status = 'active'
       )
    OR NOT v_req
    OR EXISTS (
         SELECT 1 FROM public.accommodation_connection_fees f
          WHERE f.property_id = p_property_id AND f.student_id = v_uid
            AND f.status <> 'refunded'
       );

  RETURN jsonb_build_object(
    'required',   v_req,
    'allowed',    v_allowed,
    'fee_kobo',   CASE WHEN v_req AND NOT v_allowed THEN COALESCE((v_cfg->>'amount_kobo')::bigint, 0) ELSE 0 END,
    'currency',   COALESCE(v_cfg->>'currency', 'NGN'),
    'title',      v_prop.title,
    'provider_name',    COALESCE(NULLIF(v_prop.business_name, ''), v_prop.full_name),
    'address_landmark', v_prop.address_landmark,
    'contact_phone',  CASE WHEN v_allowed THEN v_prop.contact_phone ELSE NULL END,
    'contact_whatsapp', CASE WHEN v_allowed THEN v_prop.contact_whatsapp ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_admin_update_connection_fee(
  p_enabled    BOOLEAN,
  p_amount_kobo BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only administrators may change the connection fee' USING ERRCODE = '42501';
  END IF;
  IF p_amount_kobo IS NOT NULL AND (p_amount_kobo < 0 OR p_amount_kobo > 100000000) THEN
    RAISE EXCEPTION 'The connection fee must be between 0 and 1,000,000 naira' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_platform_settings
     SET accommodation_connection_fee_enabled = COALESCE(p_enabled, accommodation_connection_fee_enabled),
         accommodation_connection_fee_kobo   = COALESCE(p_amount_kobo, accommodation_connection_fee_kobo),
         updated_at = now()
   WHERE id = 1;

  PERFORM public.mp_audit('connection_fee.update', 'platform_settings', NULL,
    NULL, jsonb_build_object('enabled', p_enabled, 'amount_kobo', p_amount_kobo),
    'Accommodation connection fee updated', 'admin');

  RETURN public.acc_connection_fee_config();
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Provider can manage their own listing photos in storage (was admin-only)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can upload accommodation images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update accommodation images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete accommodation images" ON storage.objects;

CREATE POLICY "Provider can upload accommodation images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'accommodation-images'
    AND (
      public.is_admin()
      OR (owner = auth.uid() AND name LIKE 'providers/' || auth.uid()::text || '/%')
    )
  );

CREATE POLICY "Provider can update accommodation images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'accommodation-images'
    AND (public.is_admin() OR (owner = auth.uid() AND name LIKE 'providers/' || auth.uid()::text || '/%'))
  );

CREATE POLICY "Provider can delete accommodation images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'accommodation-images'
    AND (public.is_admin() OR (owner = auth.uid() AND name LIKE 'providers/' || auth.uid()::text || '/%'))
  );

-- -----------------------------------------------------------------------------
-- 5. Updated write-path RPCs (photo slots + connection flag)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acc_save_property(
  p_property_id       UUID,
  p_title             TEXT,
  p_description       TEXT,
  p_location_area     TEXT,
  p_address_landmark  TEXT,
  p_property_type     TEXT,
  p_rent_amount_kobo  BIGINT,
  p_rent_period       TEXT,
  p_total_units       INTEGER,
  p_available_units   INTEGER,
  p_availability_status TEXT,
  p_images            TEXT[],
  p_amenities         TEXT[],
  p_contact_phone     TEXT,
  p_distance_to_campus TEXT DEFAULT NULL,
  p_caution_deposit_kobo BIGINT DEFAULT 0,
  p_service_charge_kobo  BIGINT DEFAULT 0,
  p_rules_notes       TEXT DEFAULT NULL,
  p_contact_whatsapp  TEXT DEFAULT NULL,
  p_photo_slots       JSONB DEFAULT NULL,
  p_connection_fee_required BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_provider UUID;
  v_role     public.app_role;
  v_prop     public.accommodation_properties%ROWTYPE;
  v_annual   BIGINT;
  v_fee      BIGINT;
  v_new_fee  BIGINT;
  v_cfg      JSONB;
  v_owner    BOOLEAN := false;
  v_assigned public.caretaker_property_assignments%ROWTYPE;
  v_slug     TEXT;
  v_images   TEXT[];
  v_locked_fee BIGINT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage listings' USING ERRCODE = '28000';
  END IF;

  v_provider := public.acc_my_provider_id();
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'Register as a landlord or caretaker first' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  IF length(trim(COALESCE(p_title, ''))) < 5 THEN
    RAISE EXCEPTION 'Give the listing a title of at least 5 characters' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(p_description, ''))) < 20 THEN
    RAISE EXCEPTION 'Describe the accommodation in at least 20 characters' USING ERRCODE = '22023';
  END IF;
  IF length(regexp_replace(COALESCE(p_contact_phone, ''), '[^0-9]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'Enter a valid contact phone number' USING ERRCODE = '22023';
  END IF;
  IF p_location_area IS NULL OR p_property_type IS NULL THEN
    RAISE EXCEPTION 'Choose a location and property type' USING ERRCODE = '22023';
  END IF;
  v_annual := public.acc_annual_rent_kobo(p_rent_amount_kobo, p_rent_period);
  IF v_annual IS NULL OR v_annual <= 0 THEN
    RAISE EXCEPTION 'Enter the advertised rent and choose a valid rent period' USING ERRCODE = '22023';
  END IF;
  IF p_total_units IS NOT NULL AND p_total_units < 0 THEN
    RAISE EXCEPTION 'Total units cannot be negative' USING ERRCODE = '22023';
  END IF;

  -- Generalized photo arrays from categorized slots when supplied, so the
  -- existing images[:] browse/gallery path and the photo_slots path stay in sync.
  v_images := CASE
                WHEN p_photo_slots IS NOT NULL THEN public.acc_slot_urls(p_photo_slots)
                ELSE COALESCE(p_images, '{}'::TEXT[])
              END;

  v_cfg := public.acc_advert_settings();

  IF p_property_id IS NULL THEN
    IF v_role <> 'landlord' THEN
      RAISE EXCEPTION 'Only landlords can create new listings. Ask the owner to assign you a property.'
        USING ERRCODE = '42501';
    END IF;

    v_slug := COALESCE(NULLIF(public.acc_slugify(p_title), ''), 'listing')
              || '-' || substr(md5(random()::text), 1, 6);

    INSERT INTO public.accommodation_properties (
      provider_id, title, slug, description, location_area, address_landmark,
      distance_to_campus, property_type, price_annual, caution_deposit, service_charge,
      total_units, available_units, availability_status, images, amenities,
      rules_notes, contact_phone, contact_whatsapp, rent_period, advert_rent_kobo,
      photo_slots, connection_fee_required
    ) VALUES (
      v_provider, trim(p_title), v_slug, trim(p_description), p_location_area,
      trim(p_address_landmark), NULLIF(trim(COALESCE(p_distance_to_campus, '')), ''),
      p_property_type, (v_annual / 100.0),
      COALESCE(p_caution_deposit_kobo, 0) / 100.0, COALESCE(p_service_charge_kobo, 0) / 100.0,
      COALESCE(p_total_units, 1), COALESCE(p_available_units, COALESCE(p_total_units, 1)),
      COALESCE(p_availability_status, 'available'),
      v_images, COALESCE(p_amenities, '{}'::TEXT[]),
      NULLIF(trim(COALESCE(p_rules_notes, '')), ''), trim(p_contact_phone),
      NULLIF(trim(COALESCE(p_contact_whatsapp, '')), ''), lower(trim(p_rent_period)), v_annual,
      COALESCE(p_photo_slots, '[]'::JSONB),
      COALESCE(p_connection_fee_required, false)
    ) RETURNING * INTO v_prop;
  ELSE
    SELECT * INTO v_prop FROM public.accommodation_properties WHERE id = p_property_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_prop.provider_id = v_provider THEN
      v_owner := true;
    ELSE
      SELECT * INTO v_assigned FROM public.caretaker_property_assignments
       WHERE property_id = p_property_id AND caretaker_provider_id = v_provider AND status = 'active';
      IF NOT FOUND OR NOT v_assigned.can_edit_details THEN
        RAISE EXCEPTION 'You are not authorised to edit this listing' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF v_prop.moderation_status = 'pending_review' THEN
      RAISE EXCEPTION 'This listing is awaiting review and cannot be edited yet' USING ERRCODE = '22023';
    END IF;

    v_new_fee := public.acc_advert_fee_kobo(v_annual, (v_cfg->>'fee_bps')::INTEGER);
    SELECT fee_kobo INTO v_locked_fee
      FROM public.accommodation_advert_payments
     WHERE property_id = p_property_id AND payment_status = 'captured'
     ORDER BY created_at DESC LIMIT 1;
    v_locked_fee := COALESCE(v_locked_fee, 0);

    IF v_new_fee > v_locked_fee THEN
      PERFORM public.acc_charge_fee_delta(p_property_id, v_provider, v_uid, v_annual, v_new_fee - v_locked_fee);
    END IF;

    UPDATE public.accommodation_properties SET
      title = trim(p_title),
      description = trim(p_description),
      location_area = p_location_area,
      address_landmark = trim(p_address_landmark),
      distance_to_campus = NULLIF(trim(COALESCE(p_distance_to_campus, '')), ''),
      property_type = p_property_type,
      price_annual = (v_annual / 100.0),
      caution_deposit = COALESCE(p_caution_deposit_kobo, 0) / 100.0,
      service_charge = COALESCE(p_service_charge_kobo, 0) / 100.0,
      total_units = COALESCE(p_total_units, total_units),
      available_units = COALESCE(p_available_units, available_units),
      availability_status = COALESCE(p_availability_status, availability_status),
      images = CASE WHEN p_photo_slots IS NOT NULL THEN public.acc_slot_urls(p_photo_slots)
                    ELSE COALESCE(p_images, images) END,
      photo_slots = COALESCE(p_photo_slots, photo_slots),
      connection_fee_required = COALESCE(p_connection_fee_required, connection_fee_required),
      amenities = COALESCE(p_amenities, amenities),
      rules_notes = NULLIF(trim(COALESCE(p_rules_notes, '')), ''),
      contact_phone = trim(p_contact_phone),
      contact_whatsapp = NULLIF(trim(COALESCE(p_contact_whatsapp, '')), ''),
      rent_period = lower(trim(p_rent_period)),
      advert_rent_kobo = v_annual
    WHERE id = p_property_id
    RETURNING * INTO v_prop;
  END IF;

  v_fee := public.acc_advert_fee_kobo(v_prop.advert_rent_kobo, (v_cfg->>'fee_bps')::INTEGER);

  PERFORM public.mp_audit('property.save', 'accommodation_property', v_prop.id,
    NULL, jsonb_build_object('moderation_status', v_prop.moderation_status, 'annual_rent_kobo', v_prop.advert_rent_kobo),
    'Listing saved as draft', 'provider');

  RETURN jsonb_build_object(
    'ok', true,
    'property_id', v_prop.id,
    'moderation_status', v_prop.moderation_status,
    'is_published', v_prop.is_published,
    'annual_rent_kobo', v_prop.advert_rent_kobo,
    'fee_bps', (v_cfg->>'fee_bps')::INTEGER,
    'fee_kobo', v_fee,
    'currency', v_cfg->>'currency',
    'photos_complete', v_prop.photos_complete,
    'connection_fee_required', v_prop.connection_fee_required
  );
END;
$$;

-- Submit: the four categorized photos are now REQUIRED, not merely present.
CREATE OR REPLACE FUNCTION public.acc_submit_advert(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_provider UUID;
  v_role     public.app_role;
  v_vstatus  TEXT;
  v_prop     public.accommodation_properties%ROWTYPE;
  v_assigned public.caretaker_property_assignments%ROWTYPE;
  v_cfg      JSONB;
  v_annual   BIGINT;
  v_fee      BIGINT;
  v_wallet   UUID;
  v_avail    BIGINT;
  v_cycle    INTEGER;
  v_pay      UUID;
  v_ref      TEXT;
  v_meta     JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to submit a listing' USING ERRCODE = '28000';
  END IF;

  v_provider := public.acc_my_provider_id();
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'Register as a landlord or caretaker first' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  SELECT verification_status INTO v_vstatus
    FROM public.accommodation_providers WHERE id = v_provider;

  IF v_vstatus = 'suspended' THEN
    RAISE EXCEPTION 'Your account is suspended. Contact support.' USING ERRCODE = '42501';
  END IF;
  IF v_vstatus <> 'verified' THEN
    RAISE EXCEPTION 'Your account must be verified before you can advertise' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.accommodation_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_prop.provider_id = v_provider THEN
    NULL; -- owner
  ELSE
    SELECT * INTO v_assigned FROM public.caretaker_property_assignments
     WHERE property_id = p_property_id AND caretaker_provider_id = v_provider AND status = 'active';
    IF NOT FOUND OR NOT v_assigned.can_create_advert THEN
      RAISE EXCEPTION 'You are not authorised to advertise this property' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_prop.moderation_status = 'pending_review' THEN
    RAISE EXCEPTION 'This listing is already awaiting review' USING ERRCODE = '22023';
  END IF;
  IF v_prop.moderation_status = 'approved' AND v_prop.is_published THEN
    RAISE EXCEPTION 'This listing is already live' USING ERRCODE = '22023';
  END IF;

  -- Part 1: every submitted listing needs the four required category photos.
  IF NOT COALESCE(v_prop.photos_complete, false) THEN
    RAISE EXCEPTION 'Every listing needs a photo for each required category: main room, toilet, kitchen and front view.'
      USING ERRCODE = '22023';
  END IF;

  v_cfg := public.acc_advert_settings();
  IF NOT COALESCE((v_cfg->>'enabled')::BOOLEAN, true) THEN
    RAISE EXCEPTION 'New advertisement submissions are temporarily disabled' USING ERRCODE = '22023';
  END IF;

  v_annual := COALESCE(v_prop.advert_rent_kobo, public.acc_annual_rent_kobo((v_prop.price_annual * 100)::BIGINT, 'annual'));
  IF v_annual IS NULL OR v_annual <= 0 THEN
    RAISE EXCEPTION 'Set a valid advertised rent before submitting' USING ERRCODE = '22023';
  END IF;
  v_fee := public.acc_advert_fee_kobo(v_annual, (v_cfg->>'fee_bps')::INTEGER);

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_uid);
  SELECT available_kobo INTO v_avail FROM public.marketplace_wallets WHERE id = v_wallet FOR UPDATE;

  IF v_avail < v_fee THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS|needed=%|available=%|shortfall=%',
      v_fee, v_avail, (v_fee - v_avail) USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(moderation_cycle), 0) + 1 INTO v_cycle
    FROM public.accommodation_advert_payments WHERE property_id = p_property_id;
  v_ref := 'acc_adv_' || replace(gen_random_uuid()::TEXT, '-', '');
  v_meta := jsonb_build_object('property_id', p_property_id, 'cycle', v_cycle,
                               'annual_rent_kobo', v_annual, 'fee_bps', (v_cfg->>'fee_bps')::INTEGER);

  INSERT INTO public.accommodation_advert_payments (
    property_id, provider_id, payer_user_id, annual_rent_kobo, fee_bps, fee_kobo,
    currency, payment_status, moderation_cycle, reservation_ref, reserve_idempotency_key
  ) VALUES (
    p_property_id, v_prop.provider_id, v_uid, v_annual, (v_cfg->>'fee_bps')::INTEGER, v_fee,
    v_cfg->>'currency', 'reserved', v_cycle, v_ref,
    'accadvert:' || p_property_id::TEXT || ':' || v_cycle || ':reserve'
  ) RETURNING id INTO v_pay;

  IF v_fee > 0 THEN
    PERFORM public.mp_wallet_post(v_wallet, 'debit', 'available', v_fee, 'advert_hold',
      'accommodation_advert', v_pay, 'accadvert:' || v_pay::TEXT || ':hold:avail',
      'Advertisement fee reserved pending review', v_meta, v_uid);
    PERFORM public.mp_wallet_post(v_wallet, 'credit', 'pending', v_fee, 'advert_hold',
      'accommodation_advert', v_pay, 'accadvert:' || v_pay::TEXT || ':hold:pending',
      'Advertisement fee reserved pending review', v_meta, v_uid);
  END IF;

  PERFORM set_config('fuw.acc_state_change', '1', true);
  UPDATE public.accommodation_properties
     SET moderation_status = 'pending_review',
         submitted_at = now(),
         advert_rent_kobo = v_annual,
         moderation_note = NULL
   WHERE id = p_property_id;

  PERFORM public.mp_audit('advert.submit', 'accommodation_advert', v_pay,
    NULL, jsonb_build_object('fee_kobo', v_fee, 'annual_rent_kobo', v_annual, 'cycle', v_cycle),
    'Listing submitted for review', 'provider');

  PERFORM public.queue_notification(
    v_uid, 'Funds reserved for review',
    format('%s was reserved for your listing while it is reviewed.', to_char(v_fee / 100.0, 'FM999,999,999')),
    'info', '/provider?tab=wallet', 'payments', 'acc_reserved_' || v_pay::TEXT
  );

  RETURN jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'payment_id', v_pay,
    'moderation_status', 'pending_review',
    'annual_rent_kobo', v_annual,
    'fee_bps', (v_cfg->>'fee_bps')::INTEGER,
    'fee_kobo', v_fee,
    'currency', v_cfg->>'currency',
    'reservation_ref', v_ref
  );
END;
$$;

-- Defense in depth: an administrator cannot publish a listing that somehow
-- reached review without the required category photos.
CREATE OR REPLACE FUNCTION public.acc_admin_review_advert(
  p_property_id UUID,
  p_decision    TEXT,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prop   public.accommodation_properties%ROWTYPE;
  v_pay    public.accommodation_advert_payments%ROWTYPE;
  v_wallet UUID;
  v_d      TEXT := lower(trim(COALESCE(p_decision, '')));
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You do not have permission to review listings' USING ERRCODE = '42501';
  END IF;
  IF v_d NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE = '22023';
  END IF;
  IF v_d = 'reject' AND length(trim(COALESCE(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prop FROM public.accommodation_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_pay FROM public.accommodation_advert_payments
   WHERE property_id = p_property_id AND payment_status = 'reserved'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF v_d = 'approve' THEN
    IF NOT COALESCE(v_prop.photos_complete, false) THEN
      RAISE EXCEPTION 'This listing is missing required category photos (main room, toilet, kitchen, front view)'
        USING ERRCODE = '22023';
    END IF;
    IF v_pay.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.accommodation_advert_payments
                  WHERE property_id = p_property_id AND payment_status = 'captured') THEN
        RAISE EXCEPTION 'This listing has already been approved' USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'This listing has no active reservation to capture' USING ERRCODE = '22023';
    END IF;

    IF v_pay.fee_kobo > 0 THEN
      v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_pay.payer_user_id);
      PERFORM public.mp_wallet_post(v_wallet, 'debit', 'pending', v_pay.fee_kobo, 'advert_spend',
        'accommodation_advert', v_pay.id, 'accadvert:' || v_pay.id::TEXT || ':capture',
        'Advertisement fee captured', jsonb_build_object('property_id', p_property_id), v_pay.payer_user_id);
    END IF;

    UPDATE public.accommodation_advert_payments
       SET payment_status = 'captured', captured_at = now(),
           charge_idempotency_key = 'accadvert:' || id::TEXT || ':capture',
           reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = v_pay.id;

    PERFORM set_config('fuw.acc_state_change', '1', true);
    UPDATE public.accommodation_properties
       SET moderation_status = 'approved', is_published = true,
           reviewed_by = auth.uid(), reviewed_at = now(), moderation_note = NULLIF(trim(COALESCE(p_note, '')), '')
     WHERE id = p_property_id;

    PERFORM public.queue_notification(v_pay.payer_user_id, 'Advertisement approved',
      'Your listing is now live.', 'success', '/provider?tab=listings', 'accommodation',
      'acc_approved_' || v_pay.id::TEXT);
  ELSE
    IF v_pay.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.accommodation_advert_payments
                  WHERE property_id = p_property_id AND payment_status = 'refunded') THEN
        RAISE EXCEPTION 'This listing has already been rejected' USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'This listing has no active reservation to release' USING ERRCODE = '22023';
    END IF;

    IF v_pay.fee_kobo > 0 THEN
      v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_pay.payer_user_id);
      PERFORM public.mp_wallet_post(v_wallet, 'debit', 'pending', v_pay.fee_kobo, 'advert_hold_release',
        'accommodation_advert', v_pay.id, 'accadvert:' || v_pay.id::TEXT || ':release:debit',
        'Advertisement fee released', jsonb_build_object('property_id', p_property_id), v_pay.payer_user_id);
      PERFORM public.mp_wallet_post(v_wallet, 'credit', 'available', v_pay.fee_kobo, 'advert_refund',
        'accommodation_advert', v_pay.id, 'accadvert:' || v_pay.id::TEXT || ':release:credit',
        'Advertisement fee refunded to available balance', jsonb_build_object('property_id', p_property_id), v_pay.payer_user_id);
    END IF;

    UPDATE public.accommodation_advert_payments
       SET payment_status = 'refunded', refunded_at = now(),
           refund_idempotency_key = 'accadvert:' || id::TEXT || ':release:credit',
           rejection_reason = left(trim(p_note), 500),
           reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = v_pay.id;

    PERFORM set_config('fuw.acc_state_change', '1', true);
    UPDATE public.accommodation_properties
       SET moderation_status = 'rejected', is_published = false,
           reviewed_by = auth.uid(), reviewed_at = now(), moderation_note = left(trim(p_note), 500)
     WHERE id = p_property_id;

    PERFORM public.queue_notification(v_pay.payer_user_id, 'Advertisement not approved',
      COALESCE(left(p_note, 400), 'Open your dashboard for details.'), 'warning',
      '/provider?tab=listings', 'accommodation', 'acc_rejected_' || v_pay.id::TEXT);
  END IF;

  PERFORM public.mp_audit('advert.review', 'accommodation_advert', COALESCE(v_pay.id, p_property_id),
    jsonb_build_object('decision', v_d), jsonb_build_object('property_id', p_property_id),
    p_note, 'admin');

  RETURN jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'decision', v_d,
    'fee_kobo', COALESCE(v_pay.fee_kobo, 0),
    'payment_status', CASE WHEN v_d = 'approve' THEN 'captured' ELSE 'refunded' END
  );
END;
$$;

-- Rich listing payload for the provider portal (photo slots + connection flag).
CREATE OR REPLACE FUNCTION public.acc_my_properties()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_provider UUID;
  v_rows     JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view your listings' USING ERRCODE = '28000';
  END IF;
  v_provider := public.acc_my_provider_id();

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.updated_at DESC), '[]'::JSONB) INTO v_rows
    FROM (
      SELECT p.id, p.title, p.slug, p.location_area, p.property_type, p.price_annual,
             p.description, p.address_landmark, p.contact_phone, p.contact_whatsapp,
             p.amenities, p.rules_notes, p.rent_period, p.advert_rent_kobo, p.images,
             p.photo_slots, p.photos_complete, p.connection_fee_required,
             p.availability_status, p.available_units, p.total_units, p.moderation_status,
             p.is_published, p.moderation_note, p.created_at, p.updated_at, p.provider_id,
             (p.provider_id = v_provider) AS is_owner,
             pay.payment_status, pay.fee_kobo, pay.currency
        FROM public.accommodation_properties p
        LEFT JOIN LATERAL (
          SELECT payment_status, fee_kobo, currency
            FROM public.accommodation_advert_payments ap
           WHERE ap.property_id = p.id
           ORDER BY ap.created_at DESC LIMIT 1
        ) pay ON true
       WHERE p.provider_id = v_provider
          OR EXISTS (
            SELECT 1 FROM public.caretaker_property_assignments a
             WHERE a.property_id = p.id
               AND a.caretaker_provider_id = v_provider AND a.status = 'active'
          )
       ORDER BY p.updated_at DESC
    ) s;

  RETURN jsonb_build_object('properties', v_rows);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.acc_photo_slots_complete(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acc_slot_urls(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acc_sync_photos_complete() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.acc_connection_fee_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acc_connection_fee_config() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.acc_listing_connection_fee(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acc_listing_connection_fee(UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.acc_has_connection_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acc_has_connection_access(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.acc_pay_connection_fee(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acc_pay_connection_fee(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.acc_get_contact_block(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acc_get_contact_block(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.acc_admin_update_connection_fee(BOOLEAN, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acc_admin_update_connection_fee(BOOLEAN, BIGINT) TO authenticated;

COMMENT ON FUNCTION public.acc_photo_slots_complete(JSONB) IS
  'True only when photo_slots holds exactly the four labelled categories (main_room, toilet, kitchen, front_view), each with a non-empty url.';
COMMENT ON FUNCTION public.acc_pay_connection_fee(UUID) IS
  'One-off, server-verified connection fee for a listing. Debits the wallet exactly once via the journal; a second call is a no-op that returns already=true.';
COMMENT ON FUNCTION public.acc_get_contact_block(UUID) IS
  'Masks a listing''s contact details unless the caller owns it, manages it, or has paid its connection fee. Contact fields are never returned to non-paying clients.';