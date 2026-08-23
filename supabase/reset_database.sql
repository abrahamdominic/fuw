-- =====================================================================
-- FUW E-Library — FULL DATABASE RESET
-- =====================================================================
-- PURPOSE
--   Completely removes every object created for the FUW E-Library so the
--   schema can be rebuilt from scratch with
--   supabase/migrations/20260824_rebuild_full_schema.sql.
--
-- WHAT IS REMOVED
--   * All rows + table structures: profiles, materials, notifications,
--     admin_invites, ai_conversations, ai_messages, ai_processing_jobs,
--     material_chunks, plus the academic catalogue tables
--     faculties / departments / levels / courses.
--   * Every RLS policy on those tables plus legacy storage policies.
--     Bucket/file removal is best-effort: newer Supabase projects guard
--     direct storage deletes, in which case the existing bucket is
--     reused harmlessly by the rebuild script.
--   * All E-Library triggers/functions (incl. hooks on auth.users).
--   * The app_role / material_status / material_type enums once
--     unreferenced.
--
-- WHAT IS PRESERVED
--   * Supabase Auth infrastructure (auth.users accounts stay intact).
--   * Extensions (pgcrypto / pgvector) and any UNRELATED tables/policies
--     in your project.
--
-- SAFETY
--   Idempotent: safe to run multiple times. Dependency-safe ordering:
--   triggers -> policies -> tables -> functions -> enums -> storage.
--   Every step uses IF EXISTS; CASCADE only where required.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Remove E-Library triggers attached to auth.users FIRST (they pin
--    their handler functions, which we drop later).
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_login_touch ON auth.users;

-- ---------------------------------------------------------------------
-- 2. Remove every RLS policy on E-Library tables (dynamic — catches
--    legacy policies with arbitrary names, e.g. duplicates left by
--    older migrations).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles', 'materials', 'notifications', 'admin_invites',
        'ai_conversations', 'ai_messages', 'ai_processing_jobs',
        'material_chunks', 'faculties', 'departments', 'levels', 'courses'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;

-- Legacy storage policies tied to the library-materials bucket.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        policyname IN (
          'Public read storage', 'Authenticated upload storage', 'Owner delete storage',
          'library-materials public read', 'library-materials authenticated upload',
          'library-materials owner update', 'library-materials owner delete'
        )
        OR COALESCE(qual, '')       LIKE '%library-materials%'
        OR COALESCE(with_check, '') LIKE '%library-materials%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
    RAISE NOTICE 'Dropped storage policy %', pol.policyname;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Drop E-Library tables (children first; CASCADE clears surviving
--    FK edges such as profiles self-references).
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.material_chunks    CASCADE;
DROP TABLE IF EXISTS public.ai_processing_jobs CASCADE;
DROP TABLE IF EXISTS public.ai_messages        CASCADE;
DROP TABLE IF EXISTS public.ai_conversations   CASCADE;
DROP TABLE IF EXISTS public.admin_invites      CASCADE;
DROP TABLE IF EXISTS public.notifications      CASCADE;
DROP TABLE IF EXISTS public.materials          CASCADE;
DROP TABLE IF EXISTS public.profiles           CASCADE;
-- Academic catalogue (courses -> departments -> faculties; levels independent)
DROP TABLE IF EXISTS public.courses            CASCADE;
DROP TABLE IF EXISTS public.departments        CASCADE;
DROP TABLE IF EXISTS public.faculties          CASCADE;
DROP TABLE IF EXISTS public.levels             CASCADE;

-- ---------------------------------------------------------------------
-- 4. Drop every E-Library function/RPC. Explicitly enumerated so any
--    UNRELATED functions in your project are never touched.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.touch_last_login() CASCADE;
DROP FUNCTION IF EXISTS public.apply_admin_invite_on_signup() CASCADE;
DROP FUNCTION IF EXISTS public.sync_material_catalogue() CASCADE;
DROP FUNCTION IF EXISTS public.handle_material_deleted() CASCADE;

