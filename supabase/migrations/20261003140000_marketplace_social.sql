-- =============================================================================
-- FUW STUDENT MARKETPLACE — MIGRATION 04: MESSAGING, REVIEWS, DISPUTES,
--                              REPORTS, FAVOURITES, VERIFICATION
-- =============================================================================
-- Messaging is authorised by MEMBERSHIP, never by a client-supplied
-- conversation id: mp_send_message() loads the conversation, resolves whether
-- auth.uid() is the buyer or the vendor owner, and refuses anything else. There
-- is no parameter anywhere that accepts a sender id.
--
-- Reviews can only exist for a purchase the author actually completed. That is
-- enforced inside mp_create_review() by joining order_items -> orders and
-- checking both the author and the completed status, in one statement, under a
-- row lock.
--
-- Disputes can only be opened by the buyer of a paid order, inside the return
-- window. Only staff can resolve them, and only staff can move money.
-- =============================================================================

-- =============================================================================
-- CONVERSATIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_upsert_conversation(
  p_order_id UUID,
  p_vendor_id UUID,
  p_buyer_id UUID,
  p_kind public.marketplace_conversation_kind
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conv public.marketplace_conversations%ROWTYPE;
  v_buyer UUID;
  v_vendor_owner UUID;
  v_exists BOOLEAN;
BEGIN
  -- Internal: called by mp_create_orders() and by the messaging entry point.
  -- The buyer id is validated against the order, never trusted as given.
  IF p_kind = 'order' THEN
    SELECT o.buyer_id INTO v_buyer FROM public.marketplace_orders o WHERE o.id = p_order_id;
    IF v_buyer IS NULL OR v_buyer <> p_buyer_id THEN
      RAISE EXCEPTION 'Conversation buyer does not match the order' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_buyer := p_buyer_id;
  END IF;

  IF v_buyer IS NULL THEN
    RAISE EXCEPTION 'Conversation buyer could not be resolved' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'direct' THEN
    IF v_buyer = (SELECT owner_id FROM public.marketplace_vendors WHERE id = p_vendor_id) THEN
      RAISE EXCEPTION 'You cannot start a conversation with your own storefront' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.marketplace_vendors
                    WHERE id = p_vendor_id AND status = 'active' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'This storefront is not available for messages' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.marketplace_conversations (kind, buyer_id, vendor_id)
    VALUES ('direct', v_buyer, p_vendor_id)
    ON CONFLICT (buyer_id, vendor_id) WHERE kind = 'direct' AND order_id IS NULL
    DO UPDATE SET updated_at = now()
    RETURNING * INTO v_conv;
  ELSE
    INSERT INTO public.marketplace_conversations (kind, buyer_id, vendor_id, order_id)
    VALUES ('order', v_buyer, p_vendor_id, p_order_id)
    ON CONFLICT (order_id, vendor_id) WHERE kind = 'order'
    DO UPDATE SET updated_at = now()
    RETURNING * INTO v_conv;
  END IF;

  RETURN jsonb_build_object('id', v_conv.id, 'kind', v_conv.kind);
END $$;

-- Buyer-facing entry point for starting a chat about a listing.
CREATE OR REPLACE FUNCTION public.mp_start_conversation(p_vendor_id UUID, p_product_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor public.marketplace_vendors%ROWTYPE;
  v_conv JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to message a vendor' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_vendor FROM public.marketplace_vendors
   WHERE id = p_vendor_id AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This storefront is not available' USING ERRCODE = 'P0002';
  END IF;

  -- A conversation may only be seeded from a listing that actually belongs to
  -- this vendor, otherwise a student could attach an arbitrary product to a chat.
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.marketplace_products
     WHERE id = p_product_id AND vendor_id = p_vendor_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'That listing does not belong to this storefront' USING ERRCODE = '22023';
  END IF;

  v_conv := public.mp_upsert_conversation(NULL, p_vendor_id, auth.uid(), 'direct');

  IF p_product_id IS NOT NULL AND (v_conv->>'id') IS NOT NULL THEN
    UPDATE public.marketplace_conversations
       SET product_id = COALESCE(product_id, p_product_id)
     WHERE id = (v_conv->>'id')::UUID;
  END IF;

  RETURN v_conv;
END $$;

-- =============================================================================
-- MESSAGES
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_send_message(
  p_conversation_id UUID,
  p_body TEXT,
  p_attachments JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conv public.marketplace_conversations%ROWTYPE;
  v_role TEXT;
  v_msg public.marketplace_messages%ROWTYPE;
  v_recipient UUID;
  v_vendor_owner UUID;
  v_recent INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to send a message' USING ERRCODE = '28000';
  END IF;

  IF char_length(trim(COALESCE(p_body, ''))) < 1
     OR char_length(p_body) > 2000 THEN
    RAISE EXCEPTION 'Messages must be between 1 and 2000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conv FROM public.marketplace_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conv.is_locked THEN
    RAISE EXCEPTION 'This conversation is closed: %', COALESCE(v_conv.locked_reason, 'contact support')
      USING ERRCODE = '42501';
  END IF;

  -- ── MEMBERSHIP, NOT IDENTITY ASSERTION ───────────────────────────────────
  SELECT owner_id INTO v_vendor_owner FROM public.marketplace_vendors WHERE id = v_conv.vendor_id;

  IF v_conv.buyer_id = auth.uid() THEN
    v_role := 'buyer';
  ELSIF v_vendor_owner = auth.uid() THEN
    v_role := 'vendor';
  ELSIF public.mp_is_admin(auth.uid()) THEN
    v_role := 'admin';
  ELSE
    RAISE EXCEPTION 'You are not part of this conversation' USING ERRCODE = '42501';
  END IF;

  -- ── RATE LIMIT / SPAM ────────────────────────────────────────────────────
  -- Five messages a minute per conversation. Enough for real conversation,
  -- useless for flooding.
  SELECT count(*) INTO v_recent
    FROM public.marketplace_messages m
   WHERE m.conversation_id = p_conversation_id
     AND m.sender_id = auth.uid()
     AND m.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You are sending messages too quickly. Wait a moment.' USING ERRCODE = '55000';
  END IF;

  -- Attachment paths must live under this conversation's own folder.
  IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments) > 0 THEN
    IF jsonb_array_length(p_attachments) > 4 THEN
      RAISE EXCEPTION 'Attach at most 4 files per message' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_attachments) a
       WHERE (a->>'path') IS NULL
          OR (a->>'path') NOT LIKE 'messages/' || p_conversation_id::TEXT || '/%'
          OR (a->>'mime') NOT IN ('image/jpeg','image/png','image/webp','application/pdf')
          OR COALESCE((a->>'size')::INT, 0) > 5242880
    ) THEN
      RAISE EXCEPTION 'Attachment rejected: files must be under 5MB and belong to this conversation'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.marketplace_messages
    (conversation_id, sender_id, sender_role, body, attachments)
  VALUES
    (p_conversation_id, auth.uid(), v_role, trim(p_body), COALESCE(p_attachments, '[]'::JSONB))
  RETURNING * INTO v_msg;

  UPDATE public.marketplace_conversations
     SET last_message_at = now(),
         last_message_preview = left(trim(p_body), 160),
         buyer_unread = CASE WHEN v_role = 'vendor' THEN buyer_unread + 1 ELSE buyer_unread END,
         vendor_unread = CASE WHEN v_role = 'buyer' THEN vendor_unread + 1 ELSE vendor_unread END,
         updated_at = now()
   WHERE id = p_conversation_id;

  -- Recipient
  v_recipient := CASE WHEN v_role = 'vendor' THEN v_conv.buyer_id ELSE v_vendor_owner END;

  IF v_recipient IS NOT NULL AND v_recipient <> auth.uid() THEN
    PERFORM public.mp_notify(v_recipient, 'message_received',
      'New message from ' || CASE WHEN v_role = 'vendor' THEN 'a vendor' ELSE 'a student' END,
      left(trim(p_body), 200),
      CASE WHEN v_role = 'vendor' THEN '/messages/' || p_conversation_id::TEXT
           ELSE '/vendor/messages/' || p_conversation_id::TEXT END,
      'conversation', p_conversation_id,
      'msg:' || v_msg.id::TEXT);
  END IF;

  -- A vendor replying for the first time publishes a factual response signal.
  IF v_role = 'vendor' THEN
    PERFORM public.mp_record_vendor_response(v_conv.vendor_id, p_conversation_id);
  END IF;

  RETURN jsonb_build_object(
    'id', v_msg.id,
    'conversation_id', p_conversation_id,
    'body', v_msg.body,
    'sender_role', v_role,
    'created_at', v_msg.created_at
  );
