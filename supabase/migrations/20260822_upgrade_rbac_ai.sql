-- ==============================================================================
-- FUW E-Library — Consolidated Upgrade Migration
-- Run the ENTIRE script in: Supabase Dashboard -> SQL Editor -> New query.
-- Safe to run multiple times (idempotent).
--
-- Upgrades:
--   1. Roles & permissions (student | admin | super_admin) with activation flags
--   2. profiles / materials schema alignment + backfills
--   3. Notifications system
--   4. Admin invite flow (super admin invites new admins by email)
--   5. Approval / rejection RPCs that notify students automatically
--   6. AI / RAG tables (pgvector chunks, conversations, messages, jobs)
-- ==============================================================================

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
-- 1. Enums
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  type_oid  OID;
  labels    TEXT[];
  dep_count BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'material_status') THEN
    CREATE TYPE public.material_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;

  SELECT oid INTO type_oid FROM pg_type WHERE typname = 'app_role';

  IF type_oid IS NULL THEN
    CREATE TYPE public.app_role AS ENUM ('student', 'admin', 'super_admin');
    RETURN;
  END IF;

  -- NOTE: avoid ALTER TYPE ... ADD VALUE inside this transaction — a value
  -- added here could not be used by later statements in the SAME
  -- transaction ("unsafe use of new value"). Recreate instead while free
  -- of dependents; otherwise instruct the operator precisely.
  SELECT COALESCE(array_agg(e.enumlabel ORDER BY e.enumlabel), '{}')
    INTO labels
  FROM pg_enum e
  WHERE e.enumtypid = type_oid;

  IF 'student' = ANY(labels) AND 'admin' = ANY(labels) AND 'super_admin' = ANY(labels) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO dep_count
  FROM pg_depend
  WHERE refclassid = 'pg_type'::regclass
    AND refobjid = type_oid
    AND deptype = 'n';

  IF dep_count = 0 THEN
    DROP TYPE public.app_role;
    CREATE TYPE public.app_role AS ENUM ('student', 'admin', 'super_admin');
    RAISE NOTICE 'Recreated enum public.app_role with all three labels.';
  ELSE
    RAISE EXCEPTION
      'Enum public.app_role is missing labels (%) and is still in use. First run this single statement on its own: ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS ''super_admin''; then re-run this script.',
      array_to_string(labels, ', ');
  END IF;
END $$;

-- If a legacy `profiles.role` column is plain text/another enum, convert it
-- safely. Failures are LOUD (re-raised) so problems surface here instead of
-- breaking function/policy creation further down the script.
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO col_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'profiles'
    AND a.attname = 'role' AND a.attnum > 0 AND NOT a.attisdropped;

  IF col_type IS NOT NULL AND col_type <> 'app_role' THEN
    -- RLS policies referencing `role` block ALTER COLUMN TYPE — including
    -- policies on OTHER tables that query profiles.role. Drop every such
    -- public-schema policy here; sections 11-15 recreate all app-table
    -- policies later in this script.
    DECLARE
      pol RECORD;
    BEGIN
      FOR pol IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
               COALESCE(qual, '')        ~* '\mrole\M'
            OR COALESCE(with_check, '')  ~* '\mrole\M'
            OR COALESCE(qual, '')        ILIKE '%profiles%'
            OR COALESCE(with_check, '')  ILIKE '%profiles%'
          )
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
        RAISE NOTICE 'Dropped RLS policy "%" on %.% (recreated in sections 11-15).', pol.policyname, pol.schemaname, pol.tablename;
      END LOOP;
    END;

    -- Map case variants onto canonical labels; unknowns become students.
    UPDATE public.profiles SET role = CASE lower(trim(role))
        WHEN 'admin' THEN 'admin'
        WHEN 'super_admin' THEN 'super_admin'
        ELSE 'student'
      END
    WHERE role IS NOT NULL AND lower(trim(role)) NOT IN ('student', 'admin', 'super_admin');
    UPDATE public.profiles SET role = 'student' WHERE role IS NULL;

    EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT';
    BEGIN
      EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role TYPE public.app_role USING role::text::public.app_role';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Converting public.profiles.role from % to app_role failed: % — run supabase/migrations/20260823_fix_profiles_role_type.sql for diagnosis.',
        col_type, SQLERRM;
    END;
    EXECUTE 'ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT ''student''';
    RAISE NOTICE 'Converted profiles.role from % to app_role', col_type;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Profiles table alignment
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  email TEXT,
  matric_number TEXT,
  faculty TEXT,
  department TEXT,
  level TEXT,
  bio TEXT,
  avatar_url TEXT,
  role public.app_role NOT NULL DEFAULT 'student',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS matric_number TEXT UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS faculty TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

