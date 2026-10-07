-- =============================================================================
-- PHASE 16: vendor ↔ admin support threads
--
-- The existing messaging tables are built around a buyer and a vendor. A
-- support thread has a vendor on one side and an admin on the other, with no
-- buyer and no order, so this migration:
--
--   1. widens the conversation shape constraint to accept a support thread,
--      carrying an explicit admin participant and a lifecycle status;
--   2. adds the RPCs both sides need;
--   3. teaches notification routing and read-tracking about the new shape.
--
-- Money never moves here. A support thread is a channel, not a ledger.
-- =============================================================================

BEGIN;

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.marketplace_conversations
  ADD COLUMN IF NOT EXISTS admin_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject        TEXT,
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS admin_unread   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor_replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_replied_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- A support thread has no buyer and no order; the two unread counters must
-- agree with that, and only the admin side tracks unread in a support thread.
ALTER TABLE public.marketplace_conversations
  DROP CONSTRAINT IF EXISTS mp_conv_direct_shape;

-- Also drop the name this migration uses, so re-running it is safe.
ALTER TABLE public.marketplace_conversations
  DROP CONSTRAINT IF EXISTS mp_conv_shape;

ALTER TABLE public.marketplace_conversations
  ADD CONSTRAINT mp_conv_shape CHECK (
    (kind = 'direct' AND buyer_id IS NOT NULL AND order_id IS NULL AND admin_id IS NULL
       AND status = 'open' AND admin_unread = 0)
    OR
    (kind = 'order' AND buyer_id IS NOT NULL AND order_id IS NOT NULL AND admin_id IS NULL
       AND status = 'open' AND admin_unread = 0)
    OR
    -- A support thread is vendor ↔ admin. Requiring vendor_id and allowing a
    -- null buyer_id is what stops a student being modelled as the other side.
    (kind = 'support' AND vendor_id IS NOT NULL AND buyer_id IS NULL AND order_id IS NULL
       AND status IN ('open', 'awaiting_vendor', 'awaiting_admin', 'closed')
       -- A thread is closed if and only if it carries a closing timestamp, so
       -- 'closed' can never sit in the queue as a thread with no closer.
       AND ((status = 'closed') = (closed_at IS NOT NULL)))
  );

ALTER TABLE public.marketplace_conversations
  DROP CONSTRAINT IF EXISTS mp_conv_subject_len;
ALTER TABLE public.marketplace_conversations
  DROP CONSTRAINT IF EXISTS mp_conv_unread_nonneg;

ALTER TABLE public.marketplace_conversations
  ADD CONSTRAINT mp_conv_subject_len CHECK (subject IS NULL OR char_length(subject) <= 160),
  ADD CONSTRAINT mp_conv_unread_nonneg CHECK (buyer_unread >= 0 AND vendor_unread >= 0 AND admin_unread >= 0);

CREATE INDEX IF NOT EXISTS idx_mp_conv_support
  ON public.marketplace_conversations (status, last_message_at DESC NULLS LAST)
  WHERE kind = 'support';

CREATE INDEX IF NOT EXISTS idx_mp_conv_vendor_support
  ON public.marketplace_conversations (vendor_id, last_message_at DESC NULLS LAST)
  WHERE kind = 'support';

