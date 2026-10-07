-- Campus platform foundation. Extends the existing profile, notification,
-- course catalogue, and material systems without introducing parallel users.
BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'academic', 'events', 'organizations', 'marketplace', 'messages',
    'jobs', 'study_groups', 'payments', 'platform'
  )),
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preferences_own ON public.notification_preferences;
CREATE POLICY notification_preferences_own ON public.notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.student_course_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'in_progress', 'completed', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS student_course_tracker_unique_idx
  ON public.student_course_tracker (student_id, course_id, (coalesce(academic_session_id, '00000000-0000-0000-0000-000000000000'::uuid)));
CREATE INDEX IF NOT EXISTS student_course_tracker_student_idx
  ON public.student_course_tracker (student_id, status);
ALTER TABLE public.student_course_tracker ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_course_tracker_own ON public.student_course_tracker;
CREATE POLICY student_course_tracker_own ON public.student_course_tracker
  FOR ALL TO authenticated USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 180),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Campus'
    CHECK (category IN ('Academic', 'Career', 'Competition', 'Religious', 'Technology', 'Social', 'Workshop', 'Seminar', 'Campus', 'Other')),
  venue text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  registration_deadline timestamptz,
  cover_image_path text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS events_public_schedule_idx
  ON public.events (starts_at, category) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS events_organizer_idx ON public.events (organizer_id, created_at DESC);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_read_published_or_owner ON public.events;
CREATE POLICY events_read_published_or_owner ON public.events
  FOR SELECT TO authenticated USING (
    status = 'published' OR organizer_id = auth.uid() OR public.is_admin()
  );
DROP POLICY IF EXISTS events_public_read ON public.events;
CREATE POLICY events_public_read ON public.events
  FOR SELECT TO anon USING (status = 'published');
DROP POLICY IF EXISTS events_create_draft ON public.events;
CREATE POLICY events_create_draft ON public.events
  FOR INSERT TO authenticated WITH CHECK (organizer_id = auth.uid() AND status = 'draft');
DROP POLICY IF EXISTS events_update_draft ON public.events;
CREATE POLICY events_update_draft ON public.events
  FOR UPDATE TO authenticated USING (organizer_id = auth.uid() AND status = 'draft')
  WITH CHECK (organizer_id = auth.uid() AND status = 'draft');
DROP POLICY IF EXISTS events_moderator_manage ON public.events;
CREATE POLICY events_moderator_manage ON public.events
  FOR ALL TO authenticated USING (public.has_permission('manage_events'))
  WITH CHECK (public.has_permission('manage_events'));
DROP POLICY IF EXISTS events_owner_delete_draft ON public.events;
CREATE POLICY events_owner_delete_draft ON public.events
  FOR DELETE TO authenticated USING (organizer_id = auth.uid() AND status = 'draft');

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled', 'attended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, student_id)
);
CREATE INDEX IF NOT EXISTS event_rsvps_student_idx ON public.event_rsvps (student_id, created_at DESC);
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_rsvps_own_or_organizer ON public.event_rsvps;
CREATE POLICY event_rsvps_own_or_organizer ON public.event_rsvps
  FOR SELECT TO authenticated USING (
    student_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_id
        AND (e.organizer_id = auth.uid() OR public.has_permission('manage_events'))
    )
  );
DROP POLICY IF EXISTS event_rsvps_own_write ON public.event_rsvps;
CREATE POLICY event_rsvps_own_write ON public.event_rsvps
  FOR INSERT TO authenticated WITH CHECK (
    student_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_id AND e.status = 'published'
        AND e.starts_at > now()
        AND (e.capacity IS NULL OR (
          SELECT count(*) FROM public.event_rsvps r
          WHERE r.event_id = e.id AND r.status = 'registered'
        ) < e.capacity)
    )
  );
