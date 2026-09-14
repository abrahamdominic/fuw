-- ==============================================================================
-- FUW E-Library — Verified Badges & New-Material Notifications
-- ==============================================================================
-- This migration is shared by both clients (web + Expo mobile) and delivers:
--
--   SEC-VERIFY-1  A real, server-owned `verified` flag on profiles. Previously
--                 both clients hard-coded isVerified = true, which made the
--                 "Verified Student" badge meaningless. Verification is now
--                 written only by an admin RPC or the service role.
--   SEC-VERIFY-2  A BEFORE UPDATE trigger that blocks a user (and a plain
--                 admin self-update) from flipping their own verification.
--   SEC-VERIFY-3  admin_set_user_verified() RPC guarded by is_admin().
--   SEC-VERIFY-4  admin_set_user_active() RPC guarded by is_admin() so ordinary
--                 admins can suspend/activate users (RLS previously restricted
--                 profile UPDATE to super admins only, so the mobile/admin UI
--                 silently failed).
--   SEC-VERIFY-5  safe_profiles + search_students expose the flag for
--                 messaging participants and the student picker.
--   NOTIF-MAT-1   notifications gains dedupe_key / related_material_id /
--                 related_course_code and a broadened `type` allow-list.
--   NOTIF-MAT-2   notify_new_material() AFTER INSERT/UPDATE trigger fans out a
--                 single deduplicated notification per eligible student.
--   NOTIF-MAT-3   notifications is added to the realtime publication so live
--                 inserts reach connected clients.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles: verification columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verified    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.verified IS
  'Server-owned verification badge. Only admins/service role may change it.';
COMMENT ON COLUMN public.profiles.verified_at IS 'When the profile was last verified.';
COMMENT ON COLUMN public.profiles.verified_by IS 'Admin who last changed the verification state.';

-- Backfill: every user who supplied a matriculation number is treated as
-- verified, matching the previous client-side derivation. Admins are always
-- considered verified.
UPDATE public.profiles
   SET verified = TRUE,
       verified_at = COALESCE(verified_at, NOW())
 WHERE verified = FALSE
   AND (
     (COALESCE(matric_number, '') <> '')
     OR role IN ('admin', 'super_admin')
   );

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_verified()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT verified FROM public.profiles WHERE id = auth.uid()), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.my_verified_at()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT verified_at FROM public.profiles WHERE id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.my_verified_by()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT verified_by FROM public.profiles WHERE id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION
  public.my_verified(), public.my_verified_at(), public.my_verified_by()
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Guard verification fields against non-admin writes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.verified IS DISTINCT FROM OLD.verified)
     OR (NEW.verified_at IS DISTINCT FROM OLD.verified_at)
     OR (NEW.verified_by IS DISTINCT FROM OLD.verified_by) THEN
    -- auth.uid() IS NULL means the service role / migration context, which is
    -- trusted; only block authenticated non-admins.
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only administrators may change a profile''s verification state.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_verification ON public.profiles;
CREATE TRIGGER trg_profiles_guard_verification
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

