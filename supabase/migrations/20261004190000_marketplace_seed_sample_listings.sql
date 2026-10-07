-- =============================================================================
-- Migration: 20261004190000_marketplace_seed_sample_listings.sql
-- Description: Seed verified campus stores and realistic listings for launch
-- =============================================================================

DO $$
DECLARE
  v_owner_1 UUID;
  v_owner_2 UUID;
  v_vendor_1 UUID;
  v_vendor_2 UUID;
  v_cat_tech UUID;
  v_cat_food UUID;
  v_cat_books UUID;
  v_prod_id UUID;
BEGIN
  -- Pick existing student profiles for vendor demo ownership
  SELECT id INTO v_owner_1 FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_owner_2 FROM public.profiles ORDER BY created_at DESC LIMIT 1;

  IF v_owner_1 IS NULL THEN
    RETURN;
  END IF;
  IF v_owner_2 IS NULL THEN
    v_owner_2 := v_owner_1;
  END IF;

  -- Category IDs
  SELECT id INTO v_cat_tech FROM public.marketplace_categories WHERE slug = 'phones-accessories' LIMIT 1;
  SELECT id INTO v_cat_food FROM public.marketplace_categories WHERE slug = 'food' LIMIT 1;
  SELECT id INTO v_cat_books FROM public.marketplace_categories WHERE slug = 'books' LIMIT 1;

  -- 1. Create Vendor 1: FUW Campus Tech Hub
  INSERT INTO public.marketplace_vendors (
    owner_id, handle, shop_name, tagline, description,
    status, verification, verified_at, completed_orders,
    rating_avg, rating_count, campus_area, payout_bank_name, payout_account_number, payout_enabled
  ) VALUES (
    v_owner_1,
    'fuw-tech-hub',
    'FUW Campus Tech Hub',
    'Certified Student Gadgets, Laptops & Fast Delivery',
    'Trusted campus tech vendor based near Faculty of Science. We supply tested laptop accessories, fast chargers, OTG devices and screen protectors for FUW students.',
    'active',
    'verified',
    now(),
    24,
    4.85,
    18,
    'Male Hostel A / Faculty of Science',
    'Opay',
    '8012345678',
    TRUE
  )
  ON CONFLICT (handle) DO UPDATE SET status = 'active', verification = 'verified'
  RETURNING id INTO v_vendor_1;

  -- 2. Create Vendor 2: Wukari Campus Bites
  INSERT INTO public.marketplace_vendors (
    owner_id, handle, shop_name, tagline, description,
    status, verification, verified_at, completed_orders,
    rating_avg, rating_count, campus_area, payout_bank_name, payout_account_number, payout_enabled
  ) VALUES (
    v_owner_2,
    'campus-bites',
    'Wukari Campus Bites & Provisions',
    'Fresh Hostel Meals, Fried Rice & Fast Delivery',
    'Delicious hostel meals prepared fresh daily. Prompt hostel delivery within 20 minutes to all male and female blocks.',
    'active',
    'verified',
    now(),
    42,
    4.90,
    35,
    'Female Hostel B Food Court',
    'Palmpay',
    '9012345678',
    TRUE
  )
  ON CONFLICT (handle) DO UPDATE SET status = 'active', verification = 'verified'
  RETURNING id INTO v_vendor_2;

  -- Product 1: Fast Charger 65W
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor_1, v_cat_tech, 'fast-charger-65w-type-c',
    'Original 65W Super Fast Type-C Charger & Cable',
    'Compatible with laptops, Samsung, Xiaomi, iPhone 15/16, and Techno/Infinix. 30 minutes 70% charge speed tested and guaranteed.',
    'new', 650000, 800000, 20, 3, 0,
    'active', 'delivery', TRUE, TRUE, 50000, 'Male Hostel A'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active'
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Product 2: HP EliteBook Laptop
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor_1, v_cat_tech, 'hp-elitebook-840-g5',
    'HP EliteBook 840 G5 Core i5 8th Gen 16GB / 256GB SSD',
    'Pristine condition laptop, excellent 6-hour battery health. Backlit keyboard, Full HD screen. Ideal for programming, engineering software, and coursework.',
    'like_new', 18500000, 21000000, 3, 0, 0,
    'active', 'delivery', TRUE, TRUE, 50000, 'Faculty of Computing'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active'
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Product 3: Bluetooth Earbuds
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor_1, v_cat_tech, 'wireless-tws-earbuds',
    'Wireless Noise-Cancelling TWS Earbuds (Deep Bass)',
    'Ultra-clear sound for studying, phone calls and music. Up to 28 hours playtime with charging case.',
    'new', 750000, 950000, 15, 2, 0,
    'active', 'delivery', TRUE, TRUE, 50000, 'Male Hostel A'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active'
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Product 4: Fried Rice & Chicken Combo
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor_2, v_cat_food, 'fried-rice-chicken-combo',
    'Special Fried Rice & Crispy Peppered Chicken Combo',
    'Hot savoury Nigerian fried rice served with big crispy peppered chicken, fried plantain, and coleslaw salad. Packaged in sealed hygienic takeaway pack.',
    'not_applicable', 220000, 250000, 40, 12, 0,
    'active', 'delivery', TRUE, TRUE, 50000, 'Female Hostel B Food Court'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active'
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Product 5: Casio FX-991EX Scientific Calculator
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor_1, v_cat_books, 'casio-fx-991ex-calculator',
    'Original Casio FX-991EX ClassWiz Scientific Calculator',
    'Essential for Science, Engineering and Agriculture students. 552 functions, high-resolution natural textbook display. Authenticity QR code verified.',
    'new', 1250000, 1500000, 8, 1, 0,
    'active', 'delivery', TRUE, TRUE, 50000, 'Faculty of Science'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active'
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1594980596870-8aa52a78d8cd?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

END;
$$;
