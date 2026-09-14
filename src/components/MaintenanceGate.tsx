import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
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
 *
 * Session loading is intentionally NOT handled here: the AppSplash overlay in
 * main.tsx already covers the cold-start window, so we never show a second
 * splash.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isSuperAdmin } = useAuth();
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

  // Wait for the first status check so protected pages never flash before the
  // global state is known. The AppSplash still covers this window.
  if (!checked) return null;

  if (status?.enabled && !isSuperAdmin) {
    return <Navigate to="/maintenance" replace />;
  }

  return <>{children}</>;
}
