-- Admin course publication + academic session management
--
-- 1. Academic sessions: an admin-manageable academic calendar (e.g. 2026/2027).
--    Regular admins (with `manage_catalogue`) manage sessions from the admin
--    dashboard — unlike the static catalogue tables which remain super_admin
--    only. At most one session can be active at a time.
--
-- 2. Admin-published courses: admins "publish" a course directly into the
--    canonical `courses` catalogue through SECURITY DEFINER RPCs. There is no
--    pending/approval stage (that workflow belongs to student_courses); a
--    published course is immediately part of the catalogue. `courses` gains a
--    nullable `created_by` column so published-by-admin rows can be listed and
--    deleted by the publishing admin, while seeded rows stay protected.

-- -----------------------------------------------------------------------------
-- 1. academic_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  starts_on  DATE,
  ends_on    DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.academic_sessions IS 'Academic calendar sessions (e.g. 2026/2027). Admin-managed, at most one active.';

-- Seed the same academic calendar that was previously shown as a static list.
-- The current (active) session mirrors what administrators saw before.
INSERT INTO public.academic_sessions (name, label, is_active, starts_on, ends_on) VALUES
  ('2025/2026', '2025/2026 Academic Session', TRUE, '2025-09-15', '2026-06-30'),
  ('2024/2025', '2024/2025 Academic Session', FALSE, '2024-09-15', '2025-06-30'),
  ('2023/2024', '2023/2024 Academic Session', FALSE, NULL, NULL),
  ('2022/2023', '2022/2023 Academic Session', FALSE, NULL, NULL),
  ('2021/2022', '2021/2022 Academic Session', FALSE, NULL, NULL)
ON CONFLICT (name) DO NOTHING;

-- At most one active session at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS academic_sessions_single_active_idx
  ON public.academic_sessions ((TRUE)) WHERE is_active;

ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone may read the public academic calendar.
DROP POLICY IF EXISTS "academic_sessions_public_select" ON public.academic_sessions;
CREATE POLICY "academic_sessions_public_select" ON public.academic_sessions
  FOR SELECT USING (TRUE);

-- Admins with `manage_catalogue` (or super admins) manage sessions.
DROP POLICY IF EXISTS "academic_sessions_admin_manage" ON public.academic_sessions;
CREATE POLICY "academic_sessions_admin_manage" ON public.academic_sessions
  FOR ALL TO authenticated
  USING (public.has_permission('manage_catalogue'))
  WITH CHECK (public.has_permission('manage_catalogue'));

-- -----------------------------------------------------------------------------
-- 2. courses.created_by — distinguish admin-published rows from seeded ones.
-- -----------------------------------------------------------------------------
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.courses.created_by IS 'Admin who published this course directly. NULL = part of the seeded curriculum.';

