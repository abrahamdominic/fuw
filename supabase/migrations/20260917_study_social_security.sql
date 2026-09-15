-- ==============================================================================
-- FUW E-Library — STUDY TOOLS + SOCIAL + SECURITY FOUNDATIONS (2026-09-17)
--
-- Shared by both clients (web + Expo mobile). Adds the data layer for the
-- Phase-2+ roadmap:
--
--   1. study_planner_tasks   per-user study-plan tasks with progress tracking
--   2. student_notes         per-user notes attached to materials
--   3. material_bookmarks    Favourites / "later" list attached to materials
--   4. search_logs           query analytics (term, result count, success)
--   5. storage_usage_logs    per-material storage footprint snapshots
--   6. security_events       audit trail for suspicious activity (server-write)
--   7. auth_rate_limits      sliding-window rate-limit counters (server-write)
--
-- Design rules (mirrors 20260913_platform_analytics.sql):
--   * RLS is ON everywhere. Users read/write their OWN rows only; analytics are
--     anonymous-or-own like analytics_events.
--   * security_events + auth_rate_limits are SERVER-ONLY tables: clients never
--     insert directly; writes go through SECURITY DEFINER functions invoked by
--     Edge Functions / auth triggers.
--   * Admin analytics reads go through SECURITY DEFINER functions guarded by
--     has_permission('view_analytics') / is_admin().
--   * Idempotent and safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. study_planner_tasks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.study_planner_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  course_code   text,                        -- optional course tag, e.g. CIS 201
  material_id   uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  task_type     text NOT NULL DEFAULT 'study'
                CHECK (task_type IN ('study', 'assignment', 'exam_prep', 'revision', 'other')),
  priority      text NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  due_date      timestamptz,
  completed_at  timestamptz,
  position      integer NOT NULL DEFAULT 0,  -- manual ordering on the planner board
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planner_user_status
  ON public.study_planner_tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_planner_user_due
  ON public.study_planner_tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_planner_material
  ON public.study_planner_tasks (material_id);

ALTER TABLE public.study_planner_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planner_select_own" ON public.study_planner_tasks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_insert_own" ON public.study_planner_tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_update_own" ON public.study_planner_tasks
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_delete_own" ON public.study_planner_tasks
  FOR DELETE USING (auth.uid() = user_id);

-- Auto-maintain completed_at on status transitions.
CREATE OR REPLACE FUNCTION public.planner_touch_completed_at()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    ELSE
      NEW.completed_at := NULL;
    END IF;
  ELSE
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    ELSIF NEW.status IS DISTINCT FROM 'completed' THEN
      NEW.completed_at := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planner_touch_completed_at ON public.study_planner_tasks;
CREATE TRIGGER trg_planner_touch_completed_at
  BEFORE INSERT OR UPDATE ON public.study_planner_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.planner_touch_completed_at();

