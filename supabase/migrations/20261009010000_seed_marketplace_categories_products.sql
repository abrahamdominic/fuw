-- Seed sample products for empty marketplace categories idempotently
DO $$
DECLARE
  v_vendor_id UUID := 'e58f59be-4e42-48cd-8e88-81282a3bc37c';
  v_cat_id UUID;
  v_prod_id UUID;
BEGIN
  -- 1. Food & Groceries
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'food';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'product', 'fresh-hot-jollof-rice-fried-chicken',
      'Fresh Hot Jollof Rice, Fried Chicken & Plantain Pack',
      'Authentic freshly cooked smoky jollof rice served with spiced crispy chicken and fried ripe plantains. Packaged hygienically for fast delivery directly to your hostel room or campus faculty.',
      'new', 220000, 250000, false, 50,
      'active', 'delivery', true, true, 20000,
      'New Site Hostels', 'Hostel A Gate or Faculty Block', ARRAY['food', 'jollof', 'lunch', 'hostel delivery'],
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Fresh Hot Jollof Rice Pack'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- 2. Clothing & Fashion
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'clothing';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'product', 'unisex-fuw-campus-oversized-hoodie',
      'Unisex FUW Campus Oversized Hoodie & Sweatshirt',
      'Premium heavy cotton oversized hoodie designed for campus lectures and chilly weather. Durable stitching, fade-resistant color, available in S, M, L, XL, and XXL.',
      'new', 850000, 1000000, false, 30,
      'active', 'delivery', true, true, 30000,
      'Campus Environs', 'Library Quad or Faculty of Science', ARRAY['fashion', 'hoodie', 'campus wear', 'sweatshirt'],
      'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Unisex FUW Campus Hoodie'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- 3. Shoes & Footwear
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'shoes';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'product', 'comfortable-campus-walking-sneakers',
      'Comfortable Campus Walking Sneakers (Everyday Trainers)',
      'Breathable lightweight cushioned running and walking sneakers built for navigating university grounds comfortably. Non-slip sole with high durability.',
      'new', 1200000, 1400000, false, 25,
      'active', 'delivery', true, true, 30000,
      'New Site', 'Student Center or Main Gate', ARRAY['shoes', 'sneakers', 'footwear', 'trainers'],
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Campus Walking Sneakers'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- 4. Barbing & Grooming (Service)
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'barbing';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'service', 'hostel-room-service-barbing-haircut',
      'Hostel Room Service Barbing & Haircut (Fade & Trim)',
      'Professional student barber providing sharp haircuts, fades, beard shaping, and antiseptic aftershave treatment. Available for room visits across male hostels and off-campus lodges.',
      'not_applicable', 150000, 200000, true, 0,
      'active', 'delivery', true, true, 0,
      'Male Hostel Area', 'Your hostel room or lodge doorstep', ARRAY['barbing', 'haircut', 'grooming', 'service'],
      'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Student Barbing Service'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- 5. Hair Styling & Braiding (Service)
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'hair-styling';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'service', 'campus-knotless-box-braids-revamp',
      'Campus Knotless Box Braids & Hair Revamp Session',
      'Neat, painless knotless braids, twist braids, wig cornrows, and wig revamping for FUW students. Friendly service in female hostels or off-campus apartments.',
      'not_applicable', 450000, 500000, true, 0,
      'active', 'delivery', true, true, 0,
      'Female Hostel Area', 'Hostel Room or Apartment', ARRAY['hair', 'braids', 'styling', 'beauty'],
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Hair Styling & Braids'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- 6. Beauty & Personal Care
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'beauty-products';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'product', 'long-lasting-campus-body-mist-set',
      'Long-Lasting Campus Body Mist & Roll-On Fragrance Set',
      'Authentic long-lasting refreshing body spray and concentrated roll-on oil fragrance set. Keeps you feeling crisp throughout long lecture hours.',
      'new', 350000, 400000, false, 40,
      'active', 'delivery', true, true, 20000,
      'Wukari Town & Campus', 'Sub Hall or Faculty Complex', ARRAY['perfume', 'beauty', 'fragrance', 'personal care'],
      'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1523293182086-7651a899d37f?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Perfume Fragrance Set'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- 7. Photography & Video (Service)
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'photography';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES (
      v_vendor_id, v_cat_id, 'service', 'departmental-dinner-matriculation-photography',
      'Departmental Dinner & Matriculation Portrait Photography',
      'Professional DSLR campus photography package. Includes 10 edited high-res digital portraits, studio backdrop lighting, and same-day delivery via Google Drive.',
      'not_applicable', 500000, 650000, true, 0,
      'active', 'delivery', true, true, 0,
      'Campus Wide', 'Senate Building or University Amphitheatre', ARRAY['photography', 'portrait', 'matriculation', 'dinner'],
      'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80', now()
    ) ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path
    RETURNING id INTO v_prod_id;

    INSERT INTO public.marketplace_product_images (
      product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
    ) VALUES (
      v_prod_id, 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
      'image/jpeg',
      true, 0, 'Campus Portrait Photography'
    ) ON CONFLICT DO NOTHING;
  END IF;

  -- Add more items for Food & Groceries
  SELECT id INTO v_cat_id FROM public.marketplace_categories WHERE slug = 'food';
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO public.marketplace_products (
      vendor_id, category_id, listing_type, slug, title, description,
      condition, price_kobo, compare_at_kobo, is_service, quantity_total,
      status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
      campus_area, meeting_point, tags, thumbnail_path, published_at
    ) VALUES
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'hot-akara-custard', 'Hot Akara & Custard Breakfast Pack',
       'Freshly fried bean cakes served hot with creamy custard. Perfect for early morning lectures.',
       'new', 80000, 90000, false, 80, 'active', 'delivery', true, true, 10000, 'New Site Hostels', 'Hostel Canteen Junction',
       ARRAY['food','breakfast','akara','custard'], 'https://images.unsplash.com/photo-1565299543923-37dd37887442?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'spaghetti-suya', 'Spaghetti with Suya Beef Chunks',
       'Tasty spaghetti cooked with rich tomato sauce and grilled suya beef chunks.',
       'new', 120000, 140000, false, 60, 'active', 'delivery', true, true, 15000, 'New Site Hostels', 'Hostel A Gate',
       ARRAY['food','spaghetti','suya','lunch'], 'https://images.unsplash.com/photo-1612392062631-94dd858cba88?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'fried-rice-salad-turkey', 'Fried Rice with Salad & Turkey',
       'Flavorful fried rice with grilled turkey, salad and sauce. Ready to eat.',
       'new', 150000, 170000, false, 50, 'active', 'delivery', true, true, 15000, 'Campus Wide', 'Faculty Blocks',
       ARRAY['food','fried rice','turkey','lunch'], 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'indomie-egg-sauce', 'Indomie Noodles with Egg & Sauce',
       'Quick meal, boiled indomie with 2 eggs and spicy pepper sauce.',
       'new', 70000, 80000, false, 100, 'active', 'delivery', true, true, 8000, 'All Hostels', 'Hostel Gates',
       ARRAY['food','indomie','egg','snacks'], 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'puff-puff-beverage', 'Fresh Puff Puff & Cold Drink',
       'Sweet, soft and fluffy puff puff paired with your favorite chilled drink.',
       'new', 50000, 60000, false, 120, 'active', 'both', true, true, 5000, 'Lecture Areas', 'Lecture Complex',
       ARRAY['food','snacks','puff puff','drinks'], 'https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'meat-pie-soft-drink', 'Freshly Baked Meat Pie with Soft Drink',
       'Flaky golden meat pie with minced beef and potato filling, served with chilled soft drink.',
       'new', 60000, 70000, false, 90, 'active', 'both', true, true, 5000, 'Lecture Areas', 'Lecture Complex',
       ARRAY['food','snacks','meat pie','drinks'], 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'yam-egg-sauce', 'Boiled Yam with Egg & Pepper Sauce',
       'Delicious boiled yam served with fried egg and spicy pepper sauce.',
       'new', 80000, 90000, false, 70, 'active', 'delivery', true, true, 8000, 'New Site', 'Faculty of Social Sciences',
       ARRAY['food','yam','egg','lunch'], 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'rice-beans-plantain-fish', 'Rice & Beans with Fried Plantain & Fish',
       'Classic Nigerian rice and beans combo with ripe fried plantain and fish.',
       'new', 120000, 140000, false, 60, 'active', 'delivery', true, true, 15000, 'New Site Hostels', 'Hostel B Gate',
       ARRAY['food','rice','beans','plantain'], 'https://images.unsplash.com/photo-1543353071-087092ec393a?w=600&auto=format&fit=crop&q=80', now()),
      ('e58f59be-4e42-48cd-8e88-81282a3bc37c', v_cat_id, 'product', 'chicken-shawarma-wrap', 'Chicken Shawarma Wrap',
       'Grilled chicken, veggies, cabbage, mayo and hot sauce wrapped in fresh pita bread.',
       'new', 100000, 120000, false, 50, 'active', 'delivery', true, true, 12000, 'Campus Wide', 'Student Center',
       ARRAY['food','shawarma','chicken','fast food'], 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600&auto=format&fit=crop&q=80', now())
    ON CONFLICT (vendor_id, slug) DO UPDATE SET
      price_kobo = EXCLUDED.price_kobo,
      status = 'active',
      thumbnail_path = EXCLUDED.thumbnail_path;
  END IF;

END $$;