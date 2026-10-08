-- Migration: 20261008130000_onboarding_and_fixes.sql
-- Description:
--   1. Personalized onboarding state columns on public.profiles
--   2. complete_user_onboarding RPC for saving step progress and completion
--   3. Fix admin_convert_user_to_lecturer to accept p_full_name and enforce 3-160 char check constraint
--   4. Fix Marketplace Admin / Staff permissions so platform admins have full marketplace management & verification visibility
--   5. Lecturer targeted announcement broadcasting RPC

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Onboarding State Columns on public.profiles
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_started boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_completed
  ON public.profiles(onboarding_completed)
  WHERE NOT onboarding_completed;

-- Self-heal verification mirror trigger so legacy rows do not fail updates
CREATE OR REPLACE FUNCTION public.profiles_sync_verification_flag()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    NEW.verified := (NEW.verification_status = 'verified');
    IF NEW.verified THEN
      NEW.verified_at := COALESCE(NEW.verified_at, NOW());
      NEW.verified_by := COALESCE(NEW.verified_by, auth.uid());
    ELSE
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
    END IF;
  ELSE
    -- Keep mirror automatically in sync with authoritative verification_status
    NEW.verified := (NEW.verification_status = 'verified');
  END IF;

  -- Verification columns are server-owned for everyone but admins.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.verification_reason IS DISTINCT FROM OLD.verification_reason
       OR NEW.verification_submitted_at IS DISTINCT FROM OLD.verification_submitted_at
       OR NEW.verification_reviewed_at IS DISTINCT FROM OLD.verification_reviewed_at
       OR NEW.verification_reviewed_by IS DISTINCT FROM OLD.verification_reviewed_by THEN
      RAISE EXCEPTION 'Only administrators may change a profile''s verification state.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Mark established existing profiles as completed so existing users are not abruptly blocked
UPDATE public.profiles
   SET verified = (verification_status = 'verified'),
       onboarding_completed = true,
       onboarding_started = true,
       onboarding_completed_at = COALESCE(onboarding_completed_at, now())
 WHERE is_active = true
   AND (
     (role = 'student' AND matric_number IS NOT NULL AND length(trim(matric_number)) > 0 AND department IS NOT NULL)
     OR (role IN ('admin', 'super_admin'))
     OR (role = 'lecturer' AND faculty IS NOT NULL)
   );

