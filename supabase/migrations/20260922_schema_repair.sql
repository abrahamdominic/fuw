-- ---------------------------------------------------------------------------
-- FUW E-Library — Consolidated schema repair
-- Applies after 20260921_institutional_library_infrastructure.sql
--
-- Fixes:
--   1. conversations.material_id  TEXT -> uuid + FK to materials(id)
--   2. save_reading_progress()    double ON CONFLICT (syntax error) -> branch
--   3. active_sessions_student_update_guard()  CREATE vs CREATE OR REPLACE
--   4. terminate_other_sessions / cleanup_stale_sessions  PUBLIC/anon EXECUTE
--   5. materials.material_type    legacy TEXT -> enum (idempotent)
--   6. system_settings            stale anon table SELECT grant
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. conversations.material_id: TEXT -> uuid + FK to materials(id)
--    Fixes PostgREST embed `material:materials(*)` and type mismatch.
-- ---------------------------------------------------------------------------
UPDATE public.conversations
   SET material_id = NULL
 WHERE material_id IS NOT NULL
   AND material_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE public.conversations
  ALTER COLUMN material_id TYPE uuid
    USING (NULLIF(trim(material_id), '')::uuid);

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_material_id_fkey;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_material_id_fkey
    FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. save_reading_progress(): the original body (20260921) placed two
--    ON CONFLICT clauses in a single INSERT, which PostgreSQL rejects.
--    Table has UNIQUE(user_id, material_id) and UNIQUE(user_id,
--    research_item_id), so each branch upserts on its own key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_reading_progress(
  p_material_id uuid,
  p_research_item_id uuid,
  p_page integer,
  p_total integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_material_id IS NOT NULL THEN
    INSERT INTO public.reading_progress (
      user_id, material_id, current_page, total_pages, progress_percent
    )
    VALUES (
      auth.uid(), p_material_id,
      GREATEST(0, p_page),
      GREATEST(0, p_total),
      CASE WHEN p_total > 0
           THEN GREATEST(0, LEAST(100, round((p_page::numeric / p_total) * 100, 2)))
           ELSE 0 END
    )
    ON CONFLICT (user_id, material_id) DO UPDATE
      SET current_page = EXCLUDED.current_page,
          total_pages = EXCLUDED.total_pages,
          progress_percent = EXCLUDED.progress_percent,
          last_read_at = now();

  ELSIF p_research_item_id IS NOT NULL THEN
    INSERT INTO public.reading_progress (
      user_id, research_item_id, current_page, total_pages, progress_percent
    )
    VALUES (
      auth.uid(), p_research_item_id,
      GREATEST(0, p_page),
      GREATEST(0, p_total),
      CASE WHEN p_total > 0
           THEN GREATEST(0, LEAST(100, round((p_page::numeric / p_total) * 100, 2)))
           ELSE 0 END
    )
    ON CONFLICT (user_id, research_item_id) DO UPDATE
      SET current_page = EXCLUDED.current_page,
          total_pages = EXCLUDED.total_pages,
          progress_percent = EXCLUDED.progress_percent,
          last_read_at = now();
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. active_sessions_student_update_guard(): 20260914 used CREATE FUNCTION
--    although 20260831 already created it, so applying both raises
--    "function already exists". Make the final body idempotent.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_active_sessions_student_update_guard ON public.active_sessions;

CREATE OR REPLACE FUNCTION public.active_sessions_student_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.session_key IS DISTINCT FROM OLD.session_key
     OR NEW.device_type IS DISTINCT FROM OLD.device_type
     OR NEW.browser IS DISTINCT FROM OLD.browser
     OR NEW.os IS DISTINCT FROM OLD.os
     OR NEW.device_name IS DISTINCT FROM OLD.device_name
     OR NEW.imei IS DISTINCT FROM OLD.imei
     OR NEW.mac_address IS DISTINCT FROM OLD.mac_address
     OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.connection_type IS DISTINCT FROM OLD.connection_type
     OR NEW.network_name IS DISTINCT FROM OLD.network_name
     OR NEW.user_agent IS DISTINCT FROM OLD.user_agent THEN
    RAISE EXCEPTION 'Students may not alter session identity or device fields.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_active_sessions_student_update_guard
  BEFORE UPDATE ON public.active_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.active_sessions_student_update_guard();

-- ---------------------------------------------------------------------------
-- 4. Session RPCs were created with default PUBLIC EXECUTE and CREATE OR
--    REPLACE preserves ACLs, so PUBLIC/anon can still call them. Revoke.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.terminate_other_sessions(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.terminate_other_sessions(text) TO authenticated;

REVOKE ALL ON FUNCTION public.cleanup_stale_sessions() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cleanup_stale_sessions() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. materials.material_type: legacy TEXT (20260822) vs enum (20260824) —
--    convert only when the column is still text.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'material_type')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials'
          AND column_name = 'material_type' AND udt_name = 'text'
     ) THEN
    ALTER TABLE public.materials
      ALTER COLUMN material_type TYPE public.material_type
      USING (CASE WHEN trim(material_type) = ''
                  THEN 'Lecture Note'::public.material_type
                  ELSE material_type::public.material_type END);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. system_settings: drop the stale anon table-level SELECT grant. RLS
--    already limits reads to key='maintenance'; this is defense-in-depth.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.system_settings FROM anon;

-- ---------------------------------------------------------------------------
-- 7. copyright_reports: reporters may read their own submissions. The base
--    policy only exposed reports to admins, which also broke inserts that
--    requested a representation (PostgREST applies SELECT RLS to RETURNING).
--    Guarded so this migration is safe even if the infra migration that
--    creates the table has not run yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.copyright_reports') IS NOT NULL THEN
    DROP POLICY IF EXISTS "copyright_reports_select_own" ON public.copyright_reports;
    CREATE POLICY "copyright_reports_select_own"
      ON public.copyright_reports FOR SELECT
      USING (auth.uid() = reported_by);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
