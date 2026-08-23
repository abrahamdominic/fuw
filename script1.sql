-- =====================================================================
-- FUW E-LIBRARY — script1.sql : DATABASE STRUCTURE
-- =====================================================================
-- Run order:  script1.sql  ->  script2.sql  ->  script3.sql
--
-- PRODUCTION-SAFE MIGRATION for an EXISTING Supabase database.
--   * Nothing is dropped, truncated or destroyed.
--   * auth.users is NEVER modified or deleted.
--   * Every CREATE is guarded with IF NOT EXISTS.
--   * Missing columns are added to pre-existing tables.
--   * Stale RLS policies are removed here (script2 recreates all of
--     them), which is also what makes the enum/type alignment below
--     safe: a column type can never be altered while a policy still
--     depends on it ("cannot alter type of a column used in a policy
--     definition" becomes impossible).
--   * Enum columns (profiles.role, materials.status,
--     materials.material_type) are aligned to their proper enum types
--     ONLY when they are currently of a different type, with explicit
--     casts — so "text = boolean" and "material_status = text" can
--     never occur again.
--
-- Contents
--   0. Extensions
--   1. Enums  (app_role, material_status, material_type)
--   2. Tables (academic catalogue, application, AI, system settings)
--   3. Column backfill for pre-existing tables
--   4. Stale-policy cleanup
--   5. Enum/type alignment for existing columns
--   6. Defaults & NOT NULL alignment
--   7. Foreign keys
--   8. Check constraints
--   9. Unique indexes
--  10. Performance indexes
--  11. Comments
--  12. Structure verification (fails loudly with named problems)
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
-- 1. Enums — created only when missing; missing labels added defensively.
--    Never ALTER COLUMN TYPE on these columns unless actually required
--    (section 5) and only after every dependent policy has been dropped.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'app_role' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('student', 'admin', 'super_admin');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'material_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.material_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'material_type' AND n.nspname = 'public'
  ) THEN
    -- Canonical app labels plus legacy labels that may exist in old rows.
    CREATE TYPE public.material_type AS ENUM (
      'Test Questions',
      'Test Past Questions',
      'Exam Past Questions',
      'Projects',
      'Handouts',
      'Lecture Note',
      'Textbook'
    );
  ELSE
    -- Ensure the four canonical labels required by the app always exist.
    ALTER TYPE public.material_type ADD VALUE IF NOT EXISTS 'Test Questions';
    ALTER TYPE public.material_type ADD VALUE IF NOT EXISTS 'Exam Past Questions';
    ALTER TYPE public.material_type ADD VALUE IF NOT EXISTS 'Projects';
    ALTER TYPE public.material_type ADD VALUE IF NOT EXISTS 'Handouts';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tables — full definitions for fresh databases; pre-existing tables are
--    reconciled in section 3 so both paths converge on the same structure.
-- -----------------------------------------------------------------------------

