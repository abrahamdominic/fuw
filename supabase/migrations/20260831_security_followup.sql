-- FUW E-Library — Security Follow-up (2026-08-31)
--
-- Supersedes gaps in 20260829_security_hardening.sql. All statements are
-- idempotent. Wrapped in a transaction (COMMIT at the end).
--
-- Fixes:
--   * F1  REVOKE ... FROM PUBLIC does not remove DIRECT anon grants set by
--         earlier migrations. PostgreSQL `CREATE OR REPLACE FUNCTION` preserves
--         ACLs, so the anon grant on the analytics RPCs (20260828) and on
--         register_identity_check (20260824) survived the hardening migration.
--         Added explicit `REVOKE ... FROM anon`.
--   * F4  active_sessions "Students update own sessions" had USING but no
--         WITH CHECK -> a student could UPDATE their own row into another
--         user's row (ownership transfer / session_tampering). Added WITH CHECK
--         AND narrowed the writable columns so identity/session fields cannot
--         be changed.
--   * F1/F9  storage.objects was only guarded on INSERT. An owner could UPDATE
--         an approved object's bytes with scriptable content after approval.
--         Trigger now fires on UPDATE too.

BEGIN;

-- -----------------------------------------------------------------------------
-- F1 — Analytics RPCs: revoke anon EXECUTE explicitly (REVOKE ... FROM PUBLIC
--      earlier did NOT undo the direct `GRANT ... TO anon` from 20260828).
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.count_students_by_gender() FROM anon;
REVOKE ALL ON FUNCTION public.count_materials_by_faculty() FROM anon;
REVOKE ALL ON FUNCTION public.count_materials_by_department() FROM anon;

-- -----------------------------------------------------------------------------
-- F3 — register_identity_check: drop the surviving anon EXECUTE.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.register_identity_check(text, text) FROM anon;

-- -----------------------------------------------------------------------------
-- F4 — active_sessions: students may update ONLY their own row, and may never
--      change ownership or security-relevant session identity fields. Other
--      update policies on the row (the narrower write set below) still allow a
--      heartbeat/termination to update `is_current`/`last_active`.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students update own sessions" ON public.active_sessions;
CREATE POLICY "Students update own sessions" ON public.active_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Narrow what a student may write on their own session: only lifecycle fields.
-- `user_id`, `session_key`, `device_type`, `browser`, `os`, `ip_address`,
-- `location`, `connection_type`, `network_name`, `user_agent` are treated as
-- device-fingerprint data recorded at login and must not be user-rewritable.
DROP TRIGGER IF EXISTS trg_active_sessions_guard_update ON public.active_sessions;
CREATE FUNCTION public.active_sessions_student_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW; -- admins may manage full rows
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.session_key IS DISTINCT FROM OLD.session_key
     OR NEW.device_type IS DISTINCT FROM OLD.device_type
     OR NEW.browser IS DISTINCT FROM OLD.browser
     OR NEW.os IS DISTINCT FROM OLD.os
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

DROP TRIGGER IF EXISTS trg_active_sessions_student_update_guard ON public.active_sessions;
CREATE TRIGGER trg_active_sessions_student_update_guard
  BEFORE UPDATE ON public.active_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.active_sessions_student_update_guard();

-- -----------------------------------------------------------------------------
-- F1/F9 — Storage: also validate content on UPDATE so an approved object cannot
--      be overwritten with scriptable bytes while keeping a document MIME.
--      Reuses reject_invalid_library_upload() from 20260829.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_reject_invalid_library_upload_update ON storage.objects;
CREATE TRIGGER trg_reject_invalid_library_upload_update
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  WHEN (OLD.bucket_id = 'library-materials' AND NEW.bucket_id = 'library-materials')
  EXECUTE FUNCTION public.reject_invalid_library_upload();

COMMIT;
