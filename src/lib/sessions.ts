// Data access layer for active login sessions.
// All device/browser/OS/connection detection is real — no mock data.
import { requireSupabase } from './supabase';

export interface ActiveSession {
  id: string;
  user_id: string;
  session_key: string;
  device_type: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
  ip_address: string | null;
  location: string | null;
  connection_type: string;
  network_name: string | null;
  is_current: boolean;
  last_active: string;
  login_time: string;
  user_agent: string | null;
  created_at: string;
  // Joined (admin view)
  profiles?: { full_name: string; email: string; matric_number: string } | null;
}

// ── Device / Browser / OS Detection ──────────────────────────

interface ParsedUA {
  device_type: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
}

function computeDeviceType(ua: string): 'desktop' | 'mobile' | 'tablet' {
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  if (/mobile|android(?!.*tablet)|iphone|ipod/i.test(ua)) return 'mobile';
  return 'desktop';
}

function computeBrowser(ua: string): string {
  // Order matters: test more specific first
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR|Opera/i.test(ua)) return 'Opera';
  if (/Brave/i.test(ua)) return 'Brave';
  if (/Vivaldi/i.test(ua)) return 'Vivaldi';
  if (/Chrome/i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Browser';
  if (/UCBrowser/i.test(ua)) return 'UC Browser';
  if (/Opera|OPR/i.test(ua)) return 'Opera';
  return 'Unknown Browser';
}

function computeOS(ua: string): string {
  if (/Windows NT 10/i.test(ua)) return 'Windows 10';
  if (/Windows NT 11|Windows 11/i.test(ua)) return 'Windows 11';
  if (/Windows NT 6\.3/i.test(ua)) return 'Windows 8.1';
  if (/Windows NT 6\.2/i.test(ua)) return 'Windows 8';
  if (/Windows NT 6\.1/i.test(ua)) return 'Windows 7';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X (\d+[._]\d+)/i.test(ua)) {
    const v = ua.match(/Mac OS X (\d+)[._](\d+)/i);
    return v ? `macOS ${v[1]}.${v[2]}` : 'macOS';
  }
  if (/Android (\d+)/i.test(ua)) {
    const v = ua.match(/Android (\d+)/i);
    return `Android ${v ? v[1] : ''}`;
  }
  if (/iPhone OS (\d+_\d+)/i.test(ua)) {
    const v = ua.match(/iPhone OS (\d+)_(\d+)/i);
    return v ? `iOS ${v[1]}.${v[2]}` : 'iOS';
  }
  if (/iPad.*OS (\d+_\d+)/i.test(ua)) {
    const v = ua.match(/iPad.*OS (\d+)_(\d+)/i);
    return v ? `iPadOS ${v[1]}.${v[2]}` : 'iPadOS';
  }
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown OS';
}

export function parseUserAgent(ua: string): ParsedUA {
  return {
    device_type: computeDeviceType(ua),
    browser: computeBrowser(ua),
    os: computeOS(ua),
  };
}

// ── Connection Detection (Network Information API) ───────────

export interface ConnectionInfo {
  connection_type: string;
  network_name: string | null;
}

/** Best-effort connection detection via the Network Information API. */
export function detectConnection(): ConnectionInfo {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

  if (!conn) {
    return { connection_type: 'unknown', network_name: null };
  }

  let connectionType = 'unknown';
  const effectiveType = conn.effectiveType || conn.type || '';
  if (/wifi|wlan/i.test(effectiveType)) connectionType = 'wifi';
  else if (/cellular|4g|3g|2g|lte/i.test(effectiveType)) connectionType = 'cellular';
  else if (/ethernet|wired/i.test(effectiveType)) connectionType = 'ethernet';
  else if (conn.type) connectionType = conn.type;

  // Network name / SSID: browsers intentionally hide this for privacy.
  // Only expose it if a trusted platform API provides it.
  const networkName: string | null = null;

  return { connection_type: connectionType, network_name: networkName };
}

// ── Session Key ──────────────────────────────────────────────

const SESSION_KEY_STORAGE = 'fuw_session_key';

/** Deterministic session key per browser tab, persisted in localStorage. */
export function getOrCreateSessionKey(): string {
  const existing = localStorage.getItem(SESSION_KEY_STORAGE);
  if (existing) return existing;

  // Generate a random key for this browser/tab
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const key = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(SESSION_KEY_STORAGE, key);
  return key;
}

// ── CRUD ─────────────────────────────────────────────────────

/** Create or upsert a session record on login. */
export async function createSession(): Promise<ActiveSession | null> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const ua = navigator.userAgent;
  const parsed = parseUserAgent(ua);
  const conn = detectConnection();
  const sessionKey = getOrCreateSessionKey();

  const row = {
    user_id: user.id,
    session_key: sessionKey,
    device_type: parsed.device_type,
    browser: parsed.browser,
    os: parsed.os,
    connection_type: conn.connection_type,
    network_name: conn.network_name,
    is_current: true,
    user_agent: ua,
    last_active: new Date().toISOString(),
    login_time: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('active_sessions')
    .upsert(row, { onConflict: 'user_id,session_key' })
    .select('*')
    .single();

  if (error) {
    console.warn('Session create error:', error.message);
    return null;
  }
  return data;
}

/** Heartbeat: update last_active for the current session. */
export async function touchSession(): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  const sessionKey = getOrCreateSessionKey();
  const conn = detectConnection();

  await client
    .from('active_sessions')
    .update({
      last_active: new Date().toISOString(),
      connection_type: conn.connection_type,
      network_name: conn.network_name,
    })
    .eq('user_id', user.id)
    .eq('session_key', sessionKey);
}

/** Fetch all active sessions for the current user. */
export async function fetchMySessions(): Promise<ActiveSession[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];

  // Clean up stale sessions first
  await client.rpc('cleanup_stale_sessions');

  const sessionKey = getOrCreateSessionKey();

  const { data, error } = await client
    .from('active_sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('last_active', { ascending: false });

  if (error) {
    console.warn('Fetch sessions error:', error.message);
    return [];
  }

  // Mark current session
  return (data || []).map((s) => ({
    ...s,
    is_current: s.session_key === sessionKey,
  }));
}

/** Fetch all active sessions across all users (admin view). */
export async function fetchAllSessions(filters?: {
  search?: string;
  device_type?: string;
}): Promise<ActiveSession[]> {
  const client = requireSupabase();

  await client.rpc('cleanup_stale_sessions');

  let query = client
    .from('active_sessions')
    .select('*, profiles!active_sessions_user_id_fkey(full_name, email, matric_number)')
    .order('last_active', { ascending: false });

  if (filters?.device_type) {
    query = query.eq('device_type', filters.device_type);
  }
  if (filters?.search) {
    query = query.or(`browser.ilike.%${filters.search}%,os.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Fetch all sessions error:', error.message);
    return [];
  }
  return (data as any) || [];
}

/** Terminate a specific session by ID. */
export async function terminateSession(sessionId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('active_sessions')
    .delete()
    .eq('id', sessionId);
  if (error) throw error;
}

/** Terminate all other sessions for the current user (keep current). */
export async function terminateAllOtherSessions(): Promise<void> {
  const client = requireSupabase();
  const sessionKey = getOrCreateSessionKey();
  await client.rpc('terminate_other_sessions', { p_session_key: sessionKey });
}

/** Delete the current session record (on logout). */
export async function deleteCurrentSession(): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  const sessionKey = getOrCreateSessionKey();
  await client
    .from('active_sessions')
    .delete()
    .eq('user_id', user.id)
    .eq('session_key', sessionKey);
}
