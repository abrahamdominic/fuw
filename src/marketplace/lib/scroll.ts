/**
 * Scroll the window back to the top of the document.
 *
 * Called whenever a Marketplace page mounts after a filter/route change so the
 * new result set is not left half-scrolled. jsdom has a `window.scrollTo`
 * stub that reports "Not implemented" through the virtual console instead of
 * throwing, so tests would fill up with that noise even though nothing failed.
 * A try/catch cannot help there; we simply skip the call where the platform
 * cannot honour it and leave real browsers untouched.
 */
export function scrollToTop(): void {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  if (/jsdom/i.test(window.navigator.userAgent)) return;
  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch {
    /* Scroll positions are cosmetic; never let them break a page mount. */
  }
}
