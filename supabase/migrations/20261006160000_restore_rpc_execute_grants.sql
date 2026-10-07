-- Restore the RPC EXECUTE grants the application depends on, and fix the
-- three read paths that were leaking or miscounting while unreachable.
--
-- Background
-- ----------
-- Most of these functions were created SECURITY DEFINER with an ACL that only
-- named `postgres` and `service_role`. Their bodies already perform the real
-- authorization check (`public.is_admin()`, `public.is_super_admin()`,
-- `public.assert_view_analytics()`, or an `auth.uid()` ownership predicate),
-- but PostgREST refuses the call before the body ever runs when the calling
-- role has no EXECUTE privilege. The result is a hard `42501 permission denied`
-- for every signed-in admin, which is why the admin, super-admin and Premium
-- screens failed while the SQL definitions still "looked correct".
--
-- Granting EXECUTE here is therefore safe: it re-opens the door to the guard,
-- it does not replace it. Every function in the authenticated-only list was
-- verified to authorize internally before being listed. The authorization
-- decision stays in the database, where it cannot be bypassed by a client that
-- simply decides to call the endpoint.
--
-- anon access is deliberately limited to functions that return aggregates,
-- published content, or counters. Anything that touches a payout account
-- number, a student identity, or an admin capability stays authenticated-only.

