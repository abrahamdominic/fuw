-- Migration: Signal Protocol E2E (device keys, prekeys, device tracking)
-- Idempotent

CREATE TABLE IF NOT EXISTS public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL,
  device_name TEXT,
  identity_pub TEXT NOT NULL,
  registration_id INTEGER NOT NULL,
  signed_prekey_pub TEXT NOT NULL,
  signed_prekey_sig TEXT NOT NULL,
  signed_prekey_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_devices_user_device_unique UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user ON public.user_devices (user_id, active);
CREATE INDEX IF NOT EXISTS idx_user_devices_last_seen ON public.user_devices (last_seen_at DESC);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- Users can manage their own devices; admins can view if needed
DROP POLICY IF EXISTS "user_devices_select_own" ON public.user_devices;
CREATE POLICY "user_devices_select_own" ON public.user_devices
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_devices_insert_own" ON public.user_devices;
CREATE POLICY "user_devices_insert_own" ON public.user_devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_devices_update_own" ON public.user_devices;
CREATE POLICY "user_devices_update_own" ON public.user_devices
  FOR UPDATE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.user_devices(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prekeys_device_keyid_unique UNIQUE (device_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_prekeys_device_unused ON public.prekeys (device_id, used, created_at);
CREATE INDEX IF NOT EXISTS idx_prekeys_unused ON public.prekeys (used) WHERE used = false;

ALTER TABLE public.prekeys ENABLE ROW LEVEL SECURITY;

-- Only device owner can manage prekeys
DROP POLICY IF EXISTS "prekeys_select_own_device" ON public.prekeys;
CREATE POLICY "prekeys_select_own_device" ON public.prekeys
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_devices d WHERE d.id = prekeys.device_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prekeys_insert_own_device" ON public.prekeys;
CREATE POLICY "prekeys_insert_own_device" ON public.prekeys
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_devices d WHERE d.id = prekeys.device_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prekeys_update_own_device" ON public.prekeys;
CREATE POLICY "prekeys_update_own_device" ON public.prekeys
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.user_devices d WHERE d.id = prekeys.device_id AND d.user_id = auth.uid())
  );

-- RPCs for fetching prekey bundles (server consumes one-time keys)
CREATE OR REPLACE FUNCTION public.get_prekey_bundle(p_user_id UUID, p_device_id INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device record;
  v_prekey record;
  res jsonb;
BEGIN
  -- Get active device(s) for user
  IF p_device_id IS NOT NULL THEN
    SELECT id, device_id, identity_pub, registration_id, signed_prekey_pub, signed_prekey_sig, signed_prekey_created_at
    INTO v_device
    FROM public.user_devices
    WHERE user_id = p_user_id AND device_id = p_device_id AND active = true;
  ELSE
    -- Get first active device (simplified; for multi-device we need to handle all)
    SELECT id, device_id, identity_pub, registration_id, signed_prekey_pub, signed_prekey_sig, signed_prekey_created_at
    INTO v_device
    FROM public.user_devices
    WHERE user_id = p_user_id AND active = true
    ORDER BY last_seen_at DESC
    LIMIT 1;
  END IF;

  IF v_device IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get an unused prekey
  SELECT id, key_id, public_key
  INTO v_prekey
  FROM public.prekeys
  WHERE device_id = v_device.id AND used = false
  ORDER BY created_at ASC
  LIMIT 1;

  res := jsonb_build_object(
    'deviceId', v_device.device_id,
    'registrationId', v_device.registration_id,
    'identityKey', v_device.identity_pub,
    'signedPreKey', jsonb_build_object(
      'keyId', 0, -- use consistent id
      'publicKey', v_device.signed_prekey_pub,
      'signature', v_device.signed_prekey_sig
    )
  );

  IF v_prekey IS NOT NULL THEN
    res := res || jsonb_build_object(
      'preKey', jsonb_build_object(
        'keyId', v_prekey.key_id,
        'publicKey', v_prekey.public_key
      )
    );
    -- Mark as used
    UPDATE public.prekeys SET used = true, used_at = now() WHERE id = v_prekey.id;
  ELSE
    res := res || jsonb_build_object('preKey', NULL);
  END IF;

  RETURN res;
END;
$$;

REVOKE ALL ON FUNCTION public.get_prekey_bundle(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_prekey_bundle(UUID, INTEGER) TO authenticated;
-- Also need to allow fetching other user's devices for bundle? Add policy for authenticated to read active devices of others? 
-- For key exchange, we need to fetch peer's device info. But RLS blocks - add function.
CREATE OR REPLACE FUNCTION public.get_peer_devices(p_user_id UUID)
RETURNS TABLE (
  device_id INTEGER,
  registration_id INTEGER,
  identity_pub TEXT,
  signed_prekey_pub TEXT,
  signed_prekey_sig TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT ud.device_id, ud.registration_id, ud.identity_pub, ud.signed_prekey_pub, ud.signed_prekey_sig
  FROM public.user_devices ud
  WHERE ud.user_id = p_user_id AND ud.active = true
  ORDER BY ud.device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_peer_devices(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_peer_devices(UUID) TO authenticated;
