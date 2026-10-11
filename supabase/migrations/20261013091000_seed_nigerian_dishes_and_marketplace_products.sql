-- Migration: marketplace demo inventory expansion (Nigerian dishes + underpopulated categories)
--
-- Adds a clearly-labelled demo inventory on top of the existing seed so every
-- marketplace category has a usable selection:
--   * 24 Nigerian student dishes / food combos (food category)
--   * 13 products across clothing, shoes, beauty, laptops-electronics, books,
--     school-materials
--   * 12 services across the previously-empty service categories
--     (printing, graphic-design, transportation, repairs, tutoring,
--      accommodation, other-services)
--
-- Design decisions
--   * Idempotent: every insert upserts on the existing natural keys
--     (`marketplace_products (vendor_id, slug)`, image `storage_path`).
--   * All added rows carry `is_demo = TRUE` so they are indistinguishable in the
--     data model from other sample inventory and can be filtered/excluded.
--   * A BEFORE INSERT trigger on `marketplace_order_items` refuses to let a demo
--     listing enter a real order, so sample inventory is never transacted.
--   * Reuses the existing platform demo vendor (`fuw-student-services`) and the
--     four canonical food subcategories; no new categories or fake vendors.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Demo flag + transactional exclusion
-- ---------------------------------------------------------------------------
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.marketplace_products.is_demo IS
  'Sample/demonstration inventory (not a real seller listing). Excluded from real orders by trg_mp_block_demo_order_item.';

CREATE OR REPLACE FUNCTION public.mp_block_demo_order_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.marketplace_products p
        WHERE p.id = NEW.product_id AND p.is_demo = TRUE
     ) THEN
    RAISE EXCEPTION 'This is a sample/demo listing and cannot be purchased.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mp_block_demo_order_item ON public.marketplace_order_items;
CREATE TRIGGER trg_mp_block_demo_order_item
  BEFORE INSERT ON public.marketplace_order_items
  FOR EACH ROW EXECUTE FUNCTION public.mp_block_demo_order_item();

