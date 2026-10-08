-- =============================================================================
-- FUW CAMPUS HUB — SAFE FOUNDATION MIGRATION
-- Migration: 20261008060000_campus_hub_safe_foundations.sql
-- Adds: user_saved_items, user_activity_log, flashcard_decks, flashcards,
--       study_guides, premium feature registrations, and search_campus_global RPC
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. UNIFIED SAVED ITEMS (Additive, non-destructive)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_saved_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL CHECK (item_type IN (
                'material', 'product', 'vendor', 'accommodation',
                'roommate', 'event', 'announcement', 'academic_course'
              )),
  item_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  url         TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_saved_items_entry UNIQUE (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_items_user_created
  ON public.user_saved_items (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_saved_items_user_type
  ON public.user_saved_items (user_id, item_type);

ALTER TABLE public.user_saved_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_saved_items_read_own" ON public.user_saved_items;
CREATE POLICY "user_saved_items_read_own" ON public.user_saved_items
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_saved_items_insert_own" ON public.user_saved_items;
CREATE POLICY "user_saved_items_insert_own" ON public.user_saved_items
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_saved_items_delete_own" ON public.user_saved_items;
CREATE POLICY "user_saved_items_delete_own" ON public.user_saved_items
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.user_saved_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.user_saved_items TO authenticated;


-- -----------------------------------------------------------------------------
-- 2. UNIFIED CAMPUS ACTIVITY LOG (Additive, non-destructive)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
                  'material_viewed', 'material_downloaded', 'material_completed',
                  'marketplace_viewed', 'marketplace_ordered',
                  'accommodation_viewed', 'accommodation_inquired',
                  'study_task_completed', 'flashcard_reviewed',
                  'study_guide_created', 'ai_tutor_session', 'item_saved'
                )),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  entity_title  TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
  ON public.user_activity_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_type_created
  ON public.user_activity_log (user_id, activity_type, created_at DESC);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_activity_log_read_own" ON public.user_activity_log;
