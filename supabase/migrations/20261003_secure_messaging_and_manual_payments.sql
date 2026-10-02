BEGIN;

-- Messages are created through this RPC so sender identity always comes from
-- auth.uid() and the timestamp update is part of the same transaction.
DROP POLICY IF EXISTS "msg_insert_sender" ON public.messages;
CREATE POLICY "msg_insert_sender"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id
        AND (
          c.student_id = auth.uid()
          OR c.created_by = auth.uid()
          OR (
            public.is_admin()
            AND c.student_id = c.created_by
          )
        )
    )
  );

DROP POLICY IF EXISTS "conv_select_student" ON public.conversations;
DROP POLICY IF EXISTS "conv_select_admin" ON public.conversations;
DROP POLICY IF EXISTS "conv_select_participant_or_support" ON public.conversations;
CREATE POLICY "conv_select_participant_or_support"
  ON public.conversations FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    OR created_by = auth.uid()
    OR (public.is_admin() AND student_id = created_by)
  );

DROP POLICY IF EXISTS "msg_select_conv_participant" ON public.messages;
CREATE POLICY "msg_select_conv_participant"
  ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (
          c.student_id = auth.uid()
          OR c.created_by = auth.uid()
          OR (public.is_admin() AND c.student_id = c.created_by)
        )
    )
  );

DROP POLICY IF EXISTS "msg_update_conv_participant" ON public.messages;
CREATE POLICY "msg_update_conv_participant"
  ON public.messages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (
          c.student_id = auth.uid()
          OR c.created_by = auth.uid()
          OR (public.is_admin() AND c.student_id = c.created_by)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (
          c.student_id = auth.uid()
          OR c.created_by = auth.uid()
          OR (public.is_admin() AND c.student_id = c.created_by)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.guard_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
    OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Messages cannot be reassigned or edited.' USING ERRCODE = '42501';
  END IF;
  IF (NEW.is_read IS DISTINCT FROM OLD.is_read OR NEW.read_at IS DISTINCT FROM OLD.read_at)
    AND (
      auth.uid() IS DISTINCT FROM OLD.receiver_id
      OR (NEW.is_read = false AND OLD.is_read = true)
      OR (NEW.is_read = true AND NEW.read_at IS NULL)
    )
  THEN
    RAISE EXCEPTION 'Only the message recipient can mark an incoming message as read.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_message_update ON public.messages;
CREATE TRIGGER trg_guard_message_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_update();

CREATE OR REPLACE FUNCTION public.send_conversation_message(
  p_conversation_id uuid,
  p_body text
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_message public.messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;
  IF v_body = '' OR length(v_body) > 10000 THEN
    RAISE EXCEPTION 'Messages must contain 1 to 10000 characters.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND (
      c.student_id = v_uid
      OR c.created_by = v_uid
      OR (public.is_admin() AND c.student_id = c.created_by)
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found or access denied.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.messages (conversation_id, sender_id, body)
  VALUES (p_conversation_id, v_uid, v_body)
  RETURNING * INTO v_message;

  UPDATE public.conversations
  SET last_message_at = v_message.created_at
  WHERE id = p_conversation_id;

  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.send_conversation_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(uuid, text) TO authenticated;
REVOKE INSERT ON public.messages FROM anon, authenticated;

-- The existing plans/subscriptions ledger remains the sole source of truth.
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  amount_kobo integer NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD')),
  receipt_path text NOT NULL,
  payment_reference text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_requests_receipt_path_not_empty CHECK (btrim(receipt_path) <> '')
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status_created
  ON public.payment_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_student_created
  ON public.payment_requests (student_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_one_pending_per_student
  ON public.payment_requests (student_id) WHERE status = 'pending';

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_requests_read_own_or_super_admin" ON public.payment_requests;
CREATE POLICY "payment_requests_read_own_or_super_admin"
  ON public.payment_requests FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_super_admin());
REVOKE ALL ON public.payment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_requests TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "payment_receipts_owner_read" ON storage.objects;
CREATE POLICY "payment_receipts_owner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_super_admin()
    )
  );
DROP POLICY IF EXISTS "payment_receipts_owner_insert" ON storage.objects;
CREATE POLICY "payment_receipts_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
DROP POLICY IF EXISTS "payment_receipts_owner_update" ON storage.objects;
-- Receipt objects become immutable once a payment submission references them.
DROP POLICY IF EXISTS "payment_receipts_owner_delete" ON storage.objects;
CREATE POLICY "payment_receipts_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_requests pr
      WHERE pr.receipt_path = storage.objects.name
    )
  );