DO $$
BEGIN
  -- Backfill email/display_name from the linked auth user when missing.
  UPDATE public.profiles p
  SET email = u.email,
      full_name = COALESCE(NULLIF(p.full_name, ''), COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))),
      display_name = COALESCE(p.display_name, split_part(COALESCE(u.raw_user_meta_data->>'full_name', u.email), ' ', 1))
  FROM auth.users u
  WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'profiles email backfill skipped: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Materials table alignment (+ legacy column backfills)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  faculty TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  course_code TEXT DEFAULT '',
  course_title TEXT,
  semester TEXT DEFAULT '',
  academic_session TEXT DEFAULT '',
  material_type TEXT DEFAULT 'Lecture Note',
  file_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_size TEXT DEFAULT '',
  downloads INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.material_status NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS faculty TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS course_title TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS semester TEXT DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS academic_session TEXT DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS material_type TEXT DEFAULT 'Lecture Note';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_url TEXT DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS file_size TEXT DEFAULT '';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS downloads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Legacy columns from an older deployment (uploader_id / file_path / category).
DO $$
DECLARE
  has_legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='materials' AND column_name='uploader_id'
  ) INTO has_legacy;
  IF has_legacy THEN
    EXECUTE 'UPDATE public.materials SET uploaded_by = uploader_id::uuid WHERE uploaded_by IS NULL AND uploader_id IS NOT NULL';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='materials' AND column_name='file_path'
  ) INTO has_legacy;
  IF has_legacy THEN
    EXECUTE 'UPDATE public.materials SET file_url = file_path WHERE (file_url IS NULL OR file_url = '''') AND file_path IS NOT NULL AND file_path <> ''''';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='materials' AND column_name='category'
  ) INTO has_legacy;
  IF has_legacy THEN
    -- Normalize legacy labels ("Test Questions" -> "Test Past Questions").
    EXECUTE $f$UPDATE public.materials SET material_type = CASE category
        WHEN 'Test Questions' THEN 'Test Past Questions'
        WHEN 'Textbook' THEN 'Lecture Note'
        ELSE COALESCE(category, 'Lecture Note')
      END WHERE material_type IS NULL OR material_type = '' OR material_type = 'Lecture Note'$f$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'materials legacy backfill partially skipped: %', SQLERRM;
END $$;

-- Remove orphan legacy rows that can never be attributed to an account.
DELETE FROM public.materials WHERE uploaded_by IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='materials' AND column_name='uploaded_by' AND is_nullable='YES'
  ) THEN
    ALTER TABLE public.materials ALTER COLUMN uploaded_by SET NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'uploaded_by NOT NULL enforcement skipped: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'info',
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Admin invites (Super Admin invites future admins by email; role applies
--    automatically on first sign-in via the profile-creation trigger).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT DEFAULT '',
  invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  accepted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. AI / RAG tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_id UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON public.ai_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.ai_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL UNIQUE REFERENCES public.materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  chunks_created INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.material_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  page_number INTEGER,
  course_code TEXT,
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_material_chunks_material ON public.material_chunks(material_id);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_material_chunks_embedding ON public.material_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'embedding index skipped: %', SQLERRM;
END $$;

