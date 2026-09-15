-- =============================================================================
-- FUW E-Library — SECURITY HARDENING (2026-08-29)
--
-- Resolves findings from the penetration-testing assessment:
--   * AUTHZ-02  Deactivated admins kept access because several admin policies
--               checked `role IN ('admin','super_admin')` inline WITHOUT the
--               `is_active` flag. Replaced with the central is_admin() /
--               is_super_admin() helpers (which enforce is_active).
--   * AUTHZ-01  Any authenticated user could read the full text of
--               material_chunks (SELECT USING TRUE), bypassing the
--               approved-only boundary. Now restricted to approved materials.
--   * AUTH-01   lookup_login_email was executable by anon (account/email
--               enumeration). DROPPED. Username->email resolution moved
--               server-side into the `resolve-login` edge function, which never
--               reveals an email (session is returned only on correct password
--               or a neutral response for password resets).
--   * AUTH-02   register_identity_check was executable by anon (username/email
--               enumeration). No longer executable by anon.
--   * EDGE-02   terminate_other_sessions / cleanup_stale_sessions were
--               SECURITY DEFINER without a pinned search_path. Now pinned.
--   * INF-01    Analytics RPCs count only approved materials and are no longer
--               granted to anon.
--   * STOR-01   Server-side upload validation trigger on storage.objects
--               (content-type allow/deny) so script payloads cannot be stored
--               in the library bucket.
--   * CFG-02    system_settings public read narrowed to the `maintenance` row.
--
-- Idempotent and safe to re-run. Apply in the Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- AUTHZ-02 — Deactivated-admin protection.
-- All admin-only policies now use is_admin() / is_super_admin() (which check
-- profiles.is_active) instead of inline role checks.
-- -----------------------------------------------------------------------------

-- deletion_requests
DROP POLICY IF EXISTS "dr_select_admin" ON public.deletion_requests;
CREATE POLICY "dr_select_admin" ON public.deletion_requests
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "dr_update_admin" ON public.deletion_requests;
CREATE POLICY "dr_update_admin" ON public.deletion_requests
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "dr_delete_admin" ON public.deletion_requests;
CREATE POLICY "dr_delete_admin" ON public.deletion_requests
  FOR DELETE USING (public.is_admin());

-- conversations
DROP POLICY IF EXISTS "conv_select_admin" ON public.conversations;
CREATE POLICY "conv_select_admin" ON public.conversations
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "conv_insert_admin" ON public.conversations;
CREATE POLICY "conv_insert_admin" ON public.conversations
  FOR INSERT WITH CHECK (public.is_admin());

-- messages
DROP POLICY IF EXISTS "msg_select_conv_participant" ON public.messages;
CREATE POLICY "msg_select_conv_participant" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "msg_insert_sender" ON public.messages;
CREATE POLICY "msg_insert_sender" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "msg_update_conv_participant" ON public.messages;
CREATE POLICY "msg_update_conv_participant" ON public.messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid() OR public.is_admin())
    )
  );

-- profile_change_requests
DROP POLICY IF EXISTS "pcr_select_admin" ON public.profile_change_requests;
CREATE POLICY "pcr_select_admin" ON public.profile_change_requests
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "pcr_update_admin" ON public.profile_change_requests;
CREATE POLICY "pcr_update_admin" ON public.profile_change_requests
  FOR UPDATE USING (public.is_admin());

-- student_courses
DROP POLICY IF EXISTS "student_courses_select_admin" ON public.student_courses;
CREATE POLICY "student_courses_select_admin" ON public.student_courses
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "student_courses_update_admin" ON public.student_courses;
CREATE POLICY "student_courses_update_admin" ON public.student_courses
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "student_courses_delete_admin" ON public.student_courses;
CREATE POLICY "student_courses_delete_admin" ON public.student_courses
  FOR DELETE USING (public.is_admin());

-- active_sessions (admin "all" management)
DROP POLICY IF EXISTS "Admins manage all sessions" ON public.active_sessions;
CREATE POLICY "Admins manage all sessions" ON public.active_sessions
  FOR ALL USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- AUTHZ-01 — material_chunks readable only for APPROVED materials.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "material_chunks_read_auth" ON public.material_chunks;
CREATE POLICY "material_chunks_read_auth" ON public.material_chunks
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_id AND m.status = 'approved'::public.material_status
    )
  );

-- Also restrict service_role-only writes so the policy surface is explicit.
DROP POLICY IF EXISTS "material_chunks_owner_insert" ON public.material_chunks;
CREATE POLICY "material_chunks_owner_insert" ON public.material_chunks
  FOR INSERT TO service_role WITH CHECK (TRUE);

-- -----------------------------------------------------------------------------
-- AUTH-01 / AUTH-02 — Remove the public enumeration oracles.
--   * lookup_login_email: DROPPED entirely. The login and password-reset flows
--     resolve username->email server-side in the `resolve-login` Edge Function
--     (uses the service client directly — no public RPC, no enumeration).
--   * register_identity_check: no longer executable by anon. The registration
--     pre-check now fails over to Supabase Auth / DB unique indexes, which
--     reject duplicates server-side. Kept only for authenticated/service use.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lookup_login_email(TEXT);

