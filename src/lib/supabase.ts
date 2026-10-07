import { createClient } from '@supabase/supabase-js';

// Credentials are supplied exclusively through Vite environment variables
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Never hardcode keys here.
const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

// Session persistence.
//
// The session IS persisted, to `window.localStorage` under the `fuw-auth-token`
// key. This was previously documented here and in RUNBOOK_DEPLOYMENTS.md as an
// "FL-1 hardening" measure that kept tokens in memory only. That description was
// wrong: the storage below has been `window.localStorage`, so no in-memory-only
// hardening has ever been in effect, and an incident responder reading the
// runbook would have believed there was no persisted refresh token to steal.
//
// In-memory-only storage was the right instinct and is still the stronger
// posture, but it is not compatible with the product requirement that refreshing
// the page must not sign the user out (`must.md`, "Session requirements":
// "Refreshing the page does not unnecessarily log the user out", exercised by
// "Create account -> Login -> Refresh -> Navigate -> ..."). In a pure static SPA
// on Netlify talking to Supabase edge functions there is no server to set an
// httpOnly cookie, so the session has to live somewhere the page can read back.
//
// The compensating control for holding a refresh token in JS-readable storage is
// that an injected script must not be able to read it in the first place. That
// is enforced by the Content-Security-Policy in netlify.toml: `script-src 'self'`
// with no `unsafe-inline` and no `unsafe-eval`, plus `object-src 'none'` and
// `base-uri 'self'`. A string-concatenation XSS cannot execute, so it cannot
// reach localStorage. Any change that weakens that CSP must revisit this
// decision in the same commit.
const memoryStore = new Map<string, string>();
/**
 * Storage adapter used only when there is no `window` (server render and
 * build-time prerender), where touching `localStorage` would throw. It is not
 * the primary browser store -- see the note above on session persistence.
 */
export const memoryStorage = {
  getItem: (k: string) => memoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memoryStore.set(k, v);
  },
  removeItem: (k: string) => {
    memoryStore.delete(k);
  },
  isServer: false
};

// Passkeys require the `experimental.passkey` flag to be enabled in the
// Supabase project dashboard (Auth → Settings → Experimental Features → Passkeys)
// AND here in the client options, so the GoTrue client exposes the passkey API.
const experimentalOptions: Record<string, unknown> = {};
if (typeof window !== 'undefined') {
  experimentalOptions.passkey = true;
}

export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Shared deliberately with the Marketplace client: one key, one
          // session, so signing in on either surface signs in on both.
          storageKey: 'fuw-auth-token',
          // `memoryStorage` is the no-`window` fallback (server render and
          // build-time prerender), not the primary browser store.
          storage: typeof window !== 'undefined' ? window.localStorage : memoryStorage,
          experimental: experimentalOptions
        }
      })
    : null;
export const requireSupabase = () => {
  if (!supabase) throw new Error('Authentication is not configured yet.');
  return supabase;
};
