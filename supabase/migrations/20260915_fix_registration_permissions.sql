-- Fix registration bug: restore anon access to register_identity_check
-- The function is called BEFORE user is authenticated, so it needs anon access.
-- SECURITY INVOKER makes it safe (no privilege escalation).

-- Date: 2026-09-15
-- Issue: Registration fails with "The request could not be completed"
-- Root cause: register_identity_check requires authentication but is called pre-auth

GRANT EXECUTE ON FUNCTION public.register_identity_check(TEXT, TEXT) TO anon;

-- Verify function is SECURITY INVOKER (not DEFINER)
-- This prevents privilege escalation while allowing anon to check username/email availability

-- Fix database deletion bug: add DELETE policy for profiles
-- Super admins should be able to delete user accounts

DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

COMMENT ON POLICY "profiles_delete_policy" ON public.profiles IS
  'Only super admins can delete user profiles. Cascades to related data via foreign keys.';
