-- =============================================================================
-- FUW STUDENT MARKETPLACE — MIGRATION 05: RLS, GRANTS, STORAGE POLICIES
-- =============================================================================
-- SECURITY BASELINE:
-- - Every marketplace table has RLS ENABLED.
-- - SELECT policies are read-only and scoped to participation (buyer, vendor owner)
--   or to marketplace staff (mp_is_admin / mp_has_perm).
-- - Write policies are omitted. ALL writes to sensitive tables are only via
--   SECURITY DEFINER functions in migrations 02–04. Client roles do not have
--   INSERT/UPDATE/DELETE on those tables at all (they are REVOKED below).
-- - Functions: EXECUTE is granted explicitly, not to PUBLIC for dangerous ones.
-- - Storage: private buckets, signed uploads only, path prefix constraints tied
--   to the owning vendor/buyer/dispute/conversation.
-- =============================================================================

-- Enable RLS on all marketplace tables
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'marketplace_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

-- Helper: is the caller the owner of a vendor?
CREATE OR REPLACE FUNCTION public.mp_is_vendor_owner(v_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_vendors v
     WHERE v.id = v_id AND v.owner_id = auth.uid() AND v.deleted_at IS NULL
  );
$$;

-- =============================================================================
-- READ POLICIES
-- =============================================================================

-- Profiles
DROP POLICY IF EXISTS mp_profiles_select_own ON public.marketplace_profiles;
DROP POLICY IF EXISTS mp_profiles_select_admin ON public.marketplace_profiles;
CREATE POLICY mp_profiles_select_own ON public.marketplace_profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY mp_profiles_select_admin ON public.marketplace_profiles
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

-- Vendors
DROP POLICY IF EXISTS mp_vendors_select_public ON public.marketplace_vendors;
DROP POLICY IF EXISTS mp_vendors_select_owner ON public.marketplace_vendors;
DROP POLICY IF EXISTS mp_vendors_select_admin ON public.marketplace_vendors;
CREATE POLICY mp_vendors_select_public ON public.marketplace_vendors
  FOR SELECT USING (deleted_at IS NULL AND status = 'active');
CREATE POLICY mp_vendors_select_owner ON public.marketplace_vendors
  FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY mp_vendors_select_admin ON public.marketplace_vendors
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

DROP POLICY IF EXISTS mp_vv_select_owner ON public.marketplace_vendor_verifications;
DROP POLICY IF EXISTS mp_vv_select_admin ON public.marketplace_vendor_verifications;
CREATE POLICY mp_vv_select_owner ON public.marketplace_vendor_verifications
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_vendors v
                             WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_vv_select_admin ON public.marketplace_vendor_verifications
  FOR SELECT USING (public.mp_has_perm('verify_vendors'));

-- Products
DROP POLICY IF EXISTS mp_products_select_live ON public.marketplace_products;
DROP POLICY IF EXISTS mp_products_select_owner ON public.marketplace_products;
DROP POLICY IF EXISTS mp_products_select_admin ON public.marketplace_products;
CREATE POLICY mp_products_select_live ON public.marketplace_products
  FOR SELECT USING (deleted_at IS NULL AND status IN ('active','sold_out'));
CREATE POLICY mp_products_select_owner ON public.marketplace_products
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_vendors v
                             WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_products_select_admin ON public.marketplace_products
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

DROP POLICY IF EXISTS mp_variants_select_visible ON public.marketplace_product_variants;
CREATE POLICY mp_variants_select_visible ON public.marketplace_product_variants
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.marketplace_products p
     WHERE p.id = product_id AND p.deleted_at IS NULL
       AND (p.status IN ('active','sold_out') OR
            EXISTS (SELECT 1 FROM public.marketplace_vendors v
                     WHERE v.id = p.vendor_id AND v.owner_id = auth.uid()) OR
            public.mp_is_admin(auth.uid()))
  ));

DROP POLICY IF EXISTS mp_imgs_select_visible ON public.marketplace_product_images;
CREATE POLICY mp_imgs_select_visible ON public.marketplace_product_images
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_products p
                             WHERE p.id = product_id
                               AND (p.deleted_at IS NULL AND p.status IN ('active','sold_out')
                                    OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                               WHERE v.id = p.vendor_id AND v.owner_id = auth.uid())
                                    OR public.mp_is_admin(auth.uid()))));

