-- ==========================================================================
-- System settings (maintenance mode) — persistent, Supabase-backed config
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_public_read" ON public.system_settings;
CREATE POLICY "system_settings_public_read"
  ON public.system_settings
  FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "system_settings_super_admin_manage" ON public.system_settings;
CREATE POLICY "system_settings_super_admin_manage"
  ON public.system_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT SELECT ON public.system_settings TO anon, authenticated;

INSERT INTO public.system_settings (key, value)
VALUES ('maintenance', JSONB_BUILD_OBJECT('enabled', FALSE, 'message', ''))
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------------------
-- Read status: callable by everyone (anon + authenticated) so the global
-- maintenance gate can redirect users before any protected page renders.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_maintenance_status()
RETURNS TABLE (enabled BOOLEAN, message TEXT, updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((s.value ->> 'enabled')::BOOLEAN, FALSE),
    COALESCE(s.value ->> 'message', ''),
    s.updated_at
  FROM public.system_settings s
  WHERE s.key = 'maintenance';
$$;

GRANT EXECUTE ON FUNCTION public.get_maintenance_status() TO anon, authenticated;

-- --------------------------------------------------------------------------
-- Write status: only super administrators may enable/disable maintenance.
-- Passing NULL / empty message keeps the previously stored message.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_maintenance_mode(
  p_enabled BOOLEAN,
  p_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super administrators can change maintenance mode.';
  END IF;

  SELECT value INTO v_current
  FROM public.system_settings
  WHERE key = 'maintenance'
  FOR UPDATE;

  INSERT INTO public.system_settings (key, value, updated_at, updated_by)
  VALUES (
    'maintenance',
    JSONB_BUILD_OBJECT(
      'enabled', p_enabled,
      'message', COALESCE(NULLIF(TRIM(COALESCE(p_message, '')), ''), COALESCE(v_current ->> 'message', ''))
    ),
    NOW(),
    auth.uid()
  )
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_maintenance_mode(BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_maintenance_mode(BOOLEAN, TEXT) TO authenticated;
