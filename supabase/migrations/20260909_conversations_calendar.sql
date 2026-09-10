-- Messaging permissions and shared academic calendar configuration.

DROP POLICY IF EXISTS "conv_insert_admin" ON public.conversations;
CREATE POLICY "conv_insert_participant" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_admin() AND created_by = auth.uid())
    OR (
      student_id = auth.uid()
      AND created_by = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_public_read" ON public.system_settings;
CREATE POLICY "system_settings_public_read" ON public.system_settings
  FOR SELECT USING (TRUE);

INSERT INTO public.system_settings (key, value)
VALUES (
  'semester_calendar',
  '{
    "first": {"label": "First Semester", "starts_on": "2025-09-15", "ends_on": "2026-01-31"},
    "second": {"label": "Second Semester", "starts_on": "2026-02-01", "ends_on": "2026-06-30"}
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_semester_calendar()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.system_settings WHERE key = 'semester_calendar'),
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.set_semester_calendar(p_value JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can change semester dates.';
  END IF;

  IF jsonb_typeof(p_value) <> 'object'
     OR NOT (p_value ? 'first')
     OR NOT (p_value ? 'second') THEN
    RAISE EXCEPTION 'Both First Semester and Second Semester dates are required.';
  END IF;

  INSERT INTO public.system_settings (key, value, updated_at, updated_by)
  VALUES ('semester_calendar', p_value, NOW(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_semester_calendar() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_semester_calendar(JSONB) TO authenticated;
