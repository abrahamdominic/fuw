-- =============================================================================
-- FUW Accommodation: Landlord / Caretaker portal RPCs
-- =============================================================================
-- Every write below is a SECURITY DEFINER function. Clients never touch the
-- accommodation tables' sensitive columns directly: RLS + the guard triggers
-- reject it. Financial moves go through the existing single wallet writer
-- (mp_wallet_post), so the ledger stays the one source of truth.
--
-- Escrow-style model (internal wallet reservation, NOT an external provider):
--   reserve : available -> pending   (advert_hold x2, pessimistic hold)
--   capture : pending   -> gone      (advert_spend)
--   release : pending   -> available (advert_hold_release + advert_refund)

BEGIN;

-- =============================================================================
-- 0. HELPERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.acc_my_provider_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM public.accommodation_providers
   WHERE user_id = auth.uid()
   ORDER BY created_at
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.acc_slugify(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from regexp_replace(lower(COALESCE(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Annualise an advertised rent. Returns NULL for an unknown/ambiguous period so
-- the caller can require the user to clarify rather than guess.
CREATE OR REPLACE FUNCTION public.acc_annual_rent_kobo(
  p_rent_amount_kobo BIGINT,
  p_rent_period      TEXT
)
RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(COALESCE(p_rent_period, '')))
           WHEN 'annual'   THEN p_rent_amount_kobo
           WHEN 'semester' THEN p_rent_amount_kobo * 2
           WHEN 'monthly'  THEN p_rent_amount_kobo * 12
           ELSE NULL
         END;
$$;

-- The authoritative fee: a percentage of the annual rent, rounded to the
-- nearest whole naira (100 kobo). Zero rent yields zero fee. No hidden floor,
-- cap, tax or processing charge is added.
CREATE OR REPLACE FUNCTION public.acc_advert_fee_kobo(
  p_annual_rent_kobo BIGINT,
  p_bps              INTEGER
)
RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN COALESCE(p_annual_rent_kobo, 0) <= 0 OR COALESCE(p_bps, 0) <= 0 THEN 0
           ELSE (round((p_annual_rent_kobo::numeric * p_bps) / 10000.0 / 100.0) * 100)::BIGINT
         END;
$$;

CREATE OR REPLACE FUNCTION public.acc_advert_settings()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT accommodation_advert_fee_bps, accommodation_advert_enabled, accommodation_advert_currency
    INTO v
    FROM public.marketplace_platform_settings WHERE id = 1;
  RETURN jsonb_build_object(
    'fee_bps', COALESCE(v.accommodation_advert_fee_bps, 150),
    'enabled', COALESCE(v.accommodation_advert_enabled, true),
    'currency', COALESCE(v.accommodation_advert_currency, 'NGN')
  );
END;
$$;

-- Public fee preview used by the listing form. The client may display it but
-- never supplies an amount that the server trusts.
CREATE OR REPLACE FUNCTION public.acc_preview_advert_fee(
  p_rent_amount_kobo BIGINT,
  p_rent_period      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_annual BIGINT;
  v_cfg    JSONB;
BEGIN
  IF p_rent_amount_kobo IS NULL OR p_rent_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'Enter an advertised rent greater than zero' USING ERRCODE = '22023';
  END IF;
  v_annual := public.acc_annual_rent_kobo(p_rent_amount_kobo, p_rent_period);
  IF v_annual IS NULL THEN
    RAISE EXCEPTION 'Choose a valid rent period (annual, semester or monthly)' USING ERRCODE = '22023';
  END IF;
  v_cfg := public.acc_advert_settings();
  RETURN jsonb_build_object(
    'ok', true,
    'rent_amount_kobo', p_rent_amount_kobo,
    'rent_period', lower(trim(p_rent_period)),
    'annual_rent_kobo', v_annual,
    'fee_bps', (v_cfg->>'fee_bps')::INTEGER,
    'fee_kobo', public.acc_advert_fee_kobo(v_annual, (v_cfg->>'fee_bps')::INTEGER),
    'currency', v_cfg->>'currency',
    'enabled', (v_cfg->>'enabled')::BOOLEAN
  );
END;
$$;

-- =============================================================================
-- 1. PROVIDER REGISTRATION / ROLE ASSIGNMENT
-- =============================================================================
CREATE OR REPLACE FUNCTION public.acc_register_provider(
  p_account_type              TEXT,
  p_full_name                 TEXT,
  p_phone                     TEXT,
  p_state                     TEXT DEFAULT NULL,
  p_lga                       TEXT DEFAULT NULL,
  p_town                      TEXT DEFAULT NULL,
  p_address                   TEXT DEFAULT NULL,
  p_preferred_contact         TEXT DEFAULT NULL,
  p_ownership_status          TEXT DEFAULT NULL,
  p_properties_count          INTEGER DEFAULT NULL,
  p_intended_location         TEXT DEFAULT NULL,
  p_advert_rent_kobo          BIGINT DEFAULT NULL,
  p_business_name             TEXT DEFAULT NULL,
  p_owns_property             BOOLEAN DEFAULT NULL,
  p_property_available        BOOLEAN DEFAULT NULL,
  p_owner_name                TEXT DEFAULT NULL,
  p_authorized_to_advertise   BOOLEAN DEFAULT NULL,
  p_authorized_properties     TEXT DEFAULT NULL,
  p_authorization_scope_edit  BOOLEAN DEFAULT NULL,
  p_authorization_scope_rented BOOLEAN DEFAULT NULL,
  p_identity_document_path    TEXT DEFAULT NULL,
  p_ownership_evidence_path   TEXT DEFAULT NULL,
  p_authorization_evidence_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_role     public.app_role;
  v_type     TEXT := lower(trim(COALESCE(p_account_type, '')));
  v_provider UUID;
  v_existing public.accommodation_providers%ROWTYPE;
  v_verified TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to register a landlord or caretaker account' USING ERRCODE = '28000';
  END IF;

  -- Only the two non-privileged roles may be self-assigned. Anything else is
  -- rejected here, so a crafted request cannot mint an administrator.
  IF v_type NOT IN ('landlord', 'caretaker') THEN
    RAISE EXCEPTION 'Choose Landlord or Caretaker' USING ERRCODE = '22023';
  END IF;

  IF length(trim(COALESCE(p_full_name, ''))) < 3 THEN
    RAISE EXCEPTION 'Enter your full legal name' USING ERRCODE = '22023';
  END IF;
  IF length(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'Enter a valid phone number' USING ERRCODE = '22023';
  END IF;
  IF p_preferred_contact IS NOT NULL
     AND lower(trim(p_preferred_contact)) NOT IN ('phone','whatsapp','email','sms') THEN
    RAISE EXCEPTION 'Choose a valid preferred contact method' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IN ('admin', 'super_admin', 'lecturer') THEN
    RAISE EXCEPTION 'This account cannot be converted to a landlord or caretaker' USING ERRCODE = '42501';
  END IF;

  -- A rejected application is re-opened as pending on resubmission.
  SELECT * INTO v_existing FROM public.accommodation_providers WHERE user_id = v_uid FOR UPDATE;
  v_verified := CASE
    WHEN v_existing.id IS NULL THEN 'pending_verification'
    WHEN v_existing.verification_status IN ('rejected') THEN 'pending_verification'
    ELSE v_existing.verification_status
  END;

  -- The trusted RPC is allowed to set application fields the guard trigger
  -- otherwise freezes for direct client writes.
  PERFORM set_config('fuw.acc_provider_rpc', '1', true);

  INSERT INTO public.accommodation_providers (
    user_id, full_name, business_name, provider_type, phone, whatsapp, office_address,
    state, lga, town, address, preferred_contact_method, ownership_status,
    properties_count, intended_location, advert_rent_kobo,
    verification_status, application_submitted_at
  ) VALUES (
    v_uid, trim(p_full_name), NULLIF(trim(COALESCE(p_business_name, '')), ''),
    v_type, trim(p_phone), NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_address, '')), ''),
    NULLIF(trim(COALESCE(p_state, '')), ''), NULLIF(trim(COALESCE(p_lga, '')), ''),
    NULLIF(trim(COALESCE(p_town, '')), ''), NULLIF(trim(COALESCE(p_address, '')), ''),
    NULLIF(lower(trim(COALESCE(p_preferred_contact, ''))), ''),
    NULLIF(trim(COALESCE(p_ownership_status, '')), ''),
    p_properties_count, NULLIF(trim(COALESCE(p_intended_location, '')), ''),
    p_advert_rent_kobo,
    v_verified, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name               = EXCLUDED.full_name,
    business_name           = EXCLUDED.business_name,
    provider_type           = EXCLUDED.provider_type,
    phone                   = EXCLUDED.phone,
    whatsapp                = EXCLUDED.whatsapp,
    office_address          = EXCLUDED.office_address,
    state                   = EXCLUDED.state,
    lga                     = EXCLUDED.lga,
    town                    = EXCLUDED.town,
    address                 = EXCLUDED.address,
    preferred_contact_method = EXCLUDED.preferred_contact_method,
    ownership_status        = EXCLUDED.ownership_status,
    properties_count        = EXCLUDED.properties_count,
    intended_location       = EXCLUDED.intended_location,
    advert_rent_kobo        = EXCLUDED.advert_rent_kobo,
    authorization_evidence_path = COALESCE(EXCLUDED.authorization_evidence_path, public.accommodation_providers.authorization_evidence_path),
    verification_status     = CASE
                                WHEN public.accommodation_providers.verification_status = 'rejected'
                                THEN 'pending_verification'
                                ELSE public.accommodation_providers.verification_status
                              END,
    rejection_reason        = CASE
                                WHEN public.accommodation_providers.verification_status = 'rejected'
                                THEN NULL
                                ELSE public.accommodation_providers.rejection_reason
                              END,
    application_submitted_at = CASE
                                WHEN public.accommodation_providers.verification_status = 'rejected'
                                THEN now()
                                ELSE public.accommodation_providers.application_submitted_at
                              END
  RETURNING id INTO v_provider;

  UPDATE public.accommodation_providers
     SET identity_document_path      = COALESCE(NULLIF(trim(COALESCE(p_identity_document_path, '')), ''), identity_document_path),
         ownership_evidence_path     = COALESCE(NULLIF(trim(COALESCE(p_ownership_evidence_path, '')), ''), ownership_evidence_path),
         authorization_evidence_path = COALESCE(NULLIF(trim(COALESCE(p_authorization_evidence_path, '')), ''), authorization_evidence_path)
   WHERE id = v_provider;

  -- Assign the non-privileged role. The WHERE guard means an administrator can
  -- never be demoted through this path.
  UPDATE public.profiles
     SET role = v_type::public.app_role,
         updated_at = now()
   WHERE id = v_uid
     AND role IN ('student', 'landlord', 'caretaker');

  -- Make sure the wallet exists so funding and reservations have a home.
  PERFORM public.mp_wallet_ensure(p_owner_user_id => v_uid);

  PERFORM public.queue_notification(
    v_uid,
    'Application received',
    'Your ' || initcap(v_type) || ' application is being reviewed. You will be notified once a decision is made.',
    'info',
    '/provider',
    'accommodation',
    'acc_application_received_' || v_provider::TEXT
  );

  PERFORM public.mp_audit('provider.register', 'accommodation_provider', v_provider,
    NULL, jsonb_build_object('account_type', v_type, 'verification_status', v_verified),
    'Provider application submitted', v_type);

  RETURN jsonb_build_object(
    'ok', true,
    'provider_id', v_provider,
    'account_type', v_type,
    'verification_status', v_verified
  );
END;
$$;

-- =============================================================================
-- 2. SAVE / EDIT PROPERTY (DRAFT)
-- =============================================================================
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
  p_contact_whatsapp  TEXT DEFAULT NULL
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

  -- Basic server-side validation.
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

  v_cfg := public.acc_advert_settings();

  IF p_property_id IS NULL THEN
    -- New listings may only be created by landlords. Caretakers manage
    -- properties that have been explicitly assigned to them.
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
      rules_notes, contact_phone, contact_whatsapp, rent_period, advert_rent_kobo
    ) VALUES (
      v_provider, trim(p_title), v_slug, trim(p_description), p_location_area,
      trim(p_address_landmark), NULLIF(trim(COALESCE(p_distance_to_campus, '')), ''),
      p_property_type, (v_annual / 100.0),
      COALESCE(p_caution_deposit_kobo, 0) / 100.0, COALESCE(p_service_charge_kobo, 0) / 100.0,
      COALESCE(p_total_units, 1), COALESCE(p_available_units, COALESCE(p_total_units, 1)),
      COALESCE(p_availability_status, 'available'),
      COALESCE(p_images, '{}'::TEXT[]), COALESCE(p_amenities, '{}'::TEXT[]),
      NULLIF(trim(COALESCE(p_rules_notes, '')), ''), trim(p_contact_phone),
      NULLIF(trim(COALESCE(p_contact_whatsapp, '')), ''), lower(trim(p_rent_period)), v_annual
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

    -- Rent increase on an already-paid listing: collect the fee difference
    -- before applying the new rent. A decrease is not refunded.
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
      images = COALESCE(p_images, images),
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
    'currency', v_cfg->>'currency'
  );
END;
$$;

-- Internal: charge the difference when an approved listing's rent rises.
CREATE OR REPLACE FUNCTION public.acc_charge_fee_delta(
  p_property_id UUID,
  p_provider_id UUID,
  p_uid         UUID,
  p_annual_kobo BIGINT,
  p_delta_kobo  BIGINT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_wallet UUID;
  v_avail  BIGINT;
  v_pay    UUID;
  v_cycle  INTEGER;
  v_meta   JSONB;
BEGIN
  IF p_delta_kobo <= 0 THEN RETURN; END IF;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => p_uid);
  SELECT available_kobo INTO v_avail FROM public.marketplace_wallets WHERE id = v_wallet;
  IF v_avail < p_delta_kobo THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS|needed=%|available=%|shortfall=%',
      p_delta_kobo, v_avail, (p_delta_kobo - v_avail) USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(moderation_cycle), 0) + 1 INTO v_cycle
    FROM public.accommodation_advert_payments WHERE property_id = p_property_id;

  v_meta := jsonb_build_object('kind', 'rent_increase');

  INSERT INTO public.accommodation_advert_payments (
    property_id, provider_id, payer_user_id, annual_rent_kobo, fee_bps, fee_kobo,
    currency, payment_status, moderation_cycle, reservation_ref,
    reserve_idempotency_key, charge_idempotency_key, reserved_at, captured_at
  )
  SELECT p_property_id, p_provider_id, p_uid, p_annual_kobo,
         COALESCE(accommodation_advert_fee_bps, 150), p_delta_kobo,
         COALESCE(accommodation_advert_currency, 'NGN'), 'captured', v_cycle,
         'acc_delta_' || gen_random_uuid()::TEXT,
         'accadvert:delta:' || p_property_id::TEXT || ':' || v_cycle || ':hold',
         'accadvert:delta:' || p_property_id::TEXT || ':' || v_cycle || ':charge',
         now(), now()
    FROM public.marketplace_platform_settings WHERE id = 1
  RETURNING id INTO v_pay;

  PERFORM public.mp_wallet_post(v_wallet, 'debit', 'available', p_delta_kobo, 'advert_spend',
    'accommodation_advert', v_pay, 'accadvert:delta:' || p_property_id::TEXT || ':' || v_cycle || ':charge',
    'Additional advert fee for a rent increase', v_meta, p_uid);

  PERFORM public.mp_audit('advert.rent_increase_charged', 'accommodation_advert', v_pay,
    NULL, jsonb_build_object('delta_kobo', p_delta_kobo), 'Rent increase fee difference collected', 'provider');
END;
$$;

-- =============================================================================
-- 3. SUBMIT FOR MODERATION (RESERVE FEE)
-- =============================================================================
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

  -- Only verified, non-suspended providers may publish paid advertisements.
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
  IF COALESCE(array_length(v_prop.images, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Add at least one photo before submitting' USING ERRCODE = '22023';
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

  -- Reserve from the payer's (the submitting user's) own wallet.
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

  -- Idempotent reservation record. The partial unique index guarantees a single
  -- live reservation per property even under concurrent submits.
  INSERT INTO public.accommodation_advert_payments (
    property_id, provider_id, payer_user_id, annual_rent_kobo, fee_bps, fee_kobo,
    currency, payment_status, moderation_cycle, reservation_ref, reserve_idempotency_key
  ) VALUES (
    p_property_id, v_prop.provider_id, v_uid, v_annual, (v_cfg->>'fee_bps')::INTEGER, v_fee,
    v_cfg->>'currency', 'reserved', v_cycle, v_ref,
    'accadvert:' || p_property_id::TEXT || ':' || v_cycle || ':reserve'
  ) RETURNING id INTO v_pay;

  IF v_fee > 0 THEN
    -- available -> pending (hold). Two journal legs, one transfer group.
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

-- =============================================================================
-- 4. ADMIN REVIEW (CAPTURE / RELEASE)
-- =============================================================================
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
    IF v_pay.id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.accommodation_advert_payments
                  WHERE property_id = p_property_id AND payment_status = 'captured') THEN
        RAISE EXCEPTION 'This listing has already been approved' USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'This listing has no active reservation to capture' USING ERRCODE = '22023';
    END IF;

    IF v_pay.fee_kobo > 0 THEN
      v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_pay.payer_user_id);
      -- pending -> out. Exactly once: the key is derived from the payment row.
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
      -- pending -> available (release). Both legs are idempotent.
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

-- =============================================================================
-- 5. PROPERTY LIFECYCLE
-- =============================================================================
CREATE OR REPLACE FUNCTION public.acc_set_property_state(
  p_property_id UUID,
  p_action      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_provider UUID;
  v_action   TEXT := lower(trim(COALESCE(p_action, '')));
  v_prop     public.accommodation_properties%ROWTYPE;
  v_assigned public.caretaker_property_assignments%ROWTYPE;
  v_owner    BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage listings' USING ERRCODE = '28000';
  END IF;
  IF v_action NOT IN ('rented', 'removed') THEN
    RAISE EXCEPTION 'Choose rented or removed' USING ERRCODE = '22023';
  END IF;

  v_provider := public.acc_my_provider_id();
  SELECT * INTO v_prop FROM public.accommodation_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  IF public.is_platform_admin() OR v_prop.provider_id = v_provider THEN
    v_owner := true;
  ELSE
    SELECT * INTO v_assigned FROM public.caretaker_property_assignments
     WHERE property_id = p_property_id AND caretaker_provider_id = v_provider AND status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You are not authorised to manage this listing' USING ERRCODE = '42501';
    END IF;
    IF v_action = 'rented' AND NOT v_assigned.can_mark_rented THEN
      RAISE EXCEPTION 'You are not authorised to mark this property as rented' USING ERRCODE = '42501';
    END IF;
    IF v_action = 'removed' AND NOT v_assigned.can_change_availability THEN
      RAISE EXCEPTION 'You are not authorised to remove this listing' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('fuw.acc_state_change', '1', true);
  IF v_action = 'rented' THEN
    UPDATE public.accommodation_properties
       SET moderation_status = 'rented', is_published = false, rented_at = now()
     WHERE id = p_property_id;
  ELSE
    -- Removing a published advert after capture never triggers a refund.
    UPDATE public.accommodation_properties
       SET moderation_status = 'removed', is_published = false
     WHERE id = p_property_id;
  END IF;

  PERFORM public.mp_audit('property.' || v_action, 'accommodation_property', p_property_id,
    jsonb_build_object('moderation_status', v_prop.moderation_status),
    jsonb_build_object('moderation_status', v_action), NULL, 'provider');

  RETURN jsonb_build_object('ok', true, 'property_id', p_property_id, 'moderation_status', v_action);
END;
$$;

-- =============================================================================
-- 6. CARETAKER ASSIGNMENTS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.acc_assign_caretaker(
  p_property_id       UUID,
  p_caretaker_email   TEXT,
  p_can_create_advert BOOLEAN DEFAULT false,
  p_can_edit_details  BOOLEAN DEFAULT false,
  p_can_manage_images BOOLEAN DEFAULT true,
  p_can_change_availability BOOLEAN DEFAULT false,
  p_can_mark_rented   BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_provider     UUID;
  v_prop         public.accommodation_properties%ROWTYPE;
  v_caretaker_id UUID;
  v_caretaker_provider UUID;
  v_assign       UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to assign caretakers' USING ERRCODE = '28000';
  END IF;
  v_provider := public.acc_my_provider_id();

  SELECT * INTO v_prop FROM public.accommodation_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_platform_admin() OR v_prop.provider_id = v_provider) THEN
    RAISE EXCEPTION 'Only the property owner can assign caretakers' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caretaker_id FROM public.profiles WHERE lower(email) = lower(trim(p_caretaker_email));
  IF v_caretaker_id IS NULL THEN
    RAISE EXCEPTION 'No account found for that email' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_caretaker_provider FROM public.accommodation_providers WHERE user_id = v_caretaker_id;
  IF v_caretaker_provider IS NULL THEN
    RAISE EXCEPTION 'That user has not registered as a caretaker or landlord' USING ERRCODE = 'P0002';
  END IF;
  IF v_caretaker_provider = v_prop.provider_id THEN
    RAISE EXCEPTION 'The owner already manages this property' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.caretaker_property_assignments (
    property_id, landlord_provider_id, caretaker_provider_id,
    can_create_advert, can_edit_details, can_manage_images,
    can_change_availability, can_mark_rented, status, created_by, revoked_at, revoked_by
  ) VALUES (
    p_property_id, v_prop.provider_id, v_caretaker_provider,
    COALESCE(p_can_create_advert, false), COALESCE(p_can_edit_details, false),
    COALESCE(p_can_manage_images, true), COALESCE(p_can_change_availability, false),
    COALESCE(p_can_mark_rented, false), 'active', v_uid, NULL, NULL
  )
  ON CONFLICT (property_id, caretaker_provider_id) DO UPDATE SET
    can_create_advert = EXCLUDED.can_create_advert,
    can_edit_details = EXCLUDED.can_edit_details,
    can_manage_images = EXCLUDED.can_manage_images,
    can_change_availability = EXCLUDED.can_change_availability,
    can_mark_rented = EXCLUDED.can_mark_rented,
    status = 'active', revoked_at = NULL, revoked_by = NULL, created_by = v_uid
  RETURNING id INTO v_assign;

  PERFORM public.queue_notification(v_caretaker_id, 'Property assignment',
    'You have been assigned a property to manage.', 'info', '/provider?tab=listings',
    'accommodation', 'acc_assign_' || v_assign::TEXT);

  PERFORM public.mp_audit('caretaker.assign', 'caretaker_assignment', v_assign,
    NULL, jsonb_build_object('property_id', p_property_id, 'caretaker_provider_id', v_caretaker_provider),
    NULL, 'provider');

  RETURN jsonb_build_object('ok', true, 'assignment_id', v_assign);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_revoke_caretaker(p_assignment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_provider UUID;
  v_a        public.caretaker_property_assignments%ROWTYPE;
  v_owner_uid UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to revoke assignments' USING ERRCODE = '28000';
  END IF;
  v_provider := public.acc_my_provider_id();

  SELECT * INTO v_a FROM public.caretaker_property_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_platform_admin() OR v_a.landlord_provider_id = v_provider) THEN
    RAISE EXCEPTION 'Only the property owner can revoke an assignment' USING ERRCODE = '42501';
  END IF;

  UPDATE public.caretaker_property_assignments
     SET status = 'revoked', revoked_at = now(), revoked_by = v_uid
   WHERE id = p_assignment_id;

  SELECT user_id INTO v_owner_uid FROM public.accommodation_providers WHERE id = v_a.caretaker_provider_id;
  IF v_owner_uid IS NOT NULL THEN
    PERFORM public.queue_notification(v_owner_uid, 'Assignment revoked',
      'A property assignment was revoked.', 'warning', '/provider?tab=listings',
      'accommodation', 'acc_revoke_' || p_assignment_id::TEXT);
  END IF;

  PERFORM public.mp_audit('caretaker.revoke', 'caretaker_assignment', p_assignment_id,
    jsonb_build_object('status', v_a.status), jsonb_build_object('status', 'revoked'), NULL, 'provider');

  RETURN jsonb_build_object('ok', true, 'assignment_id', p_assignment_id);
END;
$$;

-- =============================================================================
-- 7. ADMIN: APPLICATIONS + ADVERT QUEUE + SETTINGS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.acc_admin_list_provider_applications(
  p_status TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You do not have permission to view provider applications' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.accommodation_providers p
   WHERE p_status IS NULL OR p.verification_status = p_status;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::JSONB) INTO v_rows
    FROM (
      SELECT p.id, p.user_id, p.full_name, p.business_name, p.provider_type, p.phone,
             p.whatsapp, p.office_address, p.state, p.lga, p.town, p.address,
             p.preferred_contact_method, p.ownership_status, p.properties_count,
             p.intended_location, p.advert_rent_kobo, p.verification_status,
             p.rejection_reason, p.identity_document_path, p.ownership_evidence_path,
             p.authorization_evidence_path, p.is_suspended, p.created_at, p.updated_at,
             pr.email, pr.role
        FROM public.accommodation_providers p
        LEFT JOIN public.profiles pr ON pr.id = p.user_id
       WHERE p_status IS NULL OR p.verification_status = p_status
       ORDER BY p.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
       OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) s;

  RETURN jsonb_build_object('applications', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_admin_review_provider_application(
  p_provider_id UUID,
  p_decision    TEXT,
  p_note        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prov public.accommodation_providers%ROWTYPE;
  v_d    TEXT := lower(trim(COALESCE(p_decision, '')));
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You do not have permission to review applications' USING ERRCODE = '42501';
  END IF;
  IF v_d NOT IN ('approve', 'reject', 'suspend', 'reinstate') THEN
    RAISE EXCEPTION 'Choose approve, reject, suspend or reinstate' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prov FROM public.accommodation_providers WHERE id = p_provider_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('fuw.acc_provider_rpc', '1', true);

  IF v_d = 'approve' THEN
    UPDATE public.accommodation_providers
       SET verification_status = 'verified', is_verified = true, is_suspended = false,
           rejection_reason = NULL, reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = p_provider_id;
  ELSIF v_d = 'reject' THEN
    IF length(trim(COALESCE(p_note, ''))) < 3 THEN
      RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.accommodation_providers
       SET verification_status = 'rejected', is_verified = false,
           rejection_reason = left(trim(p_note), 500), reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = p_provider_id;
  ELSIF v_d = 'suspend' THEN
    UPDATE public.accommodation_providers
       SET verification_status = 'suspended', is_suspended = true,
           reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = p_provider_id;
  ELSE
    UPDATE public.accommodation_providers
       SET verification_status = 'verified', is_verified = true, is_suspended = false,
           reviewed_by = auth.uid(), reviewed_at = now()
     WHERE id = p_provider_id;
  END IF;

  IF v_prov.user_id IS NOT NULL THEN
    PERFORM public.queue_notification(v_prov.user_id,
      CASE v_d
        WHEN 'approve' THEN 'Application approved'
        WHEN 'reject' THEN 'Application rejected'
        WHEN 'suspend' THEN 'Account suspended'
        ELSE 'Account reinstated'
      END,
      COALESCE(left(p_note, 400), 'Open your dashboard for details.'),
      CASE WHEN v_d IN ('reject','suspend') THEN 'warning' ELSE 'success' END,
      '/provider', 'accommodation', 'acc_provider_review_' || p_provider_id::TEXT || '_' || v_d);
  END IF;

  PERFORM public.mp_audit('provider.review', 'accommodation_provider', p_provider_id,
    jsonb_build_object('verification_status', v_prov.verification_status),
    jsonb_build_object('decision', v_d), p_note, 'admin');

  RETURN jsonb_build_object('ok', true, 'provider_id', p_provider_id, 'decision', v_d);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_admin_list_adverts(
  p_status TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'You do not have permission to view adverts' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total FROM public.accommodation_properties p
   WHERE p.moderation_status <> 'draft'
     AND (p_status IS NULL OR p.moderation_status = p_status);

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.submitted_at DESC NULLS LAST), '[]'::JSONB) INTO v_rows
    FROM (
      SELECT p.id, p.title, p.slug, p.provider_id, p.moderation_status, p.is_published,
             p.rent_period, p.advert_rent_kobo, p.price_annual, p.submitted_at,
             p.reviewed_at, p.moderation_note, p.created_at,
             prov.full_name AS provider_name, prov.provider_type,
             pay.id AS payment_id, pay.payment_status, pay.fee_kobo, pay.fee_bps,
             pay.annual_rent_kobo, pay.reservation_ref, pay.refunded_at, pay.captured_at,
             pay.payer_user_id
        FROM public.accommodation_properties p
        LEFT JOIN public.accommodation_providers prov ON prov.id = p.provider_id
        LEFT JOIN LATERAL (
          SELECT * FROM public.accommodation_advert_payments ap
           WHERE ap.property_id = p.id
           ORDER BY ap.created_at DESC LIMIT 1
        ) pay ON true
       WHERE p.moderation_status <> 'draft'
         AND (p_status IS NULL OR p.moderation_status = p_status)
       ORDER BY p.submitted_at DESC NULLS LAST
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
       OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) s;

  RETURN jsonb_build_object('adverts', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_admin_update_advert_settings(
  p_fee_bps INTEGER DEFAULT NULL,
  p_enabled BOOLEAN DEFAULT NULL,
  p_currency TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only administrators may change advertisement settings' USING ERRCODE = '42501';
  END IF;
  IF p_fee_bps IS NOT NULL AND (p_fee_bps < 0 OR p_fee_bps > 5000) THEN
    RAISE EXCEPTION 'The advertisement fee percentage must be between 0%% and 50%%' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_platform_settings
     SET accommodation_advert_fee_bps = COALESCE(p_fee_bps, accommodation_advert_fee_bps),
         accommodation_advert_enabled = COALESCE(p_enabled, accommodation_advert_enabled),
         accommodation_advert_currency = COALESCE(NULLIF(trim(COALESCE(p_currency, '')), ''), accommodation_advert_currency),
         updated_at = now()
   WHERE id = 1;

  PERFORM public.mp_audit('advert_settings.update', 'platform_settings', NULL,
    NULL, jsonb_build_object('fee_bps', p_fee_bps, 'enabled', p_enabled), NULL, 'admin');

  RETURN public.acc_advert_settings();
END;
$$;

-- =============================================================================
-- 8. READ APIS FOR THE PORTAL
-- =============================================================================
CREATE OR REPLACE FUNCTION public.acc_my_provider()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.accommodation_providers%ROWTYPE;
  v_role public.app_role;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view your provider profile' USING ERRCODE = '28000';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  SELECT * INTO v_row FROM public.accommodation_providers WHERE user_id = v_uid;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('registered', false, 'role', v_role);
  END IF;
  RETURN jsonb_build_object(
    'registered', true, 'role', v_role,
    'id', v_row.id, 'full_name', v_row.full_name, 'business_name', v_row.business_name,
    'provider_type', v_row.provider_type, 'phone', v_row.phone, 'whatsapp', v_row.whatsapp,
    'state', v_row.state, 'lga', v_row.lga, 'town', v_row.town, 'address', v_row.address,
    'preferred_contact_method', v_row.preferred_contact_method,
    'ownership_status', v_row.ownership_status, 'properties_count', v_row.properties_count,
    'intended_location', v_row.intended_location, 'advert_rent_kobo', v_row.advert_rent_kobo,
    'verification_status', v_row.verification_status, 'rejection_reason', v_row.rejection_reason,
    'is_suspended', v_row.is_suspended, 'created_at', v_row.created_at
  );
END;
$$;

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
             WHERE a.property_id = p.id AND a.caretaker_provider_id = v_provider AND a.status = 'active'
          )
       ORDER BY p.updated_at DESC
       LIMIT 500
    ) s;

  RETURN jsonb_build_object('properties', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_my_advert_payments(
  p_limit  INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view your advert payments' USING ERRCODE = '28000';
  END IF;

  SELECT count(*) INTO v_total FROM public.accommodation_advert_payments WHERE payer_user_id = v_uid;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::JSONB) INTO v_rows
    FROM (
      SELECT ap.id, ap.property_id, ap.annual_rent_kobo, ap.fee_bps, ap.fee_kobo,
             ap.currency, ap.payment_status, ap.moderation_cycle, ap.reservation_ref,
             ap.reserved_at, ap.captured_at, ap.refunded_at, ap.rejection_reason,
             ap.created_at, p.title AS property_title
        FROM public.accommodation_advert_payments ap
        LEFT JOIN public.accommodation_properties p ON p.id = ap.property_id
       WHERE ap.payer_user_id = v_uid
       ORDER BY ap.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
       OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    ) s;

  RETURN jsonb_build_object('payments', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.acc_my_assignments()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_provider UUID;
  v_rows     JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to view assignments' USING ERRCODE = '28000';
  END IF;
  v_provider := public.acc_my_provider_id();

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC), '[]'::JSONB) INTO v_rows
    FROM (
      SELECT a.id, a.property_id, a.status, a.can_create_advert, a.can_edit_details,
             a.can_manage_images, a.can_change_availability, a.can_mark_rented,
             a.created_at, a.revoked_at,
             p.title AS property_title, p.slug AS property_slug,
             cp.full_name AS caretaker_name, cp.user_id AS caretaker_user_id,
             lp.full_name AS landlord_name
        FROM public.caretaker_property_assignments a
        JOIN public.accommodation_properties p ON p.id = a.property_id
        JOIN public.accommodation_providers cp ON cp.id = a.caretaker_provider_id
        JOIN public.accommodation_providers lp ON lp.id = a.landlord_provider_id
       WHERE a.landlord_provider_id = v_provider OR a.caretaker_provider_id = v_provider
       ORDER BY a.created_at DESC
       LIMIT 500
    ) s;

  RETURN jsonb_build_object('assignments', v_rows);
END;
$$;

-- =============================================================================
-- 9. GRANTS + TRIGGER FLAG SUPPORT
-- =============================================================================
-- The provider guard must let the trusted RPC set verification fields.
CREATE OR REPLACE FUNCTION public.accommodation_provider_application_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rpc BOOLEAN := (current_setting('fuw.acc_provider_rpc', true) = '1');
BEGIN
  IF public.is_platform_admin() OR v_rpc THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending_verification';
    NEW.rejection_reason    := NULL;
    NEW.reviewed_by         := NULL;
    NEW.reviewed_at         := NULL;
    NEW.is_verified         := false;
    NEW.is_suspended        := false;
    NEW.user_id             := auth.uid();
  ELSE
    NEW.verification_status := OLD.verification_status;
    NEW.rejection_reason    := OLD.rejection_reason;
    NEW.reviewed_by         := OLD.reviewed_by;
    NEW.reviewed_at         := OLD.reviewed_at;
    NEW.is_verified         := OLD.is_verified;
    NEW.is_suspended        := OLD.is_suspended;
    NEW.user_id             := OLD.user_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Public, non-privileged reads/helpers.
GRANT EXECUTE ON FUNCTION public.acc_annual_rent_kobo(BIGINT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.acc_advert_fee_kobo(BIGINT, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.acc_advert_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_preview_advert_fee(BIGINT, TEXT) TO authenticated;

-- Authenticated provider operations. Authorization is enforced inside each.
GRANT EXECUTE ON FUNCTION public.acc_register_provider(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,BIGINT,TEXT,BOOLEAN,BOOLEAN,TEXT,BOOLEAN,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_save_property(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,INTEGER,INTEGER,TEXT,TEXT[],TEXT[],TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_submit_advert(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_set_property_state(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_assign_caretaker(UUID,TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_revoke_caretaker(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_my_provider() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_my_properties() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_my_advert_payments(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_my_assignments() TO authenticated;

-- Admin operations (gated by is_platform_admin inside).
GRANT EXECUTE ON FUNCTION public.acc_admin_review_advert(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_admin_list_provider_applications(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_admin_review_provider_application(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_admin_list_adverts(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acc_admin_update_advert_settings(INTEGER, BOOLEAN, TEXT) TO authenticated;

-- Internal writers: never reachable from a client.
REVOKE EXECUTE ON FUNCTION public.acc_charge_fee_delta(UUID, UUID, UUID, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acc_my_provider_id() FROM PUBLIC, anon;

COMMIT;
