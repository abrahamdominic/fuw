-- Migration: Grant EXECUTE on RLS security definer helper functions to authenticated and anon
-- Fixes permission denied for function is_admin and has_permission during RLS evaluation

BEGIN;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_premium_access() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_premium_feature(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.my_is_active() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.my_stored_role() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.premium_system_enabled() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.premium_feature_enabled(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.my_verified() TO authenticated, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