DROP POLICY IF EXISTS event_rsvps_own_cancel ON public.event_rsvps;
CREATE POLICY event_rsvps_own_cancel ON public.event_rsvps
  FOR UPDATE TO authenticated USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid() AND status IN ('registered', 'cancelled'));
DROP POLICY IF EXISTS event_rsvps_moderator_update ON public.event_rsvps;
CREATE POLICY event_rsvps_moderator_update ON public.event_rsvps
  FOR UPDATE TO authenticated USING (public.has_permission('manage_events'))
  WITH CHECK (public.has_permission('manage_events'));

CREATE OR REPLACE FUNCTION public.guard_event_rsvp_capacity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_capacity integer;
  v_starts_at timestamptz;
  v_status text;
  v_count integer;
BEGIN
  IF NEW.status <> 'registered' THEN
    RETURN NEW;
  END IF;
  SELECT capacity, starts_at, status
    INTO v_capacity, v_starts_at, v_status
    FROM public.events WHERE id = NEW.event_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'published' OR v_starts_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'This event is not open for registration';
  END IF;
  SELECT count(*) INTO v_count FROM public.event_rsvps
    WHERE event_id = NEW.event_id AND status = 'registered'
      AND student_id <> NEW.student_id;
  IF v_capacity IS NOT NULL AND v_count >= v_capacity THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'This event has reached capacity';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS event_rsvp_capacity_guard ON public.event_rsvps;
CREATE TRIGGER event_rsvp_capacity_guard
  BEFORE INSERT OR UPDATE OF status ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_rsvp_capacity();

CREATE OR REPLACE FUNCTION public.notify_event_rsvp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_title text;
  v_organizer uuid;
BEGIN
  IF NEW.status <> 'registered' OR
     (TG_OP = 'UPDATE' AND OLD.status = 'registered') THEN
    RETURN NEW;
  END IF;
  SELECT title, organizer_id INTO v_title, v_organizer
    FROM public.events WHERE id = NEW.event_id;

  IF COALESCE((
    SELECT in_app_enabled FROM public.notification_preferences
    WHERE user_id = NEW.student_id AND category = 'events'
  ), true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.student_id, 'Event registration confirmed',
        'Your RSVP for ' || COALESCE(v_title, 'a campus event') || ' is confirmed.',
        'success', '/student/events');
  END IF;

  IF v_organizer IS NOT NULL AND v_organizer <> NEW.student_id AND COALESCE((
    SELECT in_app_enabled FROM public.notification_preferences
    WHERE user_id = v_organizer AND category = 'events'
  ), true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_organizer, 'New event RSVP',
        'A student registered for ' || COALESCE(v_title, 'your event') || '.',
        'info', '/student/events');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS event_rsvp_notifications ON public.event_rsvps;
CREATE TRIGGER event_rsvp_notifications
  AFTER INSERT OR UPDATE OF status ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.notify_event_rsvp();

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 160),
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Student organization',
  faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  logo_path text,
  cover_image_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_organization_id_fkey'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS organizations_public_idx ON public.organizations (category, name) WHERE status = 'published';
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_public_or_owner_read ON public.organizations;
CREATE POLICY organizations_public_or_owner_read ON public.organizations
  FOR SELECT TO authenticated USING (status = 'published' OR owner_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS organizations_public_read ON public.organizations;
CREATE POLICY organizations_public_read ON public.organizations
  FOR SELECT TO anon USING (status = 'published');
DROP POLICY IF EXISTS organizations_owner_create ON public.organizations;
CREATE POLICY organizations_owner_create ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS organizations_owner_edit_pending ON public.organizations;
CREATE POLICY organizations_owner_edit_pending ON public.organizations
  FOR UPDATE TO authenticated USING (owner_id = auth.uid() AND status = 'pending')
  WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS organizations_admin_manage ON public.organizations;
CREATE POLICY organizations_admin_manage ON public.organizations
  FOR ALL TO authenticated USING (public.has_permission('manage_organizations'))
  WITH CHECK (public.has_permission('manage_organizations'));
DROP POLICY IF EXISTS organizations_owner_delete_pending ON public.organizations;
CREATE POLICY organizations_owner_delete_pending ON public.organizations
  FOR DELETE TO authenticated USING (owner_id = auth.uid() AND status = 'pending');

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'leader')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, student_id)
);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_members_private_read ON public.organization_members;
CREATE POLICY organization_members_private_read ON public.organization_members
  FOR SELECT TO authenticated USING (
    student_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND o.owner_id = auth.uid()
    ) OR public.has_permission('manage_organizations')
  );
