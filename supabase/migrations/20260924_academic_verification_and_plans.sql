-- ==============================================================================
-- FUW E-Library — Academic Identity Verification & Premium Entitlement
-- ==============================================================================
-- Shared by both clients (web + Expo mobile).
--
-- Goals
--   1. Replace the single boolean `verified` badge with a real, auditable
--      academic identity verification workflow:
--        unsubmitted -> pending -> verified | rejected  (rejected may re-submit)
--   2. Premium access must never be reachable without verified academic
--      identity. Access = authenticated AND verified AND active entitlement.
--   3. Everything a student does goes through guarded SECURITY DEFINER RPCs;
--      there is no client-writable path that can flip verification or grants.
--   4. Backward compatible: the existing `verified` boolean stays in place as a
--      mirror of `verification_status = 'verified'` so existing views, RPCs and
--      clients keep working, but it can no longer be set independently.
--
-- Delivered
--   VERIFY-1  profiles: verification_status / reason / timeline columns.
--   VERIFY-2  profiles_sync_verification_flag(): keeps the legacy `verified`
--             boolean in lock-step with `verification_status` and blocks
--             non-admins from writing any verification column.
--   VERIFY-3  verification_requests: immutable submission ledger (who applied
--             with what identity snapshot and which evidence file).
--   VERIFY-4  submit_verification(): the only student submission path. Validates
--             profile completeness, blocks duplicate open requests, snapshots the
--             identity, and notifies administrators.
--   VERIFY-5  admin_review_verification(): the only review path. Approving also
--             writes verified/verified_at/verified_by; rejecting stores a
--             student-visible reason and re-opens the submission window.
--   VERIFY-6  Private `verification-evidence` storage bucket: owner may upload
--             and read their own proof, admins may read it. Images/PDF only.
--   PLAN-1    plans catalogue (free + premium) seeded idempotently.
--   PLAN-2    subscriptions: admin-managed entitlement ledger. No payment
--             gateway is implied or required by this migration.
--   PLAN-3    my_access() / has_premium_access() / my_plan() entitlement helpers.
--   PLAN-4    Library file bytes are gated: only admins, or verified students
--             with an active entitlement, can read objects in `library-materials`.
--             Catalogue metadata stays publicly readable so browsing still works.
--   PLAN-5    admin_grant_plan() / admin_revoke_plan(): the only entitlement
--             write paths, including expiry maintenance.
--   NOTIF-1   Lifecycle notifications for submitted/approved/rejected/plans.
-- Idempotent: safe to re-run.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles: verification workflow columns (VERIFY-1)
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unsubmitted',
  ADD COLUMN IF NOT EXISTS verification_reason TEXT,
  ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_verification_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_verification_status_check
  CHECK (verification_status IN ('unsubmitted', 'pending', 'verified', 'rejected'));

COMMENT ON COLUMN public.profiles.verification_status IS
  'Academic identity verification state: unsubmitted | pending | verified | rejected.';
COMMENT ON COLUMN public.profiles.verification_reason IS
  'Reviewer explanation shown to the student when a submission is rejected.';
COMMENT ON COLUMN public.profiles.verification_submitted_at IS
  'When the student last submitted identity details for review.';
COMMENT ON COLUMN public.profiles.verification_reviewed_at IS
  'When an administrator last decided the submission.';
COMMENT ON COLUMN public.profiles.verification_reviewed_by IS
  'Administrator who last decided the submission.';

-- Backfill from the legacy boolean so the two never disagree on existing rows.
-- These run before the mirror trigger exists, so the derived columns the trigger
-- would normally fill in are set explicitly here.
UPDATE public.profiles
   SET verification_status      = 'verified',
       verification_reviewed_at = COALESCE(verified_at, NOW()),
       verified_at              = COALESCE(verified_at, NOW())
 WHERE verified = TRUE
   AND verification_status = 'unsubmitted';

-- Admins are institutional staff, not students awaiting verification.
UPDATE public.profiles
   SET verification_status = 'verified',
       verification_reason = NULL
 WHERE role IN ('admin', 'super_admin')
   AND verification_status <> 'verified';

