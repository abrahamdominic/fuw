-- FUW Campus Platform — verification harness (2026-10-05)
--
-- Exercises row level security and the notification/storage guards against the
-- real production schema, then rolls everything back. This file is NOT a
-- migration; it is run by scripts/verify-campus.mjs, which concatenates it with
-- the two 20261005 migrations inside a single transaction.
--
-- Every assertion raises an exception on failure, which aborts the enclosing
-- transaction, so the harness either reports 'ALL CHECKS PASSED' or names the
-- first broken invariant.

CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(uid uuid, role_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  PERFORM set_config('role', role_name, true);
END;
$$;

DO $$
DECLARE
  a uuid; b uuid; adm uuid; su uuid; cid uuid; asn uuid; ev uuid; lid uuid; gr uuid;
  v jsonb; n integer; ts timestamptz; aev uuid;
BEGIN
  SELECT id INTO a FROM public.profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO b FROM public.profiles WHERE role = 'student' ORDER BY created_at DESC LIMIT 1;
  SELECT id INTO adm FROM public.profiles WHERE role = 'admin' LIMIT 1;
  SELECT id INTO su FROM public.profiles WHERE role = 'super_admin' LIMIT 1;
  SELECT id INTO cid FROM public.courses LIMIT 1;
  SELECT id INTO asn FROM public.academic_sessions WHERE is_active LIMIT 1;

  PERFORM pg_temp.assert(a IS NOT NULL AND b IS NOT NULL AND a <> b,
    'two distinct students available for the ownership tests');
  PERFORM pg_temp.assert(su IS NOT NULL, 'a super admin exists');

  -- ── 0. Notification backfill ───────────────────────────────────────────────────
  -- Checked first, while every row in notifications is still pre-existing, and
  -- written without ORDER BY: now() is constant inside a transaction, so any
  -- "most recent row" comparison would be a tie and therefore non-deterministic.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.notifications WHERE category IS DISTINCT FROM 'platform'),
    'every pre-existing notification was backfilled to the platform category');
  PERFORM pg_temp.assert(
    NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE category NOT IN ('academic','events','organizations','marketplace',
                             'messages','jobs','study_groups','payments','platform')
    ),
    'every backfilled category is one the preference table understands');

  -- ── 1. Grading scale ───────────────────────────────────────────────────────────
  PERFORM pg_temp.assert((SELECT count(*) FROM public.grading_scale_bands) >= 6,
    'standard 5-point scale seeded with 6 bands');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.grading_scales WHERE is_default) = 1,
    'exactly one default grading scale');

  -- ── 2. Anonymous access ────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(NULL, 'anon');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.lecturers) >= 0,
    'anon may select lecturers');
  v := public.get_grading_scale();
  PERFORM pg_temp.assert(v->>'name' = 'Standard 5-point', 'anon resolves get_grading_scale()');
  PERFORM pg_temp.assert(jsonb_array_length(v->'bands') = 6, 'anon receives all 6 bands');
  -- assignments / student_grades / academic_events are not merely filtered for
  -- anon, they are not granted at all, so the expectation is a hard denial.
  BEGIN
    PERFORM pg_temp.assert((SELECT count(*) FROM public.assignments) = 0,
      'anon sees no assignments');
    RAISE EXCEPTION 'anon reached assignments';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM pg_temp.assert((SELECT count(*) FROM public.student_grades) = 0,
      'anon sees no grades');
    RAISE EXCEPTION 'anon reached student_grades';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM pg_temp.assert((SELECT count(*) FROM public.academic_events) = 0,
      'anon sees no academic events');
    RAISE EXCEPTION 'anon reached academic_events';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- queue_notification is a trigger-only primitive (§18 notification abuse).
  BEGIN
    PERFORM public.queue_notification(a, 'spoofed', 'spoofed', 'info', NULL, 'platform', NULL);
    RAISE EXCEPTION 'anon called queue_notification';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- my_gpa_summary must refuse to run without a session.
  BEGIN
    PERFORM pg_temp.assert(public.my_gpa_summary() ->> 'cumulative_cgpa' IS NULL,
      'my_gpa_summary returns an empty summary with no session');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.lecturers (full_name) VALUES ('Anonymous Impostor');
    RAISE EXCEPTION 'anon was able to insert a lecturer';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.assignments (student_id, title) VALUES (a, 'anon assignment');
    RAISE EXCEPTION 'anon was able to insert an assignment';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- ── 3. Assignment ownership and lifecycle ──────────────────────────────────────
  PERFORM pg_temp.as_user(a, 'authenticated');
  INSERT INTO public.assignments (student_id, course_id, title, due_date, reminder_at)
  VALUES (a, cid, 'Compiler optimisation exercise',
          now() + interval '3 days', now() - interval '1 hour')
  RETURNING id INTO ev;
  PERFORM pg_temp.assert(ev IS NOT NULL, 'student creates their own assignment');
  PERFORM pg_temp.assert((SELECT submitted_at FROM public.assignments WHERE id = ev) IS NULL,
    'submitted_at starts null');

  UPDATE public.assignments SET status = 'submitted' WHERE id = ev;
  PERFORM pg_temp.assert((SELECT submitted_at FROM public.assignments WHERE id = ev) IS NOT NULL,
    'submitted_at auto-stamped on transition to submitted');

  UPDATE public.assignments SET status = 'in_progress' WHERE id = ev;
  PERFORM pg_temp.assert((SELECT submitted_at FROM public.assignments WHERE id = ev) IS NULL,
    'submitted_at cleared when the assignment is reopened');

  -- IDOR: student B must not see student A's assignment.
  PERFORM pg_temp.as_user(b, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.assignments) = 0,
    'student B cannot read student A assignment (IDOR)');

  -- RLS filters rather than raising, so the hijack attempt must be proven by a
  -- row count of zero, not by the absence of an exception.
  BEGIN
    UPDATE public.assignments SET student_id = b WHERE id = ev;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    n := -1;
  END;
  PERFORM pg_temp.assert(n = 0,
    'student B cannot re-point student A assignment at themselves (0 rows matched)');

  -- A forged submission timestamp must not survive the trigger.
  PERFORM pg_temp.as_user(a, 'authenticated');
  UPDATE public.assignments
  SET status = 'submitted', submitted_at = '2000-01-01T00:00:00Z'
  WHERE id = ev;
  PERFORM pg_temp.assert(
    (SELECT submitted_at FROM public.assignments WHERE id = ev) > '2020-01-01'::timestamptz,
    'forged submitted_at is overwritten by the trigger on transition');

  -- And once stamped, it must be immutable even when set directly.
  SELECT submitted_at INTO ts FROM public.assignments WHERE id = ev;
  UPDATE public.assignments SET submitted_at = '1999-12-31T00:00:00Z' WHERE id = ev;
  PERFORM pg_temp.assert(
    (SELECT submitted_at FROM public.assignments WHERE id = ev) = ts,
    'an already-stamped submitted_at cannot be rewritten');

  -- ── 4. Grades are private ──────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(su, 'authenticated');
  SELECT public.admin_record_grade(a, cid, asn, 'B', 3, true, NULL) INTO gr;
  PERFORM pg_temp.assert(gr IS NOT NULL, 'super admin records a published grade');
  PERFORM pg_temp.assert(
    (SELECT grade_point FROM public.student_grades WHERE student_id = a AND course_id = cid) = 4.00,
    'grade letter B resolved to 4.00 from the active grading scale');

  -- An unpublished grade is invisible even to its owner.
  SELECT public.admin_record_grade(a, cid, NULL, 'F', 0, false, NULL) INTO gr;
  PERFORM pg_temp.as_user(a, 'authenticated');
  PERFORM pg_temp.assert(NOT EXISTS (
    SELECT 1 FROM public.student_grades WHERE student_id = a AND is_published = false
  ), 'unpublished grade hidden from the student');

  PERFORM pg_temp.as_user(a, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.student_grades) = 1,
    'student A reads only their own published grade');

  v := public.my_gpa_summary();
  PERFORM pg_temp.assert(v->>'cumulative_cgpa' = '4.00',
    'my_gpa_summary reports CGPA 4.00');
  PERFORM pg_temp.assert(v->>'current_session_gpa' = '4.00',
    'my_gpa_summary reports session GPA 4.00');
  PERFORM pg_temp.assert((v->>'courses_counted')::int = 1,
    'my_gpa_summary counts only published grades');

  BEGIN
    INSERT INTO public.student_grades
      (student_id, course_id, grade_letter, grade_point, is_published)
    VALUES (a, cid, 'A', 5.0, true);
    RAISE EXCEPTION 'student was able to insert a grade';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Editing a published grade must also be a no-op, not merely a denial.
  BEGIN
    UPDATE public.student_grades SET grade_letter = 'A' WHERE student_id = a;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    n := -1;
  END;
  PERFORM pg_temp.assert(n = 0,
    'student cannot edit their own grade record (0 rows matched)');

  -- ── 5. Unprivileged admin is denied everywhere ─────────────────────────────────
  PERFORM pg_temp.as_user(adm, 'authenticated');
  PERFORM pg_temp.assert(
    NOT public.has_permission('manage_academics')
    AND NOT public.has_permission('manage_lecturers')
    AND NOT public.has_permission('manage_calendar')
    AND NOT public.has_permission('manage_grading'),
    'unprivileged admin holds none of the new permission keys');

  BEGIN
    PERFORM public.admin_upsert_lecturer(NULL, 'Should Not Exist', NULL,
      NULL, NULL, NULL, NULL, NULL, true);
    RAISE EXCEPTION 'unprivileged admin created a lecturer';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.admin_upsert_calendar_entry(NULL, 'X', '', 'Other',
      current_date, current_date, false);
    RAISE EXCEPTION 'unprivileged admin created a calendar entry';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.admin_record_grade(a, cid, asn, 'A', 3, true, NULL);
    RAISE EXCEPTION 'unprivileged admin recorded a grade';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM public.admin_set_grading_scale(NULL, 'Sneaky', '', '[]'::jsonb);
    RAISE EXCEPTION 'unprivileged admin created a grading scale';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Direct table writes must be refused too, not merely the RPC wrappers.
  BEGIN
    INSERT INTO public.academic_events (course_id, title, event_type, starts_at)
    VALUES (cid, 'Unauthorised exam', 'examination', now());
    RAISE EXCEPTION 'unprivileged admin inserted an academic event';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.academic_calendar_entries
      (title, category, starts_on, ends_on, is_published)
    VALUES ('Unauthorised entry', 'Other', current_date, current_date, true);
    RAISE EXCEPTION 'unprivileged admin published a calendar entry';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.course_schedules (course_id, day_of_week, starts_at, ends_at)
    VALUES (cid, 1, '08:00', '10:00');
    RAISE EXCEPTION 'unprivileged admin inserted a timetable slot';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.grading_scales (name) VALUES ('Sneaky scale');
    RAISE EXCEPTION 'unprivileged admin inserted a grading scale';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- ── 6. Super admin has full authority ──────────────────────────────────────────
  PERFORM pg_temp.as_user(su, 'authenticated');
  SELECT public.admin_upsert_lecturer(NULL, 'Dr Amina Yusuf', NULL,
    'a.yusuf@fuw.edu.ng', '0803000000000', 'Block B, Room 204', 'Senior Lecturer',
    'Teaches software engineering.', true) INTO lid;
  PERFORM pg_temp.assert(lid IS NOT NULL, 'super admin creates a lecturer');

  SELECT public.admin_upsert_course_lecturer(NULL, cid, lid, asn, true) INTO gr;
  PERFORM pg_temp.assert(gr IS NOT NULL, 'super admin assigns a lecturer to a course');

  SELECT public.admin_upsert_course_schedule(NULL, cid, lid, asn, 1::smallint,
    '08:00'::time, '10:00'::time, 'LT 4') INTO gr;
  PERFORM pg_temp.assert(gr IS NOT NULL, 'super admin creates a timetable slot');

  SELECT public.admin_upsert_academic_event(NULL, cid, 'Mid-semester test', 'test',
    now() + interval '2 days', now() + interval '2 days 1 hour', 'Hall A',
    'Covers slides 1-6', 60) INTO aev;
  PERFORM pg_temp.assert(aev IS NOT NULL, 'super admin schedules a test');

  SELECT public.admin_upsert_calendar_entry(NULL, 'Mid-semester break', 'No lectures',
    'Mid-semester break', current_date + 10, current_date + 14, true) INTO gr;
  PERFORM pg_temp.assert(gr IS NOT NULL, 'super admin publishes a calendar entry');

  SELECT public.admin_set_grading_scale(NULL, 'Standard 5-point (v2)', 'Revised bands',
    '[{"letter":"A","grade_point":5,"min_score":70,"max_score":100,"is_passing":true,"sort_order":1},
      {"letter":"B","grade_point":4,"min_score":60,"max_score":70,"is_passing":true,"sort_order":2},
      {"letter":"C","grade_point":3,"min_score":50,"max_score":60,"is_passing":true,"sort_order":3},
      {"letter":"F","grade_point":0,"min_score":0,"max_score":50,"is_passing":false,"sort_order":4}]'::jsonb)
  INTO gr;
  PERFORM pg_temp.assert(gr IS NOT NULL, 'super admin creates an alternate grading scale');
  PERFORM public.admin_set_default_grading_scale(gr);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.grading_scales WHERE is_default) = 1,
    'the default grading scale switches without duplicating');

  -- An invalid band must be rejected by the table constraints.
  BEGIN
    INSERT INTO public.grading_scale_bands
      (scale_id, letter, grade_point, min_score, max_score)
    VALUES (gr, 'Z', 5, 80, 20);
    RAISE EXCEPTION 'an inverted grade band was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.grading_scale_bands
      (scale_id, letter, grade_point, min_score, max_score)
    VALUES (gr, 'A', 5, 70, 100);
    RAISE EXCEPTION 'a duplicate band letter was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- ── 7. Official academic data stays publicly readable ──────────────────────────
  PERFORM pg_temp.as_user(NULL, 'anon');
  PERFORM pg_temp.assert(EXISTS (
    SELECT 1 FROM public.academic_calendar_entries WHERE is_published
  ), 'anon sees the published calendar entry');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.course_lecturers) = 1,
    'anon sees the course/lecturer assignment');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.course_schedules) = 1,
    'anon sees the timetable slot');

  -- ── 8. Notification categories, preferences and dedupe ─────────────────────────
  PERFORM pg_temp.as_user(a, 'authenticated');

  INSERT INTO public.notification_preferences (user_id, category, in_app_enabled)
  VALUES (a, 'academic', false);

  -- Section 3 left the assignment in 'submitted'. A settled assignment must not
  -- be nagged, so the sweep is expected to find nothing yet.
  SELECT public.dispatch_academic_reminders() INTO n;
  PERFORM pg_temp.assert(n = 0, 'a submitted assignment is not reminded');

  -- An opt-out must suppress the reminder even once the task is outstanding.
  UPDATE public.assignments SET status = 'in_progress' WHERE id = ev;
  SELECT public.dispatch_academic_reminders() INTO n;
  PERFORM pg_temp.assert(n = 0, 'an opt-out suppresses the assignment reminder');

  UPDATE public.notification_preferences SET in_app_enabled = true
  WHERE user_id = a AND category = 'academic';

  SELECT public.dispatch_academic_reminders() INTO n;
  PERFORM pg_temp.assert(n >= 1, 'the reminder is dispatched once preferences allow it');

  SELECT public.dispatch_academic_reminders() INTO n;
  PERFORM pg_temp.assert(n = 0, 'a second reminder sweep is a no-op');

  PERFORM pg_temp.assert((SELECT count(*) FROM public.notifications
    WHERE user_id = a AND dedupe_key LIKE 'assignment_reminder:%') = 1,
    'exactly one assignment reminder exists after two sweeps');

  PERFORM pg_temp.assert(EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = a AND dedupe_key = 'assignment_reminder:' || ev::text
  ), 'the assignment reminder targets the right assignment');

  -- queue_notification must not be reachable by an end user directly.
  BEGIN
    PERFORM public.queue_notification(a, 'spoofed', 'spoofed', 'info', NULL, 'platform', NULL);
    RAISE EXCEPTION 'a student called queue_notification directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- ── 9. Grade publication notifies the student ──────────────────────────────────
  PERFORM pg_temp.as_user(su, 'authenticated');
  SELECT public.admin_record_grade(a, cid, NULL, 'A', 3, true, NULL) INTO gr;
  PERFORM pg_temp.as_user(a, 'authenticated');
  PERFORM pg_temp.assert(EXISTS (
    SELECT 1 FROM public.notifications WHERE user_id = a AND dedupe_key = 'grade:' || gr::text
  ), 'grade publication produced a deduped notification');

  -- Re-publishing must not produce a duplicate notification.
  PERFORM pg_temp.as_user(su, 'authenticated');
  SELECT public.admin_record_grade(a, cid, NULL, 'A', 3, true, NULL) INTO gr;
  -- notifications RLS is owner-only, so count as the recipient, not as the admin.
  PERFORM pg_temp.as_user(a, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.notifications
    WHERE user_id = a AND dedupe_key = 'grade:' || gr::text) = 1,
    're-recording the same grade does not duplicate the notification');

  -- ── 10. Storage guard ──────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(a, 'authenticated');

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || b::text || '/cover.png', a::text,
            '{"mimetype":"image/png","size":2048}'::jsonb);
    RAISE EXCEPTION 'an upload into another user prefix was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%owned by the uploader%',
      'cross-user upload path rejected');
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'unknown-scope/' || a::text || '/x.png', a::text,
            '{"mimetype":"image/png","size":2048}'::jsonb);
    RAISE EXCEPTION 'an unknown upload scope was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%unknown upload scope%',
      'unknown upload scope rejected');
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || a::text || '/cover.png', a::text,
            '{"mimetype":"image/png","size":0}'::jsonb);
    RAISE EXCEPTION 'a zero-byte object was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%file size%', 'zero-byte upload rejected');
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || a::text || '/payload.svg', a::text,
            '{"mimetype":"image/png","size":2048}'::jsonb);
    RAISE EXCEPTION 'an extension/mime mismatch was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%does not match%',
      'extension/mime mismatch rejected');
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || a::text || '/x.png', a::text,
            '{"mimetype":"text/html","size":2048}'::jsonb);
    RAISE EXCEPTION 'active content was allowed';
  EXCEPTION WHEN OTHERS THEN
    -- text/html is scriptable, so it must be caught by the explicit deny-list
    -- rather than merely falling out of the allow-list.
    PERFORM pg_temp.assert(SQLERRM LIKE '%not permitted%',
      'active content rejected by the deny-list');
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || a::text || '/notes.txt', a::text,
            '{"mimetype":"text/plain","size":2048}'::jsonb);
    RAISE EXCEPTION 'an unlisted but harmless type was allowed';
  EXCEPTION WHEN OTHERS THEN
    -- Benign types are still refused, just by the allow-list.
    PERFORM pg_temp.assert(SQLERRM LIKE '%not in the allowed set%',
      'unlisted content type rejected by the allow-list');
  END;

  -- Extension-less upload must also be refused (no extension, no match).
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || a::text || '/cover', a::text,
            '{"mimetype":"image/png","size":2048}'::jsonb);
    RAISE EXCEPTION 'an extension-less upload was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%does not match%',
      'extension-less upload rejected');
  END;

  -- Oversized object.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES ('campus-media', 'events/' || a::text || '/big.png', a::text,
            '{"mimetype":"image/png","size":99999999}'::jsonb);
    RAISE EXCEPTION 'an oversized upload was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%file size%', 'oversized upload rejected');
  END;

  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES ('campus-media', 'events/' || a::text || '/cover.png', a::text,
          '{"mimetype":"image/png","size":2048}'::jsonb);
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES ('campus-media', 'lost-found/' || a::text || '/id.png', a::text,
          '{"mimetype":"image/png","size":2048}'::jsonb);
  PERFORM pg_temp.assert(true, 'valid owner-scoped uploads accepted');

  -- Read policies: private scopes must not leak sideways.
  PERFORM pg_temp.as_user(b, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'campus-media' AND name LIKE 'lost-found/%') = 0,
    'student B cannot read student A lost & found photo');
  PERFORM pg_temp.assert((SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'campus-media' AND name LIKE 'events/%') = 1,
    'student B can read a published-scope event cover');

  PERFORM pg_temp.as_user(a, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'campus-media' AND name LIKE 'lost-found/%') = 1,
    'student A can read their own lost & found photo');

  PERFORM pg_temp.as_user(su, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'campus-media' AND name LIKE 'lost-found/%') = 1,
    'a moderator can read a lost & found photo to resolve a dispute');

  PERFORM pg_temp.as_user(adm, 'authenticated');
  PERFORM pg_temp.assert((SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'campus-media' AND name LIKE 'lost-found/%') = 1,
    'an admin can read a lost & found photo via is_admin()');

  -- Anon gets nothing from a private bucket.
  PERFORM pg_temp.as_user(NULL, 'anon');
  PERFORM pg_temp.assert((SELECT count(*) FROM storage.objects
    WHERE bucket_id = 'campus-media') = 0,
    'anon cannot read the private campus-media bucket');

  -- ── 11. No regression on existing E-Library tables ─────────────────────────────
  -- storage.buckets is RLS-protected, so catalogue-level preservation checks have
  -- to run with RLS bypassed; as an end user they would read zero rows and the
  -- assertion would pass or fail for the wrong reason.
  PERFORM pg_temp.as_user(NULL, 'service_role');

  PERFORM pg_temp.assert(
    to_regclass('public.materials') IS NOT NULL
    AND to_regclass('public.profiles') IS NOT NULL
    AND to_regclass('public.courses') IS NOT NULL
    AND to_regclass('public.student_courses') IS NOT NULL
    AND to_regclass('public.study_planner_tasks') IS NOT NULL,
    'existing E-Library tables all still present');

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'materials'),
    'materials RLS still enabled');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications'
            AND policyname = 'notifications_select_own'),
    'notifications_select_own policy untouched');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM storage.buckets WHERE id = 'library-materials') = 1,
    'library-materials bucket untouched');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM storage.buckets WHERE id = 'verification-evidence') = 1,
    'verification-evidence bucket untouched');
  PERFORM pg_temp.assert(
    public.get_library_stats() IS NOT NULL,
    'existing get_library_stats() still executes');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.academic_calendar_entries) IS NOT NULL,
    'academic calendar entries readable');
END;
$$;

SELECT 'ALL CHECKS PASSED' AS result,
       (SELECT count(*) FROM public.grading_scales) AS grading_scales,
       (SELECT count(*) FROM public.academic_events) AS academic_events;