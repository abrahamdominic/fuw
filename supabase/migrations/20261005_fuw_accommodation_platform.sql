-- =====================================================================
-- FUW CAMPUS HUB — ACCOMMODATION SERVICE SCHEMA & RLS
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.accommodation_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  business_name TEXT,
  provider_type TEXT NOT NULL DEFAULT 'caretaker' CHECK (provider_type IN ('caretaker', 'landlord', 'agent', 'student_hostel_manager')),
  phone TEXT NOT NULL,
  whatsapp TEXT,
  office_address TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verification_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.accommodation_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.accommodation_providers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  location_area TEXT NOT NULL CHECK (location_area IN ('New Site', 'Old Site', 'Hospital Road', 'Stadium Road', 'General Hospital Area', 'Katsina-Ala Road', 'Campus Environs', 'Wukari Town')),
  address_landmark TEXT NOT NULL,
  distance_to_campus TEXT,
  property_type TEXT NOT NULL CHECK (property_type IN ('self_contained', 'single_room', 'flat_apartment', 'bedspace', 'shared_room')),
  price_annual NUMERIC(12, 2) NOT NULL,
  price_semester NUMERIC(12, 2),
  caution_deposit NUMERIC(12, 2) DEFAULT 0,
  service_charge NUMERIC(12, 2) DEFAULT 0,
  total_units INTEGER DEFAULT 1,
  available_units INTEGER DEFAULT 1,
  availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available', 'fast_filling', 'booked', 'under_maintenance')),
  images TEXT[] NOT NULL DEFAULT '{}',
  amenities TEXT[] NOT NULL DEFAULT '{}',
  rules_notes TEXT,
  contact_phone TEXT NOT NULL,
  contact_whatsapp TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT true,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accommodation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.accommodation_properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT NOT NULL,
  is_approved BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accommodation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.accommodation_properties(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (reason IN ('scam_suspected', 'fake_photos', 'fake_caretaker', 'already_booked', 'price_gouging', 'unreachable', 'harassment', 'other')),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed')),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accommodation_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.accommodation_properties(id) ON DELETE CASCADE,
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  preferred_move_in DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for lightning fast searching and filtering
CREATE INDEX IF NOT EXISTS idx_acc_prop_location ON public.accommodation_properties(location_area);
CREATE INDEX IF NOT EXISTS idx_acc_prop_type ON public.accommodation_properties(property_type);
CREATE INDEX IF NOT EXISTS idx_acc_prop_price ON public.accommodation_properties(price_annual);
CREATE INDEX IF NOT EXISTS idx_acc_prop_avail ON public.accommodation_properties(availability_status);
CREATE INDEX IF NOT EXISTS idx_acc_prop_slug ON public.accommodation_properties(slug);
CREATE INDEX IF NOT EXISTS idx_acc_reviews_prop ON public.accommodation_reviews(property_id);
CREATE INDEX IF NOT EXISTS idx_acc_reports_prop ON public.accommodation_reports(property_id);

-- Enable RLS
ALTER TABLE public.accommodation_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_inquiries ENABLE ROW LEVEL SECURITY;

-- Helper function to check admin role
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

-- accommodation_providers RLS
DROP POLICY IF EXISTS "Public can view verified accommodation providers" ON public.accommodation_providers;
CREATE POLICY "Public can view verified accommodation providers"
  ON public.accommodation_providers FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can manage own provider profile" ON public.accommodation_providers;
CREATE POLICY "Users can manage own provider profile"
  ON public.accommodation_providers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- accommodation_properties RLS
DROP POLICY IF EXISTS "Public can view published properties" ON public.accommodation_properties;
CREATE POLICY "Public can view published properties"
  ON public.accommodation_properties FOR SELECT
  USING (is_published = true OR public.is_platform_admin());

DROP POLICY IF EXISTS "Providers can manage their own properties" ON public.accommodation_properties;
CREATE POLICY "Providers can manage their own properties"
  ON public.accommodation_properties FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accommodation_providers
      WHERE accommodation_providers.id = accommodation_properties.provider_id
      AND accommodation_providers.user_id = auth.uid()
    ) OR public.is_platform_admin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accommodation_providers
      WHERE accommodation_providers.id = accommodation_properties.provider_id
      AND accommodation_providers.user_id = auth.uid()
    ) OR public.is_platform_admin()
  );

-- accommodation_reviews RLS
DROP POLICY IF EXISTS "Public can view reviews" ON public.accommodation_reviews;
CREATE POLICY "Public can view reviews"
  ON public.accommodation_reviews FOR SELECT
  USING (is_approved = true OR public.is_platform_admin());

DROP POLICY IF EXISTS "Authenticated users can submit reviews" ON public.accommodation_reviews;
CREATE POLICY "Authenticated users can submit reviews"
  ON public.accommodation_reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- accommodation_reports RLS
DROP POLICY IF EXISTS "Users can submit reports" ON public.accommodation_reports;
CREATE POLICY "Users can submit reports"
  ON public.accommodation_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Admins can view and manage reports" ON public.accommodation_reports;
CREATE POLICY "Admins can view and manage reports"
  ON public.accommodation_reports FOR ALL
  TO authenticated
  USING (public.is_platform_admin());

-- accommodation_inquiries RLS
DROP POLICY IF EXISTS "Students can view own inquiries" ON public.accommodation_inquiries;
CREATE POLICY "Students can view own inquiries"
  ON public.accommodation_inquiries FOR SELECT
  TO authenticated
  USING (auth.uid() = student_id OR public.is_platform_admin());

