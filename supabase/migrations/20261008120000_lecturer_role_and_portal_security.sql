-- FUW Campus Hub: Lecturer Role Architecture, Onboarding, and Portal Security Migration
-- Migration: 20261008120000_lecturer_role_and_portal_security.sql

BEGIN;

-- 1. Ensure enum value exists (idempotent guard)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lecturer';

-- 2. Schema extensions for public.lecturers
ALTER TABLE public.lecturers
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lecturers_profile_id
  ON public.lecturers(profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lecturers_staff_email
  ON public.lecturers(lower(staff_email))
  WHERE staff_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lecturers_department_id
  ON public.lecturers(department_id);

CREATE INDEX IF NOT EXISTS idx_lecturers_faculty_id
  ON public.lecturers(faculty_id);

-- 3. Multi-department assignments junction table
CREATE TABLE IF NOT EXISTS public.lecturer_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lecturer_id uuid NOT NULL REFERENCES public.lecturers(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lecturer_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_lecturer_departments_lecturer_id
  ON public.lecturer_departments(lecturer_id);

CREATE INDEX IF NOT EXISTS idx_lecturer_departments_department_id
  ON public.lecturer_departments(department_id);

ALTER TABLE public.lecturer_departments ENABLE ROW LEVEL SECURITY;

-- 4. Security helper functions
CREATE OR REPLACE FUNCTION public.is_lecturer()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'lecturer'::public.app_role
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_lecturer_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.lecturers
  WHERE profile_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

-- 5. RLS Policies for lecturer_departments
DROP POLICY IF EXISTS lecturer_departments_read_policy ON public.lecturer_departments;
CREATE POLICY lecturer_departments_read_policy ON public.lecturer_departments
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS lecturer_departments_admin_manage ON public.lecturer_departments;
CREATE POLICY lecturer_departments_admin_manage ON public.lecturer_departments
  FOR ALL
  USING (public.is_admin() OR public.has_permission('manage_lecturers'))
  WITH CHECK (public.is_admin() OR public.has_permission('manage_lecturers'));

-- 6. RLS Policies for lecturers (self-update for bio, phone, office)
DROP POLICY IF EXISTS lecturers_lecturer_update ON public.lecturers;
CREATE POLICY lecturers_lecturer_update ON public.lecturers
  FOR UPDATE
  USING (profile_id = auth.uid() AND public.is_lecturer())
  WITH CHECK (profile_id = auth.uid() AND public.is_lecturer());

-- 7. Materials RLS: allow lecturers to publish directly and edit/delete own materials
DROP POLICY IF EXISTS materials_insert_policy ON public.materials;
CREATE POLICY materials_insert_policy ON public.materials
  FOR INSERT
  WITH CHECK (
    (uploaded_by = auth.uid()) AND (
      (status = 'pending'::material_status)
      OR (status = 'approved'::material_status AND (public.has_permission('upload_as_approved'::text) OR public.is_lecturer()))
    )
  );

DROP POLICY IF EXISTS materials_lecturer_update_policy ON public.materials;
CREATE POLICY materials_lecturer_update_policy ON public.materials
  FOR UPDATE
  USING (
    (uploaded_by = auth.uid()) AND public.is_lecturer()
  )
  WITH CHECK (
    (uploaded_by = auth.uid()) AND public.is_lecturer()
  );

DROP POLICY IF EXISTS materials_delete_policy ON public.materials;
CREATE POLICY materials_delete_policy ON public.materials
  FOR DELETE
  USING (
    (uploaded_by = auth.uid() AND (status <> 'approved'::material_status OR public.is_lecturer()))
    OR public.has_permission('delete_any_material'::text)
  );

-- 8. Material departments RLS: allow lecturers on their own materials
DROP POLICY IF EXISTS material_departments_delete_policy ON public.material_departments;
CREATE POLICY material_departments_delete_policy ON public.material_departments
  FOR DELETE
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_departments.material_id
        AND m.uploaded_by = auth.uid()
        AND (m.status <> 'approved'::material_status OR public.is_lecturer())
    )
  );