DROP POLICY IF EXISTS organization_members_request ON public.organization_members;
CREATE POLICY organization_members_request ON public.organization_members
  FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid() AND role = 'member' AND status = 'pending');
DROP POLICY IF EXISTS organization_members_self_leave ON public.organization_members;
CREATE POLICY organization_members_self_leave ON public.organization_members
  FOR DELETE TO authenticated USING (student_id = auth.uid() AND role = 'member');
DROP POLICY IF EXISTS organization_members_owner_manage ON public.organization_members;
CREATE POLICY organization_members_owner_manage ON public.organization_members
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND o.owner_id = auth.uid())
    OR public.has_permission('manage_organizations')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = organization_id AND o.owner_id = auth.uid())
    OR public.has_permission('manage_organizations')
  );

-- These narrowly scoped SECURITY DEFINER predicates avoid recursive RLS:
-- group policies must inspect membership and membership policies inspect groups.
CREATE OR REPLACE FUNCTION public.is_study_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.study_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid() AND status = 'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_study_group_owner(p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.study_groups
    WHERE id = p_group_id AND owner_id = auth.uid()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.is_study_group_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_study_group_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_study_group_member(uuid), public.is_study_group_owner(uuid)
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.job_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 180),
  employer text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Other',
  location text NOT NULL DEFAULT '',
  work_mode text NOT NULL DEFAULT 'on_campus' CHECK (work_mode IN ('on_campus', 'remote', 'hybrid')),
  compensation text NOT NULL DEFAULT '',
  requirements text NOT NULL DEFAULT '',
  application_method text NOT NULL DEFAULT '',
  deadline timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'closed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_listings_public_idx ON public.job_listings (category, created_at DESC) WHERE status = 'published';
ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_listings_public_or_owner_read ON public.job_listings;
CREATE POLICY job_listings_public_or_owner_read ON public.job_listings
  FOR SELECT TO authenticated USING (status = 'published' OR owner_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS job_listings_public_read ON public.job_listings;
CREATE POLICY job_listings_public_read ON public.job_listings
  FOR SELECT TO anon USING (status = 'published');
DROP POLICY IF EXISTS job_listings_owner_create ON public.job_listings;
CREATE POLICY job_listings_owner_create ON public.job_listings
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS job_listings_owner_edit_pending ON public.job_listings;
CREATE POLICY job_listings_owner_edit_pending ON public.job_listings
  FOR UPDATE TO authenticated USING (owner_id = auth.uid() AND status = 'pending')
  WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS job_listings_moderator_manage ON public.job_listings;
CREATE POLICY job_listings_moderator_manage ON public.job_listings
  FOR ALL TO authenticated USING (public.has_permission('moderate_jobs'))
  WITH CHECK (public.has_permission('moderate_jobs'));
DROP POLICY IF EXISTS job_listings_owner_delete_pending ON public.job_listings;
CREATE POLICY job_listings_owner_delete_pending ON public.job_listings
  FOR DELETE TO authenticated USING (owner_id = auth.uid() AND status = 'pending');

CREATE TABLE IF NOT EXISTS public.skill_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 140),
  skills text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  portfolio_url text,
  rate text NOT NULL DEFAULT '',
  availability text NOT NULL DEFAULT '',
  contact_method text NOT NULL DEFAULT '',
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_profiles_public_idx ON public.skill_profiles (user_id) WHERE is_published;
ALTER TABLE public.skill_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_profiles_public_or_owner_read ON public.skill_profiles;
CREATE POLICY skill_profiles_public_or_owner_read ON public.skill_profiles
  FOR SELECT TO authenticated USING (is_published OR user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS skill_profiles_public_read ON public.skill_profiles;
CREATE POLICY skill_profiles_public_read ON public.skill_profiles
  FOR SELECT TO anon USING (is_published);
DROP POLICY IF EXISTS skill_profiles_owner_manage ON public.skill_profiles;
CREATE POLICY skill_profiles_owner_manage ON public.skill_profiles
  FOR ALL TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.lost_found_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('lost', 'found')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  category text NOT NULL CHECK (category IN ('Phones', 'Wallets', 'IDs', 'Keys', 'Books', 'Bags', 'Electronics', 'Other')),
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  item_date date,
  photo_path text,
  contact_method text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'potential_match', 'claimed', 'resolved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_found_public_idx ON public.lost_found_items (report_type, category, created_at DESC) WHERE status IN ('open', 'potential_match');
ALTER TABLE public.lost_found_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lost_found_public_or_owner_read ON public.lost_found_items;
CREATE POLICY lost_found_public_or_owner_read ON public.lost_found_items
  FOR SELECT TO authenticated USING (status IN ('open', 'potential_match') OR owner_id = auth.uid() OR public.has_permission('moderate_lost_found'));
DROP POLICY IF EXISTS lost_found_public_read ON public.lost_found_items;
CREATE POLICY lost_found_public_read ON public.lost_found_items
  FOR SELECT TO anon USING (status IN ('open', 'potential_match'));
DROP POLICY IF EXISTS lost_found_owner_create ON public.lost_found_items;
CREATE POLICY lost_found_owner_create ON public.lost_found_items
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS lost_found_owner_update ON public.lost_found_items;
CREATE POLICY lost_found_owner_update ON public.lost_found_items
  FOR UPDATE TO authenticated USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS lost_found_moderator_manage ON public.lost_found_items;
CREATE POLICY lost_found_moderator_manage ON public.lost_found_items
  FOR ALL TO authenticated USING (public.has_permission('moderate_lost_found'))
  WITH CHECK (public.has_permission('moderate_lost_found'));
DROP POLICY IF EXISTS lost_found_owner_delete ON public.lost_found_items;
CREATE POLICY lost_found_owner_delete ON public.lost_found_items
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.lost_found_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.lost_found_items(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  verification_details text NOT NULL CHECK (length(trim(verification_details)) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'resolved')),
  moderator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lost_found_claims_item_idx ON public.lost_found_claims (item_id, created_at DESC);
ALTER TABLE public.lost_found_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lost_found_claims_private_read ON public.lost_found_claims;
CREATE POLICY lost_found_claims_private_read ON public.lost_found_claims
  FOR SELECT TO authenticated USING (
    claimant_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.lost_found_items i WHERE i.id = item_id AND i.owner_id = auth.uid()
    ) OR public.has_permission('moderate_lost_found')
  );
