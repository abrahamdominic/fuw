-- Migration: 20261016090000_cbt_curated_bank_and_library_health.sql
-- 1) Add a `curated` flag + difficulty band to the CBT bank and let
--    authenticated users read curated (source-independent) curriculum
--    questions, alongside the existing approved-material-derived ones.
-- 2) Ship admin health-report functions for the CBT bank and the
--    E-Library (real figures only, computed from live rows/objects).
-- 3) Add an audited, admin-guarded material consolidation path so exact
--    duplicate uploads can be merged into a canonical material row without
--    destroying bookmarks, notes, reading lists, group materials, student
--    progress, notifications or analytics.

BEGIN;

-- ------------------------------------------------------------------ CBT bank
ALTER TABLE public.cbt_questions
  ADD COLUMN IF NOT EXISTS curated boolean NOT NULL DEFAULT false;

ALTER TABLE public.cbt_questions
  ADD COLUMN IF NOT EXISTS difficulty text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conname = 'cbt_questions_difficulty_check' AND a.attname = 'difficulty'
  ) THEN
    ALTER TABLE public.cbt_questions DROP CONSTRAINT cbt_questions_difficulty_check;
  END IF;
END $$;

ALTER TABLE public.cbt_questions
  ADD CONSTRAINT cbt_questions_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard'));

COMMENT ON COLUMN public.cbt_questions.curated IS
  'true = authored from reliable curriculum knowledge (no source material). Readable by students, never conflicts with material-derived rows.';
COMMENT ON COLUMN public.cbt_questions.difficulty IS
  'easy | medium | hard. Derived from question kind for material questions; explicit for curated ones.';

-- Heuristic difficulty backfill for existing material-derived questions.
UPDATE public.cbt_questions
   SET difficulty = CASE question_kind
        WHEN 'past_question'    THEN 'hard'
        WHEN 'study_question'   THEN 'medium'
        WHEN 'material_cloze'   THEN 'easy'
        ELSE 'medium'
      END
 WHERE difficulty IS NULL;

-- A curated row has no source material, so the old strict policy hid it.
DROP POLICY IF EXISTS "cbt_questions_read_approved" ON public.cbt_questions;
CREATE POLICY "cbt_questions_read_approved" ON public.cbt_questions
  FOR SELECT TO authenticated USING (
    is_active
    AND (
      curated = true
      OR (
        source_material_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.materials m
          WHERE m.id = source_material_id
            AND m.status = 'approved'::public.material_status
        )
      )
    )
  );

