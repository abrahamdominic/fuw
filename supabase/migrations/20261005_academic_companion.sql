-- FUW Campus Platform — Academic companion (2026-10-05)
--
-- WHY
--   ff.md §4 asks for a full academic companion: a course registration tracker,
--   a unified per-course workspace, assignments, tests and examinations, an
--   academic calendar, lecturers, and a GPA/CGPA calculator whose grading scale
--   is admin-configurable rather than hardcoded. The 20261004 foundation only
--   shipped student_course_tracker — a course list with no timetable, no
--   assessment, no lecturer and no grades behind it.
--
-- REUSE, NOT DUPLICATION (§17, §37)
--   * courses / departments / faculties / levels        — existing catalogue, untouched
--   * academic_sessions                                  — existing session registry, referenced
--   * profiles                                           — the one and only user table
--   * notifications + notification_preferences           — extended, never re-created
--   * queue_notification()                               — from 20261005_campus_media_and_notifications
--   * handle_updated_at()                                — existing trigger helper
--   * study_planner_tasks                                — left alone; see assignments below
--
--   assignments vs study_planner_tasks: these are deliberately separate tables.
--   A planner task is a personal to-do that a student boards and drags around.
--   An assignment is coursework bound to a course with a submission lifecycle
--   (not_started → in_progress → submitted → completed), an attachment and a
--   reminder. Folding one into the other would either strip the submission state
--   or corrupt the planner. assignments carries a course_id FK where
--   study_planner_tasks only has free-text course_code.
--
-- DATA OWNERSHIP (§27)
--   Official / admin-managed : grading_scales, grading_scale_bands, lecturers,
--                              course_lecturers, course_schedules,
--                              academic_events, academic_calendar_entries,
--                              student_grades
--   Student-owned            : assignments
--
-- Idempotent; wrapped in a transaction.

BEGIN;

-- ── Grading scale (configurable, §4) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.grading_scales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.grading_scale_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scale_id uuid NOT NULL REFERENCES public.grading_scales(id) ON DELETE CASCADE,
  letter text NOT NULL CHECK (letter = upper(trim(letter)) AND length(trim(letter)) BETWEEN 1 AND 4),
  grade_point numeric(4,2) NOT NULL CHECK (grade_point BETWEEN 0 AND 10),
  min_score numeric(5,2) NOT NULL CHECK (min_score BETWEEN 0 AND 100),
  max_score numeric(5,2) NOT NULL CHECK (max_score BETWEEN 0 AND 100),
  is_passing boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grading_scale_bands_letter_unique UNIQUE (scale_id, letter),
  CONSTRAINT grading_scale_bands_range_ordered CHECK (max_score > min_score)
);

-- At most one default scale, so get_grading_scale() is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS grading_scales_single_default_idx
  ON public.grading_scales ((is_default)) WHERE is_default;
CREATE INDEX IF NOT EXISTS grading_scale_bands_scale_idx
  ON public.grading_scale_bands (scale_id, sort_order);

-- Seed the standard five-point scale. Deliberately does NOT overwrite an
-- administrator's existing configuration.
DO $$
DECLARE
  _scale_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grading_scales) THEN
    INSERT INTO public.grading_scales (name, description, is_default)
    VALUES (
      'Standard 5-point',
      'Default Federal University Wukari five-point scale. A grade point is earned at C or above.',
      true
    )
    RETURNING id INTO _scale_id;
  ELSE
    SELECT id INTO _scale_id FROM public.grading_scales WHERE is_default LIMIT 1;
  END IF;

  IF _scale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.grading_scale_bands WHERE scale_id = _scale_id) THEN
    INSERT INTO public.grading_scale_bands
      (scale_id, letter, grade_point, min_score, max_score, is_passing, sort_order)
    VALUES
      (_scale_id, 'A', 5.00, 70.00, 100.00, true,  1),
      (_scale_id, 'B', 4.00, 60.00, 70.00,  true,  2),
      (_scale_id, 'C', 3.00, 50.00, 60.00,  true,  3),
      (_scale_id, 'D', 2.00, 45.00, 50.00,  false, 4),
      (_scale_id, 'E', 1.00, 40.00, 45.00,  false, 5),
      (_scale_id, 'F', 0.00,  0.00, 40.00,  false, 6);
  END IF;
END
$$;


-- ── Lecturers (§4, §15) ──────────────────────────────────────────────────────────
-- Official data. Only ever populated by an administrator holding
-- manage_lecturers; the platform never invents a lecturer record (§4).

