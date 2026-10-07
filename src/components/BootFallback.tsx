import React from 'react';
import { Logo } from './Logo';

/**
 * Shown while the persisted Supabase session is being restored.
 *
 * The auth gates must never render a bare `null` during this window: for a
 * first-time visitor there is no stored session, so the branded splash stays
 * hidden and an empty root produced a literal white screen on `/login` and
 * every `RequireAuth` route.
 */
export function BootFallback({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="boot-fallback"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="boot-fallback-logo">
        <Logo size={56} />
      </div>
      <span className="route-fallback-spinner" aria-hidden />
      <p className="boot-fallback-label">{label}…</p>
    </div>
  );
}