-- ---------------------------------------------------------------------------
-- 1. get_research_item_detail exposed unpublished submissions
-- ---------------------------------------------------------------------------
-- This returned `to_jsonb(ri)` for *any* research item id, including items
-- still in 'submitted' or 'under_review', together with their `file_url` and
-- `file_path`. `search_research_items` correctly filters to
-- status IN ('approved','published'), so the detail endpoint was a straight
-- bypass: guess or harvest an id from any other surface and read a paper that
-- has not passed review, before its author has agreed to publish.
CREATE OR REPLACE FUNCTION public.get_research_item_detail(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.research_items%ROWTYPE;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'item id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.research_items WHERE id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'research item not found' USING ERRCODE = 'P0002';
  END IF;

  -- Unpublished work stays private to its submitter and to staff, regardless
  -- of how the caller obtained the id.
  IF v_item.status NOT IN ('approved', 'published')
     AND NOT (public.is_admin() OR public.mp_is_staff())
     AND v_item.submitted_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'research item not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'authors', COALESCE(
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.position)
         FROM public.research_item_authors a
        WHERE a.research_item_id = v_item.id),
      '[]'::jsonb
    ),
    'faculty_name', (SELECT f.name FROM public.faculties f
                      WHERE f.id = v_item.faculty_id AND f.id IS NOT NULL),
    'department_name', (SELECT d.name FROM public.departments d
                         WHERE d.id = v_item.department_id AND d.id IS NOT NULL),
    'uploader', jsonb_build_object(
      'id', (SELECT p.id FROM public.profiles p WHERE p.id = v_item.submitted_by),
      'name', (SELECT COALESCE(p.display_name, p.full_name, p.username)
                 FROM public.profiles p WHERE p.id = v_item.submitted_by)
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. get_public_stats counted staff, and called matric numbers "verified"
-- ---------------------------------------------------------------------------
-- It counted every row in profiles, so the advertised "students" figure
-- included admins, and it inferred verification from a non-empty
-- matric_number, which is true for every registered student regardless of
-- whether anyone reviewed their documents. Verified is now the real flag the
-- verification workflow writes.
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS TABLE(students bigint, verified_students bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE pr.role = 'student')::bigint,
    COUNT(*) FILTER (
      WHERE pr.role = 'student'
        AND (pr.verified IS TRUE OR pr.verification_status = 'verified')
    )::bigint
  FROM public.profiles pr;
$$;

-- ---------------------------------------------------------------------------
-- 3. count_students_by_gender had no guard and silently dropped data
-- ---------------------------------------------------------------------------
-- It is an admin-only demographic report reached from the admin dashboard, so
-- the count is now behind the analytics permission check. It also filtered to
-- gender IN ('Male','Female'), which silently discarded every other value and
-- any blank, so the chart could never sum to the real student total. Values
-- are normalised and anything unrecognised is reported as 'Unspecified'
-- rather than dropped.
CREATE OR REPLACE FUNCTION public.count_students_by_gender()
RETURNS TABLE(gender text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_view_analytics();

  RETURN QUERY
  SELECT
    CASE
      WHEN lower(btrim(coalesce(pr.gender, ''))) = 'male'   THEN 'Male'
      WHEN lower(btrim(coalesce(pr.gender, ''))) = 'female' THEN 'Female'
      WHEN lower(btrim(coalesce(pr.gender, ''))) IN ('other', 'non-binary', 'nonbinary') THEN 'Other'
      ELSE 'Unspecified'
    END::text AS gender,
    COUNT(*)::bigint AS count
  FROM public.profiles pr
  WHERE pr.role = 'student'
  GROUP BY 1
  ORDER BY 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Close the implicit PUBLIC grant on the privileged surface
-- ---------------------------------------------------------------------------
-- Defence in depth. These already had an explicit ACL naming only
-- postgres/service_role, but revoking PUBLIC makes it impossible for a future
-- GRANT to silently re-open them to anonymous callers.
REVOKE EXECUTE ON FUNCTION public.get_payment_configuration() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_students_by_gender() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_premium_admin_configuration() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_analytics_dashboard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_storage_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_payment_requests(text, text, uuid, date, date, integer, integer) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5. Public read surface: aggregates, published content, counters
-- ---------------------------------------------------------------------------
-- Safe for anonymous visitors. Nothing here returns a person, an account
-- number, or a capability.

GRANT EXECUTE ON FUNCTION public.count_materials_by_department() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_materials_by_faculty() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_help_catalog() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_library_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_maintenance_status() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_premium_public_configuration() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_repository_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_research_item_detail(p_item_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_semester_calendar() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_download_count(material_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_research_downloads(p_item_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_research_views(p_item_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_view_count(material_id uuid) TO anon, authenticated;
-- register_identity_check() is intentionally anon-callable: it runs before the
-- account exists, so there is no session to authorise against, and the signup
-- form needs it to reject a taken username or email without a round trip
-- through GoTrue. It does confirm whether an address is already registered,
-- which is a user-enumeration oracle. That is accepted here because the
-- constraint is enforced anyway during signUp, so this RPC is a UX shortcut and
-- not the thing standing between an attacker and a duplicate account. If
-- enumeration ever needs to be closed, the fix is to drop this RPC and let
-- signUp fail on the unique constraint, not to bolt rate limiting onto it.
GRANT EXECUTE ON FUNCTION public.register_identity_check(p_username text, p_email text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_research_items(p_query text, p_type text, p_department_id uuid, p_faculty_id uuid, p_year text, p_limit integer, p_offset integer) TO anon, authenticated;
-- Identity-scoped reads and writes, pinned to `auth.uid()`.
GRANT EXECUTE ON FUNCTION public.cleanup_stale_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_analytics_session(p_session_key text, p_ended_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_bookmark_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_storage_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(p_other_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_premium_source() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_verification_reason() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_verification_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_reading_progress(p_material_id uuid, p_research_item_id uuid, p_page integer, p_total integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_students(p_query text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(p_conversation_id uuid, p_body text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.terminate_other_sessions(p_session_key text) TO authenticated;

-- Session-scoped configuration. `get_payment_configuration()` returns the manual
-- transfer account number, so it stays behind authentication even though the
-- surrounding settings are otherwise public.
GRANT EXECUTE ON FUNCTION public.get_payment_configuration() TO authenticated;

-- Analytics and demographics. Guarded by `public.assert_view_analytics()` or
-- `public.is_admin()`. `count_students_by_gender()` was the one exception and is
-- now guarded as well (see section 3).
GRANT EXECUTE ON FUNCTION public.admin_search_insights(p_days integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_students_by_gender() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_material_status_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_analytics_events(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_materials(p_limit integer, p_days integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_analytics_data(p_older_than_days integer) TO authenticated;

-- Academic administration. Guarded by `public.is_admin()`.
GRANT EXECUTE ON FUNCTION public.admin_delete_academic_session(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_course(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_course(p_faculty text, p_department text, p_course_code text, p_course_title text, p_level text, p_semester text, p_credit_units integer, p_is_general_course boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_active_academic_session(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_academic_session(p_name text, p_label text, p_is_active boolean, p_starts_on date, p_ends_on date) TO authenticated;

-- Verification, plan and payment administration. Guarded by
-- `public.is_super_admin()`.
GRANT EXECUTE ON FUNCTION public.admin_apply_profile_change(p_request_id uuid, p_admin_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_plan(p_user_id uuid, p_plan_slug text, p_days integer, p_admin_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_payment_requests(p_query text, p_status text, p_plan_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_verification(p_request_id uuid, p_approve boolean, p_reviewer_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_plan(p_user_id uuid, p_admin_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_plan_students(p_query text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_payment_request(p_request_id uuid, p_decision text, p_rejection_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_payment_configuration(p_configuration jsonb, p_plan_slug text, p_price_kobo integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_verification(p_student_note text, p_evidence_path text, p_evidence_name text) TO authenticated;

-- Platform configuration and communications. Guarded by
-- `public.is_super_admin()`.
GRANT EXECUTE ON FUNCTION public.delete_announcement(p_announcement_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_premium_admin_configuration() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_announcement(p_title text, p_body text, p_announcement_type text, p_audience text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_global_premium_grant(p_enabled boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_maintenance_mode(p_enabled boolean, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_premium_feature_enabled(p_feature_key text, p_enabled boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_premium_system_enabled(p_enabled boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_semester_calendar(p_value jsonb) TO authenticated;

-- Admin account administration. Guarded by `public.is_super_admin()`.
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(p_user_id uuid, p_active boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_verified(p_user_id uuid, p_verified boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_invite(invite_email text, invite_full_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.demote_admin(target_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_to_admin(target_user_id uuid, admin_permissions text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_active(target_user_id uuid, active boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_details(target_user_id uuid, new_full_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_permissions(target_user_id uuid, admin_permissions text[]) TO authenticated;

-- Student self-service payment submission. Guarded by `auth.uid()`.
GRANT EXECUTE ON FUNCTION public.submit_payment_request(p_plan_slug text, p_receipt_path text, p_payment_reference text, p_payment_date date, p_submitted_amount_kobo integer, p_payment_method text) TO authenticated;

-- UNCLASSIFIED, review needed:
-- GRANT EXECUTE ON FUNCTION public.count_materials_by_department() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.count_materials_by_faculty() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_help_catalog() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_library_stats() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_maintenance_status() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_premium_public_configuration() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_public_stats() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_repository_stats() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_research_item_detail(p_item_id uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_semester_calendar() TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_download_count(material_id uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_research_downloads(p_item_id uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_research_views(p_item_id uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.increment_view_count(material_id uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.register_identity_check(p_username text, p_email text) TO authenticated;
-- GRANT EXECUTE ON FUNCTION public.search_research_items(p_query text, p_type text, p_department_id uuid, p_faculty_id uuid, p_year text, p_limit integer, p_offset integer) TO authenticated;


-- ---------------------------------------------------------------------------
-- 7. Assert the result rather than trusting the migration ran
-- ---------------------------------------------------------------------------
-- Fails loudly if any of the above silently failed to bind, which is the exact
-- failure mode that produced the original incident: a migration applied
-- cleanly while the function it referenced had a different signature.
DO $$
DECLARE
  v_expected text[] := ARRAY[
    'get_premium_admin_configuration','admin_list_payment_requests','admin_search_plan_students',
    'get_public_stats','count_students_by_gender','get_payment_configuration','get_analytics_dashboard',
    'get_premium_public_configuration','get_help_catalog','get_repository_stats','search_students',
    'set_premium_system_enabled','promote_to_admin','review_payment_request','get_research_item_detail'
  ];
  v_missing text[];
BEGIN
  SELECT array_agg(f.proname ORDER BY f.proname)
    INTO v_missing
  FROM unnest(v_expected) AS e(name)
  JOIN pg_proc f ON f.proname = e.name
  JOIN pg_namespace ns ON ns.oid = f.pronamespace AND ns.nspname = 'public'
  WHERE NOT EXISTS (
    SELECT 1 FROM aclexplode(f.proacl) a
     WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
       AND a.privilege_type = 'EXECUTE'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated EXECUTE still missing for: %', v_missing;
  END IF;
END;
$$;