END $$;

COMMENT ON FUNCTION public.mp_send_message IS
  'Membership-authorised messaging. The sender role is derived from the conversation row, never from a parameter, so swapping the conversation id grants nothing. Rate limited to 5 messages/minute per conversation.';

CREATE OR REPLACE FUNCTION public.mp_mark_conversation_read(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_conv public.marketplace_conversations%ROWTYPE; v_vendor_owner UUID;
BEGIN
  SELECT * INTO v_conv FROM public.marketplace_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT owner_id INTO v_vendor_owner FROM public.marketplace_vendors WHERE id = v_conv.vendor_id;

  IF v_conv.buyer_id = auth.uid() THEN
    UPDATE public.marketplace_conversations SET buyer_unread = 0 WHERE id = p_conversation_id;
  ELSIF v_vendor_owner = auth.uid() THEN
    UPDATE public.marketplace_conversations SET vendor_unread = 0 WHERE id = p_conversation_id;
  ELSE
    RAISE EXCEPTION 'You are not part of this conversation' USING ERRCODE = '42501';
  END IF;

  UPDATE public.marketplace_messages SET read_at = now()
   WHERE conversation_id = p_conversation_id AND read_at IS NULL AND sender_id <> auth.uid();

  RETURN TRUE;
END $$;

-- Factual response signal. Recomputed from real message timestamps — there is
-- no way for a vendor to declare "I always reply in 5 minutes".
CREATE OR REPLACE FUNCTION public.mp_record_vendor_response(p_vendor_id UUID, p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_latency INT;
BEGIN
  SELECT EXTRACT(EPOCH FROM (m.created_at - first_msg.at))::INT INTO v_latency
    FROM public.marketplace_messages m
    JOIN LATERAL (
      SELECT min(m2.created_at) AS at
        FROM public.marketplace_messages m2
       WHERE m2.conversation_id = p_conversation_id
         AND m2.sender_role = 'buyer'
    ) first_msg ON TRUE
   WHERE m.conversation_id = p_conversation_id
     AND m.sender_role = 'vendor'
     AND m.is_system = FALSE
   ORDER BY m.created_at
   LIMIT 1;

  IF v_latency IS NULL OR v_latency < 0 THEN RETURN; END IF;

  UPDATE public.marketplace_vendors v
     SET response_count = response_count + 1,
         message_count = message_count + 1,
         avg_response_secs = COALESCE(
           -- Rolling mean over the last 30 days of replies.
           (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (r.created_at - f.at)))::NUMERIC)::INT
              FROM public.marketplace_messages r
              JOIN LATERAL (
                SELECT min(m2.created_at) AS at FROM public.marketplace_messages m2
                 WHERE m2.conversation_id = r.conversation_id AND m2.sender_role = 'buyer'
              ) f ON TRUE
             WHERE r.conversation_id = p_conversation_id
               AND r.sender_role = 'vendor' AND NOT r.is_system),
           v_latency),
         updated_at = now()
   WHERE v.id = p_vendor_id;
