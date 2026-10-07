-- Admin platform statistics RPCs for dashboard
-- Guarded by assert_view_analytics() and only granted to authenticated

CREATE OR REPLACE FUNCTION public.count_students_pending_approval()
RETURNS TABLE(pending_approval_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_view_analytics();
  RETURN QUERY
  SELECT COUNT(*)::bigint
  FROM public.profiles
  WHERE role = 'student'
    AND (verification_status IN ('submitted', 'pending')
         OR (verification_status IS NULL AND verified IS FALSE));
END;
$$;

CREATE OR REPLACE FUNCTION public.count_students_total_registered()
RETURNS TABLE(total_registered bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_view_analytics();
  RETURN QUERY
  SELECT COUNT(*) FILTER (WHERE role = 'student')::bigint
  FROM public.profiles;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_students_verified()
RETURNS TABLE(verified_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_view_analytics();
  RETURN QUERY
  SELECT COUNT(*) FILTER (
           WHERE role = 'student'
             AND (verified IS TRUE OR verification_status = 'verified')
         )::bigint
  FROM public.profiles;
END;
$$;

-- Revoke from public/anon and grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.count_students_pending_approval() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_students_total_registered() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_students_verified() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.count_students_pending_approval() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_students_total_registered() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_students_verified() TO authenticated;
