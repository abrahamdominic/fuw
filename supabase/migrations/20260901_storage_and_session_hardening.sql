-- FUW E-Library — Storage & Session Hardening (2026-09-01)
--
-- Follow-up discovered during the re-run of audit.md. All statements are
-- idempotent and wrapped in a transaction (COMMIT at the end).
--
-- Fixes:
--   * STOR-01 (High)   reject_invalid_library_upload() only validated when
--                      TG_OP = 'INSERT'. The UPDATE trigger added in
--                      20260831 called the same function but the whole
--                      validation body was skipped for UPDATE, so an approved
--                      object could be overwritten with scriptable bytes while
--                      keeping a document MIME. Validation now runs for BOTH
--                      INSERT and UPDATE.
--   * AUTHZ-04 (Med)   cleanup_stale_sessions() was SECURITY DEFINER granted to
--                      all authenticated with NO user scoping — any student
--                      could DELETE every user's idle sessions (mass session
--                      disruption). Now scoped to auth.uid() so a caller can
--                      only prune their own stale sessions.
--   * AUTHZ-05 (Low)   increment_download_count() / increment_view_count() are
--                      SECURITY DEFINER write-capable functions that were
--                      granted to anon. Non-authenticated visitors can no longer
--                      inflate download/view counts; only authenticated users
--                      may.
--
-- NOTES on scope limitation (audit "do not assume"):
--   * True magic-byte / file-signature sniffing CANNOT be performed inside a
--     storage.objects trigger: for Supabase Storage the object bytes live in
--     the external object store, not in the table, so no trigger can read them.
--     Magic-byte verification is performed instead: (1) client-side before
--     upload (src/lib/materials.ts sniffDocumentMagicBytes), (2) served with
--     nosniff + strict CSP by Netlify (netlify.toml), and (3) the reader runs
--     in a sandbox iframe (no allow-scripts). The trigger re-validates the
--     content_type metadata on every INSERT/UPDATE as the DB-level gate.

BEGIN;

-- -----------------------------------------------------------------------------
-- STOR-01 — validate the library-materials content_type on BOTH insert and
--           update, and forbid flipping a stored object's content_type onto
--           the deny-list / off the allow-list. Recreated idempotently.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_invalid_library_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ct text;
  is_library boolean;
BEGIN
  -- Branch on TG_OP: on INSERT, OLD is an unassigned record so it cannot be
  -- referenced. Reject any operation that touches the library bucket without
  -- a valid document type (including moving an object into/out of it).
  IF TG_OP = 'INSERT' THEN
    is_library := (NEW.bucket_id = 'library-materials');
  ELSE
    is_library := (OLD.bucket_id = 'library-materials' OR NEW.bucket_id = 'library-materials');
  END IF;

  IF NOT is_library THEN
    RETURN NEW;
  END IF;

  IF NEW.bucket_id <> 'library-materials' THEN
    RAISE EXCEPTION 'library object may not be moved outside library-materials'
      USING ERRCODE = 'P0001';
  END IF;

  ct := lower(NEW.content_type);
  IF ct IS NULL OR ct = '' OR ct = 'application/octet-stream' THEN
    RAISE EXCEPTION 'library upload: missing or generic content type is not allowed'
      USING ERRCODE = 'P0001';
  END IF;

  -- Explicit deny-list: any of these means a scriptable/executable payload.
  IF ct LIKE '%html%' OR ct LIKE '%xml%' OR ct LIKE '%svg%'
     OR ct LIKE '%javascript%' OR ct LIKE '%ecmascript%' OR ct LIKE '%x-sh%'
     OR ct LIKE '%vbs%' OR ct LIKE '%x-httpd%' OR ct LIKE '%x-msdownload%'
     OR ct LIKE '%x-msdos%' OR ct = 'application/x-ms-application'
     OR ct = 'application/x-dosexec'
     OR ct LIKE '%zip%' OR ct LIKE '%x-compressed%' OR ct LIKE '%x-7z%'
     OR ct LIKE '%octet-stream%' OR ct LIKE '%x-rar%' OR ct LIKE '%x-tar%'
     OR ct LIKE '%gzip%' OR ct LIKE '%bzip%' THEN
    RAISE EXCEPTION 'library upload: content type % is not permitted', ct
      USING ERRCODE = 'P0001';
  END IF;

  -- Allow-list guard: only document MIME types the reader/AI support.
  IF ct NOT IN (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ) THEN
    RAISE EXCEPTION 'library upload: content type % is not in the allowed set', ct
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate both triggers (INSERT from 20260829, UPDATE from 20260831) so they
-- reference the hardened function.
DROP TRIGGER IF EXISTS trg_reject_invalid_library_upload ON storage.objects;
CREATE TRIGGER trg_reject_invalid_library_upload
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_invalid_library_upload();

DROP TRIGGER IF EXISTS trg_reject_invalid_library_upload_update ON storage.objects;
CREATE TRIGGER trg_reject_invalid_library_upload_update
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  WHEN (OLD.bucket_id = 'library-materials' OR NEW.bucket_id = 'library-materials')
  EXECUTE FUNCTION public.reject_invalid_library_upload();

-- -----------------------------------------------------------------------------
-- AUTHZ-04 — cleanup_stale_sessions(): previously SECURITY DEFINER granted to
--            all authenticated with NO user scoping — any student could DELETE
--            every user's idle sessions (mass session disruption). Now admins
--            (is_admin, includes is_active) may still clean the whole table
--            (required by the admin "all sessions" view), while non-admins are
--            restricted to their OWN stale sessions.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_stale_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin() THEN
    DELETE FROM public.active_sessions
    WHERE last_active < now() - interval '30 minutes';
  ELSE
    DELETE FROM public.active_sessions
    WHERE user_id = auth.uid()
      AND last_active < now() - interval '30 minutes';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- AUTHZ-05 — increment_download_count() / increment_view_count(): these are
--            SECURITY DEFINER (write) functions. Revoke from anon; only
--            authenticated users may bump their own download/view activity.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.increment_download_count(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_view_count(uuid) FROM anon;

COMMIT;