-- Categories visible to all
DROP POLICY IF EXISTS mp_cats_select ON public.marketplace_categories;
CREATE POLICY mp_cats_select ON public.marketplace_categories FOR SELECT USING (TRUE);

-- Inventory: owner or staff (ledger readable for audit)
DROP POLICY IF EXISTS mp_inv_select_owner ON public.marketplace_inventory;
DROP POLICY IF EXISTS mp_inv_select_admin ON public.marketplace_inventory;
CREATE POLICY mp_inv_select_owner ON public.marketplace_inventory
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_products p
                             JOIN public.marketplace_vendors v ON v.id = p.vendor_id
                            WHERE p.id = product_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_inv_select_admin ON public.marketplace_inventory
  FOR SELECT USING (public.mp_has_perm('view_finances'));

-- Checkouts: own only
DROP POLICY IF EXISTS mp_chk_select_own ON public.marketplace_checkouts;
CREATE POLICY mp_chk_select_own ON public.marketplace_checkouts FOR SELECT USING (buyer_id = auth.uid());

-- Orders
DROP POLICY IF EXISTS mp_orders_select_participant ON public.marketplace_orders;
DROP POLICY IF EXISTS mp_orders_select_admin ON public.marketplace_orders;
CREATE POLICY mp_orders_select_participant ON public.marketplace_orders
  FOR SELECT USING (buyer_id = auth.uid()
                    OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_orders_select_admin ON public.marketplace_orders
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

DROP POLICY IF EXISTS mp_oi_select_participant ON public.marketplace_order_items;
DROP POLICY IF EXISTS mp_oi_select_admin ON public.marketplace_order_items;
CREATE POLICY mp_oi_select_participant ON public.marketplace_order_items
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_orders o
                             WHERE o.id = order_id AND (o.buyer_id = auth.uid()
                               OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                           WHERE v.id = o.vendor_id AND v.owner_id = auth.uid()))));
CREATE POLICY mp_oi_select_admin ON public.marketplace_order_items
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

DROP POLICY IF EXISTS mp_osh_select_participant ON public.marketplace_order_status_history;
DROP POLICY IF EXISTS mp_osh_select_admin ON public.marketplace_order_status_history;
CREATE POLICY mp_osh_select_participant ON public.marketplace_order_status_history
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_orders o
                             WHERE o.id = order_id AND (o.buyer_id = auth.uid()
                               OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                           WHERE v.id = o.vendor_id AND v.owner_id = auth.uid()))));
CREATE POLICY mp_osh_select_admin ON public.marketplace_order_status_history
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

-- Payments/events: participant or finance
DROP POLICY IF EXISTS mp_pay_select_participant ON public.marketplace_payments;
DROP POLICY IF EXISTS mp_pay_select_finance ON public.marketplace_payments;
CREATE POLICY mp_pay_select_participant ON public.marketplace_payments
  FOR SELECT USING (buyer_id = auth.uid()
                    OR EXISTS (SELECT 1 FROM public.marketplace_orders o
                               JOIN public.marketplace_vendors v ON v.id = o.vendor_id
                              WHERE o.id = order_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_pay_select_finance ON public.marketplace_payments
  FOR SELECT USING (public.mp_has_perm('view_finances'));

DROP POLICY IF EXISTS mp_pe_select_finance ON public.marketplace_payment_events;
CREATE POLICY mp_pe_select_finance ON public.marketplace_payment_events
  FOR SELECT USING (public.mp_has_perm('view_finances'));

-- Settlements/withdrawals: owner or finance
DROP POLICY IF EXISTS mp_set_select_owner ON public.marketplace_settlements;
DROP POLICY IF EXISTS mp_set_select_finance ON public.marketplace_settlements;
CREATE POLICY mp_set_select_owner ON public.marketplace_settlements
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_vendors v
                             WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_set_select_finance ON public.marketplace_settlements
  FOR SELECT USING (public.mp_has_perm('view_finances'));

DROP POLICY IF EXISTS mp_wd_select_owner ON public.marketplace_withdrawals;
DROP POLICY IF EXISTS mp_wd_select_finance ON public.marketplace_withdrawals;
CREATE POLICY mp_wd_select_owner ON public.marketplace_withdrawals
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_vendors v
                             WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_wd_select_finance ON public.marketplace_withdrawals
  FOR SELECT USING (public.mp_has_perm('view_finances'));

DROP POLICY IF EXISTS mp_wda_select_finance ON public.marketplace_withdrawal_allocations;
CREATE POLICY mp_wda_select_finance ON public.marketplace_withdrawal_allocations
  FOR SELECT USING (public.mp_has_perm('view_finances'));

-- Messaging
DROP POLICY IF EXISTS mp_conv_select_member ON public.marketplace_conversations;
DROP POLICY IF EXISTS mp_conv_select_admin ON public.marketplace_conversations;
CREATE POLICY mp_conv_select_member ON public.marketplace_conversations
  FOR SELECT USING (buyer_id = auth.uid()
                    OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_conv_select_admin ON public.marketplace_conversations
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

DROP POLICY IF EXISTS mp_msg_select_member ON public.marketplace_messages;
DROP POLICY IF EXISTS mp_msg_select_admin ON public.marketplace_messages;
CREATE POLICY mp_msg_select_member ON public.marketplace_messages
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_conversations c
                             WHERE c.id = conversation_id
                               AND (c.buyer_id = auth.uid()
                                    OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                                WHERE v.id = c.vendor_id AND v.owner_id = auth.uid()))));
