-- =====================================================================
-- FUW E-Library — COMPLETE DATABASE (fresh design, production-safe)
-- =====================================================================
-- Paste into: Supabase Dashboard → SQL Editor → New Query
--
-- Fresh-database design (no existing schema assumed). Idempotent.
-- auth.users is NEVER modified or deleted — profiles link to it.
-- The whole script runs inside the SQL Editor's single transaction,
-- so a failure anywhere rolls back everything cleanly.
--
-- Contents
--   0.  Extensions                     12. Triggers (auth→profile, invites,
--   1.  Enums (app_role,                   login tracking, updated_at,
--       material_status, material_type)    catalogue sync)
--   2.  Faculties / Departments        13. Row Level Security + policies
--       / Levels / Courses tables      14. Privilege model (grants +
--   3.  Profiles / Materials /             default privileges)
--       Notifications / Admin invites  15. Storage bucket + policies
--       / AI tables                    23. Initial FUW academic rows
--   4.  Indexes                            (real catalogue data)
--   5.  Authorization helpers          25. Verification — raises a clear
--   6.  Super-admin management RPCs        exception if anything failed
--   7.  Material review RPCs
--   8.  Username/password auth RPCs
--   9.  Public statistics RPCs
--   10. AI semantic search (pgvector)
--
-- Design notes
--   * materials carries FK columns (faculty_id, department_id, course_id,
--     level_id) per the normalized design PLUS mirrored display columns
--     (faculty, department, level) kept in sync by the
--     sync_material_catalogue trigger, so both relational integrity and
--     fast name-based filtering/read models are preserved.
--   * material_type enum includes every label ever used by the app,
--     including the current canonical 'Test Past Questions'.
--   * profiles.username backs the username+password login that ships
--     with this app (unique, case-insensitive).
-- =====================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgcrypto unavailable: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector unavailable (AI embeddings disabled): %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Enums (fresh creation avoids ALTER TYPE ADD VALUE transaction traps)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('student', 'admin', 'super_admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'material_status') THEN
    CREATE TYPE public.material_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'material_type') THEN
    -- Includes legacy labels ('Test Questions', 'Textbook') alongside the
    -- canonical app labels so historical rows and new uploads both fit.
    CREATE TYPE public.material_type AS ENUM (
      'Test Questions',
      'Test Past Questions',
      'Exam Past Questions',
      'Projects',
      'Handouts',
      'Lecture Note',
      'Textbook'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Academic catalogue tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.faculties (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  short_name     TEXT,
  duration_years INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id     UUID NOT NULL REFERENCES public.faculties(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  code           TEXT,
  duration_years INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT departments_faculty_name_unique UNIQUE (faculty_id, name)
);

CREATE TABLE IF NOT EXISTS public.levels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  numeric_level INTEGER NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.courses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id     UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  course_code       TEXT NOT NULL,
  course_title      TEXT NOT NULL,
  level_id          UUID REFERENCES public.levels(id),
  semester          TEXT,
  credit_units      INTEGER,
  is_general_course BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT courses_department_code_unique UNIQUE (department_id, course_code)
);

COMMENT ON TABLE public.faculties   IS 'Official FUW faculties (seeded below; super_admin editable).';
COMMENT ON TABLE public.departments IS 'Departments grouped under faculties (seeded below).';
COMMENT ON TABLE public.levels      IS 'Study levels 100–600 (never 1000+).';
COMMENT ON TABLE public.courses     IS 'Course catalogue per department; codes ending in C are general/common courses.';

-- -----------------------------------------------------------------------------
-- 3. Application tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL DEFAULT '',
  display_name  TEXT,
  email         TEXT,
  username      TEXT,
  matric_number TEXT,
  faculty       TEXT,
  department    TEXT,
  level         TEXT,
  bio           TEXT,
  avatar_url    TEXT,
  role          public.app_role NOT NULL DEFAULT 'student',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  permissions   TEXT[] NOT NULL DEFAULT '{}',
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.profiles.role IS 'Authorization role managed by DB triggers/RPCs only — never trusted from the client.';
COMMENT ON COLUMN public.profiles.username IS 'Unique case-insensitive username used for password login.';
-- Unique matric numbers only for real values (multiple '' would break a plain UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_matric_unique_idx
  ON public.profiles (matric_number)
  WHERE matric_number IS NOT NULL AND matric_number <> '';

CREATE TABLE IF NOT EXISTS public.materials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  faculty_id       UUID REFERENCES public.faculties(id) ON DELETE SET NULL,
  department_id    UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  course_id        UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  level_id         UUID REFERENCES public.levels(id) ON DELETE SET NULL,
  faculty          TEXT NOT NULL DEFAULT '',
  department       TEXT NOT NULL DEFAULT '',
  level            TEXT NOT NULL DEFAULT '',
  course_code      TEXT NOT NULL DEFAULT '',
  course_title     TEXT,
  semester         TEXT NOT NULL DEFAULT '',
  academic_session TEXT NOT NULL DEFAULT '',
  material_type    public.material_type NOT NULL DEFAULT 'Lecture Note',
  file_url         TEXT NOT NULL DEFAULT '',
  file_path        TEXT,
  file_name        TEXT NOT NULL DEFAULT '',
  file_size        TEXT,
  downloads        INTEGER NOT NULL DEFAULT 0 CHECK (downloads >= 0),
  views            INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  uploaded_by      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status           public.material_status NOT NULL DEFAULT 'pending',
  approved_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.materials.faculty_id    IS 'Resolved from materials.faculty by the catalogue-sync trigger.';
COMMENT ON COLUMN public.materials.faculty       IS 'Mirrored display name kept in sync with faculties.id.';
COMMENT ON COLUMN public.materials.file_path     IS 'Storage path used for cleanup on delete.';
COMMENT ON COLUMN public.materials.status        IS 'Students always start pending; permitted admins may upload pre-approved.';

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL DEFAULT '',
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_id  UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  title        TEXT NOT NULL DEFAULT 'New conversation',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  citations       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_processing_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id    UUID NOT NULL UNIQUE REFERENCES public.materials(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  chunks_created INTEGER NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.material_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id  UUID NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,
  page_number  INTEGER,
  course_code  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  embedding    VECTOR(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_username    ON public.profiles (lower(trim(username)));
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (lower(trim(username)))
  WHERE username IS NOT NULL AND trim(username) <> '';
CREATE INDEX IF NOT EXISTS idx_profiles_role       ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_faculty    ON public.profiles (faculty);
CREATE INDEX IF NOT EXISTS idx_profiles_department ON public.profiles (department);
CREATE INDEX IF NOT EXISTS idx_profiles_matric     ON public.profiles (matric_number)
  WHERE matric_number IS NOT NULL AND matric_number <> '';

CREATE INDEX IF NOT EXISTS idx_materials_status      ON public.materials (status);
CREATE INDEX IF NOT EXISTS idx_materials_faculty_id  ON public.materials (faculty_id);
CREATE INDEX IF NOT EXISTS idx_materials_department_id ON public.materials (department_id);
CREATE INDEX IF NOT EXISTS idx_materials_course_id   ON public.materials (course_id);
CREATE INDEX IF NOT EXISTS idx_materials_level_id    ON public.materials (level_id);
CREATE INDEX IF NOT EXISTS idx_materials_course_code ON public.materials (upper(course_code));
CREATE INDEX IF NOT EXISTS idx_materials_uploaded_by ON public.materials (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_materials_created_at  ON public.materials (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_courses_code      ON public.courses (upper(course_code));
CREATE INDEX IF NOT EXISTS idx_courses_department ON public.courses (department_id);
CREATE INDEX IF NOT EXISTS idx_departments_faculty ON public.departments (faculty_id);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON public.ai_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_material_chunks_material ON public.material_chunks (material_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_material_chunks_embedding
             ON public.material_chunks USING ivfflat (embedding vector_cosine_ops)
             WITH (lists = 100)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Embedding index skipped: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Authorization helpers — SECURITY DEFINER with pinned search_path so
--    policy expressions never recurse into the RLS they evaluate.
--    my_stored_role explicitly casts the stored value to public.app_role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_stored_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT role::public.app_role FROM public.profiles WHERE id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.my_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_active FROM public.profiles WHERE id = auth.uid()), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT permissions FROM public.profiles WHERE id = auth.uid()), '{}');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'::public.app_role AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role) AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_super_admin() THEN TRUE
    ELSE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'::public.app_role AND is_active
        AND (permission = ANY (permissions) OR '{*}' <@ permissions)
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION
  public.my_stored_role(), public.my_is_active(), public.my_permissions(),
  public.is_super_admin(), public.is_admin(), public.has_permission(text)
TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Super-admin management RPCs.
--    Argument names match the frontend call sites exactly
--    (target_user_id / admin_permissions / new_full_name / active /
--     invite_email / invite_full_name).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_first_super_admin(target_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE super_count integer;
BEGIN
  SELECT COUNT(*) INTO super_count FROM public.profiles WHERE role = 'super_admin';
  IF super_count > 0 THEN
    RAISE EXCEPTION 'A Super Admin already exists. Only the first account can be promoted this way.';
  END IF;
  UPDATE public.profiles
     SET role = 'super_admin'::public.app_role, is_active = TRUE, permissions = '{}'
   WHERE lower(email) = lower(trim(target_email));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile found for %. Register at /register first, then retry.', target_email;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.promote_to_admin(target_user_id uuid, admin_permissions text[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can manage administrators.';
  END IF;
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use promote_first_super_admin for your own account.';
  END IF;
  UPDATE public.profiles
     SET role = 'admin'::public.app_role,
         permissions = COALESCE(admin_permissions, '{}'),
         is_active = TRUE
   WHERE id = target_user_id AND role = 'student';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found or is already an administrator.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.demote_admin(target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can manage administrators.';
  END IF;
  UPDATE public.profiles
     SET role = 'student'::public.app_role, permissions = '{}'
   WHERE id = target_user_id
     AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
     AND id <> auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator not found (you cannot demote yourself).';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_admin_active(target_user_id uuid, active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can manage administrators.';
  END IF;
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot deactivate your own account.';
  END IF;
  UPDATE public.profiles SET is_active = active
   WHERE id = target_user_id AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator not found.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_admin_permissions(target_user_id uuid, admin_permissions text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can assign permissions.';
  END IF;
  UPDATE public.profiles SET permissions = COALESCE(admin_permissions, '{}')
   WHERE id = target_user_id AND role = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin not found (Super Admin permissions are implicit and cannot be edited here).';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_admin_details(target_user_id uuid, new_full_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can edit administrator accounts.';
  END IF;
  UPDATE public.profiles
     SET full_name = trim(new_full_name),
         display_name = split_part(trim(new_full_name), ' ', 1)
   WHERE id = target_user_id AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator not found.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_admin_invite(invite_email text, invite_full_name text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can invite administrators.';
  END IF;
  INSERT INTO public.admin_invites (email, full_name, invited_by)
  VALUES (lower(trim(invite_email)), trim(invite_full_name), auth.uid())
  ON CONFLICT (email) DO UPDATE
    SET accepted = FALSE, full_name = EXCLUDED.full_name, invited_by = EXCLUDED.invited_by;
END $$;

GRANT EXECUTE ON FUNCTION
  public.promote_first_super_admin(text),
  public.promote_to_admin(uuid, text[]),
  public.demote_admin(uuid),
  public.set_admin_active(uuid, boolean),
  public.update_admin_permissions(uuid, text[]),
  public.update_admin_details(uuid, text),
  public.create_admin_invite(text, text)
TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Material review RPCs — parameter names (p_material_id / p_note /
--    p_reason) match the frontend call sites exactly. Every action also
--    notifies the uploader automatically.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_material_rpc(p_material_id uuid, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record;
BEGIN
  IF NOT public.has_permission('approve_materials') THEN
    RAISE EXCEPTION 'You do not have permission to approve materials.';
  END IF;
  SELECT * INTO m FROM public.materials WHERE id = p_material_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Material not found.';
  END IF;
  UPDATE public.materials
     SET status = 'approved'::public.material_status,
         approved_by = auth.uid(),
         approved_at = NOW(),
         rejection_reason = NULL
   WHERE id = p_material_id;
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (m.uploaded_by, 'Material approved',
          COALESCE(NULLIF(p_note, ''),
                   'Your submission "' || m.title || '" was approved and is now live in the library.'),
          'success', '/materials/' || m.id::text);
END $$;

CREATE OR REPLACE FUNCTION public.reject_material_rpc(p_material_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record;
BEGIN
  IF NOT public.has_permission('reject_materials') THEN
    RAISE EXCEPTION 'You do not have permission to review materials.';
  END IF;
  SELECT * INTO m FROM public.materials WHERE id = p_material_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Material not found.';
  END IF;
  UPDATE public.materials
     SET status = 'rejected'::public.material_status,
         approved_by = auth.uid(),
         approved_at = NOW(),
         rejection_reason = COALESCE(NULLIF(p_reason, ''),
                                     'Does not meet academic submission standards.')
   WHERE id = p_material_id;
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (m.uploaded_by, 'Material rejected',
          COALESCE(NULLIF(p_reason, ''),
                   'Your submission "' || m.title || '" was rejected.'),
          'warning', '/student/uploads');
END $$;

CREATE OR REPLACE FUNCTION public.notify_material_deleted(material_title text, uploader uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (uploader, 'Material removed',
          'Your submission "' || material_title || '" was removed by a library administrator.',
          'warning', '/student/uploads');
$$;

-- -----------------------------------------------------------------------------
-- 8. Username/password authentication RPCs.
--    Passwords are NEVER stored in application tables — Supabase Auth
--    manages them exclusively (hashed, server-side).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_login_email(p_username text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(trim(p.email))
  FROM public.profiles p
  WHERE p.username IS NOT NULL
    AND lower(trim(p.username)) = lower(trim(p_username))
    AND p.is_active
    AND p.email IS NOT NULL AND trim(p.email) <> ''
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.register_identity_check(p_username text, p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'username_taken', EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.username IS NOT NULL AND lower(trim(p.username)) = lower(trim(p_username))
    ),
    'email_taken', EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.email IS NOT NULL AND lower(p.email) = lower(trim(p_email))
    )
  );
$$;

REVOKE ALL ON FUNCTION public.lookup_login_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_identity_check(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_login_email(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_identity_check(text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Statistics RPCs — aggregates only, never private student rows.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS TABLE (students bigint, verified_students bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE matric_number IS NOT NULL AND matric_number <> '')::bigint
  FROM public.profiles;
$$;

CREATE OR REPLACE FUNCTION public.get_library_stats()
RETURNS TABLE (total_materials bigint, total_downloads bigint, total_views bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FILTER (WHERE status = 'approved')::bigint,
         COALESCE(SUM(downloads) FILTER (WHERE status = 'approved'), 0)::bigint,
         COALESCE(SUM(views) FILTER (WHERE status = 'approved'), 0)::bigint
  FROM public.materials;
$$;

CREATE OR REPLACE FUNCTION public.get_material_status_counts()
RETURNS TABLE (pending bigint, approved bigint, rejected bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FILTER (WHERE status = 'pending')::bigint,
         COUNT(*) FILTER (WHERE status = 'approved')::bigint,
         COUNT(*) FILTER (WHERE status = 'rejected')::bigint
  FROM public.materials
  WHERE public.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.increment_download_count(material_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.materials SET downloads = downloads + 1
   WHERE id = material_id AND status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.increment_view_count(material_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.materials SET views = views + 1
   WHERE id = material_id AND status = 'approved';
$$;

GRANT EXECUTE ON FUNCTION
  public.get_public_stats(), public.get_library_stats(),
  public.increment_download_count(uuid), public.increment_view_count(uuid)
TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_material_status_counts() TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. AI semantic search over approved materials (requires pgvector).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE OR REPLACE FUNCTION public.match_material_chunks(
      query_embedding vector(1536),
      match_count integer DEFAULT 6,
      p_material_id uuid DEFAULT NULL,
      p_department text DEFAULT NULL,
      p_level text DEFAULT NULL,
      p_course_code text DEFAULT NULL
    )
    RETURNS TABLE (
      id uuid, material_id uuid, content text, chunk_index integer,
      page_number integer, similarity double precision
    )
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
      SELECT mc.id, mc.material_id, mc.content, mc.chunk_index, mc.page_number,
             1 - (mc.embedding <=> query_embedding) AS similarity
      FROM public.material_chunks mc
      JOIN public.materials m ON m.id = mc.material_id AND m.status = 'approved'
      WHERE (p_material_id IS NULL OR mc.material_id = p_material_id)
        AND (p_department IS NULL OR m.department = p_department)
        AND (p_level IS NULL OR m.level = p_level)
        AND (p_course_code IS NULL OR upper(m.course_code) = upper(p_course_code))
        AND mc.embedding IS NOT NULL
      ORDER BY mc.embedding <=> query_embedding
      LIMIT LEAST(COALESCE(match_count, 6), 20)
    $fn$;
    GRANT EXECUTE ON FUNCTION
      public.match_material_chunks(vector, integer, uuid, text, text, text)
    TO authenticated, service_role;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'match_material_chunks skipped: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 11. Catalogue sync trigger — keeps materials FK ids and their mirrored
--     display names consistent in BOTH directions, so clients may send
--     either form.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_material_catalogue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_text text;
BEGIN
  NEW.faculty    := COALESCE(trim(NEW.faculty), '');
  NEW.department := COALESCE(trim(NEW.department), '');
  NEW.level      := COALESCE(trim(NEW.level), '');
  NEW.course_code := COALESCE(trim(NEW.course_code), '');

  -- text -> id resolution
  IF NEW.faculty_id IS NULL AND NEW.faculty <> '' THEN
    SELECT f.id INTO NEW.faculty_id FROM public.faculties f
     WHERE lower(f.name) = lower(NEW.faculty);
  END IF;
  IF NEW.department_id IS NULL AND NEW.department <> '' THEN
    SELECT d.id INTO NEW.department_id
      FROM public.departments d
     WHERE lower(d.name) = lower(NEW.department)
       AND (NEW.faculty_id IS NULL OR d.faculty_id = NEW.faculty_id)
     LIMIT 1;
  END IF;
  IF NEW.level_id IS NULL AND NEW.level <> '' THEN
    SELECT l.id INTO NEW.level_id
      FROM public.levels l
     WHERE lower(l.name) = lower(NEW.level)
        OR l.numeric_level = NULLIF(regexp_replace(NEW.level, '\D', '', 'g'), '')::int
     LIMIT 1;
  END IF;
  IF NEW.course_id IS NULL AND NEW.course_code <> '' THEN
    SELECT c.id INTO NEW.course_id
      FROM public.courses c
     WHERE upper(c.course_code) = upper(NEW.course_code)
       AND (NEW.department_id IS NULL OR c.department_id = NEW.department_id)
     LIMIT 1;
  END IF;

  -- id -> canonical display text backfill
  IF NEW.faculty_id IS NOT NULL THEN
    SELECT f.name INTO v_text FROM public.faculties f WHERE f.id = NEW.faculty_id;
    IF v_text IS NOT NULL THEN NEW.faculty := v_text; END IF;
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT d.name INTO v_text FROM public.departments d WHERE d.id = NEW.department_id;
    IF v_text IS NOT NULL THEN NEW.department := v_text; END IF;
  END IF;
  IF NEW.level_id IS NOT NULL THEN
    SELECT l.name INTO v_text FROM public.levels l WHERE l.id = NEW.level_id;
    IF v_text IS NOT NULL THEN NEW.level := v_text; END IF;
  END IF;
  IF NEW.course_id IS NOT NULL THEN
    SELECT c.course_code, c.course_title
      INTO NEW.course_code, NEW.course_title
      FROM public.courses c WHERE c.id = NEW.course_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_materials_catalogue_sync ON public.materials;
CREATE TRIGGER trg_materials_catalogue_sync
  BEFORE INSERT OR UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_catalogue();

-- -----------------------------------------------------------------------------
-- 12. Triggers
-- -----------------------------------------------------------------------------
-- 12a. New auth user -> profile (default role student; username carried
--      over from signup metadata; existing roles never overwritten).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested_username text;
BEGIN
  requested_username := NULLIF(
    lower(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'username', ''),
                         '[^a-z0-9._-]', '', 'g')),
    ''
  );

  INSERT INTO public.profiles (id, email, full_name, display_name, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'display_name', ''), split_part(NEW.email, '@', 1)),
    requested_username,
    'student'::public.app_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email       = EXCLUDED.email,
    username    = CASE
                    WHEN public.profiles.username IS NULL OR trim(public.profiles.username) = ''
                      THEN EXCLUDED.username
                    ELSE public.profiles.username
                  END,
    role        = public.profiles.role,
    updated_at  = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 12b. Pending admin invitation applied at signup (profile created as
--      admin with the standard permission set; invite marked accepted).
CREATE OR REPLACE FUNCTION public.apply_admin_invite_on_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE invite record;
BEGIN
  SELECT * INTO invite FROM public.admin_invites
   WHERE email = lower(NEW.email) AND accepted = FALSE
   LIMIT 1;
  IF invite IS NOT NULL THEN
    NEW.role := 'admin'::public.app_role;
    NEW.permissions := '{approve_materials,reject_materials,delete_any_material,upload_as_approved,manage_students,view_analytics,manage_ai}';
    NEW.is_active := TRUE;
    UPDATE public.admin_invites SET accepted = TRUE WHERE id = invite.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_profile_invite_check ON public.profiles;
CREATE TRIGGER on_profile_invite_check
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.apply_admin_invite_on_signup();

-- 12c. Login tracking — last_sign_in_at changes bump profiles.last_login_at.
CREATE OR REPLACE FUNCTION public.touch_last_login()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET last_login_at = NOW() WHERE id = NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_login_touch ON auth.users;
CREATE TRIGGER on_auth_login_touch
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.touch_last_login();

-- 12d. updated_at maintenance everywhere the column exists.
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.faculties;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.faculties
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.departments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.courses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.materials;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.ai_conversations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.ai_processing_jobs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ai_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 12e. Deletion notices — whenever someone OTHER than the uploader removes
--      a material, the uploader is notified automatically (works for any
--      client; guarded against account-cascade deletions).
CREATE OR REPLACE FUNCTION public.handle_material_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(auth.uid()::text, '') = COALESCE(OLD.uploaded_by::text, '') THEN
    RETURN OLD;  -- uploader removing their own upload (or upload rollback)
  END IF;
  BEGIN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.uploaded_by, 'Material removed',
            'Your submission "' || OLD.title || '" was removed by a library administrator.',
            'warning', '/student/uploads');
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;  -- uploader's account is being deleted
    WHEN check_violation        THEN NULL;
  END;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS on_material_deleted_notify ON public.materials;
CREATE TRIGGER on_material_deleted_notify
  AFTER DELETE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.handle_material_deleted();


-- -----------------------------------------------------------------------------
-- 13. Row Level Security + policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levels             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_chunks    ENABLE ROW LEVEL SECURITY;

-- profiles -------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Self-service updates may never touch role/is_active/permissions;
-- only the Super Admin can change those (via dedicated RPCs or directly).
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin())
  WITH CHECK (
    public.is_super_admin()
    OR (
      id = auth.uid()
      AND role = public.my_stored_role()
      AND is_active = public.my_is_active()
      AND permissions = public.my_permissions()
    )
  );

-- catalogue ------------------------------------------------------------------
DROP POLICY IF EXISTS "faculties_public_read" ON public.faculties;
CREATE POLICY "faculties_public_read" ON public.faculties
  FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "faculties_super_manage" ON public.faculties;
CREATE POLICY "faculties_super_manage" ON public.faculties
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "departments_public_read" ON public.departments;
CREATE POLICY "departments_public_read" ON public.departments
  FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "departments_super_manage" ON public.departments;
CREATE POLICY "departments_super_manage" ON public.departments
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "levels_public_read" ON public.levels;
CREATE POLICY "levels_public_read" ON public.levels
  FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "levels_super_manage" ON public.levels;
CREATE POLICY "levels_super_manage" ON public.levels
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "courses_public_read" ON public.courses;
CREATE POLICY "courses_public_read" ON public.courses
  FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "courses_super_manage" ON public.courses;
CREATE POLICY "courses_super_manage" ON public.courses
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- materials ------------------------------------------------------------------
DROP POLICY IF EXISTS "materials_public_read_policy" ON public.materials;
CREATE POLICY "materials_public_read_policy" ON public.materials
  FOR SELECT USING (status = 'approved' OR uploaded_by = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "materials_insert_policy" ON public.materials;
CREATE POLICY "materials_insert_policy" ON public.materials
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (status = 'pending' OR public.has_permission('upload_as_approved'))
  );

DROP POLICY IF EXISTS "materials_admin_update_policy" ON public.materials;
CREATE POLICY "materials_admin_update_policy" ON public.materials
  FOR UPDATE TO authenticated
  USING (public.has_permission('approve_materials') OR public.has_permission('upload_as_approved'))
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "materials_delete_policy" ON public.materials;
CREATE POLICY "materials_delete_policy" ON public.materials
  FOR DELETE TO authenticated
  USING ((uploaded_by = auth.uid() AND status <> 'approved')
         OR public.has_permission('delete_any_material'));

-- notifications ---------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- admin_invites ---------------------------------------------------------------
DROP POLICY IF EXISTS "admin_invites_super_all" ON public.admin_invites;
CREATE POLICY "admin_invites_super_all" ON public.admin_invites
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- AI tables --------------------------------------------------------------------
DROP POLICY IF EXISTS "ai_conversations_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_own" ON public.ai_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_messages_via_conversation" ON public.ai_messages;
CREATE POLICY "ai_messages_via_conversation" ON public.ai_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.ai_conversations c
            WHERE c.id = conversation_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.ai_conversations c
            WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ai_jobs_admin_read" ON public.ai_processing_jobs;
CREATE POLICY "ai_jobs_admin_read" ON public.ai_processing_jobs
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "material_chunks_read_auth" ON public.material_chunks;
CREATE POLICY "material_chunks_read_auth" ON public.material_chunks
  FOR SELECT TO authenticated USING (TRUE);

-- -----------------------------------------------------------------------------
-- 14. Privilege model. RLS alone is not sufficient — PostgREST needs the
--     underlying table grants too (missing GRANTs surface as "permission
--     denied" API errors even when policies look right).
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- anon gets read-only access; RLS policies decide what is actually visible.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;

-- -----------------------------------------------------------------------------
-- 15. Storage bucket + policies
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-materials', 'library-materials', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "library-materials public read" ON storage.objects;
CREATE POLICY "library-materials public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "library-materials authenticated upload" ON storage.objects;
CREATE POLICY "library-materials authenticated upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "library-materials owner update" ON storage.objects;
CREATE POLICY "library-materials owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'library-materials' AND (owner = auth.uid() OR public.is_admin()))
  WITH CHECK (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "library-materials owner delete" ON storage.objects;
CREATE POLICY "library-materials owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'library-materials' AND (owner = auth.uid() OR public.is_admin()));

-- ---------------------------------------------------------------------
-- 23. INITIAL FUW ACADEMIC STRUCTURE (seeded from src/data/catalogue.ts)
--    Real faculties/departments/courses only — nothing invented.
-- ---------------------------------------------------------------------

INSERT INTO public.levels (name, numeric_level) VALUES
  ('100 Level', 100),
  ('200 Level', 200),
  ('300 Level', 300),
  ('400 Level', 400),
  ('500 Level', 500),
  ('600 Level', 600)
ON CONFLICT (numeric_level) DO NOTHING;

INSERT INTO public.faculties (name, duration_years) VALUES
  ('Faculty of Bio-Sciences', 4),
  ('Faculty of Computing & Information System', 4),
  ('Faculty of Social Sciences', 4),
  ('Faculty of Agriculture & Life Sciences', 5),
  ('Faculty of Physical Sciences', 4),
  ('Faculty of Education', 4),
  ('Faculty of Engineering', 5),
  ('Faculty of Humanities', 4),
  ('Faculty of Law', 5),
  ('Faculty of Management Sciences', 4),
  ('Faculty of Basic Medical Sciences', 4),
  ('Faculty of Allied Health Sciences', 5),
  ('Faculty of Clinical Sciences', 6),
  ('Faculty of Basic Clinical Sciences', 4)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.departments (faculty_id, name, duration_years)
SELECT fa.id, d.dept, d.dur FROM (VALUES
  ('Faculty of Bio-Sciences', 'Biochemistry', 4),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 4),
  ('Faculty of Bio-Sciences', 'Biotechnology', 4),
  ('Faculty of Bio-Sciences', 'Botany', 4),
  ('Faculty of Bio-Sciences', 'Microbiology', 4),
  ('Faculty of Bio-Sciences', 'Zoology', 4),
  ('Faculty of Computing & Information System', 'Computer Science', 4),
  ('Faculty of Computing & Information System', 'Information Technology', 4),
  ('Faculty of Computing & Information System', 'Information Systems', 4),
  ('Faculty of Computing & Information System', 'Cyber Security', 4),
  ('Faculty of Computing & Information System', 'Software Engineering', 4),
  ('Faculty of Social Sciences', 'Sociology', 4),
  ('Faculty of Social Sciences', 'Economics', 4),
  ('Faculty of Social Sciences', 'Library & Information Science', 4),
  ('Faculty of Social Sciences', 'Political Science', 4),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 5),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 5),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 5),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 5),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 5),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 5),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 5),
  ('Faculty of Physical Sciences', 'Chemistry', 4),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 4),
  ('Faculty of Physical Sciences', 'Mathematics', 4),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 4),
  ('Faculty of Physical Sciences', 'Statistics', 4),
  ('Faculty of Education', 'Educational Foundations', 4),
  ('Faculty of Education', 'Curriculum Studies', 4),
  ('Faculty of Education', 'Educational Psychology', 4),
  ('Faculty of Education', 'Guidance & Counselling', 4),
  ('Faculty of Education', 'Science & Technical Education', 4),
  ('Faculty of Education', 'Chemistry Education', 4),
  ('Faculty of Education', 'Mathematics Education', 4),
  ('Faculty of Education', 'Physics Education', 4),
  ('Faculty of Engineering', 'Agricultural Engineering', 5),
  ('Faculty of Engineering', 'Chemical Engineering', 5),
  ('Faculty of Engineering', 'Civil Engineering', 5),
  ('Faculty of Engineering', 'Computer Engineering', 5),
  ('Faculty of Engineering', 'Mechanical Engineering', 5),
  ('Faculty of Humanities', 'African Traditional Religion', 4),
  ('Faculty of Humanities', 'Christian Religious Studies', 4),
  ('Faculty of Humanities', 'English & Literary Studies', 4),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 4),
  ('Faculty of Humanities', 'Islamic Religious Studies', 4),
  ('Faculty of Humanities', 'Philosophy', 4),
  ('Faculty of Law', 'Public & International Law', 5),
  ('Faculty of Law', 'Private & Commercial Law', 5),
  ('Faculty of Management Sciences', 'Accounting', 4),
  ('Faculty of Management Sciences', 'Banking & Finance', 4),
  ('Faculty of Management Sciences', 'Business Administration', 4),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 4),
  ('Faculty of Management Sciences', 'Public Administration', 4),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 4),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 4),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 5),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 5),
  ('Faculty of Clinical Sciences', 'Medicine', 6),
  ('Faculty of Clinical Sciences', 'Surgery', 6),
  ('Faculty of Clinical Sciences', 'Community Medicine', 6),
  ('Faculty of Clinical Sciences', 'Family Medicine', 6),
  ('Faculty of Clinical Sciences', 'Paediatrics', 6),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 4),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 4),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 4),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 4),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 4)
) AS d(faculty_name, dept, dur)
JOIN public.faculties fa ON fa.name = d.faculty_name
ON CONFLICT (faculty_id, name) DO NOTHING;