DROP POLICY IF EXISTS lost_found_claims_create ON public.lost_found_claims;
CREATE POLICY lost_found_claims_create ON public.lost_found_claims
  FOR INSERT TO authenticated WITH CHECK (
    claimant_id = auth.uid() AND status = 'pending' AND moderator_id IS NULL AND EXISTS (
      SELECT 1 FROM public.lost_found_items i
      WHERE i.id = item_id AND i.owner_id <> auth.uid() AND i.status IN ('open', 'potential_match')
    )
  );
DROP POLICY IF EXISTS lost_found_claims_moderate ON public.lost_found_claims;
CREATE POLICY lost_found_claims_moderate ON public.lost_found_claims
  FOR UPDATE TO authenticated USING (
    public.has_permission('moderate_lost_found') OR EXISTS (
      SELECT 1 FROM public.lost_found_items i WHERE i.id = item_id AND i.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_permission('moderate_lost_found') OR EXISTS (
      SELECT 1 FROM public.lost_found_items i WHERE i.id = item_id AND i.owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.notify_lost_found_claim()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.lost_found_items WHERE id = NEW.item_id;
  IF v_owner IS NOT NULL AND COALESCE((
    SELECT in_app_enabled FROM public.notification_preferences
    WHERE user_id = v_owner AND category = 'platform'
  ), true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_owner, 'Private item claim received',
        'Someone submitted private ownership details for your lost-and-found item.',
        'info', '/student/lost-found');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lost_found_claim_notification ON public.lost_found_claims;
CREATE TRIGGER lost_found_claim_notification
  AFTER INSERT ON public.lost_found_claims
  FOR EACH ROW EXECUTE FUNCTION public.notify_lost_found_claim();

CREATE TABLE IF NOT EXISTS public.study_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 160),
  description text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_groups_public_idx ON public.study_groups (course_id, created_at DESC) WHERE status = 'published' AND is_public;
ALTER TABLE public.study_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_groups_read ON public.study_groups;
CREATE POLICY study_groups_read ON public.study_groups
  FOR SELECT TO authenticated USING (
    (status = 'published' AND is_public) OR owner_id = auth.uid()
    OR public.is_study_group_member(id)
    OR public.has_permission('manage_study_groups')
  );
DROP POLICY IF EXISTS study_groups_owner_create ON public.study_groups;
CREATE POLICY study_groups_owner_create ON public.study_groups
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS study_groups_owner_edit_pending ON public.study_groups;
CREATE POLICY study_groups_owner_edit_pending ON public.study_groups
  FOR UPDATE TO authenticated USING (owner_id = auth.uid() AND status = 'pending')
  WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS study_groups_moderator_manage ON public.study_groups;
CREATE POLICY study_groups_moderator_manage ON public.study_groups
  FOR ALL TO authenticated USING (public.has_permission('manage_study_groups'))
  WITH CHECK (public.has_permission('manage_study_groups'));
DROP POLICY IF EXISTS study_groups_owner_delete_pending ON public.study_groups;
CREATE POLICY study_groups_owner_delete_pending ON public.study_groups
  FOR DELETE TO authenticated USING (owner_id = auth.uid() AND status = 'pending');

CREATE TABLE IF NOT EXISTS public.study_group_members (
  group_id uuid NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'leader')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
ALTER TABLE public.study_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_group_members_read ON public.study_group_members;
CREATE POLICY study_group_members_read ON public.study_group_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.study_groups g WHERE g.id = group_id AND g.owner_id = auth.uid()
    ) OR public.is_study_group_member(group_id)
    OR public.has_permission('manage_study_groups')
  );
