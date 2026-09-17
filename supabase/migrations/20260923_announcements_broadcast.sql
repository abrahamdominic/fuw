-- =============================================================================
-- FUW E-Library — Admin Announcement broadcasts
--
-- Extends the existing library_announcements table with a notification type and
-- adds a single, server-side fan-out path (send_announcement) that writes one
-- per-user row into the existing notifications feed. Reuses the per-user
-- dedupe_key unique index so refreshes, sign-outs and re-opens never duplicate.
--
-- Security:
--   * send_announcement() is SECURITY DEFINER and hard-checks public.is_admin()
--     (admin / super_admin) inside the function, so students cannot broadcast.
--   * library_announcements write RLS stays admin-only.
--   * notifications remain strictly per-user (SELECT/UPDATE on user_id).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. library_announcements: notification type column
-- -----------------------------------------------------------------------------
ALTER TABLE public.library_announcements
  ADD COLUMN IF NOT EXISTS announcement_type text NOT NULL DEFAULT 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'library_announcements_type_check'
  ) THEN
    EXECUTE 'ALTER TABLE public.library_announcements
      ADD CONSTRAINT library_announcements_type_check
      CHECK (announcement_type IN (''general'', ''maintenance'', ''important'', ''system_update''))';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_library_announcements_published
  ON public.library_announcements (published_at DESC);

-- -----------------------------------------------------------------------------
-- 2. notifications: sender attribution + announcement types
-- -----------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS sender_name text;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'info', 'success', 'warning', 'error',
    'material_approved', 'material_rejected', 'material_deleted',
    'new_material', 'new_submission', 'admin_promoted', 'system', 'welcome',
    'announcement', 'maintenance', 'important', 'system_update'
  ));

-- -----------------------------------------------------------------------------
-- 3. send_announcement(): authorized, idempotent fan-out
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_announcement(
  p_title text,
  p_body text,
  p_announcement_type text DEFAULT 'general',
  p_audience text DEFAULT 'everyone'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_announcement_id  uuid;
  v_sender_name      text;
  v_notif_type       text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only authorized administrators can send announcements.';
  END IF;

  IF NULLIF(trim(p_title), '') IS NULL THEN
    RAISE EXCEPTION 'An announcement title is required.';
  END IF;
  IF NULLIF(trim(p_body), '') IS NULL THEN
    RAISE EXCEPTION 'An announcement message is required.';
  END IF;
  IF p_announcement_type NOT IN ('general', 'maintenance', 'important', 'system_update') THEN
    RAISE EXCEPTION 'Unsupported announcement type.';
  END IF;

  v_notif_type := CASE p_announcement_type
    WHEN 'maintenance'   THEN 'maintenance'
    WHEN 'important'     THEN 'important'
    WHEN 'system_update' THEN 'system_update'
    ELSE 'announcement'
  END;

  SELECT COALESCE(display_name, full_name, username, 'Library Administrator')
    INTO v_sender_name
    FROM public.profiles
    WHERE id = auth.uid();

  INSERT INTO public.library_announcements (
    title, body, audience, announcement_type, is_published, published_by, published_at
  )
  VALUES (
    trim(p_title), trim(p_body), p_audience, p_announcement_type, TRUE, auth.uid(), NOW()
  )
  RETURNING id INTO v_announcement_id;

  INSERT INTO public.notifications (
    user_id, title, message, type, dedupe_key, sender_name
  )
  SELECT
    pr.id,
    trim(p_title),
    trim(p_body),
    v_notif_type,
    'announcement:' || v_announcement_id,
    v_sender_name
  FROM public.profiles pr
  WHERE pr.is_active = TRUE
    AND (
      p_audience = 'everyone'
      OR (p_audience = 'students' AND pr.role = 'student')
      OR (p_audience = 'staff' AND pr.role IN ('admin', 'super_admin'))
    )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN v_announcement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_announcement(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_announcement(text, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Strip stray Markdown (**) markers from seeded help/announcement text so no
--    literal asterisks are ever shown in the web or mobile UI.
-- -----------------------------------------------------------------------------
UPDATE public.help_topics
   SET body = regexp_replace(
         regexp_replace(body, '\*\*([^*]+)\*\*', '\1', 'g'),
         E'\n\n+', E'\n\n', 'g'
       ),
       updated_at = NOW()
 WHERE body LIKE '%**%';

UPDATE public.faq_items
   SET answer = regexp_replace(answer, '\*\*([^*]+)\*\*', '\1', 'g'),
       updated_at = NOW()
 WHERE answer LIKE '%**%';

UPDATE public.library_announcements
   SET body = regexp_replace(body, '\*\*([^*]+)\*\*', '\1', 'g'),
       updated_at = NOW()
 WHERE body LIKE '%**%';

COMMIT;