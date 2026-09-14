-- ==============================================================================
-- FUW E-Library — 2026-09-16 Security Hardening (September 2026 audit follow-up)
--
-- Shared by both clients (web + Expo mobile). Addresses confirmed findings:
--
--   SEC-HARD-1  profiles INSERT self-row policy forces role='student',
--               is_active=TRUE, verified=FALSE, permissions='{}' so a tampered
--               registration / pending-profile payload can never bootstrap a
--               privileged or pre-verified row. (Regression-safety: ON CONFLICT
--               DO UPDATE already replays the UPDATE policies; this closes the
--               first-INSERT window.)
--   SEC-HARD-2  Server-owned identity lock on profiles: while a profile is
--               incomplete each identity field (matric_number / faculty /
--               department / level) may change at most twice; once complete the
--               fields are frozen. Counters are server-managed and may only
--               grow for non-admins. This ships the rule that previously lived
--               only in client code.
--   SEC-HARD-3  admin_apply_profile_change(): the only sanctioned path for
--               applying admin-approved profile changes. Closes the client-side
--               approveProfileChangeRequest() self-approval bypass and moves the
--               column allow-list into a trusted SECURITY DEFINER function.
--   SEC-HARD-4  admin_set_user_active() may no longer suspend/activate other
--               admins unless the caller is the Super Admin (prevents an admin
--               from disabling a peer/super admin = DoS).
--   SEC-HARD-5  material_departments INSERT owner-path now requires the material
--               to be unapproved, matching the DELETE policy and the RPC. An
--               uploader can no longer re-tag an approved material.
--   SEC-HARD-6  Dangerous SECURITY DEFINER / bootstrap functions lose PUBLIC
--               execute; counter functions restricted to authenticated.
--   SEC-HARD-7  system_settings anon read narrowed to the maintenance key
--               (non-app keys stay hidden from anonymous visitors).
--   SEC-HARD-8  Missing performance indexes.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles INSERT policy hardening (SEC-HARD-1)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND role = 'student'
    AND is_active = TRUE
    AND verified = FALSE
    AND permissions = '{}'
  );

