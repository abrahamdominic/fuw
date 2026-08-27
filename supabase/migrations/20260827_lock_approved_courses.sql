-- Lock approved student courses
-- Once a course has been approved it becomes part of the verified library and
-- can no longer be edited or deleted by the student directly. Changes must go
-- through an admin-approved deletion request.

-- Restrict student updates to non-approved courses only
DROP POLICY IF EXISTS "student_courses_update_own" ON public.student_courses;
CREATE POLICY "student_courses_update_own"
  ON public.student_courses FOR UPDATE
  USING (auth.uid() = student_id AND status <> 'approved')
  WITH CHECK (auth.uid() = student_id AND status <> 'approved');

-- Restrict student deletes to non-approved courses only
DROP POLICY IF EXISTS "student_courses_delete_own" ON public.student_courses;
CREATE POLICY "student_courses_delete_own"
  ON public.student_courses FOR DELETE
  USING (auth.uid() = student_id AND status <> 'approved');