-- 9. assign_material_departments RPC update
CREATE OR REPLACE FUNCTION public.assign_material_departments(p_material_id uuid, p_department_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_first_dept_id UUID;
  v_dept_name TEXT;
  v_faculty_id UUID;
  v_fac_name TEXT;
BEGIN
  -- Permission check: caller must be admin, or the material's uploader if lecturer or unapproved
  IF NOT (
    public.is_admin()
    OR (
      public.is_lecturer()
      AND EXISTS (
        SELECT 1 FROM public.materials
        WHERE id = p_material_id AND uploaded_by = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.materials
      WHERE id = p_material_id AND uploaded_by = auth.uid() AND status <> 'approved'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to assign departments to this material.';
  END IF;

  -- Delete removed assignments
  DELETE FROM public.material_departments
  WHERE material_id = p_material_id
    AND NOT (department_id = ANY(p_department_ids));

  -- Insert new assignments
  INSERT INTO public.material_departments (material_id, department_id)
  SELECT p_material_id, unnest(p_department_ids)
  ON CONFLICT (material_id, department_id) DO NOTHING;

  -- Keep the primary department & faculty fields in sync on public.materials
  IF array_length(p_department_ids, 1) > 0 THEN
    v_first_dept_id := p_department_ids[1];
    SELECT d.name, d.faculty_id, f.name
      INTO v_dept_name, v_faculty_id, v_fac_name
      FROM public.departments d
      LEFT JOIN public.faculties f ON f.id = d.faculty_id
     WHERE d.id = v_first_dept_id;

    IF v_dept_name IS NOT NULL THEN
      UPDATE public.materials
      SET department_id = v_first_dept_id,
          department = v_dept_name,
          faculty_id = COALESCE(v_faculty_id, faculty_id),
          faculty = COALESCE(v_fac_name, faculty),
          updated_at = NOW()
      WHERE id = p_material_id;
    END IF;
  END IF;
END;
$function$;

-- 10. Update notify_material_audience with lecturer metadata
CREATE OR REPLACE FUNCTION public.notify_material_audience(p_material_id uuid, p_department_id uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  m               public.materials%ROWTYPE;
  v_title         text;
  v_body          text;
  v_code          text;
  v_dept          text;
  v_lecturer_name text;
  v_lecturer_rank text;
  v_uploader_line text;
BEGIN
  SELECT * INTO m FROM public.materials WHERE id = p_material_id;
  IF NOT FOUND OR m.status IS DISTINCT FROM 'approved' THEN
    RETURN;
  END IF;

  v_title := COALESCE(NULLIF(trim(m.title), ''), 'New library material');
  v_code  := COALESCE(NULLIF(trim(m.course_code), ''), '');

  -- Attempt to resolve verified lecturer details server-side
  SELECT l.full_name, l.academic_rank
    INTO v_lecturer_name, v_lecturer_rank
    FROM public.lecturers l
   WHERE l.profile_id = m.uploaded_by
   LIMIT 1;

  IF v_lecturer_name IS NULL THEN
    SELECT p.full_name INTO v_lecturer_name
      FROM public.profiles p
     WHERE p.id = m.uploaded_by;
  END IF;

  IF v_lecturer_name IS NOT NULL AND trim(v_lecturer_name) <> '' THEN
    v_uploader_line := CASE
      WHEN COALESCE(trim(v_lecturer_rank), '') <> '' THEN trim(v_lecturer_rank) || ' ' || trim(v_lecturer_name)
      ELSE trim(v_lecturer_name)
    END;
    v_body := v_uploader_line || ' posted new ' || lower(replace(m.material_type::text, '_', ' ')) || ' for ' || v_code ||
      CASE WHEN COALESCE(trim(m.course_title), '') <> '' THEN ' (' || trim(m.course_title) || ')' ELSE '' END || ': ' || v_title;
  ELSE
    v_body := CASE
      WHEN v_code <> '' AND COALESCE(NULLIF(trim(m.course_title), ''), '') <> ''
        THEN v_code || ' — ' || trim(m.course_title) || ' is now available in the library.'
      WHEN v_code <> ''
        THEN v_code || ' materials are now available in the library.'
      ELSE 'A new material is now available in the library.'
    END;
  END IF;

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
    )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$function$;

-- 11. RPC for admin to onboard a lecturer
CREATE OR REPLACE FUNCTION public.admin_onboard_lecturer(
  p_full_name text,
  p_staff_email text,
  p_phone text DEFAULT NULL,
  p_staff_id text DEFAULT NULL,
  p_academic_rank text DEFAULT NULL,
  p_office_location text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_faculty_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_department_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lecturer_id uuid;
  v_profile_id uuid;
  v_dept_id uuid;
  v_fac_name text;
  v_dept_name text;
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('manage_lecturers')) THEN
    RAISE EXCEPTION 'Not authorized to onboard lecturers.' USING ERRCODE = '42501';
  END IF;

  IF trim(COALESCE(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'Lecturer full name is required.';
  END IF;

  -- Resolve faculty and department names if IDs provided
  IF p_faculty_id IS NOT NULL THEN
    SELECT name INTO v_fac_name FROM public.faculties WHERE id = p_faculty_id;
  END IF;
  IF p_department_id IS NOT NULL THEN
    SELECT name INTO v_dept_name FROM public.departments WHERE id = p_department_id;
  END IF;

  -- Check if a profile already exists with this email
  IF p_staff_email IS NOT NULL AND trim(p_staff_email) <> '' THEN
    SELECT id INTO v_profile_id
      FROM public.profiles
     WHERE lower(trim(email)) = lower(trim(p_staff_email))
     LIMIT 1;

    IF v_profile_id IS NOT NULL THEN
      UPDATE public.profiles
         SET role = 'lecturer'::public.app_role,
             full_name = COALESCE(NULLIF(trim(p_full_name), ''), full_name),
             faculty = COALESCE(v_fac_name, faculty),
             department = COALESCE(v_dept_name, department),
             phone_number = COALESCE(NULLIF(trim(p_phone), ''), phone_number),
             bio = COALESCE(NULLIF(trim(p_bio), ''), bio),
             is_active = true,
             updated_at = now()
       WHERE id = v_profile_id;
    END IF;
  END IF;

  -- Check if lecturer record already exists with profile_id or staff_email
  IF v_profile_id IS NOT NULL THEN
    SELECT id INTO v_lecturer_id FROM public.lecturers WHERE profile_id = v_profile_id LIMIT 1;
  END IF;

  IF v_lecturer_id IS NULL AND p_staff_email IS NOT NULL AND trim(p_staff_email) <> '' THEN
    SELECT id INTO v_lecturer_id FROM public.lecturers WHERE lower(trim(staff_email)) = lower(trim(p_staff_email)) LIMIT 1;
  END IF;

  IF v_lecturer_id IS NULL THEN
    INSERT INTO public.lecturers (
      full_name, staff_email, phone, staff_id, academic_rank,
      office_location, bio, faculty_id, department_id, profile_id,
      is_active, created_by
    )
    VALUES (
      trim(p_full_name),
      NULLIF(lower(trim(COALESCE(p_staff_email, ''))), ''),
      NULLIF(trim(COALESCE(p_phone, '')), ''),
      NULLIF(trim(COALESCE(p_staff_id, '')), ''),
      COALESCE(trim(COALESCE(p_academic_rank, '')), ''),
      COALESCE(trim(COALESCE(p_office_location, '')), ''),
      COALESCE(trim(COALESCE(p_bio, '')), ''),
      p_faculty_id,
      p_department_id,
      v_profile_id,
      true,
      auth.uid()
    )
    RETURNING id INTO v_lecturer_id;
  ELSE
    UPDATE public.lecturers
       SET full_name = trim(p_full_name),
           staff_email = NULLIF(lower(trim(COALESCE(p_staff_email, ''))), ''),
           phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
           staff_id = COALESCE(NULLIF(trim(COALESCE(p_staff_id, '')), ''), staff_id),
           academic_rank = COALESCE(trim(COALESCE(p_academic_rank, '')), academic_rank),
           office_location = COALESCE(trim(COALESCE(p_office_location, '')), office_location),
           bio = COALESCE(trim(COALESCE(p_bio, '')), bio),
           faculty_id = COALESCE(p_faculty_id, faculty_id),
           department_id = COALESCE(p_department_id, department_id),
           profile_id = COALESCE(v_profile_id, profile_id),
           is_active = true,
           updated_at = now()
     WHERE id = v_lecturer_id;
  END IF;

  -- Assign secondary departments if supplied
  IF p_department_ids IS NOT NULL THEN
    DELETE FROM public.lecturer_departments WHERE lecturer_id = v_lecturer_id;
    FOREACH v_dept_id IN ARRAY p_department_ids LOOP
      INSERT INTO public.lecturer_departments (lecturer_id, department_id)
      VALUES (v_lecturer_id, v_dept_id)
      ON CONFLICT (lecturer_id, department_id) DO NOTHING;
    END LOOP;
  ELSIF p_department_id IS NOT NULL THEN
    INSERT INTO public.lecturer_departments (lecturer_id, department_id)
    VALUES (v_lecturer_id, p_department_id)
    ON CONFLICT (lecturer_id, department_id) DO NOTHING;
  END IF;

  RETURN v_lecturer_id;
END;
$function$;

-- 12. RPC for admin to convert an existing user to lecturer
CREATE OR REPLACE FUNCTION public.admin_convert_user_to_lecturer(
  p_user_id uuid,
  p_staff_id text DEFAULT NULL,
  p_academic_rank text DEFAULT NULL,
  p_office_location text DEFAULT NULL,
  p_faculty_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_department_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_lecturer_id uuid;
  v_dept_id uuid;
  v_fac_name text;
  v_dept_name text;
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('manage_lecturers')) THEN
    RAISE EXCEPTION 'Not authorized to convert users to lecturer.' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot convert their own account to lecturer.';
  END IF;

  SELECT * INTO v_user FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  -- Resolve faculty and department names if IDs provided
  IF p_faculty_id IS NOT NULL THEN
    SELECT name INTO v_fac_name FROM public.faculties WHERE id = p_faculty_id;
  END IF;
  IF p_department_id IS NOT NULL THEN
    SELECT name INTO v_dept_name FROM public.departments WHERE id = p_department_id;
  END IF;

  -- Update target profile
  UPDATE public.profiles
     SET role = 'lecturer'::public.app_role,
         faculty = COALESCE(v_fac_name, faculty),
         department = COALESCE(v_dept_name, department),
         is_active = true,
         updated_at = now()
   WHERE id = p_user_id;

  -- Upsert lecturer record
  SELECT id INTO v_lecturer_id FROM public.lecturers WHERE profile_id = p_user_id LIMIT 1;
  IF v_lecturer_id IS NULL THEN
    INSERT INTO public.lecturers (
      profile_id, full_name, staff_email, phone, staff_id,
      academic_rank, office_location, bio, faculty_id, department_id,
      is_active, created_by
    )
    VALUES (
      p_user_id,
      v_user.full_name,
      v_user.email,
      v_user.phone_number,
      NULLIF(trim(COALESCE(p_staff_id, '')), ''),
      COALESCE(trim(COALESCE(p_academic_rank, '')), ''),
      COALESCE(trim(COALESCE(p_office_location, '')), ''),
      COALESCE(trim(COALESCE(v_user.bio, '')), ''),
      p_faculty_id,
      p_department_id,
      true,
      auth.uid()
    )
    RETURNING id INTO v_lecturer_id;
  ELSE
    UPDATE public.lecturers
       SET staff_id = COALESCE(NULLIF(trim(COALESCE(p_staff_id, '')), ''), staff_id),
           academic_rank = COALESCE(trim(COALESCE(p_academic_rank, '')), academic_rank),
           office_location = COALESCE(trim(COALESCE(p_office_location, '')), office_location),
           faculty_id = COALESCE(p_faculty_id, faculty_id),
           department_id = COALESCE(p_department_id, department_id),
           is_active = true,
           updated_at = now()
     WHERE id = v_lecturer_id;
  END IF;

  -- Assign secondary departments if supplied
  IF p_department_ids IS NOT NULL THEN
    DELETE FROM public.lecturer_departments WHERE lecturer_id = v_lecturer_id;
    FOREACH v_dept_id IN ARRAY p_department_ids LOOP
      INSERT INTO public.lecturer_departments (lecturer_id, department_id)
      VALUES (v_lecturer_id, v_dept_id)
      ON CONFLICT (lecturer_id, department_id) DO NOTHING;
    END LOOP;
  ELSIF p_department_id IS NOT NULL THEN
    INSERT INTO public.lecturer_departments (lecturer_id, department_id)
    VALUES (v_lecturer_id, p_department_id)
    ON CONFLICT (lecturer_id, department_id) DO NOTHING;
  END IF;

  RETURN v_lecturer_id;
END;
$function$;

-- 13. RPC for lecturer to update own personal fields
CREATE OR REPLACE FUNCTION public.lecturer_update_own_profile(
  p_bio text,
  p_phone text,
  p_office_location text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_lecturer() THEN
    RAISE EXCEPTION 'Only lecturers can update their lecturer profile.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.lecturers
     SET bio = COALESCE(trim(COALESCE(p_bio, '')), bio),
         phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
         office_location = COALESCE(trim(COALESCE(p_office_location, '')), office_location),
         updated_at = now()
   WHERE profile_id = auth.uid();

  UPDATE public.profiles
     SET bio = COALESCE(trim(COALESCE(p_bio, '')), bio),
         phone_number = NULLIF(trim(COALESCE(p_phone, '')), ''),
         updated_at = now()
   WHERE id = auth.uid();
END;
$function$;

-- 14. Trigger on signup to link existing lecturer invitations
CREATE OR REPLACE FUNCTION public.apply_lecturer_invite_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lecturer record;
  v_fac_name text;
  v_dept_name text;
BEGIN
  SELECT * INTO v_lecturer
    FROM public.lecturers
   WHERE lower(trim(staff_email)) = lower(trim(NEW.email))
     AND (profile_id IS NULL OR profile_id = NEW.id)
   LIMIT 1;

  IF v_lecturer IS NOT NULL THEN
    NEW.role := 'lecturer'::public.app_role;
    NEW.is_active := TRUE;

    IF v_lecturer.faculty_id IS NOT NULL THEN
      SELECT name INTO v_fac_name FROM public.faculties WHERE id = v_lecturer.faculty_id;
      IF v_fac_name IS NOT NULL THEN
        NEW.faculty := v_fac_name;
      END IF;
    END IF;

    IF v_lecturer.department_id IS NOT NULL THEN
      SELECT name INTO v_dept_name FROM public.departments WHERE id = v_lecturer.department_id;
      IF v_dept_name IS NOT NULL THEN
        NEW.department := v_dept_name;
      END IF;
    END IF;

    UPDATE public.lecturers
       SET profile_id = NEW.id,
           updated_at = now()
     WHERE id = v_lecturer.id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_profile_lecturer_invite_check ON public.profiles;
CREATE TRIGGER on_profile_lecturer_invite_check
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.apply_lecturer_invite_on_signup();

COMMIT;
