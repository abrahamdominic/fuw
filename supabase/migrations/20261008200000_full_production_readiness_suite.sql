-- =============================================================================
-- Migration: Full Production Readiness Suite
-- 1. App Role & Profile Enhancements (Course Rep, Badges, Referral, Free Downloads)
-- 2. Lecturer Announcements Management (Editing, Deletion, Level Targeting)
-- 3. Automatic Student Verification Engine (AUTO_VERIFIED, AUTO_REJECTED, MANUAL_REVIEW)
-- 4. Free Plan Strategy: 5 Free Downloads Entitlement (Server-Tracked)
-- 5. Premium Gifting from Wallet & Badge Administration
-- 6. Course Representative Program & Affiliate Commission Engine (10% on Premium & Vendors)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Roles, Profile Columns & Wallet Ledger Entry Types
-- -----------------------------------------------------------------------------

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'course_rep';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'affiliate_commission';
ALTER TYPE public.marketplace_ledger_entry_type ADD VALUE IF NOT EXISTS 'gift_premium_purchase';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_course_rep BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS course_rep_dept_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS course_rep_level TEXT,
  ADD COLUMN IF NOT EXISTS has_golden_badge BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_plus_lifetime BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_downloads_used INTEGER NOT NULL DEFAULT 0 CHECK (free_downloads_used >= 0),
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON public.profiles(lower(referral_code))
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_id
  ON public.profiles(referred_by_id);

-- -----------------------------------------------------------------------------
-- 2. Lecturer Announcements Architecture Enhancement
-- -----------------------------------------------------------------------------

ALTER TABLE public.library_announcements
  ADD COLUMN IF NOT EXISTS target_faculty_id UUID REFERENCES public.faculties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_department_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_levels TEXT[] DEFAULT NULL;

-- Allow authors (lecturers & admins) to update their own announcements
DROP POLICY IF EXISTS "library_announcements_author_update" ON public.library_announcements;
CREATE POLICY "library_announcements_author_update" ON public.library_announcements
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR (published_by = auth.uid() AND public.is_lecturer()))
  WITH CHECK (public.is_admin() OR (published_by = auth.uid() AND public.is_lecturer()));

-- Allow authors (lecturers & admins) to delete their own announcements
DROP POLICY IF EXISTS "library_announcements_author_delete" ON public.library_announcements;
CREATE POLICY "library_announcements_author_delete" ON public.library_announcements
  FOR DELETE TO authenticated
  USING (public.is_admin() OR (published_by = auth.uid() AND public.is_lecturer()));

DROP FUNCTION IF EXISTS public.lecturer_broadcast_announcement(text, text, uuid, uuid[], text);