-- Academic catalogue ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.faculties (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  short_name     TEXT,
  duration_years INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id     UUID,
  name           TEXT NOT NULL,
  code           TEXT,
  duration_years INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.levels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  numeric_level INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.levels IS 'Study levels 100-600 only — never 1000+.';

CREATE TABLE IF NOT EXISTS public.courses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id     UUID,
  course_code       TEXT NOT NULL,
  course_title      TEXT NOT NULL,
  level_id          UUID,
  semester          TEXT,             -- 'First Semester' | 'Second Semester'
  credit_units      INTEGER,
  is_general_course BOOLEAN NOT NULL DEFAULT FALSE,  -- codes ending in 'C'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Profiles (linked to Supabase Auth) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY,
  full_name     TEXT NOT NULL DEFAULT '',
  display_name  TEXT,
  email         TEXT,
  username      TEXT,               -- unique case-insensitive login name
  matric_number TEXT,
  faculty       TEXT,
  department    TEXT,
  level         TEXT,
  bio           TEXT,
  avatar_url    TEXT,
  role          public.app_role NOT NULL DEFAULT 'student',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  permissions   TEXT[] NOT NULL DEFAULT '{}',
  created_by    UUID,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON COLUMN public.profiles.role IS 'Managed by DB triggers/RPCs only — never trusted from the client.';

-- Materials ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.materials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  faculty_id       UUID,
  department_id    UUID,
  course_id        UUID,
  level_id         UUID,
  faculty          TEXT NOT NULL DEFAULT '',   -- mirrored display name
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
  downloads        INTEGER NOT NULL DEFAULT 0,
  views            INTEGER NOT NULL DEFAULT 0,
  uploaded_by      UUID,
  status           public.material_status NOT NULL DEFAULT 'pending',
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON COLUMN public.materials.status IS 'Students always start pending; permitted admins may upload pre-approved.';
COMMENT ON COLUMN public.materials.file_path IS 'Storage path used for cleanup on delete.';

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'info',
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  full_name  TEXT NOT NULL DEFAULT '',
  invited_by UUID,
  accepted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI / semantic search tables ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,
  material_id  UUID,
  title        TEXT NOT NULL DEFAULT 'New conversation',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  citations       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_processing_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id    UUID,
  status         TEXT NOT NULL DEFAULT 'pending',
  chunks_created INTEGER NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.material_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id  UUID,
  chunk_index  INTEGER NOT NULL DEFAULT 0,
  content      TEXT NOT NULL,
  page_number  INTEGER,
  course_code  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  embedding    VECTOR(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System settings (maintenance mode etc.) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- -----------------------------------------------------------------------------
-- 3. Column backfill — guarantees every expected column exists even when the
--    table was created by an older migration. Safe to re-run.
-- -----------------------------------------------------------------------------

-- faculties / departments / levels / courses
ALTER TABLE public.faculties   ADD COLUMN IF NOT EXISTS short_name     TEXT;
ALTER TABLE public.faculties   ADD COLUMN IF NOT EXISTS duration_years INTEGER;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS faculty_id     UUID;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS code           TEXT;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS duration_years INTEGER;
ALTER TABLE public.levels      ADD COLUMN IF NOT EXISTS numeric_level  INTEGER;
ALTER TABLE public.courses     ADD COLUMN IF NOT EXISTS department_id     UUID;
ALTER TABLE public.courses     ADD COLUMN IF NOT EXISTS level_id          UUID;
ALTER TABLE public.courses     ADD COLUMN IF NOT EXISTS semester          TEXT;
ALTER TABLE public.courses     ADD COLUMN IF NOT EXISTS credit_units      INTEGER;
ALTER TABLE public.courses     ADD COLUMN IF NOT EXISTS is_general_course BOOLEAN NOT NULL DEFAULT FALSE;

-- profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name     TEXT NOT NULL DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name  TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username      TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS matric_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS faculty       TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department    TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS level         TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio           TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url    TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS permissions   TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_by    UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- NOTE: role / is_active handled in sections 5 & 6 (type + default alignment).

-- materials
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS description      TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS faculty_id       UUID;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS department_id    UUID;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS course_id        UUID;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS level_id         UUID;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS faculty          TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS department       TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS level            TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS course_code      TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS course_title     TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS semester         TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS academic_session TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_url         TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_path        TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_name        TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_size        TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS downloads        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS views            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS uploaded_by      UUID;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS approved_by      UUID;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
-- NOTE: material_type / status handled in sections 5 & 6.

-- notifications / admin_invites
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.admin_invites ADD COLUMN IF NOT EXISTS invited_by UUID;

-- AI tables
ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS material_id UUID;
ALTER TABLE public.ai_messages      ADD COLUMN IF NOT EXISTS citations   JSONB;
ALTER TABLE public.ai_processing_jobs ADD COLUMN IF NOT EXISTS chunks_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.ai_processing_jobs ADD COLUMN IF NOT EXISTS attempts       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.material_chunks     ADD COLUMN IF NOT EXISTS page_number    INTEGER;
ALTER TABLE public.material_chunks     ADD COLUMN IF NOT EXISTS course_code    TEXT;
ALTER TABLE public.material_chunks     ADD COLUMN IF NOT EXISTS metadata       JSONB NOT NULL DEFAULT '{}';

-- -----------------------------------------------------------------------------
-- 4. Stale-policy cleanup.
--    Removes every RLS policy on the application tables so that:
--      a) script2 can recreate the complete, correct set deterministically;
--      b) section 5 can safely align column types (no policy depends on
--         any column while its type changes);
--      c) broken legacy policies (e.g. text-vs-boolean comparisons) cannot
--         survive into the new schema.
--    Between script1 and script2 RLS simply denies non-service access —
--    run the scripts back-to-back as documented in README.md.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles','faculties','departments','levels','courses','materials',
        'notifications','admin_invites','ai_conversations','ai_messages',
        'ai_processing_jobs','material_chunks','system_settings'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Enum/type alignment.
