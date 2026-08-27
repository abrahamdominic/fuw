-- ============================================================
-- Feature 1: Profile change tracking columns
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS matric_changes_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faculty_changes_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_changes_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level_changes_used INT NOT NULL DEFAULT 0;

-- ============================================================
-- Feature 2: Deletion Requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type  TEXT NOT NULL CHECK (request_type IN ('course', 'material')),
  item_name     TEXT NOT NULL,
  item_code     TEXT,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  admin_note    TEXT,
  reviewed_by   UUID REFERENCES auth.users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deletion_requests_student ON public.deletion_requests (student_id, created_at DESC);
CREATE INDEX idx_deletion_requests_status ON public.deletion_requests (status);

-- RLS for deletion_requests
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dr_select_own" ON public.deletion_requests
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "dr_select_admin" ON public.deletion_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

CREATE POLICY "dr_insert_own" ON public.deletion_requests
  FOR INSERT WITH CHECK (auth.uid() = student_id);

CREATE POLICY "dr_update_admin" ON public.deletion_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

CREATE POLICY "dr_delete_admin" ON public.deletion_requests
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

-- ============================================================
-- Feature 3: Conversations & Messages (Admin ↔ Student)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       TEXT NOT NULL DEFAULT '',
  material_id   TEXT,
  student_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_student ON public.conversations (student_id, last_message_at DESC);
CREATE INDEX idx_conv_material ON public.conversations (material_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id),
  body            TEXT NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_msg_conv ON public.messages (conversation_id, created_at);

-- RLS for conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_select_student" ON public.conversations
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "conv_select_admin" ON public.conversations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

CREATE POLICY "conv_insert_admin" ON public.conversations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

-- RLS for messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "msg_select_conv_participant" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')))
    )
  );

CREATE POLICY "msg_insert_sender" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')))
    )
  );

CREATE POLICY "msg_update_conv_participant" ON public.messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.student_id = auth.uid()
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')))
    )
  );

-- ============================================================
-- Feature 6: Profile Change Requests (Admin Override)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL CHECK (field_name IN ('matric_number','faculty','department','level')),
  current_value   TEXT NOT NULL,
  requested_value TEXT NOT NULL,
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note      TEXT,
  reviewed_by     UUID REFERENCES auth.users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcr_student ON public.profile_change_requests (student_id, created_at DESC);

ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcr_select_own" ON public.profile_change_requests
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "pcr_select_admin" ON public.profile_change_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );

CREATE POLICY "pcr_insert_own" ON public.profile_change_requests
  FOR INSERT WITH CHECK (auth.uid() = student_id);

CREATE POLICY "pcr_update_admin" ON public.profile_change_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))
  );
