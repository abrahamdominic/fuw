import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { Logo } from '../../components/Logo';

const FADE_MS = 600;
const STAGE_LOGO_MS = 180;
const STAGE_TEXT_MS = 480;
const MARKETPLACE_READ_MS = 3800;
const SAFETY_MAX_TIMEOUT_MS = 5500;
export const MARKETPLACE_SPLASH_KEY = 'fuw_marketplace_splash_seen_v1';

export function hasSeenMarketplaceSplash(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return sessionStorage.getItem(MARKETPLACE_SPLASH_KEY) === '1';
  } catch {
    return false;
  }
}

export function markMarketplaceSplashSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(MARKETPLACE_SPLASH_KEY, '1');
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export function resetMarketplaceSplashSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(MARKETPLACE_SPLASH_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Dedicated FUW Student Marketplace welcome animation.
 * Displays on first entry to the marketplace in the current browser session.
 * Features institutional branding, stage reveals, readable duration pacer,
 * skip option, and clean fade transition.
 */
export function MarketplaceSplash() {
  const [shouldRender, setShouldRender] = useState<boolean>(() => !hasSeenMarketplaceSplash());
  const [fading, setFading] = useState<boolean>(false);
  const [stage, setStage] = useState<number>(1);

  const stageTimersRef = useRef<number[]>([]);
  const readTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  const finishSplash = useCallback(() => {
    markMarketplaceSplashSeen();
    setFading(true);
    window.setTimeout(() => {
      setShouldRender(false);
    }, FADE_MS);
  }, []);

  const handleSkip = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (stageTimersRef.current) stageTimersRef.current.forEach((t) => window.clearTimeout(t));
    if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
    if (safetyTimerRef.current) window.clearTimeout(safetyTimerRef.current);
    finishSplash();
  }, [finishSplash]);

  useEffect(() => {
    if (!shouldRender) return;

    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (isJsdom) {
      // In test environments, avoid long unmanaged timers
      return;
    }

    const timers = [
      window.setTimeout(() => setStage(2), STAGE_LOGO_MS),
      window.setTimeout(() => setStage(3), STAGE_TEXT_MS)
    ];
    stageTimersRef.current = timers;

    readTimerRef.current = window.setTimeout(() => {
      finishSplash();
    }, MARKETPLACE_READ_MS);

    safetyTimerRef.current = window.setTimeout(() => {
      finishSplash();
    }, SAFETY_MAX_TIMEOUT_MS);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      if (readTimerRef.current) window.clearTimeout(readTimerRef.current);
      if (safetyTimerRef.current) window.clearTimeout(safetyTimerRef.current);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shouldRender, finishSplash, handleSkip]);

  if (!shouldRender) {
    return null;
  }

  const isVisible = !fading;
  const revealClass = (minStage: number) => (stage >= minStage ? ' app-splash-revealed' : '');

  const variantStyle = {
    '--splash-accent': '#7FD4C9',
    '--splash-accent-soft': '#BFEAE3',
    '--splash-orb-large': '#0E5E7B',
    '--splash-orb-small': '#5FC4D6'
  } as React.CSSProperties;

  const content = (
    <div
      className={`app-splash app-splash--marketplace${isVisible ? ' app-splash-visible' : ' app-splash-hidden'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to FUW Student Marketplace"
      style={variantStyle}
    >
      <div className="app-splash-orb app-splash-orb-large" aria-hidden="true" />
      <div className="app-splash-orb app-splash-orb-small" aria-hidden="true" />

      {/* Top right skip button */}
      <button
        type="button"
        className="app-splash-skip"
        onClick={handleSkip}
        aria-label="Skip Marketplace welcome animation"
        title="Enter Marketplace"
      >
        <span>Skip</span>
        <ArrowRight size={13} aria-hidden="true" />
      </button>

      <div className="app-splash-content">
        <div className={`app-splash-ring${revealClass(2)}`}>
          <div className="app-splash-logo">
            <Logo size={96} />
          </div>
        </div>

        <div className={`app-splash-text${revealClass(3)}`}>
          <span className="app-splash-eyebrow">
            <span className="app-splash-eyebrow-dot" aria-hidden="true" />
            FEDERAL UNIVERSITY WUKARI
          </span>
          <h1 className="app-splash-title">FUW Student Marketplace</h1>
          <p className="app-splash-subtitle">Buy. Sell. Thrive.</p>
          <p className="app-splash-desc">
            Verified campus commerce: products, services and trusted student vendors across FUW.
          </p>
        </div>

        <div className={`app-splash-footer${revealClass(3)}`}>
          <div className="app-splash-progress">
            <div
              className="app-splash-fill"
              style={{ animationDuration: `${MARKETPLACE_READ_MS}ms` }}
            />
          </div>
          <div className="app-splash-loading">
            <span>Preparing your marketplace</span>
            <span className="app-splash-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // Portal to <body>. The splash sits inside `.route-transition.fx-page-in`
  // in `src/main.tsx`, and that wrapper's `will-change: transform` + running
  // keyframe animation turns it into a containing block for `position: fixed`
  // descendants — which would lock this overlay to the page wrapper (it would
  // slide with the page-in, scroll away instead of staying pinned, and be
  // sized to the wrapper rather than the viewport). Mounting directly on
  // <body> keeps the full-viewport, viewport-pinned behaviour intact.
  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null;
}
