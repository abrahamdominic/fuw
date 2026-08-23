import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../lib/AuthContext';
import { fetchMaintenanceStatus, MaintenanceStatus } from '../lib/maintenance';

const POLL_INTERVAL_MS = 60000;

/**
 * Global maintenance gate.
 *
 * The persisted Supabase maintenance state is checked before any application
 * page renders. While it is active every route except /maintenance redirects
 * there — except for super administrators, who keep full access so they can
 * manage and disable the mode.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isLoading: authLoading, isSuperAdmin } = useAuth();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const statusRef = useRef<MaintenanceStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchMaintenanceStatus();
      statusRef.current = next;
      setStatus(next);
    } catch {
      // Never lock users out because a status check failed — fail open.
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  // The maintenance page itself stays reachable for everyone.
  if (location.pathname.startsWith('/maintenance')) return <>{children}</>;

  // Wait for both the session profile and the first status check so protected
  // pages never flash before the global state is known.
  if (!checked || authLoading) {
    return (
      <div className="maintenance-splash" role="status" aria-live="polite">
        <Logo size={44} />
        <Loader2 size={20} className="spin-icon" />
        <span>Checking FUW E-Library system status…</span>
      </div>
    );
  }

  if (status?.enabled && !isSuperAdmin) {
    return <Navigate to="/maintenance" replace />;
  }

  return <>{children}</>;
}
