-- =============================================================================
-- Retire the dead marketplace_profiles identity table
-- =============================================================================
--
-- The defect
-- ----------
-- `marketplace_profiles` was built as "a thin, marketplace-specific companion to
-- public.profiles" and was meant to hold marketplace preferences, never
-- identity. It never held anything at all. Measured on this project:
--
--     rows | display_name | search_history | campus_area | bio | fuw_verified
--     -----+--------------+----------------+--------------+-----+--------------
--        0 |            0 |              0 |            0 |   0 |            0
--
-- The row-creation trigger function was never attached:
--
--     creating trigger (`mp_ensure_own_profile`) attached: 0
--     sync trigger     (`mp_sync_identity_from_profile`) attached: 1
--
-- So the chain was severed in the middle. The sync trigger *is* attached to
-- `public.profiles` and fires on every insert and update, but its `UPDATE`
-- matches no rows because nothing ever inserted one. Verified for a real
-- signed-in vendor inside a rolled-back transaction:
--
--     acting_uid  | profile_rows | marketplace_profiles rows after mp_record_search()
--     ------------+--------------+-----------------------------------------------
--     e3d403e9... |            1 |                                             0
--
-- `mp_record_search` -- the one function the app still calls, fire-and-forget
-- on every product view (`src/marketplace/lib/api.ts`) -- therefore cost a
-- round-trip and wrote nothing, because it too is an `UPDATE ... WHERE id =
-- auth.uid()` against an empty table.
--
-- Why this is worth removing rather than leaving inert
-- ----------------------------------------------------
-- 1. It is a second identity record. Its own header comment says it must never
--    duplicate name, matric number, faculty or role so "the two apps can never
--    drift" -- but it stored `fuw_matric_number`, `fuw_faculty`,
--    `fuw_department` and `fuw_level`, which is exactly the duplication it
--    claimed to avoid. Identity now comes solely from `profiles` through
--    `src/marketplace/lib/auth.tsx`, so this was a live drift surface with no
--    reader on the other end.
-- 2. Four `SECURITY DEFINER` functions, none reachable from the application,
--    is standing privilege surface with no compensating benefit.
-- 3. Every product view paid for a write that could never land.
--
-- The table held zero rows, so this removes no data. `marketplace_profiles` can
-- be recreated from migration 20261003120000 if the marketplace ever grows a
-- genuine preferences surface.
-- =============================================================================

DROP TRIGGER IF EXISTS mp_profiles_touch        ON public.marketplace_profiles;
DROP TRIGGER IF EXISTS mp_profiles_cap_search   ON public.marketplace_profiles;
DROP TRIGGER IF EXISTS mp_profiles_sync_identity ON public.profiles;

DROP POLICY IF EXISTS mp_profiles_select_own  ON public.marketplace_profiles;
DROP POLICY IF EXISTS mp_profiles_select_admin ON public.marketplace_profiles;

DROP FUNCTION IF EXISTS public.mp_ensure_own_profile();
DROP FUNCTION IF EXISTS public.mp_sync_identity_from_profile();
DROP FUNCTION IF EXISTS public.mp_record_search(text[]);
DROP FUNCTION IF EXISTS public.mp_save_own_profile(text, text, text, text);

DROP TABLE IF EXISTS public.marketplace_profiles;

-- The table is gone, so nothing may still be granted against it.
DO $$
DECLARE
  v_acl TEXT;
BEGIN
  IF to_regclass('public.marketplace_profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'marketplace_profiles still exists; cleanup incomplete';
  END IF;

  SELECT string_agg(p.proname, ', ')
    INTO v_acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('mp_ensure_own_profile', 'mp_sync_identity_from_profile',
                       'mp_record_search', 'mp_save_own_profile');
  IF v_acl IS NOT NULL THEN
    RAISE EXCEPTION 'orphaned marketplace_profiles functions remain: %', v_acl;
  END IF;
END $$;
