// AuthenticatorAppCard — shows whether TOTP (Authenticator App) 2FA is active,
// lets the user set it up (via AuthenticatorSetupModal) or remove it.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
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
          ? 'Two-factor authentication is not available yet. Contact the library administrator to enable it.'
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
    <section className="security-tool-block" aria-labelledby="totp-heading">
      <div className="security-tool-head">
        <span className="security-tool-icon" aria-hidden="true">
          <Smartphone size={21} strokeWidth={1.9} />
        </span>
        <div className="security-tool-info">
          <b id="totp-heading">Authenticator App (2-Factor Authentication)</b>
          <p>
            Add an extra layer of security. You will need a code from your Authenticator App
            (Google Authenticator, Microsoft Authenticator, Authy…) when you sign in.
          </p>
        </div>
        <div className="security-tool-actions">
          {!loading &&
            (hasVerifiedFactor ? (
              <span className="security-tool-status is-on">
                <span className="status-dot" aria-hidden="true" /> On
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
            ))}
        </div>
      </div>

      {loading && (
        <p className="security-tool-note" role="status">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          <span>Checking your security settings…</span>
        </p>
      )}
      {error && (
        <p className="security-tool-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {notice && (
        <p className="security-tool-success" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>{notice}</span>
        </p>
      )}

      {!loading && !hasVerifiedFactor && !error && (
        <div className="security-tool-empty">
          <ShieldCheck size={22} aria-hidden="true" />
          <b>Two-factor authentication is off</b>
          <span>
            Set up an authenticator app to require a one-time code each time you sign in.
          </span>
        </div>
      )}

      {!loading && hasVerifiedFactor && (
        <ul className="security-tool-list">
          {factors
            .filter((f) => f.status === 'verified')
            .map((f) => (
              <li className="security-tool-row" key={f.id}>
                <span className="security-tool-row-icon" aria-hidden="true">
                  <Smartphone size={16} strokeWidth={1.9} />
                </span>
                <div className="security-tool-row-info">
                  <b>{f.friendly_name || 'Authenticator App'}</b>
                  <span>Verified · Codes rotate every 30 seconds</span>
                </div>
                <div className="security-tool-row-actions">
                  <button
                    type="button"
                    className="link-btn danger security-tool-remove"
                    onClick={() => handleRemove(f.id)}
                    disabled={busy}
                    aria-busy={busy}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    <span>{busy ? 'Removing…' : 'Remove'}</span>
                  </button>
                </div>
              </li>
            ))}
        </ul>
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
    </section>
  );
};

export default AuthenticatorAppCard;