-- Bank instructions are public to signed-in students, but every write remains
-- guarded by the super-admin-only RPC. system_settings is reused.
DROP POLICY IF EXISTS "system_settings_public_read" ON public.system_settings;
CREATE POLICY "system_settings_public_read"
  ON public.system_settings FOR SELECT
  USING (key = 'maintenance');
DROP POLICY IF EXISTS "system_settings_super_admin_manage" ON public.system_settings;
CREATE POLICY "system_settings_super_admin_manage"
  ON public.system_settings FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
REVOKE SELECT ON public.system_settings FROM anon;
GRANT SELECT ON public.system_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.get_payment_configuration()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT s.value FROM public.system_settings s WHERE s.key = 'payments'),
    jsonb_build_object(
      'active', false,
      'bank_name', '',
      'account_name', '',
      'account_number', '',
      'instructions', '',
      'currency', 'NGN',
      'require_reference', false,
      'reference_label', 'Payment reference',
      'other_information', ''
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.save_payment_configuration(
  p_configuration jsonb,
  p_plan_slug text,
  p_price_kobo integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_configuration) <> 'object'
    OR coalesce(length(btrim(p_configuration->>'bank_name')), 0) > 120
    OR coalesce(length(btrim(p_configuration->>'account_name')), 0) > 160
    OR coalesce(length(btrim(p_configuration->>'account_number')), 0) > 40
    OR coalesce(length(p_configuration->>'instructions'), 0) > 4000
    OR coalesce(length(p_configuration->>'other_information'), 0) > 2000
    OR coalesce(p_configuration->>'currency', '') NOT IN ('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD')
  THEN
    RAISE EXCEPTION 'Payment configuration is invalid.' USING ERRCODE = '22023';
  END IF;
  IF coalesce((p_configuration->>'active')::boolean, false)
    AND (
      coalesce(length(btrim(p_configuration->>'bank_name')), 0) = 0
      OR coalesce(length(btrim(p_configuration->>'account_name')), 0) = 0
      OR coalesce(length(btrim(p_configuration->>'account_number')), 0) = 0
    )
  THEN
    RAISE EXCEPTION 'Bank name, account name and account number are required before enabling payments.'
      USING ERRCODE = '22023';
  END IF;
  IF p_price_kobo < 1 OR p_price_kobo > 100000000 THEN
    RAISE EXCEPTION 'Premium price must be between 1 and 100000000 kobo.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.plans
  SET price_kobo = p_price_kobo
  WHERE slug = lower(btrim(p_plan_slug)) AND is_premium;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Premium plan not found.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.system_settings (key, value, updated_at, updated_by)
  VALUES ('payments', p_configuration, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_payment_request(
  p_plan_slug text,
  p_receipt_path text,
  p_payment_reference text DEFAULT NULL
)
RETURNS public.payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_config jsonb;
  v_request public.payment_requests%ROWTYPE;
  v_reference text := nullif(left(btrim(coalesce(p_payment_reference, '')), 120), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.role = 'student' AND p.is_active
      AND p.verification_status = 'verified'
  ) THEN
    RAISE EXCEPTION 'Complete academic verification before submitting a premium payment.'
      USING ERRCODE = '42501';
  END IF;

  v_config := public.get_payment_configuration();
  IF NOT coalesce((v_config->>'active')::boolean, false) THEN
    RAISE EXCEPTION 'Manual payments are temporarily unavailable.' USING ERRCODE = '55000';
  END IF;
  IF coalesce((v_config->>'require_reference')::boolean, false) AND v_reference IS NULL THEN
    RAISE EXCEPTION 'Enter the required payment reference.' USING ERRCODE = '22023';
  END IF;
  IF p_receipt_path IS NULL OR (storage.foldername(p_receipt_path))[1] <> v_uid::text THEN
    RAISE EXCEPTION 'Receipt must be uploaded to your own private payment folder.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'payment-receipts' AND o.name = p_receipt_path
  ) THEN
    RAISE EXCEPTION 'Upload a payment receipt before submitting.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_plan
  FROM public.plans p
  WHERE p.slug = lower(btrim(p_plan_slug)) AND p.is_active AND p.is_premium;
  IF NOT FOUND OR v_plan.price_kobo <= 0 THEN
    RAISE EXCEPTION 'That premium plan is unavailable.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_requests (
    student_id, plan_id, amount_kobo, currency, receipt_path, payment_reference
  ) VALUES (
    v_uid, v_plan.id, v_plan.price_kobo, v_config->>'currency', p_receipt_path, v_reference
  )
  RETURNING * INTO v_request;
  RETURN v_request;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have a payment request waiting for review.' USING ERRCODE = '23505';
END;
$$;

