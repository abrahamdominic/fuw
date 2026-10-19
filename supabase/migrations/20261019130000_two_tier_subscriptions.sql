-- =============================================================================
-- Two-tier subscriptions: Free + Premium only
-- =============================================================================
-- The catalogue previously carried five active plans (free, premium, and the
-- Campus Hub Plus passes plus_monthly / plus_semester / plus_session). The
-- product decision is a single paid tier:
--
--   free     — ₦0 library access (unchanged)
--   premium  — ₦1,500 (price untouched) with the existing SEMESTER duration
--              of 120 days, absorbed from plus_semester
--
-- The three plus_* rows are retired with is_active = false, never deleted, so
-- historical subscriptions, payment_requests and payment_transactions keep
-- their foreign keys and their joinable plan names.
--
-- Existing plus_* subscribers are NOT downgraded: entitlement resolution
-- (has_premium_access, my_plan, my_premium_source) no longer requires the plan
-- row to be is_active — is_active now gates NEW purchases only, which every
-- purchase/grant RPC already enforces.
--
-- A table-level CHECK makes the two-tier rule impossible to bypass: no path
-- (RPC, admin UI, direct write) can ever re-activate a retired tier or seed a
-- new one.

-- -----------------------------------------------------------------------------
-- 1. Premium becomes the semester plan (duration only; price stays ₦1,500)
-- -----------------------------------------------------------------------------
UPDATE public.plans
   SET duration_days = 120
 WHERE slug = 'premium'
   AND duration_days IS DISTINCT FROM 120;

-- -----------------------------------------------------------------------------
-- 2. Retire the Campus Hub Plus passes (rows kept for history)
-- -----------------------------------------------------------------------------
UPDATE public.plans
   SET is_active = false
 WHERE slug IN ('plus_monthly', 'plus_semester', 'plus_session')
   AND is_active = true;

-- -----------------------------------------------------------------------------
-- 3. Only Free and Premium may ever be active
-- -----------------------------------------------------------------------------
ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_only_free_premium_active;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_only_free_premium_active
  CHECK (is_active = false OR slug IN ('free', 'premium'));

-- -----------------------------------------------------------------------------
-- 4. Entitlement READS must survive plan retirement
-- -----------------------------------------------------------------------------
-- has_premium_access: same logic, minus the plan.is_active requirements on both
-- entitlement branches. Purchase paths still require is_active at buy time.
CREATE OR REPLACE FUNCTION public.has_premium_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.premium_system_enabled()
     AND public.my_verified()
     AND (
       EXISTS (
         SELECT 1
           FROM public.premium_entitlements e
           JOIN public.plans p ON p.id = e.plan_id
          WHERE e.user_id = auth.uid()
            AND e.entitlement_type = 'PREMIUM'
            AND e.is_active
            AND (e.expires_at IS NULL OR e.expires_at > now())
            AND p.is_premium
       )
       OR EXISTS (
         SELECT 1
           FROM public.subscriptions s
           JOIN public.plans p ON p.id = s.plan_id
          WHERE s.user_id = auth.uid()
            AND s.status = 'active'
            AND s.expires_at > now()
            AND p.is_premium
            AND NOT EXISTS (
              SELECT 1 FROM public.premium_entitlements e WHERE e.subscription_id = s.id
            )
       )
     );
$$;

-- my_plan: same logic, minus the plan.is_active requirements on both branches.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS TABLE (
  plan_slug text,
  plan_name text,
  status text,
  expires_at timestamptz,
  is_premium boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.plan_slug, p.plan_name, p.status, p.expires_at, p.is_premium
    FROM (
      SELECT pl.slug AS plan_slug, pl.name AS plan_name, 'active'::text AS status,
             e.expires_at, pl.is_premium, e.granted_at, e.source
        FROM public.premium_entitlements e
        JOIN public.plans pl ON pl.id = e.plan_id
       WHERE e.user_id = auth.uid()
         AND e.entitlement_type = 'PREMIUM'
         AND e.is_active
         AND (e.expires_at IS NULL OR e.expires_at > now())
      UNION ALL
      SELECT pl.slug, pl.name, s.status, s.expires_at, pl.is_premium, s.starts_at,
             CASE
               WHEN s.admin_note LIKE 'Approved payment %' OR s.admin_note LIKE 'Automatic payment %'
                 THEN 'PAYMENT'
               ELSE 'ADMIN_GRANT'
             END
        FROM public.subscriptions s
        JOIN public.plans pl ON pl.id = s.plan_id
       WHERE s.user_id = auth.uid()
         AND s.status = 'active'
         AND s.expires_at > now()
         AND NOT EXISTS (
           SELECT 1 FROM public.premium_entitlements e WHERE e.subscription_id = s.id
         )
    ) p
   ORDER BY p.is_premium DESC,
            CASE p.source WHEN 'PAYMENT' THEN 1 WHEN 'ADMIN_GRANT' THEN 2 ELSE 3 END,
            p.expires_at DESC NULLS FIRST, p.granted_at DESC
   LIMIT 1;
$$;

-- my_premium_source: same logic, minus the plan.is_active requirement.
CREATE OR REPLACE FUNCTION public.my_premium_source()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.source FROM public.premium_entitlements e
    JOIN public.plans p ON p.id = e.plan_id
   WHERE e.user_id = auth.uid() AND e.entitlement_type = 'PREMIUM'
     AND e.is_active AND (e.expires_at IS NULL OR e.expires_at > now())
     AND p.is_premium
   ORDER BY CASE e.source WHEN 'PAYMENT' THEN 1 WHEN 'ADMIN_GRANT' THEN 2 ELSE 3 END,
            e.expires_at DESC NULLS FIRST
   LIMIT 1;
$$;