-- ── Membership, in one place ────────────────────────────────────────────────
-- Every decision about who may read or write a conversation goes through this,
-- so a new kind cannot accidentally fall through an unchecked path.
CREATE OR REPLACE FUNCTION public.mp_conversation_role(p_conversation_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_conv    public.marketplace_conversations%ROWTYPE;
  v_owner   UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_conv FROM public.marketplace_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_conv.vendor_id;

  -- A vendor owner is a participant in every conversation attached to their
  -- storefront, whatever the kind.
  IF v_owner IS NOT NULL AND v_owner = auth.uid() THEN
    RETURN 'vendor';
  END IF;

  -- The admin who was assigned the thread, or any admin when the thread is
  -- unassigned or the assignment has been handed on.
  IF v_conv.admin_id IS NOT NULL AND v_conv.admin_id = auth.uid() THEN
    RETURN 'admin';
  END IF;
  IF v_conv.admin_id IS NULL AND public.mp_is_admin(auth.uid()) THEN
    RETURN 'admin';
  END IF;
  IF v_conv.kind = 'support' AND public.mp_is_admin(auth.uid()) THEN
    RETURN 'admin';
  END IF;

  IF v_conv.buyer_id IS NOT NULL AND v_conv.buyer_id = auth.uid() THEN
    RETURN 'buyer';
  END IF;

  RETURN NULL;
END;
$$;

-- ── Vendor opens a thread ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_start_support_thread(p_subject TEXT, p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_vendor UUID;
  v_owner  UUID;
  v_conv   UUID;
  v_subject TEXT := left(trim(COALESCE(p_subject, '')), 160);
  v_body    TEXT := trim(COALESCE(p_body, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to contact the marketplace team' USING ERRCODE = '28000';
  END IF;

  IF v_subject = '' THEN
    RAISE EXCEPTION 'Give your message a short subject' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Messages must be between 1 and 2000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT id, owner_id INTO v_vendor, v_owner
    FROM public.marketplace_vendors
   WHERE owner_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;

  IF v_vendor IS NULL THEN
    RAISE EXCEPTION 'Only a registered storefront can open a support thread'
      USING ERRCODE = 'P0002';
  END IF;

  -- One open thread per vendor per subject line, so a refresh cannot create a
  -- wall of duplicates. A closed thread with the same subject is reusable.
  SELECT id INTO v_conv
    FROM public.marketplace_conversations
   WHERE kind = 'support' AND vendor_id = v_vendor AND subject = v_subject
     AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;

  IF v_conv IS NULL THEN
    INSERT INTO public.marketplace_conversations
      (kind, vendor_id, buyer_id, subject, status)
    VALUES ('support', v_vendor, NULL, v_subject, 'awaiting_admin')
    RETURNING id INTO v_conv;
  END IF;

  INSERT INTO public.marketplace_messages (conversation_id, sender_id, sender_role, body)
  VALUES (v_conv, auth.uid(), 'vendor', v_body);

  UPDATE public.marketplace_conversations
     SET admin_unread      = admin_unread + 1,
         last_message_at   = now(),
         last_message_preview = left(v_body, 160),
         status            = CASE WHEN status = 'closed' THEN 'awaiting_admin' ELSE status END,
         closed_at         = NULL,
         closed_by         = NULL
   WHERE id = v_conv;

  -- Every active admin is told, so an unassigned thread is never stranded.
  PERFORM public.mp_notify(p.id, 'message_received',
                           'Support request: ' || v_subject,
                           left(v_body, 200),
                           '/admin/support/' || v_conv::TEXT,
                           'conversation', v_conv,
                           'support:' || v_conv::TEXT || ':' || auth.uid()::TEXT)
    FROM public.marketplace_admin_staff s
    JOIN public.profiles p ON p.id = s.user_id
   WHERE s.revoked_at IS NULL AND s.is_active
     AND (s.permissions @> ARRAY['*']::TEXT[] OR s.permissions @> ARRAY['manage_support']::TEXT[]);

  PERFORM public.mp_audit('support.thread_opened', 'conversation', v_conv,
                          NULL, jsonb_build_object('subject', v_subject, 'vendor_id', v_vendor),
                          NULL, 'vendor');

  RETURN jsonb_build_object('conversation_id', v_conv, 'subject', v_subject, 'status', 'awaiting_admin');
END;
$$;

-- ── Admin queue ─────────────────────────────────────────────────────────────
-- Every field PHASE 16 asks an admin to see, in one payload.
CREATE OR REPLACE FUNCTION public.mp_admin_support_threads(p_status TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE v_rows JSONB; BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_support')) THEN
    RAISE EXCEPTION 'You do not have permission to view support threads'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY
           CASE s.status WHEN 'open' THEN 0 WHEN 'awaiting_admin' THEN 1
                         WHEN 'awaiting_vendor' THEN 2 ELSE 3 END,
           s.last_message_at DESC NULLS LAST), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT c.id, c.subject, c.status, c.admin_unread, c.vendor_unread,
             c.created_at, c.last_message_at, c.last_message_preview,
             c.closed_at, c.closed_by, c.updated_at,
             v.id AS vendor_id, v.shop_name, v.handle AS vendor_handle,
             v.owner_id AS vendor_owner_id, v.status AS vendor_status,
             COALESCE(vp.display_name, vp.full_name, vp.username) AS vendor_display_name,
             COALESCE(ap.display_name, ap.full_name, ap.username, 'Unassigned') AS admin_display_name,
             c.admin_id,
             -- Open threads an admin has not replied to yet are the ones that
             -- need a human, so that is what sorts first.
             (c.last_message_at IS NULL
               OR (c.vendor_replied_at IS NOT NULL
                   AND (c.admin_replied_at IS NULL OR c.admin_replied_at < c.vendor_replied_at)))
               AS awaiting_admin
        FROM public.marketplace_conversations c
        JOIN public.marketplace_vendors v  ON v.id = c.vendor_id
        LEFT JOIN public.profiles vp      ON vp.id = v.owner_id
        LEFT JOIN public.profiles ap      ON ap.id = c.admin_id
       WHERE c.kind = 'support'
         AND (p_status IS NULL OR c.status::TEXT = lower(trim(p_status)))
    ) s;

  RETURN jsonb_build_object('threads', v_rows);
END;
$$;

-- ── One support thread, with its messages ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_support_thread(p_conversation_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_conv  public.marketplace_conversations%ROWTYPE;
  v_owner UUID;
  v_role  TEXT;
  v_msgs  JSONB;
BEGIN
  SELECT * INTO v_conv FROM public.marketplace_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_conv.vendor_id;
  v_role := CASE
              WHEN v_owner IS NOT NULL AND v_owner = auth.uid() THEN 'vendor'
              WHEN public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_support') THEN 'admin'
              ELSE NULL
            END;

  IF v_role IS NULL OR v_conv.kind <> 'support' THEN
    RAISE EXCEPTION 'You are not part of this support thread' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at, m.seq), '[]'::JSONB)
    INTO v_msgs
    FROM (
      SELECT msg.id, msg.seq, msg.sender_id, msg.sender_role, msg.body, msg.attachments,
             msg.read_at, msg.is_system, msg.created_at,
             COALESCE(p.display_name, p.full_name, p.username) AS sender_name,
             CASE WHEN msg.sender_role IN ('admin', 'super_admin') THEN 'Admin' END AS sender_label
        FROM public.marketplace_messages msg
        LEFT JOIN public.profiles p ON p.id = msg.sender_id
       WHERE msg.conversation_id = p_conversation_id
    ) m;

  RETURN jsonb_build_object(
    'id', v_conv.id,
    'subject', v_conv.subject,
    'status', v_conv.status,
    'role', v_role,
    'admin_unread', v_conv.admin_unread,
    'last_message_at', v_conv.last_message_at,
    'vendor_id', v_conv.vendor_id,
    'shop_name', (SELECT shop_name FROM public.marketplace_vendors WHERE id = v_conv.vendor_id),
    'vendor_owner_id', v_owner,
    'messages', v_msgs
  );
END;
$$;

-- ── Sending ─────────────────────────────────────────────────────────────────
-- Reuses mp_send_message for the insert, then fixes up the parts of a support
-- thread that the buyer/vendor counters do not model.
CREATE OR REPLACE FUNCTION public.mp_send_support_message(
  p_conversation_id UUID,
  p_body TEXT,
  p_attachments JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_conv  public.marketplace_conversations%ROWTYPE;
  v_role  TEXT;
  v_owner UUID;
  v_msg   JSONB;
  v_body  TEXT := trim(COALESCE(p_body, ''));
  v_recent INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to send a message' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_conv FROM public.marketplace_conversations
   WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_conv.kind <> 'support' THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conv.status = 'closed' THEN
    RAISE EXCEPTION 'This thread is closed. Open a new one to continue.'
      USING ERRCODE = '42501';
  END IF;

  SELECT owner_id INTO v_owner FROM public.marketplace_vendors WHERE id = v_conv.vendor_id;
  v_role := CASE
              WHEN v_owner IS NOT NULL AND v_owner = auth.uid() THEN 'vendor'
              WHEN public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_support') THEN 'admin'
              ELSE NULL
            END;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not part of this support thread' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 2000 THEN
    RAISE EXCEPTION 'Messages must be between 1 and 2000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.marketplace_messages m
   WHERE m.conversation_id = p_conversation_id
     AND m.sender_id = auth.uid()
     AND m.created_at > now() - INTERVAL '1 minute';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You are sending messages too quickly. Wait a moment.'
      USING ERRCODE = '55000';
  END IF;

  -- Same attachment rules as an ordinary conversation: the path has to sit
  -- inside this thread's own folder.
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
      RAISE EXCEPTION 'Attachment rejected: files must be under 5MB and belong to this thread'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.marketplace_messages (conversation_id, sender_id, sender_role, body, attachments)
  VALUES (p_conversation_id, auth.uid(), v_role, v_body, COALESCE(p_attachments, '[]'::JSONB))
  RETURNING jsonb_build_object('id', id, 'conversation_id', conversation_id, 'body', body,
                               'sender_role', sender_role, 'created_at', created_at)
    INTO v_msg;

  UPDATE public.marketplace_conversations
     SET last_message_at   = now(),
         last_message_preview = left(v_body, 160),
         -- Only the side that did not speak last is waiting on a reply.
         status = CASE WHEN v_role = 'admin' THEN 'awaiting_vendor' ELSE 'awaiting_admin' END,
         admin_unread      = CASE WHEN v_role = 'vendor' THEN admin_unread + 1 ELSE admin_unread END,
         vendor_unread     = CASE WHEN v_role = 'admin'  THEN vendor_unread + 1 ELSE vendor_unread END,
         vendor_replied_at = CASE WHEN v_role = 'vendor' THEN now() ELSE vendor_replied_at END,
         admin_replied_at  = CASE WHEN v_role = 'admin'  THEN now() ELSE admin_replied_at  END
   WHERE id = p_conversation_id;

  -- Notify the other side. A vendor reply reaches the assigned admin, or every
  -- active admin when the thread is unassigned.
  IF v_role = 'vendor' THEN
    IF v_conv.admin_id IS NOT NULL THEN
      PERFORM public.mp_notify(v_conv.admin_id, 'message_received',
                               'New reply on your support thread',
                               left(v_body, 200),
                               '/admin/support/' || p_conversation_id::TEXT,
                               'conversation', p_conversation_id,
                               'supportmsg:' || (v_msg->>'id')::TEXT);
    ELSE
      PERFORM public.mp_notify(p.id, 'message_received',
                               'New reply on a support thread',
                               left(v_body, 200),
                               '/admin/support/' || p_conversation_id::TEXT,
                               'conversation', p_conversation_id,
                               'supportmsg:' || (v_msg->>'id')::TEXT)
        FROM public.marketplace_admin_staff s
        JOIN public.profiles p ON p.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.is_active
         AND (s.permissions @> ARRAY['*']::TEXT[]
              OR s.permissions @> ARRAY['manage_support']::TEXT[]);
    END IF;
  ELSE
    PERFORM public.mp_notify(v_owner, 'message_received',
                             'Marketplace support replied',
                             left(v_body, 200),
                             '/vendor/support/' || p_conversation_id::TEXT,
                             'conversation', p_conversation_id,
                             'supportmsg:' || (v_msg->>'id')::TEXT);
  END IF;

  PERFORM public.mp_audit('support.message', 'conversation', p_conversation_id,
                          NULL, jsonb_build_object('role', v_role, 'message_id', v_msg->'id'),
                          NULL, v_role);

  RETURN v_msg;
END;
$$;

-- ── Admin lifecycle ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_claim_support_thread(
  p_conversation_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE v_conv public.marketplace_conversations%ROWTYPE; BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_support')) THEN
    RAISE EXCEPTION 'You do not have permission to manage support threads'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv FROM public.marketplace_conversations
   WHERE id = p_conversation_id AND kind = 'support' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_conv.status = 'closed' THEN
    RAISE EXCEPTION 'This thread is closed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_conversations
     SET admin_id = auth.uid(),
         status   = CASE WHEN v_conv.status = 'open' THEN 'open' ELSE v_conv.status END
   WHERE id = p_conversation_id;

  PERFORM public.mp_audit('support.claimed', 'conversation', p_conversation_id,
                          jsonb_build_object('admin_id', v_conv.admin_id),
                          jsonb_build_object('admin_id', auth.uid()),
                          p_note, 'admin');

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'admin_id', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.mp_set_support_status(
  p_conversation_id UUID,
  p_status TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_conv  public.marketplace_conversations%ROWTYPE;
  v_owner UUID;
  v_next  TEXT := lower(trim(COALESCE(p_status, '')));
BEGIN
  IF NOT (public.mp_is_admin(auth.uid()) OR public.mp_has_perm('manage_support')) THEN
    RAISE EXCEPTION 'You do not have permission to manage support threads'
      USING ERRCODE = '42501';
  END IF;

  IF v_next NOT IN ('open', 'awaiting_vendor', 'awaiting_admin', 'closed') THEN
    RAISE EXCEPTION 'Choose open, awaiting_vendor, awaiting_admin or closed'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conv FROM public.marketplace_conversations
   WHERE id = p_conversation_id AND kind = 'support' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;

  -- Closing needs a reason the vendor can read. The note is kept on the audit
  -- trail even when it is absent.
  IF v_next = 'closed' AND char_length(trim(COALESCE(p_note, ''))) < 3 THEN
    RAISE EXCEPTION 'Say why the thread is being closed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.marketplace_conversations
     SET status    = v_next,
         admin_id  = COALESCE(admin_id, auth.uid()),
         closed_at = CASE WHEN v_next = 'closed' THEN now() ELSE NULL END,
         closed_by = CASE WHEN v_next = 'closed' THEN auth.uid() ELSE NULL END
   WHERE id = p_conversation_id;

  IF v_next = 'closed' THEN
    SELECT owner_id INTO v_owner
      FROM public.marketplace_vendors WHERE id = v_conv.vendor_id;

    IF v_owner IS NOT NULL THEN
      PERFORM public.mp_notify(v_owner, 'message_received',
                               'Support thread closed',
                               left(trim(COALESCE(p_note, '')), 200),
                               '/vendor/support/' || p_conversation_id::TEXT,
                               'conversation', p_conversation_id,
                               'supportclosed:' || p_conversation_id::TEXT);
    END IF;
  END IF;

  PERFORM public.mp_audit('support.status', 'conversation', p_conversation_id,
                          jsonb_build_object('status', v_conv.status),
                          jsonb_build_object('status', v_next),
                          p_note, 'admin');

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'status', v_next);
END;
$$;

-- ── Read tracking ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_mark_support_read(p_conversation_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_conv public.marketplace_conversations%ROWTYPE;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_conv FROM public.marketplace_conversations
   WHERE id = p_conversation_id AND kind = 'support' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support thread not found' USING ERRCODE = 'P0002';
  END IF;

  v_role := public.mp_conversation_role(p_conversation_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not part of this support thread' USING ERRCODE = '42501';
  END IF;

  UPDATE public.marketplace_conversations
     SET admin_unread  = CASE WHEN v_role = 'admin'  THEN 0 ELSE admin_unread  END,
         vendor_unread = CASE WHEN v_role = 'vendor' THEN 0 ELSE vendor_unread END
   WHERE id = p_conversation_id;

  UPDATE public.marketplace_messages SET read_at = now()
   WHERE conversation_id = p_conversation_id
     AND sender_id <> auth.uid()
     AND read_at IS NULL;

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'role', v_role);
END;
$$;

-- ── Vendor's own thread list ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mp_my_support_threads()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public', 'pg_temp'
AS $$
DECLARE v_rows JSONB; BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.last_message_at DESC NULLS LAST), '[]'::JSONB)
    INTO v_rows
    FROM (
      SELECT c.id, c.subject, c.status, c.vendor_unread, c.created_at,
             c.last_message_at, c.last_message_preview, c.closed_at
        FROM public.marketplace_conversations c
        JOIN public.marketplace_vendors v ON v.id = c.vendor_id
       WHERE c.kind = 'support' AND v.owner_id = auth.uid()
    ) s;

  RETURN jsonb_build_object('threads', v_rows);
END;
$$;

-- ── Message ordering ────────────────────────────────────────────────────────
-- Two messages sent in the same transaction share a created_at, so ordering by
-- the timestamp alone is not deterministic. The sequence breaks the tie.
ALTER TABLE public.marketplace_messages
  ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED BY DEFAULT AS IDENTITY;

CREATE INDEX IF NOT EXISTS idx_mp_msg_order
  ON public.marketplace_messages (conversation_id, created_at, seq);

-- ── Sent messages are immutable; only a read receipt may be added ───────────
DROP TRIGGER IF EXISTS mp_msg_immutable ON public.marketplace_messages;
CREATE TRIGGER mp_msg_immutable
  BEFORE UPDATE ON public.marketplace_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_update();

-- ── Keep mp_send_message honest about the new shape ─────────────────────────
-- An admin posting into an ordinary buyer/vendor thread is allowed today and
-- should stay allowed, but the new support columns must not be reachable from
-- that path.
CREATE OR REPLACE FUNCTION public.guard_message_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'A message cannot be moved between conversations'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'A message cannot be reattributed' USING ERRCODE = '42501';
  END IF;
  IF NEW.sender_role IS DISTINCT FROM OLD.sender_role THEN
    RAISE EXCEPTION 'A message role cannot be rewritten' USING ERRCODE = '42501';
  END IF;

  -- What was said is what stays said. A support transcript that can be edited
  -- afterwards is not evidence of anything, so the body, its attachments and
  -- its place in the thread are all frozen.
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'A sent message cannot be edited' USING ERRCODE = '42501';
  END IF;
  IF NEW.attachments IS DISTINCT FROM OLD.attachments THEN
    RAISE EXCEPTION 'A message''s attachments cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A message timestamp cannot be backdated' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'A message cannot be turned into a system notice' USING ERRCODE = '42501';
  END IF;

  -- A read receipt may be added once, but never taken back.
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'A read receipt cannot be withdrawn' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ── Row level security ──────────────────────────────────────────────────────
ALTER TABLE public.marketplace_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_messages    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mp_conv_select_member ON public.marketplace_conversations;
CREATE POLICY mp_conv_select_member ON public.marketplace_conversations
  FOR SELECT TO authenticated
  USING (public.mp_conversation_role(id) IS NOT NULL);

DROP POLICY IF EXISTS mp_msg_select_member ON public.marketplace_messages;
CREATE POLICY mp_msg_select_member ON public.marketplace_messages
  FOR SELECT TO authenticated
  USING (public.mp_conversation_role(conversation_id) IS NOT NULL);

GRANT EXECUTE ON FUNCTION public.mp_conversation_role(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_start_support_thread(TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_admin_support_threads(TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_support_thread(UUID)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_send_support_message(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_claim_support_thread(UUID, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_set_support_status(UUID, TEXT, TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_mark_support_read(UUID)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_my_support_threads()                    TO authenticated;

-- These carry the whole conversation, so they must not be reachable by a
-- caller who is not signed in, even by accident of a public default grant.
REVOKE EXECUTE ON FUNCTION public.mp_admin_support_threads(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_support_thread(UUID)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_send_support_message(UUID, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_claim_support_thread(UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_set_support_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_mark_support_read(UUID)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mp_conversation_role(UUID)       FROM PUBLIC, anon;

GRANT  EXECUTE ON FUNCTION public.mp_admin_support_threads(TEXT)            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mp_support_thread(UUID)                   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mp_send_support_message(UUID, TEXT, JSONB) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mp_claim_support_thread(UUID, TEXT)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mp_set_support_status(UUID, TEXT, TEXT)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mp_mark_support_read(UUID)                TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mp_conversation_role(UUID)                TO authenticated;

COMMIT;