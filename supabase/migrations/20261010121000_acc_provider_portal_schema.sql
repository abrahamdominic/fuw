-- =============================================================================
-- FUW Accommodation: Landlord / Caretaker portal schema
-- =============================================================================
-- Extends the existing accommodation platform (20261005_fuw_accommodation_platform.sql)
-- WITHOUT replacing it. Legacy listings keep working: `moderation_status`
-- defaults to 'approved' so every already-published property stays published.
--
-- Ownership continues to run through accommodation_providers.user_id, which is
-- the single source of truth for "who owns this listing". Caretakers never
-- acquire ownership; they receive explicit, revocable per-property assignments.

BEGIN;

-- =============================================================================
-- 1. PROVIDER (LANDLORD / CARETAKER) APPLICATION FIELDS
-- =============================================================================
ALTER TABLE public.accommodation_providers
  ADD COLUMN IF NOT EXISTS state                       TEXT,
  ADD COLUMN IF NOT EXISTS lga                         TEXT,
  ADD COLUMN IF NOT EXISTS town                        TEXT,
  ADD COLUMN IF NOT EXISTS address                     TEXT,
  ADD COLUMN IF NOT EXISTS preferred_contact_method    TEXT,
  ADD COLUMN IF NOT EXISTS ownership_status            TEXT,
  ADD COLUMN IF NOT EXISTS properties_count            INTEGER,
  ADD COLUMN IF NOT EXISTS intended_location           TEXT,
  ADD COLUMN IF NOT EXISTS advert_rent_kobo            BIGINT,
  ADD COLUMN IF NOT EXISTS verification_status         TEXT NOT NULL DEFAULT 'pending_verification',
  ADD COLUMN IF NOT EXISTS rejection_reason            TEXT,
  ADD COLUMN IF NOT EXISTS application_submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by                 UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_suspended                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS authorization_evidence_path TEXT,
  ADD COLUMN IF NOT EXISTS identity_document_path      TEXT,
  ADD COLUMN IF NOT EXISTS ownership_evidence_path     TEXT;

-- Backfill the new verification status from the legacy boolean.
UPDATE public.accommodation_providers
   SET verification_status = CASE WHEN is_verified THEN 'verified' ELSE 'pending_verification' END
 WHERE verification_status IS DISTINCT FROM (CASE WHEN is_verified THEN 'verified' ELSE 'pending_verification' END);

