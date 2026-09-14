-- FUW E-Library — Security, MFA & Profile-Setup (2026-09-14)
--
--   * Enriches `active_sessions` with real device-fingerprint columns
--     (public IP address, device name). IMEI / MAC cannot be read from a
--     browser; both columns are kept so native/tampered clients can record
--     them, and are NULL for ordinary web sessions.
--   * Adds a SECURITY DEFINER RPC that repeatedly notifies students whose
--     profile is not fully set up until they complete it.
--   * Grants the `authenticated` role a safe INSERT on notifications so the
--     app can surface onboarding / security notices.
--   * Hardens profile edits: identity fields (matric, faculty, department,
--     level) may be changed at most twice per field while the profile is NOT
--     yet complete. Once a profile becomes complete the fields are locked.
--
-- All statements are idempotent and safe to re-run.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. active_sessions — device fingerprint columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.active_sessions
  ADD COLUMN IF NOT EXISTS device_name  TEXT,
  ADD COLUMN IF NOT EXISTS imei         TEXT,
  ADD COLUMN IF NOT EXISTS mac_address  TEXT;

COMMENT ON COLUMN public.active_sessions.imei IS
  'IMEI is not readable from web browsers (null on normal web sessions).';
COMMENT ON COLUMN public.active_sessions.mac_address IS
  'MAC address is not readable from web browsers (null on normal web sessions).';

-- Students may never rewrite fingerprint fields (existing guard in
-- 20260831_security_followup.sql already protects device_type/browser/os/
-- ip/location/network fields; keep device_name there too).
DROP TRIGGER IF EXISTS trg_active_sessions_student_update_guard ON public.active_sessions;
CREATE FUNCTION public.active_sessions_student_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.session_key IS DISTINCT FROM OLD.session_key
     OR NEW.device_type IS DISTINCT FROM OLD.device_type
     OR NEW.browser IS DISTINCT FROM OLD.browser
     OR NEW.os IS DISTINCT FROM OLD.os
     OR NEW.device_name IS DISTINCT FROM OLD.device_name
     OR NEW.imei IS DISTINCT FROM OLD.imei
     OR NEW.mac_address IS DISTINCT FROM OLD.mac_address
     OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.connection_type IS DISTINCT FROM OLD.connection_type
     OR NEW.network_name IS DISTINCT FROM OLD.network_name
     OR NEW.user_agent IS DISTINCT FROM OLD.user_agent THEN
    RAISE EXCEPTION 'Students may not alter session identity or device fields.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_active_sessions_student_update_guard
  BEFORE UPDATE ON public.active_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.active_sessions_student_update_guard();

-- -----------------------------------------------------------------------------
-- 2. Notifications — allow a user (or admins) to create rows safely
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. Profile-setup reminder RPC (SECURITY DEFINER so RLS cannot block it)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_completeness()
RETURNS TABLE (
  is_complete   boolean,
  missing_full_name boolean,
  missing_matric    boolean,
  missing_faculty   boolean,
  missing_department boolean,
  missing_level     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (COALESCE(full_name, '') <> ''      AND COALESCE(matric_number, '') <> ''
     AND COALESCE(faculty, '') <> ''    AND COALESCE(department, '') <> ''
     AND COALESCE(level, '') <> ''),
    COALESCE(full_name, '') = '',
    COALESCE(matric_number, '') = '',
    COALESCE(faculty, '') = '',
    COALESCE(department, '') = '',
    COALESCE(level, '') = ''
  FROM public.profiles
  WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_completeness() TO authenticated;

-- Inserts (or refreshes) a reminder notification for the calling user while
-- their profile is incomplete. Safe to call on every login/refresh — rows are
-- deduplicated by keeping the newest reminder per user.
CREATE OR REPLACE FUNCTION public.ensure_profile_setup_notification()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  EXECUTE $q$
    SELECT (COALESCE(matric_number, '') <> ''
        AND COALESCE(faculty, '') <> ''
        AND COALESCE(department, '') <> '')
    FROM public.profiles WHERE id = $1
  $q$ INTO m USING auth.uid();

  IF m IS NOT DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  -- Remove any stale, still-unread reminder so the notification bell shows
  -- exactly one actionable entry at a time (it re-appears until completed).
  DELETE FROM public.notifications
   WHERE user_id = auth.uid()
     AND type = 'warning'
     AND title = 'Your profile is not fully set up';

  INSERT INTO public.notifications (
    user_id, title, message, type, link
  ) VALUES (
    auth.uid(),
    'Your profile is not fully set up',
    'Complete your profile (matriculation number, faculty and department) so you can fully use your FUW E-Library account.',
    'warning',
    '/student/settings'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile_setup_notification() TO authenticated;

COMMIT;