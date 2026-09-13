-- =============================================================================
-- FUW E-Library — DIRECT MESSAGING & MESSAGING FIX (2026-09-13)
--
-- Fixes + new features:
--   1. FIX (critical): messages.sender_id pointed at auth.users(id). PostgREST
--      only exposes the `public` schema, so the `sender:sender_id(...)` embed
--      produced: "could not find a relationship between 'messages' and
--      'sender_id' in the schema cache". FK now targets profiles(id) and the
--      schema cache is reloaded (NOTIFY pgrst).
--   2. FIX: conversations had NO UPDATE policy, so the client's
--      `conversations.update({ last_message_at })` after each send was
--      silently denied (messages could appear sent while the list ordering never
--      updated). Added a participant update policy.
--   3. Participant model: conversations SELECT/INSERT and messages SELECT/
--      INSERT/UPDATE now treat BOTH student_id and created_by as participants
--      (was student_id + admin only), so direct student↔student chats are
--      governed by the same policies.
--   4. Direct chats: conversations.is_direct + pair_key (LEAST/GREATEST of the
--      two participant ids). A unique partial index guarantees Abraham→John and
--      John→Abraham resolve to the SAME conversation.
--   5. messages.receiver_id + read_at: recipient is derived server-side by a
--      BEFORE INSERT trigger (never trusted from the client). read_at is set by
--      mark-read.
--   6. safe_profiles view: cross-user display names/avatars are readable for
--      messaging without exposing profiles (email, phone, etc. are NOT in the
--      view). This fixes sender-name rendering that profiles RLS made null.
--   7. Server-side message notifications: a SECURITY DEFINER AFTER INSERT
--      trigger writes the notifications row for the recipient (the old client
--      inserts were RLS-denied — notifications had no INSERT policy). The
--      recipient still gets a realtime notification-bell ping.
--   8. search_students() SECURITY DEFINER RPC: authenticated username/full_name
--      search returning ONLY safe fields (no email, no auth data).
--   9. get_or_create_direct_conversation() SECURITY DEFINER RPC: atomically
--      finds (by pair_key) or creates the peer conversation; validates the peer
--      is a real, active student and is not self.
--  10. Realtime: public.messages added to the supabase_realtime publication so
--      chat threads update live (RLS still applies per-subscriber).
--
-- Idempotent and safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. messages.sender_id → profiles(id)  (fixes the PostgREST relationship)
-- -----------------------------------------------------------------------------
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles(id);

-- -----------------------------------------------------------------------------
-- 2. conversations: direct-chat fields + pair-key dedupe + update policy
-- -----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_direct boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pair_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_direct_pair
  ON public.conversations (pair_key)
  WHERE is_direct AND pair_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_created_by
  ON public.conversations (created_by, last_message_at DESC);

-- Participant update policy (fixes silent last_message_at failures).
DROP POLICY IF EXISTS "conv_update_participant" ON public.conversations;
CREATE POLICY "conv_update_participant" ON public.conversations
  FOR UPDATE USING (
    public.is_admin()
    OR auth.uid() = student_id
    OR auth.uid() = created_by
  );

-- -----------------------------------------------------------------------------
-- 3. conversations RLS rewrite (student_id OR created_by = participant)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "conv_select_student" ON public.conversations;
CREATE POLICY "conv_select_student" ON public.conversations
  FOR SELECT USING (auth.uid() = student_id OR auth.uid() = created_by);

DROP POLICY IF EXISTS "conv_select_admin" ON public.conversations;
CREATE POLICY "conv_select_admin" ON public.conversations
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "conv_insert_participant" ON public.conversations;
CREATE POLICY "conv_insert_participant" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.is_admin() AND created_by = auth.uid())
    OR (student_id = auth.uid() AND created_by = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 4. messages RLS rewrite (participant = student_id OR created_by OR admin)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "msg_select_conv_participant" ON public.messages;
CREATE POLICY "msg_select_conv_participant" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.student_id = auth.uid() OR c.created_by = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "msg_insert_sender" ON public.messages;
CREATE POLICY "msg_insert_sender" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid() OR c.created_by = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "msg_update_conv_participant" ON public.messages;
CREATE POLICY "msg_update_conv_participant" ON public.messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.student_id = auth.uid() OR c.created_by = auth.uid() OR public.is_admin())
    )
  );

-- -----------------------------------------------------------------------------
-- 5. messages.receiver_id / read_at + server-side recipient derivation
-- -----------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS receiver_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_msg_receiver_read
  ON public.messages (receiver_id, is_read);