CREATE OR REPLACE FUNCTION public.review_payment_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS public.payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_reason text := nullif(left(btrim(coalesce(p_rejection_reason, '')), 1000), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Provide a reason when rejecting a payment.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'That payment is no longer awaiting review.' USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT * INTO v_plan FROM public.plans WHERE id = v_request.plan_id AND is_active AND is_premium;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The submitted premium plan is no longer active.' USING ERRCODE = '55000';
    END IF;
    PERFORM public.admin_grant_plan(
      v_request.student_id,
      v_plan.slug,
      v_plan.duration_days,
      'Approved payment ' || v_request.id::text
    );
  END IF;

  UPDATE public.payment_requests
  SET status = p_decision,
      rejection_reason = CASE WHEN p_decision = 'rejected' THEN v_reason ELSE NULL END,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_request.student_id,
    CASE WHEN p_decision = 'approved' THEN 'Premium payment approved' ELSE 'Premium payment needs attention' END,
    CASE WHEN p_decision = 'approved'
      THEN 'Your payment has been approved and premium access is active.'
      ELSE 'Your payment was not approved: ' || v_reason
    END,
    CASE WHEN p_decision = 'approved' THEN 'plan_activated' ELSE 'info' END,
    '/student/subscription'
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_payment_requests(
  p_query text DEFAULT '',
  p_status text DEFAULT 'all',
  p_plan_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  student_id uuid,
  plan_id uuid,
  amount_kobo integer,
  currency text,
  receipt_path text,
  payment_reference text,
  status text,
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz,
  plan_name text,
  plan_slug text,
  plan_duration_days integer,
  student_name text,
  student_email text,
  student_matric_number text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := lower(btrim(coalesce(p_query, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('all', 'pending', 'approved', 'rejected')
    OR p_limit < 1 OR p_limit > 100 OR p_offset < 0
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to)
  THEN
    RAISE EXCEPTION 'Invalid payment search filters.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT r.id, r.student_id, r.plan_id, r.amount_kobo, r.currency, r.receipt_path,
         r.payment_reference, r.status, r.rejection_reason, r.reviewed_by,
         r.reviewed_at, r.created_at, pl.name, pl.slug, pl.duration_days,
         pr.full_name, pr.email, pr.matric_number,
         count(*) OVER () AS total_count
  FROM public.payment_requests r
  JOIN public.plans pl ON pl.id = r.plan_id
  JOIN public.profiles pr ON pr.id = r.student_id
  WHERE (p_status = 'all' OR r.status = p_status)
    AND (p_plan_id IS NULL OR r.plan_id = p_plan_id)
    AND (p_from IS NULL OR r.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR r.created_at < (p_to + 1)::timestamptz)
    AND (
      v_query = ''
      OR position(v_query IN lower(coalesce(pr.full_name, ''))) > 0
      OR position(v_query IN lower(coalesce(pr.email, ''))) > 0
      OR position(v_query IN lower(coalesce(pr.matric_number, ''))) > 0
      OR position(v_query IN lower(coalesce(pl.name, ''))) > 0
      OR position(v_query IN lower(coalesce(r.payment_reference, ''))) > 0
      OR position(v_query IN lower(r.id::text)) > 0
    )
  ORDER BY r.created_at DESC, r.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_configuration() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_payment_configuration(jsonb, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_payment_request(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_payment_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_configuration() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_payment_configuration(jsonb, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment_request(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_payment_request(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_payment_requests(text, text, uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payment_requests(text, text, uuid, date, date, integer, integer) TO authenticated;

-- Server-side, paginated admin plan search; parameters remain data rather than
-- being interpolated into a PostgREST filter string.
CREATE OR REPLACE FUNCTION public.admin_search_plan_students(
  p_query text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  full_name text,
  username text,
  email text,
  matric_number text,
  faculty text,
  department text,
  verification_status text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query text := lower(btrim(coalesce(p_query, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 THEN
    RAISE EXCEPTION 'Invalid search page.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.username, p.email, p.matric_number, p.faculty,
         p.department, p.verification_status,
         count(*) OVER () AS total_count
  FROM public.profiles p
  WHERE p.role = 'student'
    AND (
      v_query = ''
      OR position(v_query IN lower(coalesce(p.full_name, ''))) > 0
      OR position(v_query IN lower(coalesce(p.username, ''))) > 0
      OR position(v_query IN lower(coalesce(p.email, ''))) > 0
      OR position(v_query IN lower(coalesce(p.matric_number, ''))) > 0
      OR position(v_query IN lower(coalesce(p.department, ''))) > 0
    )
  ORDER BY lower(coalesce(p.full_name, p.username, p.email, '')), p.id
  LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_plan_students(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_plan_students(text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
