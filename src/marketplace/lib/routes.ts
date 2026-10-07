/**
 * Single source of truth for Marketplace URLs.
 *
 * The Marketplace is mounted inside the FUW SPA under `/marketplace/*`, but its
 * pages were written when it was a standalone origin where `/browse` was the
 * root. Every internal link therefore goes through `mpPath()` instead of a bare
 * string literal.
 *
 * Using one helper (rather than relying on a router-level basename, which React
 * Router does not support per subtree) means:
 *   - a route rename is a single-file change,
 *   - `rg "to=\"/" src/marketplace` returning nothing is a real invariant that
 *     `marketplace_routing.test.ts` enforces,
 *   - query strings and hashes survive the prefixing.
 */

/** The path the Marketplace is mounted at. Must match the route in `main.tsx`. */
export const MARKETPLACE_BASE = '/marketplace';

/** Platform routes the Marketplace links back to (outside the Marketplace). */
export const PLATFORM_PATHS = {
  hub: '/hub',
  login: '/login',
  register: '/register',
  profile: '/student/profile',
  accommodation: '/accommodation',
  library: '/library'
} as const;

/**
 * Prefix a Marketplace-absolute path (`/browse?x=1`) with `/marketplace`.
 *
 * Absolute external URLs and already-prefixed paths are returned untouched, so
 * calling it twice is harmless.
 */
export function mpPath(path: string): string {
  if (!path) return `${MARKETPLACE_BASE}/`;

  // Never touch protocol-relative or absolute URLs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  // Hash-only and query-only targets belong to the current document.
  if (path.startsWith('#') || path.startsWith('?')) return path;

  // Split off the query string / hash so only the pathname is prefixed.
  const match = /^([^?#]*)(.*)$/.exec(path);
  const pathname = match ? match[1] : '';
  const suffix = match ? match[2] : '';

  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === MARKETPLACE_BASE) return `${MARKETPLACE_BASE}/${suffix.replace(/^\//, '')}`;

  const prefixed = trimmed.startsWith(`${MARKETPLACE_BASE}/`)
    ? trimmed
    : `${MARKETPLACE_BASE}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;

  return `${prefixed}${suffix}`;
}

/**
 * True when `path` points inside the Marketplace subtree. Used by the Navbar to
 * highlight the active section without hard-coding the prefix everywhere.
 */
export function isMarketplacePath(path: string): boolean {
  return path === MARKETPLACE_BASE || path.startsWith(`${MARKETPLACE_BASE}/`);
}
