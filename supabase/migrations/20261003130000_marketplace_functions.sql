-- =============================================================================
-- FUW STUDENT MARKETPLACE — MIGRATION 02: BUSINESS LOGIC
-- =============================================================================
-- Every privileged write in the marketplace goes through a SECURITY DEFINER
-- function in this file. Design rules enforced here, not in the client:
--
--   1. IDENTITY     — the acting user is always auth.uid(). There is no
--                     parameter anywhere that accepts a user id, an owner id,
--                     a vendor owner, or an admin flag.
--   2. MONEY        — no function accepts a price, a fee, a total or a
--                     commission. Amounts are computed from the catalogue and
--                     marketplace_platform_settings inside the transaction.
--   3. STOCK        — inventory is mutated only by functions that hold a
--                     SELECT ... FOR UPDATE row lock, so concurrent checkouts
--                     serialise instead of overselling.
--   4. STATE        — order status changes only via mp_transition_order(),
--                     which consults the marketplace_order_transitions matrix
--                     and records an audit row. Direct UPDATEs are impossible.
--   5. IMMUTABILITY — payment events, inventory ledger rows, order status
--                     history and the audit log have no UPDATE/DELETE policy
--                     for any role.
-- =============================================================================

-- =============================================================================
-- ORDER STATE MACHINE DEFINITION
-- =============================================================================
-- The lifecycle is data, not code, so it can be audited, shown to staff, and
-- extended without touching the transition function.
--
--   pending_payment → paid → order_confirmed → preparing
--                   → ready_for_delivery → delivered → completed
--   any active state → cancelled | disputed → refunded
--
-- Deliberate asymmetry: a BUYER may cancel only before any money has moved
-- (pending_payment). Once the buyer has paid, their remedy is a dispute, which
-- freezes settlement and routes a human decision. A VENDOR may cancel a paid
-- order (stock gone, cannot fulfil), which flags finance to refund. Neither
-- side can mark an order delivered, completed, refunded or disputed-resolved
-- for the other.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.marketplace_order_transitions (
  from_status   public.marketplace_order_status NOT NULL,
  to_status     public.marketplace_order_status NOT NULL,
  actor_role    TEXT NOT NULL CHECK (actor_role IN ('buyer','vendor','admin','system','any')),
  -- Side-effect flags applied by mp_transition_order().
  releases_stock     BOOLEAN NOT NULL DEFAULT FALSE,
  requires_payment   BOOLEAN NOT NULL DEFAULT FALSE,
  marks_paid         BOOLEAN NOT NULL DEFAULT FALSE,
  marks_completed    BOOLEAN NOT NULL DEFAULT FALSE,
  marks_delivered    BOOLEAN NOT NULL DEFAULT FALSE,
  marks_refunded     BOOLEAN NOT NULL DEFAULT FALSE,
  creates_settlement BOOLEAN NOT NULL DEFAULT FALSE,
  holds_settlement   BOOLEAN NOT NULL DEFAULT FALSE,
  notify             TEXT[] NOT NULL DEFAULT '{}',
  description   TEXT,
  CONSTRAINT uq_mp_transition UNIQUE (from_status, to_status, actor_role),
  CONSTRAINT mp_transition_not_self CHECK (from_status <> to_status)
);

ALTER TABLE public.marketplace_order_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_order_transitions FORCE ROW LEVEL SECURITY;

-- Reference data: readable by everyone so the client can render the correct
-- progress stepper and disable invalid actions. Writable by nobody but postgres.
CREATE POLICY mp_transitions_read ON public.marketplace_order_transitions
  FOR SELECT USING (TRUE);

INSERT INTO public.marketplace_order_transitions
  (from_status, to_status, actor_role, releases_stock, requires_payment, marks_paid,
   marks_completed, marks_delivered, marks_refunded, creates_settlement, holds_settlement,
   notify, description)