--    Converts legacy text columns to their proper enum types using explicit
--    casts and CASE mappings. Runs ONLY when the column type differs, and
--    only after all policies were dropped in section 4 — this permanently
--    prevents:
--        operator does not exist: text = boolean
--        operator does not exist: material_status = text
--        cannot alter type of a column used in a policy definition
-- -----------------------------------------------------------------------------

-- profiles.role -> public.app_role ---------------------------------------------
DO $$
DECLARE v_udt text;
BEGIN
  SELECT udt_name INTO v_udt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';

  IF v_udt IS NOT NULL AND v_udt <> 'app_role' THEN
    EXECUTE $conv$
      ALTER TABLE public.profiles
        ALTER COLUMN role DROP DEFAULT,
        ALTER COLUMN role TYPE public.app_role
        USING CASE lower(trim(COALESCE(role::text, '')))
                WHEN 'admin'       THEN 'admin'::public.app_role
                WHEN 'super_admin' THEN 'super_admin'::public.app_role
                WHEN 'superadmin'  THEN 'super_admin'::public.app_role
                ELSE 'student'::public.app_role
              END
    $conv$;
    RAISE NOTICE 'profiles.role converted from % to public.app_role.', v_udt;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not convert profiles.role automatically (%). Resolve manually before running script2.', SQLERRM;
END $$;

-- materials.status -> public.material_status -----------------------------------
DO $$
DECLARE v_udt text;
BEGIN
  SELECT udt_name INTO v_udt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'status';

  IF v_udt IS NOT NULL AND v_udt <> 'material_status' THEN
    EXECUTE $conv$
      ALTER TABLE public.materials
        ALTER COLUMN status DROP DEFAULT,
        ALTER COLUMN status TYPE public.material_status
        USING CASE lower(trim(COALESCE(status::text, '')))
                WHEN 'approved' THEN 'approved'::public.material_status
                WHEN 'rejected' THEN 'rejected'::public.material_status
                ELSE 'pending'::public.material_status
              END
    $conv$;
    RAISE NOTICE 'materials.status converted from % to public.material_status.', v_udt;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not convert materials.status automatically (%). Resolve manually before running script2.', SQLERRM;
END $$;

