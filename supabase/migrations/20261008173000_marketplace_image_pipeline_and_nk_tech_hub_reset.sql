-- Migration: 20261008173000_marketplace_image_pipeline_and_nk_tech_hub_reset.sql
-- Fix marketplace product images storage RLS, ensure public access, and cleanly reset NK Tech Hub vendor verification.

-- 1. Storage SELECT policy for marketplace product images
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public can view product images'
  ) THEN
    CREATE POLICY "Public can view product images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'marketplace-product-images');
  END IF;
END $$;

-- 2. Populate any missing URL values on marketplace_product_images
UPDATE public.marketplace_product_images
   SET url = CASE
     WHEN storage_path LIKE 'http%' THEN storage_path
     ELSE 'https://lgxtiilvpnqgzuarzogb.supabase.co/storage/v1/object/public/marketplace-product-images/' || storage_path
   END
 WHERE url IS NULL;

-- 3. Populate any missing thumbnail_path values on marketplace_products
UPDATE public.marketplace_products p
   SET thumbnail_path = (
     SELECT storage_path FROM public.marketplace_product_images i
      WHERE i.product_id = p.id
      ORDER BY i.is_primary DESC, i.sort_order, i.created_at
      LIMIT 1
   )
 WHERE thumbnail_path IS NULL
   AND EXISTS (SELECT 1 FROM public.marketplace_product_images i WHERE i.product_id = p.id);

-- 4. Cleanly reset NK Tech Hub vendor verification so they can re-apply via UI
UPDATE public.marketplace_vendor_verifications
   SET status = 'unverified'::public.marketplace_verification_status
 WHERE vendor_id = '9a47796c-200c-4ec0-9803-b9cdb685a448'
   AND status = 'pending';

UPDATE public.marketplace_vendors
   SET verification = 'unverified'::public.marketplace_verification_status,
       verification_status = 'unverified',
       is_verified = false,
       verified_at = NULL,
       verified_by = NULL
 WHERE id = '9a47796c-200c-4ec0-9803-b9cdb685a448';
