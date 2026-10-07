-- =============================================================================
-- Migration: 20261005200000_marketplace_seed_campus_services.sql
-- Description: Seed verified student service listings on FUW Marketplace
-- =============================================================================

DO $$
DECLARE
  v_owner UUID;
  v_vendor UUID;
  v_cat_tech UUID;
  v_cat_laundry UUID;
  v_cat_stationery UUID;
  v_cat_books UUID;
  v_prod_id UUID;
BEGIN
  -- Find a profile that does not yet own a vendor store
  SELECT id INTO v_owner 
  FROM public.profiles 
  WHERE id NOT IN (SELECT owner_id FROM public.marketplace_vendors) 
  ORDER BY created_at ASC 
  LIMIT 1;

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.marketplace_vendors (
      owner_id, handle, shop_name, tagline, description,
      status, verification, verified_at, completed_orders,
      rating_avg, rating_count, campus_area, payout_bank_name, payout_account_number, payout_enabled
    ) VALUES (
      v_owner,
      'fuw-student-services',
      'FUW Student Services Network',
      'Verified Campus Services — Laundry, Typing, Tech Support & Tutoring',
      'Campus-wide verified student skill providers network. All jobs covered by FUW Student Marketplace escrow and guaranteed delivery.',
      'active',
      'verified',
      now(),
      58,
      4.92,
      41,
      'Main Campus / Student Union Building',
      'Kuda Bank',
      '2012345678',
      TRUE
    )
    ON CONFLICT (handle) DO UPDATE SET status = 'active', verification = 'verified'
    RETURNING id INTO v_vendor;
  ELSE
    SELECT id INTO v_vendor FROM public.marketplace_vendors LIMIT 1;
  END IF;

  IF v_vendor IS NULL THEN
    RETURN;
  END IF;

  -- Categories
  SELECT id INTO v_cat_tech FROM public.marketplace_categories WHERE slug = 'laptops-electronics' LIMIT 1;
  SELECT id INTO v_cat_laundry FROM public.marketplace_categories WHERE slug = 'laundry' LIMIT 1;
  SELECT id INTO v_cat_stationery FROM public.marketplace_categories WHERE slug = 'school-materials' LIMIT 1;
  SELECT id INTO v_cat_books FROM public.marketplace_categories WHERE slug = 'books' LIMIT 1;

  -- Fallbacks
  IF v_cat_tech IS NULL THEN SELECT id INTO v_cat_tech FROM public.marketplace_categories LIMIT 1; END IF;
  IF v_cat_laundry IS NULL THEN v_cat_laundry := v_cat_tech; END IF;
  IF v_cat_stationery IS NULL THEN v_cat_stationery := v_cat_tech; END IF;
  IF v_cat_books IS NULL THEN v_cat_books := v_cat_tech; END IF;

  -- Service 1: Project & Seminar Typing
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    listing_type, is_service, capacity, lead_time_hours, service_area,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor, v_cat_stationery, 'project-seminar-typing-binding',
    'Project & Seminar Typing, APA Formatting & Spiral Binding',
    'Accurate typing and standard university project/seminar document formatting according to FUW guidelines. Fast turnaround, error-free proofreading and quality spiral binding.',
    'service', TRUE, 15, 12, 'Campus-wide / New Site & Old Site',
    'not_applicable', 150000, 200000, 0, 0, 0,
    'active', 'pickup', TRUE, TRUE, 0, 'SUB Complex Room 4'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active', listing_type = 'service', is_service = TRUE
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Service 2: Hostel Laundry Express
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    listing_type, is_service, capacity, lead_time_hours, service_area,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor, v_cat_laundry, 'hostel-express-laundry-bag',
    'Hostel Express Laundry, Washing & Ironing (Per Bag / 15 Pieces)',
    'Hassle-free student laundry service. Pickup and return right to your hostel door within 24 hours. Fabric softener and neat crisp folding included.',
    'service', TRUE, 20, 24, 'All Hostels (Male & Female Blocks)',
    'not_applicable', 350000, 450000, 0, 0, 0,
    'active', 'delivery', TRUE, TRUE, 30000, 'Hostel Environs'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active', listing_type = 'service', is_service = TRUE
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Service 3: Laptop Repair & Software Setup
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    listing_type, is_service, capacity, lead_time_hours, service_area,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor, v_cat_tech, 'laptop-repair-os-software-setup',
    'Laptop Repair, Windows 11/10 OS Setup & Academic Software Installation',
    'Complete computer maintenance: Windows OS installation, malware cleaning, SSD upgrade installation, and configuration of academic tools (MATLAB, Python, AutoCAD, SPSS, Office 365).',
    'service', TRUE, 10, 4, 'Faculty of Science / Computing',
    'not_applicable', 300000, 400000, 0, 0, 0,
    'active', 'pickup', TRUE, TRUE, 0, 'Faculty of Computing Lab 2'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active', listing_type = 'service', is_service = TRUE
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Service 4: Graphic Design & Posters
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    listing_type, is_service, capacity, lead_time_hours, service_area,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor, v_cat_stationery, 'campus-graphics-flyers-posters',
    'Custom Graphic Design — Departmental Posters, Flyers & Event Banners',
    'Eye-catching graphic design for departmental associations, church fellowships, hall week events, student politics and business branding. Delivered in print-ready high resolution format.',
    'service', TRUE, 25, 8, 'Campus-wide / Online Delivery',
    'not_applicable', 250000, 350000, 0, 0, 0,
    'active', 'pickup', FALSE, TRUE, 0, 'Online / WhatsApp Delivery'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active', listing_type = 'service', is_service = TRUE
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

  -- Service 5: Academic Peer Tutoring
  INSERT INTO public.marketplace_products (
    vendor_id, category_id, slug, title, description,
    listing_type, is_service, capacity, lead_time_hours, service_area,
    condition, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved,
    status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo, campus_area
  ) VALUES (
    v_vendor, v_cat_books, 'peer-academic-tutoring-mth-phy',
    'Peer Academic Tutoring — 100L & 200L Mathematics, Physics & GST',
    'Comprehensive step-by-step tutoring with solved past questions and weekly mock quizzes by high-CGPA senior students. Small group sessions at the University Library or online.',
    'service', TRUE, 12, 2, 'University Library Study Rooms',
    'not_applicable', 400000, 550000, 0, 0, 0,
    'active', 'pickup', FALSE, TRUE, 0, 'FUW E-Library Study Area'
  )
  ON CONFLICT (vendor_id, slug) DO UPDATE SET status = 'active', listing_type = 'service', is_service = TRUE
  RETURNING id INTO v_prod_id;

  INSERT INTO public.marketplace_product_images (product_id, storage_path, mime_type, is_primary, sort_order)
  VALUES (v_prod_id, 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=600&auto=format&fit=crop&q=80', 'image/jpeg', TRUE, 0)
  ON CONFLICT (storage_path) DO NOTHING;

END $$;
