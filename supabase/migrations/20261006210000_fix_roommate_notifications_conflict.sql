-- =====================================================================
-- FIX ROOMMATE NOTIFICATIONS UNIQUE CONSTRAINT ON CONFLICT & CATEGORY
-- =====================================================================

-- 1. Ensure 'accommodation' is an allowed notification category
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category = ANY (ARRAY[
    'academic'::text,
    'events'::text,
    'organizations'::text,
    'marketplace'::text,
    'messages'::text,
    'jobs'::text,
    'study_groups'::text,
    'payments'::text,
    'platform'::text,
    'accommodation'::text
  ]));

-- 2. Update publish_roommate_request to match idx_notifications_user_dedupe
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
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
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
