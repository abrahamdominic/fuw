-- =====================================================================
-- FUW CAMPUS HUB — SECURITY HARDENING: ACCOMMODATION & ROOMMATE PLATFORM
-- =====================================================================
-- Description:
--   Remediates privilege escalation, unauthorized self-verification,
--   featured property tampering, and search-path security across the
--   Accommodation and Roommate Finder systems.
--
-- Findings Addressed:
--   1. SEC-ACCOM-1: accommodation_providers allowed self-verification and
--      arbitrary modification of verification_notes by non-admin users.
--   2. SEC-ACCOM-2: accommodation_properties allowed non-admin providers
--      to set is_verified=true, is_featured=true, and tamper with view_count.
--   3. SEC-ACCOM-3: public.is_platform_admin() omitted `is_active = true`
--      and omitted `SET search_path = public, pg_temp`, exposing the
--      SECURITY DEFINER function to search-path hijacking and allowing
--      deactivated administrators to bypass accommodation/report checks.
--   4. SEC-ACCOM-4: roommate_requests permitted view_count and ownership
--      manipulation by non-admin users.
--   5. SEC-ACCOM-5: accommodation_reports permitted direct client insertion
--      with resolved status or forged resolution notes.
-- =====================================================================

-- -----------------------------------------------------------------------------
-- 1. HARDEN public.is_platform_admin()
-- -----------------------------------------------------------------------------
-- Enforce explicit search path and verify administrator account is active.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role::text IN ('admin', 'super_admin')
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.is_platform_admin() IS
  'Returns true only when the caller is authenticated as an active platform administrator. Hardened against search-path hijacking and suspended accounts.';

-- -----------------------------------------------------------------------------
-- 2. ACCOMMODATION PROVIDERS INTEGRITY GUARD (SEC-ACCOM-1)
-- -----------------------------------------------------------------------------
-- Prevents non-administrators from self-verifying or forging verification notes.
CREATE OR REPLACE FUNCTION public.accommodation_provider_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role or internal migration context bypass
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Platform administrators can update verification status and notes
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- Authenticated non-admin operations:
  IF TG_OP = 'INSERT' THEN
    NEW.is_verified := false;
    NEW.verification_notes := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
      RAISE EXCEPTION 'Only active platform administrators may alter provider verification status.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.verification_notes IS DISTINCT FROM OLD.verification_notes THEN
      RAISE EXCEPTION 'Only active platform administrators may alter provider verification notes.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accommodation_provider_guard ON public.accommodation_providers;
CREATE TRIGGER trg_accommodation_provider_guard
  BEFORE INSERT OR UPDATE ON public.accommodation_providers
  FOR EACH ROW
  EXECUTE FUNCTION public.accommodation_provider_guard();

-- -----------------------------------------------------------------------------
-- 3. HARDEN increment_accommodation_view_count
-- -----------------------------------------------------------------------------
-- Atomically increments view_count and sets transaction-local authorization context.
CREATE OR REPLACE FUNCTION public.increment_accommodation_view_count(p_property_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_view_count INTEGER;
BEGIN
  IF p_property_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Flag that this update originates from the trusted view increment RPC
  PERFORM set_config('fuw.in_accommodation_view_increment', '1', true);

  UPDATE public.accommodation_properties
     SET view_count = view_count + 1
   WHERE id = p_property_id
     AND is_published = true
  RETURNING view_count INTO v_view_count;

  RETURN v_view_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_accommodation_view_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_accommodation_view_count(UUID) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. ACCOMMODATION PROPERTIES INTEGRITY GUARD (SEC-ACCOM-2)
-- -----------------------------------------------------------------------------
-- Restricts property verification, featured promotion, and view count tampering.
CREATE OR REPLACE FUNCTION public.accommodation_property_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_view_increment BOOLEAN;
BEGIN
  -- Service role or internal migration context bypass
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Platform administrators can manage all flags
  IF public.is_platform_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  v_is_view_increment := (current_setting('fuw.in_accommodation_view_increment', true) = '1');

  -- Authenticated non-admin operations:
  IF TG_OP = 'INSERT' THEN
    NEW.is_verified := false;
    NEW.is_featured := false;
    NEW.view_count := 0;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
      RAISE EXCEPTION 'Only active platform administrators may verify accommodation properties.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.is_featured IS DISTINCT FROM OLD.is_featured THEN
      RAISE EXCEPTION 'Only active platform administrators may feature accommodation properties.'
        USING ERRCODE = '42501';
    END IF;

    -- Non-admins cannot manipulate view counts unless triggered via official RPC
    IF NEW.view_count IS DISTINCT FROM OLD.view_count AND NOT v_is_view_increment THEN
      NEW.view_count := OLD.view_count;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accommodation_property_guard ON public.accommodation_properties;
CREATE TRIGGER trg_accommodation_property_guard
  BEFORE INSERT OR UPDATE ON public.accommodation_properties
  FOR EACH ROW
  EXECUTE FUNCTION public.accommodation_property_guard();

-- -----------------------------------------------------------------------------
-- 5. ACCOMMODATION REPORTS INTEGRITY GUARD (SEC-ACCOM-5)
-- -----------------------------------------------------------------------------
-- Enforces that newly submitted user reports always default to pending status.
CREATE OR REPLACE FUNCTION public.accommodation_report_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.resolution_notes := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accommodation_report_guard ON public.accommodation_reports;
CREATE TRIGGER trg_accommodation_report_guard
  BEFORE INSERT ON public.accommodation_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.accommodation_report_guard();

-- -----------------------------------------------------------------------------
-- 6. ACCOMMODATION REVIEWS MODERATION POLICIES (SEC-ACCOM-6)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage accommodation reviews" ON public.accommodation_reviews;
CREATE POLICY "Admins can manage accommodation reviews"
  ON public.accommodation_reviews FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- 7. ROOMMATE FINDER INTEGRITY GUARD (SEC-ACCOM-4)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_roommate_request_view(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('fuw.in_roommate_view_increment', '1', true);

  UPDATE public.roommate_requests
     SET view_count = view_count + 1
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_roommate_request_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_roommate_request_view(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.roommate_request_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_roommate_view_increment BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_platform_admin() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  v_is_roommate_view_increment := (current_setting('fuw.in_roommate_view_increment', true) = '1');

  IF TG_OP = 'INSERT' THEN
    NEW.student_id := auth.uid();
    NEW.view_count := 0;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Student ownership and original creation timestamp cannot be transferred
    NEW.student_id := OLD.student_id;
    NEW.created_at := OLD.created_at;

    IF NEW.view_count IS DISTINCT FROM OLD.view_count AND NOT v_is_roommate_view_increment THEN
      NEW.view_count := OLD.view_count;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roommate_request_guard ON public.roommate_requests;
CREATE TRIGGER trg_roommate_request_guard
  BEFORE INSERT OR UPDATE ON public.roommate_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.roommate_request_guard();