-- -----------------------------------------------------------------------------
-- 2. complete_user_onboarding RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_user_onboarding(
  p_step integer DEFAULT 1,
  p_completed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET onboarding_started = true,
         onboarding_step = GREATEST(1, COALESCE(p_step, 1)),
         onboarding_completed = CASE WHEN p_completed THEN true ELSE onboarding_completed END,
         onboarding_completed_at = CASE WHEN p_completed THEN COALESCE(onboarding_completed_at, now()) ELSE onboarding_completed_at END,
         updated_at = now()
   WHERE id = v_uid;

  SELECT jsonb_build_object(
    'onboarding_started', onboarding_started,
    'onboarding_step', onboarding_step,
    'onboarding_completed', onboarding_completed,
    'onboarding_completed_at', onboarding_completed_at
  ) INTO v_res
  FROM public.profiles
  WHERE id = v_uid;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_user_onboarding(integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_user_onboarding(integer, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Fix admin_convert_user_to_lecturer (accept p_full_name, guarantee valid length)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_convert_user_to_lecturer(
  p_user_id uuid,
  p_staff_id text DEFAULT NULL,
  p_academic_rank text DEFAULT NULL,
  p_office_location text DEFAULT NULL,
  p_faculty_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_department_ids uuid[] DEFAULT NULL,
  p_full_name text DEFAULT NULL
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
  v_full_name text;
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

  -- Resolve sanitized full name with guarantee of 3 to 160 chars
  v_full_name := COALESCE(
    NULLIF(trim(p_full_name), ''),
    NULLIF(trim(v_user.full_name), ''),
    NULLIF(trim(v_user.display_name), ''),
    NULLIF(trim(split_part(v_user.email, '@', 1)), ''),
    'Academic Lecturer'
  );
  IF length(v_full_name) < 3 THEN
    v_full_name := v_full_name || ' (Lecturer)';
  END IF;
  IF length(v_full_name) > 160 THEN
    v_full_name := substring(v_full_name FROM 1 FOR 160);
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
         full_name = CASE WHEN length(trim(COALESCE(full_name, ''))) < 3 THEN v_full_name ELSE full_name END,
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
      v_full_name,
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
       SET full_name = v_full_name,
           staff_email = COALESCE(v_user.email, staff_email),
           phone = COALESCE(v_user.phone_number, phone),
           staff_id = COALESCE(NULLIF(trim(COALESCE(p_staff_id, '')), ''), staff_id),
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

REVOKE ALL ON FUNCTION public.admin_convert_user_to_lecturer(uuid, text, text, text, uuid, uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_convert_user_to_lecturer(uuid, text, text, text, uuid, uuid, uuid[], text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Fix Marketplace Permissions for Platform Admins & Pending Verifications
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mp_is_admin(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_uid IS NULL THEN RETURN FALSE; END IF;

  -- Platform admin / super_admin is authorized as marketplace admin
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_uid
      AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
      AND is_active = true
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_admin_staff s
     WHERE s.user_id = p_uid
       AND s.revoked_at IS NULL
       AND s.is_active
       AND (s.role = 'super_admin' OR s.permissions @> ARRAY['*']::TEXT[])
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mp_has_perm(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;

  -- Platform admin / super_admin has all marketplace permissions
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
      AND is_active = true
  ) THEN
    RETURN TRUE;
  END IF;

  IF p_permission IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_admin_staff s
     WHERE s.user_id = auth.uid()
       AND s.revoked_at IS NULL
       AND s.is_active
       AND (s.permissions @> ARRAY['*']::TEXT[] OR s.permissions @> ARRAY[p_permission])
  ) INTO v_ok;
  RETURN COALESCE(v_ok, FALSE);
END;
$function$;

-- Update marketplace_vendor_verifications admin select policy
DROP POLICY IF EXISTS "mp_vv_select_admin" ON public.marketplace_vendor_verifications;
CREATE POLICY "mp_vv_select_admin"
  ON public.marketplace_vendor_verifications
  FOR SELECT
  TO public
  USING (
    public.is_admin() OR public.mp_has_perm('verify_vendors'::text)
  );

-- Update marketplace_vendors admin select policy
DROP POLICY IF EXISTS "mp_vendors_select_admin" ON public.marketplace_vendors;
CREATE POLICY "mp_vendors_select_admin"
  ON public.marketplace_vendors
  FOR SELECT
  TO public
  USING (
    public.is_admin() OR public.mp_is_admin(auth.uid()) OR public.mp_has_perm('verify_vendors'::text) OR public.mp_has_perm('manage_vendors'::text)
  );

-- -----------------------------------------------------------------------------
-- 5. Lecturer Broadcast Announcements RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lecturer_broadcast_announcement(
  p_title text,
  p_body text,
  p_target_faculty_id uuid DEFAULT NULL,
  p_target_department_ids uuid[] DEFAULT NULL,
  p_announcement_type text DEFAULT 'general'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lecturer public.lecturers%ROWTYPE;
  v_sender_name text;
  v_notif_type text;
  v_announcement_id uuid;
  v_target_faculty_name text := NULL;
  v_target_dept_names text[] := NULL;
  v_allowed_dept_ids uuid[] := ARRAY[]::uuid[];
  v_dept_id uuid;
BEGIN
  -- Authenticate caller: must be lecturer or platform admin
  IF NOT (public.is_lecturer() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Only authorized lecturers or administrators can broadcast announcements.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(trim(p_title), '') IS NULL THEN
    RAISE EXCEPTION 'An announcement title is required.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(p_body), '') IS NULL THEN
    RAISE EXCEPTION 'An announcement message is required.' USING ERRCODE = '22023';
  END IF;

  -- Load lecturer profile if lecturer
  IF public.is_lecturer() THEN
    SELECT * INTO v_lecturer FROM public.lecturers WHERE profile_id = auth.uid() LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lecturer record not found.' USING ERRCODE = 'P0002';
    END IF;

    -- Collect authorized department IDs for this lecturer
    IF v_lecturer.department_id IS NOT NULL THEN
      v_allowed_dept_ids := array_append(v_allowed_dept_ids, v_lecturer.department_id);
    END IF;
    FOR v_dept_id IN (SELECT department_id FROM public.lecturer_departments WHERE lecturer_id = v_lecturer.id) LOOP
      IF NOT (v_allowed_dept_ids @> ARRAY[v_dept_id]) THEN
        v_allowed_dept_ids := array_append(v_allowed_dept_ids, v_dept_id);
      END IF;
    END LOOP;

    -- Enforce scope: if department IDs passed, verify lecturer is authorized
    IF p_target_department_ids IS NOT NULL AND array_length(p_target_department_ids, 1) > 0 THEN
      IF NOT (v_allowed_dept_ids @> p_target_department_ids) THEN
        RAISE EXCEPTION 'Cannot broadcast to departments outside your authorized academic scope.' USING ERRCODE = '42501';
      END IF;
    END IF;

    -- If target faculty specified, verify it matches lecturer's faculty
    IF p_target_faculty_id IS NOT NULL AND v_lecturer.faculty_id IS NOT NULL THEN
      IF p_target_faculty_id <> v_lecturer.faculty_id THEN
        RAISE EXCEPTION 'Cannot broadcast to a faculty outside your authorized academic appointment.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- Resolve faculty name
  IF p_target_faculty_id IS NOT NULL THEN
    SELECT name INTO v_target_faculty_name FROM public.faculties WHERE id = p_target_faculty_id;
  END IF;

  -- Resolve department names
  IF p_target_department_ids IS NOT NULL AND array_length(p_target_department_ids, 1) > 0 THEN
    SELECT array_agg(name) INTO v_target_dept_names
    FROM public.departments
    WHERE id = ANY(p_target_department_ids);
  END IF;

  -- Fallback if no target explicitly supplied: scope to lecturer's primary department/faculty
  IF v_target_faculty_name IS NULL AND v_target_dept_names IS NULL AND v_lecturer.id IS NOT NULL THEN
    IF v_lecturer.department_id IS NOT NULL THEN
      SELECT array_agg(name) INTO v_target_dept_names
      FROM public.departments
      WHERE id = v_lecturer.department_id;
    END IF;
    IF v_lecturer.faculty_id IS NOT NULL THEN
      SELECT name INTO v_target_faculty_name
      FROM public.faculties
      WHERE id = v_lecturer.faculty_id;
    END IF;
  END IF;

  v_notif_type := CASE p_announcement_type
    WHEN 'important' THEN 'important'
    WHEN 'assignment' THEN 'academic'
    WHEN 'exam' THEN 'exam'
    ELSE 'announcement'
  END;

  SELECT COALESCE(
    (SELECT academic_rank || ' ' || full_name FROM public.lecturers WHERE profile_id = auth.uid() AND academic_rank <> ''),
    (SELECT full_name FROM public.lecturers WHERE profile_id = auth.uid()),
    display_name, full_name, 'Academic Staff'
  )
  INTO v_sender_name
  FROM public.profiles
  WHERE id = auth.uid();

  -- Insert into library_announcements
  INSERT INTO public.library_announcements (
    title, body, audience, announcement_type, is_published, published_by, published_at
  )
  VALUES (
    trim(p_title), trim(p_body), 'students', 'general', true, auth.uid(), now()
  )
  RETURNING id INTO v_announcement_id;

  -- Targeted notifications for matching students
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
  WHERE pr.is_active = true
    AND pr.role = 'student'
    AND (
      (v_target_dept_names IS NOT NULL AND pr.department = ANY(v_target_dept_names))
      OR (v_target_dept_names IS NULL AND v_target_faculty_name IS NOT NULL AND pr.faculty = v_target_faculty_name)
      OR (v_target_dept_names IS NULL AND v_target_faculty_name IS NULL)
    )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN v_announcement_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.lecturer_broadcast_announcement(text, text, uuid, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lecturer_broadcast_announcement(text, text, uuid, uuid[], text) TO authenticated;

COMMIT;