-- -----------------------------------------------------------------------------
-- 3. Helpers + admin RPCs (SECURITY DEFINER so catalogue RLS is not bypassed
--    for unauthorized callers — every RPC re-checks manage_catalogue).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_level_id(p_level text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.levels
   WHERE lower(name) = lower(trim(p_level))
      OR numeric_level = NULLIF(regexp_replace(trim(p_level), '\D', '', 'g'), '')::int
   LIMIT 1;
$$;

-- Publish a single course straight into the catalogue (auto-published, no
-- approval step). Returns TRUE when inserted, FALSE when it was a duplicate.
CREATE OR REPLACE FUNCTION public.admin_publish_course(
  p_faculty text DEFAULT '',
  p_department text DEFAULT '',
  p_course_code text DEFAULT '',
  p_course_title text DEFAULT '',
  p_level text DEFAULT '',
  p_semester text DEFAULT '',
  p_credit_units integer DEFAULT NULL,
  p_is_general_course boolean DEFAULT FALSE
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_department_id uuid;
  v_level_id uuid;
  v_existing uuid;
BEGIN
  IF NOT public.has_permission('manage_catalogue') THEN
    RAISE EXCEPTION 'You need the "Manage catalogue" permission to publish courses.';
  END IF;

  IF lower(trim(p_department)) = '' THEN
    RAISE EXCEPTION 'A department is required to publish a course.';
  END IF;

  SELECT d.id INTO v_department_id
    FROM public.departments d
    JOIN public.faculties f ON f.id = d.faculty_id
   WHERE lower(d.name) = lower(trim(p_department))
     AND (lower(trim(p_faculty)) = '' OR lower(f.name) = lower(trim(p_faculty)))
   LIMIT 1;

  IF v_department_id IS NULL THEN
    RAISE EXCEPTION 'Department "%" was not found in the catalogue.', p_department;
  END IF;

  v_level_id := public.resolve_level_id(p_level);

  SELECT c.id INTO v_existing
    FROM public.courses c
   WHERE c.department_id = v_department_id
     AND upper(c.course_code) = upper(trim(p_course_code))
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.courses (
    department_id, course_code, course_title, level_id, semester,
    credit_units, is_general_course, created_by
  ) VALUES (
    v_department_id,
    upper(trim(p_course_code)),
    trim(p_course_title),
    v_level_id,
    nullif(trim(p_semester), ''),
    p_credit_units,
    COALESCE(p_is_general_course, FALSE),
    auth.uid()
  );

  RETURN TRUE;
END $$;

-- Delete a course an admin published. Ordinary admins may only remove their own
-- publications; super admins may remove any catalogue row.
CREATE OR REPLACE FUNCTION public.admin_delete_course(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_permission('manage_catalogue') THEN
    RAISE EXCEPTION 'You need the "Manage catalogue" permission to remove courses.';
  END IF;

  DELETE FROM public.courses
   WHERE id = p_id
     AND (created_by = auth.uid() OR public.is_super_admin());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Course not found, or it was published by another administrator.';
  END IF;
END $$;

-- Create (or update) an academic session. Returns TRUE when a new session was
-- created, FALSE when it already existed. Setting the active flag was previously
-- exclusive.
CREATE OR REPLACE FUNCTION public.admin_upsert_academic_session(
  p_name text,
  p_label text DEFAULT '',
  p_is_active boolean DEFAULT FALSE,
  p_starts_on date DEFAULT NULL,
  p_ends_on date DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_inserted boolean := FALSE;
BEGIN
  IF NOT public.has_permission('manage_catalogue') THEN
    RAISE EXCEPTION 'You need the "Manage catalogue" permission to manage sessions.';
  END IF;

  SELECT id INTO v_id FROM public.academic_sessions WHERE lower(name) = lower(trim(p_name));

  IF v_id IS NULL THEN
    INSERT INTO public.academic_sessions (name, label, is_active, starts_on, ends_on)
    VALUES (trim(p_name), trim(p_label), p_is_active, p_starts_on, p_ends_on)
    RETURNING id INTO v_id;
    v_inserted := TRUE;
  ELSE
    UPDATE public.academic_sessions
       SET label = trim(p_label),
           starts_on = p_starts_on,
           ends_on = p_ends_on,
           updated_at = NOW()
     WHERE id = v_id;
  END IF;

  IF p_is_active THEN
    UPDATE public.academic_sessions SET is_active = FALSE WHERE id <> v_id;
  END IF;

  RETURN v_inserted;
END $$;

-- Activate one session and deactivate every other.
CREATE OR REPLACE FUNCTION public.admin_set_active_academic_session(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_permission('manage_catalogue') THEN
    RAISE EXCEPTION 'You need the "Manage catalogue" permission to manage sessions.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.academic_sessions WHERE id = p_id) THEN
    RAISE EXCEPTION 'Academic session not found.';
  END IF;

  UPDATE public.academic_sessions SET is_active = FALSE WHERE is_active;
  UPDATE public.academic_sessions SET is_active = TRUE, updated_at = NOW() WHERE id = p_id;
END $$;

-- Remove a session. The currently active session cannot be deleted.
CREATE OR REPLACE FUNCTION public.admin_delete_academic_session(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_permission('manage_catalogue') THEN
    RAISE EXCEPTION 'You need the "Manage catalogue" permission to manage sessions.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.academic_sessions WHERE id = p_id AND is_active) THEN
    RAISE EXCEPTION 'The active session cannot be deleted. Activate another session first.';
  END IF;

  DELETE FROM public.academic_sessions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academic session not found.';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION
  public.resolve_level_id(text),
  public.admin_publish_course(text, text, text, text, text, text, integer, boolean),
  public.admin_delete_course(uuid),
  public.admin_upsert_academic_session(text, text, boolean, date, date),
  public.admin_set_active_academic_session(uuid),
  public.admin_delete_academic_session(uuid)
TO authenticated;