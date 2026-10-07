-- =============================================================================
-- Migration: 20261004180000_marketplace_compatibility_columns.sql
-- Description: Compatibility aliases & trigger-synchronized columns for frontend
-- =============================================================================

-- 1. marketplace_vendors compatibility columns
ALTER TABLE public.marketplace_vendors
  ADD COLUMN IF NOT EXISTS store_name TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS completed_orders_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2. marketplace_products compatibility column
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS quantity_available INTEGER DEFAULT 0;

-- 3. marketplace_product_images compatibility column
ALTER TABLE public.marketplace_product_images
  ADD COLUMN IF NOT EXISTS url TEXT;

-- 4. Sync function and trigger for marketplace_vendors
CREATE OR REPLACE FUNCTION public.mp_sync_vendor_compatibility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.shop_name IS NOT NULL THEN
    NEW.store_name := NEW.shop_name;
  ELSIF NEW.store_name IS NOT NULL THEN
    NEW.shop_name := NEW.store_name;
  END IF;

  IF NEW.handle IS NOT NULL THEN
    NEW.slug := NEW.handle;
  ELSIF NEW.slug IS NOT NULL THEN
    NEW.handle := NEW.slug;
  END IF;

  NEW.logo_url := COALESCE(NEW.logo_url, NEW.logo_path);
  NEW.logo_path := COALESCE(NEW.logo_path, NEW.logo_url);
  NEW.banner_url := COALESCE(NEW.banner_url, NEW.banner_path);
  NEW.banner_path := COALESCE(NEW.banner_path, NEW.banner_url);
  NEW.is_verified := (NEW.verification = 'verified');
  NEW.verification_status := NEW.verification::text;
  NEW.completed_orders_count := NEW.completed_orders;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mp_vendor_sync ON public.marketplace_vendors;
CREATE TRIGGER trg_mp_vendor_sync
  BEFORE INSERT OR UPDATE ON public.marketplace_vendors
  FOR EACH ROW
  EXECUTE FUNCTION public.mp_sync_vendor_compatibility();

-- Backfill vendors
UPDATE public.marketplace_vendors
SET
  store_name = shop_name,
  slug = handle,
  logo_url = logo_path,
  banner_url = banner_path,
  is_verified = (verification = 'verified'),
  verification_status = verification::text,
  completed_orders_count = completed_orders;

-- 5. Sync function and trigger for marketplace_products
CREATE OR REPLACE FUNCTION public.mp_sync_product_compatibility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.quantity_available := GREATEST(0, NEW.quantity_total - NEW.quantity_sold - NEW.quantity_reserved);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mp_product_sync ON public.marketplace_products;
CREATE TRIGGER trg_mp_product_sync
  BEFORE INSERT OR UPDATE ON public.marketplace_products
  FOR EACH ROW
  EXECUTE FUNCTION public.mp_sync_product_compatibility();

-- Backfill products
UPDATE public.marketplace_products
SET quantity_available = GREATEST(0, quantity_total - quantity_sold - quantity_reserved);

-- 6. Sync function and trigger for marketplace_product_images
CREATE OR REPLACE FUNCTION public.mp_sync_image_compatibility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.url IS NULL THEN
    IF NEW.storage_path LIKE 'http%' THEN
      NEW.url := NEW.storage_path;
    ELSE
      NEW.url := 'https://lgxtiilvpnqgzuarzogb.supabase.co/storage/v1/object/public/marketplace-product-images/' || NEW.storage_path;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mp_image_sync ON public.marketplace_product_images;
CREATE TRIGGER trg_mp_image_sync
  BEFORE INSERT OR UPDATE ON public.marketplace_product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.mp_sync_image_compatibility();

-- Backfill images
UPDATE public.marketplace_product_images
SET url = CASE
  WHEN storage_path LIKE 'http%' THEN storage_path
  ELSE 'https://lgxtiilvpnqgzuarzogb.supabase.co/storage/v1/object/public/marketplace-product-images/' || storage_path
END;

-- 7. Overload for mp_save_vendor with p_store_name, p_slug, p_phone
CREATE OR REPLACE FUNCTION public.mp_save_vendor(
  p_store_name TEXT,
  p_slug TEXT,
  p_phone TEXT,
  p_tagline TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_campus_area TEXT DEFAULT NULL,
  p_business_hours JSONB DEFAULT NULL,
  p_policies JSONB DEFAULT NULL,
  p_payout_bank_name TEXT DEFAULT NULL,
  p_payout_account_number TEXT DEFAULT NULL,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := public.mp_save_vendor(
    p_shop_name => p_store_name,
    p_handle => p_slug,
    p_tagline => p_tagline,
    p_description => p_description,
    p_campus_area => p_campus_area,
    p_business_hours => p_business_hours,
    p_policies => p_policies,
    p_payout_bank_name => p_payout_bank_name,
    p_payout_account_number => p_payout_account_number,
    p_vendor_id => p_vendor_id
  );

  IF p_phone IS NOT NULL AND p_phone <> '' THEN
    UPDATE public.marketplace_vendors
    SET phone = p_phone
    WHERE id = (v_res->>'id')::UUID;
  END IF;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mp_save_vendor(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, TEXT, UUID) TO authenticated;
