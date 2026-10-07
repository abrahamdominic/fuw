-- Migration: Add verify_account_for_reset RPC function
-- Allows safe pre-check for password reset without exposing any sensitive profile, user, or auth details.

CREATE OR REPLACE FUNCTION public.verify_account_for_reset(p_identifier text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean text;
  v_exists boolean;
BEGIN
  v_clean := lower(trim(p_identifier));
  IF v_clean = '' THEN
    RETURN false;
  END IF;

  -- Check profiles by email or username, and auth.users by email
  SELECT (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE (lower(trim(email)) = v_clean OR lower(trim(username)) = v_clean)
        AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE lower(trim(email)) = v_clean
    )
  ) INTO v_exists;

  RETURN COALESCE(v_exists, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_account_for_reset(text) TO anon, authenticated;
COMMENT ON FUNCTION public.verify_account_for_reset(text) IS 'Checks if an active account exists for the given email or username before initiating password reset.';