-- ------------------------------------------------------------------ Reports
-- CBT bank report: real per-course coverage, honest about whether the
-- bank meets the 120-question acceptance bar.
CREATE OR REPLACE FUNCTION public.cbt_bank_report()
RETURNS TABLE (
  course_code     text,
  course_title    text,
  total_questions bigint,
  material_derived bigint,
  curated_added   bigint,
  active_questions bigint,
  meets_120       boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT q.course_code,
         COALESCE(NULLIF(q.course_title, ''), q.course_code) AS course_title,
         COUNT(*)::bigint AS total_questions,
         COUNT(*) FILTER (WHERE NOT q.curated)::bigint AS material_derived,
         COUNT(*) FILTER (WHERE q.curated)::bigint AS curated_added,
         COUNT(*) FILTER (WHERE q.is_active)::bigint AS active_questions,
         COUNT(*) FILTER (WHERE q.is_active) >= 120 AS meets_120
    FROM public.cbt_questions q
   GROUP BY q.course_code, q.course_title
   ORDER BY q.course_code;
$$;

-- Per-course E-Library health: rows, storage objects, broken links and
-- duplicate files are counted from live tables. Storage inventory matches the
-- bucket exactly (path = storage object name via file_path).
CREATE OR REPLACE FUNCTION public.library_health_report()
RETURNS TABLE (
  course_code       text,
  course_title      text,
  approved_materials bigint,
  total_materials   bigint,
  file_objects      bigint,
  broken_refs       bigint,
  duplicate_files   bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mats AS (
    SELECT m.id, m.course_code,
           COALESCE(NULLIF(m.course_title, ''), m.course_code) AS course_title,
           m.status, m.file_path
      FROM public.materials m
     WHERE m.course_code IS NOT NULL
  ),
  obj_names AS (
    SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'library-materials'
  ),
  dup_paths AS (
    SELECT file_path FROM public.materials
     WHERE file_path IS NOT NULL
     GROUP BY file_path
    HAVING COUNT(*) > 1
  )
  SELECT m.course_code,
         m.course_title,
         COUNT(*) FILTER (WHERE m.status = 'approved'::public.material_status)::bigint AS approved_materials,
         COUNT(*)::bigint AS total_materials,
         COUNT(*) FILTER (WHERE m.file_path IS NOT NULL
           AND EXISTS (SELECT 1 FROM obj_names o WHERE o.name = m.file_path))::bigint AS file_objects,
         COUNT(*) FILTER (WHERE m.status = 'approved'::public.material_status
           AND (m.file_path IS NULL
                OR NOT EXISTS (SELECT 1 FROM obj_names o WHERE o.name = m.file_path)))::bigint AS broken_refs,
         COUNT(*) FILTER (WHERE m.file_path IN (SELECT file_path FROM dup_paths))::bigint AS duplicate_files
    FROM mats m
   GROUP BY m.course_code, m.course_title
   ORDER BY m.course_code;
$$;

-- Global storage audit for the library bucket.
CREATE OR REPLACE FUNCTION public.library_storage_audit()
RETURNS TABLE (
  total_objects      bigint,
  matched_objects    bigint,
  orphan_objects     bigint,
  total_size_bytes   bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT COUNT(*)::bigint FROM storage.objects o WHERE o.bucket_id = 'library-materials'),
         (SELECT COUNT(*)::bigint FROM storage.objects o
           WHERE o.bucket_id = 'library-materials'
             AND EXISTS (SELECT 1 FROM public.materials m WHERE m.file_path = o.name)),
         (SELECT COUNT(*)::bigint FROM storage.objects o
           WHERE o.bucket_id = 'library-materials'
             AND NOT EXISTS (SELECT 1 FROM public.materials m WHERE m.file_path = o.name)),
         COALESCE((SELECT SUM((o.metadata->>'size')::bigint)::bigint FROM storage.objects o
           WHERE o.bucket_id = 'library-materials'), 0::bigint);
$$;

-- ------------------------------------------------------------------ Dedup log
CREATE TABLE IF NOT EXISTS public.materials_dedup_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  removed_material_id   uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  duplicate_reason      text NOT NULL,
  removed_title         text,
  removed_file_path     text,
  file_size             bigint,
  content_sha256        text,
  consolidated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consolidated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.materials_dedup_log IS
  'Audit trail of consolidated duplicate uploads. Rows here are preserved so consolidation is reversible and reviewable.';

CREATE INDEX IF NOT EXISTS idx_materials_dedup_canonical ON public.materials_dedup_log (canonical_material_id);

ALTER TABLE public.materials_dedup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "materials_dedup_log_read" ON public.materials_dedup_log;
CREATE POLICY "materials_dedup_log_read" ON public.materials_dedup_log
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "materials_dedup_log_write" ON public.materials_dedup_log;
CREATE POLICY "materials_dedup_log_write" ON public.materials_dedup_log
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

GRANT SELECT ON public.materials_dedup_log TO authenticated;
GRANT ALL ON public.materials_dedup_log TO service_role;

-- Consolidate duplicate materials into a canonical one. Admin-guarded RPC:
-- preserves child references, merges downloads/views, records an audit row,
-- deletes the duplicate storage objects (only if no other material row still
-- references the path), then removes the duplicate material rows.
CREATE OR REPLACE FUNCTION public.consolidate_duplicate_material(
  canonical_id uuid,
  removed_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_removed uuid;
  v_rows    integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized: administrators can consolidate materials.';
  END IF;

  IF canonical_id IS NULL OR removed_ids IS NULL OR array_length(removed_ids, 1) = 0 THEN
    RAISE EXCEPTION 'canonical_id and removed_ids are required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = canonical_id) THEN
    RAISE EXCEPTION 'Canonical material does not exist.';
  END IF;

  FOR v_removed IN
    SELECT unnest(removed_ids)
    WHERE unnest <> canonical_id
  LOOP
    -- Repoint child references so no FK/CASCADE ever deletes user data.
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collection_items' AND column_name='material_id') THEN
      UPDATE public.collection_items SET material_id = canonical_id WHERE material_id = v_removed;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='material_bookmarks' AND column_name='material_id') THEN
      UPDATE public.material_bookmarks SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='material_chunks' AND column_name='material_id') THEN
      UPDATE public.material_chunks SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='material_departments' AND column_name='material_id') THEN
      UPDATE public.material_departments SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reading_list_items' AND column_name='material_id') THEN
      UPDATE public.reading_list_items SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reading_lists' AND column_name='cover_material_id') THEN
      UPDATE public.reading_lists SET cover_material_id = canonical_id WHERE cover_material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reading_progress' AND column_name='material_id') THEN
      UPDATE public.reading_progress SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='storage_usage_logs' AND column_name='material_id') THEN
      UPDATE public.storage_usage_logs SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_notes' AND column_name='material_id') THEN
      UPDATE public.student_notes SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='study_group_materials' AND column_name='material_id') THEN
      UPDATE public.study_group_materials SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_processing_jobs' AND column_name='material_id') THEN
      UPDATE public.ai_processing_jobs SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='related_material_id') THEN
      UPDATE public.notifications SET related_material_id = canonical_id WHERE related_material_id = v_removed;
    END IF;

    -- Merge analytics into the canonical row.
    UPDATE public.materials
       SET downloads = materials.downloads + (SELECT COALESCE(SUM(d.downloads), 0) FROM public.materials d WHERE d.id = v_removed),
           views     = materials.views     + (SELECT COALESCE(SUM(d.views), 0)     FROM public.materials d WHERE d.id = v_removed),
           updated_at = now()
     WHERE id = canonical_id;

    -- Audit row (kept after the material rows are gone).
    INSERT INTO public.materials_dedup_log
      (canonical_material_id, removed_material_id, duplicate_reason, removed_title, removed_file_path, file_size, content_sha256, consolidated_by)
    SELECT canonical_id, v_removed, 'content_duplicate', m.title, m.file_path, m.file_size, NULL, auth.uid()
      FROM public.materials m WHERE m.id = v_removed;

    -- Drop the duplicate material rows (child references already re-pointed).
    DELETE FROM public.materials WHERE id = v_removed;
  END LOOP;

  -- Remove orphaned storage objects that no material row references anymore.
  DELETE FROM storage.objects o
   WHERE o.bucket_id = 'library-materials'
     AND NOT EXISTS (SELECT 1 FROM public.materials m WHERE m.file_path = o.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cbt_bank_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_health_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_storage_audit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consolidate_duplicate_material(uuid, uuid[]) TO authenticated;

COMMIT;