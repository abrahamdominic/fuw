-- Restore base client DML grants removed in error by the marketplace RLS
-- hardening migration (20261003150000_marketplace_rls_storage.sql).
--
-- That migration's intent was to lock down MARKETPLACE tables only, but its
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, authenticated, anon;
-- stripped INSERT/UPDATE/DELETE from `authenticated` on EVERY public table. It
-- then re-granted only SELECT, so every non-marketplace client write that relies
-- on RLS for row ownership broke:
--   * profiles          (student profile save / registration self-heal)
--   * material_bookmarks, reading_lists/items, reading_progress
--   * student_courses, student_notes, study_planner_tasks
--   * messages/conversations, notifications, active_sessions
--   * research_items/researcher_profiles/collection_* etc.
--
-- RLS is the access-control boundary in this schema, and every public table has
-- RLS enabled (verified: zero tables with relrowsecurity = false). Restoring the
-- base capability that the earlier rebuild granted
-- (20260824_rebuild_full_schema.sql) therefore re-enables the RLS policies
-- exactly as designed and does not expose any row that a policy does not allow.
--
-- After restoring, the marketplace defence-in-depth revokes are re-asserted so
-- nothing that migration deliberately locked down becomes client-writable.
BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- anon stays read-only (matches the pre-marketplace posture).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- Re-assert the marketplace defence-in-depth: these money/audit tables are
-- written only through SECURITY DEFINER RPCs, never directly by clients.
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_audit_log FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_order_status_history FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_payment_events FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_inventory FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_withdrawal_allocations FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_settlements FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_payments FROM authenticated, anon;

COMMIT;
