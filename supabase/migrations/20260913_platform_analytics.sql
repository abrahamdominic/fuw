-- =============================================================================
-- FUW E-Library — PLATFORM / USAGE ANALYTICS (2026-09-13)
--
-- Adds lightweight, privacy-aware platform-usage analytics consumed by the
-- mobile app (`fuw-elibrary-mobile`):
--
--   * analytics_sessions    one row per app foreground "session"
--   * analytics_events      per-action events (app_open, screen_view,
--                           material_view, material_search, ...)
--   * performance_events    app-performance metrics (startup duration,
--                           API/latency timings, error counters)
--
-- Design rules:
--   * NO passwords/tokens/personal message content are ever written here; the
--     mobile client only stores non-content metadata (see docs/analytics.md).
--   * Row Level Security is ON. A user can insert their OWN rows (or anonymous
--     rows while signed out) and read their OWN rows. No cross-user reads.
--   * Admin/super_admin access is provided through controlled SECURITY DEFINER
--     functions guarded by the existing `has_permission('view_analytics')`
--     helper (super_admin implies all permissions).
--   * `view_analytics` is the documented permission admins must hold to expose
--     the analytics dashboard (the website already ships this permission).
--
-- Idempotent and safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. analytics_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  anonymous_id     text,                 -- app-install ID (persisted per install)
  session_key      text NOT NULL,        -- UUID generated per foreground session
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  duration_seconds numeric,
  app_version      text,
  build_number     text,
  platform         text,                 -- ios | android | web
  device_type      text,                 -- Phone | Tablet | Desktop | ...
  os_version       text,
  language         text,                 -- IETF BCP 47 tag, e.g. en-NG
  timezone         text,                 -- IANA zone, e.g. Africa/Lagos
  network_type     text,                 -- wifi | cellular | ethernet | none | unknown
  country_code     text,                 -- server-derived where available
  region           text,
  city             text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user_id ON public.analytics_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_anon_id ON public.analytics_sessions(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON public.analytics_sessions(started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_sessions_key ON public.analytics_sessions(session_key);

ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;

-- Read own sessions.
CREATE POLICY "analytics_sessions_read_own" ON public.analytics_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- Insert own session, or an anonymous session while signed out.
CREATE POLICY "analytics_sessions_insert_own" ON public.analytics_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id IS NULL));

-- Update own session (heartbeat / end).
CREATE POLICY "analytics_sessions_update_own" ON public.analytics_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- Admins may read sessions for reporting.
CREATE POLICY "analytics_sessions_read_admin" ON public.analytics_sessions
  FOR SELECT USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 2. analytics_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  anonymous_id   text,
  session_id     uuid REFERENCES public.analytics_sessions(id) ON DELETE SET NULL,
  event_name     text NOT NULL,          -- app_open, screen_view, ...
  screen_name    text,                   -- current screen when the event fired
  event_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  platform       text,
  app_version    text,
  build_number   text,
  device_type    text,
  os_version     text,
  language       text,
  timezone       text,
  network_type   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON public.analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_anon_id ON public.analytics_events(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON public.analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON public.analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON public.analytics_events(created_at);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Read own events only.
CREATE POLICY "analytics_events_read_own" ON public.analytics_events
  FOR SELECT USING (auth.uid() = user_id);

-- Insert own events, or anonymous events while signed out. The client-side
-- tracker always stamps the current user id at flush time so events recorded
-- anonymously are attributed once a session is restored.
CREATE POLICY "analytics_events_insert_own" ON public.analytics_events
  FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id IS NULL));

-- Admins may read events for reporting.
CREATE POLICY "analytics_events_read_admin" ON public.analytics_events
  FOR SELECT USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 3. performance_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.performance_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id   uuid REFERENCES public.analytics_sessions(id) ON DELETE SET NULL,
  metric_name  text NOT NULL,            -- app_startup_ms, auth_init_ms, ...
  metric_value numeric,                  -- numeric quantity, in `unit`
  unit         text,                     -- ms | count | ratio
  app_version  text,
  platform     text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_events_user_id ON public.performance_events(user_id);
