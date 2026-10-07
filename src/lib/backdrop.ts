import { useEffect, useState } from 'react';

/**
 * Whether decorative background animation should be replaced by a static
 * poster image.
 *
 * The hero/showcase backdrop is an animated GIF. Decoding and animating it is
 * expensive on small or low-memory devices, so on narrow viewports (phones in
 * portrait, most webviews), devices reporting little memory / few cores, or
 * visitors who ask for reduced motion, we render a small static JPEG instead
 * and never request the GIF at all.
 *
 * Returns `true` when the caller should use the static poster.
 */

/** Viewport width (px) at or below which the animated backdrop is skipped. */
export const STATIC_BACKDROP_MAX_WIDTH = 640;

interface DeviceNavigator extends Navigator {
  deviceMemory?: number;
}

/**
 * Safely start playback on a `<video>` element.
 *
 * `HTMLMediaElement.play()` returns a promise in modern browsers, but older
 * webviews and some environments return `undefined` (or throw synchronously)
 * when autoplay is unsupported. Calling `.catch()` on an undefined return is
 * itself an unhandled error that takes down the surrounding page, so guard it:
 */
export function safeMediaPlay(video: HTMLVideoElement): void {
  let result: unknown;
  try {
    result = video.play?.();
  } catch {
    return;
  }
  if (result && typeof (result as Promise<void>).catch === 'function') {
    (result as Promise<void>).catch(() => undefined);
  }
}

export function usePrefersStaticBackdrop(): boolean {
  const [staticBackdrop, setStaticBackdrop] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const narrow = window.matchMedia(`(max-width: ${STATIC_BACKDROP_MAX_WIDTH}px)`);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const isConstrained = (isNarrow: boolean): boolean => {
      const nav = navigator as DeviceNavigator;
      const memory = nav.deviceMemory;
      const cores = nav.hardwareConcurrency ?? 4;
      return (
        isNarrow ||
        reduceMotion.matches ||
        (typeof memory === 'number' && memory <= 4 && cores <= 4)
      );
    };

    const update = (isNarrow: boolean) => setStaticBackdrop(isConstrained(isNarrow));
    update(narrow.matches);

    const onChange = (e: MediaQueryListEvent) => update(e.matches);
    narrow.addEventListener('change', onChange);
    reduceMotion.addEventListener('change', onChange);
    return () => {
      narrow.removeEventListener('change', onChange);
      reduceMotion.removeEventListener('change', onChange);
    };
  }, []);

  return staticBackdrop;
}