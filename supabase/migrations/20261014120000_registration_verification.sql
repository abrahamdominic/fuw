-- =============================================================================
-- Migration: 20261014120000_registration_verification.sql
--
-- Fold academic identity verification into student registration.
--
-- Students now upload their student ID *and* their admission letter while
-- creating their account. A single trusted engine (submit_verification) then
-- auto-verifies them when the matriculation number is well-formed and unique,
-- so a fresh student lands in a verified, complete workspace instead of being
-- asked to re-enter the same academic details during onboarding and again in a
-- separate verification screen.
--
--   1. verification_requests gains the two document slots
--   2. profiles_sync_verification_flag() honours a transaction-local bypass so
--      SECURITY DEFINER RPCs (not just administrators) may set verified state
--   3. submit_verification() is redefined to require BOTH documents
--   4. The private-bucket delete policy protects every document under review
--
-- Idempotent: safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Document slots on the verification ledger
-- -----------------------------------------------------------------------------
ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS student_id_path        text,
  ADD COLUMN IF NOT EXISTS student_id_name        text,
  ADD COLUMN IF NOT EXISTS admission_letter_path  text,
  ADD COLUMN IF NOT EXISTS admission_letter_name  text;

COMMENT ON COLUMN public.verification_requests.student_id_path IS
  'Private storage object name of the student ID card uploaded at registration.';
COMMENT ON COLUMN public.verification_requests.admission_letter_path IS
  'Private storage object name of the admission letter uploaded at registration.';

-- -----------------------------------------------------------------------------
-- 2. Let trusted server routines move the verification columns.
--
-- The verification columns are server-owned: without this explicit opt-in the
-- guard below rejects every non-admin write, which is exactly what silently
-- broke auto-verification (the SECURITY DEFINER engine runs as the student's
-- request, not as an administrator). The bypass is transaction-local
-- (set_config(..., true)) and only ever set inside the definer routines, so a
-- student cannot forge it from the client.
-- -----------------------------------------------------------------------------
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

  -- Verification columns are server-owned for everyone but admins and the
  -- trusted routines that explicitly opt in for the current transaction.
  IF auth.uid() IS NOT NULL
     AND NOT public.is_admin()
     AND COALESCE(current_setting('fuw.allow_verification_write', true), 'off') <> 'on' THEN
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

-- -----------------------------------------------------------------------------
-- 3. Two-document verification engine
-- -----------------------------------------------------------------------------
-- Retire the previous, single-evidence signature; the replacement requires both
-- documents so a verified account always has a student ID and an admission
-- letter on file for the library.
DROP FUNCTION IF EXISTS public.submit_verification(text, text, text);

CREATE OR REPLACE FUNCTION public.submit_verification(
  p_student_id_path       text,
  p_student_id_name       text,
  p_admission_letter_path text,
  p_admission_letter_name text,
  p_student_note          text DEFAULT NULL
)
RETURNS public.verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile      public.profiles%ROWTYPE;
  v_request      public.verification_requests%ROWTYPE;
  v_note         text;
  v_sid          text;
  v_adm          text;
  v_matric       text;
  v_is_format_ok boolean;
  v_is_duplicate boolean;