INSERT INTO public.courses (department_id, course_code, course_title, level_id, semester, is_general_course)
SELECT dep.id, c.code, c.name, lv.id, c.sem, right(c.code, 1) = 'C'
FROM (VALUES
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biochemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biology/Biological Sciences', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Biotechnology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Botany', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO101C', 'General Biology I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO107C', 'General Biology Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM101C', 'General Chemistry I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM107C', 'General Chemistry Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'COS101C', 'Introduction to Computing Science', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO102C', 'General Biology II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'BIO108C', 'General Biology Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM102C', 'General Chemistry II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'CHM108C', 'General Chemistry Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'MCB102F', 'Introductory Microbiology', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Microbiology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Bio-Sciences', 'Zoology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'COS101C', 'Introduction to Computing Sciences', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC103F', 'Fundamental of Programming Languages', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC105F', 'Computer Appreciation', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC107F', 'Introduction to Information Technology', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST107', 'Use of Library, Study Skills and Information and Communication Technology (ICT)', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'STA111C', 'Discriptive Statistics', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'COS102C', 'Problem Solving', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC104F', 'Hardware System & Maintenance', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC106F', 'Introduction to Programming Language', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'CSC108F', 'Introduction to File Processing and Management', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST108', 'Communication in French', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'STA122C', 'Statistical Computing I', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Computer Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Technology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Information Systems', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Cyber Security', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Computing & Information System', 'Software Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC301C', 'Methods of Social Research Statistics', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC303C', 'Sociology of Crime and Delinquency', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC305C', 'Political Sociology', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC307C', 'Organizational Behaviour', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SSC301', 'Innovation in the Social Sciences', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST312C', 'Venture Creation', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC302C', 'Social Inequality', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC306C', 'Formal Organisations', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC308C', 'Group Dynamics and Intergroup Relations', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC310C', 'Rural Sociology', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC312C', 'Demography and Population Studies', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SOC314C', 'Sociology of Medicine, Health and Illness', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'SSC302', 'Research Method I', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Sociology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Economics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Library & Information Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Social Sciences', 'Political Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Agricultural Economics & Extension', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Animal Production & Health', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Crop Production & Protection', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Fisheries & Aquaculture', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Food Science & Technology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Forestry & Wildlife Management', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Agriculture & Life Sciences', 'Soil Science & Land Resources Management', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Chemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Industrial Chemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Mathematics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Pure & Applied Physics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'MTH101C', 'Elementary Mathematics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY101C', 'General Physics I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY107C', 'General Physics Practical I', 100, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'MTH102C', 'Elementary Mathematics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY102C', 'General Physics II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'PHY108C', 'General Physics Practical II', 100, 'Second Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Physical Sciences', 'Statistics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Educational Foundations', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Curriculum Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Educational Psychology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Guidance & Counselling', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Science & Technical Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Chemistry Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Mathematics Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Education', 'Physics Education', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Education', 'Physics Education', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Education', 'Physics Education', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Education', 'Physics Education', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Agricultural Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Chemical Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Civil Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Computer Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Engineering', 'Mechanical Engineering', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'African Traditional Religion', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'Christian Religious Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'English & Literary Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'History & Diplomatic Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'Islamic Religious Studies', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Humanities', 'Philosophy', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Law', 'Public & International Law', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Law', 'Private & Commercial Law', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Accounting', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Banking & Finance', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Business Administration', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Hospitality & Tourism Management', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Management Sciences', 'Public Administration', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Anatomy', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Medical Sciences', 'Human Physiology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Medical Laboratory Science', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Allied Health Sciences', 'Physiotherapy', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Medicine', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Surgery', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Community Medicine', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Family Medicine', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Clinical Sciences', 'Paediatrics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Medical Biochemistry', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Chemical Pathology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Histopathology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Haematology', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST111C', 'Communication in English 1', 100, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST112C', 'Nigerian Peoples Culture & Citizenship', 100, 'Second Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST311C', 'Introduction to Entrepreneurial Skills', 300, 'First Semester'),
  ('Faculty of Basic Clinical Sciences', 'Pharmacology/Therapeutics', 'GST312', 'Peace & Conflict Resolution', 300, 'Second Semester')
) AS c(faculty_name, dept_name, code, name, lvl, sem)
JOIN public.departments dep ON dep.name = c.dept_name
JOIN public.faculties fa ON fa.id = dep.faculty_id AND fa.name = c.faculty_name
JOIN public.levels lv ON lv.numeric_level = c.lvl
ON CONFLICT (department_id, course_code) DO NOTHING;
-- -----------------------------------------------------------------------------
-- 24. BACKFILL PROFILES FOR PRE-EXISTING AUTH ACCOUNTS.
--     auth.users survives resets, but the signup trigger above only fires
--     for NEW registrations. This gives every existing auth account a
--     matching student profile (unique username derived from the email,
--     collision-safe suffixes) so nobody is locked out after a rebuild.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  u record;
  base text;
  candidate text;
  i int;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.last_sign_in_at
    FROM auth.users au
    WHERE au.email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = au.id)
  LOOP
    base := lower(regexp_replace(split_part(u.email, '@', 1), '[^a-z0-9._-]', '', 'g'));
    IF base IS NULL OR base = '' THEN
      base := 'user';
    END IF;

    candidate := base;
    i := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE lower(trim(p.username)) = candidate
    ) LOOP
      i := i + 1;
      candidate := base || '-' || i::text;
    END LOOP;

    INSERT INTO public.profiles (id, email, username, full_name, display_name, role, last_login_at)
    VALUES (
      u.id,
      u.email,
      candidate,
      split_part(u.email, '@', 1),
      split_part(u.email, '@', 1),
      'student'::public.app_role,
      u.last_sign_in_at
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Backfill pass finished: every existing auth account now has a profile.';
END $$;

-- -----------------------------------------------------------------------------
-- 25. VERIFICATION — every check below must pass or the whole migration
--     fails with a clear exception naming exactly what is wrong.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  problems text[] := '{}';
  v text;
  n bigint;
BEGIN
  -- 1. Enum column types -----------------------------------------------------
  SELECT udt_name INTO v FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';
  IF v IS DISTINCT FROM 'app_role' THEN
    problems := problems || array['profiles.role is "' || COALESCE(v,'NULL') || '" — expected app_role'];
  END IF;

  SELECT udt_name INTO v FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'status';
  IF v IS DISTINCT FROM 'material_status' THEN
    problems := problems || array['materials.status is "' || COALESCE(v,'NULL') || '" — expected material_status'];
  END IF;

  SELECT udt_name INTO v FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'material_type';
  IF v IS DISTINCT FROM 'material_type' THEN
    problems := problems || array['materials.material_type is "' || COALESCE(v,'NULL') || '" — expected material_type enum'];
  END IF;

  -- 2. Required tables --------------------------------------------------------
  SELECT COUNT(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('profiles','faculties','departments','levels','courses',
                        'materials','notifications','admin_invites',
                        'ai_conversations','ai_messages','ai_processing_jobs',
                        'material_chunks');
  IF n <> 12 THEN
    problems := problems || array['expected 12 application tables, found ' || n];
  END IF;

  -- 3. Required functions ------------------------------------------------------
  SELECT COUNT(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN (
     'my_stored_role','my_is_active','my_permissions','is_admin','is_super_admin',
     'has_permission','promote_first_super_admin','promote_to_admin','demote_admin',
     'set_admin_active','update_admin_details','update_admin_permissions',
     'create_admin_invite','approve_material_rpc','reject_material_rpc',
     'notify_material_deleted','lookup_login_email','register_identity_check',
     'get_public_stats','get_library_stats','increment_download_count',
     'increment_view_count','handle_new_user','sync_material_catalogue',
     'handle_material_deleted');
  IF n < 25 THEN
    problems := problems || array['expected >= 25 required functions, found ' || n];
  END IF;

  -- 4. my_stored_role must return public.app_role -------------------------------
  SELECT COUNT(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'my_stored_role'
     AND (SELECT t.typname FROM pg_type t WHERE t.oid = p.prorettype) = 'app_role';
  IF n <> 1 THEN
    problems := problems || array['my_stored_role() does not return public.app_role'];
  END IF;

  -- 5. RLS enabled on all application tables -----------------------------------
  SELECT COUNT(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('profiles','faculties','departments','levels','courses',
                       'materials','notifications','admin_invites',
                       'ai_conversations','ai_messages','ai_processing_jobs',
                       'material_chunks')
     AND c.relrowsecurity;
  IF n <> 12 THEN
    problems := problems || array['RLS enabled on ' || n || '/12 tables'];
  END IF;

  -- 6. Required indexes ---------------------------------------------------------
  SELECT COUNT(*) INTO n FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'profiles_matric_unique_idx','profiles_username_unique_idx',
       'idx_profiles_email_lower','idx_profiles_role','idx_profiles_faculty',
       'idx_profiles_department','idx_profiles_matric',
       'idx_materials_status','idx_materials_faculty_id','idx_materials_department_id',
       'idx_materials_course_id','idx_materials_level_id','idx_materials_course_code',
       'idx_materials_uploaded_by','idx_materials_created_at',
       'idx_notifications_user_created',
       'idx_courses_code','idx_courses_department',
       'idx_departments_faculty');
  IF n < 19 THEN
    problems := problems || array['expected >= 19 required indexes, found ' || n];
  END IF;

  -- 7. Foreign keys --------------------------------------------------------------
  --    materials: faculty_id, department_id, course_id, level_id,
  --               uploaded_by, approved_by
  SELECT COUNT(*) INTO n
   FROM (
     SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.materials'::regclass AND contype = 'f'
   ) fks;
  IF n < 6 THEN
    problems := problems || array['materials expected >= 6 foreign keys, found ' || n];
  END IF;

  -- 8. Seeded catalogue ------------------------------------------------------------
  SELECT COUNT(*) INTO n FROM public.faculties;
  IF n < 14 THEN
    problems := problems || array['faculties under-seeded: ' || n || ' rows (expected >= 14)'];
  END IF;

  SELECT COUNT(*) INTO n FROM public.levels;
  IF n <> 6 THEN
    problems := problems || array['levels must contain exactly the 6 rows 100–600, found ' || n];
  END IF;

  SELECT COUNT(*) INTO n FROM public.departments;
  IF n < 60 THEN
    problems := problems || array['departments under-seeded: ' || n || ' rows (expected >= 60)'];
  END IF;

  SELECT COUNT(*) INTO n FROM public.courses;
  IF n < 400 THEN
    problems := problems || array['courses under-seeded: ' || n || ' rows (expected >= 400)'];
  END IF;

  -- No 1000+ level values anywhere --------------------------------------------------
  SELECT COUNT(*) INTO n FROM public.levels WHERE numeric_level NOT BETWEEN 100 AND 600;
  IF n > 0 THEN
    problems := problems || array['invalid level values present (must be 100–600 only)'];
  END IF;

  -- Storage bucket --------------------------------------------------------------------
  SELECT COUNT(*) INTO n FROM storage.buckets WHERE id = 'library-materials';
  IF n <> 1 THEN
    problems := problems || array['storage bucket library-materials missing'];
  END IF;

  -- auth.users untouched sanity: trigger exists, no data was destroyed ---------------
  SELECT COUNT(*) INTO n FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'auth' AND c.relname = 'users'
     AND t.tgname IN ('on_auth_user_created','on_auth_login_touch')
     AND NOT t.tgisinternal;
  IF n <> 2 THEN
    problems := problems || array['auth.users triggers missing (' || n || '/2)'];
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'MIGRATION FAILED — % problem(s): %',
      array_length(problems, 1), array_to_string(problems, ' | ');
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '==================== BUILD COMPLETE ===========================';
  RAISE NOTICE 'FUW E-Library database created successfully.';
  RAISE NOTICE 'Tables: profiles, faculties, departments, levels, courses,';
  RAISE NOTICE '        materials, notifications, admin_invites, ai_* , chunks';
  RAISE NOTICE 'Seeds : % faculties / % departments / % courses',
    (SELECT COUNT(*) FROM public.faculties),
    (SELECT COUNT(*) FROM public.departments),
    (SELECT COUNT(*) FROM public.courses);
  RAISE NOTICE '==============================================================';
  RAISE NOTICE 'Bootstrap the owner once (after registering at /register):';
  RAISE NOTICE '  select public.promote_first_super_admin(''your-owner-email@example.com'');';
END $$;
