-- Migration: Accept both contentLength and size in guard_campus_media_upload trigger
-- Supabase Storage API passes contentLength in metadata during INSERT.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_campus_media_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_media boolean;
  v_ct text;
  v_ext text;
  v_uploader text;
  v_path_owner text;
  v_size bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_is_media := (NEW.bucket_id = 'campus-media');
  ELSE
    v_is_media := (OLD.bucket_id = 'campus-media' OR NEW.bucket_id = 'campus-media');
  END IF;

  IF NOT v_is_media THEN
    RETURN NEW;
  END IF;

  IF NEW.bucket_id <> 'campus-media' THEN
    RAISE EXCEPTION 'campus media may not be moved outside campus-media'
      USING ERRCODE = 'P0001';
  END IF;

  v_ct := lower(COALESCE(
    NULLIF(NEW.metadata->>'mimetype', ''),
    NULLIF(NEW.metadata->>'contentType', ''),
    NULLIF(NEW.metadata->>'content_type', '')
  ));

  IF NEW.name LIKE '%.%' THEN
    v_ext := lower(substring(NEW.name FROM '([^.]+)$'));
  ELSE
    v_ext := '';
  END IF;

  IF v_ct LIKE '%html%' OR v_ct LIKE '%xml%' OR v_ct LIKE '%svg%'
     OR v_ct LIKE '%javascript%' OR v_ct LIKE '%ecmascript%'
     OR v_ct LIKE '%x-sh%' OR v_ct LIKE '%vbs%' OR v_ct LIKE '%x-httpd%'
     OR v_ct LIKE '%x-msdownload%' OR v_ct LIKE '%x-msdos%'
     OR v_ct = 'application/x-ms-application'
     OR v_ct = 'application/x-dosexec'
     OR v_ct LIKE '%zip%' OR v_ct LIKE '%x-compressed%' OR v_ct LIKE '%x-7z%'
     OR v_ct LIKE '%octet-stream%' OR v_ct LIKE '%x-rar%' OR v_ct LIKE '%x-tar%'
     OR v_ct LIKE '%gzip%' OR v_ct LIKE '%bzip%' THEN
    RAISE EXCEPTION 'campus media: content type % is not permitted', v_ct
      USING ERRCODE = 'P0001';
  END IF;

  IF v_ct NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') THEN
    RAISE EXCEPTION 'campus media: content type % is not in the allowed set', v_ct
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    (v_ct = 'image/jpeg'  AND v_ext IN ('jpg', 'jpeg')) OR
    (v_ct = 'image/png'   AND v_ext = 'png') OR
    (v_ct = 'image/webp'  AND v_ext = 'webp') OR
    (v_ct = 'application/pdf' AND v_ext = 'pdf')
  ) THEN
    RAISE EXCEPTION 'campus media: file extension does not match content type %', v_ct
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(NEW.metadata ->> 'size', NEW.metadata ->> 'contentLength') ~ '^[0-9]+$' THEN
    v_size := COALESCE(NEW.metadata ->> 'size', NEW.metadata ->> 'contentLength')::bigint;
  ELSE
    v_size := NULL;
  END IF;

  IF v_size IS NULL OR v_size <= 0 OR v_size > 10485760 THEN
    RAISE EXCEPTION 'campus media: file size is out of range'
      USING ERRCODE = 'P0001';
  END IF;

  IF (storage.foldername(NEW.name))[1] NOT IN (
    'events', 'organizations', 'lost-found', 'assignments', 'learning'
  ) THEN
    RAISE EXCEPTION 'campus media: unknown upload scope'
      USING ERRCODE = 'P0001';
  END IF;

  v_path_owner := (storage.foldername(NEW.name))[2];
  IF v_path_owner IS NULL OR v_path_owner = '' THEN
    RAISE EXCEPTION 'campus media: upload path must include the owner id'
      USING ERRCODE = 'P0001';
  END IF;

  v_uploader := COALESCE(
    NULLIF(btrim(NEW.owner_id), ''),
    CASE WHEN NEW.owner IS NOT NULL THEN NEW.owner::text END
  );

  IF v_uploader IS NULL OR v_uploader = '' THEN
    RAISE EXCEPTION 'campus media: upload must be attributed to a signed-in user'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_uploader IS DISTINCT FROM v_path_owner THEN
    RAISE EXCEPTION 'campus media: upload path must be owned by the uploader'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TABLE IF EXISTS public.debug_media_errors CASCADE;

COMMIT;
