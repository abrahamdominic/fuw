-- =============================================================================
-- Part 4: Compulsory registration fields + server-side validation
--
-- The student's academic identity is collected at registration, carried in the
-- sign-up metadata, and mapped into the profile by handle_new_user(). That way
-- the profile is complete the moment the account exists (no window where the
-- dashboard is "incomplete" while onboarding waits), and duplicate matric
-- numbers are rejected by the database itself (profiles.matric_number is UNIQUE).
--
-- A validate_student_registration() RPC gives the registration screen a single
-- authoritative check (normalization + format + in-use detection) that mirrors
-- what the trigger will accept.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Map registration metadata into the profile at sign-up
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requested_username text;
  metadata_academic  boolean;
  meta_matric        text;
  meta_faculty       text;
  meta_dept          text;
  meta_level         text;
  meta_gender        text;
  meta_phone         text;
BEGIN
  requested_username := NULLIF(
    lower(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'username', ''),
                         '[^a-z0-9._-]', '', 'g')),
    ''
  );

  -- Optional academic metadata sent with signUp(). Kept null when absent so the
  -- older email+password flow is unaffected.
  meta_matric  := NULLIF(upper(btrim(COALESCE(NEW.raw_user_meta_data->>'matric_number', ''))), '');
  meta_faculty := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'faculty', '')), '');
  meta_dept    := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'department', '')), '');
  meta_level   := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'level', '')), '');
  meta_gender  := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'gender', '')), '');
  meta_phone   := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'phone_number', '')), '');

  metadata_academic := EXISTS (SELECT FROM (VALUES (meta_matric), (meta_faculty), (meta_dept), (meta_level)) v(x) WHERE x IS NOT NULL);

  -- A registration claiming a matric number must be internally consistent:
  -- faculty/department/level come with it. Malformed metadata is rejected
  -- loudly instead of silently producing a half-complete record.
  IF meta_matric IS NOT NULL AND (meta_faculty IS NULL OR meta_dept IS NULL OR meta_level IS NULL) THEN
    RAISE EXCEPTION 'Registration requires your matric number, faculty, department and level together.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, display_name, username, role,
    matric_number, faculty, department, level, gender, phone_number
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), split_part(NEW.email, '@', 1)),
    requested_username,
    'student'::public.app_role,
    meta_matric, meta_faculty, meta_dept, meta_level, meta_gender, meta_phone
  )
  ON CONFLICT (id) DO UPDATE SET
    email       = EXCLUDED.email,
    username    = CASE
                    WHEN public.profiles.username IS NULL OR trim(public.profiles.username) = ''
                      THEN EXCLUDED.username
                    ELSE public.profiles.username
                  END,
    -- Never clobber identity a student set/changed later.
    matric_number = CASE WHEN public.profiles.matric_number IS NULL THEN EXCLUDED.matric_number
                         ELSE public.profiles.matric_number END,
    faculty       = CASE WHEN public.profiles.faculty IS NULL THEN EXCLUDED.faculty
                         ELSE public.profiles.faculty END,
    department    = CASE WHEN public.profiles.department IS NULL THEN EXCLUDED.department
                         ELSE public.profiles.department END,
    level         = CASE WHEN public.profiles.level IS NULL THEN EXCLUDED.level
                         ELSE public.profiles.level END,
    gender        = CASE WHEN public.profiles.gender IS NULL THEN EXCLUDED.gender
                         ELSE public.profiles.gender END,
    phone_number  = CASE WHEN public.profiles.phone_number IS NULL THEN EXCLUDED.phone_number
                         ELSE public.profiles.phone_number END,
    role        = public.profiles.role,
    updated_at  = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. Server-side registration field validation (called before signUp)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_student_registration(
  p_matric_number TEXT,
  p_faculty       TEXT,
  p_department    TEXT,
  p_level         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_matric text;
  v_ok     boolean := true;
  v_errors jsonb := '[]'::jsonb;
  v_in_use boolean := false;
BEGIN
  v_matric := upper(btrim(COALESCE(p_matric_number, '')));

  IF v_matric = '' OR length(v_matric) < 5 OR length(v_matric) > 30
     OR v_matric !~ '^[A-Z0-9][A-Z0-9/. -]*$' THEN
    v_ok := false;
    v_errors := v_errors || jsonb_build_object('field', 'matricNumber',
      'message', 'Enter a valid matriculation number (letters, digits, slashes, dashes and dots only).');
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.profiles WHERE matric_number = v_matric
    ) INTO v_in_use;
    -- The caller themselves may already own this matric number (re-edit case).
    IF v_in_use AND auth.uid() IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE matric_number = v_matric AND id = auth.uid()
    ) THEN
      v_ok := false;
      v_errors := v_errors || jsonb_build_object('field', 'matricNumber',
        'message', 'This matriculation number is already registered to another account.');
    END IF;
  END IF;

  IF NULLIF(btrim(COALESCE(p_faculty, '')), '') IS NULL OR length(btrim(p_faculty)) < 2 THEN
    v_ok := false;
    v_errors := v_errors || jsonb_build_object('field', 'faculty', 'message', 'Choose your faculty.');
  END IF;

  IF NULLIF(btrim(COALESCE(p_department, '')), '') IS NULL OR length(btrim(p_department)) < 2 THEN
    v_ok := false;
    v_errors := v_errors || jsonb_build_object('field', 'department', 'message', 'Choose your department.');
  END IF;

  IF NULLIF(btrim(COALESCE(p_level, '')), '') IS NULL OR length(btrim(p_level)) > 20 THEN
    v_ok := false;
    v_errors := v_errors || jsonb_build_object('field', 'level', 'message', 'Select your current level.');
  END IF;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'errors', v_errors,
    'matric_number', v_matric,
    'matric_in_use', v_in_use
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_student_registration(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_student_registration(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the profile for a new auth user, mapping optional academic metadata
  (matric_number, faculty, department, level, gender, phone_number) from the
  sign-up payload so a profile can be complete on the very first render.';
COMMENT ON FUNCTION public.validate_student_registration(TEXT, TEXT, TEXT, TEXT) IS
  'Server-side sanity + availability check for the compulsory registration fields.
  Mirrors what handle_new_user will enforce at sign-up time.';