DROP FUNCTION IF EXISTS public.is_valid_username(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.lookup_login_email(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.register_identity_check(TEXT, TEXT) CASCADE;

DROP FUNCTION IF EXISTS public.my_stored_role() CASCADE;
DROP FUNCTION IF EXISTS public.my_is_active() CASCADE;
DROP FUNCTION IF EXISTS public.my_permissions() CASCADE;
DROP FUNCTION IF EXISTS public.is_super_admin() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.has_permission(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_public_stats() CASCADE;
DROP FUNCTION IF EXISTS public.get_library_stats() CASCADE;
DROP FUNCTION IF EXISTS public.get_material_status_counts() CASCADE;

DROP FUNCTION IF EXISTS public.promote_first_super_admin(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.promote_to_admin(UUID, TEXT[]) CASCADE;
DROP FUNCTION IF EXISTS public.demote_admin(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.set_admin_active(UUID, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.update_admin_permissions(UUID, TEXT[]) CASCADE;
DROP FUNCTION IF EXISTS public.update_admin_details(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_admin_invite(TEXT, TEXT) CASCADE;

DROP FUNCTION IF EXISTS public.approve_material_rpc(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.reject_material_rpc(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.notify_material_deleted(TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.increment_download_count(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.increment_view_count(UUID) CASCADE;

-- pgvector-dependent function: only exists/droppable when the extension
-- is installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    DROP FUNCTION IF EXISTS public.match_material_chunks(VECTOR, INTEGER, UUID, TEXT, TEXT, TEXT) CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'match_material_chunks cleanup skipped: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------
-- 5. Drop the custom enums once nothing references them anymore.
--    If something still depends on them we keep them and say so loudly
--    instead of cascading into unknown objects.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  oid OID; deps BIGINT;
BEGIN
  SELECT t.oid INTO oid FROM pg_type t WHERE t.typname = 'app_role';
  IF oid IS NOT NULL THEN
    SELECT COUNT(*) INTO deps FROM pg_depend
    WHERE refclassid = 'pg_type'::regclass AND refobjid = oid AND deptype <> 'i';
    IF deps = 0 THEN
      DROP TYPE public.app_role;
      RAISE NOTICE 'Dropped enum app_role.';
    ELSE
      RAISE WARNING 'Kept enum app_role — % dependent object(s) remain.', deps;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  oid OID; deps BIGINT;
BEGIN
  SELECT t.oid INTO oid FROM pg_type t WHERE t.typname = 'material_status';
  IF oid IS NOT NULL THEN
    SELECT COUNT(*) INTO deps FROM pg_depend
    WHERE refclassid = 'pg_type'::regclass AND refobjid = oid AND deptype <> 'i';
    IF deps = 0 THEN
      DROP TYPE public.material_status;
      RAISE NOTICE 'Dropped enum material_status.';
    ELSE
      RAISE WARNING 'Kept enum material_status — % dependent object(s) remain.', deps;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  oid OID; deps BIGINT;
BEGIN
  SELECT t.oid INTO oid FROM pg_type t WHERE t.typname = 'material_type';
  IF oid IS NOT NULL THEN
    SELECT COUNT(*) INTO deps FROM pg_depend
    WHERE refclassid = 'pg_type'::regclass AND refobjid = oid AND deptype <> 'i';
    IF deps = 0 THEN
      DROP TYPE public.material_type;
      RAISE NOTICE 'Dropped enum material_type.';
    ELSE
      RAISE WARNING 'Kept enum material_type — % dependent object(s) remain.', deps;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. Remove the library-materials storage bucket and its files.
--    Newer Supabase projects block DIRECT sql deletes on storage tables
--    (guard trigger: "Use the Storage API instead"). We therefore try,
--    and degrade gracefully when blocked — an existing bucket is reused
--    harmlessly by the rebuild script (ON CONFLICT DO UPDATE).
--    Optional full wipe if SQL is blocked:
--      Dashboard -> Storage -> library-materials -> select all -> delete,
--      then delete the bucket. Purely cosmetic; never required.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  DELETE FROM storage.objects WHERE bucket_id = 'library-materials';
  DELETE FROM storage.buckets  WHERE id         = 'library-materials';
  RAISE NOTICE 'Removed storage bucket library-materials and its objects.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'SQL storage cleanup skipped (guard: %).', SQLERRM;
  RAISE NOTICE 'The existing library-materials bucket will simply be reused by SCRIPT 2.';
END $$;

-- ---------------------------------------------------------------------
-- 7. VERIFICATION — fails loudly if any E-Library object survived.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  leftover BIGINT;
BEGIN
  -- Tables
  SELECT COUNT(*) INTO leftover
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'profiles', 'materials', 'notifications', 'admin_invites',
      'ai_conversations', 'ai_messages', 'ai_processing_jobs', 'material_chunks',
      'faculties', 'departments', 'levels', 'courses'
    );
  IF leftover > 0 THEN
    RAISE EXCEPTION 'RESET INCOMPLETE: % E-Library table(s) still exist.', leftover;
  END IF;

  -- Policies on those tables
  SELECT COUNT(*) INTO leftover
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'profiles', 'materials', 'notifications', 'admin_invites',
      'ai_conversations', 'ai_messages', 'ai_processing_jobs', 'material_chunks',
      'faculties', 'departments', 'levels', 'courses'
    );
  IF leftover > 0 THEN
    RAISE EXCEPTION 'RESET INCOMPLETE: % E-Library RLS policy/polices remain.', leftover;
  END IF;

  -- Functions
  SELECT COUNT(*) INTO leftover
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'handle_new_user','touch_last_login','apply_admin_invite_on_signup','handle_updated_at',
      'sync_material_catalogue','handle_material_deleted',
      'is_valid_username','lookup_login_email','register_identity_check',
      'my_stored_role','my_is_active','my_permissions','is_super_admin','is_admin',
      'has_permission','get_public_stats','get_library_stats','get_material_status_counts',
      'promote_first_super_admin','promote_to_admin','demote_admin',
      'set_admin_active','update_admin_permissions','update_admin_details',
      'create_admin_invite','approve_material_rpc','reject_material_rpc',
      'notify_material_deleted','increment_download_count','increment_view_count'
    );
  IF leftover > 0 THEN
    RAISE EXCEPTION 'RESET INCOMPLETE: % E-Library function(s) remain.', leftover;
  END IF;

  -- Triggers on auth.users
  SELECT COUNT(*) INTO leftover
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth' AND c.relname = 'users'
    AND t.tgname IN ('on_auth_user_created', 'on_auth_login_touch')
    AND NOT t.tgisinternal;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'RESET INCOMPLETE: % E-Library trigger(s) on auth.users remain.', leftover;
  END IF;

  -- Storage bucket (a remaining bucket is fine — SCRIPT 2 reuses it)
  SELECT COUNT(*) INTO leftover
  FROM storage.buckets WHERE id = 'library-materials';
  IF leftover > 0 THEN
    RAISE NOTICE 'NOTE: storage bucket library-materials still exists (Supabase guard). SCRIPT 2 will reuse it.';
  END IF;

  -- Enums (kept enums only produce a WARNING above, never a failure here)
  SELECT COUNT(*) INTO leftover
  FROM pg_type
  WHERE typname IN ('app_role', 'material_status', 'material_type');
  IF leftover > 0 THEN
    RAISE NOTICE 'NOTE: % custom enum(s) were kept because dependencies remained.', leftover;
  END IF;

  RAISE NOTICE 'RESET COMPLETE: FUW E-Library objects fully removed. Auth users, extensions and unrelated resources untouched.';
END $$;
