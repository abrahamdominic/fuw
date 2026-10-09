-- Upgrade search_students to allow directory discovery by username, name, department, faculty, and matric number
DROP FUNCTION IF EXISTS public.search_students(text, integer);
CREATE OR REPLACE FUNCTION public.search_students(
  p_query text,
  p_limit integer DEFAULT 15
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  display_name text,
  matric_number text,
  faculty text,
  department text,
  level text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pr.id,
    pr.username,
    pr.full_name,
    COALESCE(pr.display_name, split_part(pr.full_name, ' ', 1)) as display_name,
    pr.matric_number,
    pr.faculty,
    pr.department,
    pr.level
  FROM public.profiles pr
  WHERE
    pr.id <> auth.uid()
    AND pr.role = 'student'
    AND pr.is_active = true
    AND (
      (pr.username IS NOT NULL AND pr.username ILIKE '%' || trim(p_query) || '%')
      OR (pr.full_name IS NOT NULL AND pr.full_name ILIKE '%' || trim(p_query) || '%')
      OR (pr.department IS NOT NULL AND pr.department ILIKE '%' || trim(p_query) || '%')
      OR (pr.faculty IS NOT NULL AND pr.faculty ILIKE '%' || trim(p_query) || '%')
      OR (pr.matric_number IS NOT NULL AND pr.matric_number ILIKE '%' || trim(p_query) || '%')
    )
  ORDER BY
    CASE 
      WHEN pr.username ILIKE trim(p_query) || '%' THEN 0 
      WHEN pr.full_name ILIKE trim(p_query) || '%' THEN 1
      ELSE 2 
    END,
    pr.username NULLS LAST,
    pr.full_name
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.search_students(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_students(text, integer) TO authenticated;
