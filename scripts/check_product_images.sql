SELECT id, title, thumbnail_url, vendor_id FROM marketplace_products LIMIT 5;
SELECT id, product_id, url, storage_path, is_primary FROM marketplace_product_images LIMIT 10;
SELECT name, bucket_id, created_at FROM storage.objects WHERE bucket_id = 'marketplace-product-images' LIMIT 10;
