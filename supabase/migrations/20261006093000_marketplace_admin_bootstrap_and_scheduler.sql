-- =============================================================================
-- Marketplace: one-shot admin bootstrap, delivery bookkeeping, live scheduler
-- =============================================================================
-- 1. marketplace_admin_staff could never be populated.
--    mp_guard_admin_staff() allows only a caller who is ALREADY a marketplace
--    super admin to write a row. With the table empty there was no such caller,
--    so the first grant was impossible and every guarded admin RPC -- refunds,
--    disputes, payout review, adverts, messaging -- was unreachable. That is a
--    bootstrap deadlock, not a permission to loosen the guard, so this migration
--    adds a single-use provisioning function that is server-only, audited, and
--    refuses to run a second time.
--
-- 2. 'ready_for_delivery' -> 'delivered' did not stamp delivered_at. mp_transition_order
--    only sets it when the rule says marks_delivered, so a delivered order had a
--    NULL delivery time, and both dispute windows in mp_transition_order key off
--    delivered_at: a buyer could dispute an auto-confirmed order forever, and
--    auto-confirm_after was computed from a timestamp that was never recorded.
--
-- 3. mp_release_eligible_settlements and mp_cancel_expired_orders both refuse to run
--    outside a server context, and nothing ran them. pg_cron is installed, so the
--    jobs are registered here. Until this migration a completed order sat at
--    settlement 'pending' forever and the vendor's balance stayed at zero.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. One-shot marketplace admin bootstrap
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_provision_initial_admin(
  p_user_id     UUID,
  p_role        public.marketplace_admin_role DEFAULT 'super_admin',
  p_permissions TEXT[] DEFAULT ARRAY['*']::TEXT[],
  p_note        TEXT DEFAULT 'Initial marketplace admin grant'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Server-only. This is the one operation that must work before any marketplace
  -- permission system can be exercised at all, so it is gated on the session
  -- rather than on a marketplace role, and it is deliberately not reachable from
  -- PostgREST: anon and authenticated have no EXECUTE (see the grants below).
  IF NOT public.mp_is_server_context() THEN
    RAISE EXCEPTION 'Admin provisioning is a server operation, not a client call'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count FROM public.marketplace_admin_staff s
   WHERE s.revoked_at IS NULL;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Marketplace admin staff already exist; bootstrap is spent'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id) THEN
    RAISE EXCEPTION 'No such profile: %', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- The platform already trusts its own super admins. A grant that contradicts
  -- the platform role would create a marketplace super admin who is not one,
  -- which is exactly the kind of drift this guards against.
  IF p_role = 'super_admin'
     AND (SELECT p.role FROM public.profiles p WHERE p.id = p_user_id) <> 'super_admin' THEN
    RAISE EXCEPTION 'Only a platform super admin may be a marketplace super admin'
      USING ERRCODE = '42501';
  END IF;
  IF p_role <> 'super_admin'
     AND (SELECT p.role FROM public.profiles p WHERE p.id = p_user_id) NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Only a platform admin may hold a limited marketplace role'
      USING ERRCODE = '42501';
  END IF;

  -- The mp_admin_staff_guard trigger is what makes this function necessary: it
  -- refuses any write from a caller who is not already a marketplace super admin,
  -- and "already" is unreachable when the table is empty. The guard is switched off
  -- for exactly this one INSERT and switched straight back on, including on the
  -- error path, so the table is never left unguarded even for the rest of the
  -- transaction. The function is server-only and one-shot, so the window in which
  -- the guard is down has no other writer to admit.
  ALTER TABLE public.marketplace_admin_staff DISABLE TRIGGER mp_admin_staff_guard;
  BEGIN
    INSERT INTO public.marketplace_admin_staff (user_id, role, permissions, is_active, granted_by, note)
    VALUES (p_user_id, p_role, COALESCE(p_permissions, ARRAY['*']::TEXT[]), TRUE,
            auth.uid(), left(COALESCE(p_note, ''), 400));
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.marketplace_admin_staff ENABLE TRIGGER mp_admin_staff_guard;
    RAISE;
  END;
  ALTER TABLE public.marketplace_admin_staff ENABLE TRIGGER mp_admin_staff_guard;
  PERFORM public.mp_audit('marketplace.admin_bootstrapped', 'admin_staff', p_user_id, NULL,
    jsonb_build_object('role', p_role, 'permissions', COALESCE(p_permissions, ARRAY['*']::TEXT[])),
    left(COALESCE(p_note, ''), 400), 'system');

  RETURN jsonb_build_object('user_id', p_user_id, 'role', p_role,
                            'permissions', COALESCE(p_permissions, ARRAY['*']::TEXT[]),
                            'bootstrapped', TRUE);
END;
$$;

COMMENT ON FUNCTION public.mp_provision_initial_admin(UUID, public.marketplace_admin_role, TEXT[], TEXT) IS
  'One-shot, server-only creation of the first marketplace admin grant. Refuses once any staff row exists.';

REVOKE EXECUTE ON FUNCTION public.mp_provision_initial_admin(UUID, public.marketplace_admin_role, TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 2. A delivered order records when it was delivered
-- =============================================================================

-- marketplace_order_transitions is a reference table with no updated_at column;
-- the row is replaced in place.
UPDATE public.marketplace_order_transitions t
   SET marks_delivered = TRUE
 WHERE t.from_status = 'ready_for_delivery'
   AND t.to_status   = 'delivered'
   AND t.marks_delivered = FALSE;

-- =============================================================================
-- 3. The scheduler
-- =============================================================================

-- Both jobs are SECURITY DEFINER and both re-check mp_is_server_context(), so the
-- control is in the function as well as in the grant: even if a client were given
-- EXECUTE on them, running one from a browser session would still be refused.
DO $$
DECLARE
  v_has_extension BOOLEAN;
  v_jobs TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_extension;
  IF NOT v_has_extension THEN
    RAISE EXCEPTION 'pg_cron is required: run CREATE EXTENSION pg_cron first';
  END IF;

  -- Idempotent registration: unschedule any earlier definition of these names so a
  -- re-run cannot leave two jobs racing on the same rows.
  PERFORM cron.unschedule(j.jobname)
    FROM cron.job j
   WHERE j.jobname IN ('fuw-marketplace-release-settlements',
                       'fuw-marketplace-cancel-expired-orders');

  PERFORM cron.schedule('fuw-marketplace-release-settlements', '*/5 * * * *',
    $job$SELECT public.mp_release_eligible_settlements()$job$);

  -- Hourly on the hour. This sweep only cancels unpaid orders older than 45
  -- minutes, so running it more often would do nothing.
  PERFORM cron.schedule('fuw-marketplace-cancel-expired-orders', '7 * * * *',
    $job$SELECT public.mp_cancel_expired_orders()$job$);

  SELECT string_agg(jobname || ' = ' || schedule, '; ' ORDER BY jobname) INTO v_jobs
    FROM cron.job WHERE jobname LIKE 'fuw-marketplace-%';
  RAISE NOTICE 'Marketplace jobs registered: %', v_jobs;
END $$;

-- =============================================================================
-- 4. Grant the scheduler jobs no extra privilege than they already had
-- =============================================================================
-- The cron agent runs these as the database owner, which already satisfies
-- mp_is_server_context(). Nothing is granted to any client role here: these two
-- functions remain service-role/postgres only.
REVOKE EXECUTE ON FUNCTION public.mp_release_eligible_settlements() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mp_cancel_expired_orders()          FROM PUBLIC, anon, authenticated;

COMMIT;