CREATE OR REPLACE FUNCTION public.set_message_receiver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT CASE
    WHEN c.student_id = NEW.sender_id THEN c.created_by
    ELSE c.student_id
  END
  INTO NEW.receiver_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_set_receiver ON public.messages;
CREATE TRIGGER trg_messages_set_receiver
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_message_receiver();

-- -----------------------------------------------------------------------------
-- 6. safe_profiles view: display fields for messaging participants only.
--    Runs with definer privileges so it can read other students' display data
--    WITHOUT exposing private columns (email, phone, auth, permissions…).
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.safe_profiles;
CREATE VIEW public.safe_profiles AS
SELECT
  id,
  username,
  full_name,
  display_name,
  role,
  is_active,
  faculty,
  department,
  level,
  matric_number,
  avatar_url,
  bio
FROM public.profiles;

GRANT SELECT ON public.safe_profiles TO authenticated;
REVOKE SELECT ON public.safe_profiles FROM anon;

-- -----------------------------------------------------------------------------
-- 7. Server-side notification for new messages (replaces RLS-denied inserts)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_message_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender_name text;
  v_recipient uuid;
  v_sender_role text;
BEGIN
  SELECT COALESCE(p.display_name, p.full_name, p.username, 'User'), p.role::text
  INTO v_sender_name, v_sender_role
  FROM public.profiles p
  WHERE p.id = NEW.sender_id;

  IF COALESCE(v_sender_role, 'student') IN ('admin', 'super_admin') THEN
    v_sender_name := 'Admin';
  END IF;

  SELECT CASE
    WHEN c.student_id = NEW.sender_id THEN c.created_by
    ELSE c.student_id
  END INTO v_recipient
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  -- Self-started "Message Admin" threads (student_id = created_by = sender):
  -- notify the active admin pool instead so the inquiry reaches an admin.
  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT p.id,
           'New message from ' || v_sender_name,
           left(NEW.body, 100) || CASE WHEN length(NEW.body) > 100 THEN '…' ELSE '' END,
           'info',
           '/admin/messages'
    FROM public.profiles p
    WHERE p.role IN ('admin', 'super_admin') AND p.is_active = true;

    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, link
  ) VALUES (
    v_recipient,
    'New message from ' || v_sender_name,
    left(NEW.body, 100) || CASE WHEN length(NEW.body) > 100 THEN '…' ELSE '' END,
    'info',
    '/student/messages'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_notify ON public.messages;
CREATE TRIGGER trg_messages_notify
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_message_recipient();

-- -----------------------------------------------------------------------------
-- 8. search_students(): safe authenticated username/full_name search
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_students(
  p_query text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  display_name text,
  matric_number text,
  faculty text,
  department text,
  level text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pr.id,
    pr.username,
    pr.full_name,
    pr.display_name,
    pr.matric_number,
    pr.faculty,
    pr.department,
    pr.level
  FROM public.profiles pr
  WHERE pr.role = 'student'
    AND pr.is_active = true
    AND pr.id <> auth.uid()
    AND (
      (pr.username IS NOT NULL AND pr.username ILIKE '%' || p_query || '%')
      OR (pr.full_name IS NOT NULL AND pr.full_name ILIKE '%' || p_query || '%')
    )
  ORDER BY
    CASE WHEN pr.username ILIKE p_query || '%' THEN 0 ELSE 1 END,
    pr.username NULLS LAST,
    pr.full_name
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.search_students(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_students(text, integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. get_or_create_direct_conversation(): find-or-create a peer conversation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
  p_other_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_pair text;
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_other_id IS NULL OR p_other_id = v_me THEN
    RAISE EXCEPTION 'Cannot chat with yourself';
  END IF;

  -- The peer must be a real, active student profile.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_other_id AND p.role = 'student' AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;

  v_pair := LEAST(v_me, p_other_id)::text || ':' || GREATEST(v_me, p_other_id)::text;

  SELECT * INTO v_conv
  FROM public.conversations c
  WHERE c.is_direct AND c.pair_key = v_pair
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.conversations (
      subject, student_id, created_by, last_message_at, created_at, is_direct, pair_key
    ) VALUES (
      '', v_me, p_other_id, now(), now(), true, v_pair
    )
    RETURNING * INTO v_conv;
  END IF;

  RETURN to_jsonb(v_conv);
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. Realtime: publish messages (participant RLS still applies per subscriber)
-- -----------------------------------------------------------------------------
DO $do$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END
$do$;

-- -----------------------------------------------------------------------------
-- Reload PostgREST schema cache so the new relationship is immediately visible.
-- -----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;