-- -----------------------------------------------------------------------------
-- 4. Admin RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_verified(
  p_user_id uuid,
  p_verified boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A target user is required.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
     SET verified    = p_verified,
         verified_at = CASE WHEN p_verified THEN NOW() ELSE NULL END,
         verified_by = CASE WHEN p_verified THEN auth.uid() ELSE NULL END,
         updated_at  = NOW()
   WHERE id = p_user_id;

  v_name := COALESCE(NULLIF(v_target.full_name, ''), v_target.email, 'your account');

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    p_user_id,
    CASE WHEN p_verified THEN 'Account verified' ELSE 'Verification removed' END,
    CASE WHEN p_verified
         THEN 'Your FUW E-Library account has been verified. The verified badge is now visible on your profile.'
         ELSE 'Your account verification was removed by an administrator. Contact the library if you believe this is an error.' END,
    CASE WHEN p_verified THEN 'success' ELSE 'warning' END,
    '/student/profile'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_user_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A target user is required.' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own account status.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
     SET is_active  = p_active,
         updated_at = NOW()
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_verified(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_verified(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Expose verification to safe_profiles + search_students
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.safe_profiles;
CREATE VIEW public.safe_profiles AS
SELECT
  id,
  username,
  full_name,
  display_name,
  role,
  is_active,
  faculty,
  department,
  level,
  matric_number,
  avatar_url,
  bio,
  verified
FROM public.profiles;

GRANT SELECT ON public.safe_profiles TO authenticated;
REVOKE SELECT ON public.safe_profiles FROM anon;

-- The pre-existing search_students(text, integer) (from the direct-messaging fix)
-- returns 8 columns WITHOUT `verified`. CREATE OR REPLACE cannot change a
-- function's return type (PostgreSQL error 42P13), so drop it first. No DB
-- object depends on it — clients call it over RPC by p_query only.
DROP FUNCTION IF EXISTS public.search_students(text, integer);

CREATE OR REPLACE FUNCTION public.search_students(
  p_query text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  display_name text,
  matric_number text,
  faculty text,
  department text,
  level text,
  verified boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pr.id,
    pr.username,
    pr.full_name,
    pr.display_name,
    pr.matric_number,
    pr.faculty,
    pr.department,
    pr.level,
    pr.verified
  FROM public.profiles pr
  WHERE pr.role = 'student'
    AND pr.is_active = true
    AND pr.id <> auth.uid()
    AND (
      (pr.username IS NOT NULL AND pr.username ILIKE '%' || p_query || '%')
      OR (pr.full_name IS NOT NULL AND pr.full_name ILIKE '%' || p_query || '%')
    )
  ORDER BY
    CASE WHEN pr.username ILIKE p_query || '%' THEN 0 ELSE 1 END,
    pr.username NULLS LAST,
    pr.full_name
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.search_students(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_students(text, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. notifications: dedupe + linkage columns, broadened type allow-list
-- -----------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key           TEXT,
  ADD COLUMN IF NOT EXISTS related_material_id  UUID REFERENCES public.materials(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS related_course_code  TEXT;

COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Stable per-user dedupe token (e.g. material_new:<uuid>). NULL rows are never deduplicated.';

-- Broaden the old 4-value CHECK so material/lifecycle notifications can be typed.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'info', 'success', 'warning', 'error',
    'material_approved', 'material_rejected', 'material_deleted',
    'new_material', 'new_submission', 'admin_promoted', 'system', 'welcome'
  ));

-- One row per user per dedupe token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_related_material
  ON public.notifications (related_material_id);

-- Live inserts must reach subscribed clients.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. New-material notification fan-out (set-based, deduplicated)
-- -----------------------------------------------------------------------------
-- `submitMaterial()` inserts the material row BEFORE its material_departments
-- junction rows, so a single trigger on `materials` would miss the department
-- audience. We therefore fan out from two independent triggers:
--   * trg_notify_new_material      (materials)            — course audience +
--                                     the row's own primary department text.
--   * trg_notify_material_department (material_departments) — each additional
--                                     department as it is attached.
-- The per-user dedupe_key ('material_new:<id>') guarantees a student who is
-- matched by several rules receives exactly one notification per material.

CREATE OR REPLACE FUNCTION public.notify_material_audience(
  p_material_id uuid,
  p_department_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m       public.materials%ROWTYPE;
  v_title text;
  v_body  text;
  v_code  text;
  v_dept  text;
BEGIN
  SELECT * INTO m FROM public.materials WHERE id = p_material_id;
  IF NOT FOUND OR m.status IS DISTINCT FROM 'approved' THEN
    RETURN;
  END IF;

  v_title := COALESCE(NULLIF(trim(m.title), ''), 'New library material');
  v_code  := COALESCE(NULLIF(trim(m.course_code), ''), '');

  v_body := CASE
    WHEN v_code <> '' AND COALESCE(NULLIF(trim(m.course_title), ''), '') <> ''
      THEN v_code || ' — ' || trim(m.course_title) || ' is now available in the library.'
    WHEN v_code <> ''
      THEN v_code || ' materials are now available in the library.'
    ELSE 'A new material is now available in the library.'
  END;

  -- Resolve the target department name (if a specific assignment triggered us,
  -- otherwise fall back to the material's own primary department).
  IF p_department_id IS NOT NULL THEN
    SELECT d.name INTO v_dept FROM public.departments d WHERE d.id = p_department_id;
  ELSE
    v_dept := NULLIF(trim(m.department), '');
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, link,
    dedupe_key, related_material_id, related_course_code
  )
  SELECT DISTINCT
    p.id,
    'New material: ' || v_title,
    v_body,
    'new_material',
    '/library/material/' || m.id,
    'material_new:' || m.id,
    m.id,
    NULLIF(v_code, '')
  FROM public.profiles p
  WHERE p.role = 'student'
    AND p.is_active = TRUE
    AND (
      -- Students in the targeted / any assigned department.
      (
        v_dept IS NOT NULL
        AND lower(trim(p.department)) = lower(v_dept)
      )
      OR EXISTS (
        SELECT 1
        FROM public.material_departments md
        JOIN public.departments d ON d.id = md.department_id
        WHERE md.material_id = m.id
          AND lower(trim(d.name)) = lower(trim(p.department))
      )
      OR (
        -- Students who have an approved course matching the material's code.
        v_code <> ''
        AND EXISTS (
          SELECT 1
          FROM public.student_courses sc
          WHERE sc.student_id = p.id
            AND sc.status = 'approved'
            AND upper(trim(sc.course_code)) = upper(v_code)
        )
      )
    )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

-- 7a. Material lifecycle trigger.
CREATE OR REPLACE FUNCTION public.notify_new_material()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_material_audience(NEW.id, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_material ON public.materials;
CREATE TRIGGER trg_notify_new_material
  AFTER INSERT OR UPDATE OF status ON public.materials
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_material();

-- 7b. Department-assignment trigger (covers additional departments added after
--     the material row already exists).
CREATE OR REPLACE FUNCTION public.notify_material_department()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_material_audience(NEW.material_id, NEW.department_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_material_department ON public.material_departments;
CREATE TRIGGER trg_notify_material_department
  AFTER INSERT ON public.material_departments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_material_department();

-- ==============================================================================
-- End of migration
-- ==============================================================================
