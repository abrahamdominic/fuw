-- =============================================================================
-- Migration: Fix Lecturer Announcements & Seed Business Model Monetization Plans
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Fix public.lecturer_broadcast_announcement
--    - Auto-link lecturer profile if not linked by profile_id
--    - Ensure notification type strictly matches notifications_type_check:
--      'important' -> 'important', others -> 'announcement'
--    - Set notification category to 'academic'
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
  v_caller_email text;
  v_caller_role public.app_role;
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

  SELECT email, role INTO v_caller_email, v_caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  -- Load or auto-link lecturer profile if lecturer
  IF v_caller_role = 'lecturer'::public.app_role THEN
    SELECT * INTO v_lecturer FROM public.lecturers WHERE profile_id = auth.uid() LIMIT 1;
    IF NOT FOUND THEN
      -- Try matching by email
      SELECT * INTO v_lecturer FROM public.lecturers
      WHERE lower(staff_email) = lower(v_caller_email)
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.lecturers SET profile_id = auth.uid() WHERE id = v_lecturer.id;
      ELSE
        -- Auto-provision basic lecturer record if missing
        INSERT INTO public.lecturers (
          profile_id, full_name, staff_email, academic_rank, is_active
        )
        VALUES (
          auth.uid(),
          COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Academic Staff'),
          v_caller_email,
          'Lecturer',
          true
        )
        RETURNING * INTO v_lecturer;
      END IF;
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
      -- If lecturer has assigned departments, verify membership
      IF array_length(v_allowed_dept_ids, 1) > 0 AND NOT (v_allowed_dept_ids @> p_target_department_ids) THEN
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

  -- Map to strictly valid notifications_type_check values ('important' or 'announcement')
  IF p_announcement_type = 'important' THEN
    v_notif_type := 'important';
  ELSE
    v_notif_type := 'announcement';
  END IF;

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
    user_id, title, message, type, category, dedupe_key, sender_name
  )
  SELECT
    pr.id,
    trim(p_title),
    trim(p_body),
    v_notif_type,
    'academic',
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

-- -----------------------------------------------------------------------------
-- 2. Seed Campus Hub Plus Student Plans in public.plans
-- -----------------------------------------------------------------------------
INSERT INTO public.plans (slug, name, description, price_kobo, duration_days, is_premium, is_active, features)
VALUES
  (
    'plus_monthly',
    'Campus Hub Plus (Monthly Pass)',
    '1-month full access to encrypted offline downloads, AI Exam Tutor, and revision summaries.',
    50000,
    30,
    true,
    true,
    '["Encrypted offline downloads & study vault", "Unlimited AI Exam Tutor & past question solver", "AI course summaries & revision sheets", "Target CGPA forecasting & simulator", "100% ad-free experience", "Priority marketplace escrow support"]'::jsonb
  ),
  (
    'plus_semester',
    'Campus Hub Plus (Semester Pass)',
    'Full semester pass (Best value) covering exams, mid-terms, and all study materials.',
    120000,
    120,
    true,
    true,
    '["Encrypted offline downloads & study vault", "Unlimited AI Exam Tutor & past question solver", "AI course summaries & revision sheets", "Target CGPA forecasting & simulator", "100% ad-free experience", "Priority marketplace escrow support", "Exclusive course practice mock questions"]'::jsonb
  ),
  (
    'plus_session',
    'Campus Hub Plus (Full Session)',
    'Complete academic session pass (9 months) covering 1st & 2nd semesters.',
    200000,
    270,
    true,
    true,
    '["Encrypted offline downloads & study vault", "Unlimited AI Exam Tutor & past question solver", "AI course summaries & revision sheets", "Target CGPA forecasting & simulator", "100% ad-free experience", "Priority marketplace escrow support", "Exclusive course practice mock questions", "VIP fast-track dispute mediation"]'::jsonb
  )
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_kobo = EXCLUDED.price_kobo,
  duration_days = EXCLUDED.duration_days,
  is_premium = EXCLUDED.is_premium,
  is_active = EXCLUDED.is_active,
  features = EXCLUDED.features;

COMMIT;
