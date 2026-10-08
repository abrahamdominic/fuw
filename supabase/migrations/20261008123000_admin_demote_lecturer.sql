-- Demote lecturer RPC
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_demote_lecturer(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.has_permission('manage_lecturers')) THEN
    RAISE EXCEPTION 'Not authorized to manage lecturers.';
  END IF;

  UPDATE public.profiles
     SET role = 'student'::public.app_role
   WHERE id = target_user_id;

  DELETE FROM public.lecturers
   WHERE profile_id = target_user_id;
END;
$$;

COMMIT;