-- -----------------------------------------------------------------------------
-- 2. student_notes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_id  uuid REFERENCES public.materials(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  content      text NOT NULL,
  color        text,                        -- UI accent hex, optional
  is_pinned    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON public.student_notes (user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_pinned ON public.student_notes (user_id) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_notes_material ON public.student_notes (material_id);

ALTER TABLE public.student_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_select_own" ON public.student_notes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notes_insert_own" ON public.student_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes_update_own" ON public.student_notes
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes_delete_own" ON public.student_notes
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notes_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notes_touch_updated_at ON public.student_notes;
CREATE TRIGGER trg_notes_touch_updated_at
  BEFORE UPDATE ON public.student_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.notes_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. material_bookmarks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.material_bookmarks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON public.material_bookmarks (user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON public.material_bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_material ON public.material_bookmarks (material_id);

ALTER TABLE public.material_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookmarks_select_own" ON public.material_bookmarks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "bookmarks_insert_own" ON public.material_bookmarks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bookmarks_update_own" ON public.material_bookmarks
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bookmarks_delete_own" ON public.material_bookmarks
  FOR DELETE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 4. search_logs  ("what did students search for?")
--
-- Mirrors the anonymous-or-own model of analytics_events: signed-out rows carry
-- an anonymous_id so they do not require a known user.
-- The normalized term (lowercased, whitespace-collapsed) is what analytics
-- aggregate over; the raw query is kept for diagnostics. Handled per Phase spec:
-- failed searches record result_count = 0.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  anonymous_id  text,
  session_id    uuid REFERENCES public.analytics_sessions(id) ON DELETE SET NULL,
  query         text NOT NULL,
  normalized_query text NOT NULL,
  result_count  integer NOT NULL DEFAULT 0,
  filters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  platform      text,
  app_version   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_user ON public.search_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_search_logs_anon ON public.search_logs (anonymous_id);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON public.search_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_search_logs_norm ON public.search_logs (normalized_query);

ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "search_logs_select_own" ON public.search_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "search_logs_insert" ON public.search_logs
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
CREATE POLICY "search_logs_select_admin" ON public.search_logs
  FOR SELECT USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. storage_usage_logs  (aggregated footprint snapshots; used by the storage
--    analytics dashboard. Written by a SECURITY DEFINER flush function.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.storage_usage_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id    uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  uploaded_by    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  size_bytes     bigint NOT NULL DEFAULT 0,
  file_name      text,
  snapshot_date  date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_storage_logs_material ON public.storage_usage_logs (material_id);
CREATE INDEX IF NOT EXISTS idx_storage_logs_uploader ON public.storage_usage_logs (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_storage_logs_snapshot ON public.storage_usage_logs (snapshot_date);

ALTER TABLE public.storage_usage_logs ENABLE ROW LEVEL SECURITY;

-- No client-side SELECT/INSERT/UPDATE/DELETE policies: writes and reads are
-- via SECURITY DEFINER functions only (server-owned), so no policies exist.

-- -----------------------------------------------------------------------------
-- 6. security_events  (suspicious-activity audit trail; SERVER-WRITE only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type  text NOT NULL,                -- login_failed, login_many_failed,
                                            -- passkey_failed, session_anomaly,
                                            -- rate_limited, quota_exceeded, ...
  severity    text NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info', 'warning', 'critical')),
  message     text NOT NULL DEFAULT '',
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user ON public.security_events (user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events (event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON public.security_events (created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON public.security_events (severity);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Users may read their own audit events (to see "why was I locked out").
CREATE POLICY "security_events_select_own" ON public.security_events
  FOR SELECT USING (auth.uid() = user_id);
-- Admins may read all audit events.
CREATE POLICY "security_events_select_admin" ON public.security_events
  FOR SELECT USING (public.is_admin());

-- Server-only write path (Edge Functions / triggers / service role).
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type text,
  p_severity   text DEFAULT 'info',
  p_message    text DEFAULT '',
  p_user_id    uuid DEFAULT NULL,
  p_metadata   jsonb DEFAULT '{}'::jsonb,
  p_ip         inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_severity NOT IN ('info', 'warning', 'critical') THEN
    p_severity := 'info';
  END IF;
  INSERT INTO public.security_events
    (user_id, event_type, severity, message, metadata, ip_address, user_agent)
  VALUES
    (p_user_id, p_event_type, p_severity, p_message, p_metadata, p_ip, p_user_agent)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_security_event(text, text, text, uuid, jsonb, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, text, uuid, jsonb, inet, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 7. auth_rate_limits  (sliding-window counters; SERVER-WRITE only)
--
--   * one row per (action, key) per fixed window
--   * `consume_rate_limit` atomically increments and returns the current count;
--     the caller (Edge Function / trigger) decides if the count exceeds the cap.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  key           text NOT NULL,              -- e.g. login:IP / otp:user_id / ai:user_id
  window_start  timestamptz NOT NULL DEFAULT now(),
  count         integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action, key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_action_key ON public.auth_rate_limits (action, key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.auth_rate_limits (window_start);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- No client-side policies: all access via SECURITY DEFINER functions below.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_action     text,
  p_key        text,
  p_window_seconds integer DEFAULT 3600
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now    timestamptz := now();
  v_window timestamptz := v_now - make_interval(secs => GREATEST(1, p_window_seconds));
  v_count  integer;
BEGIN
  -- Expire stale windows for this action/key first.
  DELETE FROM public.auth_rate_limits
   WHERE action = p_action AND key = p_key AND window_start < v_window;

  INSERT INTO public.auth_rate_limits (action, key, window_start, count)
  VALUES (p_action, p_key, v_window, 1)
  ON CONFLICT (action, key, window_start)
  DO UPDATE SET count = auth_rate_limits.count + 1,
                updated_at = v_now
  RETURNING count INTO v_count;

  RETURN COALESCE(v_count, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_rate_limit_count(
  p_action text,
  p_key    text,
  p_window_seconds integer DEFAULT 3600
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz := now() - make_interval(secs => GREATEST(1, p_window_seconds));
  v_count  integer;
BEGIN
  SELECT COALESCE(SUM(count), 0)::integer INTO v_count
    FROM public.auth_rate_limits
   WHERE action = p_action AND key = p_key AND window_start >= v_window;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_rate_limit_count(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rate_limit_count(text, text, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- 8. Storage analytics for admins  (security-definer, guarded)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_storage_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_permission('view_analytics') THEN
    RAISE EXCEPTION 'Insufficient permission to view analytics'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total_bytes',
      (SELECT COALESCE(SUM((ob.metadata->>'size')::bigint), 0)
         FROM storage.objects ob
         JOIN public.materials m ON m.file_path = ob.name),
    'materials_count',
      (SELECT COUNT(*) FROM public.materials),
    'approved_materials_count',
      (SELECT COUNT(*) FROM public.materials WHERE status = 'approved'),
    'pending_count',
      (SELECT COUNT(*) FROM public.materials WHERE status = 'pending'),
    'by_uploader',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'bytes')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'user_id', m.uploaded_by::text,
                 'bytes', SUM((ob.metadata->>'size')::bigint),
                 'files', COUNT(*)
               ) AS x
        FROM storage.objects ob
        JOIN public.materials m ON m.file_path = ob.name
        GROUP BY m.uploaded_by
        LIMIT 20
      ) q),
    'by_faculty',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'bytes')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'faculty', m.faculty,
                 'bytes', SUM((ob.metadata->>'size')::bigint),
                 'files', COUNT(*)
               ) AS x
        FROM storage.objects ob
        JOIN public.materials m ON m.file_path = ob.name
        GROUP BY m.faculty
        LIMIT 20
      ) q)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_storage_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storage_overview() TO authenticated;

-- Daily snapshot flush (service role / scheduled job): copies today's live
-- storage footprint into storage_usage_logs so admins can chart usage over time.
CREATE OR REPLACE FUNCTION public.flush_storage_usage()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows bigint;
BEGIN
  INSERT INTO public.storage_usage_logs (material_id, uploaded_by, size_bytes, file_name)
  SELECT m.id, m.uploaded_by, COALESCE((ob.metadata->>'size')::bigint, 0), m.file_name
    FROM public.materials m
    LEFT JOIN storage.objects ob ON ob.name = m.file_path
  ON CONFLICT (material_id, snapshot_date) DO UPDATE
    SET size_bytes = EXCLUDED.size_bytes, created_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.flush_storage_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flush_storage_usage() TO service_role;

-- Owner-facing storage usage of a single uploader (their own totals).
CREATE OR REPLACE FUNCTION public.get_my_storage_usage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_bytes',
      (SELECT COALESCE(SUM(COALESCE((ob.metadata->>'size')::bigint, 0)), 0)
         FROM storage.objects ob
         JOIN public.materials m ON m.file_path = ob.name
        WHERE m.uploaded_by = v_user),
    'total_files',
      (SELECT COUNT(*) FROM public.materials WHERE uploaded_by = v_user),
    'by_material',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'bytes')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'material_id', m.id::text,
                 'title', m.title,
                 'bytes', COALESCE((ob.metadata->>'size')::bigint, 0),
                 'status', m.status
               ) AS x
        FROM public.materials m
        LEFT JOIN storage.objects ob ON ob.name = m.file_path
        WHERE m.uploaded_by = v_user
        LIMIT 50
      ) q)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_storage_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_storage_usage() TO authenticated;

-- -----------------------------------------------------------------------------
-- 8b. Defense-in-depth: only server functions may write storage/security/limit
--     tables; explicit grants avoid accidental default-PUBLIC exposure.
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.security_events TO authenticated;
GRANT SELECT ON public.search_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_planner_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_bookmarks TO authenticated;

-- -----------------------------------------------------------------------------
-- 8c. Search analytics: admin-facing insights over search_logs. Failed searches
--     (result_count = 0) surface as actionable "no results found" queries.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_search_insights(p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Admin privileges required';
  END IF;

  SELECT jsonb_build_object(
    'total_searches',
      (SELECT COUNT(*) FROM public.search_logs WHERE created_at >= now() - make_interval(days => p_days)),
    'failed_searches',
      (SELECT COUNT(*) FROM public.search_logs WHERE created_at >= now() - make_interval(days => p_days) AND result_count = 0),
    'searches_with_click',
      (SELECT COUNT(*) FROM public.search_logs WHERE created_at >= now() - make_interval(days => p_days) AND result_count > 0),
    'no_result_queries',
      (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'count' DESC NULLS LAST), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'query', normalized_query,
                 'count', COUNT(*),
                 'last_at', MAX(created_at)
               ) AS x
        FROM public.search_logs
        WHERE created_at >= now() - make_interval(days => p_days) AND result_count = 0
        GROUP BY normalized_query
        ORDER BY COUNT(*) DESC
        LIMIT 10
      ) q),
    'top_queries',
      (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'count' DESC NULLS LAST), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'query', normalized_query,
                 'count', COUNT(*)
               ) AS x
        FROM public.search_logs
        WHERE created_at >= now() - make_interval(days => p_days) AND result_count > 0
        GROUP BY normalized_query
        ORDER BY COUNT(*) DESC
        LIMIT 10
      ) q)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_search_insights(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_insights(integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8d. Bookmarks: security-definer guarded helpers. The table grants above let
--     the app read/write directly; these enforce per-user filtering (so a client
--     never sees another user's rows even if RLS is misconfigured).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_bookmark_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY_AGG(material_id)
    FROM public.material_bookmarks
   WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_bookmark_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_bookmark_ids() TO authenticated;

COMMIT;

-- ==============================================================================
-- End of migration
-- ==============================================================================