-- -----------------------------------------------------------------------------
-- 2. Keep the legacy `verified` boolean honest (VERIFY-2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_sync_verification_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- The boolean is a mirror, never an independent input. Recompute it whenever
  -- the authoritative status moves.
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    NEW.verified := (NEW.verification_status = 'verified');
    IF NEW.verified THEN
      NEW.verified_at := COALESCE(NEW.verified_at, NOW());
      NEW.verified_by := COALESCE(NEW.verified_by, auth.uid());
    ELSE
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
    END IF;
  ELSIF NEW.verified IS DISTINCT FROM (OLD.verification_status = 'verified') THEN
    -- Someone tried to drive the mirror directly. Reject it and re-derive.
    RAISE EXCEPTION 'Use verification_status; the verified flag is server-managed.'
      USING ERRCODE = 'P0001';
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
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_verification ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_sync_verification ON public.profiles;
CREATE TRIGGER trg_profiles_sync_verification
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_sync_verification_flag();

CREATE INDEX IF NOT EXISTS idx_profiles_verification_status
  ON public.profiles (verification_status)
  WHERE role = 'student';

-- -----------------------------------------------------------------------------
-- 3. Verification request ledger (VERIFY-3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verification_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  -- Identity snapshot exactly as the student submitted it, so an audit trail
  -- survives later profile edits.
  matric_number     TEXT NOT NULL,
  faculty           TEXT NOT NULL,
  department        TEXT NOT NULL,
  level             TEXT,
  student_note      TEXT,
  -- Evidence (private storage object name in `verification-evidence`).
  evidence_path     TEXT,
  evidence_name     TEXT,
  reviewer_note     TEXT,
  reviewed_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_requests_user
  ON public.verification_requests (user_id, created_at DESC);

-- profiles.id mirrors auth.users.id, and the admin queue joins
-- `verification_requests` to `profiles!inner(...)` through PostgREST. Without a
-- declared foreign key PostgREST cannot infer the relationship and the embed
-- fails at runtime, so the link is made explicit here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.verification_requests'::regclass
       AND contype    = 'f'
       AND conname    = 'verification_requests_user_id_fkey_profiles'
  ) THEN
    ALTER TABLE public.verification_requests
      ADD CONSTRAINT verification_requests_user_id_fkey_profiles
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_verification_requests_queue
  ON public.verification_requests (created_at)
  WHERE status = 'pending';

-- At most one open submission per student at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_requests_one_open
  ON public.verification_requests (user_id)
  WHERE status = 'pending';

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.verification_requests IS
  'Audit ledger of academic identity verification submissions. Rows are immutable '
  'to clients; all decisions go through submit_verification()/admin_review_verification().';

DROP POLICY IF EXISTS "verification_requests_select_own" ON public.verification_requests;
CREATE POLICY "verification_requests_select_own" ON public.verification_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE ALL ON public.verification_requests FROM anon;
GRANT SELECT ON public.verification_requests TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Student submission path (VERIFY-4)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_profile_completeness()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(NULLIF(trim(p.matric_number), ''), '') <> ''
      AND COALESCE(NULLIF(trim(p.faculty), ''), '') <> ''
      AND COALESCE(NULLIF(trim(p.department), ''), '') <> ''
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_verification(
  p_student_note text DEFAULT NULL,
  p_evidence_path text DEFAULT NULL,
  p_evidence_name text DEFAULT NULL
)
RETURNS public.verification_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile  public.profiles%ROWTYPE;
  v_request  public.verification_requests%ROWTYPE;
  v_note     text;
  v_evidence text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.role IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Staff accounts do not require academic verification.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_profile.is_active THEN
    RAISE EXCEPTION 'This account is suspended. Contact the library.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.verification_status = 'verified' THEN
    RAISE EXCEPTION 'Your account is already verified.' USING ERRCODE = 'P0001';
  END IF;

  IF v_profile.verification_status = 'pending' THEN
    RAISE EXCEPTION 'Your verification request is already under review.'
      USING ERRCODE = 'P0001';
  END IF;

  -- The evidence path must sit inside this student's own storage prefix. Without
  -- this check a user could attach another student's document to their request
  -- and then read it back through the owner's own policy.
  IF p_evidence_path IS NOT NULL
     AND left(trim(p_evidence_path), length(auth.uid()::text) + 1) <> auth.uid()::text || '/' THEN
    RAISE EXCEPTION 'The evidence file does not belong to your account.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Identity details must be complete before an administrator can compare them
  -- against the student register.
  IF COALESCE(NULLIF(trim(v_profile.matric_number), ''), '') = ''
     OR COALESCE(NULLIF(trim(v_profile.faculty), ''), '') = ''
     OR COALESCE(NULLIF(trim(v_profile.department), ''), '') = '' THEN
    RAISE EXCEPTION 'Add your matriculation number, faculty and department before requesting verification.'
      USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(left(trim(coalesce(p_student_note, '')), 1000), '');
  -- Evidence is optional; when supplied it must live in our private bucket and
  -- under the caller's own folder.
  v_evidence := NULLIF(trim(coalesce(p_evidence_path, '')), '');
  IF v_evidence IS NOT NULL THEN
    IF v_evidence !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') THEN
      RAISE EXCEPTION 'Evidence must be a file in your own upload folder.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.verification_requests (
    user_id, status, matric_number, faculty, department, level,
    student_note, evidence_path, evidence_name
  )
  VALUES (
    auth.uid(), 'pending',
    btrim(v_profile.matric_number), btrim(v_profile.faculty),
    btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
    v_note, v_evidence, NULLIF(left(trim(coalesce(p_evidence_name, '')), 200), '')
  )
  RETURNING * INTO v_request;

  UPDATE public.profiles
     SET verification_status     = 'pending',
         verification_reason     = NULL,
         verification_submitted_at = NOW(),
         updated_at              = NOW()
   WHERE id = auth.uid();

  -- Tell the administrators there is a queue item waiting.
  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  SELECT
    p.id,
    'Verification request received',
    btrim(v_profile.full_name) || ' (' || btrim(v_profile.matric_number) ||
      ') submitted academic identity verification for review.',
    'verification_submitted',
    '/admin/verification',
    'verification_new:' || v_request.id::text
  FROM public.profiles p
  WHERE p.role IN ('admin', 'super_admin')
    AND p.is_active
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verification(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_verification(text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Administrator review path (VERIFY-5)
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
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been decided.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_req.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student profile not found.' USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(left(trim(coalesce(p_reviewer_note, '')), 1000), '');

  IF p_approve THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = 'P0001';
    END IF;
    -- Refuse to verify an account whose identity fields no longer match the
    -- snapshot the administrator actually reviewed.
    IF COALESCE(NULLIF(trim(v_profile.matric_number), ''), '') = ''
       OR COALESCE(NULLIF(trim(v_profile.faculty), ''), '') = ''
       OR COALESCE(NULLIF(trim(v_profile.department), ''), '') = '' THEN
      RAISE EXCEPTION 'The student profile is missing identity details. Ask the student to complete their profile first.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.verification_requests
       SET status        = 'approved',
           reviewer_note = v_note,
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
-- 5b. Legacy admin toggle, routed through the workflow (VERIFY-5)
--     admin_set_user_verified() shipped in 20260915 and is still wired to the
--     admin user-management screens. It used to write profiles.verified
--     directly, which the mirror trigger now rejects, and it left the request
--     ledger and verification_status inconsistent. The same call is therefore
--     redefined as a staff override that moves the whole workflow forward and
--     records who decided what, so old and new admin screens cannot disagree.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_verified(
  p_user_id uuid,
  p_verified boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_note   text := 'Set directly by a library administrator.';
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

  IF p_verified THEN
    IF v_target.matric_number IS NULL
       OR v_target.faculty IS NULL
       OR v_target.department IS NULL THEN
      RAISE EXCEPTION 'Complete this student''s matric number, faculty and department before verifying them.'
        USING ERRCODE = 'P0001';
    END IF;

    -- An open request would block the partial unique index below.
    UPDATE public.verification_requests
       SET status        = 'approved',
           reviewer_note = v_note,
           reviewed_by   = auth.uid(),
           reviewed_at   = NOW()
     WHERE user_id = p_user_id
       AND status IN ('pending', 'rejected');

    IF NOT EXISTS (
      SELECT 1 FROM public.verification_requests
       WHERE user_id = p_user_id
         AND status = 'approved'
    ) THEN
      INSERT INTO public.verification_requests (
        user_id, status, matric_number, faculty, department, level,
        reviewer_note, reviewed_by, reviewed_at
      )
      VALUES (
        p_user_id, 'approved', v_target.matric_number, v_target.faculty,
        v_target.department, v_target.level, v_note, auth.uid(), NOW()
      );
    END IF;

    UPDATE public.profiles
       SET verification_status      = 'verified',
           verification_reason      = NULL,
           verification_reviewed_at = NOW(),
           verification_reviewed_by = auth.uid(),
           updated_at               = NOW()
     WHERE id = p_user_id;
  ELSE
    UPDATE public.verification_requests
       SET status        = 'rejected',
           reviewer_note = 'Verification revoked by the library.',
           reviewed_by   = auth.uid(),
           reviewed_at   = NOW()
     WHERE user_id = p_user_id
       AND status IN ('pending', 'approved');

    UPDATE public.profiles
       SET verification_status      = 'unsubmitted',
           verification_reason      = NULL,
           verification_reviewed_at = NULL,
           verification_reviewed_by = NULL,
           updated_at               = NOW()
     WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_verified(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_verified(uuid, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Private evidence bucket (VERIFY-6)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('verification-evidence', 'verification-evidence', false, 5242880)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- Evidence must be an image or a PDF. Enforced with a trigger rather than the
-- bucket's mime allow-list so the rule survives older storage schemas.
CREATE OR REPLACE FUNCTION public.guard_verification_evidence_upload()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type text := lower(split_part(coalesce(NEW.name, ''), '.', -1));
BEGIN
  IF TG_OP = 'INSERT' AND NEW.bucket_id = 'verification-evidence' THEN
    IF v_type NOT IN ('jpg', 'jpeg', 'png', 'webp', 'pdf') THEN
      RAISE EXCEPTION 'Verification evidence must be a JPG, PNG, WebP or PDF file.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.owner IS NULL AND auth.uid() IS NOT NULL THEN
      NEW.owner := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_verification_evidence ON storage.objects;
CREATE TRIGGER trg_guard_verification_evidence
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_verification_evidence_upload();

-- Evidence is a private academic record: only the student who uploaded it and
-- library staff may read it. Verified status alone is NOT enough — otherwise any
-- verified student could download somebody else's matric number and ID card.
DROP POLICY IF EXISTS "verification evidence read" ON storage.objects;
CREATE POLICY "verification evidence read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'verification-evidence'
    AND (public.is_admin() OR owner = auth.uid())
  );

DROP POLICY IF EXISTS "verification evidence upload" ON storage.objects;
CREATE POLICY "verification evidence upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'verification-evidence'
    AND (public.is_admin() OR (owner = auth.uid() AND name LIKE auth.uid()::text || '/%'))
  );

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
          WHERE vr.evidence_path = storage.objects.name
            AND vr.status = 'pending'
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 7. Plan catalogue and entitlement ledger (PLAN-1, PLAN-2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  -- Kobo (Nigeria) is the smallest currency unit; no payment gateway is wired
  -- up by this migration, admins grant entitlements manually.
  price_kobo   INTEGER NOT NULL DEFAULT 0 CHECK (price_kobo >= 0),
  duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  is_premium   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  features     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'expired', 'revoked')),
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  granted_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_note  TEXT,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_active
  ON public.subscriptions (user_id, expires_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_plans_slug ON public.plans (slug);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.subscriptions IS
  'Admin-managed premium entitlement ledger. No payment gateway is implied.';

-- The catalogue is public marketing content; entitlements are private.
DROP POLICY IF EXISTS "plans_public_read" ON public.plans;
CREATE POLICY "plans_public_read" ON public.plans
  FOR SELECT
  USING (is_active);

DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE ALL ON public.subscriptions FROM anon;
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;

INSERT INTO public.plans (slug, name, description, price_kobo, duration_days, is_premium, features)
VALUES
  ('free', 'Library Access',
   'Browse the catalogue and read summaries, abstracts and previews.',
   0, 36500, false,
   '["Browse the full catalogue", "Preview documents", "Saved lists", "Study planner"]'::jsonb),
  ('premium', 'Premium Full Access',
   'Download and read every approved lecture note, textbook and past question.',
   150000, 30, true,
   '["Everything in Free", "Unlimited downloads", "Full-text reading", "Offline PDF access", "Priority new-material alerts"]'::jsonb)
ON CONFLICT (slug) DO UPDATE
  SET name         = EXCLUDED.name,
      description  = EXCLUDED.description,
      features     = EXCLUDED.features,
      is_premium   = EXCLUDED.is_premium;

-- -----------------------------------------------------------------------------
-- 8. Entitlement helpers (PLAN-3)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_verified()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND verification_status = 'verified' AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.my_verification_status()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT verification_status FROM public.profiles WHERE id = auth.uid()),
    'unsubmitted'
  );
$$;

CREATE OR REPLACE FUNCTION public.my_verification_reason()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT verification_reason FROM public.profiles WHERE id = auth.uid());
$$;

