SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'marketplace_products'
ORDER BY ordinal_position;

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'marketplace_product_images'
ORDER BY ordinal_position;
