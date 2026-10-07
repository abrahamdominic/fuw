import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { fetchMaintenanceStatus, MaintenanceStatus } from '../lib/maintenance';

const POLL_INTERVAL_MS = 60000;
const STATUS_TIMEOUT_MS = 1500;
const MAINTENANCE_CACHE_KEY = 'fuw_maintenance_status_cache_v1';

function getCachedStatus(): MaintenanceStatus | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(MAINTENANCE_CACHE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.enabled === 'boolean') return parsed;
    }
  } catch {
    // Ignore storage parse issues
  }
  return null;
}

function setCachedStatus(status: MaintenanceStatus): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MAINTENANCE_CACHE_KEY, JSON.stringify(status));
    }
  } catch {
    // Ignore storage quota issues
  }
}

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
  const { isSuperAdmin } = useAuth();
  const cached = useRef<MaintenanceStatus | null>(getCachedStatus()).current;
  const [status, setStatus] = useState<MaintenanceStatus | null>(cached);
  const statusRef = useRef<MaintenanceStatus | null>(cached);

  const refresh = useCallback(async () => {
    try {
      const fetchPromise = fetchMaintenanceStatus();
      const timeoutPromise = new Promise<MaintenanceStatus>((resolve) =>
        setTimeout(() => resolve(statusRef.current || { enabled: false, message: '', updatedAt: null }), STATUS_TIMEOUT_MS)
      );
      const next = await Promise.race([fetchPromise, timeoutPromise]);
      statusRef.current = next;
      setStatus(next);
      setCachedStatus(next);
    } catch {
      // Never lock users out because a status check failed — fail open.
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

  // Global maintenance gate: fail open immediately so normal traffic is never blocked.
  // If the server reports maintenance mode enabled, we redirect to /maintenance.
  if (location.pathname.startsWith('/maintenance')) return <>{children}</>;

  if (status?.enabled && !isSuperAdmin) {
    return <Navigate to="/maintenance" replace />;
  }

  return <>{children}</>;
}
