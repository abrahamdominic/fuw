-- =====================================================================
-- FUW E-Library
-- 20260823 — Repair public.profiles.role column type (text -> app_role)
--
-- WHY THIS EXISTS
-- Running 20260822_upgrade_rbac_ai.sql on databases where profiles.role
-- was created as plain TEXT failed with:
--
--   ERROR: 42P13: return type mismatch in function declared to return
--   app_role  DETAIL: Actual return type is text.
--   CONTEXT: SQL function "my_stored_role"
--
-- Root causes handled here:
--   a) The old conversion block swallowed its own exceptions, leaving
--      the column as TEXT while later objects expected app_role.
--   b) PostgreSQL forbids USING a value added by "ALTER TYPE ... ADD
--      VALUE" within the same transaction (unless the type itself was
--      created in that transaction). This script therefore RECREATES
--      the enum when labels are missing and nothing depends on it.
--
-- WHAT THIS SCRIPT DOES (idempotent — safe to run repeatedly)
--   1. Ensures public.app_role exists with all three labels
--      (student | admin | super_admin), recreating it when safe.
--   2. Normalizes legacy text values (case variants -> canonical,
--      unknown -> student). Existing admins/super admins are preserved.
--   3. Converts the column to app_role, restoring a 'student' default.
--   4. VERIFIES the result loudly instead of failing quietly later.
--
-- Existing roles are preserved. No passwords or auth data are touched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Ensure the enum type exists WITH every label we need.
--    NOTE: we intentionally avoid ALTER TYPE ... ADD VALUE here because
--    a value added inside this transaction could not be used by the
--    conversion below (PostgreSQL "unsafe use of new value" rule).
--    Recreating is only permitted when nothing depends on the type yet
--    (true whenever profiles.role is still plain text).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  type_oid  OID;
  labels    TEXT[];
  dep_count BIGINT;
BEGIN
  SELECT oid INTO type_oid FROM pg_type WHERE typname = 'app_role';

  IF type_oid IS NULL THEN
    CREATE TYPE public.app_role AS ENUM ('student', 'admin', 'super_admin');
    RAISE NOTICE 'Created enum public.app_role.';
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(e.enumlabel ORDER BY e.enumlabel), '{}')
    INTO labels
  FROM pg_enum e
  WHERE e.enumtypid = type_oid;

  IF 'student' = ANY(labels) AND 'admin' = ANY(labels) AND 'super_admin' = ANY(labels) THEN
    RAISE NOTICE 'Enum public.app_role already has all required labels.';
    RETURN;
  END IF;

  -- Labels missing: recreation is only possible while no object depends
  -- on the type. A text-typed profiles.role guarantees exactly that.
  -- (Normal dependencies, e.g. a table column bound to this type.)
  SELECT COUNT(*) INTO dep_count
  FROM pg_depend
  WHERE refclassid = 'pg_type'::regclass
    AND refobjid = type_oid
    AND deptype = 'n';

  IF dep_count > 0 THEN
    RAISE EXCEPTION
      'Enum public.app_role is missing labels (%) but is still referenced by % object(s). Run this statement on its own, outside a transaction: ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS ''super_admin'';',
      array_to_string(labels, ', '), dep_count;
  END IF;

  DROP TYPE public.app_role;
  CREATE TYPE public.app_role AS ENUM ('student', 'admin', 'super_admin');
  RAISE NOTICE 'Recreated enum public.app_role with all three labels.';
END $$;

