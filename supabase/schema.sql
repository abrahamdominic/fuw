-- ==============================================================================
-- Federal University Wukari (FUW) E-Library Repository - Supabase Schema
-- Run this entire script in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ==============================================================================

-- 1. Create Enums for Role & Approval Status
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('student', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'material_status') THEN
    CREATE TYPE public.material_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

-- 2. Create User Profiles Table (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  email TEXT NOT NULL UNIQUE,
  matric_number TEXT UNIQUE,
  faculty TEXT,
  department TEXT,
  level TEXT,
  bio TEXT,
  role public.app_role NOT NULL DEFAULT 'student',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Academic Materials Table
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  faculty TEXT NOT NULL,
  department TEXT NOT NULL,
  level TEXT NOT NULL,
  course_code TEXT,
  course_title TEXT,
  semester TEXT,
  academic_session TEXT,
  material_type TEXT DEFAULT 'E-Book / Text',
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.material_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

-- 5. Helper Security Functions
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Public aggregate statistics (safe for anonymous visitors - returns only
-- counts, never personal data). Used by the homepage / hero / admin stats.
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS TABLE (students BIGINT, verified_students BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (
      WHERE matric_number IS NOT NULL AND matric_number <> ''
    )::BIGINT
  FROM public.profiles;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;

-- 6. RLS Policies for Profiles Table
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT USING (
    id = auth.uid() OR public.is_admin()
  );

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (
    -- Normal users cannot elevate their own role to admin
    (id = auth.uid() AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()))
    OR public.is_admin()
  );

-- 7. RLS Policies for Materials Table
DROP POLICY IF EXISTS "materials_public_read_policy" ON public.materials;
CREATE POLICY "materials_public_read_policy" ON public.materials
  FOR SELECT USING (
    status = 'approved' OR uploaded_by = auth.uid() OR public.is_admin()
  );

DROP POLICY IF EXISTS "materials_insert_policy" ON public.materials;
CREATE POLICY "materials_insert_policy" ON public.materials
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND (status = 'pending' OR public.is_admin())
  );

DROP POLICY IF EXISTS "materials_admin_update_policy" ON public.materials;
CREATE POLICY "materials_admin_update_policy" ON public.materials
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "materials_delete_policy" ON public.materials;
CREATE POLICY "materials_delete_policy" ON public.materials
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_admin());

-- 8. Trigger to Automatically Create Profile on Auth Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    display_name,
    role
  ) VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    COALESCE((new.raw_user_meta_data->>'role')::public.app_role, 'student')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 9. Trigger for Updated_at Timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_materials_updated_at ON public.materials;
CREATE TRIGGER set_materials_updated_at
  BEFORE UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 10. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_materials_status ON public.materials(status);
CREATE INDEX IF NOT EXISTS idx_materials_faculty ON public.materials(faculty);
CREATE INDEX IF NOT EXISTS idx_materials_department ON public.materials(department);
CREATE INDEX IF NOT EXISTS idx_materials_level ON public.materials(level);
CREATE INDEX IF NOT EXISTS idx_materials_uploaded_by ON public.materials(uploaded_by);

-- 11. Storage Bucket Configuration (Run in Storage SQL Editor if bucket doesn't exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-materials', 'library-materials', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS Policies
DROP POLICY IF EXISTS "Public read storage" ON storage.objects;
CREATE POLICY "Public read storage" ON storage.objects
  FOR SELECT USING (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "Authenticated upload storage" ON storage.objects;
CREATE POLICY "Authenticated upload storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'library-materials');