CREATE POLICY "user_activity_log_read_own" ON public.user_activity_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_activity_log_insert_own" ON public.user_activity_log;
CREATE POLICY "user_activity_log_insert_own" ON public.user_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_activity_log_delete_own" ON public.user_activity_log;
CREATE POLICY "user_activity_log_delete_own" ON public.user_activity_log
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.user_activity_log FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.user_activity_log TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. FLASHCARDS & STUDY GUIDES (Additive, non-destructive)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flashcard_decks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  course_code TEXT,
  topic       TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  card_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.flashcards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id          UUID NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  front            TEXT NOT NULL,
  back             TEXT NOT NULL,
  hint             TEXT,
  difficulty       TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  repetitions      INTEGER NOT NULL DEFAULT 0,
  interval_days    INTEGER NOT NULL DEFAULT 1,
  ease_factor      NUMERIC NOT NULL DEFAULT 2.5,
  next_review_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reviewed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_guides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  course_code TEXT,
  topic       TEXT,
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  material_id UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user ON public.flashcard_decks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flashcards_deck ON public.flashcards (deck_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_flashcards_review ON public.flashcards (user_id, next_review_at ASC);
CREATE INDEX IF NOT EXISTS idx_study_guides_user ON public.study_guides (user_id, created_at DESC);

ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flashcard_decks_own" ON public.flashcard_decks;
CREATE POLICY "flashcard_decks_own" ON public.flashcard_decks
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "flashcards_own" ON public.flashcards;
CREATE POLICY "flashcards_own" ON public.flashcards
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "study_guides_own" ON public.study_guides;
CREATE POLICY "study_guides_own" ON public.study_guides
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.flashcard_decks FROM PUBLIC, anon;
REVOKE ALL ON public.flashcards FROM PUBLIC, anon;
REVOKE ALL ON public.study_guides FROM PUBLIC, anon;

GRANT ALL ON public.flashcard_decks TO authenticated;
GRANT ALL ON public.flashcards TO authenticated;
GRANT ALL ON public.study_guides TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. REGISTER NEW PREMIUM FEATURE KEYS (Additive)
-- -----------------------------------------------------------------------------
INSERT INTO public.premium_features (feature_key, label, description)
VALUES
  ('ai_flashcards', 'AI Flashcard Generation', 'Instant flashcard deck generation from library materials and lecture notes.'),
  ('ai_study_guides', 'AI Study Guide Generator', 'Comprehensive exam revision guides and key concept summaries.'),
  ('exam_readiness', 'Exam Readiness Score', 'Data-driven readiness percentage and weak area diagnostics.'),
  ('advanced_academic_analytics', 'Advanced Academic Analytics', 'Multi-metric academic progress dashboards and study trend analytics.'),
  ('personalized_recommendations', 'Personalized Recommendations', 'Intelligent course, material, and campus resource recommendations.')
ON CONFLICT (feature_key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 5. SHARED GLOBAL SEARCH RPC FUNCTION
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_campus_global(
  p_query    TEXT,
  p_category TEXT DEFAULT 'all',
  p_limit    INTEGER DEFAULT 20,
  p_offset   INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q     TEXT := trim(COALESCE(p_query, ''));
  v_esc   TEXT;
  v_items JSONB := '[]'::jsonb;
  v_limit INTEGER := LEAST(GREATEST(p_limit, 1), 50);
  v_off   INTEGER := GREATEST(p_offset, 0);
BEGIN
  IF char_length(v_q) < 2 THEN
    RETURN jsonb_build_object('query', v_q, 'total', 0, 'results', '[]'::jsonb);
  END IF;

  v_esc := '%' || replace(replace(replace(v_q, '%', '\%'), '_', '\_'), ' ', '%') || '%';

  WITH raw_results AS (
    -- E-Library Materials
    SELECT
      m.id::text AS id,
      'material' AS category,
      m.title AS title,
      COALESCE(m.course_code || ' · ' || m.department, m.department, 'E-Library Material') AS subtitle,
      '/materials/' || m.id AS url,
      jsonb_build_object(
        'type', m.material_type,
        'course_code', m.course_code,
        'department', m.department,
        'downloads', m.downloads
      ) AS metadata,
      m.created_at AS sort_date
    FROM public.materials m
    WHERE (p_category IN ('all', 'library', 'materials'))
      AND m.status = 'approved'
      AND (m.title ILIKE v_esc OR m.course_code ILIKE v_esc OR m.description ILIKE v_esc)

    UNION ALL

    -- Courses
    SELECT
      c.id::text AS id,
      'course' AS category,
      c.course_code || ' - ' || c.course_title AS title,
      'Course Catalogue · ' || COALESCE(c.semester, 'Semester') AS subtitle,
      '/courses/' || c.course_code AS url,
      jsonb_build_object(
        'code', c.course_code,
        'units', c.credit_units,
        'semester', c.semester
      ) AS metadata,
      now() AS sort_date
    FROM public.courses c
    WHERE (p_category IN ('all', 'courses', 'academic'))
      AND (c.course_code ILIKE v_esc OR c.course_title ILIKE v_esc)

    UNION ALL

    -- Marketplace Products & Services
    SELECT
      p.id::text AS id,
      'marketplace' AS category,
      p.title AS title,
      CASE WHEN p.is_service THEN 'Campus Service' ELSE 'Marketplace Product' END
        || ' · ₦' || trim(to_char(p.price_kobo / 100.0, '999,999,999D00')) AS subtitle,
      '/marketplace/product/' || p.slug AS url,
      jsonb_build_object(
        'price_kobo', p.price_kobo,
        'is_service', p.is_service,
        'thumbnail', p.thumbnail_path
      ) AS metadata,
      p.created_at AS sort_date
    FROM public.marketplace_products p
    WHERE (p_category IN ('all', 'marketplace', 'products'))
      AND p.status = 'active'
      AND p.deleted_at IS NULL
      AND (p.title ILIKE v_esc OR p.description ILIKE v_esc)

    UNION ALL

    -- Accommodations
    SELECT
      a.id::text AS id,
      'accommodation' AS category,
      a.title AS title,
      a.location_area || ' · ₦' || trim(to_char(a.price_annual, '999,999,999')) || '/yr' AS subtitle,
      '/accommodation/' || a.slug AS url,
      jsonb_build_object(
        'location', a.location_area,
        'property_type', a.property_type,
        'price_annual', a.price_annual,
        'is_verified', a.is_verified
      ) AS metadata,
      a.created_at AS sort_date
    FROM public.accommodation_properties a
    WHERE (p_category IN ('all', 'accommodation', 'hostels'))
      AND a.is_published = true
      AND a.availability_status != 'under_maintenance'
      AND (a.title ILIKE v_esc OR a.location_area ILIKE v_esc OR a.description ILIKE v_esc)

    UNION ALL

    -- Roommates
    SELECT
      r.id::text AS id,
      'roommate' AS category,
      'Roommate Wanted: ' || r.preferred_location AS title,
      'Budget: ₦' || trim(to_char(r.budget_max, '999,999')) || ' · ' || r.target_gender || ' Preference' AS subtitle,
      '/accommodation/roommates' AS url,
      jsonb_build_object(
        'gender', r.target_gender,
        'location', r.preferred_location,
        'budget_max', r.budget_max
      ) AS metadata,
      r.created_at AS sort_date
    FROM public.roommate_requests r
    WHERE (p_category IN ('all', 'roommates', 'accommodation'))
      AND r.status = 'active'
      AND (r.preferred_location ILIKE v_esc OR r.description ILIKE v_esc)

    UNION ALL

    -- Campus Events
    SELECT
      e.id::text AS id,
      'event' AS category,
      e.title AS title,
      'Campus Event · ' || e.venue || ' (' || to_char(e.starts_at, 'Mon DD, YYYY') || ')' AS subtitle,
      '/student/events' AS url,
      jsonb_build_object(
        'category', e.category,
        'venue', e.venue,
        'starts_at', e.starts_at
      ) AS metadata,
      e.starts_at AS sort_date
    FROM public.events e
    WHERE (p_category IN ('all', 'events', 'campus'))
      AND e.status = 'published'
      AND (e.title ILIKE v_esc OR e.venue ILIKE v_esc OR e.description ILIKE v_esc)

    UNION ALL

    -- Announcements
    SELECT
      an.id::text AS id,
      'announcement' AS category,
      an.title AS title,
      'University Announcement · ' || to_char(an.published_at, 'Mon DD, YYYY') AS subtitle,
      '/hub' AS url,
      jsonb_build_object(
        'type', an.announcement_type,
        'published_at', an.published_at
      ) AS metadata,
      an.published_at AS sort_date
    FROM public.library_announcements an
    WHERE (p_category IN ('all', 'announcements', 'campus'))
      AND (an.title ILIKE v_esc OR an.body ILIKE v_esc)
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'category', r.category,
      'title', r.title,
      'subtitle', r.subtitle,
      'url', r.url,
      'metadata', r.metadata
    )
  )
  INTO v_items
  FROM (
    SELECT * FROM raw_results
    ORDER BY sort_date DESC
    LIMIT v_limit
    OFFSET v_off
  ) r;

  RETURN jsonb_build_object(
    'query', v_q,
    'category', p_category,
    'limit', v_limit,
    'offset', v_off,
    'results', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_campus_global(TEXT, TEXT, INTEGER, INTEGER) TO authenticated, anon;

COMMIT;
