BEGIN;

CREATE TABLE IF NOT EXISTS public.premium_features (
  feature_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_enabled boolean NOT NULL DEFAULT true,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.premium_features (feature_key, label, description)
VALUES
  ('ai_assistant', 'AI Assistant', 'AI-powered academic question and study assistance.'),
  ('advanced_ai_assistance', 'Advanced AI assistance', 'More capable, context-aware academic assistance.'),
  ('ai_explanations', 'AI explanations', 'Detailed explanations for academic questions and materials.'),
  ('advanced_question_analysis', 'Advanced question analysis', 'In-depth analysis of questions and answer approaches.'),
  ('personalized_study_tools', 'Personalized study tools', 'Study tools tailored to individual progress and goals.'),
  ('advanced_study_plans', 'Advanced study plans', 'Expanded, personalized study planning tools.'),
  ('advanced_exam_preparation', 'Advanced exam preparation', 'Enhanced exam preparation and revision tools.'),
  ('premium_academic_tools', 'Premium academic tools', 'Additional academic tools reserved for Premium members.')
ON CONFLICT (feature_key) DO NOTHING;

ALTER TABLE public.premium_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "premium_features_enabled_read" ON public.premium_features;
CREATE POLICY "premium_features_enabled_read" ON public.premium_features
  FOR SELECT TO authenticated
  USING (is_enabled OR public.is_super_admin());
DROP POLICY IF EXISTS "premium_features_super_admin_manage" ON public.premium_features;
CREATE POLICY "premium_features_super_admin_manage" ON public.premium_features
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
REVOKE ALL ON public.premium_features FROM PUBLIC, anon;
GRANT SELECT ON public.premium_features TO authenticated;

CREATE TABLE IF NOT EXISTS public.premium_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entitlement_type text NOT NULL DEFAULT 'PREMIUM'
    CHECK (entitlement_type IN ('PREMIUM', 'FEATURE')),
  source text NOT NULL
    CHECK (source IN ('PAYMENT', 'ADMIN_GRANT', 'GLOBAL_PREMIUM')),
  plan_id uuid REFERENCES public.plans(id) ON DELETE RESTRICT,
  feature_key text REFERENCES public.premium_features(feature_key) ON DELETE RESTRICT,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  subscription_id uuid UNIQUE REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT premium_entitlements_target_check CHECK (
    (entitlement_type = 'PREMIUM' AND plan_id IS NOT NULL AND feature_key IS NULL)
    OR (entitlement_type = 'FEATURE' AND feature_key IS NOT NULL AND plan_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_premium_entitlements_user_active
  ON public.premium_entitlements (user_id, expires_at DESC)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_premium_entitlements_source_active
  ON public.premium_entitlements (source, user_id)
  WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_entitlements_global_user
  ON public.premium_entitlements (user_id)
  WHERE source = 'GLOBAL_PREMIUM';

CREATE TABLE IF NOT EXISTS public.premium_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'GLOBAL_PREMIUM_GRANT_ENABLED',
    'GLOBAL_PREMIUM_GRANT_DISABLED',
    'PREMIUM_FEATURE_CHANGED',
    'PREMIUM_SYSTEM_CHANGED'
  )),
  previous_state jsonb NOT NULL,
  new_state jsonb NOT NULL,
  identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_premium_audit_logs_created
  ON public.premium_audit_logs (created_at DESC);
ALTER TABLE public.premium_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "premium_audit_logs_super_admin_read" ON public.premium_audit_logs;
CREATE POLICY "premium_audit_logs_super_admin_read" ON public.premium_audit_logs
  FOR SELECT TO authenticated USING (public.is_super_admin());
REVOKE ALL ON public.premium_audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.premium_audit_logs TO authenticated;

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_reference text NOT NULL UNIQUE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  amount_kobo integer NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL CHECK (currency IN ('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD')),
  payment_method text NOT NULL CHECK (payment_method IN ('automatic', 'manual')),
  provider text NOT NULL,
  provider_transaction_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'expired')),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT payment_transactions_provider_id_unique UNIQUE (provider, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_created
  ON public.payment_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status_created
  ON public.payment_transactions (status, created_at DESC);
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_transactions_read_own_or_super_admin" ON public.payment_transactions;
CREATE POLICY "payment_transactions_read_own_or_super_admin" ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());
REVOKE ALL ON public.payment_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_transactions TO authenticated;

CREATE TABLE IF NOT EXISTS public.ai_usage_buckets (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0)
);
ALTER TABLE public.ai_usage_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_buckets FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS submitted_amount_kobo integer,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'bank_transfer';

ALTER TABLE public.premium_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "premium_entitlements_read_own_or_admin" ON public.premium_entitlements;
CREATE POLICY "premium_entitlements_read_own_or_admin" ON public.premium_entitlements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
REVOKE ALL ON public.premium_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.premium_entitlements TO authenticated;

