-- Migration: marketplace demo image topic corrections
--
-- The demo inventory seeded by 20261013091000 (and a few rows from the earlier
-- 20261009010000 seed) reused photo ids whose subject did not match the listing
-- (for example a house on a food item, a clothing-store photo on grilled fish,
-- a cosmetics shot on a scientific calculator, a smartphone on a textbook).
--
-- This migration repoints only those clearly cross-category images at
-- topic-appropriate, HTTP-200-verified Unsplash photos. Each replacement was
-- confirmed by the photo's Unsplash description and by a live CDN request.
--
-- Idempotent: it re-derives the target set every run, deletes the stale image
-- row for each target product, sets the product thumbnail and inserts a single
-- primary image row. Safe to re-run.
--
-- Scope: only the platform demo vendor (`fuw-student-services`). Real seller
-- listings and the accommodation image pipeline are untouched.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Repoint product thumbnails
-- ---------------------------------------------------------------------------
WITH fix(slug, image) AS (
  VALUES
    -- houses / wrong-category photos -> food & breakfast
    ('bread-tea-breakfast',              'https://images.unsplash.com/photo-1553595854-34a134b890c8?w=600&auto=format&fit=crop&q=80'),
    ('indomie-egg-sauce',                'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=600&auto=format&fit=crop&q=80'),
    ('grilled-fish-chips',               'https://images.unsplash.com/photo-1697748836791-9ddf7e616ece?w=600&auto=format&fit=crop&q=80'),
    ('grilled-chicken-quarter',          'https://images.unsplash.com/photo-1606728035253-49e8a23146de?w=600&auto=format&fit=crop&q=80'),
    ('ofada-rice-ayamase',               'https://images.unsplash.com/photo-1593787615108-0f266e864866?w=600&auto=format&fit=crop&q=80'),
    -- smartphone / cosmetics -> books, fashion, calculator, services
    ('engineering-mathematics-textbook', 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=600&auto=format&fit=crop&q=80'),
    ('slim-fit-denim-jeans',             'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&auto=format&fit=crop&q=80'),
    ('scientific-calculator-fx991',      'https://images.unsplash.com/photo-1574607383077-47ddc2dc51c4?w=600&auto=format&fit=crop&q=80'),
    ('project-typing-formatting',        'https://images.unsplash.com/photo-1729714055320-4d1c5d5e213d?w=600&auto=format&fit=crop&q=80'),
    ('campus-move-haulage',              'https://images.unsplash.com/photo-1714647211902-bb711d643a17?w=600&auto=format&fit=crop&q=80'),
    ('event-ushering-service',           'https://images.unsplash.com/photo-1775113586139-b583cc93517f?w=600&auto=format&fit=crop&q=80'),
    ('logo-brand-design',                'https://images.unsplash.com/photo-1748326650737-33500fdfda30?w=600&auto=format&fit=crop&q=80'),
    ('phy101-private-tutorial',          'https://images.unsplash.com/photo-1758685848612-dc8d3c0e9646?w=600&auto=format&fit=crop&q=80'),
    ('flyer-poster-design',              'https://images.unsplash.com/photo-1767652723573-161f1c223d63?w=600&auto=format&fit=crop&q=80')
)
UPDATE public.marketplace_products p
   SET thumbnail_path = f.image,
       updated_at     = now()
  FROM fix f
 WHERE p.slug = f.slug
   AND p.vendor_id = (SELECT id FROM public.marketplace_vendors
                       WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1);

-- ---------------------------------------------------------------------------
-- 2. Drop the stale image rows for the corrected products
-- ---------------------------------------------------------------------------
WITH fix(slug, image) AS (
  VALUES
    ('bread-tea-breakfast',              'https://images.unsplash.com/photo-1553595854-34a134b890c8?w=600&auto=format&fit=crop&q=80'),
    ('indomie-egg-sauce',                'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=600&auto=format&fit=crop&q=80'),
    ('grilled-fish-chips',               'https://images.unsplash.com/photo-1697748836791-9ddf7e616ece?w=600&auto=format&fit=crop&q=80'),
    ('grilled-chicken-quarter',          'https://images.unsplash.com/photo-1606728035253-49e8a23146de?w=600&auto=format&fit=crop&q=80'),
    ('ofada-rice-ayamase',               'https://images.unsplash.com/photo-1593787615108-0f266e864866?w=600&auto=format&fit=crop&q=80'),
    ('engineering-mathematics-textbook', 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=600&auto=format&fit=crop&q=80'),
    ('slim-fit-denim-jeans',             'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&auto=format&fit=crop&q=80'),
    ('scientific-calculator-fx991',      'https://images.unsplash.com/photo-1574607383077-47ddc2dc51c4?w=600&auto=format&fit=crop&q=80'),
    ('project-typing-formatting',        'https://images.unsplash.com/photo-1729714055320-4d1c5d5e213d?w=600&auto=format&fit=crop&q=80'),
    ('campus-move-haulage',              'https://images.unsplash.com/photo-1714647211902-bb711d643a17?w=600&auto=format&fit=crop&q=80'),
    ('event-ushering-service',           'https://images.unsplash.com/photo-1775113586139-b583cc93517f?w=600&auto=format&fit=crop&q=80'),
    ('logo-brand-design',                'https://images.unsplash.com/photo-1748326650737-33500fdfda30?w=600&auto=format&fit=crop&q=80'),
    ('phy101-private-tutorial',          'https://images.unsplash.com/photo-1758685848612-dc8d3c0e9646?w=600&auto=format&fit=crop&q=80'),
    ('flyer-poster-design',              'https://images.unsplash.com/photo-1767652723573-161f1c223d63?w=600&auto=format&fit=crop&q=80')
)
DELETE FROM public.marketplace_product_images img
USING public.marketplace_products p, fix f
WHERE img.product_id = p.id
  AND p.slug = f.slug
  AND p.vendor_id = (SELECT id FROM public.marketplace_vendors
                      WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1);

-- ---------------------------------------------------------------------------
-- 3. Insert the corrected image rows (one primary image per product)
-- ---------------------------------------------------------------------------
WITH fix(slug, image) AS (
  VALUES
    ('bread-tea-breakfast',              'https://images.unsplash.com/photo-1553595854-34a134b890c8?w=600&auto=format&fit=crop&q=80'),
    ('indomie-egg-sauce',                'https://images.unsplash.com/photo-1612927601601-6638404737ce?w=600&auto=format&fit=crop&q=80'),
    ('grilled-fish-chips',               'https://images.unsplash.com/photo-1697748836791-9ddf7e616ece?w=600&auto=format&fit=crop&q=80'),
    ('grilled-chicken-quarter',          'https://images.unsplash.com/photo-1606728035253-49e8a23146de?w=600&auto=format&fit=crop&q=80'),
    ('ofada-rice-ayamase',               'https://images.unsplash.com/photo-1593787615108-0f266e864866?w=600&auto=format&fit=crop&q=80'),
    ('engineering-mathematics-textbook', 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=600&auto=format&fit=crop&q=80'),
    ('slim-fit-denim-jeans',             'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&auto=format&fit=crop&q=80'),
    ('scientific-calculator-fx991',      'https://images.unsplash.com/photo-1574607383077-47ddc2dc51c4?w=600&auto=format&fit=crop&q=80'),
    ('project-typing-formatting',        'https://images.unsplash.com/photo-1729714055320-4d1c5d5e213d?w=600&auto=format&fit=crop&q=80'),
    ('campus-move-haulage',              'https://images.unsplash.com/photo-1714647211902-bb711d643a17?w=600&auto=format&fit=crop&q=80'),
    ('event-ushering-service',           'https://images.unsplash.com/photo-1775113586139-b583cc93517f?w=600&auto=format&fit=crop&q=80'),
    ('logo-brand-design',                'https://images.unsplash.com/photo-1748326650737-33500fdfda30?w=600&auto=format&fit=crop&q=80'),
    ('phy101-private-tutorial',          'https://images.unsplash.com/photo-1758685848612-dc8d3c0e9646?w=600&auto=format&fit=crop&q=80'),
    ('flyer-poster-design',              'https://images.unsplash.com/photo-1767652723573-161f1c223d63?w=600&auto=format&fit=crop&q=80')
)
INSERT INTO public.marketplace_product_images (
  product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
)
SELECT p.id, f.image, f.image, 'image/jpeg', true, 0, p.title
FROM fix f
JOIN public.marketplace_products p
  ON p.slug = f.slug
 AND p.vendor_id = (SELECT id FROM public.marketplace_vendors
                     WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1);

COMMIT;
