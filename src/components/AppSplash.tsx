import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import { Logo } from './Logo';

const FADE_MS = 650;
// Stage timings (ms from mount) — the welcome resolves in a deliberate,
// readable sequence so a first-time visitor actually absorbs the copy.
const STAGE_LOGO_MS = 250;
const STAGE_TEXT_MS = 800;
const STAGE_FOOTER_MS = 1450;
// Cold start (first visit this tab): generous reading time before the overlay
// may transition away. Returning users get a brief, skimmable version instead.
const COLD_START_READ_MS = 4600;
const RETURNING_READ_MS = 1800;
const SAFETY_MAX_TIMEOUT_MS = 6500;
const SPLASH_SESSION_KEY = 'fuw_splash_welcomed_v1';

/**
 * Full-screen institutional branded splash, modelled on the mobile app's welcome screen.
 *
 * The content reveals in three stages (logo -> text -> footer) so a normal user
 * can comfortably read the Federal University Wukari welcome message, title,
 * and institutional motto before the overlay smoothly transitions to the
 * authentication screen or library. The bulk of the read time is reserved for
 * first-timers; returning users see a short, skimmable version.
 *
 * Includes an immediate "Skip" button for testing and power users, plus an
 * automatic safety fallback so the app can never hang.
 */
type SplashStage = 1 | 2 | 3;

export function AppSplash({ visible }: { visible: boolean }) {
  const [removed, setRemoved] = useState(false);
  const [fading, setFading] = useState(false);
  const [stage, setStage] = useState<SplashStage>(1);

  // Check if this browser tab has already seen the welcome splash.
  const hasSeenSplash = typeof window !== 'undefined' && sessionStorage.getItem(SPLASH_SESSION_KEY) === '1';

  // If cold-start, give users enough time to read the text comfortably.
  const [readingFinished, setReadingFinished] = useState(!hasSeenSplash ? false : true);
  const stageTimersRef = useRef<number[]>([]);
  const readingTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  const finishSplash = useCallback(() => {
    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    setFading(true);
    const t = window.setTimeout(() => setRemoved(true), FADE_MS + 50);
    return () => window.clearTimeout(t);
  }, []);

  const handleSkip = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setReadingFinished(true);
    finishSplash();
  }, [finishSplash]);

  useEffect(() => {
    // Staged reveal: logo, then text, then footer/progress. Each stage only
    // mounts once and later timers are cleaned up if the splash is skipped.
    const timers = [
      window.setTimeout(() => setStage(2), STAGE_LOGO_MS),
      window.setTimeout(() => setStage(3), STAGE_TEXT_MS)
    ];
    stageTimersRef.current = timers;

    const readingTarget = hasSeenSplash ? RETURNING_READ_MS : COLD_START_READ_MS;
    readingTimerRef.current = window.setTimeout(() => {
      setReadingFinished(true);
    }, readingTarget);

    // Safety fallback: Never allow the app to remain stuck on splash
    safetyTimerRef.current = window.setTimeout(() => {
      setReadingFinished(true);
      finishSplash();
    }, SAFETY_MAX_TIMEOUT_MS);

    return () => {
      if (stageTimersRef.current) stageTimersRef.current.forEach((t) => window.clearTimeout(t));
      if (readingTimerRef.current) window.clearTimeout(readingTimerRef.current);
      if (safetyTimerRef.current) window.clearTimeout(safetyTimerRef.current);
    };
  }, [hasSeenSplash, finishSplash]);

  // When both the readable time has passed AND auth resolution is done, fade out
  useEffect(() => {
    if (readingFinished && !visible && !fading) {
      finishSplash();
    }
  }, [readingFinished, visible, fading, finishSplash]);

  if (removed) return null;

  const isVisible = !fading;
  const revealClass = (minStage: SplashStage) =>
    stage >= minStage ? ' app-splash-revealed' : '';

  return (
    <div
      className={`app-splash${isVisible ? ' app-splash-visible' : ' app-splash-hidden'}`}
      role="status"
      aria-live="polite"
      aria-hidden={!isVisible}
    >
      <div className="app-splash-orb app-splash-orb-large" aria-hidden />
      <div className="app-splash-orb app-splash-orb-small" aria-hidden />

      {/* Top right skip button */}
      <button
        type="button"
        className="app-splash-skip"
        onClick={handleSkip}
        aria-label="Skip welcome animation"
        title="Skip to portal"
      >
        <span>Skip</span>
        <ArrowRight size={13} aria-hidden />
      </button>

      <div className="app-splash-content">
        <div className={`app-splash-ring${revealClass(2)}`}>
          <div className="app-splash-logo">
            <Logo size={104} />
          </div>
        </div>

        <div className={`app-splash-text${revealClass(3)}`}>
          <span className="app-splash-eyebrow">
            <span className="app-splash-eyebrow-dot" aria-hidden />
            FEDERAL UNIVERSITY WUKARI
          </span>
          <h1 className="app-splash-title">FUW E-Library</h1>
          <p className="app-splash-subtitle">Learn. Discover. Excel.</p>
          <p className="app-splash-desc">
            Your trusted academic repository for verified study materials.
          </p>
        </div>

        <div className={`app-splash-footer${revealClass(3)}`}>
          <div className="app-splash-progress">
            <div className="app-splash-fill" />
          </div>
          <div className="app-splash-loading">
            <span>Preparing your library</span>
            <span className="app-splash-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}