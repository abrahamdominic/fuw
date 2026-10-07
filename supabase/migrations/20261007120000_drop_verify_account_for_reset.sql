-- Migration: Drop verify_account_for_reset RPC function
-- ASVS 2.1.12 / CWE-204 Remediation: Eliminate account enumeration oracle.
-- Password reset flows must respond neutrally regardless of whether an account exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'verify_account_for_reset') THEN
    REVOKE EXECUTE ON FUNCTION public.verify_account_for_reset(text) FROM anon, authenticated;
    DROP FUNCTION IF EXISTS public.verify_account_for_reset(text);
  END IF;
END $$;
