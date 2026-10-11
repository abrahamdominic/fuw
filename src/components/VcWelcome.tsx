import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, BookOpen, Landmark, Users } from 'lucide-react';
import { Logo } from './Logo';

/**
 * First-visit executive welcome for the Vice-Chancellor portal.
 *
 * Paced ~4.2s so the VC can absorb the governance message before the executive
 * overview appears. Only shown once per account (localStorage keyed by the
 * profile id) and skips long timers in jsdom test environments.
 */
const VC_WELCOME_DURATION_MS = 4200;
const VC_WELCOME_EXIT_TRANSITION_MS = 500;

function seenKey(userId: string): string {
  return `fuw_vc_welcome_seen_${userId}`;
}

function hasVcWelcomeSeen(userId: string): boolean {
  try {
    if (!userId) return true;
    return !!window.localStorage.getItem(seenKey(userId));
  } catch {
    return true;
  }
}

function markVcWelcomeSeen(userId: string): void {
  try {
    if (userId) window.localStorage.setItem(seenKey(userId), '1');
  } catch {
    // Local storage unavailable
  }
}

export function VcWelcome({ userId }: { userId: string }) {
  const [shouldRender, setShouldRender] = useState<boolean>(() => !hasVcWelcomeSeen(userId));
  const [isExiting, setIsExiting] = useState(false);
  const [readingProgress, setReadingProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  // If the profile id was still loading when this mounted, evaluate the seen
  // flag as soon as we have it.
  useEffect(() => {
    if (!userId || shouldRender || isExiting) return;
    if (!hasVcWelcomeSeen(userId)) {
      setShouldRender(true);
      setReadingProgress(0);
    }
  }, [userId, shouldRender, isExiting]);

  const handleDismiss = useCallback(() => {
    if (isExiting) return;
    markVcWelcomeSeen(userId);
    setIsExiting(true);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (isJsdom) {
      setShouldRender(false);
      return;
    }

    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      setShouldRender(false);
    }, VC_WELCOME_EXIT_TRANSITION_MS);
  }, [isExiting, userId]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!shouldRender || isExiting) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

    if (isJsdom) return;

    const duration = prefersReducedMotion ? 2200 : VC_WELCOME_DURATION_MS;
    const intervalTime = 50;
    const increment = (intervalTime / duration) * 100;

    progressIntervalRef.current = window.setInterval(() => {
      setReadingProgress((prev) => {
        const next = prev + increment;
        return next >= 100 ? 100 : next;
      });
    }, intervalTime);

    timerRef.current = window.setTimeout(() => {
      handleDismiss();
    }, duration);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shouldRender, isExiting, handleDismiss]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fuw-vc-welcome-backdrop ${isExiting ? 'fuw-vc-welcome-fade-out' : 'fuw-vc-welcome-fade-in'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to the Vice-Chancellor Executive Overview"
      style={{ pointerEvents: isExiting ? 'none' : 'auto' }}
      onAnimationEnd={(e) => {
        if (isExiting && e.target === e.currentTarget) {
          setShouldRender(false);
        }
      }}
    >
      <div className="fuw-welcome-orb fuw-vc-orb fuw-welcome-orb-top" aria-hidden="true" />
      <div className="fuw-welcome-orb fuw-vc-orb fuw-welcome-orb-bottom" aria-hidden="true" />

      <div className="fuw-welcome-card fuw-vc-welcome-card">
        <div className="fuw-welcome-badge fuw-vc-welcome-badge">
          <Landmark size={13} aria-hidden="true" />
          <span>FEDERAL UNIVERSITY WUKARI · EXECUTIVE OFFICE</span>
        </div>

        <div className="fuw-welcome-logo-container">
          <div className="fuw-welcome-logo-glow fuw-vc-glow" aria-hidden="true" />
          <div className="fuw-welcome-logo-circle">
            <Logo size={62} />
          </div>
        </div>

        <h1 className="fuw-welcome-title">Executive Overview</h1>
        <p className="fuw-welcome-subtitle fuw-vc-subtitle">Office of the Vice-Chancellor</p>
        <p className="fuw-welcome-desc">
          A read-only institutional dashboard of FUW Campus Hub — student insights, academic
          resources and executive reports across the university&apos;s unified digital platform.
        </p>

        <div className="fuw-welcome-pillars" role="region" aria-label="Executive Dashboard Sections">
          <div className="fuw-welcome-pillar-card">
            <div className="fuw-welcome-pillar-icon fuw-vc-icon-overview">
              <BarChart3 size={20} aria-hidden="true" />
            </div>
            <div className="fuw-welcome-pillar-info">
              <h3>Overview</h3>
              <p>Institution-wide statistics at a glance.</p>
            </div>
          </div>
          <div className="fuw-welcome-pillar-card">
            <div className="fuw-welcome-pillar-icon fuw-vc-icon-students">
              <Users size={20} aria-hidden="true" />
            </div>
            <div className="fuw-welcome-pillar-info">
              <h3>Student Insights</h3>
              <p>Enrolment, verification and demographics.</p>
            </div>
          </div>
          <div className="fuw-welcome-pillar-card">
            <div className="fuw-welcome-pillar-icon fuw-vc-icon-resources">
              <BookOpen size={20} aria-hidden="true" />
            </div>
            <div className="fuw-welcome-pillar-info">
              <h3>Academic Resources</h3>
              <p>E-Library holdings, downloads and usage.</p>
            </div>
          </div>
        </div>

        <div className="fuw-welcome-footer">
          <div className="fuw-welcome-progress-wrap" aria-hidden="true">
            <div
              className="fuw-welcome-progress-bar fuw-vc-progress-bar"
              style={{ width: `${Math.min(readingProgress, 100)}%` }}
            />
          </div>

          <div className="fuw-welcome-actions">
            <span className="fuw-welcome-hint">
              <GraduationCapPlaceholder />
              <span>Read-only executive access enabled</span>
            </span>

            <button type="button" className="fuw-welcome-continue-btn fuw-vc-continue-btn" onClick={handleDismiss} autoFocus>
              <span>Enter Executive Overview</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GraduationCapPlaceholder() {
  // Small inline icon to avoid importing an unused graduation cap in the footer hint.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 10L12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
    </svg>
  );
}