-- ---------------------------------------------------------------------------
-- 2. Products (food + underpopulated product categories)
-- ---------------------------------------------------------------------------
WITH v AS (
  SELECT
    (SELECT id FROM public.marketplace_vendors WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1) AS vendor_id
),
d(cat, slug, title, descr, price, compare, qty, delivery_fee, campus, meeting, tags, image) AS (
  VALUES
    -- ---- Nigerian dishes -------------------------------------------------
    ('food', 'party-jollof-rice-dodo-chicken', 'Party Jollof Rice, Dodo & Grilled Chicken',
     'Smoky party-style jollof rice with sweet fried plantain and peppered grilled chicken. Cooked fresh daily and packed for hostel delivery.',
     250000::bigint, 280000::bigint, 60::int, 20000::bigint, 'New Site Hostels', 'Hostel A Gate', ARRAY['food','jollof','rice','chicken']::text[], 'https://images.unsplash.com/photo-1565299543923-37dd37887442?w=600&auto=format&fit=crop&q=80'),
    ('food', 'fried-rice-chicken-salad', 'Fried Rice, Chicken & Coleslaw',
     'Nigerian-style fried rice with mixed vegetables, a piece of fried chicken and fresh coleslaw.',
     220000, 250000, 50, 20000, 'New Site Hostels', 'Faculty of Science Car Park', ARRAY['food','fried rice','chicken'], 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600&auto=format&fit=crop&q=80'),
    ('food', 'white-rice-tomato-stew-chicken', 'White Rice & Tomato Stew with Chicken',
     'Fluffy white rice served with rich tomato-pepper stew and a piece of chicken.',
     180000, 200000, 40, 20000, 'Old Site', 'Old Site Roundabout', ARRAY['food','rice','stew'], 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&auto=format&fit=crop&q=80'),
    ('food', 'beans-fried-plantain', 'Beans & Fried Plantain (Ewa & Dodo)',
     'Well-seasoned honey beans paired with golden fried plantain. A filling, affordable student staple.',
     120000, 140000, 70, 15000, 'New Site Hostels', 'Hostel D Common Room', ARRAY['food','beans','plantain','budget'], 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=80'),
    ('food', 'yam-egg-sauce', 'Boiled Yam & Egg Sauce',
     'Soft boiled yam served with a savoury tomato, pepper and egg sauce.',
     150000, 170000, 45, 15000, 'Old Site', 'Faculty of Humanities', ARRAY['food','yam','egg'], 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=600&auto=format&fit=crop&q=80'),
    ('food', 'yam-porridge-asaro', 'Yam Porridge (Asaro)',
     'Creamy yam porridge cooked with palm oil, pepper, onion and flaked fish.',
     150000, 170000, 40, 15000, 'New Site Hostels', 'Hostel B Gate', ARRAY['food','yam','porridge'], 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80'),
    ('food', 'moi-moi-wrap', 'Steamed Moi Moi (Bean Pudding)',
     'Soft, spiced steamed bean pudding wrapped in leaves and ready to eat.',
     50000, 60000, 100, 10000, 'Campus Environs', 'Main Library Entrance', ARRAY['food','moi moi','snack'], 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&auto=format&fit=crop&q=80'),
    ('food', 'akara-pap', 'Akara & Pap Combo',
     'Crispy fried bean cakes served with a bowl of warm, smooth pap (ogi).',
     70000, 80000, 80, 10000, 'New Site Hostels', 'Hostel A Gate', ARRAY['food','akara','breakfast'], 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&auto=format&fit=crop&q=80'),
    ('food', 'ewa-agoyin-agege-bread', 'Ewa Agoyin & Agege Bread',
     'Mashed beans in fiery agoyin sauce served with soft Agege bread.',
     100000, 120000, 55, 15000, 'Old Site', 'Old Site Market Junction', ARRAY['food','ewa agoyin','bread'], 'https://images.unsplash.com/photo-1547592180-85f173990554?w=600&auto=format&fit=crop&q=80'),
    ('food', 'amala-ewedu-gbegiri', 'Amala & Ewedu with Gbegiri',
     'Smooth amala served with ewedu and gbegiri soups and assorted meat.',
     180000, 200000, 35, 20000, 'Wukari Town', 'Wukari Town Hall', ARRAY['food','amala','ewedu','swallow'], 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format&fit=crop&q=80'),
    ('food', 'eba-egusi-soup', 'Eba & Egusi Soup',
     'Freshly turned garri (eba) with rich melon-seed (egusi) soup and vegetables.',
     180000, 200000, 35, 20000, 'Hospital Road', 'General Hospital Junction', ARRAY['food','eba','egusi','swallow'], 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=600&auto=format&fit=crop&q=80'),
    ('food', 'fufu-vegetable-soup', 'Fufu & Vegetable Soup',
     'Soft fufu with a hearty Nigerian vegetable soup and assorted meat.',
     180000, 200000, 30, 20000, 'New Site Hostels', 'Hostel C Block', ARRAY['food','fufu','vegetable soup'], 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&auto=format&fit=crop&q=80'),
    ('food', 'pounded-yam-egusi', 'Pounded Yam & Egusi Soup',
     'Smooth pounded yam with a generous bowl of egusi soup and stockfish.',
     200000, 230000, 30, 20000, 'Old Site', 'Faculty of Agriculture', ARRAY['food','pounded yam','egusi'], 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&auto=format&fit=crop&q=80'),
    ('food', 'tuwo-shinkafa-miyan-kuka', 'Tuwo Shinkafa & Miyan Kuka',
     'Northern-style rice tuwo served with baobab-leaf (kuka) soup.',
     170000, 190000, 25, 20000, 'Wukari Town', 'Wukari Central Market', ARRAY['food','tuwo','northern'], 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=600&auto=format&fit=crop&q=80'),
    ('food', 'beef-suya-wrap', 'Beef Suya Wrap',
     'Spicy grilled beef suya with yaji, onions and tomato wrapped for the go.',
     150000, 170000, 60, 15000, 'Campus Environs', 'Main Gate Suya Spot', ARRAY['food','suya','grilled','snack'], 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&auto=format&fit=crop&q=80'),
    ('food', 'chicken-shawarma', 'Chicken Shawarma',
     'Grilled chicken shawarma with cabbage, sausage and creamy sauce in warm flatbread.',
     200000, 230000, 50, 15000, 'New Site Hostels', 'Hostel A Gate', ARRAY['food','shawarma','fast food'], 'https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=600&auto=format&fit=crop&q=80'),
    ('food', 'meat-pie', 'Nigerian Meat Pie',
     'Flaky golden pastry filled with seasoned minced meat, potato and carrot.',
     50000, 60000, 120, 10000, 'Campus Environs', 'Faculty of Science', ARRAY['food','meat pie','snack'], 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600&auto=format&fit=crop&q=80'),
    ('food', 'sausage-roll', 'Sausage Roll',
     'Soft breaded roll with a savoury sausage centre. Great quick campus snack.',
     40000, 50000, 120, 10000, 'Old Site', 'Old Site Roundabout', ARRAY['food','sausage roll','snack'], 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=600&auto=format&fit=crop&q=80'),
    ('food', 'puff-puff-five', 'Puff-Puff (5 Pieces)',
     'Soft, sweet fried dough balls freshly made to order.',
     30000, 40000, 150, 10000, 'New Site Hostels', 'Hostel D Gate', ARRAY['food','puff puff','snack'], 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&auto=format&fit=crop&q=80'),
    ('food', 'bread-tea-breakfast', 'Bread & Tea Breakfast Combo',
     'Sliced bread with butter and a hot cup of milk tea — a quick student breakfast.',
     100000, 120000, 80, 10000, 'New Site Hostels', 'Hostel B Common Room', ARRAY['food','breakfast','bread','tea'], 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&auto=format&fit=crop&q=80'),
    ('food', 'indomie-egg-sauce', 'Indomie & Egg Sauce',
     'Two packs of noodles cooked with a rich tomato, pepper and egg sauce.',
     120000, 140000, 90, 10000, 'Campus Environs', 'Faculty of Education', ARRAY['food','indomie','noodles'], 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=600&auto=format&fit=crop&q=80'),
    ('food', 'grilled-fish-chips', 'Grilled Tilapia & Chips',
     'Whole grilled tilapia fish served with spiced potato chips.',
     300000, 330000, 25, 25000, 'Hospital Road', 'General Hospital Junction', ARRAY['food','fish','grilled'], 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=80'),
    ('food', 'grilled-chicken-quarter', 'Peppered Grilled Chicken (Quarter)',
     'Charcoal-grilled quarter chicken coated in spicy pepper sauce.',
     220000, 250000, 40, 15000, 'Campus Environs', 'Main Gate Suya Spot', ARRAY['food','chicken','grilled'], 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&auto=format&fit=crop&q=80'),
    ('food', 'ofada-rice-ayamase', 'Ofada Rice & Ayamase (Green Stew)',
     'Local unpolished ofada rice with rich green pepper ayamase stew and assorted meat.',
     250000, 280000, 30, 20000, 'Old Site', 'Faculty of Humanities', ARRAY['food','ofada','ayamase'], 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600&auto=format&fit=crop&q=80'),
    -- ---- Clothing & Fashion ---------------------------------------------
    ('clothing', 'fuw-alumni-cotton-tshirt', 'FUW Alumni Cotton T-Shirt',
     'Breathable 100% cotton crew-neck t-shirt with a printed FUW Campus Hub crest. Unisex fit, sizes S-XXL.',
     700000, 850000, 40, 30000, 'Campus Environs', 'Library Quad', ARRAY['fashion','tshirt','campus wear'], 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&auto=format&fit=crop&q=80'),
    ('clothing', 'slim-fit-denim-jeans', 'Slim-Fit Denim Jeans',
     'Durable stretch denim jeans with a comfortable slim fit for everyday campus wear.',
     1200000, 1500000, 25, 30000, 'Old Site', 'Old Site Market', ARRAY['fashion','jeans','denim'], 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&auto=format&fit=crop&q=80'),
    ('clothing', 'ankara-two-piece-set', 'Ankara Print Two-Piece Set',
     'Vibrant locally tailored Ankara top-and-trouser set. Custom sizing available.',
     1500000, 1800000, 15, 30000, 'Wukari Town', 'Wukari Central Market', ARRAY['fashion','ankara','native'], 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&auto=format&fit=crop&q=80'),
    -- ---- Shoes & Footwear -----------------------------------------------
    ('shoes', 'canvas-campus-sneakers', 'Canvas Campus Sneakers',
     'Lightweight canvas sneakers with a cushioned sole, good for long lecture days.',
     1200000, 1400000, 30, 30000, 'New Site Hostels', 'Hostel A Gate', ARRAY['shoes','sneakers','casual'], 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&auto=format&fit=crop&q=80'),
    ('shoes', 'leather-slide-slippers', 'Leather Slide Slippers',
     'Comfortable padded leather slides — easy for hostel and quick errands.',
     800000, 950000, 35, 20000, 'Old Site', 'Old Site Roundabout', ARRAY['shoes','slippers','casual'], 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=600&auto=format&fit=crop&q=80'),
    -- ---- Beauty & Personal Care -----------------------------------------
    ('beauty-products', 'shea-butter-body-lotion', 'Shea Butter Body Lotion 500ml',
     'Moisturising lotion enriched with pure Nigerian shea butter. Gentle on all skin types.',
     350000, 420000, 50, 15000, 'Campus Environs', 'Faculty of Science', ARRAY['beauty','lotion','skincare'], 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600&auto=format&fit=crop&q=80'),
    ('beauty-products', 'unisex-long-lasting-perfume', 'Unisex Long-Lasting Perfume 50ml',
     'Fresh, long-lasting unisex fragrance for everyday campus confidence.',
     900000, 1100000, 30, 15000, 'New Site Hostels', 'Hostel D Gate', ARRAY['beauty','perfume','fragrance'], 'https://images.unsplash.com/photo-1608667508764-33cf0726b13a?w=600&auto=format&fit=crop&q=80'),
    -- ---- Laptops & Electronics ------------------------------------------
    ('laptops-electronics', 'wireless-optical-mouse', 'Wireless Optical Mouse',
     'Ergonomic 2.4GHz wireless mouse with adjustable DPI. USB receiver included.',
     600000, 750000, 40, 15000, 'Campus Environs', 'Faculty of Science', ARRAY['electronics','computer','accessories'], 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80'),
    ('laptops-electronics', 'usb-flash-drive-64gb', 'USB 3.0 Flash Drive 64GB',
     'Fast 64GB USB 3.0 flash drive for lecture slides, projects and backups.',
     500000, 600000, 60, 15000, 'Campus Environs', 'Main Library Entrance', ARRAY['electronics','storage','usb'], 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&auto=format&fit=crop&q=80'),
    -- ---- Books & Textbooks ----------------------------------------------
    ('books', 'gst101-past-questions', 'GST 101 Past Questions & Answers',
     'Compiled GST 101 past questions with model answers — ideal for exam revision.',
     250000, 300000, 100, 15000, 'Campus Environs', 'Main Library Entrance', ARRAY['books','gst','past questions'], 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&auto=format&fit=crop&q=80'),
    ('books', 'engineering-mathematics-textbook', 'Fundamentals of Engineering Mathematics',
     'Comprehensive engineering mathematics textbook covering calculus, algebra and differential equations.',
     650000, 800000, 20, 20000, 'Campus Environs', 'Faculty of Engineering', ARRAY['books','engineering','mathematics'], 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80'),
    -- ---- School Materials & Stationery ----------------------------------
    ('school-materials', 'hardcover-notebooks-set-5', 'Hard-Cover Notebooks (Set of 5)',
     'Set of five A5 hard-cover ruled notebooks for lecture notes.',
     300000, 350000, 80, 15000, 'Campus Environs', 'Main Library Entrance', ARRAY['stationery','notebooks','school'], 'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=600&auto=format&fit=crop&q=80'),
    ('school-materials', 'scientific-calculator-fx991', 'Scientific Calculator (FX-991 Class)',
     'Advanced scientific calculator with 400+ functions — approved for university exams.',
     1800000, 2100000, 25, 20000, 'Campus Environs', 'Faculty of Science', ARRAY['stationery','calculator','school'], 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=600&auto=format&fit=crop&q=80')
)
INSERT INTO public.marketplace_products (
  vendor_id, category_id, listing_type, slug, title, description,
  condition, price_kobo, compare_at_kobo, is_service, quantity_total,
  status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
  campus_area, meeting_point, tags, thumbnail_path, is_demo, published_at
)
SELECT
  (SELECT id FROM public.marketplace_vendors WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1),
  c.id, 'product'::marketplace_listing_type, d.slug, d.title, d.descr,
  'new'::marketplace_condition, d.price, d.compare, false, d.qty,
  'active'::marketplace_listing_status, 'delivery'::marketplace_delivery_type, true, true, d.delivery_fee,
  d.campus, d.meeting, d.tags, d.image, true, now()
FROM d
JOIN public.marketplace_categories c ON c.slug = d.cat
WHERE EXISTS (SELECT 1 FROM public.marketplace_vendors WHERE handle = 'fuw-student-services')
ON CONFLICT (vendor_id, slug) DO UPDATE SET
  category_id   = EXCLUDED.category_id,
  title         = EXCLUDED.title,
  description   = EXCLUDED.description,
  price_kobo    = EXCLUDED.price_kobo,
  compare_at_kobo = EXCLUDED.compare_at_kobo,
  thumbnail_path = EXCLUDED.thumbnail_path,
  is_demo       = TRUE,
  status        = 'active'::marketplace_listing_status;

-- ---------------------------------------------------------------------------
-- 3. Product images (idempotent on storage_path)
-- ---------------------------------------------------------------------------
WITH d(cat, slug, title, image) AS (
  VALUES
    ('food','party-jollof-rice-dodo-chicken','Party Jollof Rice, Dodo & Grilled Chicken','https://images.unsplash.com/photo-1565299543923-37dd37887442?w=600&auto=format&fit=crop&q=80'),
    ('food','fried-rice-chicken-salad','Fried Rice, Chicken & Coleslaw','https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600&auto=format&fit=crop&q=80'),
    ('food','white-rice-tomato-stew-chicken','White Rice & Tomato Stew with Chicken','https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&auto=format&fit=crop&q=80'),
    ('food','beans-fried-plantain','Beans & Fried Plantain (Ewa & Dodo)','https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=80'),
    ('food','yam-egg-sauce','Boiled Yam & Egg Sauce','https://images.unsplash.com/photo-1512058564366-18510be2db19?w=600&auto=format&fit=crop&q=80'),
    ('food','yam-porridge-asaro','Yam Porridge (Asaro)','https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80'),
    ('food','moi-moi-wrap','Steamed Moi Moi (Bean Pudding)','https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&auto=format&fit=crop&q=80'),
    ('food','akara-pap','Akara & Pap Combo','https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&auto=format&fit=crop&q=80'),
    ('food','ewa-agoyin-agege-bread','Ewa Agoyin & Agege Bread','https://images.unsplash.com/photo-1547592180-85f173990554?w=600&auto=format&fit=crop&q=80'),
    ('food','amala-ewedu-gbegiri','Amala & Ewedu with Gbegiri','https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format&fit=crop&q=80'),
    ('food','eba-egusi-soup','Eba & Egusi Soup','https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=600&auto=format&fit=crop&q=80'),
    ('food','fufu-vegetable-soup','Fufu & Vegetable Soup','https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&auto=format&fit=crop&q=80'),
    ('food','pounded-yam-egusi','Pounded Yam & Egusi Soup','https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&auto=format&fit=crop&q=80'),
    ('food','tuwo-shinkafa-miyan-kuka','Tuwo Shinkafa & Miyan Kuka','https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=600&auto=format&fit=crop&q=80'),
    ('food','beef-suya-wrap','Beef Suya Wrap','https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&auto=format&fit=crop&q=80'),
    ('food','chicken-shawarma','Chicken Shawarma','https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=600&auto=format&fit=crop&q=80'),
    ('food','meat-pie','Nigerian Meat Pie','https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600&auto=format&fit=crop&q=80'),
    ('food','sausage-roll','Sausage Roll','https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=600&auto=format&fit=crop&q=80'),
    ('food','puff-puff-five','Puff-Puff (5 Pieces)','https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&auto=format&fit=crop&q=80'),
    ('food','bread-tea-breakfast','Bread & Tea Breakfast Combo','https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600&auto=format&fit=crop&q=80'),
    ('food','indomie-egg-sauce','Indomie & Egg Sauce','https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=600&auto=format&fit=crop&q=80'),
    ('food','grilled-fish-chips','Grilled Tilapia & Chips','https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=80'),
    ('food','grilled-chicken-quarter','Peppered Grilled Chicken (Quarter)','https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&auto=format&fit=crop&q=80'),
    ('food','ofada-rice-ayamase','Ofada Rice & Ayamase (Green Stew)','https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600&auto=format&fit=crop&q=80'),
    ('clothing','fuw-alumni-cotton-tshirt','FUW Alumni Cotton T-Shirt','https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&auto=format&fit=crop&q=80'),
    ('clothing','slim-fit-denim-jeans','Slim-Fit Denim Jeans','https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&auto=format&fit=crop&q=80'),
    ('clothing','ankara-two-piece-set','Ankara Print Two-Piece Set','https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&auto=format&fit=crop&q=80'),
    ('shoes','canvas-campus-sneakers','Canvas Campus Sneakers','https://images.unsplash.com/photo-1549298916-b41d501d3772?w=600&auto=format&fit=crop&q=80'),
    ('shoes','leather-slide-slippers','Leather Slide Slippers','https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=600&auto=format&fit=crop&q=80'),
    ('beauty-products','shea-butter-body-lotion','Shea Butter Body Lotion 500ml','https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600&auto=format&fit=crop&q=80'),
    ('beauty-products','unisex-long-lasting-perfume','Unisex Long-Lasting Perfume 50ml','https://images.unsplash.com/photo-1608667508764-33cf0726b13a?w=600&auto=format&fit=crop&q=80'),
    ('laptops-electronics','wireless-optical-mouse','Wireless Optical Mouse','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80'),
    ('laptops-electronics','usb-flash-drive-64gb','USB 3.0 Flash Drive 64GB','https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&auto=format&fit=crop&q=80'),
    ('books','gst101-past-questions','GST 101 Past Questions & Answers','https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&auto=format&fit=crop&q=80'),
    ('books','engineering-mathematics-textbook','Fundamentals of Engineering Mathematics','https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80'),
    ('school-materials','hardcover-notebooks-set-5','Hard-Cover Notebooks (Set of 5)','https://images.unsplash.com/photo-1580910051074-3eb694886505?w=600&auto=format&fit=crop&q=80'),
    ('school-materials','scientific-calculator-fx991','Scientific Calculator (FX-991 Class)','https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=600&auto=format&fit=crop&q=80')
)
INSERT INTO public.marketplace_product_images (
  product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
)
SELECT p.id, d.image, d.image, 'image/jpeg', true, 0, d.title
FROM d
JOIN public.marketplace_categories c ON c.slug = d.cat
JOIN public.marketplace_products p
  ON p.slug = d.slug
 AND p.vendor_id = (SELECT id FROM public.marketplace_vendors WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1)
ON CONFLICT (storage_path) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Services (previously-empty service categories)
-- ---------------------------------------------------------------------------
WITH s(cat, slug, title, descr, price, capacity, lead_time, area, campus, meeting, tags, image) AS (
  VALUES
    ('printing', 'document-printing-binding', 'Document Printing & Binding',
     'Black-and-white and colour printing, laminating and spiral binding for assignments and projects.',
     5000::bigint, 200::int, 2::int, 'Campus-wide', 'Campus Environs', 'Main Library Entrance', ARRAY['printing','binding','assignment']::text[], 'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=600&auto=format&fit=crop&q=80'),
    ('printing', 'project-typing-formatting', 'Project & Seminar Typing / Formatting',
     'Professional typing, formatting and typesetting of projects, seminars and term papers to departmental standard.',
     500000, 20, 24, 'Campus-wide', 'Campus Environs', 'Faculty of Science', ARRAY['printing','typing','project'], 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=600&auto=format&fit=crop&q=80'),
    ('graphic-design', 'flyer-poster-design', 'Flyer & Poster Design',
     'Eye-catching event flyers, posters and social banners designed and delivered in 24 hours.',
     500000, 30, 24, 'Campus-wide', 'Campus Environs', 'Faculty of Arts', ARRAY['design','flyer','poster'], 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&auto=format&fit=crop&q=80'),
    ('graphic-design', 'logo-brand-design', 'Logo & Brand Identity Design',
     'Custom logo and brand kit (colours, typography, mockups) for student businesses and societies.',
     1500000, 10, 72, 'Campus-wide', 'Campus Environs', 'Faculty of Arts', ARRAY['design','logo','branding'], 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&auto=format&fit=crop&q=80'),
    ('transportation', 'campus-move-haulage', 'Campus Moving & Haulage',
     'Local moving help for hostel changeovers — van and hands to move your luggage across Wukari.',
     1000000, 8, 48, 'Wukari and environs', 'New Site Hostels', 'Hostel A Gate', ARRAY['transport','moving','haulage'], 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=80'),
    ('repairs', 'phone-screen-replacement', 'Phone Screen Replacement',
     'Screen and battery replacement for common Android and iPhone models, with a short warranty.',
     800000, 15, 24, 'Campus-wide', 'Campus Environs', 'Faculty of Science', ARRAY['repairs','phone','screen'], 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80'),
    ('repairs', 'laptop-diagnostics-repair', 'Laptop Diagnostics & Repair',
     'Diagnostics, OS reinstall, virus cleanup and hardware repairs for student laptops.',
     1000000, 12, 48, 'Campus-wide', 'Campus Environs', 'Faculty of Engineering', ARRAY['repairs','laptop','software'], 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&auto=format&fit=crop&q=80'),
    ('tutoring', 'mth101-private-tutorial', 'MTH 101 Private Tutorial',
     'One-on-one and small-group tutorials for MTH 101 (Elementary Mathematics) with past-question drills.',
     500000, 20, 168, 'Campus-wide', 'Campus Environs', 'Faculty of Science', ARRAY['tutoring','mathematics','mth101'], 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&auto=format&fit=crop&q=80'),
    ('tutoring', 'phy101-private-tutorial', 'PHY 101 Private Tutorial',
     'Conceptual and problem-solving tutorials for PHY 101 (General Physics) ahead of tests and exams.',
     500000, 20, 168, 'Campus-wide', 'Campus Environs', 'Faculty of Science', ARRAY['tutoring','physics','phy101'], 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80'),
    ('accommodation', 'roommate-match-lodge-agent', 'Roommate Matching & Lodge Agent',
     'Guided roommate matching and verified lodge placement service for newly admitted students.',
     200000, 100, 48, 'Wukari and environs', 'Campus Environs', 'Main Gate', ARRAY['accommodation','roommate','lodge'], 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&auto=format&fit=crop&q=80'),
    ('other-services', 'event-ushering-service', 'Event Ushering & Protocol',
     'Trained ushers and protocol support for departmental dinners, conferences and campus events.',
     500000, 40, 72, 'Campus-wide', 'Campus Environs', 'Faculty of Arts', ARRAY['services','event','ushering'], 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&auto=format&fit=crop&q=80'),
    ('other-services', 'campus-errand-runner', 'Campus Errand Runner',
     'Quick errands across campus — document drop-offs, queue-holding and small purchases.',
     100000, 50, 4, 'Campus-wide', 'New Site Hostels', 'Hostel D Gate', ARRAY['services','errand','delivery'], 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&auto=format&fit=crop&q=80')
)
INSERT INTO public.marketplace_products (
  vendor_id, category_id, listing_type, slug, title, description,
  condition, price_kobo, is_service, quantity_total, capacity, lead_time_hours,
  service_area, status, fulfilment, allows_delivery, allows_pickup, delivery_fee_kobo,
  campus_area, meeting_point, tags, thumbnail_path, is_demo, published_at
)
SELECT
  (SELECT id FROM public.marketplace_vendors WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1),
  c.id, 'service'::marketplace_listing_type, s.slug, s.title, s.descr,
  'not_applicable'::marketplace_condition, s.price, true, 0, s.capacity, s.lead_time,
  s.area, 'active'::marketplace_listing_status, 'pickup'::marketplace_delivery_type, false, true, 0,
  s.campus, s.meeting, s.tags, s.image, true, now()
FROM s
JOIN public.marketplace_categories c ON c.slug = s.cat
WHERE EXISTS (SELECT 1 FROM public.marketplace_vendors WHERE handle = 'fuw-student-services')
ON CONFLICT (vendor_id, slug) DO UPDATE SET
  category_id   = EXCLUDED.category_id,
  title         = EXCLUDED.title,
  description   = EXCLUDED.description,
  price_kobo    = EXCLUDED.price_kobo,
  listing_type  = EXCLUDED.listing_type,
  is_service    = TRUE,
  condition     = 'not_applicable'::marketplace_condition,
  thumbnail_path = EXCLUDED.thumbnail_path,
  is_demo       = TRUE,
  status        = 'active'::marketplace_listing_status;

-- Service images (idempotent; reuses a few verified photos)
WITH s(slug, title, image) AS (
  VALUES
    ('document-printing-binding','Document Printing & Binding','https://images.unsplash.com/photo-1580910051074-3eb694886505?w=600&auto=format&fit=crop&q=80'),
    ('project-typing-formatting','Project & Seminar Typing / Formatting','https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=600&auto=format&fit=crop&q=80'),
    ('flyer-poster-design','Flyer & Poster Design','https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&auto=format&fit=crop&q=80'),
    ('logo-brand-design','Logo & Brand Identity Design','https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&auto=format&fit=crop&q=80'),
    ('campus-move-haulage','Campus Moving & Haulage','https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=80'),
    ('phone-screen-replacement','Phone Screen Replacement','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&auto=format&fit=crop&q=80'),
    ('laptop-diagnostics-repair','Laptop Diagnostics & Repair','https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&auto=format&fit=crop&q=80'),
    ('mth101-private-tutorial','MTH 101 Private Tutorial','https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&auto=format&fit=crop&q=80'),
    ('phy101-private-tutorial','PHY 101 Private Tutorial','https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80'),
    ('roommate-match-lodge-agent','Roommate Matching & Lodge Agent','https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&auto=format&fit=crop&q=80'),
    ('event-ushering-service','Event Ushering & Protocol','https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&auto=format&fit=crop&q=80'),
    ('campus-errand-runner','Campus Errand Runner','https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=600&auto=format&fit=crop&q=80')
)
INSERT INTO public.marketplace_product_images (
  product_id, storage_path, url, mime_type, is_primary, sort_order, alt_text
)
SELECT p.id, s.image, s.image, 'image/jpeg', true, 0, s.title
FROM s
JOIN public.marketplace_products p
  ON p.slug = s.slug
 AND p.vendor_id = (SELECT id FROM public.marketplace_vendors WHERE handle = 'fuw-student-services' ORDER BY created_at LIMIT 1)
ON CONFLICT (storage_path) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Backfill thumbnail_path for any freshly-inserted demo product missing one
-- ---------------------------------------------------------------------------
UPDATE public.marketplace_products p
   SET thumbnail_path = img.url,
       updated_at = now()
  FROM public.marketplace_product_images img
 WHERE img.product_id = p.id
   AND img.is_primary = TRUE
   AND p.is_demo = TRUE
   AND (p.thumbnail_path IS NULL OR p.thumbnail_path = '');

COMMIT;