COMMENT ON TABLE public.premium_entitlements IS
  'Auditable Premium and feature entitlements. Writes are server-owned; subscriptions are mirrored for backward compatibility.';

CREATE OR REPLACE FUNCTION public.sync_premium_entitlement_from_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_payment_request_id text;
  v_payment_transaction_id text;
  v_source text := 'ADMIN_GRANT';
BEGIN
  SELECT * INTO v_plan FROM public.plans WHERE id = NEW.plan_id;
  IF NOT FOUND OR NOT v_plan.is_premium THEN
    UPDATE public.premium_entitlements
       SET is_active = false,
           expires_at = NEW.expires_at,
           metadata = metadata || jsonb_build_object('subscription_id', NEW.id, 'legacy_plan_is_premium', false)
     WHERE subscription_id = NEW.id;
    RETURN NEW;
  END IF;

  v_payment_request_id := substring(NEW.admin_note FROM '^Approved payment ([0-9a-fA-F-]{36})$');
  v_payment_transaction_id := substring(NEW.admin_note FROM '^Automatic payment ([0-9a-fA-F-]{36})$');
  IF v_payment_request_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.payment_requests r
     WHERE r.id::text = v_payment_request_id
       AND r.student_id = NEW.user_id
       AND r.plan_id = NEW.plan_id
       AND r.status = 'approved'
  ) THEN
    v_source := 'PAYMENT';
  END IF;
  IF v_payment_transaction_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.payment_transactions t
     WHERE t.id::text = v_payment_transaction_id
       AND t.user_id = NEW.user_id
       AND t.plan_id = NEW.plan_id
       AND t.status = 'verified'
  ) THEN
    v_source := 'PAYMENT';
  END IF;

  INSERT INTO public.premium_entitlements (
    user_id, entitlement_type, source, plan_id, granted_by, granted_at,
    expires_at, is_active, metadata, subscription_id
  )
  VALUES (
    NEW.user_id, 'PREMIUM', v_source, NEW.plan_id, NEW.granted_by,
    NEW.created_at, NEW.expires_at, NEW.status = 'active',
    jsonb_strip_nulls(jsonb_build_object(
      'subscription_id', NEW.id,
      'payment_request_id', v_payment_request_id,
      'payment_transaction_id', v_payment_transaction_id,
      'admin_note', NEW.admin_note
    )),
    NEW.id
  )
  ON CONFLICT (subscription_id) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        entitlement_type = EXCLUDED.entitlement_type,
        source = EXCLUDED.source,
        plan_id = EXCLUDED.plan_id,
        granted_by = EXCLUDED.granted_by,
        expires_at = EXCLUDED.expires_at,
        is_active = EXCLUDED.is_active,
        metadata = EXCLUDED.metadata;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_premium_entitlement_from_subscription ON public.subscriptions;
CREATE TRIGGER trg_sync_premium_entitlement_from_subscription
  AFTER INSERT OR UPDATE OF user_id, plan_id, status, expires_at, granted_by, admin_note
  ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_premium_entitlement_from_subscription();

INSERT INTO public.premium_entitlements (
  user_id, entitlement_type, source, plan_id, granted_by, granted_at,
  expires_at, is_active, metadata, subscription_id
)
SELECT
  s.user_id,
  'PREMIUM',
  CASE WHEN EXISTS (
    SELECT 1
      FROM public.payment_requests r
     WHERE r.id::text = substring(s.admin_note FROM '^Approved payment ([0-9a-fA-F-]{36})$')
       AND r.student_id = s.user_id
       AND r.plan_id = s.plan_id
       AND r.status = 'approved'
  ) THEN 'PAYMENT' ELSE 'ADMIN_GRANT' END,
  s.plan_id,
  s.granted_by,
  s.created_at,
  s.expires_at,
  s.status = 'active',
  jsonb_strip_nulls(jsonb_build_object(
    'subscription_id', s.id,
    'payment_request_id', substring(s.admin_note FROM '^Approved payment ([0-9a-fA-F-]{36})$'),
    'payment_transaction_id', substring(s.admin_note FROM '^Automatic payment ([0-9a-fA-F-]{36})$'),
    'admin_note', s.admin_note,
    'migrated_from_subscription', true
  )),
  s.id
