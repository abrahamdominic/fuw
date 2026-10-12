-- Migration: 20261016090003_consolidate_without_storage_delete.sql
-- Supabase blocks direct DELETE against storage.objects (protect_delete()),
-- so public.consolidate_duplicate_material must NOT touch storage. It now
-- consolidates the duplicate material rows and their child references only;
-- orphaned storage objects are removed separately through the Storage API.

BEGIN;

CREATE OR REPLACE FUNCTION public.consolidate_duplicate_material(
  canonical_id uuid,
  removed_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_removed uuid;
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
    -- Repoint every child reference (name -> column), skipping missing tables.
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collection_items' AND column_name='material_id') THEN
      UPDATE public.collection_items SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='material_bookmarks' AND column_name='material_id') THEN
      DELETE FROM public.material_bookmarks WHERE material_id = v_removed
        AND user_id IN (SELECT user_id FROM public.material_bookmarks WHERE material_id = canonical_id);
      UPDATE public.material_bookmarks SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='material_chunks' AND column_name='material_id') THEN
      UPDATE public.material_chunks SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='material_departments' AND column_name='material_id') THEN
      DELETE FROM public.material_departments WHERE material_id = v_removed
        AND department_id IN (SELECT department_id FROM public.material_departments WHERE material_id = canonical_id);
      UPDATE public.material_departments SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reading_list_items' AND column_name='material_id') THEN
      UPDATE public.reading_list_items SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reading_lists' AND column_name='cover_material_id') THEN
      UPDATE public.reading_lists SET cover_material_id = canonical_id WHERE cover_material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reading_progress' AND column_name='material_id') THEN
      DELETE FROM public.reading_progress WHERE material_id = v_removed
        AND user_id IN (SELECT user_id FROM public.reading_progress WHERE material_id = canonical_id);
      UPDATE public.reading_progress SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='storage_usage_logs' AND column_name='material_id') THEN
      DELETE FROM public.storage_usage_logs WHERE material_id = v_removed
        AND snapshot_date IN (SELECT snapshot_date FROM public.storage_usage_logs WHERE material_id = canonical_id);
      UPDATE public.storage_usage_logs SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_notes' AND column_name='material_id') THEN
      UPDATE public.student_notes SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='study_group_materials' AND column_name='material_id') THEN
      DELETE FROM public.study_group_materials WHERE material_id = v_removed
        AND group_id IN (SELECT group_id FROM public.study_group_materials WHERE material_id = canonical_id)
        AND material_id <> canonical_id;
      UPDATE public.study_group_materials SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_processing_jobs' AND column_name='material_id') THEN
      DELETE FROM public.ai_processing_jobs WHERE material_id = v_removed
        AND EXISTS (SELECT 1 FROM public.ai_processing_jobs WHERE material_id = canonical_id);
      UPDATE public.ai_processing_jobs SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_conversations' AND column_name='material_id') THEN
      UPDATE public.ai_conversations SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='conversations' AND column_name='material_id') THEN
      UPDATE public.conversations SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='copyright_reports' AND column_name='material_id') THEN
      UPDATE public.copyright_reports SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='related_material_id') THEN
      UPDATE public.notifications SET related_material_id = canonical_id WHERE related_material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='study_guides' AND column_name='material_id') THEN
      UPDATE public.study_guides SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='study_planner_tasks' AND column_name='material_id') THEN
      UPDATE public.study_planner_tasks SET material_id = canonical_id WHERE material_id = v_removed;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cbt_questions' AND column_name='source_material_id') THEN
      UPDATE public.cbt_questions SET source_material_id = canonical_id WHERE source_material_id = v_removed;
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.consolidate_duplicate_material(uuid, uuid[]) TO authenticated;

COMMIT;