-- ---------------------------------------------------------------------
-- 1. Convert the column when (and only when) it is not app_role yet.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  col_type TEXT;
BEGIN
  -- Physical type straight from the catalog (no name-matching games).
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO col_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'profiles'
    AND a.attname = 'role'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'Column public.profiles.role was not found.';
  END IF;

  RAISE NOTICE 'profiles.role currently has type: %', col_type;

  IF col_type = 'app_role' THEN
    RAISE NOTICE 'profiles.role is already app_role — checking values only.';

    -- Still sanitize any unexpected labels (defensive, cheap).
    UPDATE public.profiles SET role = 'student'
     WHERE role IS NULL;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------
  -- Step A: normalize values that cannot map onto the enum.
  -- Case-insensitive matches map to their canonical label;
  -- anything unrecognized becomes 'student'. Admins preserved.
  -- ---------------------------------------------------------------
  UPDATE public.profiles
     SET role = CASE lower(trim(role))
                  WHEN 'admin'       THEN 'admin'
                  WHEN 'super_admin' THEN 'super_admin'
                  ELSE 'student'
                END
   WHERE role IS NOT NULL
     AND lower(trim(role)) NOT IN ('student', 'admin', 'super_admin');

  UPDATE public.profiles SET role = 'student' WHERE role IS NULL;

  -- ---------------------------------------------------------------
  -- Step B0: RLS policies that reference `role` BLOCK the column type
  -- change ("cannot alter type of a column used in a policy
  -- definition"). This includes policies on OTHER tables (e.g. legacy
  -- materials policies querying profiles.role), so scan the whole
  -- public schema — not just profiles.
  --
  -- Everything dropped here is recreated afterwards:
  --   - profiles      -> baseline policies in step 1.5 below
  --   - everything else -> by 20260822_upgrade_rbac_ai.sql sections 11-15
  -- Run this script and the RBAC migration back-to-back.
  -- ---------------------------------------------------------------
  DECLARE
    pol RECORD;
  BEGIN
    FOR pol IN
      SELECT schemaname, tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND (
             COALESCE(qual, '')        ~* '\mrole\M'
          OR COALESCE(with_check, '')  ~* '\mrole\M'
          OR COALESCE(qual, '')        ILIKE '%profiles%'
          OR COALESCE(with_check, '')  ILIKE '%profiles%'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
      RAISE NOTICE 'Dropped RLS policy "%" on %.% (referenced role/profiles; recreated by later steps).', pol.policyname, pol.schemaname, pol.tablename;
    END LOOP;
  END;

  -- ---------------------------------------------------------------
  -- Step B: the actual conversion. Failures propagate LOUDLY (no
  -- swallowing) so a blocking object is identified immediately.
  -- ---------------------------------------------------------------
  EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT';
  EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role';
  EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT ''student''';

  RAISE NOTICE 'Converted profiles.role from % to app_role.', col_type;
END $$;

-- ---------------------------------------------------------------------
-- 1.5 Recreate BASELINE policies so the table stays protected even if
-- the full RBAC migration is not run right after. Uses the classic
-- schema.sql definitions; the RBAC migration replaces these with
-- stricter versions (role/is_active/permissions preservation).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  ) THEN
    RAISE NOTICE 'Helper function public.is_admin() not found — skipping baseline policies. Run 20260822_upgrade_rbac_ai.sql NEXT to restore RLS protection.';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles';
  EXECUTE 'CREATE POLICY "profiles_select_policy" ON public.profiles
             FOR SELECT USING (id = auth.uid() OR public.is_admin())';

  EXECUTE 'DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles';
  EXECUTE 'CREATE POLICY "profiles_insert_policy" ON public.profiles
             FOR INSERT TO authenticated WITH CHECK (id = auth.uid())';

  EXECUTE 'DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles';
  EXECUTE 'CREATE POLICY "profiles_update_policy" ON public.profiles
             FOR UPDATE TO authenticated
             USING (id = auth.uid() OR public.is_admin())
             WITH CHECK (
               public.is_admin()
               OR (
                 id = auth.uid()
                 AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
               )
             )';

  RAISE NOTICE 'Baseline profiles RLS policies recreated.';
END $$;

-- ---------------------------------------------------------------------
-- 2. HARD VERIFICATION — never continue with a half-fixed state.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  final_type TEXT;
  invalid_rows BIGINT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO final_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'profiles'
    AND a.attname = 'role'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF final_type <> 'app_role' THEN
    RAISE EXCEPTION
      'FAILED: public.profiles.role is still "%" (expected app_role). Something blocked ALTER TABLE — check views/generated columns referencing profiles.role.',
      final_type;
  END IF;

  SELECT COUNT(*) INTO invalid_rows FROM public.profiles WHERE role IS NULL;
  IF invalid_rows > 0 THEN
    RAISE EXCEPTION 'FAILED: % profile row(s) still hold a NULL role.', invalid_rows;
  END IF;

  RAISE NOTICE 'VERIFIED: public.profiles.role is app_role with valid values.';
  RAISE NOTICE 'NEXT STEP: run supabase/migrations/20260822_upgrade_rbac_ai.sql now to restore all RLS policies and grants.';
END $$;
