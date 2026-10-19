-- =============================================================================
-- Count real views of a marketplace product
-- =============================================================================
--
-- The defect
-- ----------
-- `marketplace_products.view_count` is `NOT NULL DEFAULT 0`, is the second
-- column of the `idx_mp_products_popular` index, and has never been
-- incremented by anything. Measured on this project:
--
--     active products | products with view_count > 0 | max view_count
--     ----------------+-----------------------------+----------------
--                   9 |                           0 |              0
--
-- The call that should have done it was wrong. `fetchProductByIdOrSlug` in
-- `src/marketplace/lib/api.ts` carried the comment
--
--     // Increment view counter in background
--     supabase.rpc('mp_record_search', { p_terms: [data.title] })
--
-- but `mp_record_search` is a *search-history* recorder: it sanitises terms and
-- appends them to `marketplace_profiles.search_history`. It never touched
-- `marketplace_products`, so every product view paid a round-trip that could
-- not change a view count.
--
-- A client-side UPDATE is not available as a substitute, for the same reason
-- as the accommodation counter: `marketplace_products` is row-level-secured and
-- grants UPDATE to the owning vendor and to admins only, so an anonymous
-- visitor's write is rejected by policy. This adds the SECURITY DEFINER
-- equivalent, mirroring `increment_accommodation_view_count`.
--
-- Constraints
-- -----------
-- * Only rows a visitor can actually reach are counted: `status = 'active'` and
--   not soft-deleted. Counting a draft or a trashed listing would inflate the
--   popularity figure that `idx_mp_products_popular` is built to serve.
-- * Atomic (`view_count = view_count + 1`), so concurrent viewers cannot lose a
--   count to a read-modify-write race.
-- * An unknown id resolves to NULL rather than raising; a popularity figure must
--   never be able to break the page render it decorates.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_increment_product_view(p_product_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_view_count INTEGER;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.marketplace_products
     SET view_count = view_count + 1
   WHERE id = p_product_id
     AND status = 'active'
     AND deleted_at IS NULL
  RETURNING view_count INTO v_view_count;

  RETURN v_view_count;
END;
$$;

COMMENT ON FUNCTION public.mp_increment_product_view(UUID) IS
  'Atomically increments view_count for an active, non-deleted marketplace product and returns the new total. Returns NULL for unknown, draft or trashed listings. Callable by anonymous visitors.';

REVOKE ALL ON FUNCTION public.mp_increment_product_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mp_increment_product_view(UUID) TO anon, authenticated;