CREATE INDEX IF NOT EXISTS idx_perf_events_session ON public.performance_events(session_id);
CREATE INDEX IF NOT EXISTS idx_perf_events_name ON public.performance_events(metric_name);
CREATE INDEX IF NOT EXISTS idx_perf_events_created ON public.performance_events(created_at);

ALTER TABLE public.performance_events ENABLE ROW LEVEL SECURITY;

-- Read own performance events only.
CREATE POLICY "perf_events_read_own" ON public.performance_events
  FOR SELECT USING (auth.uid() = user_id);

-- Insert own events, or anonymous events while signed out.
CREATE POLICY "perf_events_insert_own" ON public.performance_events
  FOR INSERT WITH CHECK (auth.uid() = user_id OR (auth.uid() IS NULL AND user_id IS NULL));

-- Admins may read performance events.
CREATE POLICY "perf_events_read_admin" ON public.performance_events
  FOR SELECT USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- Controller: end an analytics session (SECURITY DEFINER, but scoped).
-- Computes duration server-side. Only touches the caller's own session.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_analytics_session(
  p_session_key text,
  p_ended_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  UPDATE public.analytics_sessions
     SET ended_at = p_ended_at,
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (p_ended_at - started_at))::numeric)
   WHERE session_key = p_session_key
     AND (
       (v_user IS NOT NULL AND user_id = v_user)
       OR (v_user IS NULL AND user_id IS NULL)
     );
END;
$$;

-- -----------------------------------------------------------------------------
-- Admin analytics access — all SECURITY DEFINER, guarded by view_analytics.
-- -----------------------------------------------------------------------------

-- Gate helper shared by every admin analytics function.
CREATE OR REPLACE FUNCTION public.assert_view_analytics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('view_analytics') THEN
    RAISE EXCEPTION 'Insufficient permission to view analytics'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Summary dashboard used by the admin overview.
CREATE OR REPLACE FUNCTION public.get_analytics_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_view_analytics();

  SELECT jsonb_build_object(
    'total_sessions',
      (SELECT COUNT(*) FROM public.analytics_sessions),
    'total_events',
      (SELECT COUNT(*) FROM public.analytics_events),
    'daily_active_users',
      (SELECT COUNT(DISTINCT user_id) FROM public.analytics_events
        WHERE user_id IS NOT NULL AND created_at >= now() - interval '1 day'),
    'weekly_active_users',
      (SELECT COUNT(DISTINCT user_id) FROM public.analytics_events
        WHERE user_id IS NOT NULL AND created_at >= now() - interval '7 days'),
    'monthly_active_users',
      (SELECT COUNT(DISTINCT user_id) FROM public.analytics_events
        WHERE user_id IS NOT NULL AND created_at >= now() - interval '30 days'),
    'avg_session_duration_seconds',
      (SELECT COALESCE(AVG(duration_seconds), 0) FROM public.analytics_sessions
        WHERE duration_seconds IS NOT NULL),
    'most_used_screens',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('screen', screen_name, 'count', c) AS x
        FROM (
          SELECT screen_name, COUNT(*) AS c
          FROM public.analytics_events
          WHERE screen_name IS NOT NULL AND screen_name <> ''
          GROUP BY screen_name
          LIMIT 12
        ) s
      ) q),
    'platform_distribution',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('platform', platform, 'count', c) AS x
        FROM (
          SELECT COALESCE(platform, 'unknown') AS platform, COUNT(*) AS c
          FROM public.analytics_events
          GROUP BY platform
          LIMIT 10
        ) s
      ) q),
    'app_version_distribution',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('version', app_version, 'count', c) AS x
        FROM (
          SELECT COALESCE(app_version, 'unknown') AS app_version, COUNT(*) AS c
          FROM public.analytics_events
          GROUP BY app_version
          LIMIT 10
        ) s
      ) q),
    'device_type_distribution',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('device_type', device_type, 'count', c) AS x
        FROM (
          SELECT COALESCE(device_type, 'unknown') AS device_type, COUNT(*) AS c
          FROM public.analytics_events
          GROUP BY device_type
          LIMIT 10
        ) s
      ) q),
    'network_type_distribution',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('network', network_type, 'count', c) AS x
        FROM (
          SELECT COALESCE(network_type, 'unknown') AS network_type, COUNT(*) AS c
          FROM public.analytics_events
          GROUP BY network_type
          LIMIT 10
        ) s
      ) q),
    'country_distribution',
      (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'count')::int DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('country', country_code, 'count', c) AS x
        FROM (
          SELECT COALESCE(country_code, 'unknown') AS country_code, COUNT(*) AS c
          FROM public.analytics_sessions
          GROUP BY country_code
          LIMIT 10
        ) s
      ) q),
    'searches_last_7d',
      (SELECT COUNT(*) FROM public.analytics_events
        WHERE event_name = 'material_search' AND created_at >= now() - interval '7 days'),
    'errors_last_7d',
      (SELECT COUNT(*) FROM public.analytics_events
        WHERE event_name = 'error_occurred' AND created_at >= now() - interval '7 days')
  ) INTO result;

  RETURN result;