/** The caller's current entitlement, if any. Verification is required. */
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS TABLE (
  plan_slug TEXT,
  plan_name TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ,
  is_premium BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.slug, pl.name, s.status, s.expires_at, pl.is_premium
  FROM public.subscriptions s
  JOIN public.plans pl ON pl.id = s.plan_id
  WHERE s.user_id = auth.uid()
    AND s.status = 'active'
    AND s.expires_at > NOW()
  ORDER BY pl.is_premium DESC, s.expires_at DESC
  LIMIT 1;
$$;

/**
 * The single gate used by clients and by storage RLS.
 * Premium access requires BOTH a verified academic identity and an active
 * entitlement — neither one alone is ever enough.
 */
CREATE OR REPLACE FUNCTION public.has_premium_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.my_verified()
     AND EXISTS (
       SELECT 1
       FROM public.subscriptions s
       JOIN public.plans pl ON pl.id = s.plan_id
       WHERE s.user_id = auth.uid()
         AND s.status = 'active'
         AND s.expires_at > NOW()
         AND pl.is_premium
         AND pl.is_active
     );
$$;

GRANT EXECUTE ON FUNCTION
  public.my_verified(),
  public.my_verification_status(),
  public.my_verification_reason(),
  public.my_profile_completeness()
TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_premium_access() TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Gate the library file bytes (PLAN-4)
--    Catalogue metadata stays world-readable (browsing must still work), but the
--    actual documents can only be fetched by staff, or by students whose academic
--    identity is verified AND who hold an active entitlement. Anonymous visitors
--    keep browsing titles/abstracts/course metadata but cannot pull the PDFs.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public read storage" ON storage.objects;
DROP POLICY IF EXISTS "library-materials public read" ON storage.objects;
DROP POLICY IF EXISTS "library-materials public read v2" ON storage.objects;

-- The bucket is absent in some environments, and uploads to a missing bucket
-- fail. It must stay PRIVATE: a public bucket would hand every document to
-- anonymous visitors and make the read policy below pointless.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('library-materials', 'library-materials', false, 104857600)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY "library-materials entitlement read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'library-materials'
    AND (public.is_admin() OR public.has_premium_access())
  );