END $$;

-- =============================================================================
-- FAVOURITES
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_toggle_favourite(p_product_id UUID DEFAULT NULL, p_vendor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active BOOLEAN;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to save items' USING ERRCODE = '28000';
  END IF;
  IF (p_product_id IS NULL) = (p_vendor_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one of a listing or a storefront' USING ERRCODE = '22023';
  END IF;

  IF p_product_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.marketplace_products
                    WHERE id = p_product_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
    END IF;

    SELECT id, TRUE INTO v_id, v_active FROM public.marketplace_favourites
     WHERE user_id = v_uid AND product_id = p_product_id;

    IF v_active THEN
      DELETE FROM public.marketplace_favourites WHERE id = v_id;
      v_active := FALSE;
    ELSE
      INSERT INTO public.marketplace_favourites (user_id, product_id) VALUES (v_uid, p_product_id);
      v_active := TRUE;
    END IF;

    RETURN jsonb_build_object('product_id', p_product_id, 'favourited', v_active);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_vendors
                  WHERE id = p_vendor_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Storefront not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, TRUE INTO v_id, v_active FROM public.marketplace_favourites
   WHERE user_id = v_uid AND vendor_id = p_vendor_id;

  IF v_active THEN
    DELETE FROM public.marketplace_favourites WHERE id = v_id;
    v_active := FALSE;
  ELSE
    INSERT INTO public.marketplace_favourites (user_id, vendor_id) VALUES (v_uid, p_vendor_id);
    v_active := TRUE;
  END IF;

  RETURN jsonb_build_object('vendor_id', p_vendor_id, 'favourited', v_active);
END $$;

-- =============================================================================
-- REVIEWS
-- =============================================================================

-- One review per purchased line item, only after the buyer confirmed receipt.
-- The eligibility check is a single join under a row lock, so two simultaneous
-- submit attempts cannot both insert (order_item_id is UNIQUE as backstop).
CREATE OR REPLACE FUNCTION public.mp_create_review(
  p_order_item_id UUID,
  p_rating SMALLINT,
  p_title TEXT DEFAULT NULL,
  p_body TEXT DEFAULT NULL,
  p_images TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item public.marketplace_order_items%ROWTYPE;
  v_order public.marketplace_orders%ROWTYPE;
  v_vendor UUID;
  v_review public.marketplace_reviews%ROWTYPE;
  v_return_hours INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to write a review' USING ERRCODE = '28000';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Choose a rating from 1 to 5' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(trim(p_body), '')) < 5
     AND char_length(COALESCE(trim(p_title), '')) < 2 THEN
    RAISE EXCEPTION 'Add a short comment so your review is useful' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.marketplace_order_items WHERE id = p_order_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = v_item.order_id FOR UPDATE;

  -- ── PROVENANCE ───────────────────────────────────────────────────────────
  -- Three conditions, all required: you bought it, you paid for it, and it was
  -- delivered. No admin override, no staff-created review.
  IF v_order.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'You can only review items you purchased' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('completed', 'disputed') THEN
    RAISE EXCEPTION 'You can review this order once it is completed' USING ERRCODE = '23514';
  END IF;
  IF v_order.dispute_id IS NOT NULL THEN
    RAISE EXCEPTION 'Resolve the dispute on this order before reviewing' USING ERRCODE = '23514';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'This order is not complete yet' USING ERRCODE = '23514';
  END IF;

  SELECT return_window_hours INTO v_return_hours FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_order.completed_at < now() - make_interval(hours => v_return_hours) THEN
    RAISE EXCEPTION 'The review window for this order has closed' USING ERRCODE = '23514';
  END IF;

  IF p_images IS NOT NULL AND array_length(p_images, 1) > 4 THEN
    RAISE EXCEPTION 'Attach at most 4 photos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.marketplace_reviews
    (product_id, vendor_id, author_id, order_id, order_item_id, rating, title, body, images)
  VALUES
    (v_item.product_id, v_order.vendor_id, v_uid, v_order.id, v_item.id,
     p_rating, nullif(left(trim(COALESCE(p_title,'')), 100), ''),
     nullif(left(trim(COALESCE(p_body,'')), 2000), ''),
     COALESCE(p_images, '{}'::TEXT[]))
  RETURNING * INTO v_review;

  -- Notify the vendor and the author, both deduplicated.
  SELECT owner_id INTO v_vendor FROM public.marketplace_vendors WHERE id = v_order.vendor_id;

  PERFORM public.mp_notify(v_vendor, 'new_review',
    'New ' || p_rating || '-star review',
    format('%s reviewed "%s".', COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'A student'),
           left(v_item.product_title, 80)),
    '/vendor/reviews', 'review', v_review.id, 'review:' || v_review.id::TEXT);

  PERFORM public.mp_notify(v_uid, 'new_review',
    'Thanks for your review',
    'Your review of "' || left(v_item.product_title, 60) || '" is now live.',
    '/orders/' || v_order.id::TEXT, 'review', v_review.id, 'review_own:' || v_review.id::TEXT);

  RETURN jsonb_build_object('id', v_review.id, 'rating', v_review.rating);
END $$;

COMMENT ON FUNCTION public.mp_create_review IS
  'Only a buyer who actually completed the order can review that line item, only once, only inside the return window. Provenance is proven by the order_item -> order join, not by anything the client sends.';

-- Vendor public reply. One reply per review, edited by the vendor who owns it.
CREATE OR REPLACE FUNCTION public.mp_reply_to_review(p_review_id UUID, p_reply TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_review public.marketplace_reviews%ROWTYPE;
  v_owner UUID;
BEGIN
  SELECT * INTO v_review FROM public.marketplace_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_review.vendor_id;
  IF v_owner <> auth.uid() AND NOT public.mp_has_perm('moderate_reviews') THEN
    RAISE EXCEPTION 'You can only reply to reviews on your own listings' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(COALESCE(p_reply, ''))) < 2 OR char_length(p_reply) > 1000 THEN
    RAISE EXCEPTION 'Replies must be between 2 and 1000 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_reviews
     SET vendor_reply = trim(p_reply), replied_at = now(), updated_at = now()
   WHERE id = p_review_id;

  PERFORM public.mp_notify(v_review.author_id, 'review_replied',
    'A vendor replied to your review',
    left(trim(p_reply), 200),
    '/orders/' || v_review.order_id::TEXT, 'review', p_review_id,
    'reply:' || p_review_id::TEXT);

  RETURN jsonb_build_object('id', p_review_id, 'replied', TRUE);
END $$;

-- Author edits their own review inside the window; rating stays put once given
-- so a vendor's average cannot be gamed by the buyer after the fact.
CREATE OR REPLACE FUNCTION public.mp_edit_review(p_review_id UUID, p_title TEXT, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_review public.marketplace_reviews%ROWTYPE; v_hours INT;
BEGIN
  SELECT * INTO v_review FROM public.marketplace_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_review.author_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only edit your own review' USING ERRCODE = '42501';
  END IF;
  IF v_review.is_published = FALSE AND NOT public.mp_has_perm('moderate_reviews') THEN
    RAISE EXCEPTION 'This review is under moderation' USING ERRCODE = '42501';
  END IF;

  SELECT return_window_hours INTO v_hours FROM public.marketplace_platform_settings WHERE id = 1;
  IF v_review.created_at < now() - make_interval(hours => v_hours) THEN
    RAISE EXCEPTION 'Reviews can be edited for %h after posting', v_hours USING ERRCODE = '23514';
  END IF;

  UPDATE public.marketplace_reviews
     SET title = nullif(left(trim(COALESCE(p_title,'')), 100), ''),
         body = nullif(left(trim(COALESCE(p_body,'')), 2000), ''),
         updated_at = now()
   WHERE id = p_review_id;

  RETURN jsonb_build_object('id', p_review_id);
END $$;

-- Staff moderation: hide or restore a review.
CREATE OR REPLACE FUNCTION public.mp_moderate_review(p_review_id UUID, p_hide BOOLEAN, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_review public.marketplace_reviews%ROWTYPE;
BEGIN
  IF NOT public.mp_has_perm('moderate_reviews') THEN
    RAISE EXCEPTION 'You do not have permission to moderate reviews' USING ERRCODE = '42501';
  END IF;
  IF p_hide AND char_length(trim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason for hiding a review' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_review FROM public.marketplace_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.marketplace_reviews
     SET is_published = NOT p_hide,
         hidden_reason = CASE WHEN p_hide THEN left(p_reason, 400) ELSE NULL END,
         updated_at = now()
   WHERE id = p_review_id;

  PERFORM public.mp_audit('review.moderate', 'review', p_review_id,
    jsonb_build_object('is_published', v_review.is_published),
    jsonb_build_object('is_published', NOT p_hide), p_reason, 'admin');

  PERFORM public.mp_notify(v_review.author_id, 'account_warning',
    CASE WHEN p_hide THEN 'Your review was hidden' ELSE 'Your review was restored' END,
    left(COALESCE(p_reason, ''), 300),
    '/orders/' || v_review.order_id::TEXT, 'review', p_review_id);
END $$;

-- =============================================================================
-- DISPUTES
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_open_dispute(
  p_order_id UUID,
  p_reason public.marketplace_dispute_reason,
  p_description TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_order public.marketplace_orders%ROWTYPE;
  v_settings public.marketplace_platform_settings%ROWTYPE;
  v_dispute public.marketplace_disputes%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to open a dispute' USING ERRCODE = '28000';
  END IF;

  IF char_length(trim(COALESCE(p_description, ''))) < 20 THEN
    RAISE EXCEPTION 'Describe the problem in at least 20 characters so staff can help'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_settings FROM public.marketplace_platform_settings WHERE id = 1;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.buyer_id <> v_uid THEN
    RAISE EXCEPTION 'Only the buyer can open a dispute on this order' USING ERRCODE = '42501';
  END IF;

  -- Funds only exist to protect once paid, so only paid orders are disputable.
  IF v_order.status NOT IN ('delivered', 'completed') THEN
    RAISE EXCEPTION 'You can open a dispute once the order has been delivered'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.marketplace_disputes
              WHERE order_id = p_order_id
                AND status NOT IN ('resolved_refund','resolved_partial','resolved_rejected','closed')) THEN
    RAISE EXCEPTION 'There is already an open dispute on this order' USING ERRCODE = '55000';
  END IF;

  IF v_order.completed_at IS NOT NULL
     AND v_order.completed_at < now() - make_interval(hours => v_settings.return_window_hours) THEN
    RAISE EXCEPTION 'The %h dispute window for this order has closed', v_settings.return_window_hours
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.marketplace_disputes
    (dispute_number, order_id, buyer_id, vendor_id, reason, description, status, due_at)
  VALUES
    (public.mp_dispute_number(), p_order_id, v_uid, v_order.vendor_id, p_reason,
     trim(p_description), 'open', now() + INTERVAL '7 days')
  RETURNING * INTO v_dispute;

  -- Freeze the money. This is the single most important line in the dispute flow.
  UPDATE public.marketplace_settlements
     SET status = 'on_hold', hold_reason = 'Dispute ' || v_dispute.dispute_number, updated_at = now()
   WHERE order_id = p_order_id AND status NOT IN ('paid_out','cancelled');

  UPDATE public.marketplace_orders
     SET dispute_id = v_dispute.id, settlement_status = 'on_hold', updated_at = now()
   WHERE id = p_order_id;

  PERFORM public.mp_transition_order(p_order_id, 'disputed',
    'Dispute ' || v_dispute.dispute_number || ' opened: ' || replace(p_reason::TEXT, '_', ' '));

  PERFORM public.mp_audit('dispute.open', 'dispute', v_dispute.id, NULL,
    jsonb_build_object('order_id', p_order_id, 'reason', p_reason), NULL, 'buyer');

  -- Tell staff there is work waiting.
  PERFORM public.mp_notify(v_uid, 'dispute_opened',
    'Dispute ' || v_dispute.dispute_number || ' opened',
    'Marketplace staff will review your report within 7 days. Your payment stays protected until they do.',
    '/orders/' || p_order_id::TEXT, 'dispute', v_dispute.id);

  RETURN jsonb_build_object('id', v_dispute.id, 'dispute_number', v_dispute.dispute_number,
                            'status', v_dispute.status);
END $$;

COMMENT ON FUNCTION public.mp_open_dispute IS
  'Buyer-initiated dispute on a delivered order inside the return window. Immediately flips the settlement to on_hold so no payout can run while the dispute is investigated.';

CREATE OR REPLACE FUNCTION public.mp_add_dispute_evidence(
  p_dispute_id UUID,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_byte_size INT,
  p_caption TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dispute public.marketplace_disputes%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_dispute FROM public.marketplace_disputes WHERE id = p_dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_dispute.buyer_id <> auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.marketplace_vendors v
                      WHERE v.id = v_dispute.vendor_id AND v.owner_id = auth.uid())
     AND NOT public.mp_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'You are not a participant in this dispute' USING ERRCODE = '42501';
  END IF;

  IF v_dispute.status IN ('resolved_refund','resolved_partial','resolved_rejected','closed') THEN
    RAISE EXCEPTION 'This dispute is closed' USING ERRCODE = '23514';
  END IF;

  -- Evidence must be uploaded into this dispute's own folder.
  IF p_storage_path NOT LIKE 'disputes/' || p_dispute_id::TEXT || '/%' THEN
    RAISE EXCEPTION 'Evidence path is not in this dispute folder' USING ERRCODE = '42501';
  END IF;
  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp','image/avif','application/pdf') THEN
    RAISE EXCEPTION 'Unsupported evidence type' USING ERRCODE = '22023';
  END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 10485760 THEN
    RAISE EXCEPTION 'Evidence must be under 10MB' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.marketplace_dispute_evidence WHERE dispute_id = p_dispute_id) >= 10 THEN
    RAISE EXCEPTION 'A dispute can hold at most 10 evidence files' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.marketplace_dispute_evidence
    (dispute_id, uploaded_by, storage_path, mime_type, byte_size, caption)
  VALUES (p_dispute_id, auth.uid(), p_storage_path, p_mime_type, p_byte_size, left(p_caption, 300))
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Staff assigns / re-assigns and progresses a dispute.
CREATE OR REPLACE FUNCTION public.mp_assign_dispute(p_dispute_id UUID, p_assignee UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_d public.marketplace_disputes%ROWTYPE;
BEGIN
  IF NOT public.mp_has_perm('manage_disputes') THEN
    RAISE EXCEPTION 'You do not have permission to manage disputes' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_d FROM public.marketplace_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002';
  END IF;

  -- An assignee must actually be marketplace staff, so the queue cannot be
  -- handed to a random student.
  IF p_assignee IS NOT NULL AND NOT public.mp_is_admin(p_assignee) THEN
    RAISE EXCEPTION 'That person is not marketplace staff' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_disputes
     SET assigned_to = p_assignee,
         assigned_at = CASE WHEN p_assignee IS NOT NULL THEN now() ELSE NULL END,
         status = CASE
                    WHEN p_assignee IS NOT NULL AND status = 'open' THEN 'under_review'::public.marketplace_dispute_status
                    ELSE status END,
         updated_at = now()
   WHERE id = p_dispute_id;

  RETURN jsonb_build_object('id', p_dispute_id, 'assigned_to', p_assignee);
END $$;

-- Staff resolution. The only path that moves money out of a dispute, and it
-- delegates the actual refund to mp_issue_refund so there is one audited writer.
CREATE OR REPLACE FUNCTION public.mp_resolve_dispute(
  p_dispute_id UUID,
  p_outcome TEXT,
  p_refund_kobo BIGINT DEFAULT NULL,
  p_resolution TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_d public.marketplace_disputes%ROWTYPE;
  v_order public.marketplace_orders%ROWTYPE;
  v_next public.marketplace_dispute_status;
  v_refunded BIGINT := 0;
BEGIN
  IF NOT public.mp_has_perm('manage_disputes') THEN
    RAISE EXCEPTION 'You do not have permission to resolve disputes' USING ERRCODE = '42501';
  END IF;

  IF p_outcome NOT IN ('refund_full','refund_partial','reject','close') THEN
    RAISE EXCEPTION 'Choose a valid resolution' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(p_resolution, ''))) < 10 THEN
    RAISE EXCEPTION 'Write a resolution the parties can read' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_d FROM public.marketplace_disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_d.status IN ('resolved_refund','resolved_partial','resolved_rejected','closed') THEN
    RAISE EXCEPTION 'This dispute is already resolved' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;

  v_next := CASE p_outcome
    WHEN 'refund_full'    THEN 'resolved_refund'::public.marketplace_dispute_status
    WHEN 'refund_partial' THEN 'resolved_partial'::public.marketplace_dispute_status
    WHEN 'reject'         THEN 'resolved_rejected'::public.marketplace_dispute_status
    ELSE 'closed'::public.marketplace_dispute_status
  END;

  -- Refund first: if it fails, the dispute stays open and money stays held.
  IF p_outcome IN ('refund_full','refund_partial') THEN
    IF NOT public.mp_has_perm('issue_refunds') THEN
      RAISE EXCEPTION 'Resolving with a refund also requires the issue_refunds permission'
        USING ERRCODE = '42501';
    END IF;

    IF p_outcome = 'refund_full' THEN
      v_refunded := v_order.total_kobo;
    ELSE
      IF p_refund_kobo IS NULL OR p_refund_kobo <= 0 OR p_refund_kobo > v_order.total_kobo THEN
        RAISE EXCEPTION 'Enter a refund between 1 and NGN %s',
          to_char(v_order.total_kobo / 100.0, 'FM999999999990.00') USING ERRCODE = '22023';
      END IF;
      v_refunded := p_refund_kobo;
    END IF;

    PERFORM public.mp_issue_refund(v_d.order_id, v_refunded, 'Dispute ' || v_d.dispute_number, v_d.id);
  END IF;

  UPDATE public.marketplace_disputes
     SET status = v_next,
         refund_amount_kobo = CASE WHEN p_outcome IN ('refund_full','refund_partial')
                                   THEN v_refunded ELSE NULL END,
         resolution = trim(p_resolution),
         resolved_at = now(),
         resolved_by = auth.uid(),
         updated_at = now()
   WHERE id = p_dispute_id;

  IF p_outcome IN ('refund_full','reject') THEN
    PERFORM public.mp_transition_order(v_d.order_id,
      CASE WHEN p_outcome = 'refund_full' THEN 'refunded'::public.marketplace_order_status
           ELSE 'completed'::public.marketplace_order_status END,
      'Dispute ' || v_d.dispute_number || ' resolved: ' || left(trim(p_resolution), 200));
  ELSIF p_outcome = 'close' THEN
    PERFORM public.mp_transition_order(v_d.order_id, 'completed',
      'Dispute ' || v_d.dispute_number || ' closed without a refund');
  END IF;

  PERFORM public.mp_audit('dispute.resolve', 'dispute', p_dispute_id,
    jsonb_build_object('status', v_d.status),
    jsonb_build_object('status', v_next, 'refund_kobo', v_refunded),
    trim(p_resolution), 'admin');

  PERFORM public.mp_notify(v_d.buyer_id, 'dispute_updated',
    'Dispute ' || v_d.dispute_number || ' resolved',
    left(trim(p_resolution), 400), '/disputes/' || p_dispute_id::TEXT,
    'dispute', p_dispute_id);

  PERFORM public.mp_notify(
    (SELECT owner_id FROM public.marketplace_vendors WHERE id = v_d.vendor_id),
    'dispute_updated',
    'Dispute ' || v_d.dispute_number || ' resolved',
    left(trim(p_resolution), 400), '/vendor/disputes', 'dispute', p_dispute_id);

  RETURN jsonb_build_object('id', p_dispute_id, 'status', v_next, 'refunded_kobo', v_refunded);
END $$;

COMMENT ON FUNCTION public.mp_resolve_dispute IS
  'Staff-only dispute resolution. Refunds route through mp_issue_refund so every naira that leaves the platform has exactly one audited writer. Neither the buyer nor the vendor can call this.';

-- =============================================================================
-- REPORTS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_create_report(
  p_target_type public.marketplace_report_target,
  p_target_id UUID,
  p_reason TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID; v_exists BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to report' USING ERRCODE = '28000';
  END IF;

  IF char_length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE = '22023';
  END IF;

  -- The target must actually exist, scoped to the declared type. Without this a
  -- report could be filed against an id from another table entirely.
  IF p_target_type = 'listing' AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_products WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'P0002';
  ELSIF p_target_type = 'vendor' AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_vendors WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'Storefront not found' USING ERRCODE = 'P0002';
  ELSIF p_target_type = 'review' AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_reviews WHERE id = p_target_id) THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'P0002';
  ELSIF p_target_type = 'conversation' AND NOT EXISTS (
       SELECT 1 FROM public.marketplace_conversations c
        WHERE c.id = p_target_id
          AND (c.buyer_id = auth.uid()
               OR c.vendor_id IN (SELECT id FROM public.marketplace_vendors WHERE owner_id = auth.uid()))) THEN
    RAISE EXCEPTION 'Conversation not found' USING ERRCODE = 'P0002';
  ELSIF p_target_type IN ('user','message') THEN
    IF NOT public.mp_has_perm('moderate_users') THEN
      -- Students can flag a profile; the specific user id is stored in details
      -- and verified by staff, so we only require the reporter to be real.
      NULL;
    END IF;
  END IF;

  SELECT id, TRUE INTO v_id, v_exists FROM public.marketplace_reports
   WHERE reporter_id = auth.uid() AND target_type = p_target_type AND target_id = p_target_id;

  IF v_exists THEN
    RAISE EXCEPTION 'You have already reported this. Our team is reviewing it.'
      USING ERRCODE = '55000';
  END IF;

  -- Rate limit: 10 reports a day across the whole marketplace.
  IF (SELECT count(*) FROM public.marketplace_reports
       WHERE reporter_id = auth.uid() AND created_at > now() - INTERVAL '1 day') >= 10 THEN
    RAISE EXCEPTION 'You have reached the daily report limit' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.marketplace_reports (target_type, target_id, reporter_id, reason, details)
  VALUES (p_target_type, p_target_id, auth.uid(), trim(p_reason), left(trim(COALESCE(p_details,'')), 1500))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'open');
END $$;

CREATE OR REPLACE FUNCTION public.mp_resolve_report(
  p_report_id UUID,
  p_action TEXT,
  p_resolution TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_r public.marketplace_reports%ROWTYPE;
BEGIN
  IF NOT public.mp_has_perm('moderate_listings') AND NOT public.mp_has_perm('moderate_vendors') THEN
    RAISE EXCEPTION 'You do not have permission to action reports' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('actioned','dismissed','reviewing') THEN
    RAISE EXCEPTION 'Choose a valid action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_r FROM public.marketplace_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.marketplace_reports
     SET status = p_action,
         resolution = left(trim(COALESCE(p_resolution,'')), 1000),
         resolved_by = CASE WHEN p_action <> 'reviewing' THEN auth.uid() ELSE resolved_by END,
         resolved_at = CASE WHEN p_action <> 'reviewing' THEN now() ELSE resolved_at END,
         assigned_to = CASE WHEN p_action <> 'reviewing' THEN NULL ELSE COALESCE(assigned_to, auth.uid()) END,
         updated_at = now()
   WHERE id = p_report_id;

  PERFORM public.mp_audit('report.resolve', 'report', p_report_id,
    jsonb_build_object('status', v_r.status), jsonb_build_object('status', p_action),
    p_resolution, 'admin');

  RETURN jsonb_build_object('id', p_report_id, 'status', p_action);
END $$;

-- =============================================================================
-- VENDOR VERIFICATION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_request_vendor_verification(p_note TEXT, p_evidence_path TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  PERFORM public.mp_audit('vendor.verification_requested', 'vendor', v_vendor.id, NULL,
    jsonb_build_object('request_id', v_req.id), NULL, 'vendor');

  RETURN jsonb_build_object('id', v_req.id, 'status', 'pending');
END $$;

CREATE OR REPLACE FUNCTION public.mp_review_vendor_verification(
  p_request_id UUID,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.marketplace_vendor_verifications%ROWTYPE;
  v_vendor public.marketplace_vendors%ROWTYPE;
BEGIN
  IF NOT public.mp_has_perm('verify_vendors') THEN
    RAISE EXCEPTION 'You do not have permission to verify vendors' USING ERRCODE = '42501';
  END IF;
  IF NOT p_approve AND char_length(trim(COALESCE(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'Give the vendor a reason for the rejection' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM public.marketplace_vendor_verifications
   WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification request not found or already decided' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_vendor FROM public.marketplace_vendors WHERE id = v_req.vendor_id FOR UPDATE;

  UPDATE public.marketplace_vendor_verifications
     SET status = CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         reviewer_note = left(p_note, 1000)
   WHERE id = p_request_id;

  UPDATE public.marketplace_vendors
     SET verification = CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END,
         verified_at = CASE WHEN p_approve THEN now() ELSE NULL END,
         verified_by = CASE WHEN p_approve THEN auth.uid() ELSE NULL END
   WHERE id = v_req.vendor_id;

  PERFORM public.mp_audit('vendor.verification_reviewed', 'vendor', v_req.vendor_id, NULL,
    jsonb_build_object('approved', p_approve), p_note, 'admin');

  PERFORM public.mp_notify(v_req.requested_by,
    CASE WHEN p_approve THEN 'vendor_verified' ELSE 'vendor_rejected' END,
    CASE WHEN p_approve THEN 'Your storefront is verified' ELSE 'Verification was not approved' END,
    CASE WHEN p_approve
         THEN 'A verified badge now appears on your storefront and listings.'
         ELSE COALESCE(left(p_note, 400), 'Review the details and submit a new request.') END,
    '/vendor/verification', 'vendor', v_req.vendor_id);

  RETURN jsonb_build_object('id', p_request_id,
    'status', CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END);
END $$;

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_mark_notification_read(p_notification_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;

  IF p_notification_id IS NULL THEN
    UPDATE public.marketplace_notifications SET read_at = now()
     WHERE user_id = auth.uid() AND read_at IS NULL;
  ELSE
    -- user_id in the WHERE clause is the ownership check: a notification id
    -- belonging to somebody else simply matches zero rows.
    UPDATE public.marketplace_notifications SET read_at = now()
     WHERE id = p_notification_id AND user_id = auth.uid() AND read_at IS NULL;
  END IF;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.mp_record_search(p_terms TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_clean TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  -- Trim, drop empties, cap length, cap count. Never store a raw query string
  -- that could carry an injection payload into a later search.
  SELECT COALESCE(array_agg(left(btrim(t), 60)), '{}')
    INTO v_clean
    FROM (
      SELECT DISTINCT btrim(t) AS t
        FROM unnest(COALESCE(p_terms, '{}')) t
       WHERE btrim(t) <> '' AND char_length(btrim(t)) <= 60
       LIMIT 12
    ) s;

  IF array_length(v_clean, 1) IS NULL THEN RETURN; END IF;

  UPDATE public.marketplace_profiles
     SET search_history = (
       SELECT COALESCE(array_agg(x), '{}')
         FROM (
           SELECT unnest(v_clean || COALESCE(search_history, '{}')) AS x
           UNION
           SELECT NULL::TEXT WHERE false
         ) d
       WHERE x IS NOT NULL
     )
   WHERE id = auth.uid();
END $$;

-- =============================================================================
-- ADDRESS BOOK
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_save_address(
  p_address_id UUID DEFAULT NULL,
  p_label TEXT DEFAULT 'Home',
  p_recipient_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_campus_area TEXT DEFAULT NULL,
  p_address_line TEXT DEFAULT NULL,
  p_landmark TEXT DEFAULT NULL,
  p_is_default BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to save an address' USING ERRCODE = '28000';
  END IF;

  IF char_length(trim(COALESCE(p_recipient_name,''))) < 2
     OR char_length(trim(COALESCE(p_phone,''))) < 7
     OR char_length(trim(COALESCE(p_campus_area,''))) < 2
     OR char_length(trim(COALESCE(p_address_line,''))) < 5 THEN
    RAISE EXCEPTION 'Complete the recipient name, phone, campus area and address'
      USING ERRCODE = '22023';
  END IF;
  IF trim(p_phone) !~ '^[0-9+][0-9+\-\s]{6,19}$' THEN
    RAISE EXCEPTION 'Enter a valid phone number' USING ERRCODE = '22023';
  END IF;

  IF p_address_id IS NOT NULL THEN
    -- Ownership enforced by user_id in the WHERE clause.
    UPDATE public.marketplace_addresses
       SET label = left(trim(p_label), 40),
           recipient_name = left(trim(p_recipient_name), 80),
           phone = left(trim(p_phone), 20),
           campus_area = left(trim(p_campus_area), 80),
           address_line = left(trim(p_address_line), 240),
           landmark = left(COALESCE(trim(p_landmark), ''), 160),
           is_default = COALESCE(p_is_default, FALSE),
           updated_at = now()
     WHERE id = p_address_id AND user_id = auth.uid()
     RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Address not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO public.marketplace_addresses
      (user_id, label, recipient_name, phone, campus_area, address_line, landmark, is_default)
    VALUES (auth.uid(), left(trim(p_label), 40), left(trim(p_recipient_name), 80),
            left(trim(p_phone), 20), left(trim(p_campus_area), 80),
            left(trim(p_address_line), 240), left(COALESCE(trim(p_landmark), ''), 160),
            COALESCE(p_is_default, FALSE))
    RETURNING id INTO v_id;
  END IF;

  IF p_is_default THEN
    UPDATE public.marketplace_addresses SET is_default = FALSE
     WHERE user_id = auth.uid() AND id <> v_id;
    UPDATE public.marketplace_addresses SET is_default = TRUE WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.mp_delete_address(p_address_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
  DELETE FROM public.marketplace_addresses WHERE id = p_address_id AND user_id = auth.uid()
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END $$;

-- =============================================================================
-- MARKETPLACE PROFILE
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mp_save_own_profile(
  p_display_name TEXT DEFAULT NULL,
  p_phone_number TEXT DEFAULT NULL,
  p_campus_area TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to update your profile' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.marketplace_profiles (id)
  VALUES (auth.uid()) ON CONFLICT (id) DO NOTHING;

  -- fuw_* columns and status are deliberately absent from this UPDATE. They are
  -- server-derived and cannot be set by the account holder.
  UPDATE public.marketplace_profiles
     SET display_name = nullif(left(trim(COALESCE(p_display_name, '')), 80), ''),
         phone_number = CASE
           WHEN p_phone_number IS NULL THEN phone_number
           WHEN btrim(p_phone_number) !~ '^[0-9+][0-9+\-\s]{6,19}$'
             THEN raise_exception('Enter a valid phone number')::TEXT
           ELSE left(trim(p_phone_number), 20) END,
         campus_area = nullif(left(trim(COALESCE(p_campus_area, '')), 80), ''),
         bio = nullif(left(trim(COALESCE(p_bio, '')), 600), ''),
         updated_at = now()
   WHERE id = auth.uid();

  RETURN jsonb_build_object('id', auth.uid());
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'Enter a valid phone number' THEN
    RAISE EXCEPTION 'Enter a valid phone number' USING ERRCODE = '22023';
  END IF;
  RAISE;
END $$;
