-- FUW E-Library Database Verification & Testing Script
-- Run this in Supabase SQL Editor to verify database state and test fixes
-- Date: 2026-09-15

-- ============================================================================
-- SECTION 1: CHECK CURRENT PERMISSIONS
-- ============================================================================

SELECT 'Checking register_identity_check permissions...' AS step;

-- Check who can execute register_identity_check
SELECT 
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
  END AS volatility,
  CASE p.prosecdef
    WHEN true THEN 'SECURITY DEFINER'
    ELSE 'SECURITY INVOKER'
  END AS security,
  array_to_string(ARRAY(
    SELECT rolname 
    FROM pg_roles 
    WHERE has_function_privilege(oid, p.oid, 'EXECUTE')
    AND rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
  ), ', ') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'register_identity_check';

-- ============================================================================
-- SECTION 2: CHECK RLS POLICIES ON PROFILES
-- ============================================================================

SELECT 'Checking RLS policies on profiles table...' AS step;

SELECT 
  schemaname,
  tablename,
  policyname,
  CASE cmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
  END AS command,
  roles,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'profiles'
ORDER BY cmd;

-- ============================================================================
-- SECTION 3: CHECK IF DELETE POLICY EXISTS
-- ============================================================================

SELECT 'Checking if DELETE policy exists on profiles...' AS step;

SELECT COUNT(*) AS delete_policy_count
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'profiles'
  AND cmd = 'd'; -- 'd' = DELETE

-- Expected: 0 before fix, 1 after fix

-- ============================================================================
-- SECTION 4: TEST REGISTER_IDENTITY_CHECK AS ANON
-- ============================================================================

SELECT 'Testing register_identity_check with test data...' AS step;

-- This should work after the fix (returns jsonb with username_taken and email_taken)
SELECT public.register_identity_check('testuser123', 'test@example.com') AS check_result;

-- ============================================================================
-- SECTION 5: CHECK HELPER FUNCTIONS FOR PERMISSIONS
-- ============================================================================

SELECT 'Checking permission helper functions...' AS step;

SELECT 
  p.proname AS function_name,
  pg_get_function_result(p.oid) AS returns,
  CASE p.prosecdef
    WHEN true THEN 'SECURITY DEFINER'
    ELSE 'SECURITY INVOKER'
  END AS security
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN (
    'is_super_admin',
    'is_admin', 
    'has_permission',
    'my_stored_role',
    'my_is_active',
    'my_permissions'
  )
ORDER BY p.proname;

-- ============================================================================
-- SECTION 6: VERIFY TABLE STRUCTURE
-- ============================================================================

SELECT 'Verifying profiles table structure...' AS step;

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
ORDER BY ordinal_position;

-- ============================================================================
-- SECTION 7: CHECK CASCADE RELATIONSHIPS
-- ============================================================================

SELECT 'Checking foreign key relationships from profiles...' AS step;

SELECT
  tc.table_name AS referencing_table,
  kcu.column_name AS referencing_column,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column,
  rc.delete_rule,
  rc.update_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'profiles'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- ============================================================================
-- SECTION 8: CHECK MATERIALS TABLE POLICIES
-- ============================================================================

SELECT 'Checking materials table policies...' AS step;

SELECT 
  policyname,
  CASE cmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
  END AS command,
  roles
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'materials'
ORDER BY cmd;

-- ============================================================================
-- SECTION 9: COUNT EXISTING DATA
-- ============================================================================

SELECT 'Counting existing data...' AS step;

SELECT 
  (SELECT COUNT(*) FROM public.profiles) AS total_profiles,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'student') AS students,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin') AS admins,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'super_admin') AS super_admins,
  (SELECT COUNT(*) FROM public.materials) AS total_materials,
  (SELECT COUNT(*) FROM public.materials WHERE status = 'pending') AS pending_materials,
  (SELECT COUNT(*) FROM public.materials WHERE status = 'approved') AS approved_materials,
  (SELECT COUNT(*) FROM public.faculties) AS total_faculties,
  (SELECT COUNT(*) FROM public.departments) AS total_departments,
  (SELECT COUNT(*) FROM public.courses) AS total_courses;

-- ============================================================================
-- SECTION 10: VERIFY MIGRATION APPLIED
-- ============================================================================

SELECT 'Checking migration history...' AS step;

-- Check if our fix migration exists in migrations table (if Supabase tracks it)
SELECT EXISTS (
  SELECT 1 
  FROM information_schema.tables 
  WHERE table_schema = 'supabase_migrations' 
    AND table_name = 'schema_migrations'
) AS has_migrations_table;

-- ============================================================================
-- SECTION 11: SECURITY VERIFICATION
-- ============================================================================

SELECT 'Verifying security configurations...' AS step;

-- Check that sensitive functions are SECURITY DEFINER
SELECT 
  p.proname AS function_name,
  CASE p.prosecdef
    WHEN true THEN '✓ SECURITY DEFINER (Good)'
    ELSE '✗ SECURITY INVOKER (Check if correct)'
  END AS security_mode
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN (
    'promote_first_super_admin',
    'promote_to_admin',
    'demote_admin',
    'set_admin_active',
    'approve_material_rpc',
    'reject_material_rpc',
    'set_maintenance_mode'
  )
ORDER BY p.proname;

-- ============================================================================
-- SECTION 12: TEST QUERIES (Read-only)
-- ============================================================================

SELECT 'Running test queries...' AS step;

-- Test 1: Check if we can query profiles (should work for authenticated users)
SELECT COUNT(*) AS accessible_profiles_count
FROM public.profiles
LIMIT 1;

-- Test 2: Check if we can query materials
SELECT COUNT(*) AS total_materials_count
FROM public.materials
LIMIT 1;

-- Test 3: Check faculties are accessible
SELECT COUNT(*) AS total_faculties_count
FROM public.faculties
LIMIT 1;

-- ============================================================================
-- SUMMARY REPORT
-- ============================================================================

SELECT '
╔════════════════════════════════════════════════════════════════╗
║                  VERIFICATION SUMMARY                          ║
╚════════════════════════════════════════════════════════════════╝

Run the queries above to verify:

1. register_identity_check has anon execution rights       [ ]
2. profiles table has DELETE policy                        [ ]
3. All helper functions are SECURITY DEFINER               [ ]
4. Foreign keys have proper CASCADE rules                  [ ]
5. Materials policies exist for all operations             [ ]
6. Data counts match expectations                          [ ]

If any checks fail, apply the migration:
/home/abraham/fuw/supabase/migrations/20260915_fix_registration_permissions.sql

Then re-run this verification script.

' AS summary;