-- -----------------------------------------------------------------------------
-- 2. Server-owned identity lock (SEC-HARD-2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_identity_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max        INTEGER := 2;
  v_complete   BOOLEAN;
  v_new_text   TEXT;
  v_old_text   TEXT;
BEGIN
  -- Super admin, service role and migration writes bypass the lock.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Identity change counters are server-owned: they may only ever grow.
  IF NEW.matric_changes_used     < OLD.matric_changes_used
     OR NEW.faculty_changes_used   < OLD.faculty_changes_used
     OR NEW.department_changes_used < OLD.department_changes_used
     OR NEW.level_changes_used      < OLD.level_changes_used THEN
    RAISE EXCEPTION 'Change counters are server-managed and cannot be reduced.'
      USING ERRCODE = 'P0001';
  END IF;

  -- A profile is "complete" once matric_number + faculty + department are set
  -- (mirrors the client rule). Level is not part of completeness.
  v_complete :=
    COALESCE(NULLIF(trim(OLD.matric_number), ''), '') <> ''
    AND COALESCE(NULLIF(trim(OLD.faculty), ''), '') <> ''
    AND COALESCE(NULLIF(trim(OLD.department), ''), '') <> '';

  IF (COALESCE(lower(trim(NEW.matric_number)), '') IS DISTINCT FROM
      COALESCE(lower(trim(OLD.matric_number)), '')) THEN
    IF v_complete THEN
      RAISE EXCEPTION 'Your profile is complete; the matriculation number is locked. Submit a profile change request.'
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.matric_changes_used >= v_max THEN
      RAISE EXCEPTION 'You have used all allowed changes for the matriculation number. Contact the library administrator.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.matric_changes_used := GREATEST(OLD.matric_changes_used + 1, NEW.matric_changes_used);
  END IF;

  IF (COALESCE(lower(trim(NEW.faculty)), '') IS DISTINCT FROM
      COALESCE(lower(trim(OLD.faculty)), '')) THEN
    IF v_complete THEN
      RAISE EXCEPTION 'Your profile is complete; the faculty is locked. Submit a profile change request.'
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.faculty_changes_used >= v_max THEN
      RAISE EXCEPTION 'You have used all allowed changes for the faculty. Contact the library administrator.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.faculty_changes_used := GREATEST(OLD.faculty_changes_used + 1, NEW.faculty_changes_used);
  END IF;

  IF (COALESCE(lower(trim(NEW.department)), '') IS DISTINCT FROM
      COALESCE(lower(trim(OLD.department)), '')) THEN
    IF v_complete THEN
      RAISE EXCEPTION 'Your profile is complete; the department is locked. Submit a profile change request.'
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.department_changes_used >= v_max THEN
      RAISE EXCEPTION 'You have used all allowed changes for the department. Contact the library administrator.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.department_changes_used := GREATEST(OLD.department_changes_used + 1, NEW.department_changes_used);
  END IF;

  IF (COALESCE(lower(trim(NEW.level)), '') IS DISTINCT FROM
      COALESCE(lower(trim(OLD.level)), '')) THEN
    IF OLD.level_changes_used >= v_max THEN
      RAISE EXCEPTION 'You have used all allowed changes for the level. Contact the library administrator.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.level_changes_used := GREATEST(OLD.level_changes_used + 1, NEW.level_changes_used);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_identity_lock ON public.profiles;
CREATE TRIGGER trg_profiles_identity_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_identity_lock();

-- -----------------------------------------------------------------------------
-- 3. Admin-only profile-change application (SEC-HARD-3)
--    Replaces the client-side profiles.update() + request update in
--    approveProfileChangeRequest(); the column allow-list lives here only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_apply_profile_change(
  p_request_id uuid,
  p_admin_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req       public.profile_change_requests%ROWTYPE;
  v_field     text;
  v_counter   text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_req FROM public.profile_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been resolved.' USING ERRCODE = 'P0001';
  END IF;

  -- Strict column allow-list — never derive identifiers from request input.
  v_field := CASE v_req.field_name
    WHEN 'matric_number' THEN 'matric_number'
    WHEN 'faculty'       THEN 'faculty'
    WHEN 'department'    THEN 'department'
    WHEN 'level'         THEN 'level'
    ELSE NULL
  END;
  v_counter := CASE v_req.field_name
    WHEN 'matric_number' THEN 'matric_changes_used'
    WHEN 'faculty'       THEN 'faculty_changes_used'
    WHEN 'department'    THEN 'department_changes_used'
    WHEN 'level'         THEN 'level_changes_used'
    ELSE NULL
  END;

  IF v_field IS NULL OR v_counter IS NULL THEN
    RAISE EXCEPTION 'Unsupported profile field.' USING ERRCODE = 'P0001';
  END IF;

  -- Apply the approved change and bump the counter. Admin approval is the
  -- authorized override for the student identity lock, so completeness and the
  -- change budget are intentionally NOT applied here.
  EXECUTE format(
    'UPDATE public.profiles SET %I = $1, %I = %I + 1, updated_at = NOW() WHERE id = $2',
    v_field, v_counter, v_counter
  ) USING v_req.requested_value, v_req.student_id;

  UPDATE public.profile_change_requests
     SET status      = 'approved',
         admin_note  = COALESCE(p_admin_note, ''),
         reviewed_by = auth.uid(),
         reviewed_at = NOW()
   WHERE id = p_request_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_req.student_id,
    'Profile Change Approved',
    'Your request to change '
      || replace(v_req.field_name, '_', ' ')
      || ' to "' || v_req.requested_value || '" has been approved.',
    'success',
    '/student/profile'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_apply_profile_change(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_profile_change(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. admin_set_user_active target restriction (SEC-HARD-4)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_user_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own account status.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found.' USING ERRCODE = 'P0001';
  END IF;

  -- Only the Super Admin may suspend/activate administrator accounts.
  IF v_role IN ('admin', 'super_admin') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only the Super Admin can change the status of administrator accounts.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
     SET is_active  = p_active,
         updated_at = NOW()
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. material_departments INSERT — owner path requires unapproved (SEC-HARD-5)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "material_departments_insert_policy" ON public.material_departments;
CREATE POLICY "material_departments_insert_policy" ON public.material_departments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_departments.material_id
        AND m.uploaded_by = auth.uid()
        AND m.status <> 'approved'
    )
  );

-- -----------------------------------------------------------------------------
-- 5b. Materials: owner may attach file metadata to their own PENDING row
--     (SEC-HARD-5b). Previously materials_admin_update_policy denied the
--     step-3 `materials.update({ file_* })` every student upload performs, so
--     every student submission orphaned its binary in the public bucket with no
--     metadata attached. WITH CHECK keeps status/uploaded_by pinned.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "materials_owner_pending_update_policy" ON public.materials;
CREATE POLICY "materials_owner_pending_update_policy" ON public.materials
  FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() AND status = 'pending')
  WITH CHECK (uploaded_by = auth.uid() AND status = 'pending');

-- -----------------------------------------------------------------------------
-- 6. Function execute hardening (SEC-HARD-6)
--    Drop the default PUBLIC grant so only explicitly listed roles can call.
-- -----------------------------------------------------------------------------
-- Bootstrap: internal `super admin already exists` guard only; restrict anyway.
REVOKE ALL ON FUNCTION public.promote_first_super_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_first_super_admin(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_first_super_admin(text) TO service_role;

-- Notification fan-out / lifecycle functions are invoked by triggers (definers);
-- no client ever needs to call them.
REVOKE ALL ON FUNCTION public.notify_material_audience(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_new_material() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_material_department() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_material_deleted(text, uuid) FROM PUBLIC;

-- Counter helpers are legitimately used by the public-facing read UX, but only
-- authenticated users (Revokes the anon/PUBLIC execute that previously allowed
-- anyone to inflate counters).
REVOKE ALL ON FUNCTION public.increment_download_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_download_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_download_count(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.increment_view_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_view_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_view_count(uuid) TO authenticated;

-- Academic-calendar write path is internally super-admin guarded; keep the
-- authenticated grant the UI needs, drop the default PUBLIC grant.
REVOKE ALL ON FUNCTION public.set_semester_calendar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_semester_calendar(jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. system_settings anonymous read narrowed (SEC-HARD-7)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "system_settings_public_read" ON public.system_settings;
CREATE POLICY "system_settings_public_read"
  ON public.system_settings
  FOR SELECT
  USING (key = 'maintenance');

-- -----------------------------------------------------------------------------
-- 7b. Storage: approved-material files are immutable by their uploader
--     (SEC-HARD-7b). Previously the original uploader could overwrite or delete
--     the physical file of an ALREADY-APPROVED material (metadata survived,
--     downloads broke). Owners may still manage their own objects that are not
--     attached to an approved material.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "library-materials owner update" ON storage.objects;
CREATE POLICY "library-materials owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'library-materials'
    AND (
      public.is_admin()
      OR (
        owner = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.materials m
          WHERE m.file_path = storage.objects.name
            AND m.status = 'approved'
        )
      )
    )
  )
  WITH CHECK (bucket_id = 'library-materials');

DROP POLICY IF EXISTS "library-materials owner delete" ON storage.objects;
CREATE POLICY "library-materials owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'library-materials'
    AND (
      public.is_admin()
      OR (
        owner = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.materials m
          WHERE m.file_path = storage.objects.name
            AND m.status = 'approved'
        )
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_materials_file_path
  ON public.materials (file_path);

-- -----------------------------------------------------------------------------
-- 8. Missing indexes (SEC-HARD-8)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_student_courses_status
  ON public.student_courses (status);

CREATE INDEX IF NOT EXISTS idx_active_sessions_last_active
  ON public.active_sessions (last_active);

-- ==============================================================================
-- End of migration
-- ==============================================================================