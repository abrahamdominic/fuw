-- ==============================================================================
-- FUW E-Library — Multi-Department Material Assignment Migration
-- Allows assigning one material to multiple departments and faculties.
-- ==============================================================================

-- 1. Create junction table for material <-> department assignments
CREATE TABLE IF NOT EXISTS public.material_departments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id   UUID NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT material_departments_unique UNIQUE (material_id, department_id)
);

COMMENT ON TABLE public.material_departments IS 'Many-to-many junction table assigning materials to one or multiple departments.';
COMMENT ON COLUMN public.material_departments.material_id IS 'Foreign key reference to materials table.';
COMMENT ON COLUMN public.material_departments.department_id IS 'Foreign key reference to departments table.';

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_material_departments_material_id
  ON public.material_departments (material_id);

CREATE INDEX IF NOT EXISTS idx_material_departments_department_id
  ON public.material_departments (department_id);

-- 3. Enable Row Level Security
ALTER TABLE public.material_departments ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
DROP POLICY IF EXISTS "material_departments_read_policy" ON public.material_departments;
CREATE POLICY "material_departments_read_policy" ON public.material_departments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_departments.material_id
        AND (m.status = 'approved' OR m.uploaded_by = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "material_departments_insert_policy" ON public.material_departments;
CREATE POLICY "material_departments_insert_policy" ON public.material_departments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_departments.material_id
        AND m.uploaded_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "material_departments_update_policy" ON public.material_departments;
CREATE POLICY "material_departments_update_policy" ON public.material_departments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "material_departments_delete_policy" ON public.material_departments;
CREATE POLICY "material_departments_delete_policy" ON public.material_departments
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_departments.material_id
        AND m.uploaded_by = auth.uid()
        AND m.status <> 'approved'
    )
  );

-- 5. Automatic Primary Department Synchronization Trigger
-- When a material is inserted or its primary department_id is changed,
-- automatically ensure it exists in the material_departments junction table.
CREATE OR REPLACE FUNCTION public.sync_material_primary_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    INSERT INTO public.material_departments (material_id, department_id)
    VALUES (NEW.id, NEW.department_id)
    ON CONFLICT (material_id, department_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_material_primary_department ON public.materials;
CREATE TRIGGER trg_sync_material_primary_department
  AFTER INSERT OR UPDATE OF department_id ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_primary_department();

-- 6. Backfill existing materials into material_departments
-- Ensures all existing materials continue appearing exactly as they currently do.
INSERT INTO public.material_departments (material_id, department_id)
SELECT m.id, COALESCE(m.department_id, d.id)
FROM public.materials m
LEFT JOIN public.departments d ON lower(trim(d.name)) = lower(trim(m.department))
WHERE COALESCE(m.department_id, d.id) IS NOT NULL
ON CONFLICT (material_id, department_id) DO NOTHING;

-- 7. Helper RPC for atomic multi-department assignment
CREATE OR REPLACE FUNCTION public.assign_material_departments(
  p_material_id UUID,
  p_department_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_dept_id UUID;
  v_dept_name TEXT;
  v_faculty_id UUID;
  v_fac_name TEXT;
BEGIN
  -- Permission check: caller must be admin or the material's unapproved uploader
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.materials
      WHERE id = p_material_id AND uploaded_by = auth.uid() AND status <> 'approved'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to assign departments to this material.';
  END IF;

  -- Delete removed assignments
  DELETE FROM public.material_departments
  WHERE material_id = p_material_id
    AND NOT (department_id = ANY(p_department_ids));

  -- Insert new assignments
  INSERT INTO public.material_departments (material_id, department_id)
  SELECT p_material_id, unnest(p_department_ids)
  ON CONFLICT (material_id, department_id) DO NOTHING;

  -- Keep the primary department & faculty fields in sync on public.materials
  IF array_length(p_department_ids, 1) > 0 THEN
    v_first_dept_id := p_department_ids[1];
    SELECT d.name, d.faculty_id, f.name
      INTO v_dept_name, v_faculty_id, v_fac_name
      FROM public.departments d
      LEFT JOIN public.faculties f ON f.id = d.faculty_id
     WHERE d.id = v_first_dept_id;

    IF v_dept_name IS NOT NULL THEN
      UPDATE public.materials
      SET department_id = v_first_dept_id,
          department = v_dept_name,
          faculty_id = COALESCE(v_faculty_id, faculty_id),
          faculty = COALESCE(v_fac_name, faculty),
          updated_at = NOW()
      WHERE id = p_material_id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_material_departments(UUID, UUID[]) TO authenticated;
