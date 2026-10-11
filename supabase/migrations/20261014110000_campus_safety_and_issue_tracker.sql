-- =============================================================================
-- CAMPUS SAFETY & ISSUE TRACKER  (Features I + N)
--
--   * campus_safety_contacts — an admin-maintained directory of emergency and
--     support contacts. Readable by any signed-in student; only moderators may
--     write. This is a platform-managed information sheet, NOT a live dispatch
--     or real-time security service, and the UI says so.
--   * campus_issues — a structured reporting channel for recurring campus
--     problems (water, power, internet, facilities). Students submit a report
--     and receive a reference number; they can read and track their own reports.
--     Moderators can triage, update status and resolve.
--
-- SECURITY
--   * A reporter can only read/insert/delete their own issues and can never set
--     status/priority/admin_notes/assigned_to — those columns are moderator-only
--     (enforced by RLS: there is no reporter UPDATE policy).
--   * `is_anonymous` records the reporter's display preference for future
--     surfaces; the reporter_id is always retained (moderators need it to
--     follow up) and only ever exposed to the reporter and moderators.
--   * Issue photos reuse the private campus-media `lost-found` scope, which is
--     owner-or-admin readable; no new storage surface is introduced.
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.campus_safety_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 2 AND 120),
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('emergency','security','health','counselling','academic','admin','general')),
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_emergency boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campus_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE
    DEFAULT ('FUW-' || to_char(now(), 'YYMM') || '-' ||
             upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('water','electricity','internet','classroom','hostel','sanitation','accessibility','safety','other')),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 160),
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  photo_path text,
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','in_progress','resolved','closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  admin_notes text NOT NULL DEFAULT '',
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campus_safety_contacts_published
  ON public.campus_safety_contacts (is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_campus_issues_reporter
  ON public.campus_issues (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campus_issues_status
  ON public.campus_issues (status, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.campus_safety_contacts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.campus_safety_contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.campus_issues;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.campus_issues
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Force moderator-only columns to safe defaults for a non-moderator insert (a
-- crafted client cannot self-assign a status, priority or admin note), and keep
-- resolved_at coherent with status on every update.
CREATE OR REPLACE FUNCTION public.guard_campus_issue_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT (public.is_admin() OR public.has_permission('manage_safety')) THEN
      NEW.status := 'open';
      NEW.priority := 'normal';
      NEW.admin_notes := '';
      NEW.assigned_to := NULL;
      NEW.resolved_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    NEW.resolved_at := now();
  ELSIF NEW.status <> 'resolved' THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_campus_issue_state ON public.campus_issues;
CREATE TRIGGER guard_campus_issue_state BEFORE INSERT OR UPDATE ON public.campus_issues
  FOR EACH ROW EXECUTE FUNCTION public.guard_campus_issue_state();

ALTER TABLE public.campus_safety_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_issues ENABLE ROW LEVEL SECURITY;

-- ── campus_safety_contacts ───────────────────────────────────────────────────
DROP POLICY IF EXISTS campus_safety_contacts_select ON public.campus_safety_contacts;
CREATE POLICY campus_safety_contacts_select ON public.campus_safety_contacts
  FOR SELECT TO authenticated
  USING (is_published OR public.is_admin() OR public.has_permission('manage_safety'));

DROP POLICY IF EXISTS campus_safety_contacts_admin_insert ON public.campus_safety_contacts;
CREATE POLICY campus_safety_contacts_admin_insert ON public.campus_safety_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.has_permission('manage_safety'));

DROP POLICY IF EXISTS campus_safety_contacts_admin_update ON public.campus_safety_contacts;
CREATE POLICY campus_safety_contacts_admin_update ON public.campus_safety_contacts
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.has_permission('manage_safety'))
  WITH CHECK (public.is_admin() OR public.has_permission('manage_safety'));

DROP POLICY IF EXISTS campus_safety_contacts_admin_delete ON public.campus_safety_contacts;
CREATE POLICY campus_safety_contacts_admin_delete ON public.campus_safety_contacts
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.has_permission('manage_safety'));

-- ── campus_issues ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS campus_issues_select_own_or_admin ON public.campus_issues;
CREATE POLICY campus_issues_select_own_or_admin ON public.campus_issues
  FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR public.is_admin()
    OR public.has_permission('manage_safety')
  );

DROP POLICY IF EXISTS campus_issues_insert_own ON public.campus_issues;
CREATE POLICY campus_issues_insert_own ON public.campus_issues
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS campus_issues_delete_own_or_admin ON public.campus_issues;
CREATE POLICY campus_issues_delete_own_or_admin ON public.campus_issues
  FOR DELETE TO authenticated
  USING (
    reporter_id = auth.uid()
    OR public.is_admin()
    OR public.has_permission('manage_safety')
  );

-- Moderators are the only writers of status/priority/notes. A separate UPDATE
-- policy just for them (reporters have no UPDATE policy at all).
DROP POLICY IF EXISTS campus_issues_update_admin ON public.campus_issues;
CREATE POLICY campus_issues_update_admin ON public.campus_issues
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.has_permission('manage_safety'))
  WITH CHECK (public.is_admin() OR public.has_permission('manage_safety'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campus_safety_contacts TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.campus_issues TO authenticated;
GRANT UPDATE ON public.campus_issues TO authenticated;
REVOKE ALL ON public.campus_safety_contacts FROM anon;
REVOKE ALL ON public.campus_issues FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