CREATE TABLE IF NOT EXISTS public.lecturers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 3 AND 160),
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  staff_email text,
  phone text,
  office_location text NOT NULL DEFAULT '',
  academic_rank text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lecturers_email_format
    CHECK (staff_email IS NULL OR staff_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS lecturers_email_lower_idx
  ON public.lecturers (lower(staff_email)) WHERE staff_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS lecturers_department_idx ON public.lecturers (department_id);
CREATE INDEX IF NOT EXISTS lecturers_active_idx ON public.lecturers (full_name) WHERE is_active;


CREATE TABLE IF NOT EXISTS public.course_lecturers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lecturer_id uuid NOT NULL REFERENCES public.lecturers(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_lecturers_unique
    UNIQUE (course_id, lecturer_id, academic_session_id)
);

CREATE INDEX IF NOT EXISTS course_lecturers_course_idx ON public.course_lecturers (course_id);
CREATE INDEX IF NOT EXISTS course_lecturers_lecturer_idx ON public.course_lecturers (lecturer_id);


-- ── Timetable (§4) ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.course_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lecturer_id uuid REFERENCES public.lecturers(id) ON DELETE SET NULL,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  venue text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_schedules_time_ordered CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS course_schedules_course_idx ON public.course_schedules (course_id);
CREATE INDEX IF NOT EXISTS course_schedules_slot_idx ON public.course_schedules (day_of_week, starts_at);


-- ── Assignments (§4) — student-owned ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 180),
  description text NOT NULL DEFAULT '',
  due_date timestamptz,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'completed')),
  attachment_path text,
  submitted_at timestamptz,
  grade text NOT NULL DEFAULT '',
  feedback text NOT NULL DEFAULT '',
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_student_status_idx ON public.assignments (student_id, status);
CREATE INDEX IF NOT EXISTS assignments_student_due_idx ON public.assignments (student_id, due_date);
CREATE INDEX IF NOT EXISTS assignments_course_idx ON public.assignments (course_id);
-- Supports the reminder sweep without scanning settled rows.
CREATE INDEX IF NOT EXISTS assignments_reminder_pending_idx
  ON public.assignments (reminder_at)
  WHERE reminder_at IS NOT NULL AND reminder_sent_at IS NULL;


-- ── Tests and examinations (§4) — official ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.academic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 180),
  event_type text NOT NULL CHECK (event_type IN ('test', 'examination')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  venue text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  reminder_sent_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_events_time_ordered CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS academic_events_course_idx ON public.academic_events (course_id);
CREATE INDEX IF NOT EXISTS academic_events_upcoming_idx ON public.academic_events (starts_at);


-- ── Academic calendar (§4, §17) ──────────────────────────────────────────────────
-- Distinct from the existing system_settings.semester_calendar key, which only
-- holds a first/second semester date range. That setting is left untouched.

CREATE TABLE IF NOT EXISTS public.academic_calendar_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 180),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Academic'
    CHECK (category IN (
      'Orientation', 'Registration', 'Lectures', 'Mid-semester break',
      'Examination', 'Holiday', 'Convocation', 'Other'
    )),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_calendar_entries_dates_ordered CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS academic_calendar_entries_range_idx
  ON public.academic_calendar_entries (starts_on, ends_on);
CREATE INDEX IF NOT EXISTS academic_calendar_entries_published_idx
  ON public.academic_calendar_entries (starts_on) WHERE is_published;


-- ── Grades (§4) — official, student read-only ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.student_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  grade_letter text NOT NULL CHECK (length(trim(grade_letter)) BETWEEN 1 AND 4),
  grade_point numeric(4,2) NOT NULL CHECK (grade_point BETWEEN 0 AND 10),
  units numeric(4,1),
  is_published boolean NOT NULL DEFAULT false,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_grades_unique UNIQUE (student_id, course_id, academic_session_id)
);

CREATE INDEX IF NOT EXISTS student_grades_student_idx ON public.student_grades (student_id);
CREATE INDEX IF NOT EXISTS student_grades_session_idx ON public.student_grades (academic_session_id);


-- ── updated_at triggers ──────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_updated_at ON public.grading_scales;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.grading_scales
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.lecturers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lecturers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.course_schedules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.course_schedules
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.assignments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.academic_events;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.academic_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.academic_calendar_entries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.academic_calendar_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ── Assignment lifecycle ─────────────────────────────────────────────────────────

