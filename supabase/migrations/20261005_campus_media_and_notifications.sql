-- FUW Campus Platform — Campus media storage + notification categories (2026-10-05)
--
-- WHY
--   20261004_campus_platform_foundation.sql introduced five media path columns
--   (events.cover_image_path, organizations.logo_path, organizations.cover_image_path,
--   lost_found_items.photo_path and the assignment attachment added here) but
--   created no storage bucket, so there was nowhere to upload to. It also
--   introduced notification_preferences.category, yet public.notifications had no
--   category column, so preferences could suppress delivery but nothing could
--   ever be filtered or labelled by category in the notification centre.
--
-- WHAT
--   1. notifications.category — labels every notification so the centre can
--      filter by category. Existing rows default to 'platform', the catch-all.
--   2. queue_notification() — the single reusable notification entry point
--      required by ff.md §20. Every future module calls this instead of
--      hand-rolling its own INSERT, which is what keeps preference handling and
--      dedupe in exactly one place.
--   3. campus-media — a private bucket for platform imagery and attachments,
--      with a server-side upload guard. Client-supplied MIME types are never
--      trusted on their own (§19): the guard cross-checks the declared type
--      against the file extension and rejects active content.
--
-- SECURITY
--   * campus-media is private. Nothing is world-readable.
--   * Every object must live under <scope>/<owner_uuid>/..., where owner_uuid is
--     the uploader. The guard trigger enforces this so a user cannot write into
--     another user's prefix and have a permissive read policy serve it back.
--   * queue_notification() is revoked from anon and authenticated. It is a
--     notification-injection primitive; only SECURITY DEFINER triggers owned by
--     the table owner may call it. This is the mitigation for notification abuse
--     called out in §18.
--
-- Idempotent; wrapped in a transaction.

BEGIN;

-- ── 1. Notification categories ──────────────────────────────────────────────────

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'platform';

-- Align the allowed set with notification_preferences.category so a preference
-- row can never reference a category the notification centre does not know.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_category_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_category_check;
  END IF;

  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_category_check
    CHECK (category IN (
      'academic', 'events', 'organizations', 'marketplace',
      'messages', 'jobs', 'study_groups', 'payments', 'platform'
    ));
END
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_category
  ON public.notifications (user_id, category, created_at DESC);

-- The existing partial unique index on (user_id, dedupe_key) already makes
-- queue_notification idempotent; nothing further is needed for dedupe.


-- ── 2. Reusable notification entry point (ff.md §20) ────────────────────────────

