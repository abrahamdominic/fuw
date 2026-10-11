-- =============================================================================
-- VC executive dashboard — role helper, provisioning, read-only aggregates,
-- and RLS hardening.
--
-- Depends on `'vc'` having been added to public.app_role (separate migration
-- 20261014130000_vc_role.sql).
--
-- Design rules:
--   * A VC can NEVER self-register. The role is granted only by the Super
--     Admin through provision_vice_chancellor().
--   * The VC front-end is read-only and only ever calls the vc_* aggregate
--     RPCs defined here. No table is read directly by the dashboard; the
--     details that administration owns (profiles beyond the VC's own row,
--     admin/super_admin accounts, permissions, wallets, escrows, vendor and
--     accommodation back-office data) are deliberately invisible.
--   * Every vc_* RPC returns aggregates or non-personal institutional content
--     only: no names, emails, phones, matric numbers, account ids or managed
--     tables are surfaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Role helper: is_vc()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_vc()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'vc'::public.app_role AND is_active
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_vc() TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 2. Provisioning — Super Admin only. The VC can never promote others or self.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_vice_chancellor(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can provision the Vice-Chancellor.';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'A target account is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = target_user_id AND role = 'super_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'The Super Admin account cannot be converted to the Vice-Chancellor role.';
  END IF;

  UPDATE public.profiles
     SET role = 'vc'::public.app_role,
         permissions = '{}',
         is_active = TRUE,
         updated_at = NOW()
   WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile found for the target account.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_vice_chancellor(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can manage the Vice-Chancellor.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = target_user_id AND role = 'vc'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Target account is not a Vice-Chancellor.';
  END IF;

  UPDATE public.profiles
     SET role = 'student'::public.app_role,
         permissions = '{}',
         updated_at = NOW()
   WHERE id = target_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.list_vice_chancellors()
RETURNS TABLE(
  id uuid,
  full_name text,
  email text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can list Vice-Chancellors.';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.is_active, p.created_at, p.updated_at
  FROM public.profiles p
  WHERE p.role = 'vc'::public.app_role
  ORDER BY p.created_at ASC;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Read-only executive aggregates (VC scope: sections A/B/C/F only)
--    Shared permission check; every RPC is SECURITY DEFINER so RLS on student
--    rows never leaks into the response — the functions return aggregates only.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.vc_overview_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_vc() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Insufficient permission to view the executive overview' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'students',                COUNT(*) FILTER (WHERE role = 'student'),
    'active_students',         COUNT(*) FILTER (WHERE role = 'student' AND is_active),
    'verified_students',       COUNT(*) FILTER (WHERE role = 'student' AND (verified IS TRUE OR verification_status = 'verified')),
    'pending_verifications',   COUNT(*) FILTER (WHERE role = 'student' AND verification_status = 'pending'),
    'lecturers',               COUNT(*) FILTER (WHERE role = 'lecturer')
  )
  INTO result
  FROM public.profiles;

  RETURN result || jsonb_build_object(
    'faculties',          (SELECT COUNT(*) FROM public.faculties),
    'departments',        (SELECT COUNT(*) FROM public.departments),
    'courses',            (SELECT COUNT(*) FROM public.courses),
    'approved_materials', (SELECT COUNT(*) FROM public.materials WHERE status = 'approved'),
    'pending_materials',  (SELECT COUNT(*) FROM public.materials WHERE status = 'pending'),
    'rejected_materials', (SELECT COUNT(*) FROM public.materials WHERE status = 'rejected'),
    'total_downloads',    (SELECT COALESCE(SUM(downloads), 0)::bigint FROM public.materials),
    'total_views',        (SELECT COALESCE(SUM(views), 0)::bigint FROM public.materials),
    'announcements',      (SELECT COUNT(*) FROM public.library_announcements WHERE is_published)
  );
END $$;

CREATE OR REPLACE FUNCTION public.vc_student_insights()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_vc() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Insufficient permission to view student insights' USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'by_faculty', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT COALESCE(NULLIF(btrim(COALESCE(faculty, '')), ''), 'Unassigned') AS name,
               COUNT(*)::int AS n_count
        FROM public.profiles WHERE role = 'student'
        GROUP BY 1 ORDER BY n_count DESC
      ) s
    ),
    'by_department', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT COALESCE(NULLIF(btrim(COALESCE(department, '')), ''), 'Unassigned') AS name,
               COUNT(*)::int AS n_count
        FROM public.profiles WHERE role = 'student'
        GROUP BY 1 ORDER BY n_count DESC LIMIT 12
      ) s
    ),
    'by_level', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT COALESCE(NULLIF(btrim(COALESCE(level, '')), ''), 'Unassigned') AS name,
               COUNT(*)::int AS n_count
        FROM public.profiles WHERE role = 'student'
        GROUP BY 1 ORDER BY 2 DESC
      ) s
    ),
    'by_gender', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT
          CASE
            WHEN lower(btrim(coalesce(gender, ''))) = 'male'   THEN 'Male'
            WHEN lower(btrim(coalesce(gender, ''))) = 'female' THEN 'Female'
            WHEN lower(btrim(coalesce(gender, ''))) IN ('other', 'non-binary', 'nonbinary') THEN 'Other'
            ELSE 'Unspecified'
          END::text AS name,
          COUNT(*)::int AS n_count
        FROM public.profiles WHERE role = 'student'
        GROUP BY 1 ORDER BY n_count DESC
      ) s
    ),
    'verification_breakdown', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('status', status, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT
          CASE
            WHEN verification_status = 'pending'  THEN 'pending'
            WHEN verification_status IN ('verified', 'approved') OR verified IS TRUE THEN 'verified'
            WHEN verification_status = 'rejected' THEN 'rejected'
            ELSE 'unsubmitted'
          END::text AS status,
          COUNT(*)::int AS n_count
        FROM public.profiles WHERE role = 'student'
        GROUP BY 1 ORDER BY n_count DESC
      ) s
    ),
    'registrations_by_month', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', label, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS label,
               COUNT(*)::int AS n_count
        FROM public.profiles
        WHERE role = 'student' AND created_at >= date_trunc('month', now()) - interval '5 months'
        GROUP BY 1 ORDER BY 1
      ) s
    )
  );

  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.vc_academic_resources()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_vc() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Insufficient permission to view academic resources' USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'approved_materials', COUNT(*) FILTER (WHERE status = 'approved'),
        'pending_materials',  COUNT(*) FILTER (WHERE status = 'pending'),
        'total_downloads',    COALESCE(SUM(downloads), 0)::bigint,
        'total_views',        COALESCE(SUM(views), 0)::bigint
      )
      FROM public.materials
    ),
    'by_type', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', material_type, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT material_type::text AS material_type, COUNT(*)::int AS n_count
        FROM public.materials WHERE status = 'approved'
        GROUP BY 1 ORDER BY n_count DESC
      ) s
    ),
    'by_faculty', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT COALESCE(NULLIF(btrim(COALESCE(faculty, '')), ''), 'Unassigned') AS name,
               COUNT(*)::int AS n_count
        FROM public.materials WHERE status = 'approved'
        GROUP BY 1 ORDER BY n_count DESC
      ) s
    ),
    'by_department', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'count', n_count)), '[]'::jsonb)
      FROM (
        SELECT COALESCE(NULLIF(btrim(COALESCE(department, '')), ''), 'Unassigned') AS name,
               COUNT(*)::int AS n_count
        FROM public.materials WHERE status = 'approved'
        GROUP BY 1 ORDER BY n_count DESC LIMIT 12
      ) s
    ),
    'top_materials', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'faculty', COALESCE(faculty, ''), 'department', COALESCE(department, ''),
        'level', COALESCE(level, ''), 'course_code', COALESCE(course_code, ''),
        'downloads', downloads, 'views', views
      )), '[]'::jsonb)
      FROM (
        SELECT id, title, faculty, department, level, course_code, downloads, views
        FROM public.materials WHERE status = 'approved'
        ORDER BY downloads DESC, views DESC LIMIT 10
      ) s
    )
  );

  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.vc_reports_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_vc() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Insufficient permission to view executive reports' USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'announcements', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'body', body, 'audience', audience, 'published_at', published_at
      )), '[]'::jsonb)
      FROM (
        SELECT id, title, body, audience, published_at
        FROM public.library_announcements
        WHERE is_published
        ORDER BY published_at DESC LIMIT 10
      ) s
    ),
    'recent_materials', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'faculty', faculty, 'department', department,
        'level', level, 'course_code', course_code, 'created_at', created_at
      )), '[]'::jsonb)
      FROM (
        SELECT id, title, faculty, department, level, course_code, created_at
        FROM public.materials WHERE status = 'approved'
        ORDER BY created_at DESC LIMIT 8
      ) s
    ),
    'published_this_month', (SELECT COUNT(*)::int FROM public.materials WHERE status = 'approved' AND created_at >= date_trunc('month', now()))
  );

  RETURN result;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Calls are confined to the authenticated surface; anonymous stays out.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.provision_vice_chancellor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_vice_chancellor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_vice_chancellors() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vc_overview_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vc_student_insights() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vc_academic_resources() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vc_reports_overview() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_vc() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION
  public.provision_vice_chancellor(uuid),
  public.revoke_vice_chancellor(uuid),
  public.list_vice_chancellors(),
  public.vc_overview_stats(),
  public.vc_student_insights(),
  public.vc_academic_resources(),
  public.vc_reports_overview()
TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS hardening — VC reads nothing sensitive directly.
--
-- profiles: the permissive "own row or is_admin()" policy already limits a VC
-- to their own row; the restrictive policy below makes the intent explicit and
-- future-proof (even if another permissive SELECT policy is added later the
-- restrictive rule still caps VC reads to the VC's own row).
--
-- Marketplace / accommodation / wallet tables: a RESTRICTIVE policy that
-- returns zero rows for a VC is ANDed with whatever permissive policies exist,
-- so a VC gets no rows from this surfaces no matter what a future permissive
-- policy grants. Non-VC accounts are untouched.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS vc_deny_non_own_profile ON public.profiles;
CREATE POLICY vc_deny_non_own_profile ON public.profiles
  AS RESTRICTIVE FOR SELECT
  USING (NOT public.is_vc() OR id = auth.uid());

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'accommodation_advert_payments',
    'accommodation_connection_fees',
    'accommodation_inquiries',
    'accommodation_properties',
    'accommodation_providers',
    'accommodation_reports',
    'accommodation_reviews',
    'marketplace_addresses',
    'marketplace_admin_staff',
    'marketplace_advert_packages',
    'marketplace_adverts',
    'marketplace_audit_log',
    'marketplace_categories',
    'marketplace_checkouts',
    'marketplace_conversations',
    'marketplace_delivery_options',
    'marketplace_dispute_evidence',
    'marketplace_disputes',
    'marketplace_escrow_credit_consumptions',
    'marketplace_escrow_credit_ledger',
    'marketplace_escrows',
    'marketplace_favourites',
    'marketplace_inventory',
    'marketplace_ledger_entries',
    'marketplace_messages',
    'marketplace_notifications',
    'marketplace_order_items',
    'marketplace_order_status_history',
    'marketplace_order_transitions',
    'marketplace_orders',
    'marketplace_payment_events',
    'marketplace_payments',
    'marketplace_platform_settings',
    'marketplace_product_images',
    'marketplace_product_variants',
    'marketplace_products',
    'marketplace_reports',
    'marketplace_reviews',
    'marketplace_settlements',
    'marketplace_subcategories',
    'marketplace_vendor_verifications',
    'marketplace_vendors',
    'marketplace_wallets',
    'marketplace_withdrawal_allocations',
    'marketplace_withdrawals',
    'roommate_requests',
    'wallet_funding_transactions',
    'wallet_withdrawals'
  ];
BEGIN
  FOREACH t IN ARRAY tbls
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS vc_deny_all_read ON public.%I; ' ||
      'CREATE POLICY vc_deny_all_read ON public.%I AS RESTRICTIVE FOR SELECT USING (NOT public.is_vc());',
      t, t
    );
  END LOOP;
END $$;