FROM public.subscriptions s
JOIN public.plans p ON p.id = s.plan_id AND p.is_premium
ON CONFLICT (subscription_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.premium_system_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (s.value->>'enabled')::boolean
       FROM public.system_settings s
      WHERE s.key = 'premium'),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_premium_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.premium_system_enabled()
     AND public.my_verified()
     AND (
       EXISTS (
         SELECT 1
           FROM public.premium_entitlements e
           JOIN public.plans p ON p.id = e.plan_id
          WHERE e.user_id = auth.uid()
            AND e.entitlement_type = 'PREMIUM'
            AND e.is_active
            AND (e.expires_at IS NULL OR e.expires_at > now())
            AND p.is_premium
            AND p.is_active
       )
       OR EXISTS (
         SELECT 1
           FROM public.subscriptions s
           JOIN public.plans p ON p.id = s.plan_id
          WHERE s.user_id = auth.uid()
            AND s.status = 'active'
            AND s.expires_at > now()
            AND p.is_premium
            AND p.is_active
            AND NOT EXISTS (
              SELECT 1 FROM public.premium_entitlements e WHERE e.subscription_id = s.id
            )
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS TABLE (
  plan_slug text,
  plan_name text,
  status text,
  expires_at timestamptz,
  is_premium boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.plan_slug, p.plan_name, p.status, p.expires_at, p.is_premium
    FROM (
      SELECT pl.slug AS plan_slug, pl.name AS plan_name, 'active'::text AS status,
             e.expires_at, pl.is_premium, e.granted_at, e.source
        FROM public.premium_entitlements e
        JOIN public.plans pl ON pl.id = e.plan_id
       WHERE e.user_id = auth.uid()
         AND e.entitlement_type = 'PREMIUM'
         AND e.is_active
         AND (e.expires_at IS NULL OR e.expires_at > now())
         AND pl.is_active
      UNION ALL
      SELECT pl.slug, pl.name, s.status, s.expires_at, pl.is_premium, s.starts_at,
             CASE
               WHEN s.admin_note LIKE 'Approved payment %' OR s.admin_note LIKE 'Automatic payment %'
                 THEN 'PAYMENT'
               ELSE 'ADMIN_GRANT'
             END
        FROM public.subscriptions s
        JOIN public.plans pl ON pl.id = s.plan_id
       WHERE s.user_id = auth.uid()
         AND s.status = 'active'
         AND s.expires_at > now()
         AND pl.is_active
         AND NOT EXISTS (
           SELECT 1 FROM public.premium_entitlements e WHERE e.subscription_id = s.id
         )
    ) p
   ORDER BY p.is_premium DESC,
            CASE p.source WHEN 'PAYMENT' THEN 1 WHEN 'ADMIN_GRANT' THEN 2 ELSE 3 END,
            p.expires_at DESC NULLS FIRST, p.granted_at DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.premium_feature_enabled(p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.premium_system_enabled()
     AND EXISTS (
       SELECT 1 FROM public.premium_features f
        WHERE f.feature_key = lower(btrim(p_feature_key))
          AND f.is_enabled
     );
$$;

CREATE OR REPLACE FUNCTION public.has_premium_feature(p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_premium_access()
         AND public.premium_feature_enabled(p_feature_key)
      OR public.my_verified()
         AND public.premium_feature_enabled(p_feature_key)
         AND EXISTS (
           SELECT 1
             FROM public.premium_entitlements e
            WHERE e.user_id = auth.uid()
              AND e.entitlement_type = 'FEATURE'
              AND e.feature_key = lower(btrim(p_feature_key))
              AND e.is_active
              AND (e.expires_at IS NULL OR e.expires_at > now())
         );
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_message()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_window timestamptz := date_trunc('hour', now());
  v_limit integer;
  v_used integer;
  v_window_started_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000'; END IF;
  IF NOT public.premium_feature_enabled('ai_assistant') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'feature_disabled');
  END IF;
  v_limit := CASE WHEN public.has_premium_feature('advanced_ai_assistance') THEN 40 ELSE 5 END;

  INSERT INTO public.ai_usage_buckets (user_id, window_started_at, used)
  VALUES (v_uid, v_window, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT window_started_at, used INTO v_window_started_at, v_used
    FROM public.ai_usage_buckets WHERE user_id = v_uid FOR UPDATE;
  IF v_window_started_at = v_window AND v_used >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'limit', v_limit, 'used', v_used);
  END IF;
  IF v_window_started_at IS DISTINCT FROM v_window THEN
    v_used := 0;
  END IF;
  UPDATE public.ai_usage_buckets
     SET window_started_at = v_window, used = v_used + 1
   WHERE user_id = v_uid;
  RETURN jsonb_build_object('allowed', true, 'limit', v_limit, 'used', v_used + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_premium_entitlement_from_subscription() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.premium_system_enabled() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.premium_feature_enabled(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_premium_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.premium_system_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.premium_feature_enabled(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_premium_feature(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_premium_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated;

INSERT INTO public.system_settings (key, value)
VALUES ('premium', '{"enabled": true, "global_grant_enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

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
         p.department, p.verification_status, count(*) OVER () AS total_count
    FROM public.profiles p
   WHERE p.role = 'student'
     AND (
       v_query = ''
       OR position(v_query IN lower(coalesce(p.full_name, ''))) > 0
       OR position(v_query IN lower(coalesce(p.username, ''))) > 0
       OR position(v_query IN lower(coalesce(p.email, ''))) > 0
       OR position(v_query IN lower(coalesce(p.matric_number, ''))) > 0
       OR position(v_query IN lower(coalesce(p.faculty, ''))) > 0
       OR position(v_query IN lower(coalesce(p.department, ''))) > 0
     )
   ORDER BY lower(coalesce(p.full_name, p.username, p.email, '')), p.id
   LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_plan_students(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_plan_students(text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.premium_admin_audit(
  p_action text, p_previous_state jsonb, p_new_state jsonb, p_identifiers jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.premium_audit_logs (admin_id, action, previous_state, new_state, identifiers)
  VALUES (auth.uid(), p_action, coalesce(p_previous_state, '{}'::jsonb),
          coalesce(p_new_state, '{}'::jsonb), coalesce(p_identifiers, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_premium_system_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_previous jsonb;
  v_next jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  SELECT value INTO v_previous FROM public.system_settings WHERE key = 'premium' FOR UPDATE;
  v_previous := coalesce(v_previous, '{"enabled":true,"global_grant_enabled":false}'::jsonb);
  v_next := jsonb_set(v_previous, '{enabled}', to_jsonb(p_enabled), true);
  INSERT INTO public.system_settings (key, value, updated_at, updated_by)
  VALUES ('premium', v_next, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
  IF coalesce((v_previous->>'enabled')::boolean, true) IS DISTINCT FROM p_enabled THEN
    PERFORM public.premium_admin_audit(
      'PREMIUM_SYSTEM_CHANGED',
      jsonb_build_object('enabled', coalesce((v_previous->>'enabled')::boolean, true)),
      jsonb_build_object('enabled', p_enabled)
    );
  END IF;
  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_global_premium_grant(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_previous jsonb;
  v_next jsonb;
  v_plan_id uuid;
  v_affected bigint := 0;
  v_previous_enabled boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  SELECT value INTO v_previous FROM public.system_settings WHERE key = 'premium' FOR UPDATE;
  v_previous := coalesce(v_previous, '{"enabled":true,"global_grant_enabled":false}'::jsonb);
  v_previous_enabled := coalesce((v_previous->>'global_grant_enabled')::boolean, false);
  IF v_previous_enabled = p_enabled THEN
    RETURN v_previous;
  END IF;
  SELECT id INTO v_plan_id FROM public.plans
   WHERE slug = 'premium' AND is_premium AND is_active;
  IF p_enabled AND v_plan_id IS NULL THEN
    RAISE EXCEPTION 'A Premium plan is required for the global grant.' USING ERRCODE = '55000';
  END IF;
  v_next := jsonb_set(v_previous, '{global_grant_enabled}', to_jsonb(p_enabled), true);
  INSERT INTO public.system_settings (key, value, updated_at, updated_by)
  VALUES ('premium', v_next, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
  IF p_enabled THEN
    INSERT INTO public.premium_entitlements (
      user_id, entitlement_type, source, plan_id, granted_by, granted_at,
      expires_at, is_active, metadata
    )
    SELECT p.id, 'PREMIUM', 'GLOBAL_PREMIUM', v_plan_id, auth.uid(), now(), NULL, true,
           jsonb_build_object('granted_by_global_toggle', true)
      FROM public.profiles p
     WHERE p.role = 'student' AND p.is_active
    ON CONFLICT (user_id) WHERE source = 'GLOBAL_PREMIUM'
    DO UPDATE SET plan_id = EXCLUDED.plan_id, granted_by = EXCLUDED.granted_by,
                  granted_at = EXCLUDED.granted_at, expires_at = NULL,
                  is_active = true, metadata = EXCLUDED.metadata;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  ELSE
    UPDATE public.premium_entitlements
       SET is_active = false,
           metadata = metadata || jsonb_build_object('global_grant_disabled_at', now())
     WHERE source = 'GLOBAL_PREMIUM' AND is_active;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
  END IF;
  PERFORM public.premium_admin_audit(
    CASE WHEN p_enabled THEN 'GLOBAL_PREMIUM_GRANT_ENABLED' ELSE 'GLOBAL_PREMIUM_GRANT_DISABLED' END,
    jsonb_build_object('global_grant_enabled', v_previous_enabled),
    jsonb_build_object('global_grant_enabled', p_enabled, 'affected_members', v_affected),
    jsonb_build_object('plan_id', v_plan_id)
  );
  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_premium_feature_enabled(p_feature_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_previous boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  SELECT is_enabled INTO v_previous
    FROM public.premium_features WHERE feature_key = lower(btrim(p_feature_key)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Premium feature not found.' USING ERRCODE = '22023'; END IF;
  UPDATE public.premium_features
     SET is_enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   WHERE feature_key = lower(btrim(p_feature_key));
  IF v_previous IS DISTINCT FROM p_enabled THEN
    PERFORM public.premium_admin_audit(
      'PREMIUM_FEATURE_CHANGED', jsonb_build_object('enabled', v_previous),
      jsonb_build_object('enabled', p_enabled),
      jsonb_build_object('feature_key', lower(btrim(p_feature_key)))
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_premium_admin_configuration()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.premium_system_enabled(),
    'global_grant_enabled', coalesce((
      SELECT (value->>'global_grant_enabled')::boolean FROM public.system_settings WHERE key = 'premium'
    ), false),
    'features', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'feature_key', feature_key, 'label', label, 'description', description,
        'is_enabled', is_enabled, 'updated_at', updated_at
      ) ORDER BY label) FROM public.premium_features
    ), '[]'::jsonb),
    'audit_logs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'admin_id', l.admin_id, 'admin_name', p.full_name,
        'action', l.action, 'previous_state', l.previous_state,
        'new_state', l.new_state, 'identifiers', l.identifiers, 'created_at', l.created_at
      ) ORDER BY l.created_at DESC)
      FROM (SELECT * FROM public.premium_audit_logs ORDER BY created_at DESC LIMIT 30) l
      LEFT JOIN public.profiles p ON p.id = l.admin_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_premium_public_configuration()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', public.premium_system_enabled(),
    'features', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'feature_key', feature_key, 'label', label, 'description', description
      ) ORDER BY label) FROM public.premium_features WHERE is_enabled
    ), '[]'::jsonb),
    'manual_payment_enabled', public.premium_system_enabled()
      AND coalesce((SELECT coalesce((value->>'manual_enabled')::boolean,
        (value->>'active')::boolean, false) FROM public.system_settings WHERE key = 'payments'), false),
    'automatic_payment_enabled', public.premium_system_enabled()
      AND coalesce((SELECT (value->>'automatic_enabled')::boolean
        FROM public.system_settings WHERE key = 'payments'), false)
  );
$$;

CREATE OR REPLACE FUNCTION public.my_premium_source()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.source FROM public.premium_entitlements e
    JOIN public.plans p ON p.id = e.plan_id
   WHERE e.user_id = auth.uid() AND e.entitlement_type = 'PREMIUM'
     AND e.is_active AND (e.expires_at IS NULL OR e.expires_at > now())
     AND p.is_premium AND p.is_active
   ORDER BY CASE e.source WHEN 'PAYMENT' THEN 1 WHEN 'ADMIN_GRANT' THEN 2 ELSE 3 END,
            e.expires_at DESC NULLS FIRST
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.grant_global_premium_to_new_member()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_id uuid;
  v_enabled boolean;
BEGIN
  IF NEW.role <> 'student' OR NOT NEW.is_active THEN
    UPDATE public.premium_entitlements
       SET is_active = false,
           metadata = metadata || jsonb_build_object('global_grant_eligibility_lost_at', now())
     WHERE user_id = NEW.id AND source = 'GLOBAL_PREMIUM' AND is_active;
    RETURN NEW;
  END IF;
  SELECT coalesce((value->>'global_grant_enabled')::boolean, false)
    INTO v_enabled FROM public.system_settings WHERE key = 'premium';
  IF NOT coalesce(v_enabled, false) THEN RETURN NEW; END IF;
  SELECT id INTO v_plan_id FROM public.plans WHERE slug = 'premium' AND is_premium AND is_active;
  IF v_plan_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.premium_entitlements (
    user_id, entitlement_type, source, plan_id, expires_at, is_active, metadata
  ) VALUES (NEW.id, 'PREMIUM', 'GLOBAL_PREMIUM', v_plan_id, NULL, true,
            jsonb_build_object('granted_by_global_toggle', true))
  ON CONFLICT (user_id) WHERE source = 'GLOBAL_PREMIUM'
  DO UPDATE SET plan_id = EXCLUDED.plan_id, expires_at = NULL,
                is_active = true, metadata = EXCLUDED.metadata;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_global_premium_grant ON public.profiles;
CREATE TRIGGER trg_profiles_global_premium_grant
  AFTER INSERT OR UPDATE OF role, is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_global_premium_to_new_member();

REVOKE ALL ON FUNCTION public.premium_admin_audit(text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_global_premium_to_new_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_premium_system_enabled(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_global_premium_grant(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_premium_feature_enabled(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_premium_admin_configuration() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_premium_public_configuration() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_premium_source() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_ai_message() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_premium_system_enabled(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_global_premium_grant(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_premium_feature_enabled(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_premium_admin_configuration() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_premium_public_configuration() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_premium_source() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_message() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_payment_configuration()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT s.value FROM public.system_settings s WHERE s.key = 'payments'),
    jsonb_build_object(
      'active', false, 'manual_enabled', false, 'automatic_enabled', false,
      'bank_name', '', 'account_name', '', 'account_number', '',
      'instructions', '', 'currency', 'NGN', 'require_reference', false,
      'reference_label', 'Payment reference', 'other_information', ''
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_payment_request(
  p_plan_slug text,
  p_receipt_path text,
  p_payment_reference text DEFAULT NULL,
  p_payment_date date DEFAULT NULL,
  p_submitted_amount_kobo integer DEFAULT NULL,
  p_payment_method text DEFAULT 'bank_transfer'
)
RETURNS public.payment_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_plan public.plans%ROWTYPE;
  v_config jsonb;
  v_request public.payment_requests%ROWTYPE;
  v_reference text := nullif(left(btrim(coalesce(p_payment_reference, '')), 120), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000'; END IF;
  IF NOT public.premium_system_enabled() THEN
    RAISE EXCEPTION 'Premium purchases are temporarily unavailable.' USING ERRCODE = '55000';
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
  IF NOT coalesce((v_config->>'manual_enabled')::boolean, (v_config->>'active')::boolean, false) THEN
    RAISE EXCEPTION 'Manual payments are temporarily unavailable.' USING ERRCODE = '55000';
  END IF;
  IF coalesce((v_config->>'require_reference')::boolean, false) AND v_reference IS NULL THEN
    RAISE EXCEPTION 'Enter the required payment reference.' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method IS DISTINCT FROM 'bank_transfer' THEN
    RAISE EXCEPTION 'That manual payment method is not supported.' USING ERRCODE = '22023';
  END IF;
  IF p_submitted_amount_kobo IS NULL OR p_submitted_amount_kobo < 1 OR p_submitted_amount_kobo > 100000000 THEN
    RAISE EXCEPTION 'Enter the amount you transferred.' USING ERRCODE = '22023';
  END IF;
  IF p_payment_date IS NULL OR p_payment_date > current_date OR p_payment_date < current_date - 90 THEN
    RAISE EXCEPTION 'Enter a payment date within the last 90 days.' USING ERRCODE = '22023';
  END IF;
  IF p_receipt_path IS NULL OR (storage.foldername(p_receipt_path))[1] <> v_uid::text THEN
    RAISE EXCEPTION 'Receipt must be uploaded to your own private payment folder.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'payment-receipts' AND o.name = p_receipt_path
  ) THEN
    RAISE EXCEPTION 'Upload a payment receipt before submitting.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.plans
   WHERE slug = lower(btrim(p_plan_slug)) AND is_active AND is_premium;
  IF NOT FOUND OR v_plan.price_kobo <= 0 THEN
    RAISE EXCEPTION 'That premium plan is unavailable.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payment_requests (
    student_id, plan_id, amount_kobo, submitted_amount_kobo, payment_date,
    payment_method, currency, receipt_path, payment_reference
  ) VALUES (
    v_uid, v_plan.id, v_plan.price_kobo, p_submitted_amount_kobo,
    p_payment_date, p_payment_method, v_config->>'currency', p_receipt_path, v_reference
  ) RETURNING * INTO v_request;
  RETURN v_request;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'You already have a payment request waiting for review or that reference was already submitted.'
    USING ERRCODE = '23505';
END;
$$;
DROP FUNCTION IF EXISTS public.submit_payment_request(text, text, text);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_reference_unique
  ON public.payment_requests (lower(payment_reference))
  WHERE payment_reference IS NOT NULL;
REVOKE ALL ON FUNCTION public.submit_payment_request(text, text, text, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_payment_request(text, text, text, date, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_paystack_transaction(p_plan_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_config jsonb;
  v_transaction public.payment_transactions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000'; END IF;
  IF NOT public.premium_system_enabled() THEN
    RAISE EXCEPTION 'Premium purchases are temporarily unavailable.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_user FROM public.profiles WHERE id = auth.uid() FOR SHARE;
  IF NOT FOUND OR v_user.role <> 'student' OR NOT v_user.is_active OR v_user.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Verify your active student account before purchasing Premium.' USING ERRCODE = '42501';
  END IF;
  IF public.has_premium_access() THEN RAISE EXCEPTION 'Premium access is already active.' USING ERRCODE = '55000'; END IF;
  v_config := public.get_payment_configuration();
  IF NOT coalesce((v_config->>'automatic_enabled')::boolean, false) THEN
    RAISE EXCEPTION 'Automatic payments are temporarily unavailable.' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_plan FROM public.plans
   WHERE slug = lower(btrim(p_plan_slug)) AND is_active AND is_premium AND price_kobo > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'That Premium plan is unavailable.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.payment_transactions (
    user_id, payment_reference, plan_id, amount_kobo, currency, payment_method, provider, metadata
  ) VALUES (
    auth.uid(), 'FUW-' || upper(replace(gen_random_uuid()::text, '-', '')),
    v_plan.id, v_plan.price_kobo, coalesce(v_config->>'currency', 'NGN'),
    'automatic', 'paystack', jsonb_build_object('plan_slug', v_plan.slug)
  ) RETURNING * INTO v_transaction;
  RETURN jsonb_build_object(
    'id', v_transaction.id, 'reference', v_transaction.payment_reference,
    'amount_kobo', v_transaction.amount_kobo, 'currency', v_transaction.currency,
    'email', v_user.email, 'plan_slug', v_plan.slug
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_paystack_checkout(p_transaction_id uuid, p_authorization_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required.' USING ERRCODE = '42501'; END IF;
  IF p_authorization_url IS NULL OR p_authorization_url !~ '^https://checkout\.paystack\.com/' THEN
    RAISE EXCEPTION 'Invalid Paystack checkout URL.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payment_transactions
     SET metadata = metadata || jsonb_build_object('authorization_url', p_authorization_url),
         updated_at = now()
   WHERE id = p_transaction_id AND status = 'pending' AND payment_method = 'automatic';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment transaction is no longer pending.' USING ERRCODE = '55000'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_paystack_transaction(p_reference text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required.' USING ERRCODE = '42501'; END IF;
  UPDATE public.payment_transactions
     SET status = 'failed', verification_status = 'failed',
         failure_reason = left(coalesce(p_reason, 'Provider payment failed.'), 500), updated_at = now()
   WHERE payment_reference = p_reference AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_paystack_transaction(
  p_reference text, p_provider_transaction_id text, p_provider_status text,
  p_amount_kobo integer, p_currency text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_transaction public.payment_transactions%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_transaction FROM public.payment_transactions
   WHERE payment_reference = p_reference AND provider = 'paystack' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment reference not found.' USING ERRCODE = '22023'; END IF;
  IF v_transaction.status = 'verified' THEN
    RETURN jsonb_build_object('status', 'verified', 'id', v_transaction.id, 'idempotent', true);
  END IF;
  IF v_transaction.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment transaction is not pending.' USING ERRCODE = '55000';
  END IF;
  IF p_provider_status <> 'success' OR p_amount_kobo IS DISTINCT FROM v_transaction.amount_kobo
     OR upper(coalesce(p_currency, '')) <> v_transaction.currency
     OR p_provider_transaction_id IS NULL THEN
    UPDATE public.payment_transactions
       SET status = 'failed', verification_status = 'failed',
           failure_reason = 'Provider verification did not match the transaction.', updated_at = now()
     WHERE id = v_transaction.id;
    RETURN jsonb_build_object('status', 'failed', 'id', v_transaction.id, 'idempotent', false);
  END IF;
  SELECT * INTO v_plan FROM public.plans
   WHERE id = v_transaction.plan_id AND is_active AND is_premium;
  IF NOT FOUND THEN RAISE EXCEPTION 'The purchased plan is no longer available.' USING ERRCODE = '55000'; END IF;
  UPDATE public.payment_transactions
     SET status = 'verified', verification_status = 'verified',
         provider_transaction_id = p_provider_transaction_id, verified_at = now(), updated_at = now()
   WHERE id = v_transaction.id;
  INSERT INTO public.subscriptions (user_id, plan_id, status, starts_at, expires_at, admin_note)
  VALUES (v_transaction.user_id, v_transaction.plan_id, 'active', now(),
          now() + make_interval(days => v_plan.duration_days),
          'Automatic payment ' || v_transaction.id::text)
  RETURNING * INTO v_subscription;
  UPDATE public.payment_transactions
     SET activated_at = v_subscription.starts_at, expires_at = v_subscription.expires_at,
         metadata = metadata || jsonb_build_object('subscription_id', v_subscription.id), updated_at = now()
   WHERE id = v_transaction.id;
  INSERT INTO public.notifications (user_id, title, message, type, link, dedupe_key)
  VALUES (
    v_transaction.user_id, 'Premium payment verified',
    v_plan.name || ' is now active until ' ||
      to_char(v_subscription.expires_at AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY') || '.',
    'plan_activated', '/student/subscription', 'automatic_payment:' || v_transaction.id::text
  ) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  RETURN jsonb_build_object('status', 'verified', 'id', v_transaction.id, 'idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.create_paystack_transaction(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_paystack_checkout(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_paystack_transaction(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_paystack_transaction(text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_paystack_transaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_paystack_checkout(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_paystack_transaction(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_paystack_transaction(text, text, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_manual_payment_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.submitted_amount_kobo IS NOT NULL
     AND NEW.submitted_amount_kobo IS DISTINCT FROM NEW.amount_kobo THEN
    RAISE EXCEPTION 'Submitted amount does not match the plan price. Reject this payment request.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_manual_payment_approval ON public.payment_requests;
CREATE TRIGGER trg_guard_manual_payment_approval
  BEFORE UPDATE OF status ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_manual_payment_approval();
REVOKE ALL ON FUNCTION public.guard_manual_payment_approval() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_payment_request(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS public.payment_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT * INTO v_request FROM public.payment_requests
   WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'That payment is no longer awaiting review.' USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT * INTO v_plan FROM public.plans
     WHERE id = v_request.plan_id AND is_active AND is_premium;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The submitted premium plan is no longer active.' USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.payment_requests
     SET status = p_decision,
         rejection_reason = CASE WHEN p_decision = 'rejected' THEN v_reason ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   WHERE id = p_request_id
   RETURNING * INTO v_request;

  IF p_decision = 'approved' THEN
    PERFORM public.admin_grant_plan(
      v_request.student_id, v_plan.slug, v_plan.duration_days,
      'Approved payment ' || v_request.id::text
    );
  END IF;

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

DROP FUNCTION IF EXISTS public.admin_list_payment_requests(text, text, uuid, date, date, integer, integer);
CREATE FUNCTION public.admin_list_payment_requests(
  p_query text DEFAULT '',
  p_status text DEFAULT 'all',
  p_plan_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, student_id uuid, plan_id uuid, amount_kobo integer, currency text,
  receipt_path text, payment_reference text, status text, rejection_reason text,
  reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz,
  plan_name text, plan_slug text, plan_duration_days integer,
  student_name text, student_email text, student_matric_number text,
  total_count bigint, submitted_amount_kobo integer, payment_date date, payment_method text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_query text := lower(btrim(coalesce(p_query, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('all', 'pending', 'approved', 'rejected')
     OR p_limit < 1 OR p_limit > 100 OR p_offset < 0
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to) THEN
    RAISE EXCEPTION 'Invalid payment search filters.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT r.id, r.student_id, r.plan_id, r.amount_kobo, r.currency, r.receipt_path,
         r.payment_reference, r.status, r.rejection_reason, r.reviewed_by, r.reviewed_at,
         r.created_at, pl.name, pl.slug, pl.duration_days, pr.full_name, pr.email,
         pr.matric_number, count(*) OVER (),
         r.submitted_amount_kobo, r.payment_date, r.payment_method
    FROM public.payment_requests r
    JOIN public.plans pl ON pl.id = r.plan_id
    JOIN public.profiles pr ON pr.id = r.student_id
   WHERE (p_status = 'all' OR r.status = p_status)
     AND (p_plan_id IS NULL OR r.plan_id = p_plan_id)
     AND (p_from IS NULL OR r.created_at >= p_from::timestamptz)
     AND (p_to IS NULL OR r.created_at < (p_to + 1)::timestamptz)
     AND (v_query = ''
       OR position(v_query IN lower(coalesce(pr.full_name, ''))) > 0
       OR position(v_query IN lower(coalesce(pr.email, ''))) > 0
       OR position(v_query IN lower(coalesce(pr.matric_number, ''))) > 0
       OR position(v_query IN lower(coalesce(pl.name, ''))) > 0
       OR position(v_query IN lower(coalesce(r.payment_reference, ''))) > 0
       OR position(v_query IN lower(r.id::text)) > 0)
   ORDER BY r.created_at DESC, r.id
   LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_payment_requests(text, text, uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_payment_requests(text, text, uuid, date, date, integer, integer) TO authenticated;

DROP POLICY IF EXISTS "library-materials entitlement read" ON storage.objects;
CREATE POLICY "library-materials entitlement read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'library-materials'
    AND (
      public.is_admin()
      OR (
        public.has_premium_access()
        AND public.has_premium_feature('premium_academic_tools')
      )
    )
  );

DROP POLICY IF EXISTS "planner_insert_own" ON public.study_planner_tasks;
CREATE POLICY "planner_insert_own" ON public.study_planner_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (task_type <> 'exam_prep' OR public.has_premium_feature('advanced_study_plans'))
  );
DROP POLICY IF EXISTS "planner_update_own" ON public.study_planner_tasks;
CREATE POLICY "planner_update_own" ON public.study_planner_tasks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (task_type <> 'exam_prep' OR public.has_premium_feature('advanced_study_plans'))
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