-- Semantic similarity search (cosine distance). Returns closest chunks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE OR REPLACE FUNCTION public.match_material_chunks(
      query_embedding VECTOR(1536),
      match_count INTEGER DEFAULT 6,
      p_material_id UUID DEFAULT NULL,
      p_department TEXT DEFAULT NULL,
      p_level TEXT DEFAULT NULL,
      p_course_code TEXT DEFAULT NULL
    )
    RETURNS TABLE (
      id UUID,
      material_id UUID,
      content TEXT,
      chunk_index INTEGER,
      page_number INTEGER,
      similarity DOUBLE PRECISION
    )
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
      SELECT mc.id, mc.material_id, mc.content, mc.chunk_index, mc.page_number,
             1 - (mc.embedding <=> query_embedding) AS similarity
      FROM public.material_chunks mc
      JOIN public.materials m ON m.id = mc.material_id AND m.status = 'approved'
      WHERE (p_material_id IS NULL OR mc.material_id = p_material_id)
        AND (p_department IS NULL OR m.department = p_department)
        AND (p_level IS NULL OR m.level = p_level)
        AND (p_course_code IS NULL OR m.course_code = p_course_code)
        AND mc.embedding IS NOT NULL
      ORDER BY mc.embedding <=> query_embedding
      LIMIT LEAST(match_count, 20)
    $fn$;
    GRANT EXECUTE ON FUNCTION public.match_material_chunks(vector, integer, uuid, text, text, text) TO authenticated;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'match_material_chunks skipped: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Authorization helper functions (SECURITY DEFINER => no RLS recursion)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_stored_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Explicit text round-trip keeps the declared return type correct even if
  -- the underlying column type differs (e.g. legacy text deployment).
  SELECT (SELECT role::text FROM public.profiles WHERE id = auth.uid())::public.app_role;
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
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin') AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_super_admin() THEN TRUE
    ELSE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active
        AND (permission = ANY (permissions) OR '{*}' <@ permissions)
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(), public.is_admin(), public.has_permission(text),
  public.my_stored_role(), public.my_is_active(), public.my_permissions() TO anon, authenticated;