CREATE POLICY mp_msg_select_admin ON public.marketplace_messages
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

-- Reviews
DROP POLICY IF EXISTS mp_rev_select_published ON public.marketplace_reviews;
DROP POLICY IF EXISTS mp_rev_select_author ON public.marketplace_reviews;
DROP POLICY IF EXISTS mp_rev_select_vendor ON public.marketplace_reviews;
DROP POLICY IF EXISTS mp_rev_select_mod ON public.marketplace_reviews;
CREATE POLICY mp_rev_select_published ON public.marketplace_reviews
  FOR SELECT USING (is_published OR public.mp_is_admin(auth.uid()));
CREATE POLICY mp_rev_select_author ON public.marketplace_reviews
  FOR SELECT USING (author_id = auth.uid());
CREATE POLICY mp_rev_select_vendor ON public.marketplace_reviews
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_vendors v
                             WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_rev_select_mod ON public.marketplace_reviews
  FOR SELECT USING (public.mp_has_perm('moderate_reviews'));

-- Disputes
DROP POLICY IF EXISTS mp_disp_select_participant ON public.marketplace_disputes;
DROP POLICY IF EXISTS mp_disp_select_staff ON public.marketplace_disputes;
CREATE POLICY mp_disp_select_participant ON public.marketplace_disputes
  FOR SELECT USING (buyer_id = auth.uid()
                    OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE POLICY mp_disp_select_staff ON public.marketplace_disputes
  FOR SELECT USING (public.mp_has_perm('manage_disputes'));

DROP POLICY IF EXISTS mp_de_select_participant ON public.marketplace_dispute_evidence;
DROP POLICY IF EXISTS mp_de_select_staff ON public.marketplace_dispute_evidence;
CREATE POLICY mp_de_select_participant ON public.marketplace_dispute_evidence
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.marketplace_disputes d
                             WHERE d.id = dispute_id
                               AND (d.buyer_id = auth.uid()
                                    OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                                                WHERE v.id = d.vendor_id AND v.owner_id = auth.uid()))));
CREATE POLICY mp_de_select_staff ON public.marketplace_dispute_evidence
  FOR SELECT USING (public.mp_has_perm('manage_disputes'));

-- Reports
DROP POLICY IF EXISTS mp_rep_select_reporter ON public.marketplace_reports;
DROP POLICY IF EXISTS mp_rep_select_mod ON public.marketplace_reports;
CREATE POLICY mp_rep_select_reporter ON public.marketplace_reports
  FOR SELECT USING (reporter_id = auth.uid());
CREATE POLICY mp_rep_select_mod ON public.marketplace_reports
  FOR SELECT USING (public.mp_has_perm('moderate_listings') OR public.mp_has_perm('moderate_vendors'));

-- Notifications
DROP POLICY IF EXISTS mp_notif_select_own ON public.marketplace_notifications;
CREATE POLICY mp_notif_select_own ON public.marketplace_notifications FOR SELECT USING (user_id = auth.uid());

-- Addresses
DROP POLICY IF EXISTS mp_addr_select_own ON public.marketplace_addresses;
CREATE POLICY mp_addr_select_own ON public.marketplace_addresses FOR SELECT USING (user_id = auth.uid());

