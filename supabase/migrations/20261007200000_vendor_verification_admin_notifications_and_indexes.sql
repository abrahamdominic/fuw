-- =============================================================================
-- Migration: Vendor Verification Admin Notifications & Foreign Key Indexes
-- Date: 2026-10-07
-- Purpose:
--   1. Notify all administrators when a vendor submits a store verification request.
--   2. Add targeted performance indexes on unindexed foreign keys and frequently filtered columns.
-- =============================================================================

-- 1. Update mp_request_vendor_verification to notify admins upon submission
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

  -- Notify administrators in main notifications feed
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT p.id,
         'Vendor Verification Application',
         v_vendor.shop_name || ' has applied for a verified badge: ' || left(p_note, 120),
         'verification_submitted',
         '/admin'
    FROM public.profiles p
   WHERE p.role IN ('admin', 'super_admin');

  -- Notify administrators in marketplace notifications feed
  INSERT INTO public.marketplace_notifications (user_id, type, title, message, link, entity_type, entity_id)
  SELECT p.id,
         'announcement',
         'Vendor Verification Application',
         v_vendor.shop_name || ' has applied for a verified badge: ' || left(p_note, 120),
         '/admin',
         'vendor',
         v_vendor.id
    FROM public.profiles p
   WHERE p.role IN ('admin', 'super_admin');

  PERFORM public.mp_audit('vendor.verification_requested', 'vendor', v_vendor.id, NULL,
    jsonb_build_object('request_id', v_req.id), NULL, 'vendor');

  RETURN jsonb_build_object('id', v_req.id, 'status', 'pending');
END $function$;

-- 2. Performance indexes for high-concurrency scaling
CREATE INDEX IF NOT EXISTS idx_wallet_funding_tx_wallet_id
  ON public.wallet_funding_transactions (wallet_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_products_subcat
  ON public.marketplace_products (subcategory_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_order
  ON public.marketplace_reviews (order_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_escrows_settlement
  ON public.marketplace_escrows (settlement_id);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection
  ON public.collection_items (collection_id);

CREATE INDEX IF NOT EXISTS idx_collection_items_material
  ON public.collection_items (material_id);

CREATE INDEX IF NOT EXISTS idx_copyright_reports_material
  ON public.copyright_reports (material_id);

CREATE INDEX IF NOT EXISTS idx_reading_list_items_research
  ON public.reading_list_items (research_item_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer_status
  ON public.marketplace_orders (buyer_id, status);

CREATE INDEX IF NOT EXISTS idx_marketplace_orders_vendor_status
  ON public.marketplace_orders (vendor_id, status);

CREATE INDEX IF NOT EXISTS idx_roommate_requests_status_created
  ON public.roommate_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id) WHERE (is_read = FALSE);
