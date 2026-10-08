-- =============================================================================
-- Migration: Vendor Verification Evidence Admin Read & Deep Links
-- Date: 2026-10-07
-- Purpose:
--   1. Grant marketplace staff SELECT on `marketplace-vendor-assets` objects so
--      verification evidence (stored under `<vendor>/verification/`) can be
--      reviewed from the Marketplace Admin Portal. Write/update/delete stays
--      with the owning vendor ("Vendor owns assets" policy).
--   2. Fix the notifications emitted by `mp_request_vendor_verification`: they
--      pointed platform admins at `/admin`, which has no vendor-verification
--      queue. They now deep-link staff straight to
--      `/marketplace/admin?tab=verifications`, and target the marketplace staff
--      table (`marketplace_admin_staff`) instead of the platform role column.
-- =============================================================================

-- 1. Marketplace staff may read vendor assets (SELECT only)
DROP POLICY IF EXISTS "Marketplace staff may read vendor assets" ON storage.objects;
CREATE POLICY "Marketplace staff may read vendor assets" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'marketplace-vendor-assets'
    AND public.mp_is_staff()
  );

-- 2. Re-vendor `mp_request_vendor_verification` with corrected audience + links
CREATE OR REPLACE FUNCTION public.mp_request_vendor_verification(p_note TEXT, p_evidence_path TEXT DEFAULT NULL::TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vendor public.marketplace_vendors%ROWTYPE;
  v_req public.marketplace_vendor_verifications%ROWTYPE;
BEGIN
  SELECT * INTO v_vendor FROM public.marketplace_vendors
   WHERE owner_id = auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have a storefront' USING ERRCODE = 'P0002';
  END IF;
  IF v_vendor.verification = 'pending' THEN
    RAISE EXCEPTION 'Your verification request is already being reviewed' USING ERRCODE = '55000';
  END IF;
  IF char_length(trim(COALESCE(p_note, ''))) < 20 THEN
    RAISE EXCEPTION 'Tell the review team about your business in at least 20 characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_evidence_path IS NOT NULL AND p_evidence_path NOT LIKE v_vendor.id::TEXT || '/verification/%' THEN
    RAISE EXCEPTION 'Evidence must be uploaded to your storefront verification folder'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.marketplace_vendor_verifications
    (vendor_id, requested_by, note, evidence_path, status)
  VALUES (v_vendor.id, auth.uid(), trim(p_note), p_evidence_path, 'pending')
  RETURNING * INTO v_req;

  UPDATE public.marketplace_vendors SET verification = 'pending' WHERE id = v_vendor.id;

  -- Notify marketplace staff in the main E-Library notifications feed
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT s.user_id,
         'Vendor Verification Application',
         v_vendor.shop_name || ' has applied for a verified badge: ' || left(p_note, 120),
         'verification_submitted',
         '/marketplace/admin?tab=verifications'
    FROM public.marketplace_admin_staff s
   WHERE s.revoked_at IS NULL AND s.is_active;

  -- Notify marketplace staff in the marketplace notifications feed
  INSERT INTO public.marketplace_notifications (user_id, type, title, message, link, entity_type, entity_id)
  SELECT s.user_id,
         'announcement',
         'Vendor Verification Application',
         v_vendor.shop_name || ' has applied for a verified badge: ' || left(p_note, 120),
         '/marketplace/admin?tab=verifications',
         'vendor',
         v_vendor.id
    FROM public.marketplace_admin_staff s
   WHERE s.revoked_at IS NULL AND s.is_active;

  PERFORM public.mp_audit('vendor.verification_requested', 'vendor', v_vendor.id, NULL,
    jsonb_build_object('request_id', v_req.id), NULL, 'vendor');

  RETURN jsonb_build_object('id', v_req.id, 'status', 'pending');
END $function$;

-- Keep the RPC executable by authenticated users
GRANT EXECUTE ON FUNCTION public.mp_request_vendor_verification(TEXT, TEXT) TO authenticated;