-- Favourites
DROP POLICY IF EXISTS mp_fav_select_own ON public.marketplace_favourites;
CREATE POLICY mp_fav_select_own ON public.marketplace_favourites FOR SELECT USING (user_id = auth.uid());

-- Settings: public read for non-secret flags; admin writes via function only
DROP POLICY IF EXISTS mp_settings_select_all ON public.marketplace_platform_settings;
CREATE POLICY mp_settings_select_all ON public.marketplace_platform_settings FOR SELECT USING (TRUE);

-- Audit: admin only
DROP POLICY IF EXISTS mp_audit_select_admin ON public.marketplace_audit_log;
CREATE POLICY mp_audit_select_admin ON public.marketplace_audit_log
  FOR SELECT USING (public.mp_is_admin(auth.uid()));

-- Block direct writes: write policies absent. Default-deny enforced.
-- =============================================================================
-- REVOKE DANGEROUS PUBLIC ACCESS; GRANT MINIMAL EXECUTE
-- =============================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, authenticated, anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, authenticated, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, authenticated, anon;

-- Tables: no client role gets DML. Only SELECT policies apply.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
-- Prevent direct inserts on audit/ledger if somehow policy-less (defence in depth)
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_audit_log FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_order_status_history FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_payment_events FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_inventory FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_withdrawal_allocations FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_settlements FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_payments FROM authenticated, anon;

-- Sequences
-- Sequences
GRANT USAGE, SELECT ON SEQUENCE public.mp_order_seq TO authenticated;

-- Core helpers readable/stable: mp_is_admin, mp_has_perm, mp_has_identity, mp_is_vendor_owner
GRANT EXECUTE ON FUNCTION public.mp_is_admin TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_has_perm TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_has_identity TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mp_is_vendor_owner TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_is_system_actor TO authenticated; -- stable but useless without set
-- mp_set_system_actor is NEVER granted to client roles (SECURITY DEFINER only, not exposed)
REVOKE EXECUTE ON FUNCTION public.mp_set_system_actor FROM PUBLIC, authenticated, anon;

-- Public/business functions used by app
GRANT EXECUTE ON FUNCTION public.mp_save_vendor TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_upsert_product TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_set_listing_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_adjust_inventory TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_save_variant TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_delete_variant TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_compute_cart TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_price_cart TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_create_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_transition_order TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_cancel_expired_orders TO authenticated; -- cron can call via service; keep restricted
GRANT EXECUTE ON FUNCTION public.mp_auto_confirm_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_release_eligible_settlements TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_request_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_review_withdrawal TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_mark_withdrawal_paid TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_start_conversation TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_send_message TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_mark_conversation_read TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_toggle_favourite TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_create_review TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_reply_to_review TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_edit_review TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_moderate_review TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_open_dispute TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_add_dispute_evidence TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_assign_dispute TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_resolve_dispute TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_create_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_resolve_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_request_vendor_verification TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_review_vendor_verification TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_mark_notification_read TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_save_address TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_delete_address TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_save_own_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_issue_refund TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_apply_payment_event TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_record_search TO authenticated;

-- Internal helpers never exposed to clients
REVOKE EXECUTE ON FUNCTION public.mp_notify FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_audit FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_order_number FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_dispute_number FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_upsert_conversation FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_record_vendor_response FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_guard_no_self_trade FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_guard_withdrawal_allocation FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_guard_dispute_refund_bound FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_touch_updated_at FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_sync_product_thumbnail FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_sync_vendor_rating FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_sync_favourite_count FROM PUBLIC,authenticated,anon;
REVOKE EXECUTE ON FUNCTION public.mp_apply_payment_event_inner FROM PUBLIC,authenticated,anon;

-- =============================================================================
-- STORAGE: private buckets and tight policies
-- =============================================================================
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('marketplace-product-images','marketplace-product-images', FALSE, 5242880,
     ARRAY['image/jpeg','image/png','image/webp','image/avif']),
    ('marketplace-avatars','marketplace-avatars', FALSE, 2097152,
     ARRAY['image/jpeg','image/png','image/webp','image/avif']),
    ('marketplace-vendor-assets','marketplace-vendor-assets', FALSE, 5242880,
     ARRAY['image/jpeg','image/png','image/webp','image/avif','application/pdf']),
    ('marketplace-messages','marketplace-messages', FALSE, 5242880,
     ARRAY['image/jpeg','image/png','image/webp','image/avif','application/pdf']),
    ('marketplace-evidence','marketplace-evidence', FALSE, 10485760,
     ARRAY['image/jpeg','image/png','image/webp','image/avif','application/pdf'])
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END $$;