-- -----------------------------------------------------------------------------
-- 10. Admin entitlement management (PLAN-5)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_plan(
  p_user_id uuid,
  p_plan_slug text,
  p_days integer DEFAULT NULL,
  p_admin_note text DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_sub  public.subscriptions%ROWTYPE;
  v_days integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A target user is required.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE slug = lower(trim(p_plan_slug));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown plan.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_plan.is_active THEN
    RAISE EXCEPTION 'That plan is no longer offered.' USING ERRCODE = 'P0001';
  END IF;

  v_days := COALESCE(p_days, v_plan.duration_days);
  IF v_days < 1 OR v_days > 3650 THEN
    RAISE EXCEPTION 'Duration must be between 1 and 3650 days.' USING ERRCODE = 'P0001';
  END IF;

  -- One live entitlement per user: extend the existing row instead of stacking.
  UPDATE public.subscriptions
     SET expires_at = GREATEST(expires_at, NOW()) + make_interval(days => v_days),
         status     = 'active',
         revoked_at = NULL,
         plan_id    = v_plan.id,
         admin_note = NULLIF(left(trim(coalesce(p_admin_note, '')), 500), '')
   WHERE user_id = p_user_id
     AND plan_id = v_plan.id
     AND status = 'active'
     AND expires_at > NOW()
  RETURNING * INTO v_sub;

  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (
      user_id, plan_id, status, starts_at, expires_at, granted_by, admin_note
    )
    VALUES (
      p_user_id, v_plan.id, 'active', NOW(),
      NOW() + make_interval(days => v_days), auth.uid(),
      NULLIF(left(trim(coalesce(p_admin_note, '')), 500), '')
    )
    RETURNING * INTO v_sub;
  END IF;

  IF v_plan.is_premium THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      p_user_id,
      'Premium access activated',
      v_plan.name || ' is now active until ' ||
        to_char(v_sub.expires_at AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY') || '.',
      'plan_activated',
      '/student/subscription',
      'plan_granted:' || v_sub.id::text
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    -- Premium is never automatic: a plan alone does nothing until the identity
    -- is verified, so say so instead of leaving the student wondering.
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = p_user_id AND verification_status = 'verified'
    ) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
      VALUES (
        p_user_id,
        'Verification still needed',
        v_plan.name || ' is on your account, but downloads stay locked until the library verifies your academic identity.',
        'verification_submitted',
        '/student/verification',
        'plan_granted_pending_verification:' || v_sub.id::text
      )
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  RETURN v_sub;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_plan(
  p_user_id uuid,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.subscriptions
     SET status     = 'revoked',
         revoked_at = NOW(),
         admin_note = NULLIF(left(trim(coalesce(p_admin_note, '')), 500), '')
   WHERE user_id = p_user_id
     AND status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'That user has no active entitlement.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    p_user_id,
    'Premium access ended',
    'Your premium entitlement has ended. Renew it to restore full access to downloads.',
    'plan_expired',
    '/student/subscription'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10b. Expiry maintenance (PLAN-5)
--     `has_premium_access()` already compares expires_at, so an expired row can
--     never grant access. This only tidies the ledger and tells the student, and
--     it is safe to call repeatedly from cron or an admin screen.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_subscriptions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  -- Maintenance is staff-only: an unprivileged caller would otherwise be able to
  -- expire other students' entitlements and spam their notifications.
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN
    SELECT s.id, s.user_id
      FROM public.subscriptions s
     WHERE s.status = 'active'
       AND s.expires_at <= NOW()
  LOOP
    UPDATE public.subscriptions
       SET status = 'expired'
     WHERE id = v_row.id
       AND status = 'active';

    IF FOUND THEN
      v_count := v_count + 1;
      INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
      VALUES (
        v_row.user_id,
        'Premium access ended',
        'Your premium entitlement has ended. Ask the library to renew it to restore access to downloads.',
        'plan_expired',
        '/student/subscription',
        'plan_expired:' || v_row.id::text
      )
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_subscriptions() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_grant_plan(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_plan(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_plan(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_plan(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 11. Notification type allow-list (NOTIF-1)
-- -----------------------------------------------------------------------------
-- The allow-list has to stay a superset of every type the app can insert:
-- lifecycle types from 20260915 plus the announcement types from 20260923, plus
-- the verification/plan types added here. Narrowing it would break
-- send_announcement() and the material lifecycle RPCs at runtime.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'info', 'success', 'warning', 'error',
    'material_approved', 'material_rejected', 'material_deleted',
    'new_material', 'new_submission', 'admin_promoted', 'system', 'welcome',
    'announcement', 'maintenance', 'important', 'system_update',
    'verification_submitted', 'verification_approved', 'verification_rejected',
    'plan_activated', 'plan_expired'
  ));

-- -----------------------------------------------------------------------------
-- 12. Surface the state to existing consumers
-- -----------------------------------------------------------------------------
-- The view may already exist with a different column set and objects may depend
-- on it, so it is only created when missing. Verification fields are read from
-- public.profiles directly, which RLS already protects.
DO $$
BEGIN
  IF to_regclass('public.safe_profiles') IS NULL THEN
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
      verified,
      verification_status
    FROM public.profiles;

    GRANT SELECT ON public.safe_profiles TO authenticated;
    REVOKE SELECT ON public.safe_profiles FROM anon;
  END IF;
END;
$$;

-- ==============================================================================
-- End of migration
-- ==============================================================================