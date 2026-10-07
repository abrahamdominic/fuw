-- =============================================================================
-- FUW MARKETPLACE: Seed Default Categories and Subcategories
-- Covers physical products and campus services per skill.md
-- =============================================================================

DO $$
DECLARE
  v_cat_id UUID;
BEGIN
  -- 1. Food & Meals
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('food', 'Food & Groceries', 'Delicious dorm-cooked meals, fast food, snacks and provisions.', 'UtensilsCrossed', 'product', 10)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'cooked-meals', 'Cooked Meals', 1),
    (v_cat_id, 'snacks-bakes', 'Snacks & Bakes', 2),
    (v_cat_id, 'groceries-provisions', 'Groceries & Provisions', 3),
    (v_cat_id, 'drinks-beverages', 'Drinks & Beverages', 4)
  ON CONFLICT DO NOTHING;

  -- 2. Clothing & Fashion
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('clothing', 'Clothing & Fashion', 'Campus fashion, trendy shirts, denim, traditional wear and hoodies.', 'Shirt', 'product', 20)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'shirts-tops', 'Shirts & Tops', 1),
    (v_cat_id, 'trousers-jeans', 'Trousers & Jeans', 2),
    (v_cat_id, 'dresses-skirts', 'Dresses & Skirts', 3),
    (v_cat_id, 'traditional-wear', 'Traditional Wear', 4),
    (v_cat_id, 'jackets-hoodies', 'Jackets & Hoodies', 5)
  ON CONFLICT DO NOTHING;

  -- 3. Shoes & Footwear
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('shoes', 'Shoes & Footwear', 'Sneakers, formal shoes, slides, crocs and sandals.', 'Footprints', 'product', 30)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'sneakers', 'Sneakers', 1),
    (v_cat_id, 'sandals-slides', 'Sandals & Slides', 2),
    (v_cat_id, 'formal-shoes', 'Formal Shoes', 3),
    (v_cat_id, 'heels-flats', 'Heels & Flats', 4)
  ON CONFLICT DO NOTHING;

  -- 4. Phones & Accessories
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('phones-accessories', 'Phones & Accessories', 'Smartphones, fast chargers, powerbanks, cases and earphones.', 'Smartphone', 'product', 40)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'smartphones', 'Smartphones', 1),
    (v_cat_id, 'chargers-cables', 'Chargers & Cables', 2),
    (v_cat_id, 'powerbanks', 'Powerbanks', 3),
    (v_cat_id, 'cases-covers', 'Cases & Screen Protectors', 4),
    (v_cat_id, 'audio-earphones', 'Earphones & Airpods', 5)
  ON CONFLICT DO NOTHING;

  -- 5. Laptops & Electronics
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('laptops-electronics', 'Laptops & Electronics', 'Student laptops, flash drives, keyboards, mouse and electronics.', 'Laptop', 'product', 50)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'laptops', 'Laptops', 1),
    (v_cat_id, 'flash-drives-hdds', 'Flash Drives & Hard Drives', 2),
    (v_cat_id, 'peripherals', 'Keyboards & Mice', 3),
    (v_cat_id, 'chargers-adapters', 'Chargers & Adapters', 4),
    (v_cat_id, 'gadgets', 'Smart Gadgets', 5)
  ON CONFLICT DO NOTHING;

  -- 6. Books & Textbooks
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('books', 'Books & Textbooks', 'Course textbooks, departmental handouts, past questions and literature.', 'BookOpen', 'product', 60)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'textbooks', 'Course Textbooks', 1),
    (v_cat_id, 'past-questions', 'Past Questions & Handouts', 2),
    (v_cat_id, 'novels-general', 'Novels & Literature', 3)
  ON CONFLICT DO NOTHING;

  -- 7. School Materials & Stationery
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('school-materials', 'School Materials & Stationery', 'Lab coats, drawing boards, scientific calculators, notebooks and kits.', 'GraduationCap', 'product', 70)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'stationery', 'Stationery & Notebooks', 1),
    (v_cat_id, 'lab-coats-gear', 'Lab Coats & Safety Gear', 2),
    (v_cat_id, 'drawing-engineering', 'Drawing Boards & Tools', 3),
    (v_cat_id, 'calculators', 'Calculators & Instruments', 4)
  ON CONFLICT DO NOTHING;

  -- 8. Beauty Products
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('beauty-products', 'Beauty & Personal Care', 'Skincare, perfumes, deodorants, cosmetics and personal grooming kits.', 'Sparkles', 'product', 80)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'skincare', 'Skincare', 1),
    (v_cat_id, 'perfumes-fragrances', 'Perfumes & Deodorants', 2),
    (v_cat_id, 'hair-care', 'Hair Care', 3),
    (v_cat_id, 'cosmetics', 'Cosmetics & Makeup', 4)
  ON CONFLICT DO NOTHING;

  -- ===================
  -- CAMPUS SERVICES
  -- ===================

  -- 9. Laundry
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('laundry', 'Laundry & Dry Cleaning', 'Fast wash, fold and starching with hostel pickup and delivery.', 'Shirt', 'service', 90)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'wash-and-fold', 'Wash & Fold', 1),
    (v_cat_id, 'ironing-pressing', 'Ironing & Pressing', 2),
    (v_cat_id, 'dorm-pickup', 'Dorm Pickup & Delivery', 3)
  ON CONFLICT DO NOTHING;

  -- 10. Barbing
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('barbing', 'Barbing & Grooming', 'Clean haircuts, fades, trims and dorm-call barbers.', 'Scissors', 'service', 100)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'dorm-barbing', 'Dorm Call Barbing', 1),
    (v_cat_id, 'salon-barbing', 'Salon Barbing', 2),
    (v_cat_id, 'beard-grooming', 'Beard Grooming', 3)
  ON CONFLICT DO NOTHING;

  -- 11. Hair Styling
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('hair-styling', 'Hair Styling & Braiding', 'Knotless braids, weaves, wig revamping, washing and loc maintenance.', 'Crown', 'service', 110)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'braiding-weaving', 'Braiding & Weaving', 1),
    (v_cat_id, 'wig-styling', 'Wig Styling & Revamp', 2),
    (v_cat_id, 'locs-dreadlocks', 'Locs & Dreadlocks', 3)
  ON CONFLICT DO NOTHING;

  -- 12. Printing
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('printing', 'Printing & Typing', 'Handout printing, project typing, spiral binding and colour photocopies.', 'Printer', 'service', 120)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'document-printing', 'Document Printing & Copies', 1),
    (v_cat_id, 'project-binding', 'Project Binding & Spiral', 2),
    (v_cat_id, 'typing-formatting', 'Typing & Formatting', 3)
  ON CONFLICT DO NOTHING;

  -- 13. Graphic Design
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('graphic-design', 'Graphic Design & Media', 'Flyers, department banners, logos, presentation decks and social graphics.', 'Palette', 'service', 130)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'flyers-posters', 'Flyers & Posters', 1),
    (v_cat_id, 'logo-branding', 'Logo & Branding', 2),
    (v_cat_id, 'social-media', 'Social Media Designs', 3)
  ON CONFLICT DO NOTHING;

  -- 14. Photography
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('photography', 'Photography & Video', 'Portrait sessions, convocation shoots, department dinners and video production.', 'Camera', 'service', 140)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'portrait-shoots', 'Portrait & Birthday Shoots', 1),
    (v_cat_id, 'event-coverage', 'Event Coverage', 2),
    (v_cat_id, 'video-editing', 'Video Editing & Content', 3)
  ON CONFLICT DO NOTHING;

  -- 15. Transportation Related Services
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('transportation', 'Transportation & Moving', 'Campus shuttle dispatch, hostel relocation and parcel errands around Wukari.', 'Truck', 'service', 150)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'luggage-moving', 'Luggage & Hostel Moving', 1),
    (v_cat_id, 'campus-dispatch', 'Campus Dispatch Delivery', 2)
  ON CONFLICT DO NOTHING;

  -- 16. Repairs
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('repairs', 'Repairs & Tech Support', 'Smartphone screen replacement, laptop troubleshooting, OS flashing and hardware fixes.', 'Wrench', 'service', 160)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'phone-repairs', 'Phone Screen & Battery Repair', 1),
    (v_cat_id, 'laptop-repairs', 'Laptop Hardware Repair', 2),
    (v_cat_id, 'software-os', 'OS Installation & Software', 3)
  ON CONFLICT DO NOTHING;

  -- 17. Tutoring
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('tutoring', 'Tutoring & Academic Lessons', 'One-on-one tutorial for core GST, sciences, engineering and programming.', 'GraduationCap', 'service', 170)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'maths-science', 'Maths & Science Tutoring', 1),
    (v_cat_id, 'coding-tech', 'Programming & Tech Lessons', 2),
    (v_cat_id, 'faculty-courses', 'Faculty Core Courses', 3)
  ON CONFLICT DO NOTHING;

  -- 18. Accommodation Related Services
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('accommodation', 'Accommodation & Roommates', 'Verified off-campus lodge scouting, roommate pairing and lodge handover support.', 'Home', 'service', 180)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'hostel-scouting', 'Off-Campus Hostel Scouting', 1),
    (v_cat_id, 'roommate-matching', 'Roommate Finding Assistance', 2)
  ON CONFLICT DO NOTHING;

  -- 19. Other Student Services
  INSERT INTO public.marketplace_categories (slug, name, description, icon, listing_type, sort_order)
  VALUES ('other-services', 'Other Student Services', 'Tailoring, dorm room cleaning, event ushering and miscellaneous student assistance.', 'Briefcase', 'service', 190)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon
  RETURNING id INTO v_cat_id;

  INSERT INTO public.marketplace_subcategories (category_id, slug, name, sort_order)
  VALUES
    (v_cat_id, 'event-planning', 'Event Planning & Ushering', 1),
    (v_cat_id, 'tailoring-alterations', 'Tailoring & Alterations', 2),
    (v_cat_id, 'dorm-cleaning', 'Dorm Room Cleaning', 3)
  ON CONFLICT DO NOTHING;

END $$;
