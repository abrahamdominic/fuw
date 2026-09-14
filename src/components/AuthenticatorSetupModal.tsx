// AuthenticatorSetupModal — two-step "Authenticator App" (TOTP MFA) enrollment.
//
// Step 1: render a QR code (and the base-32 secret for manual entry) from the
// freshly enrolled factor, then ask the user to scan/enter it in their
// Authenticator App.
// Step 2: the user types the 6-digit code from the app; it is verified against
// Supabase MFA. Only a correct code writes the factor to a `verified` state.
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  enrollTOTP,
  challengeTOTP,
  verifyTOTP
} from '../lib/security';

export interface AuthenticatorSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Issuer label shown in the Authenticator App (e.g. "FUW E-Library"). */
  issuer?: string;
  /** Called after the code has been verified successfully. */
  onVerified?: () => void;
}

interface EnrollSession {
  factor_id: string;
  secret: string;
  uri: string;
  challenge_id: string;
}

export const AuthenticatorSetupModal: React.FC<AuthenticatorSetupModalProps> = ({
  isOpen,
  onClose,
  issuer = 'FUW E-Library',
  onVerified
}) => {
  const [status, setStatus] = useState<'idle' | 'enrolling' | 'ready' | 'verifying' | 'done' | 'error'>('idle');
  const [enroll, setEnroll] = useState<EnrollSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const beginEnrollment = async () => {
    setStatus('enrolling');
    setError(null);
    try {
      const res = await enrollTOTP(issuer);
      const { challenge_id } = await challengeTOTP(res.factor_id);
      setEnroll({
        factor_id: res.factor_id,
        secret: res.secret,
        uri: res.uri,
        challenge_id
      });
      // Render the QR code as a data URL (no third-party QR service — the
      // secret never leaves the browser).
      const url = await QRCode.toDataURL(res.uri, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: 'M'
      });
      setQrDataUrl(url);
      setStatus('ready');
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e: any) {
      setStatus('error');
      setError(
        e?.message?.includes('server') || e?.message?.includes('enabled')
          ? 'Two-factor authentication is not enabled on this server yet. Contact the library administrator to enable MFA in Supabase (Auth → MFA).'
          : e?.message || 'Could not start enrollment. Please try again.'
      );
    }
  };

  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setEnroll(null);
      setError(null);
      setCode('');
      setCopied(false);
      beginEnrollment();
    } else {
      setStatus('idle');
      setEnroll(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleVerify = async () => {
    if (!enroll || code.trim().length !== 6) return;
    setStatus('verifying');
    setError(null);
    try {
      await verifyTOTP({
        factor_id: enroll.factor_id,
        challenge_id: enroll.challenge_id,
        code: code.trim()
      });
      setStatus('done');
      onVerified?.();
    } catch (e: any) {
      setStatus('ready');
      setError(e?.message || 'That code was not accepted. Please check the app and try again.');
    }
  };

  const handleClose = () => {
    if (status === 'enrolling' || status === 'verifying') return;
    onClose();
  };

  if (!isOpen) return null;

  const renderBody = () => {
    if (status === 'enrolling') {
      return (
        <div className="mfa-setup-loading">
          <span className="mfa-setup-spinner" />
          <p>Preparing your authenticator code…</p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="mfa-setup-error">
          <p>{error}</p>
          <button type="button" className="primary save-btn" onClick={beginEnrollment}>
            Try again
          </button>
        </div>
      );
    }

    if (status === 'done' || !enroll) {
      return (
        <div className="mfa-setup-done">
          <div className="mfa-done-icon">
            <svg viewBox="0 0 24 24" width="38" height="38" fill="none">
              <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h4>Authenticator App connected</h4>
          <p>
            Two-factor authentication is now active on your account. From now on you will
            be asked for a code from your Authenticator App when you sign in.
          </p>
          <button type="button" className="primary save-btn" onClick={handleClose}>
            Done
          </button>
        </div>
      );
    }

    return (
      <>
        <p className="mfa-setup-intro">
          Scan the QR code below with your <strong>Authenticator App</strong> (e.g. Google
          Authenticator, Microsoft Authenticator, or Authy). You can also enter the secret manually.
        </p>

        {qrDataUrl ? (
          <div className="mfa-qr-wrap">
            <img src={qrDataUrl} alt="Scan this code with your Authenticator App" className="mfa-qr" />
          </div>
        ) : (
          <div className="mfa-setup-loading">
            <span className="mfa-setup-spinner" />
          </div>
        )}

        <div className="mfa-secret-row">
          <code className="mfa-secret-code" title={enroll.secret}>{enroll.secret}</code>
          <button
            type="button"
            className="mfa-copy-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(enroll.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            {copied ? 'Copied!' : 'Copy secret'}
          </button>
        </div>
        <p className="mfa-secret-hint">
          Can't scan? Open your Authenticator App and add the account manually using this key.
        </p>

        <div className="mfa-verify-block">
          <label className="mfa-verify-label">Enter the 6-digit code from your app</label>
          <div className="mfa-verify-row">
            <input
              ref={codeRef}
              className="protected-otp-input"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim().length === 6) handleVerify();
              }}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-label="Verification code from your Authenticator App"
            />
            <button
              type="button"
              className="primary save-btn"
              onClick={handleVerify}
              disabled={code.trim().length !== 6 || status === 'verifying'}
            >
              {status === 'verifying' ? 'Verifying…' : 'Verify'}
            </button>
          </div>
          {error && <p className="mfa-setup-error">{error}</p>}
        </div>
      </>
    );
  };

  return (
    <div className="protected-modal-overlay" role="dialog" aria-modal="true" aria-label="Set up Authenticator App">
      <div className="protected-modal mfa-setup-modal">
        <div className="protected-header is-primary">
          <div className="protected-shield-wrap">
            <div className="protected-shield-rings"><span /><span /><span /></div>
            <div className="protected-shield-icon">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
                <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 14v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <span className="protected-badge">Two-Factor Authentication</span>
          <h3>Set Up Authenticator App</h3>
        </div>
        <div className="protected-body">{renderBody()}</div>
        <div className="protected-footer">
          <div className="protected-actions">
            <button type="button" className="btn-secondary" onClick={handleClose} disabled={status === 'enrolling' || status === 'verifying'}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthenticatorSetupModal;