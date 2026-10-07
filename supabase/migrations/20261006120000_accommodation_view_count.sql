-- =============================================================================
-- Count real reads of a published accommodation listing
-- =============================================================================
--
-- The defect
-- ----------
-- `accommodation_properties.view_count` is declared
-- `INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0)`, is mapped into the
-- `AccommodationProperty` interface in `src/lib/accommodation.ts`, and is read
-- by nothing. No code path ever incremented it, so it stayed at 0 on every row
-- forever. The column was a claim the schema made about the product that no
-- code was keeping.
--
-- Why it was never wired up
-- -------------------------
-- The obvious client implementation does not work here. `accommodation_properties`
-- is row-level-secured, and the only UPDATE policies on it are scoped to the
-- owning provider and to platform admins. An anonymous visitor reading a
-- listing has no update privilege, so a client-side `supabase.from(...).update()`
-- is rejected by policy. That leaves a SECURITY DEFINER function, which is what
-- this migration adds -- the same shape as the existing
-- `increment_view_count(material_id uuid)` used by the institutional library.
--
-- Constraints
-- -----------
-- * Only published rows count. `accommodation_properties` gates visibility with
--   the `is_published BOOLEAN` flag (there is no `status` column), so an admin
--   previewing an unpublished listing must not inflate the public popularity
--   figure that providers and students read.
-- * The increment is atomic (`view_count = view_count + 1`) inside the function,
--   so concurrent viewers cannot lose a count to a read-modify-write race.
-- * A bad or missing id resolves to NULL instead of raising, because a view
--   counter must never be able to break the page render it is decorating.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_accommodation_view_count(p_property_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_view_count INTEGER;
BEGIN
  IF p_property_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.accommodation_properties
     SET view_count = view_count + 1
   WHERE id = p_property_id
     AND is_published = true
  RETURNING view_count INTO v_view_count;

  RETURN v_view_count;
END;
$$;

COMMENT ON FUNCTION public.increment_accommodation_view_count(UUID) IS
  'Atomically increments view_count for a published accommodation property and returns the new total. Returns NULL for unknown, draft or archived listings. Callable by anonymous visitors.';

REVOKE ALL ON FUNCTION public.increment_accommodation_view_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_accommodation_view_count(UUID) TO anon, authenticated;
