-- Fix FK relationships: conversations, profile_change_requests, deletion_requests,
-- student_courses all reference auth.users(id) instead of profiles(id).
-- PostgREST needs a direct FK to profiles for relational joins to work.

-- ── conversations ─────────────────────────────────────────────
-- Drop old FKs that reference auth.users
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_student_id_fkey,
  DROP CONSTRAINT IF EXISTS conversations_created_by_fkey;

-- Re-create FKs referencing profiles(id)
ALTER TABLE conversations
  ADD CONSTRAINT conversations_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT conversations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id);

-- ── profile_change_requests ───────────────────────────────────
ALTER TABLE profile_change_requests
  DROP CONSTRAINT IF EXISTS profile_change_requests_student_id_fkey,
  DROP CONSTRAINT IF EXISTS profile_change_requests_reviewed_by_fkey;

ALTER TABLE profile_change_requests
  ADD CONSTRAINT profile_change_requests_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT profile_change_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES profiles(id);

-- ── deletion_requests ─────────────────────────────────────────
ALTER TABLE deletion_requests
  DROP CONSTRAINT IF EXISTS deletion_requests_student_id_fkey,
  DROP CONSTRAINT IF EXISTS deletion_requests_reviewed_by_fkey;

ALTER TABLE deletion_requests
  ADD CONSTRAINT deletion_requests_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT deletion_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES profiles(id);

-- ── student_courses ───────────────────────────────────────────
ALTER TABLE student_courses
  DROP CONSTRAINT IF EXISTS student_courses_student_id_fkey;

ALTER TABLE student_courses
  ADD CONSTRAINT student_courses_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ── Notify PostgREST to reload schema cache ──────────────────
NOTIFY pgrst, 'reload schema';
