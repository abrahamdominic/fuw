/**
 * Shared CSS motion helpers.
 *
 * The app intentionally has no JS animation runtime: every entrance,
 * stagger and press effect is a CSS keyframe in `styles.css`. This module
 * only centralises the *timing numbers* so groups feel consistent, and the
 * `staggerDelay` helper that turns an index into an inline `animation-delay`.
 */

/** Duration tokens (milliseconds). Mirrors the CSS `--fx-*` durations. */
export const fxDuration = {
  /** Hover, press, micro-feedback, icon swaps */
  fast: 180,
  /** Standard content transitions, small lists */
  standard: 280,
  /** Route/page changes */
  page: 380
} as const;

const DEFAULT_STEP = 50;

/**
 * Inline style for a staggered child. Combine with an entrance class from
 * `styles.css` (e.g. `className="fx-fade-up"`):
 *
 *   <div className="fx-fade-up" style={staggerDelay(i, 40)}>…</div>
 *
 * Capped so a long list never produces a multi-second delay.
 */
export function staggerDelay(
  index: number,
  step: number = DEFAULT_STEP,
  base = 0
): { animationDelay: string } {
  const safeIndex = Number.isFinite(index) && index > 0 ? index : 0;
  return { animationDelay: `${base + safeIndex * step}ms` };
}

/** Entrance class for generic content blocks. */
export const fx = {
  fadeIn: 'fx-fade-in',
  fadeUp: 'fx-fade-up',
  fadeDown: 'fx-fade-down',
  scaleIn: 'fx-scale-in',
  overlay: 'fx-overlay-in',
  toast: 'fx-toast-in',
  drawerLeft: 'fx-drawer-left',
  drawerRight: 'fx-drawer-right',
  page: 'fx-page-in',
  listRow: 'fx-list-row',
  iconSwap: 'fx-icon-swap',
  press: 'fx-press',
  cardHover: 'fx-card-hover',
  errorShake: 'fx-error-shake'
} as const;