DROP POLICY IF EXISTS study_group_members_join ON public.study_group_members;
CREATE POLICY study_group_members_join ON public.study_group_members
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND role = 'member' AND status = 'pending'
    AND EXISTS (SELECT 1 FROM public.study_groups g WHERE g.id = group_id AND g.status = 'published')
  );
DROP POLICY IF EXISTS study_group_members_owner_manage ON public.study_group_members;
CREATE POLICY study_group_members_owner_manage ON public.study_group_members
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.study_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
    OR public.has_permission('manage_study_groups')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.study_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
    OR public.has_permission('manage_study_groups')
  );
DROP POLICY IF EXISTS study_group_members_leave ON public.study_group_members;
CREATE POLICY study_group_members_leave ON public.study_group_members
  FOR DELETE TO authenticated USING (user_id = auth.uid() AND role = 'member');

CREATE TABLE IF NOT EXISTS public.study_group_materials (
  group_id uuid NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, material_id)
);
ALTER TABLE public.study_group_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_group_materials_member_access ON public.study_group_materials;
CREATE POLICY study_group_materials_member_access ON public.study_group_materials
  FOR ALL TO authenticated USING (
    public.is_study_group_owner(group_id) OR public.is_study_group_member(group_id)
  )
  WITH CHECK (
    added_by = auth.uid() AND (public.is_study_group_owner(group_id) OR public.is_study_group_member(group_id))
  );