CREATE OR REPLACE FUNCTION public.register_identity_check(p_username text, p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
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
REVOKE ALL ON FUNCTION public.register_identity_check(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_identity_check(TEXT, TEXT) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- EDGE-02 — pin search_path on SECURITY DEFINER session helpers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.terminate_other_sessions(p_session_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.active_sessions
  WHERE user_id = auth.uid()
    AND session_key <> p_session_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_sessions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.active_sessions
  WHERE last_active < now() - interval '30 minutes';
END;
$$;

GRANT EXECUTE ON FUNCTION public.terminate_other_sessions(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_sessions() TO authenticated;

-- -----------------------------------------------------------------------------
-- INF-01 — analytics: count only approved materials; keep anon grants for the
--          genuinely public, aggregate-only stats (get_public_stats,
--          get_library_stats) but deny anon the per-faculty / per-department /
--          gender counts and the pending/rejected-leaking material counts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_materials_by_faculty()
RETURNS TABLE (name text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(trim(p.faculty), ''), 'Unspecified')::text AS name,
         COUNT(*)::bigint AS count
  FROM public.materials p
  WHERE p.faculty IS NOT NULL AND p.status = 'approved'::public.material_status
  GROUP BY name
  ORDER BY count DESC, name ASC;
$$;

CREATE OR REPLACE FUNCTION public.count_materials_by_department()
RETURNS TABLE (name text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(trim(p.department), ''), 'Unspecified')::text AS name,
         COUNT(*)::bigint AS count
  FROM public.materials p
  WHERE p.department IS NOT NULL AND p.status = 'approved'::public.material_status
  GROUP BY name
  ORDER BY count DESC, name ASC;
$$;

REVOKE ALL ON FUNCTION public.count_students_by_gender() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_materials_by_faculty() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_materials_by_department() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_students_by_gender() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_materials_by_faculty() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_materials_by_department() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- STOR-01 — Server-side upload validation for the library-materials bucket.
-- Storage objects policy cannot enforce file *contents*, so we validate on
-- INSERT via a trigger on storage.objects:
--   * block obviously executable / scriptable payloads (HTML, SVG, JS, VBS,
--     MHT, XML with scripts, executables, archives, images, fonts);
--   * allow only the document types the reader + AI pipeline support
--     (PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, TXT).
-- This is defense-in-depth: the client already filters, and Netlify serves the
-- site with nosniff + a strict CSP so even a storage-accepted file cannot
-- execute in the reader iframe.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_invalid_library_upload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ct text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.bucket_id = 'library-materials' THEN
    ct := lower(COALESCE(
      NULLIF(NEW.metadata->>'mimetype', ''),
      NULLIF(NEW.metadata->>'contentType', ''),
      NULLIF(NEW.metadata->>'content_type', '')
    ));
    IF ct IS NULL OR ct = '' OR ct = 'application/octet-stream' THEN
      RAISE EXCEPTION 'library upload: missing or generic content type is not allowed'
        USING ERRCODE = 'P0001';
    END IF;
    -- Explicit deny-list: any of these means a scriptable/executable payload.
    IF ct LIKE '%html%' OR ct LIKE '%xml%' OR ct LIKE '%svg%'
       OR ct LIKE '%javascript%' OR ct LIKE '%ecmascript%' OR ct LIKE '%x-sh%'
       OR ct LIKE '%vbs%' OR ct LIKE '%x-httpd%' OR ct LIKE '%x-msdownload%'
       OR ct LIKE '%x-msdos%' OR ct = 'application/x-ms-application'
       OR ct = 'application/x-dosexec'
       OR ct LIKE '%zip%' OR ct LIKE '%x-compressed%' OR ct LIKE '%x-7z%'
       OR ct LIKE '%octet-stream%' OR ct LIKE '%x-rar%' OR ct LIKE '%x-tar%'
       OR ct LIKE '%gzip%' OR ct LIKE '%bzip%' THEN
      RAISE EXCEPTION 'library upload: content type % is not permitted', ct
        USING ERRCODE = 'P0001';
    END IF;
    -- Allow-list guard: only document MIME types the reader/AI support.
    IF ct NOT IN (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ) THEN
      RAISE EXCEPTION 'library upload: content type % is not in the allowed set', ct
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_invalid_library_upload ON storage.objects;
CREATE TRIGGER trg_reject_invalid_library_upload
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_invalid_library_upload();

-- -----------------------------------------------------------------------------
-- CFG-02 — system_settings public read was USING(TRUE) (all rows). Only the
--          `maintenance` row is meant to be public (used by anon visitors).
--          Everything else must be super-admin-only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "system_settings_public_read" ON public.system_settings;
CREATE POLICY "system_settings_public_read" ON public.system_settings
  FOR SELECT USING (key = 'maintenance');

COMMIT;
