-- -----------------------------------------------------------------------------
-- 1. Add Gender & Phone Number to student profiles.
--    Both are optional at the DB level so existing students (created before the
--    registration form gained these fields) keep working unchanged.
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Gender restricted to Male/Female (nullable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_gender_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gender_check CHECK (gender IN ('Male', 'Female') OR gender IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_gender ON public.profiles (gender)
  WHERE gender IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Analytics aggregation RPCs — aggregates only, never private student rows.
--    Mirror the existing get_public_stats() SECURITY DEFINER pattern.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_students_by_gender()
RETURNS TABLE (gender text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.gender::text AS gender, COUNT(*)::bigint AS count
  FROM public.profiles p
  WHERE p.gender IS NOT NULL AND p.gender IN ('Male', 'Female')
  GROUP BY p.gender
  ORDER BY p.gender;
$$;

CREATE OR REPLACE FUNCTION public.count_materials_by_faculty()
RETURNS TABLE (name text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(trim(p.faculty), ''), 'Unspecified')::text AS name,
         COUNT(*)::bigint AS count
  FROM public.materials p
  WHERE p.faculty IS NOT NULL
  GROUP BY name
  ORDER BY count DESC, name ASC;
$$;

CREATE OR REPLACE FUNCTION public.count_materials_by_department()
RETURNS TABLE (name text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(trim(p.department), ''), 'Unspecified')::text AS name,
         COUNT(*)::bigint AS count
  FROM public.materials p
  WHERE p.department IS NOT NULL
  GROUP BY name
  ORDER BY count DESC, name ASC;
$$;

REVOKE ALL ON FUNCTION public.count_students_by_gender() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_materials_by_faculty() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_materials_by_department() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.count_students_by_gender() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_materials_by_faculty() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_materials_by_department() TO anon, authenticated, service_role;