-- =============================================================================
-- Migration: 20261017120000_document_verification_pipeline.sql
--
-- Automated document authenticity verification for student identity.
--
-- The previous engine auto-approved any well-formed, unique matriculation
-- number after the student uploaded two documents — the documents themselves
-- were never inspected. This migration replaces that with a real pipeline:
--
--   submit_verification()          student submits ONE document (student ID OR
--                                  admission letter); the request enters
--                                  `processing` and NOTHING is auto-approved.
--   verify-document edge function  trusted server-side pipeline: magic-byte
--                                  validation, SHA-256, OCR/extraction, and
--                                  rules-based comparison against the student's
--                                  registration details.
--   apply_verification_decision()  the only path that records an automated
--                                  decision; callable by the service role only,
--                                  idempotent, and fully audited.
--
-- New statuses (adapting the existing vocabulary rather than replacing it):
--   processing             document submitted, automated checks running
--   verified/approved      all required authenticity + identity checks passed
--   rejected               reliable checks revealed a material problem
--   action_required        document unreadable/incomplete/wrong type — replace
--   verification_unavailable OCR/provider temporarily unavailable — retry
--   pending                uncertain result routed to the library queue
--
-- Idempotent: safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extended status vocabulary
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_verification_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_verification_status_check
  CHECK (verification_status IN (
    'unsubmitted', 'processing', 'pending', 'verified',
    'rejected', 'action_required', 'verification_unavailable'
  ));

ALTER TABLE public.verification_requests
  DROP CONSTRAINT IF EXISTS verification_requests_status_check;
ALTER TABLE public.verification_requests
  ADD CONSTRAINT verification_requests_status_check
  CHECK (status IN (
    'pending', 'approved', 'rejected', 'withdrawn',
    'processing', 'action_required', 'verification_unavailable'
  ));

COMMENT ON COLUMN public.profiles.verification_status IS
  'Academic identity verification state: unsubmitted | processing | pending | verified | rejected | action_required | verification_unavailable.';

-- -----------------------------------------------------------------------------
-- 2. Pipeline columns on the ledger
-- -----------------------------------------------------------------------------
ALTER TABLE public.verification_requests
  ADD COLUMN IF NOT EXISTS document_type    text
    CHECK (document_type IN ('student_id', 'admission_letter')),
  ADD COLUMN IF NOT EXISTS decision_code    text,
  ADD COLUMN IF NOT EXISTS checks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS document_sha256  text,
  ADD COLUMN IF NOT EXISTS engine_version   text;

COMMENT ON COLUMN public.verification_requests.document_type IS
  'Which document the student chose to verify with: student_id | admission_letter.';
COMMENT ON COLUMN public.verification_requests.decision_code IS
  'Machine-readable reason for the latest automated decision (e.g. name_mismatch, unreadable). Never contains OCR text or personal content.';
COMMENT ON COLUMN public.verification_requests.checks IS
  'Auditable outcomes of each automated check (check id, outcome, short detail). Contains no document text.';
COMMENT ON COLUMN public.verification_requests.document_sha256 IS
  'SHA-256 of the submitted document bytes, used for reuse/conflict detection only.';

CREATE INDEX IF NOT EXISTS idx_verification_requests_sha256
  ON public.verification_requests (document_sha256)
  WHERE document_sha256 IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. One active submission per student across every open state
--
-- The old partial unique index only covered `pending`. The pipeline adds
-- `processing`, `action_required` and `verification_unavailable` as open
-- states a student may resubmit from, so the uniqueness guard is re-scoped.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_verification_requests_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_requests_one_open
  ON public.verification_requests (user_id)
  WHERE status IN ('processing', 'pending', 'action_required', 'verification_unavailable');

CREATE INDEX IF NOT EXISTS idx_verification_requests_processing
  ON public.verification_requests (created_at)
  WHERE status = 'processing';

