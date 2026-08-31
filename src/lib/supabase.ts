import { createClient } from '@supabase/supabase-js';

// Credentials are supplied exclusively through Vite environment variables
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Never hardcode keys here.
const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// In-memory auth token storage (FL-1 hardening).
//
// This is a pure static SPA (Netlify) talking to Supabase edge functions that
// authenticate via the Authorization header — there is NO server to set
// httpOnly cookies, so any cookie the SPA could use is JS-readable and offers
// no real advantage over localStorage. Instead we hold the session ONLY in JS
// memory: tokens are never written to localStorage/sessionStorage, so a
// cross-site scripting bug cannot exfiltrate a persisted refresh token.
//
// Trade-off: the session does not survive a full page reload or another tab.
// Within the page lifetime, supabase-js still auto-refreshes the access token.
const inMemoryStore = new Map<string, string>();
export const memoryStorage = {
  getItem: (k: string) => inMemoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    inMemoryStore.set(k, v);
  },
  removeItem: (k: string) => {
    inMemoryStore.delete(k);
  },
  isServer: false
};

export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: memoryStorage
        }
      })
    : null;
export const requireSupabase = () => {
  if (!supabase) throw new Error('Authentication is not configured yet.');
  return supabase;
};
