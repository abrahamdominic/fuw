-- Migration: 20261009120000_cbt_question_bank.sql
-- Source of truth for Mock CBT questions.
--
-- Questions are NOT hardcoded in the frontend. They are generated from the
-- text of approved E-Library materials that students and administrators
-- actually uploaded (lecture notes, past-question papers, solved study
-- sheets) by scripts/build-cbt-bank.ts and stored here. The seed is
-- idempotent: `dedupe_key` is unique and re-runs never create duplicates or
-- overwrite existing records.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cbt_questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key         text NOT NULL UNIQUE,
  course_code        text NOT NULL,
  course_title       text,
  question           text NOT NULL,
  options            jsonb NOT NULL,
  correct_option     text NOT NULL,
  topic              text,
  explanation        text,
  question_kind      text NOT NULL DEFAULT 'material_cloze'
                     CHECK (question_kind IN ('past_question', 'study_question', 'material_cloze')),
  source_material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  source_title       text,
  source_page        integer,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cbt_questions IS
  'Mock CBT questions generated from approved E-Library material text. Populated by scripts/build-cbt-bank.ts.';
COMMENT ON COLUMN public.cbt_questions.question_kind IS
  'past_question = answered past paper, study_question = solved study sheet, material_cloze = definitional cloze from a lecture note.';
COMMENT ON COLUMN public.cbt_questions.source_material_id IS
  'The approved upload the question was derived from. ON DELETE SET NULL so deleting a material never deletes history.';

CREATE INDEX IF NOT EXISTS idx_cbt_questions_course ON public.cbt_questions (course_code) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cbt_questions_source ON public.cbt_questions (source_material_id);

ALTER TABLE public.cbt_questions ENABLE ROW LEVEL SECURITY;

-- Students may read active questions whose source material is still approved.
-- A question with no source material is never exposed.
DROP POLICY IF EXISTS "cbt_questions_read_approved" ON public.cbt_questions;
CREATE POLICY "cbt_questions_read_approved" ON public.cbt_questions
  FOR SELECT TO authenticated USING (
    is_active
    AND source_material_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = source_material_id
        AND m.status = 'approved'::public.material_status
    )
  );

-- Writes are service-role only (the seed script). No authenticated write policy
-- means RLS denies INSERT/UPDATE/DELETE for every non-privileged caller.
DROP POLICY IF EXISTS "cbt_questions_service_write" ON public.cbt_questions;
CREATE POLICY "cbt_questions_service_write" ON public.cbt_questions
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

GRANT SELECT ON public.cbt_questions TO authenticated;
GRANT ALL ON public.cbt_questions TO service_role;

-- Keep updated_at fresh without trusting the client.
CREATE OR REPLACE FUNCTION public.touch_cbt_questions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cbt_questions_updated_at ON public.cbt_questions;
CREATE TRIGGER trg_cbt_questions_updated_at
  BEFORE UPDATE ON public.cbt_questions
  FOR EACH ROW EXECUTE FUNCTION public.touch_cbt_questions_updated_at();

COMMIT;