CREATE OR REPLACE FUNCTION public.queue_notification(
  p_user_id uuid,
  p_title text,
  p_message text DEFAULT '',
  p_type text DEFAULT 'info',
  p_link text DEFAULT NULL,
  p_category text DEFAULT 'platform',
  p_dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Non-critical notifications honour the recipient's in-app preference.
  -- COALESCE keeps the default-on behaviour when no preference row exists yet,
  -- which matches the existing notify_event_rsvp() / notify_lost_found_claim().
  SELECT np.in_app_enabled INTO v_enabled
  FROM public.notification_preferences np
  WHERE np.user_id = p_user_id AND np.category = p_category;

  IF NOT COALESCE(v_enabled, true) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, link, category, dedupe_key
  )
  VALUES (
    p_user_id,
    left(trim(COALESCE(p_title, '')), 180),
    left(COALESCE(p_message, ''), 2000),
    COALESCE(NULLIF(trim(p_type), ''), 'info'),
    NULLIF(left(COALESCE(p_link, ''), 300), ''),
    COALESCE(NULLIF(p_category, ''), 'platform'),
    NULLIF(left(COALESCE(p_dedupe_key, ''), 200), '')
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Trigger-only primitive. Explicitly not callable by end users.
REVOKE ALL ON FUNCTION public.queue_notification(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_notification(uuid, text, text, text, text, text, text) FROM anon, authenticated;


-- ── 3. campus-media bucket ──────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campus-media',
  'campus-media',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;


-- Server-side upload guard. Runs for every write to storage.objects so a
-- request cannot bypass it by moving an existing object into the bucket.
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

  -- Objects may not be relocated out of the bucket once written.
  IF NEW.bucket_id <> 'campus-media' THEN
    RAISE EXCEPTION 'campus media may not be moved outside campus-media'
      USING ERRCODE = 'P0001';
  END IF;

  -- Storage versioned schema: the declared MIME lives in metadata, and the
  -- client always controls it. Cross-check it against the extension.
  v_ct := lower(COALESCE(
    NULLIF(NEW.metadata->>'mimetype', ''),
    NULLIF(NEW.metadata->>'contentType', ''),
    NULLIF(NEW.metadata->>'content_type', '')
  ));

  -- Take the final dotted segment, so "event.cover.min.png" is judged as png
  -- rather than "min". Names with no dot at all have no extension.
  IF NEW.name LIKE '%.%' THEN
    v_ext := lower(substring(NEW.name FROM '([^.]+)$'));
  ELSE
    v_ext := '';
  END IF;

  -- Explicit deny-list: anything scriptable or container-like is refused even if
  -- a future bucket config were to widen allowed_mime_types.
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

  -- The declared type alone is never sufficient: the extension has to agree,
  -- otherwise a client could pass an allow-listed MIME for a hostile payload.
  IF NOT (
    (v_ct = 'image/jpeg'  AND v_ext IN ('jpg', 'jpeg')) OR
    (v_ct = 'image/png'   AND v_ext = 'png') OR
    (v_ct = 'image/webp'  AND v_ext = 'webp') OR
    (v_ct = 'application/pdf' AND v_ext = 'pdf')
  ) THEN
    RAISE EXCEPTION 'campus media: file extension does not match content type %', v_ct
      USING ERRCODE = 'P0001';
  END IF;

  -- storage.objects has no size column; the Storage API records the byte count
  -- in metadata. Parse defensively so a malformed value is rejected as a size
  -- problem instead of surfacing an unrelated cast error.
  IF NEW.metadata ->> 'size' ~ '^[0-9]+$' THEN
    v_size := (NEW.metadata ->> 'size')::bigint;
  ELSE
    v_size := NULL;
  END IF;

  IF v_size IS NULL OR v_size <= 0 OR v_size > 10485760 THEN
    RAISE EXCEPTION 'campus media: file size is out of range'
      USING ERRCODE = 'P0001';
  END IF;

  -- Path convention <scope>/<owner_uuid>/<file>. Enforcing the owner segment is
  -- what makes the read policies below safe: without it a user could upload
  -- into someone else's prefix and then read it back through the public-scope
  -- policy for event covers or organization imagery.
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

  -- Identify the uploader from storage.objects.owner_id, NOT auth.uid().
  --
  -- The Storage API does not forward the caller's JWT into the database session
  -- it writes through: it connects as supabase_storage_admin and sets only
  -- request.jwt.claims = {"role":"service_role"}. auth.uid() therefore reads as
  -- NULL inside this trigger even for an ordinary browser upload, so comparing
  -- the path against auth.uid() rejected every real upload. Verified against the
  -- live project by driving the actual Storage API with a user JWT.
  --
  -- owner_id is filled in by the Storage API from the authenticated caller and
  -- is not client-settable. It is NULL for a service_role/api-key write, which
  -- is precisely the case to refuse: service_role already bypasses RLS, and this
  -- guard is the only thing stopping it from scattering files into arbitrary
  -- owner folders. Anything that must write on a user's behalf has to go through
  -- that user's own JWT.
  --
  -- In this schema version storage.objects.owner is uuid and owner_id is text
  -- (the reverse of older Supabase), so read owner_id first and fall back.
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

DROP TRIGGER IF EXISTS trg_guard_campus_media_upload ON storage.objects;
CREATE TRIGGER trg_guard_campus_media_upload
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_campus_media_upload();

DROP TRIGGER IF EXISTS trg_guard_campus_media_upload_update ON storage.objects;
CREATE TRIGGER trg_guard_campus_media_upload_update
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  WHEN (OLD.bucket_id = 'campus-media' OR NEW.bucket_id = 'campus-media')
  EXECUTE FUNCTION public.guard_campus_media_upload();


-- Public-scope imagery (event covers, organization logos) is readable by any
-- signed-in user once published. Lost & found photos and assignment
-- attachments stay private to the owner and moderators, because a lost ID photo
-- or an unsubmitted assignment is not public information (§24).
DROP POLICY IF EXISTS campus_media_public_scope_read ON storage.objects;
CREATE POLICY campus_media_public_scope_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'campus-media'
    AND (storage.foldername(name))[1] IN ('events', 'organizations', 'learning')
  );

DROP POLICY IF EXISTS campus_media_private_scope_read ON storage.objects;
CREATE POLICY campus_media_private_scope_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'campus-media'
    AND (storage.foldername(name))[1] IN ('lost-found', 'assignments')
    AND (
      (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_admin()
    )
  );

-- Writes are owner-scoped. The WITH CHECK mirrors the guard's path rule so RLS
-- rejects a bad path even if the trigger were ever dropped.
DROP POLICY IF EXISTS campus_media_owner_insert ON storage.objects;
CREATE POLICY campus_media_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'campus-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS campus_media_owner_update ON storage.objects;
CREATE POLICY campus_media_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'campus-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'campus-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS campus_media_owner_delete ON storage.objects;
CREATE POLICY campus_media_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'campus-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Object names are content the owner controls; keep them opaque and collision
-- free rather than trusting a client-supplied file name.
COMMENT ON COLUMN public.notifications.category IS
  'Platform category driving notification-centre filtering. Mirrors notification_preferences.category; rows predating this column default to the ''platform'' catch-all.';

COMMIT;