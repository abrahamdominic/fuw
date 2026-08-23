import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Construction, RefreshCw, Loader2, ArrowLeft } from 'lucide-react';
import { Logo } from '../components/Logo';
import { useAuth } from '../lib/AuthContext';
import {
  fetchMaintenanceStatus,
  setMaintenanceMode,
  MaintenanceStatus
} from '../lib/maintenance';

const AUTO_RETRY_MS = 15000;

export function MaintenancePage() {
  const navigate = useNavigate();
  const { profile, isSuperAdmin } = useAuth();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const next = await fetchMaintenanceStatus();
      setStatus(next);
      if (!next.enabled) navigate('/', { replace: true });
    } catch {
      // Keep showing the maintenance screen on transient failures.
    } finally {
      setRetrying(false);
    }
  }, [navigate]);

  useEffect(() => {
    void fetchMaintenanceStatus().then(setStatus).catch(() => {});
    const timer = window.setInterval(() => void retry(), AUTO_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [retry]);

  const handleDisableForSelf = async () => {
    // Convenience path for super admins landing here directly: one click
    // restores access without navigating to the governance tab first.
    setRetrying(true);
    try {
      await setMaintenanceMode(false);
      navigate('/super', { replace: true });
    } catch {
      await retry();
    }
  };

  return (
    <div className="maintenance-screen">
      <div className="maintenance-card" role="status" aria-live="polite">
        <Link className="maintenance-brand" to="/" aria-label="FUW E-Library home">
          <Logo size={40} />
        </Link>

        <span className="maintenance-icon-ring" aria-hidden="true">
          <Construction size={34} />
        </span>

        <p className="maintenance-kicker">SCHEDULED SYSTEM MAINTENANCE</p>
        <h1>FUW E-Library is currently under maintenance.</h1>

        <p className="maintenance-copy">
          Our librarians are performing scheduled upgrades to the digital repository. All academic
          materials are safe — the library will be back online shortly. Please check again in a few
          minutes.
        </p>

        {status?.message ? (
          <blockquote className="maintenance-note">{status.message}</blockquote>
        ) : null}

        <div className="maintenance-actions">
          <button type="button" className="primary maintenance-retry-btn" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 size={16} className="spin-icon" /> : <RefreshCw size={16} />}
            <span>{retrying ? 'Checking…' : 'Try again'}</span>
          </button>

          {isSuperAdmin && (
            <>
              <Link to="/super" className="secondary-btn">
                <ArrowLeft size={16} />
                <span>Back to Super Admin</span>
              </Link>
              <button type="button" className="outline-btn" onClick={handleDisableForSelf} disabled={retrying}>
                Disable maintenance now
              </button>
            </>
          )}
        </div>

        <p className="maintenance-contact">
          Need help? Contact the library helpdesk at <a href="mailto:library@fuw.edu.ng">library@fuw.edu.ng</a>.
          {profile?.fullName ? ` Signed in as ${profile.fullName}.` : ''}
        </p>

        {status?.updatedAt && (
          <small className="maintenance-updated">
            Maintenance last updated {new Date(status.updatedAt).toLocaleString()}
          </small>
        )}
      </div>
    </div>
  );
}
