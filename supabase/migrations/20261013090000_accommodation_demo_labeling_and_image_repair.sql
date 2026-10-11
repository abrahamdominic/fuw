-- Migration: accommodation demo labeling + dead image repair
--
-- Context / root cause of "broken accommodation images" on the live site:
--   The Netlify CSP (`img-src 'self' data: blob: https://*.supabase.co`) did not
--   allow `https://images.unsplash.com`, which is the host used by every seeded
--   demo listing, by `ACCOMMODATION_TYPE_FALLBACKS`, and by the marketplace
--   seeds. Every remote photo was therefore blocked and collapsed to the branded
--   data-URI placeholder. netlify.toml now allows the Unsplash CDN.
--
-- This migration additionally:
--   1. Introduces `is_demo` so seeded/sample listings are clearly distinguishable
--      from real, provider-submitted properties (never present stock photography
--      as an actual verified property).
--   2. Flags the original seeded sample listings as demos.
--   3. Repairs the one dead demo image URL (photo-1502005229762-ee1b2da97c0d -> 404)
--      and replaces the placeholder OG-image URL used by a test portal listing.
--
-- Idempotent: safe to re-run.

BEGIN;

-- 1. Demo flag -----------------------------------------------------------------
ALTER TABLE public.accommodation_properties
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.accommodation_properties.is_demo IS
  'Sample/demonstration listing seeded for the directory. Must be clearly labelled in the UI and never presented as a verified real property.';

-- 2. Mark the original seeded sample listings as demos -------------------------
UPDATE public.accommodation_properties
   SET is_demo = TRUE
 WHERE slug IN (
   'silver-crest-luxury-student-lodge',
   'unity-executive-hostels-female-wing',
   'scholars-court-affordable-single-rooms',
   'apex-two-bedroom-student-shared-flat',
   'grace-villa-bedspace-enclave'
 );

-- 3a. Repair the dead Apex cover image (404) — swap in a live property photo ----
UPDATE public.accommodation_properties
   SET images = array_replace(
         images,
         'https://images.unsplash.com/photo-1502005229762-ee1b2da97c0d?auto=format&fit=crop&w=800&q=80',
         'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=80'
       ),
       updated_at = now()
 WHERE slug = 'apex-two-bedroom-student-shared-flat'
   AND 'https://images.unsplash.com/photo-1502005229762-ee1b2da97c0d?auto=format&fit=crop&w=800&q=80' = ANY(images);

-- 3b. Replace non-property placeholder (site OG image) on the test portal listing
UPDATE public.accommodation_properties
   SET images = ARRAY[
         'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80',
         'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80'
       ],
       updated_at = now()
 WHERE slug = 'sunrise-lodge-self-contained-rooms'
   AND images <@ ARRAY['https://fuwtest.netlify.app/images/fuw-campushub-og.png']::text[];

-- Backfill: ensure every demo listing carries at least one renderable photo.
-- (photo_slots is left untouched; the trigger keeps photos_complete in sync.)
UPDATE public.accommodation_properties
   SET images = ARRAY[
         'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80'
       ],
       updated_at = now()
 WHERE is_demo = TRUE
   AND (images IS NULL OR cardinality(images) = 0);

COMMIT;
