SELECT id, title, thumbnail_path, vendor_id FROM marketplace_products LIMIT 10;
SELECT id, product_id, url, storage_path, is_primary FROM marketplace_product_images LIMIT 10;
SELECT name, bucket_id FROM storage.objects WHERE bucket_id = 'marketplace-product-images' LIMIT 10;
