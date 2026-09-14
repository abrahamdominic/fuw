// AuthenticatorAppCard — shows whether TOTP (Authenticator App) 2FA is active,
// lets the user set it up (via AuthenticatorSetupModal) or remove it.
import React, { useEffect, useState } from 'react';
import {
  getAAL,
  unenrollFactor,
  type TOTPFactor
} from '../lib/security';
import { AuthenticatorSetupModal } from './AuthenticatorSetupModal';

export const AuthenticatorAppCard: React.FC = () => {
  const [factors, setFactors] = useState<TOTPFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const aal = await getAAL();
      setFactors(aal.all);
    } catch (e: any) {
      setError(
        e?.message?.includes('enabled')
          ? 'Two-factor authentication is not available yet. Contact the library administrator to enable MFA in Supabase (Auth → MFA).'
          : 'Could not load your security settings.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const hasVerifiedFactor = factors.some((f) => f.status === 'verified');

  const handleRemove = async (factorId: string) => {
    setBusy(true);
    setError(null);
    try {
      await unenrollFactor(factorId);
      await load();
      setNotice('Authenticator App removed. Two-factor authentication is now off.');
      setTimeout(() => setNotice(null), 3500);
    } catch (e: any) {
      setError(e?.message || 'Could not remove the Authenticator App.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="security-tool-block">
      <div className="security-tool-head">
        <div className="security-tool-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <path d="M12 14v3" />
          </svg>
        </div>
        <div className="security-tool-info">
          <b>Authenticator App (2-Factor Authentication)</b>
          <p>
            Add an extra layer of security. You will need a code from your Authenticator App
            (Google Authenticator, Microsoft Authenticator, Authy…) when you sign in.
          </p>
        </div>
        {loading ? null : hasVerifiedFactor ? (
          <span className="security-tool-status is-on">
            <span className="status-dot" /> On
          </span>
        ) : (
          <button
            type="button"
            className="primary save-btn security-tool-btn"
            onClick={() => {
              setError(null);
              setNotice(null);
              setSetupOpen(true);
            }}
            disabled={busy}
          >
            Set Up Authenticator App
          </button>
        )}
      </div>

      {loading && <p className="security-tool-note">Checking your security settings…</p>}
      {!loading && error && <p className="security-tool-error">{error}</p>}
      {!loading && notice && <p className="security-tool-success">{notice}</p>}

      {!loading && hasVerifiedFactor && (
        <div className="security-tool-list">
          {factors
            .filter((f) => f.status === 'verified')
            .map((f) => (
              <div key={f.id} className="security-tool-row">
                <div className="security-tool-row-icon">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                </div>
                <div className="security-tool-row-info">
                  <b>{f.friendly_name || 'Authenticator App'}</b>
                  <span>Verified · Codes rotate every 30 seconds</span>
                </div>
                <button
                  type="button"
                  className="link-btn danger security-tool-remove"
                  onClick={() => handleRemove(f.id)}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            ))}
        </div>
      )}

      <AuthenticatorSetupModal
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onVerified={() => {
          load();
          setNotice('Authenticator App connected. Two-factor authentication is now active.');
          setTimeout(() => setNotice(null), 4000);
        }}
      />
    </div>
  );
};

export default AuthenticatorAppCard;