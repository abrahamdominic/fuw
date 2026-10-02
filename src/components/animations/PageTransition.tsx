import React from 'react';
import { fx } from '../../lib/motion';

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
  /** Stable key so navigation re-mounts (and re-animates) the view. */
  id?: string;
}

/**
 * Route/page transition wrapper. Key it with the current pathname so each
 * navigation fades + lifts the new view in via the shared `.fx-page-in` CSS
 * keyframe.
 *
 * Wrap the <Routes> element with this once (keyed by location.pathname) — do
 * not nest per-page so navigation stays fast.
 */
export function PageTransition({ children, className, id }: PageTransitionProps) {
  return (
    <div id={id} className={[className, fx.page].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}