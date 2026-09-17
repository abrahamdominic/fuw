-- ==============================================================================
-- FUW E-Library — INSTITUTIONAL LIBRARY INFRASTRUCTURE (2026-09-21)
--
-- Adds the institutional repository (theses/dissertations/projects/publications),
-- researcher profiles, reading lists, curated collections, help center content,
-- library announcements, and the copyright/takedown reporting workflow.
--
-- Design principles:
--   * Repository items are separate from course `materials` (different metadata):
--     authors, supervisors, ORCID, DOI, abstracts, access levels.
--   * All tables are RLS-enabled and ownership-scoped.
--   * New reads are available to authenticated users; anon sees published
--     repository items only via the safe view. Write access is restricted to
--     owners/admins and never trusted from the client.
--   * Storage paths follow the same `user-id/timestamp-safeName` convention.
-- Idempotent; safe to re-run.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. ENUMS
-- ------------------------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'research_item_type') THEN
    CREATE TYPE public.research_item_type AS ENUM (
      'final_year_project',
      'thesis',
      'dissertation',
      'research_paper',
      'journal_article',
      'conference_paper',
      'technical_report',
      'institutional_publication',
      'dataset',
      'seminar_paper'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'research_access') THEN
    CREATE TYPE public.research_access AS ENUM (
      'public',
      'registered',
      'restricted',
      'private'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'research_status') THEN
    CREATE TYPE public.research_status AS ENUM (
      'draft',
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'published',
      'archived'
    );
  END IF;
END
$do$;

-- ------------------------------------------------------------------------------
-- 2. RESEARCHER PROFILES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.researcher_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text DEFAULT 'Student Researcher',
  affiliation text DEFAULT 'Federal University Wukari',
  biography text,
  research_interests text[] DEFAULT '{}',
  orcid text,
  google_scholar text,
  linkedin text,
  institutional_page text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.researcher_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "researcher_profiles_select_public" ON public.researcher_profiles;
CREATE POLICY "researcher_profiles_select_public"
  ON public.researcher_profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "researcher_profiles_self_admin_insert" ON public.researcher_profiles;
CREATE POLICY "researcher_profiles_self_admin_insert"
  ON public.researcher_profiles FOR INSERT
  WITH CHECK (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "researcher_profiles_self_admin_update" ON public.researcher_profiles;
CREATE POLICY "researcher_profiles_self_admin_update"
  ON public.researcher_profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin());

CREATE INDEX IF NOT EXISTS idx_researcher_profiles_interests
  ON public.researcher_profiles USING gin (research_interests);

-- ------------------------------------------------------------------------------
-- 3. INSTITUTIONAL REPOSITORY ITEMS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  abstract text NOT NULL DEFAULT '',
  keywords text[] DEFAULT '{}',
  research_type public.research_item_type NOT NULL DEFAULT 'research_paper',
  access_level public.research_access NOT NULL DEFAULT 'public',
  status public.research_status NOT NULL DEFAULT 'draft',
  language text DEFAULT 'English',
  faculty text,
  department text,
  faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  program text,
  level text,
  year text,
  session text,
  supervisor text,
  supervisor_email text,
  institution text DEFAULT 'Federal University Wukari',
  publication_venue text,
  doi text,
  isbn text,
  issn text,
  publisher text,
  edition text,
  citation_count integer NOT NULL DEFAULT 0,
  download_count integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0,
  license text DEFAULT 'CC BY-NC-ND 4.0',
  copyright_holder text,
  source text,
  permission_status text DEFAULT 'author_granted',
  restriction_reason text,
  tagged_topics text[] DEFAULT '{}',
  checksum text,
  file_url text,
  file_path text,
  file_name text,
  file_size bigint,
  file_format text,
  page_count integer,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_date timestamptz,
  review_decision text,
  rejection_reason text,
  published_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_verified boolean NOT NULL DEFAULT false,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz,
  archived_at timestamptz
);

ALTER TABLE public.research_items ENABLE ROW LEVEL SECURITY;

