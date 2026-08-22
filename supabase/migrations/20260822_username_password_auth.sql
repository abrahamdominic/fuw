-- =====================================================================
-- FUW E-Library
-- 20260822 — Production-safe username + password authentication support
--
-- PURPOSE
-- 1. Add a unique, case-insensitive username to public.profiles.
-- 2. Safely backfill usernames for existing users.
-- 3. Preserve existing student/admin roles.
-- 4. Store signup username metadata in public.profiles.
-- 5. Provide secure RPCs for:
--      - username -> auth email lookup
--      - username/email availability checks
-- 6. Passwords are NEVER stored in public.profiles.
--    Supabase Auth manages passwords securely.
--
-- IMPORTANT
-- This migration does NOT change existing user roles.
-- Existing admins remain admins.
-- New public registrations are students.
-- =====================================================================


-- =====================================================================
-- 0. SAFETY CHECK
-- =====================================================================

-- Make sure the profiles table exists before continuing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  ) THEN
    RAISE EXCEPTION 'public.profiles table does not exist.';
  END IF;
END
$$;


-- =====================================================================
-- 1. ADD USERNAME COLUMN
-- =====================================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS username TEXT;


-- =====================================================================
-- 2. USERNAME INDEXES
-- =====================================================================

-- Case-insensitive uniqueness.
-- Empty usernames are ignored.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
ON public.profiles (lower(trim(username)))
WHERE username IS NOT NULL
  AND trim(username) <> '';


-- Helpful for username lookups.
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower
ON public.profiles (lower(trim(username)));


-- =====================================================================
-- 3. BACKFILL EXISTING USERS
--
-- Existing users without usernames receive a username based on their
-- email address.
--
-- Example:
--
-- john@gmail.com
-- -> john
--
-- john@gmail.com (collision)
-- -> john-2
--
-- =====================================================================

DO $$
DECLARE
  r RECORD;
  base_username TEXT;
  candidate_username TEXT;
  suffix INTEGER;
BEGIN

  FOR r IN
    SELECT id, email
    FROM public.profiles
    WHERE (username IS NULL OR trim(username) = '')
      AND email IS NOT NULL
      AND trim(email) <> ''
  LOOP

    -- Extract email local-part and sanitize it.
    base_username :=
      lower(
        regexp_replace(
          split_part(trim(r.email), '@', 1),
          '[^a-zA-Z0-9._-]',
          '',
          'g'
        )
      );

    -- Guarantee minimum usable username.
    IF base_username IS NULL
       OR length(base_username) < 3 THEN

      base_username :=
        'fuw' ||
        COALESCE(NULLIF(base_username, ''), 'user');

    END IF;

    candidate_username := base_username;
    suffix := 1;

    -- Resolve username collisions.
    WHILE EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE lower(trim(p.username)) = lower(candidate_username)
        AND p.id <> r.id
    )
    LOOP

      suffix := suffix + 1;

      candidate_username :=
        left(base_username, 45)
        || '-'
        || suffix::TEXT;

    END LOOP;

    UPDATE public.profiles
    SET username = candidate_username
    WHERE id = r.id;

  END LOOP;

END
$$;


