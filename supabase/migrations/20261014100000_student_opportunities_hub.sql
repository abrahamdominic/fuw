-- =============================================================================
-- STUDENT OPPORTUNITIES HUB  (Feature G)
--
-- A moderated directory of scholarships, bursaries, internships, graduate
-- trainee programmes, jobs, hackathons, fellowships, research and certification
-- opportunities relevant to FUW students.
--
-- SECURITY / TRUST
--   * Students may submit an opportunity, but it is only ever inserted as
--     `pending`. A trigger re-forces `pending` / `is_featured = false` for any
--     non-moderator, so a crafted client request can never publish itself or
--     self-promote to the featured slot.
--   * Only moderators (is_admin or `manage_opportunities`) can publish, feature,
--     reject or edit the moderation fields.
--   * Published opportunities are readable by any signed-in student; a student
--     can always read their own submissions (any status) and delete their own.
--   * `application_url` is stored as text and rendered as an external link; the
--     platform never guarantees an outcome or fabricates a link.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.student_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 180),
  organization text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('scholarship','bursary','internship','graduate_trainee','job','hackathon','competition','fellowship','research','entrepreneurship','course','certification','other')),
  description text NOT NULL DEFAULT '',
  eligibility text NOT NULL DEFAULT '',
  qualification text NOT NULL DEFAULT '',
  discipline text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  is_remote boolean NOT NULL DEFAULT false,
  deadline date,
  benefits text NOT NULL DEFAULT '',
  application_instructions text NOT NULL DEFAULT '',
  application_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','published','rejected','expired','closed')),
  is_featured boolean NOT NULL DEFAULT false,
  last_verified_at date,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  moderated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  moderation_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_opportunities_status_deadline
  ON public.student_opportunities (status, deadline);
CREATE INDEX IF NOT EXISTS idx_student_opportunities_category
  ON public.student_opportunities (category);
CREATE INDEX IF NOT EXISTS idx_student_opportunities_submitted_by
  ON public.student_opportunities (submitted_by);

DROP TRIGGER IF EXISTS set_updated_at ON public.student_opportunities;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Guard: freeze moderation-controlled fields for non-moderators.
CREATE OR REPLACE FUNCTION public.guard_student_opportunity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_admin() OR public.has_permission('manage_opportunities') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.is_featured := false;
    NEW.last_verified_at := NULL;
    NEW.moderated_by := NULL;
    NEW.moderation_note := '';
  ELSE
    NEW.status := OLD.status;
    NEW.is_featured := OLD.is_featured;
    NEW.last_verified_at := OLD.last_verified_at;
    NEW.submitted_by := OLD.submitted_by;
    NEW.moderated_by := OLD.moderated_by;
    NEW.moderation_note := OLD.moderation_note;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_student_opportunity ON public.student_opportunities;
CREATE TRIGGER guard_student_opportunity BEFORE INSERT OR UPDATE ON public.student_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.guard_student_opportunity();

ALTER TABLE public.student_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_opportunities_select ON public.student_opportunities;
CREATE POLICY student_opportunities_select ON public.student_opportunities
  FOR SELECT TO authenticated
  USING (
    (status = 'published')
    OR submitted_by = auth.uid()
    OR public.is_admin()
    OR public.has_permission('manage_opportunities')
  );

DROP POLICY IF EXISTS student_opportunities_insert ON public.student_opportunities;
CREATE POLICY student_opportunities_insert ON public.student_opportunities
  FOR INSERT TO authenticated
  WITH CHECK (
    (submitted_by = auth.uid())
    OR public.is_admin()
    OR public.has_permission('manage_opportunities')
  );

DROP POLICY IF EXISTS student_opportunities_update ON public.student_opportunities;
CREATE POLICY student_opportunities_update ON public.student_opportunities
  FOR UPDATE TO authenticated
  USING (
    (submitted_by = auth.uid() AND status = 'pending')
    OR public.is_admin()
    OR public.has_permission('manage_opportunities')
  )
  WITH CHECK (
    (submitted_by = auth.uid() AND status = 'pending')
    OR public.is_admin()
    OR public.has_permission('manage_opportunities')
  );

DROP POLICY IF EXISTS student_opportunities_delete ON public.student_opportunities;
CREATE POLICY student_opportunities_delete ON public.student_opportunities
  FOR DELETE TO authenticated
  USING (
    (submitted_by = auth.uid() AND status = 'pending')
    OR public.is_admin()
    OR public.has_permission('manage_opportunities')
  );

-- Expire past-deadline published opportunities. Safe to call repeatedly.
CREATE OR REPLACE FUNCTION public.expire_student_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('manage_opportunities')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.student_opportunities
     SET status = 'expired'
   WHERE status = 'published'
     AND deadline IS NOT NULL
     AND deadline < CURRENT_DATE;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;

REVOKE ALL ON FUNCTION public.expire_student_opportunities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_student_opportunities() TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_opportunities TO authenticated;
REVOKE ALL ON public.student_opportunities FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