CREATE TABLE IF NOT EXISTS public.service_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 160),
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Other',
  rate text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  is_remote boolean NOT NULL DEFAULT false,
  contact_method text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'closed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_listings_public_idx ON public.service_listings (category, created_at DESC) WHERE status = 'published';
ALTER TABLE public.service_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_listings_public_or_owner_read ON public.service_listings;
CREATE POLICY service_listings_public_or_owner_read ON public.service_listings
  FOR SELECT TO authenticated USING (status = 'published' OR owner_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS service_listings_public_read ON public.service_listings;
CREATE POLICY service_listings_public_read ON public.service_listings
  FOR SELECT TO anon USING (status = 'published');
DROP POLICY IF EXISTS service_listings_owner_create ON public.service_listings;
CREATE POLICY service_listings_owner_create ON public.service_listings
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS service_listings_owner_edit_pending ON public.service_listings;
CREATE POLICY service_listings_owner_edit_pending ON public.service_listings
  FOR UPDATE TO authenticated USING (owner_id = auth.uid() AND status = 'pending')
  WITH CHECK (owner_id = auth.uid() AND status = 'pending');
DROP POLICY IF EXISTS service_listings_moderator_manage ON public.service_listings;
CREATE POLICY service_listings_moderator_manage ON public.service_listings
  FOR ALL TO authenticated USING (public.has_permission('moderate_services'))
  WITH CHECK (public.has_permission('moderate_services'));
DROP POLICY IF EXISTS service_listings_owner_delete_pending ON public.service_listings;
CREATE POLICY service_listings_owner_delete_pending ON public.service_listings
  FOR DELETE TO authenticated USING (owner_id = auth.uid() AND status = 'pending');

CREATE TABLE IF NOT EXISTS public.platform_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN (
    'event', 'organization', 'job', 'skill_profile', 'service',
    'learning_content', 'lost_found', 'study_group', 'user'
  )),
  target_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('spam', 'harassment', 'fraud', 'inappropriate', 'safety', 'other')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  moderator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (moderator_id IS NULL OR moderator_id <> reporter_id)
);
CREATE INDEX IF NOT EXISTS platform_reports_status_idx ON public.platform_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_reports_target_idx ON public.platform_reports (target_type, target_id);
ALTER TABLE public.platform_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_reports_reporter_read ON public.platform_reports;
CREATE POLICY platform_reports_reporter_read ON public.platform_reports
  FOR SELECT TO authenticated USING (reporter_id = auth.uid() OR public.has_permission('moderate_reports'));
DROP POLICY IF EXISTS platform_reports_reporter_create ON public.platform_reports;
CREATE POLICY platform_reports_reporter_create ON public.platform_reports
  FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid() AND moderator_id IS NULL AND status = 'open');
DROP POLICY IF EXISTS platform_reports_moderate ON public.platform_reports;
CREATE POLICY platform_reports_moderate ON public.platform_reports
  FOR UPDATE TO authenticated USING (public.has_permission('moderate_reports') AND reporter_id <> auth.uid())
  WITH CHECK (public.has_permission('moderate_reports') AND reporter_id <> auth.uid() AND moderator_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.notification_preferences, public.student_course_tracker,
  public.events, public.event_rsvps, public.organizations, public.organization_members,
  public.job_listings, public.skill_profiles, public.lost_found_items,
  public.lost_found_claims, public.study_groups, public.study_group_members,
  public.study_group_materials, public.service_listings, public.platform_reports
TO authenticated;
GRANT SELECT ON public.events, public.organizations, public.job_listings,
  public.skill_profiles, public.lost_found_items, public.service_listings TO anon;

COMMIT;