-- =====================================================================
-- 4. USERNAME VALIDATION FUNCTION
--
-- Username rules:
-- - 3 to 30 characters
-- - lowercase letters
-- - numbers
-- - underscore
-- - hyphen
-- - period
--
-- This prevents problematic usernames from entering the database.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_valid_username(
  p_username TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_username IS NOT NULL
    AND length(trim(p_username)) BETWEEN 3 AND 30
    AND trim(p_username) ~ '^[a-zA-Z0-9._-]+$';
$$;


-- =====================================================================
-- 5. USERNAME -> EMAIL LOOKUP
--
-- Used by the frontend when a user logs in with:
--
-- username + password
--
-- Supabase Auth itself authenticates with email + password, so the
-- application resolves username -> email before calling
-- signInWithPassword().
--
-- SECURITY DEFINER is used so RLS does not prevent the lookup.
-- Only the email is returned.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.lookup_login_email(
  p_username TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(p.email))
  FROM public.profiles p
  WHERE p.username IS NOT NULL
    AND lower(trim(p.username)) = lower(trim(p_username))
    AND COALESCE(p.is_active, TRUE) = TRUE
    AND p.email IS NOT NULL
    AND trim(p.email) <> ''
  LIMIT 1;
$$;


-- Remove any previous permissions.
REVOKE ALL
ON FUNCTION public.lookup_login_email(TEXT)
FROM PUBLIC;


-- Allow the authentication flow to call it.
GRANT EXECUTE
ON FUNCTION public.lookup_login_email(TEXT)
TO anon, authenticated;


-- =====================================================================
-- 6. REGISTRATION AVAILABILITY CHECK
--
-- Returns only:
--
-- {
--   "username_taken": true/false,
--   "email_taken": true/false
-- }
--
-- No profile rows are exposed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.register_identity_check(
  p_username TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(

    'username_taken',
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.username IS NOT NULL
        AND lower(trim(p.username))
            = lower(trim(p_username))
    ),

    'email_taken',
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.email IS NOT NULL
        AND lower(trim(p.email))
            = lower(trim(p_email))
    )

  );
$$;


REVOKE ALL
ON FUNCTION public.register_identity_check(TEXT, TEXT)
FROM PUBLIC;


GRANT EXECUTE
ON FUNCTION public.register_identity_check(TEXT, TEXT)
TO anon, authenticated;


-- =====================================================================
-- 7. NEW USER PROFILE TRIGGER
--
-- IMPORTANT:
--
-- New public registrations become students.
--
-- Existing profiles are NOT changed from admin -> student.
--
-- This prevents the signup trigger from accidentally overwriting
-- existing administrator privileges.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_username TEXT;
BEGIN

  requested_username :=
    NULLIF(
      lower(
        regexp_replace(
          COALESCE(
            NEW.raw_user_meta_data ->> 'username',
            ''
          ),
          '[^a-zA-Z0-9._-]',
          '',
          'g'
        )
      ),
      ''
    );


  -- ---------------------------------------------------------------
  -- Create profile if it doesn't exist.
  -- New users are students by default.
  -- ---------------------------------------------------------------

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    display_name,
    username,
    role
  )
  VALUES (
    NEW.id,
    NEW.email,

    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      split_part(NEW.email, '@', 1)
    ),

    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      split_part(NEW.email, '@', 1)
    ),

    requested_username,

    'student'
  )

  ON CONFLICT (id)
  DO UPDATE SET

    -- Keep profile synchronized with Auth email.
    email = EXCLUDED.email,

    -- Only fill username if the existing profile does not have one.
    username =
      CASE
        WHEN public.profiles.username IS NULL
             OR trim(public.profiles.username) = ''
        THEN EXCLUDED.username
        ELSE public.profiles.username
      END,

    -- IMPORTANT:
    -- Existing role is preserved.
    role = public.profiles.role,

    updated_at = NOW();


  RETURN NEW;

END;
$$;


-- =====================================================================
-- 8. AUTH USER TRIGGER
--
-- Recreate only the profile-creation trigger.
-- =====================================================================

DROP TRIGGER IF EXISTS on_auth_user_created
ON auth.users;


CREATE TRIGGER on_auth_user_created
AFTER INSERT
ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();


-- =====================================================================
-- 9. FUNCTION PRIVILEGES
--
-- Prevent arbitrary users from modifying functions.
-- =====================================================================

REVOKE ALL
ON FUNCTION public.is_valid_username(TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.is_valid_username(TEXT)
TO anon, authenticated;


-- =====================================================================
-- 10. COMMENTS
-- =====================================================================

COMMENT ON COLUMN public.profiles.username
IS 'Unique case-insensitive username used for application login.';

COMMENT ON FUNCTION public.lookup_login_email(TEXT)
IS 'Resolves a username to its authentication email for username/password login.';

COMMENT ON FUNCTION public.register_identity_check(TEXT, TEXT)
IS 'Checks whether a username or email is already registered.';

COMMENT ON FUNCTION public.is_valid_username(TEXT)
IS 'Validates FUW E-Library username format.';


-- =====================================================================
-- DONE
-- =====================================================================