BEGIN
  -- Trusted opt-in consumed by profiles_sync_verification_flag(); local to this
  -- transaction so it cannot leak into the caller's session.
  PERFORM set_config('fuw.allow_verification_write', 'on', true);

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.role IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Staff accounts do not require academic verification.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_profile.is_active THEN
    RAISE EXCEPTION 'This account is suspended. Contact the library.' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.verification_status = 'verified' THEN
    RAISE EXCEPTION 'Your account is already verified.' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.verification_status = 'pending' THEN
    RAISE EXCEPTION 'Your verification request is already under review.' USING ERRCODE = 'P0001';
  END IF;

  v_sid := NULLIF(btrim(coalesce(p_student_id_path, '')), '');
  v_adm := NULLIF(btrim(coalesce(p_admission_letter_path, '')), '');

  IF v_sid IS NULL OR v_adm IS NULL THEN
    RAISE EXCEPTION 'Upload both your student ID and your admission letter to complete verification.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Both documents must sit inside this student's own storage prefix.
  IF v_sid !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$')
     OR v_adm !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'Verification documents must be files in your own upload folder.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ...and must actually exist in the private bucket, owned by the caller. This
  -- closes the gap where a client could reference a path it never uploaded.
  IF NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'verification-evidence' AND name = v_sid AND owner = auth.uid()
      )
     OR NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'verification-evidence' AND name = v_adm AND owner = auth.uid()
      ) THEN
    RAISE EXCEPTION 'We could not find one of your uploaded documents. Please re-upload and try again.'
      USING ERRCODE = 'P0001';
  END IF;

  v_matric := upper(btrim(COALESCE(v_profile.matric_number, '')));

  IF v_matric = ''
     OR COALESCE(NULLIF(btrim(v_profile.faculty), ''), '') = ''
     OR COALESCE(NULLIF(btrim(v_profile.department), ''), '') = '' THEN
    RAISE EXCEPTION 'Add your matriculation number, faculty and department before requesting verification.'
      USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(left(btrim(coalesce(p_student_note, '')), 1000), '');

  -- Exactly the rule validate_student_registration() applies before signup, so
  -- the two can never disagree about what a valid matriculation number is.
  v_is_format_ok := (
    length(v_matric) BETWEEN 5 AND 30
    AND v_matric ~ '^[A-Z0-9][A-Z0-9/. -]*$'
  );

  -- A matric number already held by a verified account defers to a human.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id <> auth.uid()
      AND upper(btrim(matric_number)) = v_matric
      AND verified = TRUE
  ) INTO v_is_duplicate;

  IF NOT v_is_format_ok THEN
    -- AUTO_REJECTED: blatantly invalid matriculation number.
    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, student_id_path, student_id_name,
      admission_letter_path, admission_letter_name,
      reviewer_note, reviewed_at
    )
    VALUES (
      auth.uid(), 'rejected',
      v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_sid, NULLIF(left(btrim(coalesce(p_student_id_name, '')), 200), ''),
      v_adm, NULLIF(left(btrim(coalesce(p_admission_letter_name, '')), 200), ''),
      'Automatic check: the matriculation number format is invalid. Standard format is FUW/YYYY/... or FUW/UG/YYYY/...',
      now()
    )
    RETURNING * INTO v_request;

    UPDATE public.profiles
       SET verification_status = 'rejected',
           verification_reason = 'Invalid matriculation number format. Standard format is FUW/[year]/[department]/[number].',
           verification_submitted_at = now(),
           verification_reviewed_at = now(),
           updated_at = now()
     WHERE id = auth.uid();

    INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
    VALUES (
      auth.uid(),
      'Verification Rejected',
      'Your matriculation number (' || v_matric || ') does not follow the Federal University Wukari format. Check it and submit again from your student portal.',
      'important',
      'verification_auto_reject:' || v_request.id
    );

    RETURN v_request;

  ELSIF NOT v_is_duplicate THEN
    -- AUTO_VERIFIED: valid matric number, both documents on file, no conflict.
    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, student_id_path, student_id_name,
      admission_letter_path, admission_letter_name,
      reviewer_note, reviewed_at, reviewed_by
    )
    VALUES (
      auth.uid(), 'approved',
      v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_sid, NULLIF(left(btrim(coalesce(p_student_id_name, '')), 200), ''),
      v_adm, NULLIF(left(btrim(coalesce(p_admission_letter_name, '')), 200), ''),
      'Automatically verified: matriculation number validated and both identity documents submitted at registration.',
      now(),
      auth.uid()
    )
    RETURNING * INTO v_request;

    UPDATE public.profiles
       SET verification_status = 'verified',
           verification_reason = NULL,
           verification_submitted_at = now(),
           verification_reviewed_at = now(),
           verified = TRUE,
           updated_at = now()
     WHERE id = auth.uid();

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      auth.uid(),
      'Student Identity Verified',
      'Congratulations! Your FUW student identity has been verified. Your Verified Scholar badge is now visible on your profile.',
      'system',
      '/student/profile',
      'verification_auto_verified:' || v_request.id
    );

    RETURN v_request;

  ELSE
    -- MANUAL_REVIEW: valid format, but the matric number collides with an
    -- already-verified account, so a reviewer decides.
    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, student_id_path, student_id_name,
      admission_letter_path, admission_letter_name
    )
    VALUES (
      auth.uid(), 'pending',
      v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_sid, NULLIF(left(btrim(coalesce(p_student_id_name, '')), 200), ''),
      v_adm, NULLIF(left(btrim(coalesce(p_admission_letter_name, '')), 200), '')
    )
    RETURNING * INTO v_request;

    UPDATE public.profiles
       SET verification_status = 'pending',
           verification_reason = NULL,
           verification_submitted_at = now(),
           updated_at = now()
     WHERE id = auth.uid();

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    SELECT
      p.id,
      'Verification request pending review',
      btrim(v_profile.full_name) || ' (' || v_matric || ', ' || btrim(v_profile.department) || ') submitted verification for review.',
      'system',
      '/admin/verification',
      'verify_req:' || v_request.id
    FROM public.profiles p
    WHERE p.is_active = TRUE
      AND p.role IN ('admin', 'super_admin')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    RETURN v_request;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verification(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_verification(text, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_verification(text, text, text, text, text) IS
  'The only student verification path. Requires a student ID and an admission '
  'letter in the caller''s private folder, then auto-verifies well-formed unique '
  'matriculation numbers and defers collisions to the admin queue.';

-- -----------------------------------------------------------------------------
-- 4. Protect every document referenced by an open or approved request
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "verification evidence delete" ON storage.objects;
CREATE POLICY "verification evidence delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'verification-evidence'
    AND (
      public.is_admin()
      OR (
        owner = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.verification_requests vr
          WHERE vr.status IN ('pending', 'approved')
            AND (
              vr.student_id_path = storage.objects.name
              OR vr.admission_letter_path = storage.objects.name
              OR vr.evidence_path = storage.objects.name
            )
        )
      )
    )
  );

COMMIT;
