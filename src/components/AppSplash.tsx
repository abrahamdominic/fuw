import React, { useEffect, useState } from 'react';
import { Logo } from './Logo';

const FADE_MS = 700;

/**
 * Full-screen branded splash, modelled on the mobile app's welcome screen.
 *
 * It stays mounted (hidden behind the app) so its entrance animations only
 * play once, and it fades away as soon as auth has finished resolving — the
 * combined effect gives a polished cold-start without flashing the app.
 */
export function AppSplash({ visible }: { visible: boolean }) {
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (!visible) {
      const t = window.setTimeout(() => setRemoved(true), FADE_MS + 250);
      return () => window.clearTimeout(t);
    }
  }, [visible]);

  if (removed) return null;

  return (
    <div
      className={`app-splash${visible ? ' app-splash-visible' : ' app-splash-hidden'}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <div className="app-splash-orb app-splash-orb-large" aria-hidden />
      <div className="app-splash-orb app-splash-orb-small" aria-hidden />

      <div className="app-splash-content">
        <div className="app-splash-ring">
          <div className="app-splash-logo">
            <Logo size={104} />
          </div>
        </div>

        <div className="app-splash-text">
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

        <div className="app-splash-footer">
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