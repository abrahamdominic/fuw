// =====================================================================
// FUW Campus Hub & Ecosystem Bridge
// =====================================================================

export type HubSection = 'library' | 'marketplace' | 'accommodation';

const LAST_ACTIVE_KEY = 'fuw_last_active_section';

/**
 * Where the FUW Student Marketplace lives inside this SPA.
 *
 * The Marketplace was a separate Vite app on its own origin
 * (`VITE_MARKETPLACE_URL`) and used to be reached by a cross-origin handoff that
 * pasted the session tokens into the URL fragment. It is now mounted at
 * `/marketplace/*` in this same app (must.md Phase 10), so the bridge is a
 * plain in-app path: same origin, same session, no token in the URL, no second
 * dev server, and no production deployment to keep in sync.
 */
export const MARKETPLACE_BASE_PATH = '/marketplace';

export function getLastActiveSection(): HubSection | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(LAST_ACTIVE_KEY);
    if (val === 'library' || val === 'marketplace' || val === 'accommodation') {
      return val;
    }
  } catch {}
  return null;
}

export function setLastActiveSection(section: HubSection): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, section);
  } catch {}
}

/**
 * Builds an in-app path into the Marketplace.
 *
 * The `authSession` argument is accepted and ignored so the existing call sites
 * (which used to hand tokens across an origin boundary) keep compiling. It is
 * deliberately a no-op: with one origin there is no handoff, and no caller has
 * any reason to pass tokens in a URL.
 */
export function getMarketplaceUrl(path = ''): string {
  const cleanPath = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `${MARKETPLACE_BASE_PATH}${cleanPath}`;
}
