-- =====================================================================
-- FUW E-LIBRARY — script2.sql : SECURITY, ROLES, RLS, FUNCTIONS, TRIGGERS
-- =====================================================================
-- Run order:  script1.sql  ->  script2.sql  ->  script3.sql
--
-- Configures everything that makes the structure from script1 secure and
-- functional:
--   1.  Authorization helpers (SECURITY DEFINER, pinned search_path)
--   2.  Super-admin management RPCs
--   3.  Material review RPCs (approve / reject / delete notifications)
--   4.  Username/password authentication RPCs
--   5.  Statistics RPCs
--   6.  AI semantic search (pgvector, optional)
--   7.  Maintenance-mode RPCs (system_settings)
--   8.  Triggers (auth->profile sync, invites, login tracking,
--       updated_at, catalogue sync, deletion notices)
--   9.  Row Level Security + complete policy set (recreated fresh —
--       no recursion: every role check goes through a SECURITY DEFINER
--       helper that reads profiles as the table owner, so a policy can
--       never re-enter its own table's RLS evaluation)
--  10.  Privilege model (grants + revokes + default privileges) —
--       prevents "permission denied for table profiles"
--  11.  Storage bucket + storage policies
--  12.  Security verification
--
-- Role contract:
--   student     -> upload (pending), manage own uploads/notifications only
--   admin       -> review materials per assigned permissions, read students
--   super_admin -> everything admins can do plus admin management,
--                  catalogue management, invites, maintenance mode.
--                  is_admin() includes super_admin, so a super_admin is
--                  NEVER treated as a plain student.
-- =====================================================================

-- -----------------------------------------------------------------------------
-- 1. Authorization helpers.
--    All are STABLE + SECURITY DEFINER with a pinned search_path so policy
--    expressions never recurse into the RLS they evaluate.
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
    WHERE id = auth.uid()
      AND role IN ('admin'::public.app_role, 'super_admin'::public.app_role)
      AND is_active
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
-- 2. Super-admin management RPCs.
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
   WHERE id = target_user_id AND role = 'student'::public.app_role;
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
   WHERE id = target_user_id AND role = 'admin'::public.app_role;
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
  ON CONFLICT (lower(email)) DO UPDATE
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
-- 3. Material review RPCs — parameter names (p_material_id / p_note /
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
-- 4. Username/password authentication RPCs.
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
-- 5. Statistics RPCs — aggregates only, never private student rows.
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
   WHERE id = material_id AND status = 'approved'::public.material_status;
$$;

CREATE OR REPLACE FUNCTION public.increment_view_count(material_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.materials SET views = views + 1
   WHERE id = material_id AND status = 'approved'::public.material_status;
$$;

GRANT EXECUTE ON FUNCTION
  public.get_public_stats(), public.get_library_stats(),
  public.increment_download_count(uuid), public.increment_view_count(uuid)
TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_material_status_counts() TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. AI semantic search over approved materials (requires pgvector).
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
      JOIN public.materials m ON m.id = mc.material_id
        AND m.status = 'approved'::public.material_status
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
-- 7. Maintenance mode RPCs (backed by system_settings key 'maintenance').
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_maintenance_status()
RETURNS TABLE (enabled BOOLEAN, message TEXT, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((s.value ->> 'enabled')::BOOLEAN, FALSE),
    COALESCE(s.value ->> 'message', ''),
    s.updated_at
  FROM public.system_settings s
  WHERE s.key = 'maintenance';
$$;

GRANT EXECUTE ON FUNCTION public.get_maintenance_status() TO anon, authenticated;

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

-- -----------------------------------------------------------------------------
-- 8. Triggers
-- -----------------------------------------------------------------------------

-- 8a. Catalogue sync — keeps materials FK ids and mirrored display names
--     consistent in BOTH directions, so clients may send either form.
CREATE OR REPLACE FUNCTION public.sync_material_catalogue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_text text;
BEGIN
  NEW.faculty     := COALESCE(trim(NEW.faculty), '');
  NEW.department  := COALESCE(trim(NEW.department), '');
  NEW.level       := COALESCE(trim(NEW.level), '');
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

-- 8b. New auth user -> profile (default role student; username carried over
--     from signup metadata; existing roles never overwritten).
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

-- 8c. Pending admin invitation applied at signup (profile created as admin
--     with the standard permission set; invite marked accepted).
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

-- 8d. Login tracking — last_sign_in_at changes bump profiles.last_login_at.
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

-- 8e. updated_at maintenance everywhere the column exists.
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

-- 8f. Deletion notices — whenever someone OTHER than the uploader removes a
--     material, the uploader is notified automatically (guarded against
--     account-cascade deletions).
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
-- 9. Row Level Security + complete policy set.
--     Recreated deterministically (script1 already cleared stale policies).
--     No recursion: policies call SECURITY DEFINER helpers only.
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
ALTER TABLE public.system_settings    ENABLE ROW LEVEL SECURITY;

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
  FOR SELECT USING (
    status = 'approved'::public.material_status
    OR uploaded_by = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "materials_insert_policy" ON public.materials;
CREATE POLICY "materials_insert_policy" ON public.materials
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (status = 'pending'::public.material_status OR public.has_permission('upload_as_approved'))
  );

DROP POLICY IF EXISTS "materials_admin_update_policy" ON public.materials;
CREATE POLICY "materials_admin_update_policy" ON public.materials
  FOR UPDATE TO authenticated
  USING (public.has_permission('approve_materials') OR public.has_permission('upload_as_approved'))
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "materials_delete_policy" ON public.materials;
CREATE POLICY "materials_delete_policy" ON public.materials
  FOR DELETE TO authenticated
  USING ((uploaded_by = auth.uid()
          AND status <> 'approved'::public.material_status)
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

-- system settings ---------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 10. Privilege model. RLS alone is not sufficient — PostgREST needs the
--     underlying table grants too (missing GRANTs surface as "permission
--     denied for table ..." API errors even when policies look right).
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- anon gets read-only access; RLS policies decide what is actually visible.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT ON public.system_settings TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;

-- -----------------------------------------------------------------------------
-- 11. Storage bucket + policies.
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

-- -----------------------------------------------------------------------------
-- 12. Security verification — fails loudly if anything security-related
--     did not land correctly.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  problems text[] := '{}';
  n bigint;
BEGIN
  -- RLS enabled on all 13 application tables
  SELECT COUNT(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('profiles','faculties','departments','levels','courses',
                       'materials','notifications','admin_invites',
                       'ai_conversations','ai_messages','ai_processing_jobs',
                       'material_chunks','system_settings')
     AND c.relrowsecurity;
  IF n <> 13 THEN
    problems := problems || array['RLS enabled on ' || n || '/13 tables'];
  END IF;

  -- Required functions exist (helpers + management + review + auth + stats
  -- + maintenance)
  SELECT COUNT(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname IN (
     'my_stored_role','my_is_active','my_permissions','is_admin','is_super_admin',
     'has_permission','promote_first_super_admin','promote_to_admin','demote_admin',
     'set_admin_active','update_admin_details','update_admin_permissions',
     'create_admin_invite','approve_material_rpc','reject_material_rpc',
     'notify_material_deleted','lookup_login_email','register_identity_check',
     'get_public_stats','get_library_stats','get_material_status_counts',
     'increment_download_count','increment_view_count','handle_new_user',
     'sync_material_catalogue','handle_material_deleted',
     'get_maintenance_status','set_maintenance_mode');
  IF n < 28 THEN
    problems := problems || array['expected >= 28 required functions, found ' || n];
  END IF;

  -- my_stored_role must return public.app_role
  SELECT COUNT(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'my_stored_role'
     AND (SELECT t.typname FROM pg_type t WHERE t.oid = p.prorettype) = 'app_role';
  IF n <> 1 THEN
    problems := problems || array['my_stored_role() does not return public.app_role'];
  END IF;

  -- Policies present on critical tables
  IF (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='profiles') < 3 THEN
    problems := problems || array['profiles has fewer than 3 policies'];
  END IF;

  IF (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='materials') < 4 THEN
    problems := problems || array['materials has fewer than 4 policies'];
  END IF;

  IF (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='system_settings') < 2 THEN
    problems := problems || array['system_settings has fewer than 2 policies'];
  END IF;

  -- Storage bucket + policies
  SELECT COUNT(*) INTO n FROM storage.buckets WHERE id = 'library-materials';
  IF n <> 1 THEN
    problems := problems || array['storage bucket library-materials missing'];
  END IF;

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'library-materials%';
  IF n < 4 THEN
    problems := problems || array['storage policies missing (' || n || '/4)'];
  END IF;

  -- auth.users triggers
  SELECT COUNT(*) INTO n FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'auth' AND c.relname = 'users'
     AND t.tgname IN ('on_auth_user_created','on_auth_login_touch')
     AND NOT t.tgisinternal;
  IF n <> 2 THEN
    problems := problems || array['auth.users triggers missing (' || n || '/2)'];
  END IF;

  -- Grants: authenticated must be able to touch the core tables
  IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
    problems := problems || array['authenticated lacks SELECT on public.profiles'];
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.materials', 'INSERT') THEN
    problems := problems || array['authenticated lacks INSERT on public.materials'];
  END IF;
  IF NOT has_table_privilege('anon', 'public.system_settings', 'SELECT') THEN
    problems := problems || array['anon lacks SELECT on public.system_settings'];
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'SCRIPT2 FAILED - % problem(s): %',
      array_length(problems, 1), array_to_string(problems, ' | ');
  END IF;

  RAISE NOTICE 'script2 OK - RLS (13/13), 28+ functions, triggers, grants, storage all configured.';
END $$;