VALUES
  -- Payment confirmed by a verified webhook. Only 'system' can do this, which is
  -- why the frontend cannot talk an order into being paid.
  ('pending_payment','paid','system', FALSE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['payment_confirmed'], 'Payment verified server-side by the payment provider webhook.'),

  ('pending_payment','cancelled','buyer',  TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Buyer abandoned or cancelled before paying. No money moved.'),
  ('pending_payment','cancelled','admin',  TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Staff cancelled an unpaid order.'),
  ('pending_payment','cancelled','system', TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Reservation expired.'),

  -- Vendor accepts and rejects.
  ('paid','order_confirmed','vendor', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_accepted'], 'Vendor accepted the order.'),
  ('paid','order_confirmed','admin', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Staff confirmed on the vendor''s behalf.'),
  ('paid','cancelled','vendor',        TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_rejected'], 'Vendor cannot fulfil. Finance must refund the buyer.'),
  ('paid','cancelled','admin',        TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Staff cancelled a paid order. Refund required.'),

  ('order_confirmed','preparing','vendor', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Vendor started preparing or rendering the service.'),
  ('order_confirmed','cancelled','vendor', TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_rejected'], 'Vendor can no longer fulfil. Refund required.'),
  ('order_confirmed','cancelled','admin', TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Staff cancelled. Refund required.'),

  ('preparing','ready_for_delivery','vendor', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Ready for pickup or out for delivery.'),
  ('preparing','cancelled','vendor', TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_rejected'], 'Vendor withdrew. Refund required.'),
  ('preparing','cancelled','admin', TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Staff cancelled. Refund required.'),

  ('ready_for_delivery','delivered','vendor', FALSE, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Vendor handed the order over.'),
  ('ready_for_delivery','cancelled','vendor', TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_rejected'], 'Vendor withdrew before handover. Refund required.'),
  ('ready_for_delivery','cancelled','admin', TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['order_status_changed'], 'Staff cancelled. Refund required.'),

  -- Handover confirmation.
  ('delivered','completed','buyer',  FALSE, TRUE, FALSE, TRUE, FALSE, FALSE, TRUE, FALSE,
   ARRAY['order_status_changed'], 'Buyer confirmed receipt. Funds become releasable after the return window.'),
  ('delivered','completed','system', FALSE, TRUE, FALSE, TRUE, FALSE, FALSE, TRUE, FALSE,
   ARRAY['order_status_changed'], 'Auto-confirmed after the return window with no dispute.'),
  ('delivered','disputed','buyer',  FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,
   ARRAY['dispute_opened'], 'Buyer reported a problem. Settlement frozen.'),
  ('delivered','disputed','admin',  FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,
   ARRAY['dispute_opened'], 'Staff opened a dispute on the buyer''s behalf.'),

  ('completed','disputed','buyer',  FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,
   ARRAY['dispute_opened'], 'Buyer disputed within the return window. Settlement frozen.'),
  ('completed','disputed','admin',  FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE,
   ARRAY['dispute_opened'], 'Staff opened a dispute.'),

  -- Dispute outcomes are staff-only.
  ('disputed','completed','admin', FALSE, TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['dispute_updated'], 'Dispute rejected; order stands as completed.'),
  ('disputed','refunded','admin', FALSE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE,
   ARRAY['refund_issued','dispute_updated'], 'Dispute upheld; full refund issued.'),
  ('disputed','cancelled','admin', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
   ARRAY['dispute_updated'], 'Dispute upheld; order cancelled and refund initiated.')
ON CONFLICT (from_status, to_status, actor_role) DO NOTHING;

-- =============================================================================
-- NOTIFICATION HELPER (internal)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_notify(
  p_user_id UUID,
  p_type public.marketplace_notification_type,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_dedupe_key TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.marketplace_notifications
    (user_id, type, title, message, link, entity_type, entity_id, dedupe_key)
  VALUES
    (p_user_id, p_type, left(p_title, 140), left(p_message, 500), left(p_link, 300),
     p_entity_type, p_entity_id, p_dedupe_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END $$;

COMMENT ON FUNCTION public.mp_notify IS
  'Internal notification writer. Not exposed to any role: it is called only from SECURITY DEFINER business functions, so a client cannot forge a notification addressed to someone else.';

-- =============================================================================
-- ORDER NUMBER GENERATOR
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public.mp_order_seq START 1;

CREATE OR REPLACE FUNCTION public.mp_order_number()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE v_seq BIGINT;
BEGIN
  v_seq := nextval('public.mp_order_seq');
  RETURN 'MP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(v_seq::TEXT || clock_timestamp()::TEXT), 1, 8));
END $$;

CREATE OR REPLACE FUNCTION public.mp_dispute_number()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE v_seq BIGINT;
BEGIN
  v_seq := nextval('public.mp_order_seq');
  RETURN 'DSP-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(v_seq::TEXT || clock_timestamp()::TEXT), 1, 6));
END $$;

-- =============================================================================
-- AUDIT HELPER (internal)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_audit(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_before JSONB DEFAULT NULL,
  p_after JSONB DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_actor_role TEXT DEFAULT 'system'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.marketplace_audit_log
    (actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, note)
  VALUES
    (auth.uid(), p_actor_role, p_action, p_entity_type, p_entity_id, p_before, p_after, left(p_note, 500));
END $$;

-- =============================================================================
-- VENDOR BOOTSTRAP
-- =============================================================================

-- Creates or updates the caller's storefront. There is no way to pass an
-- owner id: owner_id is always auth.uid().
CREATE OR REPLACE FUNCTION public.mp_save_vendor(
  p_shop_name TEXT,
  p_handle TEXT,
  p_tagline TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_campus_area TEXT DEFAULT NULL,
  p_business_hours JSONB DEFAULT NULL,
  p_policies JSONB DEFAULT NULL,
  p_payout_bank_name TEXT DEFAULT NULL,
  p_payout_account_number TEXT DEFAULT NULL,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_vendor public.marketplace_vendors%ROWTYPE;
  v_new_id UUID;
  v_status public.marketplace_vendor_status;
  v_normalised_handle TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in with your FUW account to open a storefront' USING ERRCODE = '28000';
  END IF;
  IF NOT public.mp_has_identity() THEN
    RAISE EXCEPTION 'Your FUW account is not active' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;

  IF NOT v_settings.allow_new_vendors THEN
    RAISE EXCEPTION 'New vendor registration is temporarily closed' USING ERRCODE = '55000';
  END IF;

  IF char_length(trim(COALESCE(p_shop_name, ''))) < 2
     OR char_length(trim(COALESCE(p_shop_name, ''))) > 70 THEN
    RAISE EXCEPTION 'Store name must be between 2 and 70 characters' USING ERRCODE = '22023';
  END IF;

  v_normalised_handle := lower(trim(COALESCE(p_handle, '')));
  IF v_normalised_handle !~ '^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$' THEN
    RAISE EXCEPTION 'Store handle must be 3-30 characters: lowercase letters, numbers and hyphens'
      USING ERRCODE = '22023';
  END IF;

  -- Do not let a student open a second storefront, and do not let them edit
  -- one they do not own. Ownership is read, never supplied.
  SELECT * INTO v_vendor FROM public.marketplace_vendors
   WHERE owner_id = v_uid AND deleted_at IS NULL;

  IF FOUND THEN
    IF p_vendor_id IS NOT NULL AND p_vendor_id <> v_vendor.id THEN
      RAISE EXCEPTION 'You can only edit your own storefront' USING ERRCODE = '42501';
    END IF;
    v_new_id := v_vendor.id;
    -- Rejected vendors may edit their profile to appeal, but cannot re-publish.
    v_status := v_vendor.status;

    UPDATE public.marketplace_vendors v
       SET shop_name = trim(p_shop_name),
           handle    = v_normalised_handle,
           tagline   = nullif(trim(p_tagline), ''),
           description = nullif(trim(p_description), ''),
           campus_area = nullif(trim(p_campus_area), ''),
           business_hours = COALESCE(p_business_hours, v.business_hours),
           policies = COALESCE(p_policies, v.policies),
           payout_bank_name = nullif(trim(p_payout_bank_name), ''),
           payout_account_number = nullif(trim(p_payout_account_number), ''),
           -- Payout must be re-approved after bank details change.
           payout_enabled = CASE
             WHEN v.payout_account_number IS DISTINCT FROM nullif(trim(p_payout_account_number), '')
               THEN FALSE ELSE v.payout_enabled END,
           updated_at = now()
     WHERE v.id = v_new_id
     RETURNING * INTO v_vendor;
  ELSE
    IF p_vendor_id IS NOT NULL THEN
      RAISE EXCEPTION 'No storefront found for your account' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.marketplace_vendors
      (owner_id, handle, shop_name, tagline, description, campus_area,
       business_hours, policies, payout_bank_name, payout_account_number, status)
    VALUES
      (v_uid, v_normalised_handle, trim(p_shop_name),
       nullif(trim(p_tagline), ''), nullif(trim(p_description), ''),
       nullif(trim(p_campus_area), ''),
       COALESCE(p_business_hours, '{}'::JSONB), COALESCE(p_policies, '{}'::JSONB),
       nullif(trim(p_payout_bank_name), ''), nullif(trim(p_payout_account_number), ''),
       'draft')
    RETURNING id INTO v_new_id;

    SELECT * INTO v_vendor FROM public.marketplace_vendors WHERE id = v_new_id;

    -- Submitting the form at all puts the storefront into the review queue.
    v_status := 'pending_review';
    UPDATE public.marketplace_vendors SET status = v_status WHERE id = v_new_id;
  END IF;

  PERFORM public.mp_audit('vendor.save', 'vendor', v_new_id, NULL,
                          jsonb_build_object('shop_name', v_vendor.shop_name, 'status', v_status), NULL, 'vendor');

  RETURN jsonb_build_object(
    'id', v_new_id,
    'shop_name', v_vendor.shop_name,
    'handle', v_vendor.handle,
    'status', v_status,
    'verification', v_vendor.verification
  );
END $$;

COMMENT ON FUNCTION public.mp_save_vendor IS
  'Creates or updates the caller''s own storefront. owner_id is always auth.uid(); a caller cannot create, edit or target another vendor.';

-- Staff-side vendor status control.
CREATE OR REPLACE FUNCTION public.mp_set_vendor_status(
  p_vendor_id UUID,
  p_status public.marketplace_vendor_status,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_owner UUID; v_before TEXT;
BEGIN
  IF NOT public.mp_has_perm('moderate_vendors') THEN
    RAISE EXCEPTION 'You do not have permission to moderate vendors' USING ERRCODE = '42501';
  END IF;

  SELECT owner_id, status::TEXT INTO v_owner, v_before
    FROM public.marketplace_vendors WHERE id = p_vendor_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.marketplace_vendors
     SET status = p_status,
         suspended_at = CASE WHEN p_status = 'suspended' THEN now() ELSE NULL END,
         suspension_reason = CASE WHEN p_status = 'suspended' THEN left(p_reason, 600) ELSE NULL END,
         -- A suspended vendor must not keep earning.
         payout_enabled = CASE WHEN p_status = 'suspended' THEN FALSE ELSE payout_enabled END
   WHERE id = p_vendor_id;

  PERFORM public.mp_audit('vendor.status', 'vendor', p_vendor_id,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status), p_reason, 'admin');

  PERFORM public.mp_notify(v_owner, 'account_warning',
    'Your storefront was ' || replace(p_status::TEXT, '_', ' '),
    COALESCE(left(p_reason, 400), 'Contact marketplace support for details.'),
    '/vendor/settings', 'vendor', p_vendor_id);

  -- A suspended vendor must not keep selling. Existing paid orders continue so
  -- buyers are not stranded; only new listings and new checkouts are blocked.
END $$;

-- =============================================================================
-- PRODUCT MANAGEMENT
-- =============================================================================

-- Vendor creates or edits a listing. The client submits intent (title, price
-- it wants to charge, stock it believes it has); this function is the only
-- writer and re-validates every field against catalogue and platform rules.
CREATE OR REPLACE FUNCTION public.mp_upsert_product(
  p_product_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_subcategory_id UUID DEFAULT NULL,
  p_listing_type public.marketplace_listing_type DEFAULT 'product',
  p_price_kobo BIGINT DEFAULT NULL,
  p_compare_at_kobo BIGINT DEFAULT NULL,
  p_condition public.marketplace_condition DEFAULT NULL,
  p_condition_notes TEXT DEFAULT NULL,
  p_quantity INTEGER DEFAULT NULL,
  p_fulfilment public.marketplace_delivery_type DEFAULT 'pickup',
  p_delivery_fee_kobo BIGINT DEFAULT NULL,
  p_campus_area TEXT DEFAULT NULL,
  p_meeting_point TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_lead_time_hours INTEGER DEFAULT NULL,
  p_capacity INTEGER DEFAULT NULL,
  p_service_area TEXT DEFAULT NULL,
  p_publish BOOLEAN DEFAULT FALSE,
  p_images JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_vendor public.marketplace_vendors%ROWTYPE;
  v_cat public.marketplace_categories%ROWTYPE;
  v_prod public.marketplace_products%ROWTYPE;
  v_sub marketplace_subcategories%ROWTYPE;
  v_is_service BOOLEAN;
  v_cond public.marketplace_condition;
  v_qty INTEGER;
  v_fee BIGINT;
  v_price BIGINT;
  v_status public.marketplace_listing_status;
  v_slug TEXT;
  v_pid UUID;
  v_img JSONB;
  v_primary TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage listings' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.maintenance_mode THEN
    RAISE EXCEPTION 'The marketplace is temporarily unavailable for changes' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_vendor FROM public.marketplace_vendors
   WHERE owner_id = v_uid AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open a storefront before adding listings' USING ERRCODE = 'P0002';
  END IF;

  IF v_vendor.status NOT IN ('active', 'pending_review') THEN
    RAISE EXCEPTION 'Your storefront is % and cannot publish listings',
      replace(v_vendor.status::TEXT, '_', ' ') USING ERRCODE = '42501';
  END IF;

  -- Category must be live and must match the listing type (a service cannot be
  -- filed under a physical-goods category and vice versa).
  SELECT * INTO v_cat FROM public.marketplace_categories
   WHERE id = p_category_id AND is_active AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active category' USING ERRCODE = '22023';
  END IF;

  IF v_cat.listing_type <> p_listing_type THEN
    RAISE EXCEPTION 'Category "%" is for %s, not %s', v_cat.name,
      v_cat.listing_type, p_listing_type USING ERRCODE = '22023';
  END IF;

  IF p_subcategory_id IS NOT NULL THEN
    SELECT * INTO v_sub FROM public.marketplace_subcategories
     WHERE id = p_subcategory_id AND category_id = p_category_id
       AND is_active AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That subcategory does not belong to the chosen category' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_is_service := (p_listing_type = 'service');

  IF v_is_service THEN
    v_cond := 'not_applicable';
    v_qty := 0;
    v_fee := 0;
  ELSE
    v_cond := COALESCE(p_condition, 'new');
    IF v_cond = 'not_applicable' THEN
      RAISE EXCEPTION 'Physical products need a condition' USING ERRCODE = '22023';
    END IF;
    v_qty := COALESCE(p_quantity, 0);
    IF v_qty < 0 OR v_qty > 100000 THEN
      RAISE EXCEPTION 'Quantity must be between 0 and 100000' USING ERRCODE = '22023';
    END IF;
    -- Stock floor protects the ledger: you cannot restock below what is sold.
    IF v_qty < COALESCE((SELECT quantity_sold FROM public.marketplace_products WHERE id = p_product_id), 0) THEN
      RAISE EXCEPTION 'Stock cannot be lower than units already sold (% )',
        COALESCE((SELECT quantity_sold FROM public.marketplace_products WHERE id = p_product_id), 0)
        USING ERRCODE = '23514';
    END IF;
    v_fee := COALESCE(p_delivery_fee_kobo, 0);
    IF v_fee < 0 OR v_fee > 2000000 THEN
      RAISE EXCEPTION 'Delivery fee must be between 0 and NGN 20,000' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_price := p_price_kobo;
  IF v_price IS NULL OR v_price < 100 THEN
    RAISE EXCEPTION 'Price must be at least NGN 1.00' USING ERRCODE = '22023';
  END IF;
  -- Upper bound stops a fat-fingered zero from creating an absurd listing that
  -- would later need a manual correction.
  IF v_price > 500000000 THEN
    RAISE EXCEPTION 'Price exceeds the NGN 5,000,000 per-listing maximum' USING ERRCODE = '22023';
  END IF;
  IF p_compare_at_kobo IS NOT NULL AND p_compare_at_kobo <= v_price THEN
    RAISE EXCEPTION 'The compare-at price must be higher than the selling price' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_title, ''))) < 3 OR char_length(trim(p_title)) > 120 THEN
    RAISE EXCEPTION 'Title must be between 3 and 120 characters' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(p_description, ''))) < 10 THEN
    RAISE EXCEPTION 'Description must be at least 10 characters' USING ERRCODE = '22023';
  END IF;

  IF p_fulfilment = 'delivery' AND NOT v_is_service AND v_fee IS NULL THEN
    RAISE EXCEPTION 'Set a delivery fee for delivery fulfilment' USING ERRCODE = '22023';
  END IF;

  v_slug := trim(both '-' FROM regexp_replace(lower(trim(p_title)), '[^a-z0-9]+', '-', 'g'));

  IF p_product_id IS NULL THEN
    -- Listing cap
    IF (SELECT count(*) FROM public.marketplace_products
         WHERE vendor_id = v_vendor.id AND deleted_at IS NULL) >= v_settings.max_listings_per_vendor THEN
      RAISE EXCEPTION 'You have reached the maximum of % active listings', v_settings.max_listings_per_vendor
        USING ERRCODE = '54000';
    END IF;

    v_status := CASE WHEN p_publish THEN 'active'::public.marketplace_listing_status ELSE 'draft' END;

    INSERT INTO public.marketplace_products
      (vendor_id, category_id, subcategory_id, listing_type, slug, title, description,
       condition, condition_notes, price_kobo, compare_at_kobo, is_service, capacity,
       lead_time_hours, service_area, quantity_total, status, fulfilment,
       allows_delivery, allows_pickup, delivery_fee_kobo, campus_area, meeting_point,
       tags, published_at)
    VALUES
      (v_vendor.id, p_category_id, p_subcategory_id, p_listing_type, v_slug, trim(p_title), trim(p_description),
       v_cond, nullif(trim(p_condition_notes), ''), v_price, p_compare_at_kobo, v_is_service,
       CASE WHEN v_is_service THEN COALESCE(p_capacity, 1) ELSE NULL END,
       COALESCE(p_lead_time_hours, 0),
       CASE WHEN v_is_service THEN nullif(trim(p_service_area), '') ELSE NULL END,
       v_qty, v_status, p_fulfilment,
       (p_fulfilment = 'delivery'), (p_fulfilment = 'pickup'), v_fee,
       nullif(trim(p_campus_area), ''), nullif(trim(p_meeting_point), ''),
       COALESCE(p_tags, '{}'::TEXT[]),
       CASE WHEN p_publish THEN now() ELSE NULL END)
    RETURNING id INTO v_pid;

    -- Opening stock is an inventory movement, not a bare column write.
    IF NOT v_is_service AND v_qty > 0 THEN
      INSERT INTO public.marketplace_inventory
        (product_id, delta, balance_after, reason, actor_id, note)
      VALUES (v_pid, v_qty, v_qty, 'initial', v_uid, 'Opening stock');
    END IF;
  ELSE
    -- Ownership check. A vendor editing someone else's listing gets nothing.
    SELECT * INTO v_prod FROM public.marketplace_products
     WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_prod.vendor_id <> v_vendor.id THEN
      RAISE EXCEPTION 'You can only edit your own listings' USING ERRCODE = '42501';
    END IF;
    IF v_prod.status = 'under_review' AND NOT public.mp_has_perm('moderate_listings') THEN
      RAISE EXCEPTION 'This listing is under review and cannot be edited' USING ERRCODE = '42501';
    END IF;

    v_pid := v_prod.id;
    -- Slug is immutable once published so live links never rot.
    v_slug := CASE WHEN v_prod.published_at IS NULL
                    THEN COALESCE(NULLIF(v_slug, ''), v_prod.slug)
                    ELSE v_prod.slug END;

    v_status := CASE
      WHEN p_publish AND v_prod.status IN ('draft','paused') THEN 'active'::public.marketplace_listing_status
      WHEN p_publish THEN v_prod.status
      ELSE 'draft'::public.marketplace_listing_status
    END;

    UPDATE public.marketplace_products pr
       SET category_id = p_category_id,
           subcategory_id = p_subcategory_id,
           slug = v_slug,
           title = trim(p_title),
           description = trim(p_description),
           condition = v_cond,
           condition_notes = nullif(trim(p_condition_notes), ''),
           price_kobo = v_price,
           compare_at_kobo = p_compare_at_kobo,
           is_service = v_is_service,
           capacity = CASE WHEN v_is_service THEN COALESCE(p_capacity, pr.capacity, 1) ELSE NULL END,
           lead_time_hours = COALESCE(p_lead_time_hours, 0),
           service_area = CASE WHEN v_is_service THEN nullif(trim(p_service_area), '') ELSE NULL END,
           quantity_total = CASE WHEN v_is_service THEN 0 ELSE v_qty END,
           fulfilment = p_fulfilment,
           allows_delivery = (p_fulfilment = 'delivery'),
           allows_pickup = (p_fulfilment = 'pickup'),
           delivery_fee_kobo = v_fee,
           campus_area = nullif(trim(p_campus_area), ''),
           meeting_point = nullif(trim(p_meeting_point), ''),
           tags = COALESCE(p_tags, '{}'::TEXT[]),
           published_at = COALESCE(pr.published_at, CASE WHEN p_publish THEN now() ELSE NULL END),
           -- A price or stock change on a live listing is re-moderated so a
           -- compromised vendor account cannot swap a listing post-hoc.
           status = CASE
                      WHEN p_publish AND (pr.price_kobo <> v_price OR pr.quantity_total <> v_qty)
                        AND pr.status = 'active' AND NOT public.mp_has_perm('moderate_listings')
                      THEN 'under_review'::public.marketplace_listing_status
                      ELSE v_status END,
           updated_at = now()
     WHERE pr.id = v_pid;

    -- Re-read immediately: the re-moderation CASE above may have demoted the
    -- listing to 'under_review', and every check below must see the status the
    -- database actually stored rather than the one we intended.
    SELECT * INTO v_prod FROM public.marketplace_products WHERE id = v_pid;

    -- Ledger the stock delta rather than overwriting the balance.
    IF NOT v_is_service AND v_qty <> v_prod.quantity_total THEN
      INSERT INTO public.marketplace_inventory
        (product_id, delta, balance_after, reason, actor_id, note)
      VALUES
        (v_pid, v_qty - v_prod.quantity_total, v_qty,
         CASE WHEN v_qty > v_prod.quantity_total THEN 'restock' ELSE 'correction' END,
         v_uid, 'Edited from listing form');
    END IF;
  END IF;

  -- Attach images. Only paths already uploaded by this vendor under their own
  -- prefix may be attached, so one vendor cannot reference another's objects.
  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 0 THEN
    IF jsonb_array_length(p_images) > v_settings.max_images_per_listing THEN
      RAISE EXCEPTION 'A listing can have at most % images', v_settings.max_images_per_listing
        USING ERRCODE = '22023';
    END IF;

    FOR v_img IN SELECT * FROM jsonb_array_elements(p_images) LOOP
      IF (v_img->>'path') IS NULL OR (v_img->>'path') NOT LIKE v_vendor.id::TEXT || '/product-images/%' THEN
        RAISE EXCEPTION 'Image path is not in your storefront upload folder' USING ERRCODE = '42501';
      END IF;
      IF (v_img->>'mime') NOT IN ('image/jpeg','image/png','image/webp','image/avif') THEN
        RAISE EXCEPTION 'Unsupported image type' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.marketplace_product_images
        (product_id, storage_path, mime_type, byte_size, alt_text, sort_order, is_primary)
      VALUES
        (v_pid, v_img->>'path', v_img->>'mime',
         NULLIF(v_img->>'size', '')::INTEGER,
         nullif(left(v_img->>'alt', 160), ''),
         COALESCE((v_img->>'sort')::INTEGER, 0),
         COALESCE((v_img->>'primary')::BOOLEAN, FALSE))
      ON CONFLICT (storage_path) DO NOTHING;

      -- Exactly one primary: demote any existing primary first.
      IF COALESCE((v_img->>'primary')::BOOLEAN, FALSE) THEN
        UPDATE public.marketplace_product_images SET is_primary = FALSE WHERE product_id = v_pid;
        UPDATE public.marketplace_product_images SET is_primary = TRUE
         WHERE product_id = v_pid AND storage_path = v_img->>'path';
      END IF;
    END LOOP;

    -- Guarantee a primary so the card grid never renders an empty tile.
    SELECT storage_path INTO v_primary FROM public.marketplace_product_images
     WHERE product_id = v_pid ORDER BY is_primary DESC, sort_order, created_at LIMIT 1;
    IF v_primary IS NOT NULL THEN
      UPDATE public.marketplace_product_images SET is_primary = (storage_path = v_primary)
       WHERE product_id = v_pid;
    END IF;
  END IF;

  -- A listing going live must have at least one image and available stock.
  IF v_prod.status = 'active' AND NOT v_is_service THEN
    IF NOT EXISTS (SELECT 1 FROM public.marketplace_product_images WHERE product_id = v_pid) THEN
      RAISE EXCEPTION 'Add at least one photo before publishing' USING ERRCODE = '22023';
    END IF;
    IF v_prod.quantity_total <= 0 THEN
      RAISE EXCEPTION 'Set stock above zero before publishing' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM public.mp_audit('product.upsert', 'product', v_pid, NULL,
    jsonb_build_object('title', trim(p_title), 'price_kobo', v_price, 'status', v_prod.status), NULL, 'vendor');

  RETURN jsonb_build_object(
    'id', v_prod.id,
    'slug', v_prod.slug,
    'status', v_prod.status,
    'price_kobo', v_prod.price_kobo,
    'quantity_total', v_prod.quantity_total
  );
END $$;

COMMENT ON FUNCTION public.mp_upsert_product IS
  'The only writer for marketplace_products. Re-validates category/type match, price bounds, stock floor and image ownership. A vendor cannot supply a vendor_id, an owner or a status.';

-- Publish / pause / archive a listing.
CREATE OR REPLACE FUNCTION public.mp_set_listing_status(
  p_product_id UUID,
  p_status public.marketplace_listing_status,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prod public.marketplace_products%ROWTYPE;
  v_owner UUID;
  v_is_staff BOOLEAN := public.mp_has_perm('moderate_listings');
  v_next public.marketplace_listing_status;
BEGIN
  SELECT * INTO v_prod FROM public.marketplace_products
   WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_prod.vendor_id;

  -- Staff may drive any state; a vendor may only draft/pause/activate their own.
  IF NOT v_is_staff AND v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You can only change your own listings' USING ERRCODE = '42501';
  END IF;

  v_next := p_status;

  IF NOT v_is_staff THEN
    IF p_status NOT IN ('draft', 'active', 'paused') THEN
      RAISE EXCEPTION 'That status can only be set by marketplace staff' USING ERRCODE = '42501';
    END IF;
    IF p_status = 'active' THEN
      IF v_prod.quantity_total <= 0 AND NOT v_prod.is_service THEN
        RAISE EXCEPTION 'Restock before publishing this listing' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.marketplace_product_images WHERE product_id = p_product_id) THEN
        RAISE EXCEPTION 'Add at least one photo before publishing' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  UPDATE public.marketplace_products
     SET status = v_next,
         published_at = CASE WHEN v_next = 'active' THEN COALESCE(published_at, now()) ELSE published_at END,
         deleted_at = CASE WHEN v_next = 'removed' AND v_is_staff THEN now() ELSE deleted_at END,
         updated_at = now()
   WHERE id = p_product_id;

  PERFORM public.mp_audit('product.status', 'product', p_product_id,
    jsonb_build_object('status', v_prod.status), jsonb_build_object('status', v_next),
    p_reason, CASE WHEN v_is_staff THEN 'admin' ELSE 'vendor' END);

  IF v_next = 'removed' THEN
    PERFORM public.mp_notify(v_owner, 'listing_removed',
      'Listing removed by marketplace staff',
      COALESCE(left(p_reason, 400), 'A listing was removed after review.'),
      '/vendor/products', 'product', p_product_id);
  END IF;

  RETURN jsonb_build_object('id', p_product_id, 'status', v_next);
END $$;

-- Stock adjustment with a ledger entry. Takes a DELTA, never an absolute
-- balance, so a concurrent sale cannot be silently overwritten.
CREATE OR REPLACE FUNCTION public.mp_adjust_inventory(
  p_product_id UUID,
  p_delta INTEGER,
  p_note TEXT DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prod public.marketplace_products%ROWTYPE;
  v_owner UUID;
  v_next INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage stock' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_prod FROM public.marketplace_products
   WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_prod.vendor_id;

  IF v_owner <> auth.uid() AND NOT public.mp_has_perm('moderate_listings') THEN
    RAISE EXCEPTION 'You can only adjust stock on your own listings' USING ERRCODE = '42501';
  END IF;

  IF v_prod.is_service THEN
    RAISE EXCEPTION 'Services are not stock-tracked. Edit capacity instead.' USING ERRCODE = '22023';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'Enter a non-zero stock adjustment' USING ERRCODE = '22023';
  END IF;
  IF abs(p_delta) > 100000 THEN
    RAISE EXCEPTION 'Adjustment must be between -100000 and 100000' USING ERRCODE = '22023';
  END IF;

  v_next := v_prod.quantity_total + p_delta;

  -- The floor is units already committed to buyers.
  IF v_next < v_prod.quantity_sold + v_prod.quantity_reserved THEN
    RAISE EXCEPTION 'Cannot go below % units already committed to orders',
      v_prod.quantity_sold + v_prod.quantity_reserved USING ERRCODE = '23514';
  END IF;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'Stock cannot be negative' USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_products
     SET quantity_total = v_next,
         status = CASE
                    WHEN v_next = 0 AND status = 'active' AND NOT is_service
                      THEN 'sold_out'::public.marketplace_listing_status
                    WHEN v_next > 0 AND status = 'sold_out' THEN 'active'::public.marketplace_listing_status
                    ELSE status END,
         updated_at = now()
   WHERE id = p_product_id;

  INSERT INTO public.marketplace_inventory
    (product_id, delta, balance_after, reason, actor_id, note)
  VALUES
    (p_product_id, p_delta, v_next,
     CASE WHEN p_delta > 0 THEN 'restock' ELSE 'correction' END,
     auth.uid(), left(p_note, 400));

  RETURN jsonb_build_object('id', p_product_id, 'quantity_total', v_next,
                            'available', v_next - v_prod.quantity_sold - v_prod.quantity_reserved);
END $$;

-- Variant management (also delta-based for stock).
CREATE OR REPLACE FUNCTION public.mp_save_variant(
  p_variant_id UUID DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_name TEXT DEFAULT NULL,
  p_value TEXT DEFAULT NULL,
  p_price_kobo BIGINT DEFAULT NULL,
  p_compare_at_kobo BIGINT DEFAULT NULL,
  p_quantity_total INTEGER DEFAULT NULL,
  p_sku TEXT DEFAULT NULL,
  p_sort_order INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prod public.marketplace_products%ROWTYPE;
  v_owner UUID;
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_var public.marketplace_product_variants%ROWTYPE;
  v_vid UUID;
  v_next INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage listings' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;

  SELECT * INTO v_prod FROM public.marketplace_products WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_prod.vendor_id;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You can only edit your own listings' USING ERRCODE = '42501';
  END IF;
  IF v_prod.is_service THEN
    RAISE EXCEPTION 'Services cannot have variants' USING ERRCODE = '22023';
  END IF;

  IF char_length(trim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 40
     OR char_length(trim(COALESCE(p_value,''))) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Variant name and value must be 1-40 characters' USING ERRCODE = '22023';
  END IF;
  IF p_price_kobo IS NOT NULL AND p_price_kobo < 100 THEN
    RAISE EXCEPTION 'Variant price must be at least NGN 1.00' USING ERRCODE = '22023';
  END IF;

  IF p_variant_id IS NULL THEN
    IF (SELECT count(*) FROM public.marketplace_product_variants WHERE product_id = p_product_id)
         >= v_settings.max_variants_per_listing THEN
      RAISE EXCEPTION 'A listing can have at most % variants', v_settings.max_variants_per_listing
        USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.marketplace_product_variants
      (product_id, name, value, price_kobo, compare_at_kobo, quantity_total, sku, sort_order)
    VALUES
      (p_product_id, trim(p_name), trim(p_value), p_price_kobo, p_compare_at_kobo,
       GREATEST(COALESCE(p_quantity_delta, 0), 0),
       nullif(trim(COALESCE(p_sku,'')), ''), COALESCE(p_sort_order, 0))
    RETURNING id INTO v_vid;
  ELSE
    SELECT * INTO v_var FROM public.marketplace_product_variants
     WHERE id = p_variant_id AND product_id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found' USING ERRCODE = 'P0002';
    END IF;
    v_vid := v_var.id;

    v_next := v_var.quantity_total + COALESCE(p_quantity_delta, 0);
    IF v_next < v_var.quantity_sold + v_var.quantity_reserved THEN
      RAISE EXCEPTION 'Variant stock cannot go below % committed units',
        v_var.quantity_sold + v_var.quantity_reserved USING ERRCODE = '23514';
    END IF;
    IF v_next < 0 THEN
      RAISE EXCEPTION 'Variant stock cannot be negative' USING ERRCODE = '23514';
    END IF;

    UPDATE public.marketplace_product_variants
       SET name = trim(p_name), value = trim(p_value),
           price_kobo = p_price_kobo, compare_at_kobo = p_compare_at_kobo,
           quantity_total = v_next,
           sku = nullif(trim(COALESCE(p_sku,'')), ''),
           is_available = (v_next - v_var.quantity_sold - v_var.quantity_reserved) > 0,
           sort_order = COALESCE(p_sort_order, 0),
           updated_at = now()
     WHERE id = v_vid;
  END IF;

  -- Keep the parent's availability flag honest without touching stock totals.
  UPDATE public.marketplace_product_variants SET is_available = (quantity_total - quantity_sold - quantity_reserved) > 0
   WHERE product_id = p_product_id;

  RETURN jsonb_build_object('id', v_vid);
END $$;

CREATE OR REPLACE FUNCTION public.mp_delete_variant(p_variant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_product UUID; v_owner UUID; v_sold INT; v_res INT;
BEGIN
  SELECT v.product_id INTO v_product FROM public.marketplace_product_variants v WHERE v.id = p_variant_id;
  IF v_product IS NULL THEN RETURN FALSE; END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors v WHERE v.id = v_product;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You can only edit your own listings' USING ERRCODE = '42501';
  END IF;

  SELECT quantity_sold, quantity_reserved INTO v_sold, v_res
    FROM public.marketplace_product_variants WHERE id = p_variant_id;

  -- Deleting a variant that appears on an order would orphan order history.
  IF v_sold > 0 OR v_res > 0 THEN
    RAISE EXCEPTION 'This option has been sold. Pause it instead of deleting.' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.marketplace_product_variants WHERE id = p_variant_id;
  RETURN TRUE;
END $$;
-- =============================================================================
-- CART PRICING & CHECKOUT PREPARATION
-- =============================================================================
-- One implementation, two entry points:
--
--   mp_price_cart(items)          -> preview only. Validates and prices the
--                                    cart for display. Reserves nothing.
--   mp_create_orders(...)         -> checkout. Same validation, then writes.
--
-- Both call mp_compute_cart(), which is the single place prices are derived.
-- The client never supplies a unit price, a fee or a total.
--
-- Locking strategy: listings are locked FOR UPDATE in ascending UUID order.
-- Two buyers checking out the same pair of listings therefore queue behind each
-- other instead of deadlocking, and the second one re-reads the post-reservation
-- balance. That is what makes overselling impossible rather than unlikely.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_compute_cart(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_settings public.marketplace_platform_settings%ROWTYPE;
  -- Separate row types on purpose. Reusing a single RECORD for the listing, the
  -- storefront and the variant is exactly how vendor fields end up NULL after
  -- the variant branch overwrites the record.
  v_req RECORD;
  v_p public.marketplace_products%ROWTYPE;
  v_ven public.marketplace_vendors%ROWTYPE;
  v_var public.marketplace_product_variants%ROWTYPE;
  v_resolved JSONB := '[]'::JSONB;
  v_item JSONB;
  v_pid UUID;
  v_vid UUID;
  v_qty INT;
  v_label TEXT;
  v_unit BIGINT;
  v_line_fee BIGINT;
  v_available INT;
  v_commission_bps INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to check out' USING ERRCODE = '28000';
  END IF;
  IF NOT public.mp_has_identity() THEN
    RAISE EXCEPTION 'Your FUW account is not active' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.maintenance_mode THEN
    RAISE EXCEPTION 'The marketplace is temporarily unavailable for checkout' USING ERRCODE = '55000';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'A single checkout is limited to 60 line items' USING ERRCODE = '22023';
  END IF;

  FOR v_req IN
    SELECT (i->>'product_id')::UUID                                   AS product_id,
           NULLIF(i->>'variant_id', '')::UUID                        AS variant_id,
           COALESCE(NULLIF(i->>'quantity', '')::INT, 1)              AS qty
      FROM jsonb_array_elements(p_items) i
     ORDER BY 1 NULLS FIRST, 2 NULLS FIRST
  LOOP
    v_pid := v_req.product_id;
    v_vid := v_req.variant_id;
    v_qty := v_req.qty;

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'Cart contains an invalid listing reference' USING ERRCODE = '22023';
    END IF;
    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Quantities must be at least 1' USING ERRCODE = '22023';
    END IF;
    IF v_qty > 999 THEN
      RAISE EXCEPTION 'Maximum 999 units per listing per order' USING ERRCODE = '22023';
    END IF;

    -- Lock the listing row for the rest of this transaction. Two shoppers
    -- checking out the last unit cannot both pass the availability check below.
    -- The loop iterates in product_id order so concurrent carts acquire locks in
    -- the same sequence and cannot deadlock against each other.
    SELECT * INTO v_p
      FROM public.marketplace_products
     WHERE id = v_pid AND deleted_at IS NULL
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A listing in your cart no longer exists' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_ven FROM public.marketplace_vendors WHERE id = v_p.vendor_id;

    IF v_ven.deleted_at IS NOT NULL OR v_ven.status <> 'active' THEN
      RAISE EXCEPTION '"%" is not currently trading', v_ven.shop_name USING ERRCODE = '22023';
    END IF;
    IF v_p.status NOT IN ('active', 'sold_out') THEN
      RAISE EXCEPTION '"%" is not available for purchase', left(v_p.title, 60) USING ERRCODE = '22023';
    END IF;
    IF v_ven.owner_id = v_uid THEN
      RAISE EXCEPTION 'You cannot order from your own storefront' USING ERRCODE = '22023';
    END IF;
    IF v_p.is_service THEN
      RAISE EXCEPTION 'Services are booked from their listing page, not added to a cart' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_settings.min_rating_to_list, 0) > v_ven.rating_avg AND v_ven.rating_count > 0 THEN
      RAISE EXCEPTION '"%" is below the marketplace minimum vendor rating', v_ven.shop_name
        USING ERRCODE = '22023';
    END IF;

    -- Reject a repeated listing+option pair instead of silently merging: a merge
    -- would reserve less stock than the shopper thinks they are buying.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_resolved) e
       WHERE e->>'product_id' = v_pid::TEXT
         AND COALESCE(e->>'variant_id', '') = COALESCE(v_vid::TEXT, '')
    ) THEN
      RAISE EXCEPTION 'The same listing appears twice in your cart' USING ERRCODE = '22023';
    END IF;

    IF v_vid IS NOT NULL THEN
      SELECT * INTO v_var
        FROM public.marketplace_product_variants
       WHERE id = v_vid AND product_id = v_pid
         FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A product option in your cart is no longer available' USING ERRCODE = '22023';
      END IF;
      IF NOT v_var.is_available THEN
        RAISE EXCEPTION 'That product option is sold out' USING ERRCODE = '22023';
      END IF;

      -- A variant price override wins; NULL means "inherit the listing price".
      v_unit := COALESCE(v_var.price_kobo, v_p.price_kobo);
      v_available := v_var.quantity_total - v_var.quantity_sold - v_var.quantity_reserved;
      v_label := v_var.name || ': ' || v_var.value;
    ELSE
      -- A listing that has variants requires the buyer to pick one.
      IF EXISTS (SELECT 1 FROM public.marketplace_product_variants
                  WHERE product_id = v_pid AND is_available) THEN
        RAISE EXCEPTION 'Please choose an option for "%"', left(v_p.title, 60) USING ERRCODE = '22023';
      END IF;
      v_unit := v_p.price_kobo;
      v_available := v_p.quantity_total - v_p.quantity_sold - v_p.quantity_reserved;
      v_label := NULL;
    END IF;

    IF v_qty > v_available THEN
      IF v_available <= 0 THEN
        RAISE EXCEPTION '"%" is sold out', left(v_p.title, 60) USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Only % unit%s left for "%"', v_available,
        CASE WHEN v_available = 1 THEN '' ELSE 's' END,
        left(v_p.title, 60) USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(c.commission_bps, v_settings.default_commission_bps)
      INTO v_commission_bps
      FROM public.marketplace_categories c WHERE c.id = v_p.category_id;

    IF v_commission_bps IS NULL THEN
      v_commission_bps := v_settings.default_commission_bps;
    END IF;

    -- Delivery is charged once per line, not once per unit, and never for
    -- pickup. The vendor's own listing decides the amount.
    v_line_fee := CASE WHEN v_p.fulfilment = 'delivery' THEN COALESCE(v_p.delivery_fee_kobo, 0) ELSE 0 END;

    v_item := jsonb_build_object(
      'product_id',       v_pid,
      'variant_id',       v_vid,
      'variant_label',    v_label,
      'title',            v_p.title,
      'slug',             v_p.slug,
      'thumbnail_path',   v_p.thumbnail_path,
      -- Storefront facts are read from the vendor row, never from the variant.
      'vendor_id',        v_p.vendor_id,
      'shop_name',        v_ven.shop_name,
      'shop_handle',      v_ven.handle,
      'verification',     v_ven.verification,
      'vendor_rating_avg',  v_ven.rating_avg,
      'vendor_rating_count', v_ven.rating_count,
      -- Fulfilment facts are read from the listing row.
      'campus_area',      v_p.campus_area,
      'fulfilment',       v_p.fulfilment,
      'allows_pickup',    v_p.allows_pickup,
      'delivery_fee_kobo', v_line_fee,
      'quantity',         v_qty,
      'unit_price_kobo',  v_unit,
      'line_total_kobo',  v_unit * v_qty,
      -- Commission is rounded per line and summed below, so the order-level
      -- platform fee is always the exact sum of what the receipt shows.
      'platform_fee_kobo', round((v_unit * v_qty)::NUMERIC * v_commission_bps / 10000)::BIGINT,
      'available',        v_available,
      'commission_bps',   v_commission_bps
    );

    v_resolved := v_resolved || jsonb_build_array(v_item);
  END LOOP;

  -- Group by vendor. One vendor's items always ship as one order, so a buyer
  -- never has a single dispute spanning two unrelated sellers.
  RETURN jsonb_build_object(
    'vendors', (
      SELECT jsonb_agg(
               g || jsonb_build_object(
                 'fulfilment',
                   CASE WHEN (g->>'mixed_fulfilment')::BOOLEAN
                        THEN 'mixed' ELSE g->>'fulfilment' END,
                 -- A mixed group cannot be priced until the shopper splits it,
                 -- so it is reported with no delivery charge rather than a
                 -- guessed one. mp_create_orders refuses it outright.
                 'delivery_fee_kobo',
                   CASE WHEN (g->>'mixed_fulfilment')::BOOLEAN
                              OR g->>'fulfilment' <> 'delivery'
                        THEN 0 ELSE (g->>'delivery_fee_kobo')::BIGINT END,
                 'total_kobo',
                   (g->>'subtotal_kobo')::BIGINT
                     + CASE WHEN (g->>'mixed_fulfilment')::BOOLEAN
                                  OR g->>'fulfilment' <> 'delivery'
                            THEN 0 ELSE (g->>'delivery_fee_kobo')::BIGINT END
               )
               ORDER BY (g->>'shop_name')
             )
        FROM (
          SELECT jsonb_build_object(
                   'vendor_id',          e->>'vendor_id',
                   'shop_name',          max(e->>'shop_name'),
                   'handle',             max(e->>'shop_handle'),
                   'verification',       max(e->>'verification'),
                   'rating_avg',         max(e->>'vendor_rating_avg')::NUMERIC,
                   'rating_count',       max(e->>'vendor_rating_count')::INT,
                   'campus_area',        max(e->>'campus_area'),
                   'fulfilment',         max(e->>'fulfilment'),
                   'mixed_fulfilment',   (min(e->>'fulfilment') <> max(e->>'fulfilment')),
                   'allows_pickup',      bool_and(COALESCE((e->>'allows_pickup')::BOOLEAN, FALSE)),
                   'delivery_fee_kobo',  sum(COALESCE((e->>'delivery_fee_kobo')::BIGINT, 0)),
                   'commission_bps',     max((e->>'commission_bps')::INT),
                   'subtotal_kobo',      sum((e->>'line_total_kobo')::BIGINT),
                   'platform_fee_kobo',  sum((e->>'platform_fee_kobo')::BIGINT),
                   'item_count',         count(*),
                   -- The line items travel with the group. Without this array the
                   -- order is created with no items at all.
                   'items',              jsonb_agg(
                                            e - 'available' - 'commission_bps' - 'platform_fee_kobo')
                 ) AS g
            FROM jsonb_array_elements(v_resolved) e
           GROUP BY e->>'vendor_id'
        ) grp
    ),
    'items', v_resolved,
    'subtotal_kobo',
      (SELECT COALESCE(sum((i->>'line_total_kobo')::BIGINT), 0) FROM jsonb_array_elements(v_resolved) i),
    'platform_fee_kobo',
      (SELECT COALESCE(sum((i->>'platform_fee_kobo')::BIGINT), 0) FROM jsonb_array_elements(v_resolved) i),
    'delivery_fee_kobo',
      (SELECT COALESCE(sum(CASE WHEN i->>'fulfilment' = 'delivery'
                                THEN COALESCE((i->>'delivery_fee_kobo')::BIGINT, 0)
                                ELSE 0 END), 0)
         FROM jsonb_array_elements(v_resolved) i),
    -- The maximum a delivery checkout can charge. mp_create_orders recomputes
    -- the authoritative figure from the groups for the fulfilment actually chosen.
    'total_kobo',
      (SELECT COALESCE(sum((i->>'line_total_kobo')::BIGINT), 0) FROM jsonb_array_elements(v_resolved) i)
      + (SELECT COALESCE(sum(CASE WHEN i->>'fulfilment' = 'delivery'
                                  THEN COALESCE((i->>'delivery_fee_kobo')::BIGINT, 0)
                                  ELSE 0 END), 0)
           FROM jsonb_array_elements(v_resolved) i),
    'requires_split',
      (SELECT EXISTS (SELECT 1
                        FROM (SELECT e->>'vendor_id' AS vid,
                                     min(e->>'fulfilment') AS lo,
                                     max(e->>'fulfilment') AS hi
                                FROM jsonb_array_elements(v_resolved) e
                               GROUP BY e->>'vendor_id') m
                       WHERE m.lo <> m.hi)),
    'currency', 'NGN'
  );
END $$;

-- Cart preview for the cart screen. Validation only — nothing is written, no
-- stock is held, so a shopper can browse freely without starving sellers.
CREATE OR REPLACE FUNCTION public.mp_price_cart(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_cart JSONB;
BEGIN
  v_cart := public.mp_compute_cart(p_items);
  RETURN v_cart || jsonb_build_object(
    'order_count', jsonb_array_length(v_cart->'vendors'),
    'payable', TRUE
  );
END $$;

COMMENT ON FUNCTION public.mp_compute_cart IS
  'Authoritative cart pricing. Resolves variant price overrides, enforces stock availability and derives commission from the category override or platform default. The client supplies only product/variant ids and quantities.';
COMMENT ON FUNCTION public.mp_price_cart IS
  'Read-only cart preview for the UI. Delegates to mp_compute_cart so the displayed total and the charged total come from identical code.';

-- =============================================================================
-- CHECKOUT — the protected transaction entry point
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_create_orders(
  p_idempotency_key TEXT,
  p_items JSONB,
  p_fulfilment public.marketplace_delivery_type,
  p_delivery JSONB DEFAULT NULL,
  p_buyer_note TEXT DEFAULT NULL,
  p_payment_provider public.marketplace_payment_provider DEFAULT 'none'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cart JSONB;
  v_group JSONB;
  v_item JSONB;
  v_checkout public.marketplace_checkouts%ROWTYPE;
  v_order public.marketplace_orders%ROWTYPE;
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_order_id UUID;
  v_payment_id UUID;
  v_orders JSONB := '[]'::JSONB;
  v_sub BIGINT; v_fee BIGINT; v_pfee BIGINT; v_total BIGINT; v_payout BIGINT;
  v_item_count INT;
  v_line_count INT;
  v_grand_total BIGINT := 0;
  v_grand_sub   BIGINT := 0;
  v_grand_fee   BIGINT := 0;
  v_grand_pfee  BIGINT := 0;
  v_delivery_snapshot JSONB;
  v_thumb TEXT;
  v_label TEXT;
  v_reserved INT;
  v_vendor_owner UUID;
  v_buyer_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to check out' USING ERRCODE = '28000';
  END IF;

  IF char_length(COALESCE(p_idempotency_key, '')) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'Invalid checkout token' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_settings.maintenance_mode THEN
    RAISE EXCEPTION 'Checkout is temporarily unavailable' USING ERRCODE = '55000';
  END IF;

  -- ── IDEMPOTENCY ──────────────────────────────────────────────────────────
  -- A duplicate submission (double tap, retry, refresh) returns the original
  -- orders. This is the guarantee that a buyer is never charged twice.
  SELECT * INTO v_checkout FROM public.marketplace_checkouts
   WHERE buyer_id = v_uid AND idempotency_key = p_idempotency_key;

  IF FOUND AND v_checkout.status = 'placed' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', o.id, 'order_number', o.order_number, 'status', o.status,
             'total_kobo', o.total_kobo, 'vendor_id', o.vendor_id,
             'payment_id', o.payment_id, 'payment_status', pay.status,
             'shop_name', v.shop_name
           ) ORDER BY o.created_at), '[]'::JSONB)
      INTO v_orders
      FROM public.marketplace_orders o
      JOIN public.marketplace_vendors v ON v.id = o.vendor_id
      LEFT JOIN public.marketplace_payments pay ON pay.id = o.payment_id
     WHERE o.checkout_id = v_checkout.id;

    RETURN jsonb_build_object(
      'checkout_id', v_checkout.id,
      'orders', v_orders,
      'order_count', jsonb_array_length(v_orders),
      'replayed', TRUE,
      'subtotal_kobo',     (SELECT COALESCE(sum(subtotal_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'delivery_fee_kobo', (SELECT COALESCE(sum(delivery_fee_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'platform_fee_kobo', (SELECT COALESCE(sum(platform_fee_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'total_kobo',        (SELECT COALESCE(sum(total_kobo), 0) FROM public.marketplace_orders WHERE checkout_id = v_checkout.id),
      'payments_enabled', v_settings.payments_enabled
    );
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.marketplace_checkouts (buyer_id, idempotency_key)
    VALUES (v_uid, p_idempotency_key)
    RETURNING * INTO v_checkout;
  END IF;

  -- ── AUTHORITATIVE PRICING + STOCK LOCKS ──────────────────────────────────
  v_cart := public.mp_compute_cart(p_items);

  -- FULFILMENT MUST BE SUPPORTED BY EVERY LINE OF EVERY VENDOR ORDER.
  --
  -- One order per vendor means one fulfilment per vendor: a single delivery
  -- cannot mean "pickup" for one line and "delivery" for another. A mixed cart
  -- is refused with an actionable message rather than priced on a guess.
  IF p_fulfilment IS NULL THEN
    RAISE EXCEPTION 'Choose pickup or delivery' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cart->'vendors') g
              WHERE (g->>'fulfilment') = 'mixed') THEN
    RAISE EXCEPTION 'Your cart mixes delivery and pickup items from the same storefront. Split them into two orders to continue.'
      USING ERRCODE = '22023';
  END IF;

  IF p_fulfilment = 'delivery' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cart->'vendors') g
                WHERE g->>'fulfilment' <> 'delivery') THEN
      RAISE EXCEPTION 'A storefront in your cart does not offer delivery. Choose pickup or split the order.'
        USING ERRCODE = '22023';
    END IF;

    IF p_delivery IS NULL
       OR char_length(trim(COALESCE(p_delivery->>'recipient_name', ''))) < 2
       OR char_length(trim(COALESCE(p_delivery->>'phone', ''))) < 7
       OR char_length(trim(COALESCE(p_delivery->>'campus_area', ''))) < 2
       OR char_length(trim(COALESCE(p_delivery->>'address_line', ''))) < 5 THEN
      RAISE EXCEPTION 'Add a delivery name, phone number, campus area and address'
        USING ERRCODE = '22023';
    END IF;

    IF trim(p_delivery->>'phone') !~ '^[0-9+][0-9+\-\s]{6,19}$' THEN
      RAISE EXCEPTION 'Enter a valid delivery phone number' USING ERRCODE = '22023';
    END IF;

    v_delivery_snapshot := jsonb_build_object(
      'recipient_name', left(trim(p_delivery->>'recipient_name'), 80),
      'phone',           left(trim(p_delivery->>'phone'), 20),
      'campus_area',     left(trim(p_delivery->>'campus_area'), 80),
      'address_line',    left(trim(p_delivery->>'address_line'), 240),
      'landmark',        left(COALESCE(p_delivery->>'landmark', ''), 160)
    );
  ELSE
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cart->'vendors') g
                WHERE NOT (g->>'allows_pickup')::BOOLEAN) THEN
      RAISE EXCEPTION 'A listing in your cart is delivery only. Choose delivery or remove it.'
        USING ERRCODE = '22023';
    END IF;

    IF char_length(trim(COALESCE(COALESCE(p_delivery->>'campus_area', ''), ''))) < 2 THEN
      RAISE EXCEPTION 'Choose where you will collect your order'
        USING ERRCODE = '22023';
    END IF;

    v_delivery_snapshot := jsonb_build_object(
      'campus_area',   left(trim(p_delivery->>'campus_area'), 80),
      'meeting_point', left(COALESCE(p_delivery->>'meeting_point', ''), 240)
    );
  END IF;

  SELECT full_name INTO v_buyer_name FROM public.profiles WHERE id = v_uid;

  -- ── ONE ORDER PER VENDOR ─────────────────────────────────────────────────
  FOR v_group IN SELECT * FROM jsonb_array_elements(v_cart->'vendors') LOOP
    v_sub  := (v_group->>'subtotal_kobo')::BIGINT;
    v_pfee := (v_group->>'platform_fee_kobo')::BIGINT;
    -- The cart priced the delivery fee for a delivery checkout. Pickup never pays
    -- it, so the figure is re-derived here from the mode actually chosen rather
    -- than trusted from the preview.
    v_fee  := CASE WHEN p_fulfilment = 'delivery'
                   THEN (v_group->>'delivery_fee_kobo')::BIGINT
                   ELSE 0 END;
    v_total := v_sub + v_fee;
    v_payout := v_sub - v_pfee;

    IF v_total <= 0 THEN
      RAISE EXCEPTION 'Order total must be greater than zero' USING ERRCODE = '22023';
    END IF;
    IF v_payout < 0 THEN
      RAISE EXCEPTION 'Commission exceeds the order subtotal; ask marketplace support' USING ERRCODE = '22023';
    END IF;

    v_grand_total  := v_grand_total + v_total;
    v_grand_sub    := v_grand_sub + v_sub;
    v_grand_fee    := v_grand_fee + v_fee;
    v_grand_pfee   := v_grand_pfee + v_pfee;

    SELECT owner_id INTO v_vendor_owner
      FROM public.marketplace_vendors WHERE id = (v_group->>'vendor_id')::UUID;

    INSERT INTO public.marketplace_orders
      (checkout_id, order_number, buyer_id, vendor_id, status,
       subtotal_kobo, delivery_fee_kobo, platform_fee_kobo, total_kobo, vendor_payout_kobo,
       fulfilment, delivery_snapshot, buyer_note, campus_area, auto_confirm_at)
    VALUES
      (v_checkout.id, public.mp_order_number(), v_uid, (v_group->>'vendor_id')::UUID, 'pending_payment',
       v_sub, v_fee, v_pfee, v_total, v_payout,
       p_fulfilment, v_delivery_snapshot, nullif(left(trim(COALESCE(p_buyer_note, '')), 800), ''),
       nullif(left(COALESCE(v_delivery_snapshot->>'campus_area', ''), 80), ''),
       now() + make_interval(hours => v_settings.auto_confirm_hours))
    RETURNING * INTO v_order;

    v_order_id := v_order.id;
    v_item_count := 0;

    -- Payment row. amount_kobo is copied from the server-computed order total,
    -- so the amount the provider is asked to charge cannot be influenced by the
    -- browser.
    INSERT INTO public.marketplace_payments
      (order_id, buyer_id, provider, amount_kobo, currency, status, channel)
    VALUES
      (v_order_id, v_uid,
       CASE WHEN v_settings.payments_enabled THEN p_payment_provider ELSE 'none' END,
       v_total, 'NGN',
       CASE WHEN v_settings.payments_enabled THEN 'awaiting_payment' ELSE 'created' END,
       'none')
    RETURNING id INTO v_payment_id;

    UPDATE public.marketplace_orders SET payment_id = v_payment_id WHERE id = v_order_id;

    -- Line items: an immutable snapshot of exactly what was on screen.
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_group->'items') LOOP
      IF v_item->>'title' IS NULL
         OR COALESCE((v_item->>'unit_price_kobo')::BIGINT, -1) < 0
         OR COALESCE((v_item->>'quantity')::INT, 0) < 1 THEN
        RAISE EXCEPTION 'The cart could not be priced correctly. Refresh and try again.'
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.marketplace_order_items
        (order_id, product_id, variant_id, product_title, variant_label, image_path,
         unit_price_kobo, quantity, line_total_kobo, is_service)
      VALUES
        (v_order_id, (v_item->>'product_id')::UUID, (v_item->>'variant_id')::UUID,
         left(v_item->>'title', 200), v_item->>'variant_label', v_item->>'thumbnail_path',
         (v_item->>'unit_price_kobo')::BIGINT, (v_item->>'quantity')::INT,
         (v_item->>'line_total_kobo')::BIGINT, false);

      v_item_count := v_item_count + 1;

      -- ── RESERVE STOCK ────────────────────────────────────────────────────
      -- Held as quantity_reserved. Because mp_compute_cart already locked the
      -- row FOR UPDATE and re-checked availability, this UPDATE cannot drive
      -- stock negative, and the CHECK constraint is the final backstop.
      --
      -- The stock LEDGER is not written here. A reservation moves no stock: the
      -- 'sale' entry is written when the order completes and the
      -- 'reservation_released' entry when it is cancelled, both from
      -- mp_transition_order. Writing a zero-delta 'sale' row at checkout would
      -- put a false movement in the audit trail.
      IF (v_item->>'variant_id')::UUID IS NULL THEN
        UPDATE public.marketplace_products
           SET quantity_reserved = quantity_reserved + (v_item->>'quantity')::INT,
               -- The CASE reads the pre-UPDATE quantity_reserved, so the new
               -- balance is expressed explicitly. Otherwise reserving the very
               -- last unit would leave the listing showing as available.
               status = CASE
                          WHEN quantity_total - quantity_sold
                               - (quantity_reserved + (v_item->>'quantity')::INT) <= 0
                            THEN 'sold_out'::public.marketplace_listing_status
                          ELSE status END,
               updated_at = now()
         WHERE id = (v_item->>'product_id')::UUID;
      ELSE
        UPDATE public.marketplace_product_variants
           SET quantity_reserved = quantity_reserved + (v_item->>'quantity')::INT,
               is_available = quantity_total - quantity_sold
                              - (quantity_reserved + (v_item->>'quantity')::INT) > 0,
               updated_at = now()
         WHERE id = (v_item->>'variant_id')::UUID;
      END IF;
    END LOOP;

    -- Order-level conversation, opened at checkout so buyer and vendor can
    -- coordinate fulfilment immediately.
    PERFORM public.mp_upsert_conversation(v_order_id, v_order.vendor_id, v_uid, 'order');

    INSERT INTO public.marketplace_order_status_history
      (order_id, from_status, to_status, actor_id, actor_role, reason, metadata)
    VALUES
      (v_order_id, NULL, 'pending_payment', v_uid, 'buyer', 'Order created at checkout',
       jsonb_build_object('total_kobo', v_total, 'items', v_item_count));

    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'id', v_order_id,
      'order_number', v_order.order_number,
      'vendor_id', v_order.vendor_id,
      'shop_name', v_group->>'shop_name',
      'subtotal_kobo', v_sub,
      'delivery_fee_kobo', v_fee,
      'platform_fee_kobo', v_pfee,
      'total_kobo', v_total,
      'vendor_payout_kobo', v_payout,
      'status', 'pending_payment',
      'payment_id', v_payment_id
    ));

    PERFORM public.mp_notify(
      v_vendor_owner,
      'order_placed',
      'New order ' || v_order.order_number,
      format('%s ordered %s item(s) for NGN %s. Accept or decline from your dashboard.',
        COALESCE(v_buyer_name, 'A student'), v_item_count,
        to_char(v_total / 100.0, 'FM999999999990.00')),
      '/vendor/orders/' || v_order_id::TEXT,
      'order', v_order_id,
      'order_placed:' || v_order_id::TEXT);
  END LOOP;

UPDATE public.marketplace_checkouts
     SET status = 'placed', order_count = jsonb_array_length(v_orders)
   WHERE id = v_checkout.id;

-- Totals reported back are the ones actually written to marketplace_orders, not
-- the preview figures, so a rounding or fulfilment difference can never be
-- presented to the student as a different amount than they were charged.
PERFORM public.mp_audit('checkout.create', 'checkout', v_checkout.id, NULL,
  jsonb_build_object(
    'orders', jsonb_array_length(v_orders),
    'subtotal_kobo', v_grand_sub,
    'delivery_fee_kobo', v_grand_fee,
    'platform_fee_kobo', v_grand_pfee,
    'total_kobo', v_grand_total,
    'fulfilment', p_fulfilment
  ), NULL, 'buyer');

RETURN jsonb_build_object(
  'checkout_id', v_checkout.id,
  'orders', v_orders,
  'order_count', jsonb_array_length(v_orders),
  'subtotal_kobo', v_grand_sub,
  'delivery_fee_kobo', v_grand_fee,
  'platform_fee_kobo', v_grand_pfee,
  'total_kobo', v_grand_total,
  'fulfilment', p_fulfilment,
  'replayed', FALSE,
  'payments_enabled', v_settings.payments_enabled
);
END $$;

COMMENT ON FUNCTION public.mp_create_orders IS
  'Protected checkout. Prices, fees and commission come from the catalogue; stock is reserved under FOR UPDATE row locks; (buyer_id, idempotency_key) makes a duplicate submission return the original orders instead of charging twice. Accepts no user id, vendor id, price or total.';

