-- Active Login Sessions
-- Tracks real browser/device sessions for each user.

CREATE TABLE IF NOT EXISTS active_sessions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_key   text NOT NULL,          -- deterministic key per browser tab (sha256 of user-agent + localStorage id)
  device_type   text NOT NULL DEFAULT 'desktop',  -- desktop | mobile | tablet
  browser       text NOT NULL DEFAULT 'Unknown',
  os            text NOT NULL DEFAULT 'Unknown',
  ip_address    text,
  location      text,                    -- best-effort approximate location
  connection_type text DEFAULT 'unknown', -- wifi | cellular | ethernet | unknown
  network_name  text,                    -- SSID if available, else null
  is_current    boolean NOT NULL DEFAULT false,
  last_active   timestamptz NOT NULL DEFAULT now(),
  login_time    timestamptz NOT NULL DEFAULT now(),
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON active_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_session_key ON active_sessions(session_key);

-- Unique constraint: one row per user+session_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_sessions_unique_key ON active_sessions(user_id, session_key);

-- RLS: students can only see/modify their own sessions; admins see all.
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- Students: read own sessions
CREATE POLICY "Students read own sessions"
  ON active_sessionS FOR SELECT
  USING (auth.uid() = user_id);

-- Students: insert own sessions (on login)
CREATE POLICY "Students insert own sessions"
  ON active_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Students: update own sessions (heartbeat, terminate)
CREATE POLICY "Students update own sessions"
  ON active_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- Students: delete own sessions (logout / terminate)
CREATE POLICY "Students delete own sessions"
  ON active_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Admins / super_admins: full access
CREATE POLICY "Admins manage all sessions"
  ON active_sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'super_admin')
    )
  );

-- RPC: terminate all other sessions for a user (excluding current session_key)
CREATE OR REPLACE FUNCTION terminate_other_sessions(p_session_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM active_sessions
  WHERE user_id = auth.uid()
    AND session_key != p_session_key;
END;
$$;

-- RPC: mark stale sessions inactive (called periodically or on read)
-- Sessions with last_active older than 30 minutes are deleted.
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM active_sessions
  WHERE last_active < now() - interval '30 minutes';
END;
$$;
