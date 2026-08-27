-- Student Course Uploads
-- Allows students to manually submit their course codes and titles.

CREATE TABLE public.student_courses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  faculty     TEXT NOT NULL,
  department  TEXT NOT NULL,
  level       TEXT NOT NULL,
  semester    TEXT NOT NULL,
  course_code TEXT NOT NULL,
  course_title TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate courses per student for the same academic structure
CREATE UNIQUE INDEX idx_student_courses_unique
  ON public.student_courses (student_id, faculty, department, level, semester, upper(course_code));

-- RLS
ALTER TABLE public.student_courses ENABLE ROW LEVEL SECURITY;

-- Students can read their own courses
CREATE POLICY "student_courses_select_own"
  ON public.student_courses FOR SELECT
  USING (auth.uid() = student_id);

-- Admins can read all courses
CREATE POLICY "student_courses_select_admin"
  ON public.student_courses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Students can insert their own courses
CREATE POLICY "student_courses_insert_own"
  ON public.student_courses FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Students can update their own courses (for edits before approval)
CREATE POLICY "student_courses_update_own"
  ON public.student_courses FOR UPDATE
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

-- Admins can update any course (for approval/rejection)
CREATE POLICY "student_courses_update_admin"
  ON public.student_courses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- Students can delete their own courses
CREATE POLICY "student_courses_delete_own"
  ON public.student_courses FOR DELETE
  USING (auth.uid() = student_id);

-- Admins can delete any course
CREATE POLICY "student_courses_delete_admin"
  ON public.student_courses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'super_admin')
    )
  );