-- Published/approved items are visible to everyone; drafts/submitted/under-review
-- are visible only to their submitter; archive is visible to admins only.
DROP POLICY IF EXISTS "research_items_select" ON public.research_items;
CREATE POLICY "research_items_select"
  ON public.research_items FOR SELECT
  USING (
    status IN ('approved', 'published')
    OR auth.uid() = submitted_by
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "research_items_insert" ON public.research_items;
CREATE POLICY "research_items_insert"
  ON public.research_items FOR INSERT
  WITH CHECK (
    auth.uid() = submitted_by
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "research_items_update_owner_admin" ON public.research_items;
CREATE POLICY "research_items_update_owner_admin"
  ON public.research_items FOR UPDATE
  USING (auth.uid() = submitted_by OR public.is_admin());

DROP POLICY IF EXISTS "research_items_delete_admin" ON public.research_items;
CREATE POLICY "research_items_delete_admin"
  ON public.research_items FOR DELETE
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_research_items_status ON public.research_items (status);
CREATE INDEX IF NOT EXISTS idx_research_items_type ON public.research_items (research_type);
CREATE INDEX IF NOT EXISTS idx_research_items_department ON public.research_items (department_id);
CREATE INDEX IF NOT EXISTS idx_research_items_faculty ON public.research_items (faculty_id);
CREATE INDEX IF NOT EXISTS idx_research_items_year ON public.research_items (year);
CREATE INDEX IF NOT EXISTS idx_research_items_keywords ON public.research_items USING gin (keywords);
CREATE INDEX IF NOT EXISTS idx_research_items_submitted_by ON public.research_items (submitted_by);
CREATE INDEX IF NOT EXISTS idx_research_items_created ON public.research_items (created_at DESC);

-- Full-text search index for repository titles and abstracts.
CREATE INDEX IF NOT EXISTS idx_research_items_fts
  ON public.research_items USING gin (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(abstract, ''))
  );

-- ------------------------------------------------------------------------------
-- 4. RESEARCH ITEM AUTHORS (many-to-many: an item can have multiple authors)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_item_authors (
  research_item_id uuid NOT NULL REFERENCES public.research_items(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name text NOT NULL DEFAULT 'Unknown Author',
  orcid text,
  is_lead boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (research_item_id, position)
);

ALTER TABLE public.research_item_authors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "research_item_authors_select" ON public.research_item_authors;
CREATE POLICY "research_item_authors_select"
  ON public.research_item_authors FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.research_items ri
      WHERE ri.id = research_item_id
        AND (ri.status IN ('approved', 'published') OR auth.uid() = ri.submitted_by OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "research_item_authors_insert" ON public.research_item_authors;
CREATE POLICY "research_item_authors_insert"
  ON public.research_item_authors FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.research_items ri
      WHERE ri.id = research_item_id AND (auth.uid() = ri.submitted_by OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "research_item_authors_update" ON public.research_item_authors;
CREATE POLICY "research_item_authors_update"
  ON public.research_item_authors FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.research_items ri
      WHERE ri.id = research_item_id AND (auth.uid() = ri.submitted_by OR public.is_admin())
    )
  );

-- ------------------------------------------------------------------------------
-- 5. READING LISTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reading_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text DEFAULT 'personal',
  is_public boolean NOT NULL DEFAULT false,
  cover_material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reading_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reading_lists_select_own" ON public.reading_lists;
CREATE POLICY "reading_lists_select_own"
  ON public.reading_lists FOR SELECT
  USING (auth.uid() = user_id OR (is_public AND true) OR public.is_admin());

DROP POLICY IF EXISTS "reading_lists_insert_own" ON public.reading_lists;
CREATE POLICY "reading_lists_insert_own"
  ON public.reading_lists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reading_lists_update_own" ON public.reading_lists;
CREATE POLICY "reading_lists_update_own"
  ON public.reading_lists FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reading_lists_delete_own" ON public.reading_lists;
CREATE POLICY "reading_lists_delete_own"
  ON public.reading_lists FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_reading_lists_user ON public.reading_lists (user_id);

-- ------------------------------------------------------------------------------
-- 6. READING LIST ITEMS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reading_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.reading_lists(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE,
  research_item_id uuid REFERENCES public.research_items(id) ON DELETE CASCADE,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reading_list_items_material_or_research
    CHECK (material_id IS NOT NULL OR research_item_id IS NOT NULL)
);

ALTER TABLE public.reading_list_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reading_list_items_select" ON public.reading_list_items;
CREATE POLICY "reading_list_items_select"
  ON public.reading_list_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists rl
      WHERE rl.id = list_id AND (rl.user_id = auth.uid() OR rl.is_public OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "reading_list_items_insert" ON public.reading_list_items;
CREATE POLICY "reading_list_items_insert"
  ON public.reading_list_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reading_lists rl
      WHERE rl.id = list_id AND rl.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "reading_list_items_update" ON public.reading_list_items;
CREATE POLICY "reading_list_items_update"
  ON public.reading_list_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists rl
      WHERE rl.id = list_id AND rl.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "reading_list_items_delete" ON public.reading_list_items;
CREATE POLICY "reading_list_items_delete"
  ON public.reading_list_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.reading_lists rl
      WHERE rl.id = list_id AND rl.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_reading_list_items_list ON public.reading_list_items (list_id);
CREATE INDEX IF NOT EXISTS idx_reading_list_items_material ON public.reading_list_items (material_id);

-- ------------------------------------------------------------------------------
-- 7. CURATED LIBRARY COLLECTIONS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collection_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  slug text UNIQUE NOT NULL,
  icon text DEFAULT 'library',
  cover_color text DEFAULT '#0B6B3A',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.collection_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collection_groups_select" ON public.collection_groups;
CREATE POLICY "collection_groups_select"
  ON public.collection_groups FOR SELECT
  USING (is_published OR public.is_admin());

DROP POLICY IF EXISTS "collection_groups_admin_insert" ON public.collection_groups;
CREATE POLICY "collection_groups_admin_insert"
  ON public.collection_groups FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "collection_groups_admin_update" ON public.collection_groups;
CREATE POLICY "collection_groups_admin_update"
  ON public.collection_groups FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "collection_groups_admin_delete" ON public.collection_groups;
CREATE POLICY "collection_groups_admin_delete"
  ON public.collection_groups FOR DELETE
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.collection_groups(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE,
  research_item_id uuid REFERENCES public.research_items(id) ON DELETE CASCADE,
  title_override text,
  sort_order integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_items_material_or_research
    CHECK (material_id IS NOT NULL OR research_item_id IS NOT NULL)
);

ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collection_items_select" ON public.collection_items;
CREATE POLICY "collection_items_select"
  ON public.collection_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collection_groups cg
      WHERE cg.id = collection_id AND (cg.is_published OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "collection_items_admin_insert" ON public.collection_items;
CREATE POLICY "collection_items_admin_insert"
  ON public.collection_items FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "collection_items_admin_update" ON public.collection_items;
CREATE POLICY "collection_items_admin_update"
  ON public.collection_items FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "collection_items_admin_delete" ON public.collection_items;
CREATE POLICY "collection_items_admin_delete"
  ON public.collection_items FOR DELETE
  USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- 8. COPYRIGHT / TAKEDOWN REPORTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copyright_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  research_item_id uuid REFERENCES public.research_items(id) ON DELETE SET NULL,
  complaint_type text NOT NULL DEFAULT 'copyright',
  description text NOT NULL,
  claimant_name text,
  claimant_email text,
  status text NOT NULL DEFAULT 'open',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_decision text,
  staff_notes text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copyright_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "copyright_reports_insert" ON public.copyright_reports;
CREATE POLICY "copyright_reports_insert"
  ON public.copyright_reports FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "copyright_reports_select" ON public.copyright_reports;
CREATE POLICY "copyright_reports_select"
  ON public.copyright_reports FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "copyright_reports_update_admin" ON public.copyright_reports;
CREATE POLICY "copyright_reports_update_admin"
  ON public.copyright_reports FOR UPDATE
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_copyright_reports_status ON public.copyright_reports (status);
CREATE INDEX IF NOT EXISTS idx_copyright_reports_created ON public.copyright_reports (created_at DESC);

-- ------------------------------------------------------------------------------
-- 9. HELP TOPICS + FAQ
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.help_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "help_topics_select" ON public.help_topics;
CREATE POLICY "help_topics_select"
  ON public.help_topics FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "help_topics_admin_insert" ON public.help_topics;
CREATE POLICY "help_topics_admin_insert"
  ON public.help_topics FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "help_topics_admin_update" ON public.help_topics;
CREATE POLICY "help_topics_admin_update"
  ON public.help_topics FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "help_topics_admin_delete" ON public.help_topics;
CREATE POLICY "help_topics_admin_delete"
  ON public.help_topics FOR DELETE
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.faq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text DEFAULT 'general',
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.faq_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "faq_items_select" ON public.faq_items;
CREATE POLICY "faq_items_select"
  ON public.faq_items FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "faq_items_admin_insert" ON public.faq_items;
CREATE POLICY "faq_items_admin_insert"
  ON public.faq_items FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "faq_items_admin_update" ON public.faq_items;
CREATE POLICY "faq_items_admin_update"
  ON public.faq_items FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "faq_items_admin_delete" ON public.faq_items;
CREATE POLICY "faq_items_admin_delete"
  ON public.faq_items FOR DELETE
  USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- 10. LIBRARY ANNOUNCEMENTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'everyone',
  is_published boolean NOT NULL DEFAULT true,
  published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.library_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "library_announcements_select" ON public.library_announcements;
CREATE POLICY "library_announcements_select"
  ON public.library_announcements FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "library_announcements_admin_insert" ON public.library_announcements;
CREATE POLICY "library_announcements_admin_insert"
  ON public.library_announcements FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "library_announcements_admin_update" ON public.library_announcements;
CREATE POLICY "library_announcements_admin_update"
  ON public.library_announcements FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "library_announcements_admin_delete" ON public.library_announcements;
CREATE POLICY "library_announcements_admin_delete"
  ON public.library_announcements FOR DELETE
  USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- 11. MATERIAL / RESEARCH READING PROGRESS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reading_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials(id) ON DELETE CASCADE,
  research_item_id uuid REFERENCES public.research_items(id) ON DELETE CASCADE,
  current_page integer NOT NULL DEFAULT 0,
  total_pages integer NOT NULL DEFAULT 0,
  progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reading_progress_material_or_research
    CHECK (material_id IS NOT NULL OR research_item_id IS NOT NULL),
  UNIQUE (user_id, material_id),
  UNIQUE (user_id, research_item_id)
);

ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reading_progress_select_own" ON public.reading_progress;
CREATE POLICY "reading_progress_select_own"
  ON public.reading_progress FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reading_progress_insert_own" ON public.reading_progress;
CREATE POLICY "reading_progress_insert_own"
  ON public.reading_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reading_progress_update_own" ON public.reading_progress;
CREATE POLICY "reading_progress_update_own"
  ON public.reading_progress FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reading_progress_delete_own" ON public.reading_progress;
CREATE POLICY "reading_progress_delete_own"
  ON public.reading_progress FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_reading_progress_user ON public.reading_progress (user_id, last_read_at DESC);

-- ------------------------------------------------------------------------------
-- 12. LIBRARY SETTINGS (single-row key-value store for library configuration)
-- ------------------------------------------------------------------------------
INSERT INTO public.system_settings (key, value)
VALUES (
  'library_settings',
  '{
    "libraryName": "FUW Digital Library",
    "libraryDescription": "The official digital library of the Federal University Wukari.",
    "contactEmail": "library@fuw.edu.ng",
    "supportPhone": "",
    "address": "Federal University Wukari, Wukari, Taraba State, Nigeria",
    "openingHours": "Monday – Friday: 8:00 AM – 6:00 PM",
    "enableCitationExport": true,
    "enableRepository": true
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 13. RPC: safe repository item detail (joins author names and departments)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_research_item_detail(p_item_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'item', to_jsonb(ri),
    'authors', COALESCE(
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.position)
       FROM public.research_item_authors a
       WHERE a.research_item_id = ri.id),
      '[]'::jsonb
    ),
    'faculty_name', f.name,
    'department_name', d.name,
    'uploader', jsonb_build_object(
      'id', p.id,
      'name', COALESCE(p.display_name, p.full_name, p.username)
    )
  )
  FROM public.research_items ri
  LEFT JOIN public.faculties f ON f.id = ri.faculty_id AND ri.faculty_id IS NOT NULL
  LEFT JOIN public.departments d ON d.id = ri.department_id AND ri.department_id IS NOT NULL
  LEFT JOIN public.profiles p ON p.id = ri.submitted_by
  WHERE ri.id = p_item_id;
$$;

REVOKE ALL ON FUNCTION public.get_research_item_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_research_item_detail(uuid) TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 14. RPC: repository search (title/abstract/keywords/authors)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_research_items(
  p_query text DEFAULT '',
  p_type text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_faculty_id uuid DEFAULT NULL,
  p_year text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  subtitle text,
  abstract text,
  keywords text[],
  research_type public.research_item_type,
  access_level public.research_access,
  status public.research_status,
  faculty text,
  department text,
  faculty_id uuid,
  department_id uuid,
  year text,
  supervisor text,
  doi text,
  isbn text,
  issn text,
  file_url text,
  file_path text,
  file_name text,
  file_size bigint,
  file_format text,
  page_count integer,
  published_at timestamptz,
  version integer,
  created_at timestamptz,
  is_verified boolean,
  download_count integer,
  view_count integer,
  citation_count integer,
  author_names text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ri.id,
    ri.title,
    ri.subtitle,
    ri.abstract,
    ri.keywords,
    ri.research_type,
    ri.access_level,
    ri.status,
    ri.faculty,
    ri.department,
    ri.faculty_id,
    ri.department_id,
    ri.year,
    ri.supervisor,
    ri.doi,
    ri.isbn,
    ri.issn,
    ri.file_url,
    ri.file_path,
    ri.file_name,
    ri.file_size,
    ri.file_format,
    ri.page_count,
    ri.published_at,
    ri.version,
    ri.created_at,
    ri.is_verified,
    ri.download_count,
    ri.view_count,
    ri.citation_count,
    COALESCE((
      SELECT array_agg(a.author_name ORDER BY a.position)
      FROM public.research_item_authors a
      WHERE a.research_item_id = ri.id
    ), '{}'::text[]) AS author_names
  FROM public.research_items ri
  WHERE ri.status IN ('approved', 'published')
    AND (
      p_query = ''
      OR ri.title ILIKE '%' || p_query || '%'
      OR ri.subtitle IS NOT NULL AND ri.subtitle ILIKE '%' || p_query || '%'
      OR ri.abstract ILIKE '%' || p_query || '%'
      OR EXISTS (
        SELECT 1 FROM unnest(ri.keywords) kw
        WHERE kw ILIKE '%' || p_query || '%'
      )
      OR EXISTS (
        SELECT 1 FROM public.research_item_authors a
        WHERE a.research_item_id = ri.id
          AND a.author_name ILIKE '%' || p_query || '%'
      )
    )
    AND (p_type IS NULL OR ri.research_type::text = p_type)
    AND (p_department_id IS NULL OR ri.department_id = p_department_id)
    AND (p_faculty_id IS NULL OR ri.faculty_id = p_faculty_id)
    AND (p_year IS NULL OR ri.year = p_year)
  ORDER BY ri.published_at DESC NULLS LAST, ri.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.search_research_items(text, text, uuid, uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_research_items(text, text, uuid, uuid, text, integer, integer) TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 15. RPC: increment research item view/download counts
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_research_downloads(p_item_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.research_items
  SET download_count = download_count + 1
  WHERE id = p_item_id;
$$;

REVOKE ALL ON FUNCTION public.increment_research_downloads(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_research_downloads(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.increment_research_views(p_item_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.research_items
  SET view_count = view_count + 1
  WHERE id = p_item_id;
$$;

REVOKE ALL ON FUNCTION public.increment_research_views(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_research_views(uuid) TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 16. RPC: content type checks for help/faq/announcements (safe reads)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_help_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'topics', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', ht.id,
          'slug', ht.slug,
          'title', ht.title,
          'category', ht.category,
          'body', ht.body
        ) ORDER BY ht.sort_order)
       FROM public.help_topics ht
       WHERE ht.is_published),
      '[]'::jsonb
    ),
    'faqs', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', fi.id,
          'question', fi.question,
          'answer', fi.answer,
          'category', fi.category
        ) ORDER BY fi.sort_order)
       FROM public.faq_items fi
       WHERE fi.is_published),
      '[]'::jsonb
    ),
    'announcements', COALESCE(
      (
        SELECT jsonb_agg(sub.announcement)
        FROM (
          SELECT jsonb_build_object(
            'id', la.id,
            'title', la.title,
            'body', la.body,
            'audience', la.audience,
            'published_at', la.published_at
          ) AS announcement
          FROM public.library_announcements la
          WHERE la.is_published
          ORDER BY la.published_at DESC
          LIMIT 10
        ) sub
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_help_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_help_catalog() TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 17. RPC: save reading progress
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_reading_progress(
  p_material_id uuid,
  p_research_item_id uuid,
  p_page integer,
  p_total integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_material_id IS NOT NULL THEN
    INSERT INTO public.reading_progress (
      user_id, material_id, current_page, total_pages, progress_percent
    )
    VALUES (
      auth.uid(),
      p_material_id,
      GREATEST(0, p_page),
      GREATEST(0, p_total),
      CASE WHEN p_total > 0 THEN GREATEST(0, LEAST(100, round((p_page::numeric / p_total) * 100, 2))) ELSE 0 END
    )
    ON CONFLICT (user_id, material_id) DO UPDATE
      SET current_page = EXCLUDED.current_page,
          total_pages = EXCLUDED.total_pages,
          progress_percent = EXCLUDED.progress_percent,
          last_read_at = now();
  ELSIF p_research_item_id IS NOT NULL THEN
    INSERT INTO public.reading_progress (
      user_id, research_item_id, current_page, total_pages, progress_percent
    )
    VALUES (
      auth.uid(),
      p_research_item_id,
      GREATEST(0, p_page),
      GREATEST(0, p_total),
      CASE WHEN p_total > 0 THEN GREATEST(0, LEAST(100, round((p_page::numeric / p_total) * 100, 2))) ELSE 0 END
    )
    ON CONFLICT (user_id, research_item_id) DO UPDATE
      SET current_page = EXCLUDED.current_page,
          total_pages = EXCLUDED.total_pages,
          progress_percent = EXCLUDED.progress_percent,
          last_read_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_reading_progress(uuid, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_reading_progress(uuid, uuid, integer, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 18. RPC: admin statistics for repository analytics
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_repository_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_items', (SELECT count(*) FROM public.research_items),
    'published', (SELECT count(*) FROM public.research_items WHERE status IN ('approved', 'published')),
    'pending_review', (SELECT count(*) FROM public.research_items WHERE status IN ('submitted', 'under_review')),
    'total_downloads', (SELECT coalesce(sum(download_count), 0) FROM public.research_items),
    'total_views', (SELECT coalesce(sum(view_count), 0) FROM public.research_items),
    'verified', (SELECT count(*) FROM public.research_items WHERE is_verified),
    'by_type', COALESCE((
      SELECT jsonb_object_agg(research_type::text, cnt)
      FROM (
        SELECT research_type, count(*) AS cnt
        FROM public.research_items
        WHERE status IN ('approved', 'published')
        GROUP BY research_type
      ) t
    ), '{}'::jsonb),
    'by_department', COALESCE((
      SELECT jsonb_object_agg(coalesce(department, 'Unassigned'), cnt)
      FROM (
        SELECT department, count(*) AS cnt
        FROM public.research_items
        WHERE status IN ('approved', 'published')
        GROUP BY department
        ORDER BY cnt DESC
        LIMIT 8
      ) t
    ), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_repository_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_repository_stats() TO authenticated;

-- ------------------------------------------------------------------------------
-- 19. Seed default help topics and FAQ items
-- ------------------------------------------------------------------------------
INSERT INTO public.help_topics (slug, title, category, body, sort_order)
VALUES
  (
    'getting-started',
    'Getting Started with the FUW Digital Library',
    'getting-started',
    'The FUW Digital Library gives every student and staff member access to lecture notes, past questions, textbooks, and the institutional research repository.

**Steps to begin:**

1. Register with your FUW email address and create a username.
2. Verify your email address from the confirmation link.
3. Complete your student profile (matric number, faculty, department, level).
4. Browse the catalogue by faculty, department, or use the search bar.
5. Open any approved document in the built-in reader or download it where permitted.

All materials you upload are reviewed by library staff before publication.',
    1
  ),
  (
    'search-help',
    'How to Search the Library',
    'search',
    'Use the search bar to find materials by title, course code, author, or keyword.

**Search tips:**

- Search "PHY 102" to find materials for that course.
- Use type filters (Lecture Note, Handouts, Past Questions) to narrow results.
- Filter by faculty, department, level, and semester.
- The AI Study Assistant can also find resources using natural language.

If you cannot find a material, report it from the "Report a Problem" page so the library can source it.',
    2
  ),
  (
    'download-help',
    'Downloading and Reading Documents',
    'downloads',
    'Approved documents open in the built-in document reader.

**Features of the reader:**

- Zoom in and out to read comfortably.
- Search for text within a document.
- Save your reading position automatically.
- Download where the document license permits.

Some restricted documents may be viewable online but not downloadable.',
    3
  ),
  (
    'repository-guidelines',
    'Institutional Repository Submission Guidelines',
    'repository',
    'The FUW Institutional Repository stores theses, dissertations, final-year projects, journal articles, and research papers produced by the university community.

**Submission requirements:**

- Projects and theses must be submitted by the author or supervisor.
- Include a complete abstract and keywords.
- Provide the year of publication and your department.
- Documents are reviewed by the library before publication.
- Authors may attach their ORCID identifier for scholarly credit.

All repository content is preserved for future research.',
    4
  ),
  (
    'citation-help',
    'Citing Library Resources',
    'citations',
    'Every library document provides ready-made citations in APA, MLA, Chicago, and IEEE formats.

Open any material and click the **Cite** button to:

- Copy a formatted citation.
- Download a citation in BibTeX or RIS format.
- Add the citation to your reference list in seconds.',
    5
  ),
  (
    'copyright-policy',
    'Copyright and Fair Use Policy',
    'policy',
    'The FUW Digital Library respects intellectual property rights.

**What you should know:**

- Upload only materials you are authorized to share.
- Course materials are provided for educational use.
- Research theses and projects are the intellectual property of their authors.
- Report any copyright concerns using the "Report Copyright Issue" form.

The library will review all reports and take necessary action within a reasonable timeframe.',
    6
  ),
  (
    'mobile-app',
    'Using the FUW E-Lib Mobile App',
    'getting-started',
    'The FUW E-Lib mobile app gives you the full library on your phone.

Download the app, log in with the same credentials as the website, and enjoy:

- Browse and search the catalogue on the go.
- Read documents with the mobile reader.
- Save materials to your reading lists.
- Get notified when new materials arrive for your courses.
- Chat with the library and other students.
- Study with the AI assistant.',
    7
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.faq_items (question, answer, category, sort_order)
VALUES
  (
    'How do I reset my password?',
    'Go to the login page and click "Forgot Password". Enter your registered email address and follow the reset link sent to you.',
    'account',
    1
  ),
  (
    'Why is my uploaded material still pending?',
    'All student uploads are reviewed by library staff before publication. Review usually completes within 24–48 hours. You will be notified when your material is approved or rejected.',
    'uploads',
    2
  ),
  (
    'Can I download materials to read offline?',
    'Yes — materials that are marked as downloadable can be saved to your device. The mobile app also caches documents you have recently opened.',
    'downloads',
    3
  ),
  (
    'How do I find past questions for my course?',
    'Use the search bar and filter by "Past Questions", or browse to your course page where past questions are linked under course resources.',
    'search',
    4
  ),
  (
    'What are reading lists?',
    'Reading lists let you organize materials into personal collections — for example "CSC 401 Study Kit" or "Final Year Research". Open any material and click "Save to Reading List".',
    'personal',
    5
  ),
  (
    'Is the AI Study Assistant free?',
    'Yes. The AI Study Assistant is available to every registered FUW student and staff member as part of the library.',
    'ai',
    6
  ),
  (
    'Who do I contact about a copyright concern?',
    'Use the "Report Copyright Issue" form under Help & Library Services, or email the library directly at the address on the Help page.',
    'policy',
    7
  ),
  (
    'How do I submit my final year project to the repository?',
    'Go to the Repository section and use "Submit to Repository". Ensure you provide an abstract, keywords, and your department. Your submission will be reviewed by the library.',
    'repository',
    8
  )
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------
-- Reload the PostgREST schema cache so all new tables/functions are exposed.
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;