CREATE OR REPLACE FUNCTION public.lecturer_broadcast_announcement(
  p_title text,
  p_body text,
  p_target_faculty_id uuid DEFAULT NULL,
  p_target_department_ids uuid[] DEFAULT NULL,
  p_announcement_type text DEFAULT 'general',
  p_target_levels text[] DEFAULT NULL,
  p_is_draft boolean DEFAULT false,
  p_announcement_id uuid DEFAULT NULL
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
  v_announcement_id uuid := p_announcement_id;
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

  -- Load lecturer record if caller is lecturer
  IF v_caller_role = 'lecturer'::public.app_role THEN
    SELECT * INTO v_lecturer FROM public.lecturers WHERE profile_id = auth.uid() LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO v_lecturer FROM public.lecturers
      WHERE lower(staff_email) = lower(v_caller_email)
      LIMIT 1;

      IF FOUND THEN
        UPDATE public.lecturers SET profile_id = auth.uid() WHERE id = v_lecturer.id;
      ELSE
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

    IF v_lecturer.department_id IS NOT NULL THEN
      v_allowed_dept_ids := array_append(v_allowed_dept_ids, v_lecturer.department_id);
    END IF;
    FOR v_dept_id IN (SELECT department_id FROM public.lecturer_departments WHERE lecturer_id = v_lecturer.id) LOOP
      IF NOT (v_allowed_dept_ids @> ARRAY[v_dept_id]) THEN
        v_allowed_dept_ids := array_append(v_allowed_dept_ids, v_dept_id);
      END IF;
    END LOOP;

    IF p_target_department_ids IS NOT NULL AND array_length(p_target_department_ids, 1) > 0 THEN
      IF array_length(v_allowed_dept_ids, 1) > 0 AND NOT (v_allowed_dept_ids @> p_target_department_ids) THEN
        RAISE EXCEPTION 'Cannot broadcast to departments outside your authorized academic scope.' USING ERRCODE = '42501';
      END IF;
    END IF;

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

  IF v_announcement_id IS NOT NULL THEN
    -- Editing existing broadcast
    UPDATE public.library_announcements
       SET title = trim(p_title),
           body = trim(p_body),
           announcement_type = COALESCE(p_announcement_type, 'general'),
           target_faculty_id = p_target_faculty_id,
           target_department_ids = p_target_department_ids,
           target_levels = p_target_levels,
           is_published = NOT p_is_draft,
           published_at = CASE WHEN NOT p_is_draft AND published_at IS NULL THEN now() ELSE published_at END,
           updated_at = now()
     WHERE id = v_announcement_id
       AND (published_by = auth.uid() OR public.is_admin());
  ELSE
    -- Creating new broadcast
    INSERT INTO public.library_announcements (
      title, body, audience, announcement_type, is_published, published_by,
      published_at, target_faculty_id, target_department_ids, target_levels
    )
    VALUES (
      trim(p_title), trim(p_body), 'students', COALESCE(p_announcement_type, 'general'),
      NOT p_is_draft, auth.uid(),
      CASE WHEN NOT p_is_draft THEN now() ELSE NULL END,
      p_target_faculty_id, p_target_department_ids, p_target_levels
    )
    RETURNING id INTO v_announcement_id;
  END IF;

  -- Targeted notifications dispatch only if published (not a draft)
  IF NOT p_is_draft THEN
    INSERT INTO public.notifications (
      user_id, title, message, type, category, dedupe_key, sender_name
    )
    SELECT
      pr.id,
      trim(p_title),
      trim(p_body),
      v_notif_type,
      'academic',
      'announcement:' || v_announcement_id || ':' || pr.id,
      v_sender_name
    FROM public.profiles pr
    WHERE pr.is_active = true
      AND pr.role = 'student'
      AND (
        (v_target_dept_names IS NOT NULL AND pr.department = ANY(v_target_dept_names))
        OR (v_target_dept_names IS NULL AND v_target_faculty_name IS NOT NULL AND pr.faculty = v_target_faculty_name)
        OR (v_target_dept_names IS NULL AND v_target_faculty_name IS NULL)
      )
      AND (
        p_target_levels IS NULL
        OR array_length(p_target_levels, 1) = 0
        OR pr.level = ANY(p_target_levels)
      )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN v_announcement_id;
END;
$function$;

-- Backward compatible overload
CREATE OR REPLACE FUNCTION public.lecturer_broadcast_announcement(
  p_title text,
  p_body text,
  p_target_faculty_id uuid,
  p_target_department_ids uuid[],
  p_announcement_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.lecturer_broadcast_announcement(
    p_title, p_body, p_target_faculty_id, p_target_department_ids, p_announcement_type, NULL, false, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lecturer_broadcast_announcement(text, text, uuid, uuid[], text, text[], boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lecturer_broadcast_announcement(text, text, uuid, uuid[], text, text[], boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lecturer_broadcast_announcement(text, text, uuid, uuid[], text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Automatic Student Verification Engine
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_verification(
  p_student_note text DEFAULT NULL,
  p_evidence_path text DEFAULT NULL,
  p_evidence_name text DEFAULT NULL
)
RETURNS public.verification_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile       public.profiles%ROWTYPE;
  v_request       public.verification_requests%ROWTYPE;
  v_note          text;
  v_evidence      text;
  v_matric        text;
  v_is_format_ok  boolean;
  v_is_duplicate  boolean;
  v_has_doc       boolean;
  v_auto_status   text := 'pending';
BEGIN
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

  IF p_evidence_path IS NOT NULL
     AND left(trim(p_evidence_path), length(auth.uid()::text) + 1) <> auth.uid()::text || '/' THEN
    RAISE EXCEPTION 'The evidence file does not belong to your account.' USING ERRCODE = 'P0001';
  END IF;

  v_matric := upper(trim(COALESCE(v_profile.matric_number, '')));

  IF v_matric = ''
     OR COALESCE(NULLIF(trim(v_profile.faculty), ''), '') = ''
     OR COALESCE(NULLIF(trim(v_profile.department), ''), '') = '' THEN
    RAISE EXCEPTION 'Add your matriculation number, faculty and department before requesting verification.' USING ERRCODE = 'P0001';
  END IF;

  v_note := NULLIF(left(trim(coalesce(p_student_note, '')), 1000), '');
  v_evidence := NULLIF(trim(coalesce(p_evidence_path, '')), '');
  IF v_evidence IS NOT NULL THEN
    IF v_evidence !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') THEN
      RAISE EXCEPTION 'Evidence must be a file in your own upload folder.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Validation Engine
  -- Standard FUW format check: starts with FUW/ followed by alphanumeric segments
  v_is_format_ok := (v_matric ~* '^FUW\/[A-Za-z0-9\/_-]{4,25}$');

  -- Duplicate matric check against already verified profiles
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id <> auth.uid()
      AND upper(trim(matric_number)) = v_matric
      AND verified = TRUE
  ) INTO v_is_duplicate;

  v_has_doc := (v_evidence IS NOT NULL);

  IF NOT v_is_format_ok THEN
    -- AUTO_REJECTED: Blatantly invalid matriculation format
    v_auto_status := 'rejected';

    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, evidence_path, evidence_name, reviewer_note, reviewed_at
    )
    VALUES (
      auth.uid(), 'rejected',
      v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_evidence, NULLIF(left(trim(coalesce(p_evidence_name, '')), 200), ''),
      'Automatic check: Invalid FUW matriculation format. Standard format is FUW/YYYY/... or FUW/UG/YYYY/...',
      now()
    )
    RETURNING * INTO v_request;

    UPDATE public.profiles
       SET verification_status = 'rejected',
           verification_reason = 'Invalid FUW matriculation number format. Format must match FUW/[year]/[dept]/[number].',
           verification_submitted_at = now(),
           verification_reviewed_at = now(),
           updated_at = now()
     WHERE id = auth.uid();

    INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
    VALUES (
      auth.uid(),
      'Verification Rejected',
      'Your matriculation number (' || v_matric || ') does not conform to Federal University Wukari standard format. Please check your matric number and try again.',
      'important',
      'verification_auto_reject:' || v_request.id
    );

    RETURN v_request;

  ELSIF v_is_format_ok AND v_has_doc AND NOT v_is_duplicate THEN
    -- AUTO_VERIFIED: Valid format, evidence uploaded, and no conflicts
    v_auto_status := 'approved';

    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, evidence_path, evidence_name, reviewer_note, reviewed_at, reviewed_by
    )
    VALUES (
      auth.uid(), 'approved',
      v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_evidence, NULLIF(left(trim(coalesce(p_evidence_name, '')), 200), ''),
      'Automatically verified via FUW Matriculation and credential validation engine.',
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

    -- Notify the student of instant verification
    INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
    VALUES (
      auth.uid(),
      'Student Identity Verified',
      'Congratulations! Your FUW student identity has been automatically verified. Your Verified Scholar badge is now visible on your profile.',
      'system',
      '/student/profile',
      'verification_auto_verified:' || v_request.id
    );

    RETURN v_request;

  ELSE
    -- MANUAL_REVIEW: Valid format but needs admin attention (e.g. no document or duplicate matric check)
    INSERT INTO public.verification_requests (
      user_id, status, matric_number, faculty, department, level,
      student_note, evidence_path, evidence_name
    )
    VALUES (
      auth.uid(), 'pending',
      v_matric, btrim(v_profile.faculty),
      btrim(v_profile.department), NULLIF(btrim(coalesce(v_profile.level, '')), ''),
      v_note, v_evidence, NULLIF(left(trim(coalesce(p_evidence_name, '')), 200), '')
    )
    RETURNING * INTO v_request;

    UPDATE public.profiles
       SET verification_status = 'pending',
           verification_reason = NULL,
           verification_submitted_at = now(),
           updated_at = now()
     WHERE id = auth.uid();

    -- Alert administrators for manual queue review
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

REVOKE ALL ON FUNCTION public.submit_verification(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_verification(text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Free Plan Strategy: 5 Free Downloads Entitlement
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_free_download(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN COALESCE((SELECT free_downloads_used FROM public.profiles WHERE id = p_user_id), 0) < 5;
END;
$$;

-- Update storage entitlement policy to allow 5 free downloads
DROP POLICY IF EXISTS "library-materials entitlement read" ON storage.objects;
CREATE POLICY "library-materials entitlement read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'library-materials'
    AND (
      public.is_admin()
      OR public.is_lecturer()
      OR public.has_premium_access()
      OR public.can_free_download(auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.record_material_download(p_material_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_premium BOOLEAN;
  v_used INTEGER;
  v_free_limit CONSTANT INTEGER := 5;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to download materials.' USING ERRCODE = '28000';
  END IF;

  v_is_premium := public.has_premium_access() OR public.is_admin() OR public.is_lecturer();

  IF NOT v_is_premium THEN
    SELECT COALESCE(free_downloads_used, 0) INTO v_used
    FROM public.profiles
    WHERE id = v_uid FOR UPDATE;

    IF v_used >= v_free_limit THEN
      RAISE EXCEPTION 'Free download limit reached (%/5). Upgrade to Premium (₦1,200/semester) for unlimited downloads.', v_used
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.profiles
       SET free_downloads_used = free_downloads_used + 1,
           updated_at = now()
     WHERE id = v_uid
     RETURNING free_downloads_used INTO v_used;
  ELSE
    SELECT COALESCE(free_downloads_used, 0) INTO v_used FROM public.profiles WHERE id = v_uid;
  END IF;

  -- Increment aggregate material download counter
  UPDATE public.materials
     SET downloads = downloads + 1
   WHERE id = p_material_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_premium', v_is_premium,
    'free_downloads_used', v_used,
    'free_downloads_remaining', GREATEST(0, v_free_limit - v_used)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_material_download(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Premium Gifting from Wallet & Badge Administration
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gift_premium_plan_from_wallet(
  p_recipient_identifier TEXT,
  p_plan_slug TEXT DEFAULT 'semester-access'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_gifter_uid UUID := auth.uid();
  v_recipient public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_wallet UUID;
  v_wallet_row public.marketplace_wallets%ROWTYPE;
  v_entry UUID;
  v_ref TEXT;
  v_tx public.payment_transactions%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_config JSONB;
BEGIN
  IF v_gifter_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to send a Premium gift.' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(p_recipient_identifier), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the recipient matriculation number or email.' USING ERRCODE = '22023';
  END IF;

  -- Locate recipient
  SELECT * INTO v_recipient
  FROM public.profiles
  WHERE (
    lower(trim(matric_number)) = lower(trim(p_recipient_identifier))
    OR lower(trim(email)) = lower(trim(p_recipient_identifier))
    OR lower(trim(display_name)) = lower(trim(p_recipient_identifier))
  )
  AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No student account was found matching "%". Please verify the matriculation number or email.', p_recipient_identifier
      USING ERRCODE = 'P0002';
  END IF;

  IF v_recipient.id = v_gifter_uid THEN
    RAISE EXCEPTION 'To subscribe for yourself, use the standard wallet subscription.' USING ERRCODE = '22023';
  END IF;

  -- Load plan
  SELECT * INTO v_plan FROM public.plans
  WHERE slug = lower(btrim(p_plan_slug)) AND is_active AND is_premium AND price_kobo > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That Premium plan is unavailable.' USING ERRCODE = '22023';
  END IF;

  -- Verify and debit gifter's wallet
  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_gifter_uid);
  SELECT * INTO v_wallet_row FROM public.marketplace_wallets WHERE id = v_wallet FOR UPDATE;

  IF v_wallet_row.is_frozen THEN
    RAISE EXCEPTION 'Your wallet is frozen: %', COALESCE(v_wallet_row.frozen_reason, 'contact support')
      USING ERRCODE = '42501';
  END IF;

  IF v_wallet_row.available_kobo < v_plan.price_kobo THEN
    RAISE EXCEPTION 'Insufficient wallet balance. You have ₦%, but ₦% is required.',
      (v_wallet_row.available_kobo / 100)::TEXT, (v_plan.price_kobo / 100)::TEXT
      USING ERRCODE = '23514';
  END IF;

  v_ref := 'FUW-GIFT-' || upper(replace(gen_random_uuid()::TEXT, '-', ''));

  v_entry := public.mp_wallet_post(
    p_wallet_id => v_wallet,
    p_direction => 'debit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_plan.price_kobo,
    p_entry_type => 'gift_premium_purchase'::public.marketplace_ledger_entry_type,
    p_reference_type => 'plan',
    p_reference_id => v_plan.id,
    p_idempotency_key => 'gift:' || v_plan.id::TEXT || ':' || v_recipient.id::TEXT || ':' || extract(epoch FROM now())::BIGINT,
    p_description => format('Gift of %s to %s', v_plan.name, COALESCE(v_recipient.full_name, v_recipient.matric_number, 'student')),
    p_metadata => jsonb_build_object(
      'recipient_id', v_recipient.id,
      'recipient_matric', v_recipient.matric_number,
      'plan_id', v_plan.id,
      'reference', v_ref
    ),
    p_actor_id => v_gifter_uid
  );

  v_config := public.get_payment_configuration();

  -- Record payment transaction on behalf of gifter
  INSERT INTO public.payment_transactions (
    user_id, payment_reference, plan_id, amount_kobo, currency,
    payment_method, provider, provider_transaction_id,
    status, verification_status, verified_at, metadata
  ) VALUES (
    v_gifter_uid, v_ref, v_plan.id, v_plan.price_kobo, COALESCE(v_config->>'currency', 'NGN'),
    'automatic', 'wallet_gift', v_entry::TEXT,
    'verified', 'verified', now(),
    jsonb_build_object('recipient_id', v_recipient.id, 'wallet_entry_id', v_entry)
  ) RETURNING * INTO v_tx;

  -- Activate recipient subscription (fires trigger to allocate ₦2,000 escrow credit)
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, starts_at, expires_at, admin_note
  ) VALUES (
    v_recipient.id, v_plan.id, 'active', now(),
    now() + make_interval(days => v_plan.duration_days),
    'Gift subscription from ' || (SELECT COALESCE(full_name, email) FROM public.profiles WHERE id = v_gifter_uid)
  ) RETURNING * INTO v_sub;

  -- Notify recipient
  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_recipient.id,
    'You received a Premium Gift!',
    format('A student gifted you %s! You now have unlimited library downloads, ₦2,000 marketplace escrow credit, and your Verified Scholar badge.', v_plan.name),
    'system',
    '/student/profile',
    'gift_received:' || v_sub.id
  );

  -- Notify gifter
  INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
  VALUES (
    v_gifter_uid,
    'Premium Gift Sent',
    format('You successfully gifted %s to %s.', v_plan.name, COALESCE(v_recipient.full_name, v_recipient.matric_number)),
    'system',
    'gift_sent:' || v_sub.id
  );

  RETURN jsonb_build_object(
    'success', true,
    'recipient_name', v_recipient.full_name,
    'recipient_matric', v_recipient.matric_number,
    'plan_name', v_plan.name,
    'amount_kobo', v_plan.price_kobo,
    'expires_at', v_sub.expires_at,
    'reference', v_ref
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gift_premium_plan_from_wallet(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_premium_plan_from_wallet(TEXT, TEXT) TO authenticated;

-- Admin Badge Management
CREATE OR REPLACE FUNCTION public.admin_set_golden_badge(
  p_user_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET has_golden_badge = p_enabled,
         updated_at = now()
   WHERE id = p_user_id;

  INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
  VALUES (
    p_user_id,
    CASE WHEN p_enabled THEN 'Golden Badge Awarded!' ELSE 'Golden Badge Update' END,
    CASE WHEN p_enabled
      THEN 'Congratulations! You have been awarded the prestigious FUW Golden Badge of Honor.'
      ELSE 'Your Golden Badge status has been updated by administration.'
    END,
    'system',
    'golden_badge:' || p_user_id || ':' || now()::DATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_golden_badge(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_verified_vendor_badge(
  p_vendor_id UUID,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.mp_has_perm('verify_vendors')) THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.marketplace_vendors
     SET is_verified = p_enabled,
         updated_at = now()
   WHERE id = p_vendor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_verified_vendor_badge(UUID, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Course Rep Program & Affiliate Commission Engine
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  referral_type TEXT NOT NULL DEFAULT 'student' CHECK (referral_type IN ('student', 'vendor')),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'converted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_id, referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer
  ON public.affiliate_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referred
  ON public.affiliate_referrals(referred_user_id);

CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_id UUID REFERENCES public.affiliate_referrals(id) ON DELETE SET NULL,
  referred_user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  commission_rate NUMERIC NOT NULL DEFAULT 0.10,
  source_type TEXT NOT NULL CHECK (source_type IN ('premium_subscription', 'verified_vendor')),
  status TEXT NOT NULL DEFAULT 'credited' CHECK (status IN ('credited', 'withdrawn', 'reversed')),
  wallet_entry_id UUID REFERENCES public.marketplace_ledger_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_referrer
  ON public.affiliate_commissions(referrer_id, created_at DESC);

-- RLS
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY affiliate_referrals_read_own ON public.affiliate_referrals
  FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR public.is_admin());

CREATE POLICY affiliate_commissions_read_own ON public.affiliate_commissions
  FOR SELECT TO authenticated
  USING (referrer_id = auth.uid() OR public.is_admin());

-- Generate unique referral code for user
CREATE OR REPLACE FUNCTION public.generate_user_referral_code(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.referral_code IS NOT NULL THEN
    RETURN v_profile.referral_code;
  END IF;

  IF v_profile.is_course_rep THEN
    v_code := 'CREP-' || upper(regexp_replace(COALESCE(v_profile.course_rep_level, 'REP'), '[^A-Z0-9]', '', 'g')) || '-' || upper(left(md5(random()::text), 4));
  ELSE
    v_code := 'REF-' || upper(left(md5(random()::text), 6));
  END IF;

  UPDATE public.profiles
     SET referral_code = v_code,
         updated_at = now()
   WHERE id = p_user_id;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_user_referral_code(UUID) TO authenticated;

-- Apply referral code on registration / onboarding
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_referrer public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '28000';
  END IF;

  IF NULLIF(trim(p_code), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Empty referral code');
  END IF;

  SELECT * INTO v_referrer
  FROM public.profiles
  WHERE lower(referral_code) = lower(trim(p_code))
    AND id <> v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid referral code');
  END IF;

  UPDATE public.profiles
     SET referred_by_id = v_referrer.id,
         updated_at = now()
   WHERE id = v_uid AND referred_by_id IS NULL;

  INSERT INTO public.affiliate_referrals (
    referrer_id, referred_user_id, referral_code, referral_type, status
  ) VALUES (
    v_referrer.id, v_uid, upper(trim(p_code)), 'student', 'registered'
  ) ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'referrer_name', COALESCE(v_referrer.full_name, 'Campus Hub Ambassador'),
    'referral_code', upper(trim(p_code))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated;

-- Trigger to credit 10% commission on Premium subscriptions
CREATE OR REPLACE FUNCTION public.trg_process_affiliate_subscription_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student public.profiles%ROWTYPE;
  v_referrer public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_comm_kobo BIGINT;
  v_wallet UUID;
  v_entry UUID;
  v_conv_count INTEGER;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_student FROM public.profiles WHERE id = NEW.user_id;
  IF NOT FOUND OR v_student.referred_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_referrer FROM public.profiles WHERE id = v_student.referred_by_id;
  IF NOT FOUND OR NOT v_referrer.is_active THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id;
  IF NOT FOUND OR v_plan.price_kobo <= 0 THEN
    RETURN NEW;
  END IF;

  -- 10% Commission (e.g. ₦120 on ₦1,200 subscription)
  v_comm_kobo := (v_plan.price_kobo * 0.10)::BIGINT;
  IF v_comm_kobo <= 0 THEN
    RETURN NEW;
  END IF;

  -- Credit referrer's centralized wallet
  v_wallet := public.mp_wallet_ensure(p_owner_user_id => v_referrer.id);
  v_entry := public.mp_wallet_post(
    p_wallet_id => v_wallet,
    p_direction => 'credit'::public.marketplace_ledger_direction,
    p_bucket => 'available'::public.marketplace_wallet_bucket,
    p_amount_kobo => v_comm_kobo,
    p_entry_type => 'affiliate_commission'::public.marketplace_ledger_entry_type,
    p_reference_type => 'subscription',
    p_reference_id => NEW.id,
    p_idempotency_key => 'affiliate_comm:' || NEW.id::TEXT || ':' || v_referrer.id::TEXT,
    p_description => format('10%% Affiliate Commission for student %s Premium subscription', COALESCE(v_student.matric_number, v_student.full_name, 'student')),
    p_metadata => jsonb_build_object(
      'referred_student_id', v_student.id,
      'plan_price_kobo', v_plan.price_kobo,
      'subscription_id', NEW.id
    ),
    p_actor_id => v_student.id
  );

  -- Record commission
  INSERT INTO public.affiliate_commissions (
    referrer_id, referred_user_id, amount_kobo, commission_rate,
    source_type, status, wallet_entry_id
  ) VALUES (
    v_referrer.id, v_student.id, v_comm_kobo, 0.10,
    'premium_subscription', 'credited', v_entry
  );

  -- Update referral record to converted
  UPDATE public.affiliate_referrals
     SET status = 'converted'
   WHERE referrer_id = v_referrer.id AND referred_user_id = v_student.id;

  -- Check milestone: If Course Rep reaches 5+ converted referrals, award lifetime Campus Hub Plus!
  SELECT count(*) INTO v_conv_count
  FROM public.affiliate_referrals
  WHERE referrer_id = v_referrer.id AND status = 'converted';

  IF v_conv_count >= 5 AND NOT v_referrer.has_plus_lifetime THEN
    UPDATE public.profiles
       SET has_plus_lifetime = true,
           updated_at = now()
     WHERE id = v_referrer.id;

    INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
    VALUES (
      v_referrer.id,
      'Milestone Reached: Campus Hub Plus Awarded!',
      'Congratulations! You have reached 5 converted student referrals. You have earned lifetime Campus Hub Plus access!',
      'system',
      'plus_lifetime_milestone:' || v_referrer.id
    );
  END IF;

  -- Notify referrer of earned commission
  INSERT INTO public.notifications (user_id, title, message, type, dedupe_key)
  VALUES (
    v_referrer.id,
    'Affiliate Commission Earned!',
    format('You just earned ₦%s (10%% commission) from a student Premium subscription!', (v_comm_kobo / 100)::TEXT),
    'system',
    'aff_comm:' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_affiliate_subscription_commission ON public.subscriptions;
CREATE TRIGGER trg_affiliate_subscription_commission
  AFTER INSERT ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_process_affiliate_subscription_commission();

-- Affiliate Dashboard Stats
CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard_stats(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_total_refs INTEGER;
  v_conv_refs INTEGER;
  v_total_earned_kobo BIGINT;
  v_wallet UUID;
  v_wallet_bal BIGINT := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_total_refs FROM public.affiliate_referrals WHERE referrer_id = p_user_id;
  SELECT count(*) INTO v_conv_refs FROM public.affiliate_referrals WHERE referrer_id = p_user_id AND status = 'converted';
  SELECT COALESCE(sum(amount_kobo), 0) INTO v_total_earned_kobo FROM public.affiliate_commissions WHERE referrer_id = p_user_id;

  v_wallet := public.mp_wallet_ensure(p_owner_user_id => p_user_id);
  SELECT COALESCE(available_kobo, 0) INTO v_wallet_bal FROM public.marketplace_wallets WHERE id = v_wallet;

  RETURN jsonb_build_object(
    'is_course_rep', v_profile.is_course_rep,
    'course_rep_level', v_profile.course_rep_level,
    'referral_code', COALESCE(v_profile.referral_code, public.generate_user_referral_code(p_user_id)),
    'total_referrals', v_total_refs,
    'converted_referrals', v_conv_refs,
    'total_earned_kobo', v_total_earned_kobo,
    'available_wallet_kobo', v_wallet_bal,
    'has_plus_lifetime', v_profile.has_plus_lifetime,
    'commission_rate_percent', 10
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_affiliate_dashboard_stats(UUID) TO authenticated;

COMMIT;