DO $$ BEGIN
  ALTER TABLE public.accommodation_providers
    ADD CONSTRAINT acc_providers_verification_status_chk
    CHECK (verification_status IN ('pending_verification','verified','rejected','suspended')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.accommodation_providers
  VALIDATE CONSTRAINT acc_providers_verification_status_chk;

DO $$ BEGIN
  ALTER TABLE public.accommodation_providers
    ADD CONSTRAINT acc_providers_contact_chk
    CHECK (preferred_contact_method IS NULL OR preferred_contact_method IN ('phone','whatsapp','email','sms')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_acc_providers_verification
  ON public.accommodation_providers (verification_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_providers_user
  ON public.accommodation_providers (user_id);

-- =============================================================================
-- 2. PROPERTY MODERATION + RENT BASIS
-- =============================================================================
-- `is_published` remains the single publication switch. `moderation_status`
-- tracks the editorial lifecycle. They are deliberately separate fields so a
-- listing is never "approved" by being published, nor published by default.
ALTER TABLE public.accommodation_properties
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS moderation_note   TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rented_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rent_period       TEXT NOT NULL DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS advert_rent_kobo  BIGINT;

DO $$ BEGIN
  ALTER TABLE public.accommodation_properties
    ADD CONSTRAINT acc_properties_moderation_status_chk
    CHECK (moderation_status IN ('draft','submitted','pending_review','approved','rejected','rented','removed')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.accommodation_properties
  VALIDATE CONSTRAINT acc_properties_moderation_status_chk;

DO $$ BEGIN
  ALTER TABLE public.accommodation_properties
    ADD CONSTRAINT acc_properties_rent_period_chk
    CHECK (rent_period IN ('annual','semester','monthly')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.accommodation_properties
  VALIDATE CONSTRAINT acc_properties_rent_period_chk;

CREATE INDEX IF NOT EXISTS idx_acc_properties_provider ON public.accommodation_properties (provider_id);
CREATE INDEX IF NOT EXISTS idx_acc_properties_moderation
  ON public.accommodation_properties (moderation_status, updated_at DESC);

-- =============================================================================
-- 3. CARETAKER PROPERTY ASSIGNMENTS
-- =============================================================================
-- Access is granted per property and per capability. A caretaker who is
-- assigned a property still cannot edit another landlord's property, cannot
-- change ownership, and loses access the moment the row is revoked.
CREATE TABLE IF NOT EXISTS public.caretaker_property_assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES public.accommodation_properties(id) ON DELETE CASCADE,
  landlord_provider_id  UUID NOT NULL REFERENCES public.accommodation_providers(id) ON DELETE CASCADE,
  caretaker_provider_id UUID NOT NULL REFERENCES public.accommodation_providers(id) ON DELETE CASCADE,
  can_create_advert     BOOLEAN NOT NULL DEFAULT false,
  can_edit_details      BOOLEAN NOT NULL DEFAULT false,
  can_manage_images     BOOLEAN NOT NULL DEFAULT true,
  can_change_availability BOOLEAN NOT NULL DEFAULT false,
  can_mark_rented       BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'active',
  created_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT acc_assign_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT acc_assign_distinct_chk CHECK (landlord_provider_id <> caretaker_provider_id),
  CONSTRAINT acc_assign_unique UNIQUE (property_id, caretaker_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_acc_assign_property ON public.caretaker_property_assignments (property_id);
CREATE INDEX IF NOT EXISTS idx_acc_assign_caretaker
  ON public.caretaker_property_assignments (caretaker_provider_id, status);
CREATE INDEX IF NOT EXISTS idx_acc_assign_landlord
  ON public.caretaker_property_assignments (landlord_provider_id, status);

-- =============================================================================
-- 4. ADVERT PAYMENT (INTERNAL ESCROW-STYLE RESERVATION)
-- =============================================================================
-- One row per moderation cycle. The fee percentage, annual rent and amount are
-- snapshotted so a later change to the platform rate never rewrites history.
-- This is an internal wallet reservation, not a transfer to an external escrow:
-- funds move from available to the reserved (pending) bucket and back.
CREATE TABLE IF NOT EXISTS public.accommodation_advert_payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id              UUID NOT NULL REFERENCES public.accommodation_properties(id) ON DELETE RESTRICT,
  provider_id              UUID NOT NULL REFERENCES public.accommodation_providers(id) ON DELETE RESTRICT,
  payer_user_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  annual_rent_kobo         BIGINT NOT NULL CHECK (annual_rent_kobo > 0),
  fee_bps                  INTEGER NOT NULL CHECK (fee_bps BETWEEN 0 AND 5000),
  fee_kobo                 BIGINT NOT NULL CHECK (fee_kobo >= 0),
  currency                 TEXT NOT NULL DEFAULT 'NGN',
  payment_status           TEXT NOT NULL DEFAULT 'reserved',
  moderation_cycle         INTEGER NOT NULL DEFAULT 1,
  reservation_ref          TEXT NOT NULL UNIQUE,
  reserve_idempotency_key  TEXT NOT NULL UNIQUE,
  charge_idempotency_key   TEXT UNIQUE,
  refund_idempotency_key   TEXT UNIQUE,
  reserved_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at              TIMESTAMPTZ,
  refunded_at              TIMESTAMPTZ,
  failed_reason            TEXT,
  reviewed_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at              TIMESTAMPTZ,
  rejection_reason         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acc_advert_payment_status_chk
    CHECK (payment_status IN ('unpaid','reserved','captured','refunded','failed'))
);

-- At most one live reservation per property. A rejected cycle is 'refunded'
-- and a re-submission is a brand new row, so this never blocks a retry.
CREATE UNIQUE INDEX IF NOT EXISTS acc_advert_active_reservation_idx
  ON public.accommodation_advert_payments (property_id)
  WHERE payment_status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_acc_advert_pay_property
  ON public.accommodation_advert_payments (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_advert_pay_payer
  ON public.accommodation_advert_payments (payer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_advert_pay_status
  ON public.accommodation_advert_payments (payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_advert_pay_provider
  ON public.accommodation_advert_payments (provider_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.acc_advert_payment_touch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acc_advert_payment_touch ON public.accommodation_advert_payments;
CREATE TRIGGER trg_acc_advert_payment_touch
  BEFORE UPDATE ON public.accommodation_advert_payments
  FOR EACH ROW EXECUTE FUNCTION public.acc_advert_payment_touch();

-- =============================================================================
-- 5. PLATFORM SETTINGS: ADVERTISEMENT PRICING
-- =============================================================================
ALTER TABLE public.marketplace_platform_settings
  ADD COLUMN IF NOT EXISTS accommodation_advert_fee_bps INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS accommodation_advert_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accommodation_advert_currency TEXT NOT NULL DEFAULT 'NGN';

DO $$ BEGIN
  ALTER TABLE public.marketplace_platform_settings
    ADD CONSTRAINT acc_advert_fee_bps_chk
    CHECK (accommodation_advert_fee_bps BETWEEN 0 AND 5000) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.marketplace_platform_settings
  VALIDATE CONSTRAINT acc_advert_fee_bps_chk;

-- =============================================================================
-- 6. GUARD TRIGGERS
-- =============================================================================
-- A non-administrator must never be able to set verification, moderation,
-- publication, review or ownership fields directly through PostgREST. These
-- triggers run as SECURITY DEFINER so they cannot be bypassed by RLS alone.

-- Providers: freeze verification + ownership for non-admins.
CREATE OR REPLACE FUNCTION public.accommodation_provider_application_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
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
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acc_provider_application_guard ON public.accommodation_providers;
CREATE TRIGGER trg_acc_provider_application_guard
  BEFORE INSERT OR UPDATE ON public.accommodation_providers
  FOR EACH ROW EXECUTE FUNCTION public.accommodation_provider_application_guard();

-- Properties: freeze moderation/publication/review/ownership for non-admins,
-- unless the write is performed by a trusted RPC that raised the local flag.
CREATE OR REPLACE FUNCTION public.accommodation_advert_state_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rpc BOOLEAN := (current_setting('fuw.acc_state_change', true) = '1');
BEGIN
  IF public.is_platform_admin() OR v_rpc THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.moderation_status := 'draft';
    NEW.is_published      := false;
    NEW.submitted_at      := NULL;
    NEW.reviewed_by       := NULL;
    NEW.reviewed_at       := NULL;
    NEW.moderation_note   := NULL;
    NEW.rented_at         := NULL;
  ELSE
    NEW.moderation_status := OLD.moderation_status;
    NEW.is_published      := OLD.is_published;
    NEW.submitted_at      := OLD.submitted_at;
    NEW.reviewed_by       := OLD.reviewed_by;
    NEW.reviewed_at       := OLD.reviewed_at;
    NEW.moderation_note   := OLD.moderation_note;
    NEW.rented_at         := OLD.rented_at;
    NEW.provider_id       := OLD.provider_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_acc_advert_state_guard ON public.accommodation_properties;
CREATE TRIGGER trg_acc_advert_state_guard
  BEFORE INSERT OR UPDATE ON public.accommodation_properties
  FOR EACH ROW EXECUTE FUNCTION public.accommodation_advert_state_guard();

-- =============================================================================
-- 7. ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE public.accommodation_advert_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caretaker_property_assignments      ENABLE ROW LEVEL SECURITY;

-- Advert payments: the payer (or an administrator) may read; nobody may write
-- through the API. Every state change is an RPC.
DROP POLICY IF EXISTS acc_advert_pay_select ON public.accommodation_advert_payments;
CREATE POLICY acc_advert_pay_select ON public.accommodation_advert_payments
  FOR SELECT TO authenticated
  USING (payer_user_id = auth.uid() OR public.is_platform_admin());

-- Caretaker assignments: visible to the assigned caretaker, the owning
-- landlord, and administrators.
DROP POLICY IF EXISTS acc_assign_select ON public.caretaker_property_assignments;
CREATE POLICY acc_assign_select ON public.caretaker_property_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR landlord_provider_id IN (SELECT p.id FROM public.accommodation_providers p WHERE p.user_id = auth.uid())
    OR caretaker_provider_id IN (SELECT p.id FROM public.accommodation_providers p WHERE p.user_id = auth.uid())
  );

-- Belt and braces: the tables are read-only to clients at the grant level too.
REVOKE INSERT, UPDATE, DELETE ON public.accommodation_advert_payments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.caretaker_property_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.accommodation_advert_payments TO authenticated;
GRANT SELECT ON public.caretaker_property_assignments TO authenticated;

-- =============================================================================
-- 8. STORAGE: PROVIDER LISTING PHOTOS + PRIVATE IDENTITY DOCUMENTS
-- =============================================================================
-- Listing photos stay in the existing public `accommodation-images` bucket, but
-- a provider may now only write inside their own `providers/<uid>/` folder.
UPDATE storage.buckets
   SET file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/avif']
 WHERE id = 'accommodation-images';

DROP POLICY IF EXISTS "Providers can upload own accommodation images" ON storage.objects;
CREATE POLICY "Providers can upload own accommodation images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'accommodation-images'
    AND (storage.foldername(name))[1] = 'providers'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Providers can update own accommodation images" ON storage.objects;
CREATE POLICY "Providers can update own accommodation images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'accommodation-images'
    AND (storage.foldername(name))[1] = 'providers'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Providers can delete own accommodation images" ON storage.objects;
CREATE POLICY "Providers can delete own accommodation images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'accommodation-images'
    AND (storage.foldername(name))[1] = 'providers'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Private bucket for identity / ownership evidence. Owner and admins only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('provider-documents', 'provider-documents', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Owners upload provider documents" ON storage.objects;
CREATE POLICY "Owners upload provider documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'provider-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners read provider documents" ON storage.objects;
CREATE POLICY "Owners read provider documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'provider-documents'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_platform_admin())
  );

DROP POLICY IF EXISTS "Admins read provider documents" ON storage.objects;
CREATE POLICY "Admins read provider documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'provider-documents' AND public.is_platform_admin());

COMMIT;
