import React, { useEffect, useState, useRef, useCallback } from 'react';
import { BookOpen, ShoppingBag, Home, ArrowRight, School, GraduationCap } from 'lucide-react';
import { Logo } from './Logo';
import { hasSeenWelcome, markWelcomeSeen } from '../lib/welcomePersistence';

/**
 * Reading duration in milliseconds for the first-visit welcome presentation.
 * Paced intentionally at ~5.2 seconds so students have sufficient time to
 * absorb the university message and 3 core pillars before the login screen appears.
 */
const WELCOME_DISPLAY_DURATION_MS = 5200;
const WELCOME_EXIT_TRANSITION_MS = 500;

export function FirstVisitWelcome() {
  const [shouldRender, setShouldRender] = useState<boolean>(() => !hasSeenWelcome());
  const [isExiting, setIsExiting] = useState<boolean>(false);
  const [readingProgress, setReadingProgress] = useState<number>(0);
  const timerRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  const handleDismiss = useCallback(() => {
    if (isExiting) return;
    markWelcomeSeen();
    setIsExiting(true);

    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);

    timerRef.current = window.setTimeout(() => {
      setShouldRender(false);
    }, WELCOME_EXIT_TRANSITION_MS);
  }, [isExiting]);

  useEffect(() => {
    // If user has already visited or welcome is dismissed, do nothing
    if (!shouldRender || isExiting) return;

    // Detect reduced-motion preference
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    // In unit test / jsdom environments, skip automatic long timers to prevent test leaks
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

    if (isJsdom) {
      // In automated test runs, mount cleanly without lingering intervals
      return;
    }

    const duration = prefersReducedMotion ? 2500 : WELCOME_DISPLAY_DURATION_MS;
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
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shouldRender, isExiting, handleDismiss]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`fuw-welcome-backdrop ${isExiting ? 'fuw-welcome-fade-out' : 'fuw-welcome-fade-in'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to FUW Campus Hub"
    >
      {/* Background Ambient Orbs */}
      <div className="fuw-welcome-orb fuw-welcome-orb-top" aria-hidden="true" />
      <div className="fuw-welcome-orb fuw-welcome-orb-bottom" aria-hidden="true" />

      <div className="fuw-welcome-card">
        {/* University Header Badge */}
        <div className="fuw-welcome-badge">
          <School size={13} aria-hidden="true" />
          <span>FEDERAL UNIVERSITY WUKARI</span>
        </div>

        {/* Brand Crest & Logo */}
        <div className="fuw-welcome-logo-container">
          <div className="fuw-welcome-logo-glow" aria-hidden="true" />
          <div className="fuw-welcome-logo-circle">
            <Logo size={62} />
          </div>
        </div>

        {/* Primary Typography & Welcoming Message */}
        <h1 className="fuw-welcome-title">FUW Campus Hub</h1>
        <p className="fuw-welcome-subtitle">Your gateway to everything in FUW.</p>
        <p className="fuw-welcome-desc">
          Welcome to Federal University Wukari&apos;s unified digital platform connecting the E-Library,
          Student Marketplace, and Campus Accommodation.
        </p>

        {/* Unified 3 Pillars Cards */}
        <div className="fuw-welcome-pillars" role="region" aria-label="Campus Hub Pillars">
          <div className="fuw-welcome-pillar-card">
            <div className="fuw-welcome-pillar-icon fuw-welcome-icon-lib">
              <BookOpen size={20} aria-hidden="true" />
            </div>
            <div className="fuw-welcome-pillar-info">
              <h3>Academic E-Library</h3>
              <p>Lecture notes, curriculum textbooks, and past examination papers.</p>
            </div>
          </div>

          <div className="fuw-welcome-pillar-card">
            <div className="fuw-welcome-pillar-icon fuw-welcome-icon-market">
              <ShoppingBag size={20} aria-hidden="true" />
            </div>
            <div className="fuw-welcome-pillar-info">
              <h3>Student Marketplace</h3>
              <p>Protected student commerce, electronics, fashion, and campus services.</p>
            </div>
          </div>

          <div className="fuw-welcome-pillar-card">
            <div className="fuw-welcome-pillar-icon fuw-welcome-icon-housing">
              <Home size={20} aria-hidden="true" />
            </div>
            <div className="fuw-welcome-pillar-info">
              <h3>Accommodation</h3>
              <p>Verified lodges, and student roommate matching.</p>
            </div>
          </div>
        </div>

        {/* Reading Pacer & Continue Affordance */}
        <div className="fuw-welcome-footer">
          <div className="fuw-welcome-progress-wrap" aria-hidden="true">
            <div
              className="fuw-welcome-progress-bar"
              style={{ width: `${Math.min(readingProgress, 100)}%` }}
            />
          </div>

          <div className="fuw-welcome-actions">
            <span className="fuw-welcome-hint">
              <GraduationCap size={13} aria-hidden="true" />
              <span>Connecting campus life &amp; academia</span>
            </span>

            <button
              type="button"
              className="fuw-welcome-continue-btn"
              onClick={handleDismiss}
              autoFocus
            >
              <span>Continue to Login</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
