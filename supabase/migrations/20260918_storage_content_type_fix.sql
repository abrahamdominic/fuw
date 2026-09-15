-- FUW E-Library — Storage content-type trigger fix (2026-09-18)
--
-- ROOT CAUSE
--   reject_invalid_library_upload() read the MIME type from
--   storage.objects.content_type, but modern Supabase Storage (versioned
--   schema, e.g. "object-versioning-core") removed that column and stores the
--   declared MIME in storage.objects.metadata->>'mimetype'. The trigger fired
--   for every row, but only ran the content-type checks for rows touching
--   `library-materials`, so only uploads to that bucket failed. The missing
--   column raised SQLSTATE 42703 ("column content_type does not exist"),
--   which the Storage service maps to HTTP 503
--   "The database schema is out of sync. Please run migrations or contact
--   support." (code DatabaseSchemaMismatch).
--
-- FIX
--   Read the MIME type from the storage metadata blob (metadata.mimetype),
--   with fallbacks to the legacy metadata keys contentType/content_type.
--   Allow-list / deny-list logic is unchanged.
--
-- Idempotent; wrapped in a transaction (COMMIT at the end).

BEGIN;

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

  -- Supabase Storage stores the declared MIME in metadata.mimetype; there is
  -- no storage.objects.content_type column in the versioned schema.
  ct := lower(COALESCE(
    NULLIF(NEW.metadata->>'mimetype', ''),
    NULLIF(NEW.metadata->>'contentType', ''),
    NULLIF(NEW.metadata->>'content_type', '')
  ));
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

-- Recreate both triggers so they reference the fixed function (idempotent).
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

COMMIT;