-- =============================================================================
-- FUW E-Library — FIX: ANONYMOUS ANALYTICS RLS (2026-09-13)
--
-- Background
-- ----------
-- Student-facing analytics is deliberately anonymous. The mobile + web
-- clients now always insert analytics rows with `user_id = NULL` and attribute
-- them via the installation-scoped `anonymous_id` (the anonymous_id is a
-- random UUID, never an account id).
--
-- The original policies only allowed:
--   * auth.uid() = user_id            (signed-in user writing their own row), or
--   * auth.uid() IS NULL AND user_id IS NULL   (fully signed-out visitor).
--
-- That breaks the moment a signed-in session flushes rows stamped with a NULL
-- user_id (e.g. events queued around login, or any anonymous-capable client).
-- The result is the recurring warning:
--
--   WARN [Analytics] Permission denied ... new row violates row-level
--        security policy for table "analytics_events"     (etc.)
--
-- Fix
-- ----
-- * Insert policies on all three analytics tables now permit rows where
--   user_id IS NULL (anonymous), in addition to a user writing their own rows.
-- * The sessions UPDATE policy (heartbeat / end) also permits anonymous rows.
-- * end_analytics_session() now ends anonymous sessions by session_key.
-- * get_analytics_dashboard() counts DAU/WAU/MAU over the device identity
--   (user_id when present, otherwise anonymous_id) instead of user_id alone,
--   so anonymous installs are still counted as "active".
--
-- Idempotent and safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- analytics_sessions
-- -----------------------------------------------------------------------------
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_sessions_insert_own" ON public.analytics_sessions;
CREATE POLICY "analytics_sessions_insert_own" ON public.analytics_sessions
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "analytics_sessions_update_own" ON public.analytics_sessions;
CREATE POLICY "analytics_sessions_update_own" ON public.analytics_sessions
  FOR UPDATE USING (user_id IS NULL OR auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- analytics_events
-- -----------------------------------------------------------------------------
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_events_insert_own" ON public.analytics_events;
CREATE POLICY "analytics_events_insert_own" ON public.analytics_events
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- performance_events
-- -----------------------------------------------------------------------------
ALTER TABLE public.performance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perf_events_insert_own" ON public.performance_events;
CREATE POLICY "perf_events_insert_own" ON public.performance_events
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- end_analytics_session: also end anonymous sessions (scoped by session_key).
-- session_key is a per-foreground-session random UUID, so matching on it alone
-- is safe against hijacking.
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
       -- A user may end their own sessions, or any anonymous session.
       (v_user IS NOT NULL AND (user_id = v_user OR user_id IS NULL))
       -- A signed-out visitor may only end an anonymous session.
       OR (v_user IS NULL AND user_id IS NULL)
     );
END;
$$;

-- -----------------------------------------------------------------------------
-- get_analytics_dashboard: count active entities across both user_id and the
-- anonymous install id so anonymous analytics still report DAU/WAU/MAU.
-- -----------------------------------------------------------------------------
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
      (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
         FROM public.analytics_events
        WHERE created_at >= now() - interval '1 day'),
    'weekly_active_users',
      (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
         FROM public.analytics_events
        WHERE created_at >= now() - interval '7 days'),
    'monthly_active_users',
      (SELECT COUNT(DISTINCT COALESCE(user_id::text, anonymous_id))
         FROM public.analytics_events
        WHERE created_at >= now() - interval '30 days'),
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

COMMIT;