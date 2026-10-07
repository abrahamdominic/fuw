// =====================================================================
// FUW E-Library — canonical site configuration.
//
// Single source of truth for the production origin, brand strings and
// shared assets. Everything that emits a URL for search engines (the
// <SEO> component, the build-time robots/sitemap generator and the
// prerendered route shells) imports from here so a domain change can
// never leave a stale canonical, sitemap entry or Open Graph URL behind.
// =====================================================================

/**
 * Production origin. HTTPS, no trailing slash, never localhost.
 * Configure Netlify with the same origin; the value below is the single
 * deployed FUW E-Library site.
 */
export const SITE_URL = 'https://fuwtest.netlify.app';

export const SITE_NAME = 'FUW Campus Hub';

/** Long-form name used in titles, structured data and footer copy. */
export const SITE_LONG_NAME = 'FUW Campus Hub: E-Library, Marketplace & Accommodation';

/** The owning institution — never abbreviated inconsistently. */
export const UNIVERSITY_NAME = 'Federal University Wukari';
export const UNIVERSITY_SHORT = 'FUW';

/** Institution location — verified against the university's own public site. */
export const UNIVERSITY_POSTAL_ADDRESS = 'PMB 1020, 200 Km Katsina-Ala Road, Wukari, Taraba State, Nigeria';
export const UNIVERSITY_LOCALITY = 'Wukari';
export const UNIVERSITY_REGION = 'Taraba State';
export const UNIVERSITY_COUNTRY = 'NG';

/**
 * The university's own public website. Used only as a `sameAs` identity
 * link for the EducationalOrganization entity — never as a canonical URL
 * for this application.
 */
export const UNIVERSITY_OFFICIAL_SITE = 'https://fuwukari.edu.ng';

/** Shared brand assets (paths are root-relative on purpose). */
export const LOGO_PATH = '/images/fuw-logo.png';
export const OG_IMAGE_PATH = '/images/fuw-campushub-og.png';
export const OG_IMAGE_ALT =
  'FUW Campus Hub: E-Library, Marketplace and Accommodation for Federal University Wukari';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Default social preview used whenever a page has no specific artwork. */
export const DEFAULT_OG_IMAGE = OG_IMAGE_PATH;

/** Branding used for the default `<title>` suffix and manifest identity. */
export const THEME_COLOR = '#0B6B3A';

/** Build the absolute production URL for a root-relative path. */
export function absoluteUrl(path: string): string {
  if (!path) return `${SITE_URL}/`;
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${clean}`;
}

/**
 * Normalise an internal route to the canonical, trailing-slash-free form
 * used everywhere (`/` stays `/`). Query strings and hashes are stripped
 * from canonical URLs so filtered views consolidate onto one URL.
 */
export function normalizePath(path?: string | null): string {
  if (!path) return '/';
  const [withoutQuery] = path.split('?');
  const [pathname] = withoutQuery.split('#');
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Escape a value for safe inclusion in a quoted HTML attribute.
 * Used by the build-time generator (no DOM available there).
 */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}