-- Stamp the submission time so "Submitted" and "Completed" always carry an
-- auditable date. This is deliberately the only writer of submitted_at: a client
-- may set `status` but never the timestamp, so a student cannot backdate or
-- forge a submission (ff.md §18, "never trust user-submitted ... status").
CREATE OR REPLACE FUNCTION public.stamp_assignment_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('submitted', 'completed') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.submitted_at := now();
    ELSIF OLD.submitted_at IS NULL OR OLD.status NOT IN ('submitted', 'completed') THEN
      -- First transition into a submitted state.
      NEW.submitted_at := now();
    ELSE
      -- Already submitted: keep the original time and discard any attempt to
      -- rewrite it, so the record cannot be backdated after the fact.
      NEW.submitted_at := OLD.submitted_at;
    END IF;
  ELSE
    NEW.submitted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_assignment_submission ON public.assignments;
CREATE TRIGGER trg_stamp_assignment_submission
  BEFORE INSERT OR UPDATE OF status, submitted_at ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_assignment_submission();


-- ── Notification integration (§20) ───────────────────────────────────────────────

-- A published grade is a meaningful life event for a student, so it always
-- notifies. dedupe_key keeps it to one notification per grade row.
CREATE OR REPLACE FUNCTION public.notify_grade_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NEW.is_published AND (TG_OP = 'INSERT' OR OLD.is_published IS DISTINCT FROM NEW.is_published) THEN
    PERFORM public.queue_notification(
      NEW.student_id,
      'Result published',
      format('%s — %s (%s)', NEW.grade_letter, c.course_code, c.course_title),
      'success',
      '/student/academics',
      'academic',
      'grade:' || NEW.id::text
    )
    FROM public.courses c
    WHERE c.id = NEW.course_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_grade_published ON public.student_grades;
CREATE TRIGGER trg_notify_grade_published
  AFTER INSERT OR UPDATE OF is_published ON public.student_grades
  FOR EACH ROW EXECUTE FUNCTION public.notify_grade_published();

-- Posting a test or exam date is exactly the kind of reminder §4 asks for.
CREATE OR REPLACE FUNCTION public.notify_academic_event_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_when text;
BEGIN
  v_when := to_char(NEW.starts_at, 'Dy DD Mon, HH24:MI');

  -- Students actively tracking the course, so the fan-out stays bounded.
  PERFORM public.queue_notification(
    t.student_id,
    format('%s scheduled', CASE NEW.event_type WHEN 'test' THEN 'Test' ELSE 'Examination' END),
    format('%s — %s%s', c.course_code, v_when, CASE WHEN NEW.venue <> '' THEN ' at ' || NEW.venue ELSE '' END),
    'info',
    '/student/academics',
    'academic',
    'academic_event:' || NEW.id::text || ':' || t.student_id::text
  )
  FROM public.student_course_tracker t
  JOIN public.courses c ON c.id = NEW.course_id
  WHERE t.course_id = NEW.course_id
    AND t.status IN ('registered', 'in_progress');

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_academic_event_posted ON public.academic_events;
CREATE TRIGGER trg_notify_academic_event_posted
  AFTER INSERT OR UPDATE OF starts_at, event_type ON public.academic_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_academic_event_posted();

-- Due-soon sweep. Idempotent by construction: once a row is stamped
-- reminder_sent_at it is never selected again, and the notification carries a
-- dedupe key, so calling this repeatedly cannot spam anyone. It is safe to
-- expose to authenticated callers for exactly that reason, and it is the
-- natural entry point for pg_cron later.
--
-- A reminder is only consumed when queue_notification() actually produced a row.
-- If the student has muted the category the row stays unstamped, so re-enabling
-- the category later still delivers the reminder instead of silently losing it.
CREATE OR REPLACE FUNCTION public.dispatch_academic_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
  v_target record;
  v_notified uuid;