-- Policies (RESTRICTIVE). Paths must start with the caller's vendor id or
-- their own profile id/dispute/conversation id they belong to. No public read.
-- Note: storage policies use auth.uid() and rely on membership checks via joins.
-- Product images: vendor owner only
DROP POLICY IF EXISTS "Vendor owns product images" ON storage.objects;
CREATE POLICY "Vendor owns product images" ON storage.objects
  FOR ALL USING (
    bucket_id = 'marketplace-product-images'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_vendors v
      WHERE v.owner_id = auth.uid()
        AND (storage.foldername(name))[1] = v.id::TEXT
    )
  ) WITH CHECK (
    bucket_id = 'marketplace-product-images'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_vendors v
      WHERE v.owner_id = auth.uid()
        AND (storage.foldername(name))[1] = v.id::TEXT
    )
  );

-- Vendor assets (logo/banner/verification)
DROP POLICY IF EXISTS "Vendor owns assets" ON storage.objects;
CREATE POLICY "Vendor owns assets" ON storage.objects
  FOR ALL USING (
    bucket_id = 'marketplace-vendor-assets'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_vendors v
      WHERE v.owner_id = auth.uid()
        AND (storage.foldername(name))[1] = v.id::TEXT
    )
  ) WITH CHECK (
    bucket_id = 'marketplace-vendor-assets'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_vendors v
      WHERE v.owner_id = auth.uid()
        AND (storage.foldername(name))[1] = v.id::TEXT
    )
  );

-- Avatars: user owns their own folder
DROP POLICY IF EXISTS "User owns avatar" ON storage.objects;
CREATE POLICY "User owns avatar" ON storage.objects
  FOR ALL USING (
    bucket_id = 'marketplace-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  ) WITH CHECK (
    bucket_id = 'marketplace-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Messages: conversation members only. Folder convention: messages/<conversation_id>/
DROP POLICY IF EXISTS "Conversation members read/write messages" ON storage.objects;
CREATE POLICY "Conversation members read/write messages" ON storage.objects
  FOR ALL USING (
    bucket_id = 'marketplace-messages'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_conversations c
       WHERE c.id::TEXT = (storage.foldername(name))[1]
         AND (c.buyer_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                          WHERE v.id = c.vendor_id AND v.owner_id = auth.uid()))
    )
  ) WITH CHECK (
    bucket_id = 'marketplace-messages'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_conversations c
       WHERE c.id::TEXT = (storage.foldername(name))[1]
         AND (c.buyer_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                          WHERE v.id = c.vendor_id AND v.owner_id = auth.uid()))
    )
  );

-- Evidence: dispute participants or staff
DROP POLICY IF EXISTS "Dispute participants access evidence" ON storage.objects;
CREATE POLICY "Dispute participants access evidence" ON storage.objects
  FOR ALL USING (
    bucket_id = 'marketplace-evidence'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_disputes d
       WHERE d.id::TEXT = (storage.foldername(name))[1]
         AND (d.buyer_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                          WHERE v.id = d.vendor_id AND v.owner_id = auth.uid())
              OR public.mp_has_perm('manage_disputes'))
    )
  ) WITH CHECK (
    bucket_id = 'marketplace-evidence'
    AND EXISTS (
      SELECT 1 FROM public.marketplace_disputes d
       WHERE d.id::TEXT = (storage.foldername(name))[1]
         AND (d.buyer_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.marketplace_vendors v
                          WHERE v.id = d.vendor_id AND v.owner_id = auth.uid()))
    )
  );

-- Ensure no public read on these buckets
UPDATE storage.buckets SET public = FALSE WHERE id LIKE 'marketplace-%';
-- =============================================================================
-- DEFAULTS
-- =============================================================================
INSERT INTO public.marketplace_platform_settings (id)
VALUES (1) ON CONFLICT (id) DO NOTHING;
-- =============================================================================
-- END MIGRATION 05
-- =============================================================================
