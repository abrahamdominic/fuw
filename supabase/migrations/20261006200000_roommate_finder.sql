-- =====================================================================
-- FUW CAMPUS HUB — ROOMMATE FINDER PLATFORM SCHEMA & NOTIFICATIONS
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.roommate_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_gender TEXT NOT NULL CHECK (target_gender IN ('Male', 'Female', 'Any')),
  budget_min NUMERIC(12, 2) NOT NULL CHECK (budget_min >= 0),
  budget_max NUMERIC(12, 2) NOT NULL CHECK (budget_max >= budget_min),
  accommodation_type TEXT NOT NULL CHECK (accommodation_type IN ('Single Room', 'Self-Contain', 'Shared Lodge', 'Flat / Apartment', 'Bedspace', 'Any / Flexible')),
  preferred_location TEXT NOT NULL,
  description TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matched', 'closed')),
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_roommate_requests_student ON public.roommate_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_roommate_requests_status ON public.roommate_requests(status);
CREATE INDEX IF NOT EXISTS idx_roommate_requests_target_gender ON public.roommate_requests(target_gender);
CREATE INDEX IF NOT EXISTS idx_roommate_requests_budget ON public.roommate_requests(budget_min, budget_max);
CREATE INDEX IF NOT EXISTS idx_roommate_requests_created ON public.roommate_requests(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.roommate_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "roommate_requests_select" ON public.roommate_requests;
CREATE POLICY "roommate_requests_select"
  ON public.roommate_requests
  FOR SELECT
  TO authenticated, anon
  USING (
    status = 'active'
    OR (auth.uid() IS NOT NULL AND student_id = auth.uid())
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "roommate_requests_insert" ON public.roommate_requests;
CREATE POLICY "roommate_requests_insert"
  ON public.roommate_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND student_id = auth.uid()
  );

DROP POLICY IF EXISTS "roommate_requests_update" ON public.roommate_requests;
CREATE POLICY "roommate_requests_update"
  ON public.roommate_requests
  FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "roommate_requests_delete" ON public.roommate_requests;
CREATE POLICY "roommate_requests_delete"
  ON public.roommate_requests
  FOR DELETE
  TO authenticated
  USING (
    student_id = auth.uid()
    OR public.is_platform_admin()
  );

-- Publish / Edit Roommate Request Function with Gender-Based Notifications
CREATE OR REPLACE FUNCTION public.publish_roommate_request(
  p_id UUID DEFAULT NULL,
  p_target_gender TEXT DEFAULT 'Any',
  p_budget_min NUMERIC DEFAULT 0,
  p_budget_max NUMERIC DEFAULT 0,
  p_accommodation_type TEXT DEFAULT 'Shared Lodge',
  p_preferred_location TEXT DEFAULT 'Campus Environs',
  p_description TEXT DEFAULT '',
  p_phone_number TEXT DEFAULT '',
  p_whatsapp_number TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_profile RECORD;
  v_request_id UUID;
  v_result RECORD;
  v_recipient RECORD;
  v_notif_count INT := 0;
  v_title TEXT;
  v_body TEXT;
  v_link TEXT;
  v_clean_phone TEXT;
  v_clean_whatsapp TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to post a roommate request.';
  END IF;

  SELECT id, full_name, gender, department, level INTO v_user_profile
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  -- Validate inputs
  IF p_target_gender NOT IN ('Male', 'Female', 'Any') THEN
    RAISE EXCEPTION 'Invalid target gender preference.';
  END IF;

  IF p_budget_min < 0 OR p_budget_max < p_budget_min THEN
    RAISE EXCEPTION 'Invalid budget range: maximum budget must be greater than or equal to minimum budget.';
  END IF;

  v_clean_phone := regexp_replace(p_phone_number, '[^0-9+]', '', 'g');
  v_clean_whatsapp := regexp_replace(p_whatsapp_number, '[^0-9+]', '', 'g');

  IF length(v_clean_phone) < 10 THEN
    RAISE EXCEPTION 'Please provide a valid phone contact number.';
  END IF;

  IF length(v_clean_whatsapp) < 10 THEN
    RAISE EXCEPTION 'Please provide a valid WhatsApp contact number.';
  END IF;

  IF length(trim(p_description)) < 15 THEN
    RAISE EXCEPTION 'Please provide a descriptive introduction (at least 15 characters).';
  END IF;

  IF p_id IS NOT NULL THEN
    -- Update existing
    UPDATE public.roommate_requests
    SET
      target_gender = p_target_gender,
      budget_min = p_budget_min,
      budget_max = p_budget_max,
      accommodation_type = p_accommodation_type,
      preferred_location = p_preferred_location,
      description = trim(p_description),
      phone_number = v_clean_phone,
      whatsapp_number = v_clean_whatsapp,
      status = 'active',
      updated_at = now()
    WHERE id = p_id AND (student_id = v_user_id OR public.is_platform_admin())
    RETURNING id INTO v_request_id;

    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'Roommate request not found or unauthorized to update.';
    END IF;
  ELSE
    -- Insert new
    INSERT INTO public.roommate_requests (
      student_id,
      target_gender,
      budget_min,
      budget_max,
      accommodation_type,
      preferred_location,
      description,
      phone_number,
      whatsapp_number,
      status
    ) VALUES (
      v_user_id,
      p_target_gender,
      p_budget_min,
      p_budget_max,
      p_accommodation_type,
      p_preferred_location,
      trim(p_description),
      v_clean_phone,
      v_clean_whatsapp,
      'active'
    )
    RETURNING id INTO v_request_id;
  END IF;

  -- GENDER-BASED NOTIFICATIONS:
  -- Target students who match the selected gender
  v_title := 'New Roommate Request';
  v_body := COALESCE(v_user_profile.full_name, 'A student') || ' is looking for a ' ||
            (CASE WHEN p_target_gender = 'Any' THEN 'roommate' ELSE p_target_gender || ' roommate' END) ||
            ' around ' || p_preferred_location || ' (₦' || to_char(p_budget_min, 'FM999,999,999') || ' - ₦' || to_char(p_budget_max, 'FM999,999,999') || ')';
  v_link := '/accommodation/roommates?requestId=' || v_request_id;

  FOR v_recipient IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.id != v_user_id
      AND p.is_active = true
      AND (
        p_target_gender = 'Any'
        OR p.gender = p_target_gender
      )
    LIMIT 200
  LOOP
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      link,
      category,
      dedupe_key
    ) VALUES (
      v_recipient.id,
      v_title,
      v_body,
      'announcement',
      v_link,
      'accommodation',
      'roommate_' || v_request_id || '_' || v_recipient.id
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_notif_count := v_notif_count + 1;
  END LOOP;

  SELECT * INTO v_result FROM public.roommate_requests WHERE id = v_request_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'notifications_sent', v_notif_count,
    'request', row_to_json(v_result)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_roommate_request TO authenticated;

-- Rich Search & Fetch Function for Roommate Requests
CREATE OR REPLACE FUNCTION public.fetch_roommate_requests(
  p_gender TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_max_budget NUMERIC DEFAULT NULL,
  p_min_budget NUMERIC DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  student_id UUID,
  target_gender TEXT,
  budget_min NUMERIC,
  budget_max NUMERIC,
  accommodation_type TEXT,
  preferred_location TEXT,
  description TEXT,
  phone_number TEXT,
  whatsapp_number TEXT,
  status TEXT,
  view_count INT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  student_name TEXT,
  student_gender TEXT,
  student_department TEXT,
  student_level TEXT,
  student_avatar TEXT,
  student_verified BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    r.id,
    r.student_id,
    r.target_gender,
    r.budget_min,
    r.budget_max,
    r.accommodation_type,
    r.preferred_location,
    r.description,
    r.phone_number,
    r.whatsapp_number,
    r.status,
    r.view_count,
    r.created_at,
    r.updated_at,
    p.full_name AS student_name,
    p.gender AS student_gender,
    p.department AS student_department,
    p.level AS student_level,
    p.avatar_url AS student_avatar,
    COALESCE(p.verified, false) AS student_verified
  FROM public.roommate_requests r
  JOIN public.profiles p ON p.id = r.student_id
  WHERE (r.status = 'active' OR (auth.uid() IS NOT NULL AND r.student_id = auth.uid()))
    AND (p_gender IS NULL OR p_gender = 'All' OR r.target_gender = p_gender OR r.target_gender = 'Any' OR p.gender = p_gender)
    AND (p_location IS NULL OR p_location = '' OR r.preferred_location ILIKE '%' || p_location || '%')
    AND (p_type IS NULL OR p_type = 'All' OR r.accommodation_type = p_type)
    AND (p_max_budget IS NULL OR r.budget_min <= p_max_budget)
    AND (p_min_budget IS NULL OR r.budget_max >= p_min_budget)
  ORDER BY r.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_roommate_requests TO authenticated, anon;

-- Increment view count
CREATE OR REPLACE FUNCTION public.increment_roommate_request_view(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.roommate_requests
  SET view_count = view_count + 1
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_roommate_request_view TO anon, authenticated;

-- Set status (active, matched, closed)
CREATE OR REPLACE FUNCTION public.set_roommate_request_status(
  p_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_status NOT IN ('active', 'matched', 'closed') THEN
    RAISE EXCEPTION 'Invalid status.';
  END IF;

  UPDATE public.roommate_requests
  SET status = p_status, updated_at = now()
  WHERE id = p_id AND (student_id = v_user_id OR public.is_platform_admin());

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_roommate_request_status TO authenticated;