BEGIN
  -- Assignment reminders the student asked for.
  FOR v_row IN
    SELECT a.id, a.student_id, a.title, a.due_date, a.status
    FROM public.assignments a
    WHERE a.reminder_at IS NOT NULL
      AND a.reminder_sent_at IS NULL
      AND a.reminder_at <= now()
      AND a.status NOT IN ('submitted', 'completed')
    LIMIT 200
  LOOP
    v_notified := public.queue_notification(
      v_row.student_id,
      'Assignment reminder',
      format('%s%s', v_row.title,
        CASE WHEN v_row.due_date IS NOT NULL
          THEN ' — due ' || to_char(v_row.due_date, 'DD Mon YYYY, HH24:MI') ELSE '' END),
      'warning',
      '/student/academics/assignments',
      'academic',
      'assignment_reminder:' || v_row.id::text
    );

    IF v_notified IS NOT NULL THEN
      UPDATE public.assignments SET reminder_sent_at = now() WHERE id = v_row.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Exams and tests starting within 24 hours.
  FOR v_row IN
    SELECT e.id, e.course_id, e.event_type, e.starts_at, e.venue, c.course_code
    FROM public.academic_events e
    JOIN public.courses c ON c.id = e.course_id
    WHERE e.reminder_sent_at IS NULL
      AND e.starts_at > now()
      AND e.starts_at <= now() + interval '24 hours'
    LIMIT 200
  LOOP
    -- One notification per tracking student, so the row is only stamped once
    -- every recipient has had the chance to be notified.
    v_notified := NULL;

    FOR v_target IN
      SELECT t.student_id
      FROM public.student_course_tracker t
      WHERE t.course_id = v_row.course_id
        AND t.status IN ('registered', 'in_progress')
    LOOP
      v_notified := coalesce(v_notified, public.queue_notification(
        v_target.student_id,
        format('%s coming up', CASE v_row.event_type WHEN 'test' THEN 'Test' ELSE 'Examination' END),
        format('%s — %s%s', v_row.course_code,
          to_char(v_row.starts_at, 'Dy DD Mon, HH24:MI'),
          CASE WHEN v_row.venue <> '' THEN ' at ' || v_row.venue ELSE '' END),
        'warning',
        '/student/academics',
        'academic',
        'academic_event_reminder:' || v_row.id::text || ':' || v_target.student_id::text
      ));
    END LOOP;

    IF v_notified IS NOT NULL THEN
      UPDATE public.academic_events SET reminder_sent_at = now() WHERE id = v_row.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_academic_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_academic_reminders() TO authenticated;


-- ── Student-facing reads ─────────────────────────────────────────────────────────

-- Grades are private to their owner until published, and to staff with
-- manage_academics. No other student can ever read a row here.
CREATE OR REPLACE FUNCTION public.my_gpa_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student uuid := auth.uid();
  v_session uuid;
  v_current_weight numeric := 0;
  v_current_units numeric := 0;
  v_all_weight numeric := 0;
  v_all_units numeric := 0;
  v_all_count integer := 0;
BEGIN
  IF v_student IS NULL THEN
    RETURN jsonb_build_object(
      'academic_session_id', NULL, 'current_session_gpa', NULL,
      'cumulative_cgpa', NULL, 'current_units', 0, 'total_units', 0, 'courses_counted', 0
    );
  END IF;

  SELECT s.id INTO v_session
  FROM public.academic_sessions s
  WHERE s.is_active
  LIMIT 1;

  SELECT
    COALESCE(SUM(x.weight), 0),
    COALESCE(SUM(x.units), 0),
    COUNT(*)::integer
  INTO v_all_weight, v_all_units, v_all_count
  FROM (
    SELECT g.grade_point * COALESCE(g.units, c.credit_units, 0) AS weight,
           COALESCE(g.units, c.credit_units, 0) AS units
    FROM public.student_grades g
    JOIN public.courses c ON c.id = g.course_id
    WHERE g.student_id = v_student AND g.is_published
  ) x;

  SELECT
    COALESCE(SUM(x.weight), 0),
    COALESCE(SUM(x.units), 0)
  INTO v_current_weight, v_current_units
  FROM (
    SELECT g.grade_point * COALESCE(g.units, c.credit_units, 0) AS weight,
           COALESCE(g.units, c.credit_units, 0) AS units
    FROM public.student_grades g
    JOIN public.courses c ON c.id = g.course_id
    WHERE g.student_id = v_student
      AND g.is_published
      AND v_session IS NOT NULL
      AND g.academic_session_id = v_session
  ) x;

  RETURN jsonb_build_object(
    'academic_session_id', v_session,
    'current_session_gpa',
      CASE WHEN v_current_units > 0 THEN round(v_current_weight / v_current_units, 2) END,
    'cumulative_cgpa',
      CASE WHEN v_all_units > 0 THEN round(v_all_weight / v_all_units, 2) END,
    'current_units', v_current_units,
    'total_units', v_all_units,
    'courses_counted', v_all_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_gpa_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_gpa_summary() TO authenticated;

-- The active grading scale, so the calculator mirrors whatever an administrator
-- has configured instead of a scale baked into the client.
CREATE OR REPLACE FUNCTION public.get_grading_scale()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'bands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'letter', b.letter,
        'grade_point', b.grade_point,
        'min_score', b.min_score,
        'max_score', b.max_score,
        'is_passing', b.is_passing
      ) ORDER BY b.sort_order)
      FROM public.grading_scale_bands b
      WHERE b.scale_id = s.id
    ), '[]'::jsonb)
  )
  FROM public.grading_scales s
  WHERE s.is_active
  ORDER BY s.is_default DESC, s.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_grading_scale() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_grading_scale() TO anon, authenticated;


