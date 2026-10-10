-- Migration: 20261010123000_fix_seeded_auth_identities.sql
-- Description:
--   Repair SQL-seeded test/provider accounts so GoTrue password login works.
--   Two issues were found empir몇rically (verified against the live backend):
--     1. Missing auth.identities rows. Newer GoTrue resolves sign-in through
--        identities; rows inserted directly into auth.users without one made
--        the token endpoint return 500.
--     2. NULL one-time token columns (confirmation_token, recovery_token,
--        email_change, email_change_token_new, etc.). GoTrue-created users
--        store '' / 0, and NULL values reproduce the same 500
--        "Database error querying schema" (proved by toggling one column at a
--        time on a working GoTrue-created user).
--   The 500 surfaced in the app as the misleading "registration could not be
--   completed" error because authErrors maps "database error" to that message.
--   Idempotent: only inserts missing identities and only touches the seeded
--   accounts.

BEGIN;

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT au.id::text,
       au.id,
       jsonb_build_object(
         'sub', au.id::text,
         'email', au.email,
         'email_verified', true,
         'phone_verified', false,
         'username', au.raw_user_meta_data ->> 'username',
         'full_name', au.raw_user_meta_data ->> 'full_name',
         'display_name', au.raw_user_meta_data ->> 'display_name'
       ),
       'email',
       au.email_confirmed_at,
       au.created_at,
       au.created_at
FROM auth.users au
WHERE au.email IN (
  'landlord.test@fuw.edu.ng',
  'caretaker.test@fuw.edu.ng',
  'admin.test@fuw.edu.ng'
)
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = au.id AND i.provider = 'email'
  );

UPDATE auth.users
SET confirmation_token        = '',
    recovery_token           = '',
    email_change             = '',
    email_change_token_new   = '',
    phone_change_token       = '',
    reauthentication_token   = '',
    email_change_confirm_status = COALESCE(email_change_confirm_status, 0)
WHERE email IN (
  'landlord.test@fuw.edu.ng',
  'caretaker.test@fuw.edu.ng',
  'admin.test@fuw.edu.ng'
);

COMMIT;