-- Public aggregate stats (counts only, no personal data).
CREATE OR REPLACE FUNCTION public.get_public_stats()
RETURNS TABLE (students BIGINT, verified_students BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE matric_number IS NOT NULL AND matric_number <> '')::BIGINT
  FROM public.profiles;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Admin management RPCs (backend-enforced authorization)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_first_super_admin(target_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  super_count integer;
BEGIN
  SELECT COUNT(*) INTO super_count FROM public.profiles WHERE role = 'super_admin';
  IF super_count > 0 THEN
    RAISE EXCEPTION 'A Super Admin already exists.';
  END IF;
  UPDATE public.profiles
  SET role = 'super_admin', is_active = TRUE, permissions = '{}'
  WHERE lower(email) = lower(trim(target_email));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account found with that email. The owner must sign up once at /register first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.promote_to_admin(target_user_id uuid, admin_permissions text[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can manage administrators.';
  END IF;
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use the dedicated bootstrap path for your own account.';
  END IF;
  UPDATE public.profiles
  SET role = 'admin', permissions = COALESCE(admin_permissions, '{}'), is_active = TRUE
  WHERE id = target_user_id AND role = 'student';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found or already an administrator.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.demote_admin(target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can manage administrators.';
  END IF;
  UPDATE public.profiles
  SET role = 'student', permissions = '{}'
  WHERE id = target_user_id AND role IN ('admin', 'super_admin') AND id <> auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator not found (you cannot remove yourself).';
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
  UPDATE public.profiles SET is_active = active WHERE id = target_user_id AND role IN ('admin', 'super_admin');
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
    RAISE EXCEPTION 'Admin not found (permissions of a Super Admin are implicit and cannot be edited).';
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
  WHERE id = target_user_id AND role IN ('admin', 'super_admin');
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
  ON CONFLICT (email) DO UPDATE SET accepted = FALSE, invited_by = EXCLUDED.invited_by;
END $$;

-- Auto-apply pending admin invites when the invited person signs up.
CREATE OR REPLACE FUNCTION public.apply_admin_invite_on_signup()
RETURNS TRIGGER AS $$
DECLARE
  invite record;
BEGIN
  SELECT * INTO invite FROM public.admin_invites
  WHERE email = lower(NEW.email) AND accepted = FALSE LIMIT 1;
  IF invite IS NOT NULL THEN
    NEW.role := 'admin';
    NEW.permissions := '{approve_materials,reject_materials,delete_any_material,upload_as_approved,manage_students,view_analytics,manage_ai}';
    NEW.is_active := TRUE;
    UPDATE public.admin_invites SET accepted = TRUE WHERE id = invite.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_profile_invite_check ON public.profiles;
CREATE TRIGGER on_profile_invite_check
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.apply_admin_invite_on_signup();

-- -----------------------------------------------------------------------------
-- 9. Material review RPCs (approve/reject + automatic student notification)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_material_rpc(material_id uuid, note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m record;
BEGIN
  IF NOT public.has_permission('approve_materials') THEN
    RAISE EXCEPTION 'You do not have permission to approve materials.';
  END IF;
  SELECT * INTO m FROM public.materials WHERE id = material_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Material not found.';
  END IF;
  UPDATE public.materials
  SET status = 'approved', approved_by = auth.uid(), approved_at = NOW(), rejection_reason = NULL
  WHERE id = material_id;
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    m.uploaded_by,
    'Material approved',
    COALESCE(NULLIF(note, ''), 'Your submission "' || m.title || '" was approved and is now live in the library.'),
    'success',
    '/materials/' || m.id::text
  );
END $$;

CREATE OR REPLACE FUNCTION public.reject_material_rpc(material_id uuid, reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m record;
BEGIN
  IF NOT public.has_permission('reject_materials') THEN
    RAISE EXCEPTION 'You do not have permission to review materials.';
  END IF;
  SELECT * INTO m FROM public.materials WHERE id = material_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Material not found.';
  END IF;
  UPDATE public.materials
  SET status = 'rejected',
      approved_by = auth.uid(),
      approved_at = NOW(),
      rejection_reason = COALESCE(NULLIF(reason, ''), 'Does not meet academic submission standards.')
  WHERE id = material_id;
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    m.uploaded_by,
    'Material rejected',
    COALESCE(NULLIF(reason, ''), 'Your submission "' || m.title || '" was rejected.'),
    'warning',
    '/student/uploads'
  );
END $$;

CREATE OR REPLACE FUNCTION public.notify_material_deleted(material_title text, uploader uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    uploader,
    'Material removed',
    'Your submission "' || material_title || '" was removed by a library administrator.',
    'warning',
    '/student/uploads'
  );
$$;

-- Public engagement counters (safe, idempotent increments for any signed-in user).
CREATE OR REPLACE FUNCTION public.increment_download_count(material_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.materials SET downloads = COALESCE(downloads, 0) + 1
  WHERE id = material_id AND status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.increment_view_count(material_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.materials SET views = COALESCE(views, 0) + 1
  WHERE id = material_id AND status = 'approved';
$$;

-- Library-wide totals for public dashboards (no personal data exposed).
CREATE OR REPLACE FUNCTION public.get_library_stats()
RETURNS TABLE(total_downloads bigint, total_views bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(SUM(downloads), 0)::bigint,
    COALESCE(SUM(views), 0)::bigint
  FROM public.materials
  WHERE status = 'approved';
$$;

GRANT EXECUTE ON FUNCTION
  public.promote_first_super_admin(text),
  public.promote_to_admin(uuid, text[]),
  public.demote_admin(uuid),
  public.set_admin_active(uuid, boolean),
  public.update_admin_permissions(uuid, text[]),
  public.update_admin_details(uuid, text),
  public.create_admin_invite(text, text),
  public.approve_material_rpc(uuid, text),
  public.reject_material_rpc(uuid, text),
  public.notify_material_deleted(text, uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.increment_download_count(uuid),
  public.increment_view_count(uuid)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_library_stats() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Enable Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_chunks ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 11. RLS policies — profiles
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Self-service updates may never change role/is_active/permissions.
-- Only the Super Admin can modify other accounts (incl. those fields).
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

-- -----------------------------------------------------------------------------
-- 12. RLS policies — materials
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "materials_public_read_policy" ON public.materials;
CREATE POLICY "materials_public_read_policy" ON public.materials
  FOR SELECT USING (
    status = 'approved' OR uploaded_by = auth.uid() OR public.is_admin()
  );

DROP POLICY IF EXISTS "materials_insert_policy" ON public.materials;
CREATE POLICY "materials_insert_policy" ON public.materials
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      status = 'pending'
      OR (public.has_permission('upload_as_approved'))
    )
  );

-- Students can never change approval status directly; only permitted admins.
DROP POLICY IF EXISTS "materials_admin_update_policy" ON public.materials;
CREATE POLICY "materials_admin_update_policy" ON public.materials
  FOR UPDATE TO authenticated
  USING (public.has_permission('approve_materials') OR public.has_permission('upload_as_approved'))
  WITH CHECK (public.is_admin());

-- Owners delete their own non-approved uploads; admins with permission any.
DROP POLICY IF EXISTS "materials_delete_policy" ON public.materials;
CREATE POLICY "materials_delete_policy" ON public.materials
  FOR DELETE TO authenticated
  USING (
    (uploaded_by = auth.uid() AND status <> 'approved')
    OR public.has_permission('delete_any_material')
  );

-- -----------------------------------------------------------------------------
-- 13. RLS policies — notifications (strictly per-user)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- Inserts happen through SECURITY DEFINER RPCs only.

-- -----------------------------------------------------------------------------
-- 14. RLS policies — admin_invites (super admin manages, readable while signing in)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "admin_invites_super_all" ON public.admin_invites;
CREATE POLICY "admin_invites_super_all" ON public.admin_invites
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 15. RLS policies — AI tables
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "ai_conversations_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_own" ON public.ai_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_messages_via_conversation" ON public.ai_messages;
CREATE POLICY "ai_messages_via_conversation" ON public.ai_messages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ai_jobs_admin_read" ON public.ai_processing_jobs;
CREATE POLICY "ai_jobs_admin_read" ON public.ai_processing_jobs
  FOR SELECT USING (public.is_admin());
-- Writes are performed server-side (edge function uses service role).

DROP POLICY IF EXISTS "material_chunks_read_auth" ON public.material_chunks;
CREATE POLICY "material_chunks_read_auth" ON public.material_chunks
  FOR SELECT TO authenticated USING (TRUE);
-- Chunk writes are performed server-side during AI processing.

-- -----------------------------------------------------------------------------
-- 16. Signup trigger (profile creation) — preserved behavior + invite hook
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, display_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'student'
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

-- Track last login for the Super Admin activity view.
CREATE OR REPLACE FUNCTION public.touch_last_login()
RETURNS trigger AS $$
BEGIN
  UPDATE public.profiles SET last_login_at = NOW() WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_login_touch ON auth.users;
CREATE TRIGGER on_auth_login_touch
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.touch_last_login();

-- -----------------------------------------------------------------------------
-- 17. updated_at triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_materials_updated_at ON public.materials;
CREATE TRIGGER set_materials_updated_at BEFORE UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER set_ai_conversations_updated_at BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_ai_jobs_updated_at ON public.ai_processing_jobs;
CREATE TRIGGER set_ai_jobs_updated_at BEFORE UPDATE ON public.ai_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 18. Performance indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_materials_status ON public.materials(status);
CREATE INDEX IF NOT EXISTS idx_materials_faculty ON public.materials(faculty);
CREATE INDEX IF NOT EXISTS idx_materials_department ON public.materials(department);
CREATE INDEX IF NOT EXISTS idx_materials_level ON public.materials(level);
CREATE INDEX IF NOT EXISTS idx_materials_uploaded_by ON public.materials(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_materials_course_code ON public.materials(course_code);

-- -----------------------------------------------------------------------------
-- 19. Storage bucket + policies
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-materials', 'library-materials', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read storage" ON storage.objects;
CREATE POLICY "Public read storage" ON storage.objects
  FOR SELECT USING (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "Authenticated upload storage" ON storage.objects;
CREATE POLICY "Authenticated upload storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "Owner delete storage" ON storage.objects;
CREATE POLICY "Owner delete storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'library-materials' AND (owner = auth.uid() OR public.is_admin()));

-- -----------------------------------------------------------------------------
-- 20. Grants repair (RESTORE API privileges)
-- PostgREST fails with "permission denied for table ..." when table-level
-- GRANTs are missing — RLS policies alone are not enough. This block restores
-- Supabase's standard privilege model:
--   service_role  -> full access (RLS bypassed anyway)
--   authenticated -> SELECT/INSERT/UPDATE/DELETE (rows still gated by RLS)
--   anon          -> SELECT only (rows still gated by RLS)
-- Plus ALTER DEFAULT PRIVILEGES so objects created later never lose them.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
-- Anonymous callers may execute only the intentionally-public RPCs; every
-- SECURITY DEFINER function re-checks authorization internally.
GRANT EXECUTE ON FUNCTION public.lookup_login_email(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_identity_check(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_library_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_download_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_view_count(uuid) TO anon, authenticated;

-- Future tables/functions/sequences created by later scripts keep working.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
