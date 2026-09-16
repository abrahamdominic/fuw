-- ==============================================================================
-- FUW E-Library — RESTORE WORKING REGISTRATION IDENTITY PRE-CHECK (2026-09-20)
--
-- REGRESSION
--   20260829_security_hardening.sql converted register_identity_check() from
--   SECURITY DEFINER to SECURITY INVOKER to stop anonymous account enumeration
--   (AUTH-02). That change made the pre-auth duplicate check NON-FUNCTIONAL:
--   anon has no RLS SELECT on profiles, so under SECURITY INVOKER the function
--   always returns { username_taken:false, email_taken:false } — even for
--   identities that are already registered.
--
--   CONSEQUENCE: registering with an already-taken username (and a different
--   email) sails past the broken pre-check, then the handle_new_user() trigger
--   INSERT collides with profiles_username_unique_idx inside the auth.users
--   AFTER INSERT trigger. The whole signup transaction rolls back and Supabase
--   Auth returns HTTP 500 "Database error saving new user", which the app maps
--   to the generic "The request could not be completed. Please try again."
--
-- FIX
--   Restore the function to SECURITY DEFINER (the original, correct design for
--   THIS function) so the pre-authentication registration form can once again
--   check username/email availability. It returns ONLY two booleans — never a
--   row, email, or any auth data — and is STABLE/read-only with a pinned
--   search_path, so it exposes no more than a standard registration availability
--   check. lookup_login_email stays dropped (that one returned real emails and
--   is a genuine enumeration oracle).
--
-- SAFETY
--   * Function is read-only and returns booleans only.
--   * No anon table access is granted — RLS remains fully enabled.
--   * Idempotent; safe to re-run.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_identity_check(
  p_username text,
  p_email text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'username_taken', EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.username IS NOT NULL
        AND lower(trim(p.username)) = lower(trim(p_username))
    ),
    'email_taken', EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.email IS NOT NULL
        AND lower(p.email) = lower(trim(p_email))
    )
  );
$$;

-- Explicit grants: anon (pre-auth registration), authenticated, service_role.
REVOKE ALL ON FUNCTION public.register_identity_check(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_identity_check(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.register_identity_check(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_identity_check(text, text) TO service_role;

COMMENT ON FUNCTION public.register_identity_check(text, text) IS
  'Pre-registration username/email availability check. SECURITY DEFINER + STABLE so '
  'the unauthenticated registration form can detect duplicates. Returns two booleans '
  'only; never exposes profile rows or auth data.';

COMMIT;