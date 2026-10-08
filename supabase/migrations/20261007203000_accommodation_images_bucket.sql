-- Accommodation images storage bucket and admin RLS policies
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('accommodation-images', 'accommodation-images', TRUE, 5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END $$;

DROP POLICY IF EXISTS "Admins can upload accommodation images" ON storage.objects;
CREATE POLICY "Admins can upload accommodation images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'accommodation-images'
    AND is_admin()
  );

DROP POLICY IF EXISTS "Admins can update accommodation images" ON storage.objects;
CREATE POLICY "Admins can update accommodation images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'accommodation-images'
    AND is_admin()
  );

DROP POLICY IF EXISTS "Admins can delete accommodation images" ON storage.objects;
CREATE POLICY "Admins can delete accommodation images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'accommodation-images'
    AND is_admin()
  );

DROP POLICY IF EXISTS "Public can view accommodation images" ON storage.objects;
CREATE POLICY "Public can view accommodation images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'accommodation-images'
  );
