-- =============================================================================
-- 20260919 — Server-side admin notifications for deletion & profile-change
-- requests.
--
-- The mobile app previously attempted a client-side INSERT into notifications
-- when a student submitted a deletion request, targeting the student's own
-- user_id. That row would apply the wrong recipient, and client inserts for
-- OTHER users are denied by notifications_insert_own
-- (CHECK user_id = auth.uid() OR is_admin()). The correct path is a SECURITY
-- DEFINER trigger that notifies the active admin pool, mirroring
-- notify_message_recipient (20260913_direct_messaging_fix).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notify active admin pool when a deletion request is created.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admins_deletion_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_name text;
BEGIN
  SELECT COALESCE(p.display_name, p.full_name, p.username, 'A student')
  INTO v_student_name
  FROM public.profiles p
  WHERE p.id = NEW.student_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT p.id,
         'New Deletion Request',
         left(v_student_name || ' requested deletion of "' || NEW.item_name || '".', 200),
         'warning',
         '/admin/deletion-requests'
  FROM public.profiles p
  WHERE p.role IN ('admin', 'super_admin') AND p.is_active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deletion_requests_notify_admins ON public.deletion_requests;
CREATE TRIGGER trg_deletion_requests_notify_admins
  AFTER INSERT ON public.deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_deletion_request();

-- -----------------------------------------------------------------------------
-- 2. Notify active admin pool when a profile-change request is created.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_admins_profile_change_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_name text;
BEGIN
  SELECT COALESCE(p.display_name, p.full_name, p.username, 'A student')
  INTO v_student_name
  FROM public.profiles p
  WHERE p.id = NEW.student_id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT p.id,
         'Profile Update Request',
         left(v_student_name || ' submitted a profile change request.', 200),
         'warning',
         '/admin/change-requests'
  FROM public.profiles p
  WHERE p.role IN ('admin', 'super_admin') AND p.is_active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_change_requests_notify_admins ON public.profile_change_requests;
CREATE TRIGGER trg_profile_change_requests_notify_admins
  AFTER INSERT ON public.profile_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_profile_change_request();