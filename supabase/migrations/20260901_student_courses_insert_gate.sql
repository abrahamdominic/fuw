-- FUW E-Library — Student course self-approval via INSERT
--
-- AUTHZ issue discovered in a fresh audit (2026-09-01): the
-- `student_courses_insert_own` policy only enforced `auth.uid() = student_id`,
-- so a student could INSERT a row with `status = 'approved'` and bypass the
-- admin approval workflow entirely. The UPDATE path was already locked down by
-- 20260827_lock_approved_courses.sql; this closes the INSERT gap.
--
-- Now a student can only ever create rows with status = 'pending'. The value
-- is also hard-coded at the DB layer so even a direct client insert cannot
-- smuggle 'approved'/'rejected' in.

-- Recreate the insert policy with an explicit pending-only gate.
DROP POLICY IF EXISTS "student_courses_insert_own" ON public.student_courses;
CREATE POLICY "student_courses_insert_own"
  ON public.student_courses FOR INSERT
  WITH CHECK (auth.uid() = student_id AND status = 'pending');
