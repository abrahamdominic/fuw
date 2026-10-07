-- Migration: Grant EXECUTE on marketplace RLS helper functions to authenticated and anon
-- These functions are STABLE SECURITY DEFINER helper predicates called in RLS policies.
-- They return FALSE when auth.uid() is NULL or the condition is not met.

BEGIN;

GRANT EXECUTE ON FUNCTION public.mp_has_perm(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_is_admin(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_is_staff(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_is_vendor(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_is_vendor_owner(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_order_visible(uuid, uuid) TO authenticated, anon;

COMMIT;