-- -----------------------------------------------------------------------------
-- 4. Audit table for automated attempts
--
-- Records every engine attempt and its outcome. Deliberately stores check
-- outcomes and decision codes only — never raw OCR text or document bytes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES public.verification_requests(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  decision       text NOT NULL
                   CHECK (decision IN ('verified', 'rejected', 'action_required',
                                       'verification_unavailable', 'pending')),
  decision_code  text,
  checks         jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_version text,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_request
  ON public.verification_attempts (request_id, created_at DESC);

ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verification_attempts_select_admin" ON public.verification_attempts;
CREATE POLICY "verification_attempts_select_admin" ON public.verification_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE ALL ON public.verification_attempts FROM anon;
GRANT SELECT ON public.verification_attempts TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Student submission path — ONE document, enters `processing`
--
-- No auto-approval of any kind happens here. The request is queued for the
-- verify-document edge function, which performs the authenticity checks and
-- records the decision through apply_verification_decision().
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_verification(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_verification(
  p_document_type    text,
  p_document_path    text,
  p_document_name    text,
  p_student_note     text DEFAULT NULL
)
RETURNS public.verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile      public.profiles%ROWTYPE;
  v_request      public.verification_requests%ROWTYPE;
  v_type         text;
  v_path         text;
  v_note         text;
  v_matric       text;
  v_is_format_ok boolean;
  v_attempts24h  integer;
BEGIN
  -- Trusted opt-in consumed by profiles_sync_verification_flag(); transaction-
  -- local, so a client can never forge it.
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

  v_type := lower(btrim(coalesce(p_document_type, '')));
  IF v_type NOT IN ('student_id', 'admission_letter') THEN
    RAISE EXCEPTION 'Choose either your student ID card or your admission letter.'
      USING ERRCODE = 'P0001';
  END IF;

  v_path := NULLIF(btrim(coalesce(p_document_path, '')), '');
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'Upload your document before submitting.' USING ERRCODE = 'P0001';
  END IF;

  -- The document must sit inside this student's own storage prefix.
  IF v_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'Verification documents must be files in your own upload folder.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ...and must actually exist in the private bucket, owned by the caller, so
  -- a client cannot reference a path it never uploaded.
  IF NOT EXISTS (
       SELECT 1 FROM storage.objects
       WHERE bucket_id = 'verification-evidence' AND name = v_path AND owner = auth.uid()
     ) THEN
    RAISE EXCEPTION 'We could not find your uploaded document. Please re-upload and try again.'
      USING ERRCODE = 'P0001';
  END IF;

  v_matric := upper(btrim(COALESCE(v_profile.matric_number, '')));
  IF v_matric = ''
     OR COALESCE(NULLIF(btrim(v_profile.faculty), ''), '') = ''
     OR COALESCE(NULLIF(btrim(v_profile.department), ''), '') = '' THEN
    RAISE EXCEPTION 'Add your matriculation number, faculty and department before requesting verification.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Exactly the rule validate_student_registration() applies before signup, so
  -- the two can never disagree about what a valid matriculation number is.
  v_is_format_ok := (
    length(v_matric) BETWEEN 5 AND 30
    AND v_matric ~ '^[A-Z0-9][A-Z0-9/. -]*$'
  );
  IF NOT v_is_format_ok THEN
    RAISE EXCEPTION 'Your matriculation number format is invalid. Standard format is e.g. CIS/CSC/20/001.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Abuse protection: a handful of attempts per day is generous for a human
  -- and hostile to scripted abuse.
  SELECT count(*) INTO v_attempts24h
  FROM public.verification_requests
  WHERE user_id = auth.uid()
    AND created_at > NOW() - INTERVAL '24 hours';
  IF v_attempts24h >= 5 THEN
    RAISE EXCEPTION 'You have reached today''s verification attempt limit. Please try again tomorrow, or contact the library.'
      USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(left(btrim(coalesce(p_student_note, '')), 1000), '');

  -- One active submission per student: resubmission (e.g. after
  -- action_required) reuses the open row, so repeated requests can never
  -- create conflicting decisions.
  SELECT * INTO v_request
  FROM public.verification_requests
  WHERE user_id = auth.uid()
    AND status IN ('processing', 'pending', 'action_required', 'verification_unavailable')
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.verification_requests
       SET status              = 'processing',
           document_type       = v_type,
           student_id_path       = CASE WHEN v_type = 'student_id' THEN v_path ELSE NULL END,
           student_id_name       = CASE WHEN v_type = 'student_id'
                                        THEN NULLIF(left(btrim(coalesce(p_document_name, '')), 200), '') ELSE NULL END,
           admission_letter_path = CASE WHEN v_type = 'admission_letter' THEN v_path ELSE NULL END,
           admission_letter_name = CASE WHEN v_type = 'admission_letter'
                                        THEN NULLIF(left(btrim(coalesce(p_document_name, '')), 200), '') ELSE NULL END,
           student_note        = COALESCE(v_note, student_note),
           matric_number       = v_matric,
           faculty             = btrim(v_profile.faculty),
           department          = btrim(v_profile.department),
           level               = NULLIF(btrim(coalesce(v_profile.level, '')), ''),
           decision_code       = NULL,
           checks              = '[]'::jsonb,
           document_sha256     = NULL,
           engine_version      = NULL,
           reviewer_note       = NULL,
           reviewed_by         = NULL,
           reviewed_at         = NULL,
           created_at          = NOW()
     WHERE id = v_request.id
     RETURNING * INTO v_request;
  ELSE
    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, document_type,
      student_id_path, student_id_name,
      admission_letter_path, admission_letter_name
    )
    VALUES (
      auth.uid(), 'processing', v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_type,
      CASE WHEN v_type = 'student_id' THEN v_path END,
      CASE WHEN v_type = 'student_id'
           THEN NULLIF(left(btrim(coalesce(p_document_name, '')), 200), '') END,
      CASE WHEN v_type = 'admission_letter' THEN v_path END,
      CASE WHEN v_type = 'admission_letter'
           THEN NULLIF(left(btrim(coalesce(p_document_name, '')), 200), '') END
    )
    RETURNING * INTO v_request;
  END IF;

  UPDATE public.profiles
     SET verification_status     = 'processing',
         verification_reason     = NULL,
         verification_submitted_at = NOW(),
         verification_reviewed_at  = NULL,
         verification_reviewed_by  = NULL,
         updated_at              = NOW()
   WHERE id = auth.uid();

  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verification(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_verification(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.submit_verification(text, text, text, text) IS
  'The only student submission path. Requires ONE document (student ID or admission '
  'letter) in the caller''s private folder, then parks the request in `processing` '
  'for the verify-document edge function. Never grants verification by itself.';

-- -----------------------------------------------------------------------------
-- 6. Automated decision recorder — service-role only, idempotent, audited
--
-- This is the ONLY function that may move a request to `approved` outside of
-- explicit administrator review. It is revoked from every client role: the
-- verify-document edge function calls it with the service-role key, which
-- clients never see.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_verification_decision(
  p_request_id      uuid,
  p_decision        text,
  p_decision_code   text,
  p_reason          text,
  p_checks          jsonb DEFAULT '[]'::jsonb,
  p_document_sha256 text DEFAULT NULL,
  p_engine_version  text DEFAULT NULL
)
RETURNS public.verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request     public.verification_requests%ROWTYPE;
  v_target      text;
  v_profile     public.profiles%ROWTYPE;
  v_reason      text;
  v_title       text;
  v_body        text;
  v_kind        text;
  v_checks      jsonb;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request is required.' USING ERRCODE = 'P0001';
  END IF;

  v_target := CASE lower(btrim(coalesce(p_decision, '')))
    WHEN 'verified'                THEN 'approved'
    WHEN 'rejected'                THEN 'rejected'
    WHEN 'action_required'         THEN 'action_required'
    WHEN 'verification_unavailable' THEN 'verification_unavailable'
    WHEN 'pending'                 THEN 'pending'
    ELSE NULL
  END;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Unknown verification decision.' USING ERRCODE = 'P0001';
  END IF;

  -- Audit payload hygiene: keep only a bounded, text-free summary.
  IF p_checks IS NULL OR jsonb_typeof(p_checks) <> 'array' THEN
    v_checks := '[]'::jsonb;
  ELSIF octet_length(p_checks::text) > 20000 THEN
    v_checks := '[{"id":"checks_truncated","outcome":"info"}]'::jsonb;
  ELSE
    v_checks := p_checks;
  END IF;

  v_reason := NULLIF(left(btrim(coalesce(p_reason, '')), 500), '');

  SELECT * INTO v_request
  FROM public.verification_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found.' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency + first-decision-wins: an already-decided request (by this
  -- pipeline or an administrator) is never flipped by a repeated or late call.
  IF v_request.status IN ('approved', 'rejected', 'withdrawn') THEN
    RETURN v_request;
  END IF;
  IF v_request.status = v_target THEN
    RETURN v_request;
  END IF;

  -- Trust boundary: this function must only be driven by the trusted backend.
  -- The edge function runs with the service role (no end-user JWT); anything
  -- else is an administrator using the dedicated admin RPC instead.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Automated verification decisions are server-only.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('fuw.allow_verification_write', 'on', true);

  INSERT INTO public.verification_attempts (
    request_id, user_id, decision, decision_code, checks, engine_version
  )
  VALUES (
    v_request.id, v_request.user_id,
    CASE v_target
      WHEN 'approved' THEN 'verified'
      WHEN 'action_required' THEN 'action_required'
      WHEN 'verification_unavailable' THEN 'verification_unavailable'
      WHEN 'pending' THEN 'pending'
      ELSE 'rejected'
    END,
    NULLIF(left(btrim(coalesce(p_decision_code, '')), 100), ''),
    v_checks,
    NULLIF(left(btrim(coalesce(p_engine_version, '')), 50), '')
  );

  UPDATE public.verification_requests
     SET status          = v_target,
         decision_code   = NULLIF(left(btrim(coalesce(p_decision_code, '')), 100), ''),
         checks          = v_checks,
         document_sha256 = NULLIF(btrim(coalesce(p_document_sha256, '')), ''),
         engine_version  = NULLIF(left(btrim(coalesce(p_engine_version, '')), 50), ''),
         reviewer_note   = CASE WHEN v_target IN ('pending', 'action_required', 'rejected')
                                THEN COALESCE(v_reason, reviewer_note)
                                ELSE reviewer_note END,
         reviewed_at     = CASE WHEN v_target IN ('approved', 'rejected', 'pending')
                                THEN NOW() ELSE reviewed_at END
   WHERE id = v_request.id
   RETURNING * INTO v_request;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_request.user_id;

  IF v_target = 'approved' THEN
    UPDATE public.profiles
       SET verification_status      = 'verified',
           verification_reason      = NULL,
           verification_reviewed_at = NOW(),
           updated_at               = NOW()
     WHERE id = v_request.user_id;

    v_title := 'Student identity verified';
    v_body  := 'Your document passed the automated checks and your FUW student identity is now verified. Your Verified Scholar badge is live.';
    v_kind  := 'verification_approved';

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (v_request.user_id, v_title, v_body, v_kind, '/student/verification',
            'verification_decided:' || v_request.id::text)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  ELSIF v_target = 'rejected' THEN
    UPDATE public.profiles
       SET verification_status      = 'rejected',
           verification_reason      = COALESCE(v_reason, 'The submitted document did not pass verification.'),
           verification_reviewed_at = NOW(),
           updated_at               = NOW()
     WHERE id = v_request.user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      v_request.user_id,
      'Verification not accepted',
      'Your document did not pass verification: ' ||
        COALESCE(v_reason, 'the automated checks found a problem.') ||
        ' You can submit a different document from your student portal.',
      'verification_rejected', '/student/verification',
      'verification_decided:' || v_request.id::text
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  ELSIF v_target = 'action_required' THEN
    UPDATE public.profiles
       SET verification_status      = 'action_required',
           verification_reason      = COALESCE(v_reason, 'Your document could not be read clearly. Please upload a clearer copy.'),
           verification_reviewed_at = NOW(),
           updated_at               = NOW()
     WHERE id = v_request.user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      v_request.user_id,
      'A clearer document is needed',
      COALESCE(v_reason, 'Your document could not be read clearly.') ||
        ' Please upload a clearer, complete copy from your student portal.',
      'verification_action_required', '/student/verification',
      'verification_decided:' || v_request.id::text
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  ELSIF v_target = 'verification_unavailable' THEN
    UPDATE public.profiles
       SET verification_status      = 'verification_unavailable',
           verification_reason      = COALESCE(v_reason, 'Automated verification is temporarily unavailable. Retry shortly.'),
           verification_reviewed_at = NOW(),
           updated_at               = NOW()
     WHERE id = v_request.user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      v_request.user_id,
      'Verification temporarily unavailable',
      'We could not complete the automated checks right now. Your account stays unverified — retry from your student portal shortly.',
      'verification_unavailable', '/student/verification',
      'verification_decided:' || v_request.id::text
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  ELSIF v_target = 'pending' THEN
    UPDATE public.profiles
       SET verification_status      = 'pending',
           verification_reason      = NULL,
           verification_reviewed_at = NULL,
           updated_at               = NOW()
     WHERE id = v_request.user_id;

    -- Uncertain outcome: hand off to the library queue rather than guess.
    INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
    SELECT
      p.id,
      'Verification needs a quick review',
      btrim(COALESCE(v_profile.full_name, 'A student')) || ' (' || v_request.matric_number ||
        ', ' || v_request.department || ') has an automated verification result that needs review.',
      'system',
      'verify_req:' || v_request.id
    FROM public.profiles p
    WHERE p.is_active = TRUE
      AND p.role IN ('admin', 'super_admin')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      v_request.user_id,
      'Verification under review',
      COALESCE(v_reason, 'Your document needs a quick manual check by the library.') ||
        ' You will be notified as soon as a decision is made.',
      'verification_submitted', '/student/verification',
      'verification_decided:' || v_request.id::text
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN v_request;
END;
$$;

-- Locked down to the service role: no end user, not even an administrator
-- session token, can drive the automated decision path. Administrators keep
-- their explicit review via admin_review_verification().
REVOKE ALL ON FUNCTION public.apply_verification_decision(uuid, text, text, text, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verification_decision(uuid, text, text, text, jsonb, text, text)
  TO service_role;

COMMENT ON FUNCTION public.apply_verification_decision(uuid, text, text, text, jsonb, text, text) IS
  'Records an automated verification decision from the verify-document edge '
  'function. Service-role only. Idempotent: the first decision on a request wins.';

-- -----------------------------------------------------------------------------
-- 7. Keep the admin review path consistent with the new statuses
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_verification(
  p_request_id uuid,
  p_approve boolean,
  p_reviewer_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req     public.verification_requests%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_note    text;
  v_title   text;
  v_body    text;
  v_kind    text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = 'P0001';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request is required.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.verification_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found.' USING ERRCODE = 'P0001';
  END IF;
  -- The library may only decide requests the pipeline routed to the human
  -- queue, plus any legacy pending rows. Decided/processing rows are off-limits.
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_req.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student profile not found.' USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(left(trim(coalesce(p_reviewer_note, '')), 1000), '');

  IF p_approve THEN
    IF COALESCE(NULLIF(trim(v_profile.matric_number), ''), '') = ''
       OR COALESCE(NULLIF(trim(v_profile.faculty), ''), '') = ''
       OR COALESCE(NULLIF(trim(v_profile.department), ''), '') = '' THEN
      RAISE EXCEPTION 'The student profile is missing identity details. Ask the student to complete their profile first.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.verification_requests
       SET status        = 'approved',
           reviewer_note = COALESCE(v_note, reviewer_note),
           reviewed_by   = auth.uid(),
           reviewed_at   = NOW()
     WHERE id = p_request_id;

    UPDATE public.profiles
       SET verification_status        = 'verified',
           verification_reason        = NULL,
           verification_reviewed_at   = NOW(),
           verification_reviewed_by   = auth.uid(),
           verified                   = TRUE,
           verified_at                = NOW(),
           verified_by                = auth.uid(),
           updated_at                 = NOW()
     WHERE id = v_req.user_id;

    v_title := 'Identity verified';
    v_body  := 'Your academic identity has been verified by the library. Premium materials are now available to you.';
    v_kind  := 'verification_approved';
  ELSE
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'Give a reason so the student knows what to correct.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.verification_requests
       SET status        = 'rejected',
           reviewer_note = v_note,
           reviewed_by   = auth.uid(),
           reviewed_at   = NOW()
     WHERE id = p_request_id;

    UPDATE public.profiles
       SET verification_status      = 'rejected',
           verification_reason      = v_note,
           verification_reviewed_at = NOW(),
           verification_reviewed_by = auth.uid(),
           verified                 = FALSE,
           verified_at              = NULL,
           verified_by              = NULL,
           updated_at               = NOW()
     WHERE id = v_req.user_id;

    v_title := 'Verification needs attention';
    v_body  := 'Your academic identity could not be verified: ' || v_note;
    v_kind  := 'verification_rejected';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_req.user_id, v_title, v_body, v_kind, '/student/verification',
    'verification_decided:' || p_request_id::text
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_verification(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_verification(uuid, boolean, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Protect every document referenced by an open or approved request
--
-- `action_required` documents are replaceable, so the old file must be
-- deletable once a new upload supersedes it; everything still under review or
-- on an approved record stays protected.
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
          WHERE vr.status IN ('processing', 'pending', 'approved', 'verification_unavailable')
            AND (
              vr.student_id_path = storage.objects.name
              OR vr.admission_letter_path = storage.objects.name
              OR vr.evidence_path = storage.objects.name
            )
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 9. Notification types for the new outcomes
-- -----------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'info', 'success', 'warning', 'error',
    'material_approved', 'material_rejected', 'material_deleted',
    'new_material', 'new_submission', 'admin_promoted', 'system', 'welcome',
    'announcement', 'maintenance', 'important', 'system_update',
    'verification_submitted', 'verification_approved', 'verification_rejected',
    'verification_action_required', 'verification_unavailable',
    'plan_activated', 'plan_expired'
  ));

-- -----------------------------------------------------------------------------
-- 10. Retention helper for superseded evidence
--
-- Students own their private folder and may delete files no longer referenced
-- by an open/approved request (policy in section 8). This helper lets an
-- administrator list replaceable leftovers after a resubmission; actual
-- deletion happens through the Storage API so the RLS policy is enforced.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_orphaned_verification_documents()
RETURNS TABLE (object_name text, owner_id uuid, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT so.name::text, so.owner, so.created_at
  FROM storage.objects so
  WHERE so.bucket_id = 'verification-evidence'
    AND NOT EXISTS (
      SELECT 1 FROM public.verification_requests vr
      WHERE vr.status IN ('processing', 'pending', 'approved', 'verification_unavailable')
        AND (
          vr.student_id_path = so.name
          OR vr.admission_letter_path = so.name
          OR vr.evidence_path = so.name
        )
    )
  ORDER BY so.created_at
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_orphaned_verification_documents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_orphaned_verification_documents() TO authenticated;

COMMIT;
