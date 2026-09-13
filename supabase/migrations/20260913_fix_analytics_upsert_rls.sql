-- =============================================================================
-- FUW E-Library — FIX: ANALYTICS UPSERT RLS (2026-09-13)
--
-- Background
-- ----------
-- The mobile + web clients upload analytics with idempotent upserts:
--
--   .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
--   .upsert(row, { onConflict: 'session_key', ignoreDuplicates: true })
--
-- PostgREST translates these to `INSERT ... ON CONFLICT DO NOTHING`. Per the
-- PostgreSQL CREATE POLICY docs, an INSERT with `ON CONFLICT DO NOTHING` (with
-- an arbiter index/constraint) requires *SELECT* permission on the relation,
-- and the rows proposed for insertion must pass the relation's **SELECT**
-- policies. The previous SELECT policies only admitted OWNED rows
-- (`auth.uid() = user_id`), so every anonymous row (`user_id IS NULL`) was
-- rejected even though the INSERT policy allowed it:
--
--   WARN [Analytics] Permission denied ... new row violates row-level
--        security policy for table "analytics_events"     (etc.)
--   {code:"42501", message:"new row violates row-level security policy ..."}
--
-- Fix
-- ----
-- Widen each table's read-own policy to also admit anonymous rows, matching
-- the existing INSERT policy:
--
--   USING (user_id IS NULL OR auth.uid() = user_id)
--
-- The INSERT policy was already `(user_id IS NULL OR auth.uid() = user_id)`;
-- this makes the SELECT policy admit exactly the same rows, which is what the
-- upsert conflict check needs. Privacy is unaffected: anonymous rows carry no
-- PII (no IP, no search text, no account reference) and admin-only aggregates
-- remain gated by `has_permission('view_analytics')` via SECURITY DEFINER
-- functions.
--
-- Idempotent and safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- analytics_sessions
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "analytics_sessions_read_own" ON public.analytics_sessions;
CREATE POLICY "analytics_sessions_read_own" ON public.analytics_sessions
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- analytics_events
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "analytics_events_read_own" ON public.analytics_events;
CREATE POLICY "analytics_events_read_own" ON public.analytics_events
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- performance_events
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "perf_events_read_own" ON public.performance_events;
CREATE POLICY "perf_events_read_own" ON public.performance_events
  FOR SELECT USING (user_id IS NULL OR auth.uid() = user_id);

COMMIT;