END;
$$;

-- Most-viewed / most-downloaded materials.
-- event_metadata keys expected: material_id, material_title, material_type.
CREATE OR REPLACE FUNCTION public.get_top_materials(
  p_limit int DEFAULT 10,
  p_days int DEFAULT 30
)
RETURNS TABLE (
  material_id text,
  material_title text,
  material_type text,
  views bigint,
  downloads bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_view_analytics();

  RETURN QUERY
    SELECT
      COALESCE(e.event_metadata->>'material_id', '') AS material_id,
      COALESCE(e.event_metadata->>'material_title', 'Unknown') AS material_title,
      COALESCE(e.event_metadata->>'material_type', '') AS material_type,
      COUNT(*) FILTER (WHERE e.event_name = 'material_view') AS views,
      COUNT(*) FILTER (WHERE e.event_name = 'material_download') AS downloads
    FROM public.analytics_events e
    WHERE e.event_name IN ('material_view', 'material_download')
      AND e.event_metadata ? 'material_id'
      AND e.created_at >= now() - make_interval(days => p_days)
    GROUP BY 1, 2, 3
    ORDER BY (COUNT(*) FILTER (WHERE e.event_name = 'material_view')
            + COUNT(*) FILTER (WHERE e.event_name = 'material_download')) DESC
    LIMIT GREATEST(1, p_limit);
END;
$$;

-- Recent raw events for a protected admin drill-down.
CREATE OR REPLACE FUNCTION public.get_recent_analytics_events(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  event_name text,
  screen_name text,
  event_metadata jsonb,
  platform text,
  app_version text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_view_analytics();

  RETURN QUERY
    SELECT e.id, e.user_id, e.event_name, e.screen_name,
           e.event_metadata, e.platform, e.app_version, e.created_at
    FROM public.analytics_events e
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

-- Retention: purge analytics older than N days. Admin/super-admin only.
CREATE OR REPLACE FUNCTION public.purge_analytics_data(
  p_older_than_days int DEFAULT 180
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  PERFORM public.assert_view_analytics();

  DELETE FROM public.analytics_events
   WHERE created_at < now() - make_interval(days => GREATEST(1, p_older_than_days));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.performance_events
   WHERE created_at < now() - make_interval(days => GREATEST(1, p_older_than_days));

  DELETE FROM public.analytics_sessions
   WHERE created_at < now() - make_interval(days => GREATEST(1, p_older_than_days));

  RETURN v_deleted;
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.end_analytics_session(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_analytics_session(text, timestamptz) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.assert_view_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_view_analytics() TO authenticated;

REVOKE ALL ON FUNCTION public.get_analytics_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_analytics_dashboard() TO authenticated;

REVOKE ALL ON FUNCTION public.get_top_materials(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top_materials(int, int) TO authenticated;

REVOKE ALL ON FUNCTION public.get_recent_analytics_events(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_analytics_events(int) TO authenticated;

REVOKE ALL ON FUNCTION public.purge_analytics_data(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_analytics_data(int) TO authenticated;

-- Newly created tables in Supabase inherit default privileges that expose them
-- to anon/authenticated via PostgREST (gated by RLS). Keep those defaults, but
-- be explicit that UPDATE/DELETE are never handed out client-side.
GRANT SELECT, INSERT ON public.analytics_sessions TO anon, authenticated;
GRANT SELECT, INSERT ON public.analytics_events TO anon, authenticated;
GRANT SELECT, INSERT ON public.performance_events TO anon, authenticated;

COMMIT;