-- ── Admin management RPCs (§15) ───────────────────────────────────────────────────
-- Granular permission keys rather than a blanket is_admin() check, so an admin
-- can hold lecturer administration without also holding grade recording.

CREATE OR REPLACE FUNCTION public.admin_upsert_lecturer(
  p_id uuid,
  p_full_name text,
  p_department_id uuid,
  p_staff_email text,
  p_phone text,
  p_office_location text,
  p_academic_rank text,
  p_bio text,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_permission('manage_lecturers') THEN
    RAISE EXCEPTION 'You do not have permission to manage lecturers'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.lecturers (
      full_name, department_id, staff_email, phone, office_location,
      academic_rank, bio, is_active, created_by
    )
    VALUES (
      trim(p_full_name), p_department_id,
      NULLIF(lower(trim(COALESCE(p_staff_email, ''))), ''),
      NULLIF(trim(COALESCE(p_phone, '')), ''),
      COALESCE(trim(COALESCE(p_office_location, '')), ''),
      COALESCE(trim(COALESCE(p_academic_rank, '')), ''),
      COALESCE(trim(COALESCE(p_bio, '')), ''),
      COALESCE(p_is_active, true),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lecturers
    SET full_name = trim(p_full_name),
        department_id = p_department_id,
        staff_email = NULLIF(lower(trim(COALESCE(p_staff_email, ''))), ''),
        phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
        office_location = COALESCE(trim(COALESCE(p_office_location, '')), ''),
        academic_rank = COALESCE(trim(COALESCE(p_academic_rank, '')), ''),
        bio = COALESCE(trim(COALESCE(p_bio, '')), ''),
        is_active = COALESCE(p_is_active, true)
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Lecturer not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_lecturer(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('manage_lecturers') THEN
    RAISE EXCEPTION 'You do not have permission to manage lecturers'
      USING ERRCODE = '42501';
  END IF;

  -- course_lecturers and course_schedules cascade; timetables for a removed
  -- lecturer degrade to a course with no named lecturer rather than dangling.
  DELETE FROM public.lecturers WHERE id = p_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_upsert_course_lecturer(
  p_id uuid,
  p_course_id uuid,
  p_lecturer_id uuid,
  p_academic_session_id uuid,
  p_is_primary boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_permission('manage_lecturers') THEN
    RAISE EXCEPTION 'You do not have permission to manage lecturers'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.course_lecturers
      (course_id, lecturer_id, academic_session_id, is_primary)
    VALUES (p_course_id, p_lecturer_id, p_academic_session_id, COALESCE(p_is_primary, false))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.course_lecturers
    SET course_id = p_course_id,
        lecturer_id = p_lecturer_id,
        academic_session_id = p_academic_session_id,
        is_primary = COALESCE(p_is_primary, false)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_upsert_course_schedule(
  p_id uuid,
  p_course_id uuid,
  p_lecturer_id uuid,
  p_academic_session_id uuid,
  p_day_of_week smallint,
  p_starts_at time,
  p_ends_at time,
  p_venue text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_permission('manage_academics') THEN
    RAISE EXCEPTION 'You do not have permission to manage the timetable'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.course_schedules
      (course_id, lecturer_id, academic_session_id, day_of_week, starts_at, ends_at, venue)
    VALUES (
      p_course_id, p_lecturer_id, p_academic_session_id,
      p_day_of_week, p_starts_at, p_ends_at,
      COALESCE(trim(COALESCE(p_venue, '')), '')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.course_schedules
    SET course_id = p_course_id,
        lecturer_id = p_lecturer_id,
        academic_session_id = p_academic_session_id,
        day_of_week = p_day_of_week,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        venue = COALESCE(trim(COALESCE(p_venue, '')), '')
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_course_schedule(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('manage_academics') THEN
    RAISE EXCEPTION 'You do not have permission to manage the timetable'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.course_schedules WHERE id = p_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_upsert_academic_event(
  p_id uuid,
  p_course_id uuid,
  p_title text,
  p_event_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_venue text,
  p_notes text,
  p_duration_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_permission('manage_academics') THEN
    RAISE EXCEPTION 'You do not have permission to manage examinations'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.academic_events
      (course_id, title, event_type, starts_at, ends_at, venue, notes, duration_minutes, created_by)
    VALUES (
      p_course_id, trim(p_title), p_event_type, p_starts_at, p_ends_at,
      COALESCE(trim(COALESCE(p_venue, '')), ''),
      COALESCE(trim(COALESCE(p_notes, '')), ''),
      p_duration_minutes, auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.academic_events
    SET course_id = p_course_id,
        title = trim(p_title),
        event_type = p_event_type,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        venue = COALESCE(trim(COALESCE(p_venue, '')), ''),
        notes = COALESCE(trim(COALESCE(p_notes, '')), ''),
        duration_minutes = p_duration_minutes
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_academic_event(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('manage_academics') THEN
    RAISE EXCEPTION 'You do not have permission to manage examinations'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.academic_events WHERE id = p_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_upsert_calendar_entry(
  p_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_starts_on date,
  p_ends_on date,
  p_is_published boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_permission('manage_calendar') THEN
    RAISE EXCEPTION 'You do not have permission to manage the academic calendar'
      USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.academic_calendar_entries
      (title, description, category, starts_on, ends_on, is_published, created_by)
    VALUES (
      trim(p_title), COALESCE(trim(COALESCE(p_description, '')), ''),
      COALESCE(NULLIF(p_category, ''), 'Academic'),
      p_starts_on, p_ends_on, COALESCE(p_is_published, false), auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.academic_calendar_entries
    SET title = trim(p_title),
        description = COALESCE(trim(COALESCE(p_description, '')), ''),
        category = COALESCE(NULLIF(p_category, ''), 'Academic'),
        starts_on = p_starts_on,
        ends_on = p_ends_on,
        is_published = COALESCE(p_is_published, false)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_calendar_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('manage_calendar') THEN
    RAISE EXCEPTION 'You do not have permission to manage the academic calendar'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.academic_calendar_entries WHERE id = p_id;
END;
$$;


-- Grades are entered as a letter and resolved against the active scale, so an
-- administrator records "B" and never has to remember that B is 4.0. An
-- explicit grade_point overrides the lookup when a scale has no matching band.
CREATE OR REPLACE FUNCTION public.admin_record_grade(
  p_student_id uuid,
  p_course_id uuid,
  p_academic_session_id uuid,
  p_grade_letter text,
  p_units numeric,
  p_is_published boolean,
  p_grade_point numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_point numeric;
  v_letter text;
  v_id uuid;
BEGIN
  IF NOT public.has_permission('manage_academics') THEN
    RAISE EXCEPTION 'You do not have permission to record grades'
      USING ERRCODE = '42501';
  END IF;

  v_letter := upper(trim(COALESCE(p_grade_letter, '')));
  IF v_letter = '' THEN
    RAISE EXCEPTION 'A grade letter is required' USING ERRCODE = '22023';
  END IF;

  IF p_grade_point IS NOT NULL THEN
    v_point := p_grade_point;
  ELSE
    -- Resolve the letter against the active scale. The letter filter is what
    -- makes this a lookup rather than "the first band in the table".
    SELECT b.grade_point INTO v_point
    FROM public.grading_scales s
    JOIN public.grading_scale_bands b ON b.scale_id = s.id
    WHERE s.is_active
      AND upper(b.letter) = v_letter
    ORDER BY s.is_default DESC, s.created_at
    LIMIT 1;

    IF v_point IS NULL THEN
      RAISE EXCEPTION 'No grading scale band matches %', v_letter
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.student_grades
    (student_id, course_id, academic_session_id, grade_letter, grade_point, units, is_published, recorded_by, recorded_at)
  VALUES (
    p_student_id, p_course_id, p_academic_session_id, v_letter, v_point,
    p_units, COALESCE(p_is_published, false), auth.uid(), now()
  )
  ON CONFLICT (student_id, course_id, academic_session_id)
  DO UPDATE SET grade_letter = EXCLUDED.grade_letter,
                grade_point = EXCLUDED.grade_point,
                units = EXCLUDED.units,
                is_published = EXCLUDED.is_published,
                recorded_by = EXCLUDED.recorded_by,
                recorded_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_grade(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('manage_academics') THEN
    RAISE EXCEPTION 'You do not have permission to record grades'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.student_grades WHERE id = p_id;
END;
$$;


-- Grading scale configuration (§4: configurable, not hardcoded).
CREATE OR REPLACE FUNCTION public.admin_set_grading_scale(
  p_scale_id uuid,
  p_name text,
  p_description text,
  p_bands jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_band jsonb;
BEGIN
  IF NOT public.has_permission('manage_grading') THEN
    RAISE EXCEPTION 'You do not have permission to manage the grading scale'
      USING ERRCODE = '42501';
  END IF;

  IF p_scale_id IS NULL THEN
    INSERT INTO public.grading_scales (name, description, created_by)
    VALUES (trim(p_name), COALESCE(trim(COALESCE(p_description, '')), ''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.grading_scales
    SET name = trim(p_name),
        description = COALESCE(trim(COALESCE(p_description, '')), '')
    WHERE id = p_scale_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Grading scale not found' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.grading_scale_bands WHERE scale_id = v_id;
  END IF;

  IF jsonb_typeof(p_bands) <> 'array' THEN
    RAISE EXCEPTION 'Bands must be an array' USING ERRCODE = '22023';
  END IF;

  FOR v_band IN SELECT * FROM jsonb_array_elements(p_bands)
  LOOP
    INSERT INTO public.grading_scale_bands
      (scale_id, letter, grade_point, min_score, max_score, is_passing, sort_order)
    VALUES (
      v_id,
      upper(trim(v_band->>'letter')),
      (v_band->>'grade_point')::numeric,
      (v_band->>'min_score')::numeric,
      (v_band->>'max_score')::numeric,
      COALESCE((v_band->>'is_passing')::boolean, true),
      COALESCE((v_band->>'sort_order')::integer, 0)
    );
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_default_grading_scale(p_scale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('manage_grading') THEN
    RAISE EXCEPTION 'You do not have permission to manage the grading scale'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.grading_scales SET is_default = false WHERE is_default;
  UPDATE public.grading_scales SET is_default = true, is_active = true WHERE id = p_scale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grading scale not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_lecturer(uuid, text, uuid, text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_lecturer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_course_lecturer(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_course_schedule(uuid, uuid, uuid, uuid, smallint, time, time, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_course_schedule(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_academic_event(uuid, uuid, text, text, timestamptz, timestamptz, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_academic_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_calendar_entry(uuid, text, text, text, date, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_calendar_entry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_grade(uuid, uuid, uuid, text, numeric, boolean, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_grade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_grading_scale(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_default_grading_scale(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_upsert_lecturer(uuid, text, uuid, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_lecturer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_course_lecturer(uuid, uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_course_schedule(uuid, uuid, uuid, uuid, smallint, time, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_course_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_academic_event(uuid, uuid, text, text, timestamptz, timestamptz, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_academic_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_calendar_entry(uuid, text, text, text, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_calendar_entry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_grade(uuid, uuid, uuid, text, numeric, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_grade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_grading_scale(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_default_grading_scale(uuid) TO authenticated;


-- ── Row level security ───────────────────────────────────────────────────────────

ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scale_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_lecturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_grades ENABLE ROW LEVEL SECURITY;

-- Grading scale: public reference data, admin-managed.
DROP POLICY IF EXISTS grading_scales_read ON public.grading_scales;
CREATE POLICY grading_scales_read ON public.grading_scales
  FOR SELECT TO anon, authenticated USING (is_active);
DROP POLICY IF EXISTS grading_scales_admin_manage ON public.grading_scales;
CREATE POLICY grading_scales_admin_manage ON public.grading_scales
  FOR ALL TO authenticated
  USING (has_permission('manage_grading'))
  WITH CHECK (has_permission('manage_grading'));

DROP POLICY IF EXISTS grading_scale_bands_read ON public.grading_scale_bands;
CREATE POLICY grading_scale_bands_read ON public.grading_scale_bands
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS grading_scale_bands_admin_manage ON public.grading_scale_bands;
CREATE POLICY grading_scale_bands_admin_manage ON public.grading_scale_bands
  FOR ALL TO authenticated
  USING (has_permission('manage_grading'))
  WITH CHECK (has_permission('manage_grading'));

-- Lecturers: readable by anyone (course pages are public), writable by holders of
-- manage_lecturers only. Students get no INSERT/UPDATE path at all, so a fake
-- lecturer record cannot be self-published (§4, §18).
DROP POLICY IF EXISTS lecturers_public_read ON public.lecturers;
CREATE POLICY lecturers_public_read ON public.lecturers
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS lecturers_admin_manage ON public.lecturers;
CREATE POLICY lecturers_admin_manage ON public.lecturers
  FOR ALL TO authenticated
  USING (has_permission('manage_lecturers'))
  WITH CHECK (has_permission('manage_lecturers'));

DROP POLICY IF EXISTS course_lecturers_public_read ON public.course_lecturers;
CREATE POLICY course_lecturers_public_read ON public.course_lecturers
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS course_lecturers_admin_manage ON public.course_lecturers;
CREATE POLICY course_lecturers_admin_manage ON public.course_lecturers
  FOR ALL TO authenticated
  USING (has_permission('manage_lecturers'))
  WITH CHECK (has_permission('manage_lecturers'));

-- Timetable: public read, admin write.
DROP POLICY IF EXISTS course_schedules_public_read ON public.course_schedules;
CREATE POLICY course_schedules_public_read ON public.course_schedules
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS course_schedules_admin_manage ON public.course_schedules;
CREATE POLICY course_schedules_admin_manage ON public.course_schedules
  FOR ALL TO authenticated
  USING (has_permission('manage_academics'))
  WITH CHECK (has_permission('manage_academics'));

-- Assignments: strictly owner-scoped. WITH CHECK mirrors USING so a student
-- cannot re-point student_id at another account (§18 IDOR / mass assignment).
DROP POLICY IF EXISTS assignments_own ON public.assignments;
CREATE POLICY assignments_own ON public.assignments
  FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- Tests and examinations: any signed-in user may read the published schedule;
-- only manage_academics may write it.
DROP POLICY IF EXISTS academic_events_read ON public.academic_events;
CREATE POLICY academic_events_read ON public.academic_events
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS academic_events_admin_manage ON public.academic_events;
CREATE POLICY academic_events_admin_manage ON public.academic_events
  FOR ALL TO authenticated
  USING (has_permission('manage_academics'))
  WITH CHECK (has_permission('manage_academics'));

-- Calendar: published entries are public; drafts are staff-only.
DROP POLICY IF EXISTS academic_calendar_entries_public_read ON public.academic_calendar_entries;
CREATE POLICY academic_calendar_entries_public_read ON public.academic_calendar_entries
  FOR SELECT TO anon, authenticated
  USING (is_published OR has_permission('manage_calendar'));
DROP POLICY IF EXISTS academic_calendar_entries_admin_manage ON public.academic_calendar_entries;
CREATE POLICY academic_calendar_entries_admin_manage ON public.academic_calendar_entries
  FOR ALL TO authenticated
  USING (has_permission('manage_calendar'))
  WITH CHECK (has_permission('manage_calendar'));

-- Grades: a student sees only their own published grades. Staff see all with
-- manage_academics. Nobody else can read a row here, so a student's result can
-- never leak sideways (§24).
DROP POLICY IF EXISTS student_grades_read_own ON public.student_grades;
CREATE POLICY student_grades_read_own ON public.student_grades
  FOR SELECT TO authenticated
  USING ((student_id = auth.uid() AND is_published) OR has_permission('manage_academics'));
DROP POLICY IF EXISTS student_grades_admin_manage ON public.student_grades;
CREATE POLICY student_grades_admin_manage ON public.student_grades
  FOR ALL TO authenticated
  USING (has_permission('manage_academics'))
  WITH CHECK (has_permission('manage_academics'));

-- No student-owned INSERT/UPDATE/DELETE policy on student_grades: grades are
-- only ever written through admin_record_grade().


-- ── Grants ───────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.grading_scales, public.grading_scale_bands,
  public.lecturers, public.course_lecturers, public.course_schedules,
  public.assignments, public.academic_events,
  public.academic_calendar_entries, public.student_grades
  FROM PUBLIC, anon, authenticated;

-- Public catalogue reference data (course pages are indexable, §24).
GRANT SELECT ON public.grading_scales, public.grading_scale_bands,
  public.lecturers, public.course_lecturers, public.course_schedules
  TO anon, authenticated;
GRANT SELECT ON public.academic_calendar_entries TO anon, authenticated;

-- Student + staff surfaces.
GRANT SELECT ON public.academic_events, public.student_grades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments TO authenticated;

-- Staff write paths are additionally gated by RLS; these grants only make the
-- tables reachable so the policies can be evaluated.
GRANT INSERT, UPDATE, DELETE ON public.lecturers, public.course_lecturers,
  public.course_schedules, public.academic_events,
  public.academic_calendar_entries, public.student_grades,
  public.grading_scales, public.grading_scale_bands
  TO authenticated;

COMMENT ON TABLE public.assignments IS
  'Student-owned coursework tracker (ff.md §4). Distinct from study_planner_tasks: assignments are bound to a course and carry a submission lifecycle, an attachment and a reminder.';
COMMENT ON TABLE public.student_grades IS
  'Official grade records (ff.md §27). Written only through admin_record_grade(); students read their own published rows and never another student''s.';
COMMENT ON TABLE public.grading_scales IS
  'Configurable grading scale (ff.md §4). At most one row may hold is_default; get_grading_scale() resolves the active scale.';

COMMIT;