-- materials.material_type -> public.material_type -------------------------------
DO $$
DECLARE v_udt text;
BEGIN
  SELECT udt_name INTO v_udt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'material_type';

  IF v_udt IS NOT NULL AND v_udt <> 'material_type' THEN
    EXECUTE $conv$
      ALTER TABLE public.materials
        ALTER COLUMN material_type DROP DEFAULT,
        ALTER COLUMN material_type TYPE public.material_type
        USING CASE lower(trim(COALESCE(material_type::text, '')))
                WHEN 'test questions'       THEN 'Test Questions'::public.material_type
                WHEN 'test past questions'  THEN 'Test Past Questions'::public.material_type
                WHEN 'exam past questions'  THEN 'Exam Past Questions'::public.material_type
                WHEN 'projects'             THEN 'Projects'::public.material_type
                WHEN 'handouts'             THEN 'Handouts'::public.material_type
                WHEN 'lecture note'         THEN 'Lecture Note'::public.material_type
                WHEN 'lecture notes'        THEN 'Lecture Note'::public.material_type
                WHEN 'textbook'             THEN 'Textbook'::public.material_type
                ELSE 'Lecture Note'::public.material_type
              END
    $conv$;
    RAISE NOTICE 'materials.material_type converted from % to public.material_type.', v_udt;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not convert materials.material_type automatically (%). Resolve manually before running script2.', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Defaults & NOT NULL alignment (guarded, exception-safe).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- profiles.role: default + NOT NULL
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles'
                   AND column_name='role' AND column_default IS NOT NULL) THEN
    ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'student'::public.app_role;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles'
               AND column_name='role' AND is_nullable = 'YES') THEN
    BEGIN
      ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'profiles.role left nullable: %', SQLERRM;
    END;
  END IF;

  -- materials.status: default + NOT NULL
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='materials'
                   AND column_name='status' AND column_default IS NOT NULL) THEN
    ALTER TABLE public.materials ALTER COLUMN status SET DEFAULT 'pending'::public.material_status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='materials'
               AND column_name='status' AND is_nullable = 'YES') THEN
    BEGIN
      UPDATE public.materials SET status = 'pending' WHERE status IS NULL;
      ALTER TABLE public.materials ALTER COLUMN status SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'materials.status left nullable: %', SQLERRM;
    END;
  END IF;

  -- materials.material_type: default + NOT NULL
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='materials'
                   AND column_name='material_type' AND column_default IS NOT NULL) THEN
    ALTER TABLE public.materials ALTER COLUMN material_type SET DEFAULT 'Lecture Note'::public.material_type;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='materials'
               AND column_name='material_type' AND is_nullable = 'YES') THEN
    BEGIN
      UPDATE public.materials SET material_type = 'Lecture Note' WHERE material_type IS NULL;
      ALTER TABLE public.materials ALTER COLUMN material_type SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'materials.material_type left nullable: %', SQLERRM;
    END;
  END IF;

  -- materials.uploaded_by: best-effort backfill then NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='materials'
               AND column_name='uploaded_by' AND is_nullable = 'YES') THEN
    BEGIN
      UPDATE public.materials m
         SET uploaded_by = (SELECT p.id FROM public.profiles p ORDER BY p.created_at ASC LIMIT 1)
       WHERE m.uploaded_by IS NULL
         AND EXISTS (SELECT 1 FROM public.profiles);
      ALTER TABLE public.materials ALTER COLUMN uploaded_by SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'materials.uploaded_by left nullable (rows without an uploader need manual assignment).';
    END;
  END IF;

  -- notifications.is_read / admin_invites.accepted defaults
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='notifications'
                   AND column_name='is_read' AND column_default IS NOT NULL) THEN
    ALTER TABLE public.notifications ALTER COLUMN is_read SET DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='admin_invites'
                   AND column_name='accepted' AND column_default IS NOT NULL) THEN
    ALTER TABLE public.admin_invites ALTER COLUMN accepted SET DEFAULT FALSE;
  END IF;

  -- materials counters: zero-fill nulls then lock down defaults
  UPDATE public.materials SET downloads = 0 WHERE downloads IS NULL;
  UPDATE public.materials SET views     = 0 WHERE views     IS NULL;
  UPDATE public.materials SET faculty    = '' WHERE faculty    IS NULL;
  UPDATE public.materials SET department = '' WHERE department IS NULL;
  UPDATE public.materials SET level      = '' WHERE level      IS NULL;
  UPDATE public.materials SET course_code= '' WHERE course_code IS NULL;
  UPDATE public.materials SET semester   = '' WHERE semester   IS NULL;
  UPDATE public.materials SET file_url   = '' WHERE file_url   IS NULL;
  UPDATE public.materials SET file_name  = '' WHERE file_name  IS NULL;
  UPDATE public.profiles    SET permissions = '{}' WHERE permissions IS NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Foreign keys — added by name only when missing (idempotent).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- profiles.id -> auth.users(id)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_id_fkey') THEN
    BEGIN
      ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'profiles_id_fkey skipped: %', SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_created_by_fkey') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.departments'::regclass AND conname = 'departments_faculty_id_fkey') THEN
    ALTER TABLE public.departments
      ADD CONSTRAINT departments_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculties(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.courses'::regclass AND conname = 'courses_department_id_fkey') THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.courses'::regclass AND conname = 'courses_level_id_fkey') THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_faculty_id_fkey') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.faculties(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_department_id_fkey') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_course_id_fkey') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_level_id_fkey') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_uploaded_by_fkey') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_approved_by_fkey') THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_user_id_fkey') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.admin_invites'::regclass AND conname = 'admin_invites_invited_by_fkey') THEN
    ALTER TABLE public.admin_invites
      ADD CONSTRAINT admin_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_conversations'::regclass AND conname = 'ai_conversations_user_id_fkey') THEN
    ALTER TABLE public.ai_conversations
      ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_conversations'::regclass AND conname = 'ai_conversations_material_id_fkey') THEN
    ALTER TABLE public.ai_conversations
      ADD CONSTRAINT ai_conversations_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_messages'::regclass AND conname = 'ai_messages_conversation_id_fkey') THEN
    ALTER TABLE public.ai_messages
      ADD CONSTRAINT ai_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_processing_jobs'::regclass AND conname = 'ai_processing_jobs_material_id_fkey') THEN
    ALTER TABLE public.ai_processing_jobs
      ADD CONSTRAINT ai_processing_jobs_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.material_chunks'::regclass AND conname = 'material_chunks_material_id_fkey') THEN
    ALTER TABLE public.material_chunks
      ADD CONSTRAINT material_chunks_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.system_settings'::regclass AND conname = 'system_settings_updated_by_fkey') THEN
    ALTER TABLE public.system_settings
      ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Check constraints — added by name only when missing.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_type_check CHECK (type IN ('info', 'success', 'warning', 'error'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_messages'::regclass AND conname = 'ai_messages_role_check') THEN
    ALTER TABLE public.ai_messages
      ADD CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_processing_jobs'::regclass AND conname = 'ai_processing_jobs_status_check') THEN
    ALTER TABLE public.ai_processing_jobs
      ADD CONSTRAINT ai_processing_jobs_status_check CHECK (status IN ('pending', 'processing', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_downloads_check') THEN
    BEGIN
      ALTER TABLE public.materials ADD CONSTRAINT materials_downloads_check CHECK (downloads >= 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'materials_downloads_check skipped: %', SQLERRM;
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.materials'::regclass AND conname = 'materials_views_check') THEN
    BEGIN
      ALTER TABLE public.materials ADD CONSTRAINT materials_views_check CHECK (views >= 0);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'materials_views_check skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 9. Unique indexes — enforce uniqueness AND act as ON CONFLICT arbiters for
--    the idempotent seed inserts in script3.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS faculties_name_uq            ON public.faculties (name);
CREATE UNIQUE INDEX IF NOT EXISTS departments_faculty_name_uq  ON public.departments (faculty_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS levels_name_uq               ON public.levels (name);
CREATE UNIQUE INDEX IF NOT EXISTS levels_numeric_uq            ON public.levels (numeric_level);
CREATE UNIQUE INDEX IF NOT EXISTS courses_department_code_uq   ON public.courses (department_id, course_code);
CREATE UNIQUE INDEX IF NOT EXISTS admin_invites_email_uq       ON public.admin_invites (lower(email));

-- Unique matric numbers / usernames only for real values
-- (multiple '' or NULLs would break a plain UNIQUE constraint).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_matric_unique_idx
  ON public.profiles (matric_number)
  WHERE matric_number IS NOT NULL AND matric_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (lower(trim(username)))
  WHERE username IS NOT NULL AND trim(username) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ai_processing_jobs_material_uq
  ON public.ai_processing_jobs (material_id);

-- -----------------------------------------------------------------------------
-- 10. Performance indexes.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_username    ON public.profiles (lower(trim(username)));
CREATE INDEX IF NOT EXISTS idx_profiles_role        ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_faculty     ON public.profiles (faculty);
CREATE INDEX IF NOT EXISTS idx_profiles_department  ON public.profiles (department);
CREATE INDEX IF NOT EXISTS idx_profiles_matric      ON public.profiles (matric_number)
  WHERE matric_number IS NOT NULL AND matric_number <> '';

CREATE INDEX IF NOT EXISTS idx_materials_status        ON public.materials (status);
CREATE INDEX IF NOT EXISTS idx_materials_faculty_id    ON public.materials (faculty_id);
CREATE INDEX IF NOT EXISTS idx_materials_department_id ON public.materials (department_id);
CREATE INDEX IF NOT EXISTS idx_materials_course_id     ON public.materials (course_id);
CREATE INDEX IF NOT EXISTS idx_materials_level_id      ON public.materials (level_id);
CREATE INDEX IF NOT EXISTS idx_materials_course_code   ON public.materials (upper(course_code));
CREATE INDEX IF NOT EXISTS idx_materials_uploaded_by   ON public.materials (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_materials_created_at    ON public.materials (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_courses_code        ON public.courses (upper(course_code));
CREATE INDEX IF NOT EXISTS idx_courses_department  ON public.courses (department_id);
CREATE INDEX IF NOT EXISTS idx_departments_faculty ON public.departments (faculty_id);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation  ON public.ai_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_material_chunks_material  ON public.material_chunks (material_id);

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
-- 11. Comments
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.faculties   IS 'Official FUW faculties (seeded in script3).';
COMMENT ON TABLE public.departments IS 'Departments grouped under faculties (seeded in script3).';
COMMENT ON TABLE public.levels      IS 'Study levels 100-600 (never 1000+).';
COMMENT ON TABLE public.courses     IS 'Course catalogue per department; codes ending in C are general/common courses.';
COMMENT ON TABLE public.materials   IS 'Library uploads with mirrored catalogue display columns kept in sync by triggers.';
COMMENT ON TABLE public.system_settings IS 'Persistent app-wide settings (maintenance mode lives under key ''maintenance'').';

-- -----------------------------------------------------------------------------
-- 12. Structure verification — raises one clear exception naming every
--     problem found. Fix before running script2.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  problems text[] := '{}';
  v text;
  n bigint;
BEGIN
  -- All 13 application tables present
  SELECT COUNT(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('profiles','faculties','departments','levels','courses',
                        'materials','notifications','admin_invites',
                        'ai_conversations','ai_messages','ai_processing_jobs',
                        'material_chunks','system_settings');
  IF n <> 13 THEN
    problems := problems || array['expected 13 application tables, found ' || n];
  END IF;

  -- Enum column types
  SELECT udt_name INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='role';
  IF v IS DISTINCT FROM 'app_role' THEN
    problems := problems || array['profiles.role is "' || COALESCE(v,'NULL') || '" - expected app_role'];
  END IF;

  SELECT udt_name INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='materials' AND column_name='status';
  IF v IS DISTINCT FROM 'material_status' THEN
    problems := problems || array['materials.status is "' || COALESCE(v,'NULL') || '" - expected material_status'];
  END IF;

  SELECT udt_name INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='materials' AND column_name='material_type';
  IF v IS DISTINCT FROM 'material_type' THEN
    problems := problems || array['materials.material_type is "' || COALESCE(v,'NULL') || '" - expected material_type'];
  END IF;

  -- Required indexes
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
       'idx_courses_code','idx_courses_department','idx_departments_faculty');
  IF n < 19 THEN
    problems := problems || array['expected >= 19 required indexes, found ' || n];
  END IF;

  -- Foreign keys on materials
  SELECT COUNT(*) INTO n
    FROM (SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.materials'::regclass AND contype = 'f') fks;
  IF n < 6 THEN
    problems := problems || array['materials expected >= 6 foreign keys, found ' || n];
  END IF;

  -- Canonical material-type labels present in the enum
  SELECT COUNT(DISTINCT e.enumlabel) INTO n
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'material_type'
     AND e.enumlabel IN ('Test Questions','Exam Past Questions','Projects','Handouts');
  IF n <> 4 THEN
    problems := problems || array['material_type enum must contain Test Questions / Exam Past Questions / Projects / Handouts'];
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'SCRIPT1 FAILED - % problem(s): %',
      array_length(problems, 1), array_to_string(problems, ' | ');
  END IF;

  RAISE NOTICE 'script1 OK - database structure created/aligned (13 tables, enums, indexes, FKs).';
END $$;
