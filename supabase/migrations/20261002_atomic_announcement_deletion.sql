BEGIN;

CREATE OR REPLACE FUNCTION public.delete_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only authorized administrators can delete announcements.';
  END IF;

  DELETE FROM public.notifications
   WHERE dedupe_key = 'announcement:' || p_announcement_id::text;

  DELETE FROM public.library_announcements
   WHERE id = p_announcement_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'Announcement not found.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_announcement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_announcement(uuid) TO authenticated;

COMMIT;
