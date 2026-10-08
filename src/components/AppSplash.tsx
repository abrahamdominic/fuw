import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Logo } from './Logo';

const FADE_MS = 650;
// Stage timings (ms from mount): the welcome resolves in a deliberate,
// readable sequence so visitors can absorb the copy comfortably.
const STAGE_LOGO_MS = 200;
const STAGE_TEXT_MS = 550;
// The splash covers the initial session restore moment. Pacing gives
// users sufficient time to read and understand the institutional message.
const COLD_START_READ_MS = 4200;
const RETURNING_READ_MS = 2600;
const SAFETY_MAX_TIMEOUT_MS = 6500;
const SPLASH_SESSION_KEY = 'fuw_splash_welcomed_v1';

type SplashVariant = 'library' | 'marketplace' | 'accommodation' | 'hub' | 'lecturer';

const VARIANT_COPY: Record<SplashVariant, { title: string; subtitle: string; desc: string; loading: string }> = {
  hub: {
    title: 'FUW Campus Hub',
    subtitle: 'Connect. Discover. Empower.',
    desc: 'The official digital gateway for Federal University Wukari student life, services and community.',
    loading: 'Loading Campus Hub'
  },
  library: {
    title: 'FUW E-Library',
    subtitle: 'Learn. Discover. Excel.',
    desc: 'Your trusted academic repository for verified study materials.',
    loading: 'Preparing your library'
  },
  marketplace: {
    title: 'FUW Student Marketplace',
    subtitle: 'Buy. Sell. Thrive.',
    desc: 'Verified campus commerce: products, services and trusted student vendors.',
    loading: 'Preparing your marketplace'
  },
  accommodation: {
    title: 'FUW Accommodation & Roommates',
    subtitle: 'Find. Connect. Move In.',
    desc: 'Verified student hostels, lodges and roommate matching across campus.',
    loading: 'Preparing campus housing'
  },
  lecturer: {
    title: 'FUW Lecturer Portal',
    subtitle: 'Educate. Inspire. Publish.',
    desc: 'The official digital dissemination and course material repository for Federal University Wukari faculty.',
    loading: 'Preparing academic workspace'
  }
};

// Each surface keeps the institutional green backdrop but gets its own accent
// so the four experiences are not visually identical.
const VARIANT_ACCENTS: Record<
  SplashVariant,
  { accent: string; accentSoft: string; orbLarge: string; orbSmall: string }
> = {
  hub: { accent: '#6EE7B7', accentSoft: '#A7F3D0', orbLarge: '#064E3B', orbSmall: '#047857' },
  library: { accent: '#8CE6AD', accentSoft: '#B8EFCB', orbLarge: '#0B6B3A', orbSmall: '#57C785' },
  marketplace: { accent: '#7FD4C9', accentSoft: '#BFEAE3', orbLarge: '#0E5E7B', orbSmall: '#5FC4D6' },
  accommodation: { accent: '#F0C579', accentSoft: '#F6DCB0', orbLarge: '#7A5A12', orbSmall: '#E0B45C' },
  lecturer: { accent: '#34D399', accentSoft: '#6EE7B7', orbLarge: '#064E3B', orbSmall: '#059669' }
};

function variantFor(pathname: string): SplashVariant {
  if (pathname.startsWith('/lecturer')) return 'lecturer';
  if (pathname.startsWith('/marketplace')) return 'marketplace';
  if (pathname.startsWith('/accommodation')) return 'accommodation';
  if (
    pathname.startsWith('/library') ||
    pathname.startsWith('/repository') ||
    pathname.startsWith('/catalogue') ||
    pathname.startsWith('/materials') ||
    pathname.startsWith('/reading-list')
  ) {
    return 'library';
  }
  return 'hub';
}

type SplashStage = 1 | 2 | 3;

/**
 * Full-screen institutional branded splash that covers the brief moment while a
 * stored Supabase session is restored.
 *
 * It only mounts (and only ever announces itself to assistive tech) when a
 * session is actually being restored: first-time visitors and public pages
 * never sit behind it. The content reveals in three stages (logo -> text ->
 * footer) and the progress bar's duration matches the reading time so the
 * animation is never out of sync with the flow.
 *
 * Copy and accent colours adapt to the surface being loaded (E-Library,
 * Marketplace or Accommodation), and a SessionStorage flag makes the returning
 * version skimmable. Includes an immediate "Skip" button and an automatic
 * safety fallback so the app can never hang.
 */
export function AppSplash({ visible }: { visible: boolean }) {
  const location = useLocation();
  const [variant, setVariant] = useState<SplashVariant>(() => variantFor(location.pathname));
  const [removed, setRemoved] = useState(false);
  const [fading, setFading] = useState(false);
  const [stage, setStage] = useState<SplashStage>(1);

  // The splash's whole reason to exist is covering a session restore. If it
  // mounts with no session to restore (first-time visitor or public page),
  // render nothing — no stage timers, no aria-live announcements, no delay.
  const hasShownRef = useRef(false);
  if (visible && !hasShownRef.current) hasShownRef.current = true;
  if (!hasShownRef.current) return null;

  // Check if this browser tab has already seen the welcome splash.
  const hasSeenSplash = typeof window !== 'undefined' && sessionStorage.getItem(SPLASH_SESSION_KEY) === '1';

  // If cold-start (first time this tab sees a restore), give users enough time
  // to read the text comfortably.
  const [readingFinished, setReadingFinished] = useState(!hasSeenSplash ? false : true);
  const stageTimersRef = useRef<number[]>([]);
  const readingTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setVariant(variantFor(location.pathname));
  }, [location.pathname]);

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

    // Safety fallback: Never allow the app to remain stuck on splash.
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

  // When the readable time has passed AND auth restore is done, fade out.
  useEffect(() => {
    if (readingFinished && !visible && !fading) {
      finishSplash();
    }
  }, [readingFinished, visible, fading, finishSplash]);

  if (removed) return null;

  const copy = VARIANT_COPY[variant];
  const accent = VARIANT_ACCENTS[variant];
  const isVisible = !fading;
  const readingTarget = hasSeenSplash ? RETURNING_READ_MS : COLD_START_READ_MS;
  const revealClass = (minStage: SplashStage) =>
    stage >= minStage ? ' app-splash-revealed' : '';

  const variantStyle = {
    '--splash-accent': accent.accent,
    '--splash-accent-soft': accent.accentSoft,
    '--splash-orb-large': accent.orbLarge,
    '--splash-orb-small': accent.orbSmall
  } as React.CSSProperties;

  return (
    <div
      className={`app-splash app-splash--${variant}${isVisible ? ' app-splash-visible' : ' app-splash-hidden'}`}
      role="status"
      aria-live="polite"
      aria-hidden={!isVisible}
      style={variantStyle}
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
          <h1 className="app-splash-title">{copy.title}</h1>
          <p className="app-splash-subtitle">{copy.subtitle}</p>
          <p className="app-splash-desc">{copy.desc}</p>
        </div>

        <div className={`app-splash-footer${revealClass(3)}`}>
          <div className="app-splash-progress">
            <div className="app-splash-fill" style={{ animationDuration: `${readingTarget}ms` }} />
          </div>
          <div className="app-splash-loading">
            <span>{copy.loading}</span>
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