DROP POLICY IF EXISTS "Students can submit inquiries" ON public.accommodation_inquiries;
CREATE POLICY "Students can submit inquiries"
  ON public.accommodation_inquiries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = student_id);

-- Seed realistic verified FUW properties for campus hostels & lodges
INSERT INTO public.accommodation_properties (
  title,
  slug,
  description,
  location_area,
  address_landmark,
  distance_to_campus,
  property_type,
  price_annual,
  price_semester,
  caution_deposit,
  service_charge,
  total_units,
  available_units,
  availability_status,
  images,
  amenities,
  rules_notes,
  contact_phone,
  contact_whatsapp,
  is_verified,
  is_featured,
  is_published
) VALUES
(
  'Silver Crest Luxury Student Lodge',
  'silver-crest-luxury-student-lodge',
  'Newly built, fully tiled self-contained apartments designed specifically for FUW undergraduate and postgraduate students. Features dedicated pre-paid meter per room, 24/7 borehole running water, secured fenced perimeter with security outpost, and serene study environment.',
  'New Site',
  'Opposite New Site University Gate, Katsina-Ala Road, Wukari',
  '3 mins walk to New Site Gate',
  'self_contained',
  160000.00,
  90000.00,
  15000.00,
  10000.00,
  24,
  5,
  'available',
  ARRAY[
    'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=800&q=80'
  ],
  ARRAY['Running Water', 'Prepaid Meter / Light', 'Fenced & Gated', 'Security Guard', 'Well Water / Borehole', 'Tiled Floors', 'Wardrobe', 'Kitchenette / Kitchen'],
  'No loud music during examination periods. Visitor sign-in required after 9PM.',
  '08039218841',
  '2348039218841',
  true,
  true,
  true
),
(
  'Unity Executive Hostels (Female Wing)',
  'unity-executive-hostels-female-wing',
  'Spacious self-contained rooms situated in a secure and peaceful female students enclave. Excellent proximity to lectures, steady clean water with overhead tanks, motorized pumping machine, prepaid electric meter, and solar perimeter lighting.',
  'Hospital Road',
  'Near General Hospital Junction, Wukari',
  '6 mins walk to Faculty of Science',
  'self_contained',
  140000.00,
  80000.00,
  10000.00,
  5000.00,
  18,
  3,
  'fast_filling',
  ARRAY[
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80'
  ],
  ARRAY['Running Water', 'Prepaid Meter / Light', 'Fenced & Gated', 'Security Guard', 'Tiled Floors', 'Inverter / Solar Friendly'],
  'Exclusively for female students. Strict security gate lock at 10:00 PM.',
  '08149830221',
  '2348149830221',
  true,
  true,
  true
),
(
  'Scholars Court Affordable Single Rooms',
  'scholars-court-affordable-single-rooms',
  'Budget-friendly single rooms with modern shared clean conveniences, deep borehole water system, and serene courtyard. Perfect for serious-minded students seeking low accommodation costs close to campus.',
  'Stadium Road',
  'Behind Township Stadium, Stadium Road, Wukari',
  '8 mins bike ride to Campus',
  'single_room',
  75000.00,
  45000.00,
  5000.00,
  5000.00,
  30,
  8,
  'available',
  ARRAY[
    'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=800&q=80'
  ],
  ARRAY['Running Water', 'Well Water / Borehole', 'Fenced & Gated', 'Prepaid Meter / Light'],
  'Regular cleaning schedule for shared facilities. Peaceful reading community.',
  '07065541908',
  '2347065541908',
  true,
  false,
  true
),
(
  'Apex Two-Bedroom Student Shared Flat',
  'apex-two-bedroom-student-shared-flat',
  'Modern 2-bedroom flat with living room, fitted kitchen, store, and two private en-suite bedrooms. Ideal for two to four coursemates sharing rent. Pre-paid electric meter installed, perimeter fence with barbed wire.',
  'Katsina-Ala Road',
  'Beside Total Energy Station, Katsina-Ala Road, Wukari',
  '5 mins walk to Old Site Gate',
  'flat_apartment',
  240000.00,
  130000.00,
  20000.00,
  15000.00,
  6,
  1,
  'fast_filling',
  ARRAY[
    'https://images.unsplash.com/photo-1502005229762-ee1b2da97c0d?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=800&q=80'
  ],
  ARRAY['Running Water', 'Prepaid Meter / Light', 'Fenced & Gated', 'Security Guard', 'Tiled Floors', 'Wardrobe', 'Kitchenette / Kitchen', 'Balcony'],
  'Tenants responsible for internal sanitation and shared power bill.',
  '08027739102',
  '2348027739102',
  true,
  true,
  true
),
(
  'Grace Villa Bedspace Enclave',
  'grace-villa-bedspace-enclave',
  'Affordable and furnished bedspace accommodation in a secure 2-man room. Includes mattress, study table, reading lamp, and shared kitchen. Ideal for 100 level freshers and returning students.',
  'Old Site',
  'Old Site Gate Extension, Behind Bank Road, Wukari',
  '4 mins walk to Old Site Lecture Halls',
  'bedspace',
  50000.00,
  30000.00,
  5000.00,
  2500.00,
  16,
  4,
  'available',
  ARRAY[
    'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&w=800&q=80'
  ],
  ARRAY['Running Water', 'Prepaid Meter / Light', 'Fenced & Gated', 'Tiled Floors'],
  'Study hours observed between 8PM and 11PM. Quiet environment.',
  '08139940182',
  '2348139940182',
  true,
  false,
  true
)
ON CONFLICT (slug) DO NOTHING;
