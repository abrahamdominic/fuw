// ProtectedActionModal — a modern, customized "verify protected action" dialog.
//
// Unlike a plain confirm, this dialog not only explains the action but also
// requires the user to prove intent, matching the security posture of the app:
//   * Destructive actions can require the user to TYPE the exact keyword
//     (e.g. "DELETE") before the confirm button unlocks.
//   * A TOTP (Authenticator App) code challenge can gate the action for users
//     who have MFA enrolled.
//   * A Passkey / WebAuthn re-verification can gate the action for users with
//     a registered passkey.
//
// At least one verification path must be satisfiable; when several are
// available the user can pick whichever is most convenient. The confirm button
// stays locked until a verification path succeeds.
import React, { useEffect, useRef, useState } from 'react';
import {
  challengeTOTP,
  verifyTOTP,
  signInWithPasskey
} from '../lib/security';
import { toUserFacingAuthError } from '../lib/authErrors';
import { AnimatedModal } from './animations/AnimatedModal';

export type ProtectedActionTone = 'danger' | 'warning' | 'primary';

export interface ProtectedActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Runs when verification succeeds and the user confirms. */
  onConfirm: () => Promise<void> | void;
  title: string;
  message: string;
  /** Name of the affected item — shown as a highlighted chip, e.g. a material title. */
  item?: string;
  /** When provided, the user must type this exact keyword to unlock confirm. */
  confirmKeyword?: string;
  confirmLabel?: string;
  tone?: ProtectedActionTone;
  /** "Protected Action" pill text. */
  badge?: string;
  /** Offer passkey re-verification for this action. */
  showPasskey?: boolean;
  /** When the caller has an enrolled TOTP factor, challenge it before allowing confirm. */
  totpFactorId?: string;
  /** Custom footer text shown while security checks are pending. */
  hint?: string;
}

export const ProtectedActionModal: React.FC<ProtectedActionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  item,
  confirmKeyword,
  confirmLabel,
  tone = 'danger',
  badge = 'Protected Action',
  showPasskey = false,
  totpFactorId,
  hint
}) => {
  const [typed, setTyped] = useState('');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyVerified, setPasskeyVerified] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  // Reset internal state every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setTyped('');
      setOtp('');
      setOtpError(null);
      setOtpBusy(false);
      setPasskeyBusy(false);
      setPasskeyVerified(false);
      setPasskeyError(null);
      setConfirming(false);
      setError(null);
    }
  }, [isOpen]);

  // Lock body scroll while the dialog is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const needsKeyword = Boolean(confirmKeyword);
  const needsOtp = Boolean(totpFactorId);
  const keywordOk = !needsKeyword || typed === confirmKeyword;
  // confirm unlocks when every configured gate is satisfied.
  const canConfirm =
    keywordOk &&
    (!needsOtp || otp.trim().length === 6) &&
    (!showPasskey || passkeyVerified);

  const handleVerifyOtp = async () => {
    if (!totpFactorId || otp.trim().length !== 6) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const difficulty = await challengeTOTP(totpFactorId);
      await verifyTOTP({
        factor_id: totpFactorId,
        challenge_id: difficulty.challenge_id,
        code: otp.trim()
      });
      setOtpError(null);
      setError(null);
    } catch (e: any) {
      setOtpError(e?.message || 'Incorrect code. Please try again.');
    } finally {
      setOtpBusy(false);
    }
  };

  const handleVerifyPasskey = async () => {
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      await signInWithPasskey();
      setPasskeyVerified(true);
      setPasskeyError(null);
      setError(null);
    } catch (e: any) {
      setPasskeyError(e?.message || 'Passkey verification failed. Try again.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setConfirming(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e: any) {
      setError(toUserFacingAuthError(e, 'The action could not be completed. Please try again.').message);
    } finally {
      setConfirming(false);
    }
  };

  const isOtpComplete = otp.trim().length === 6;
  const otpVerifiedOk = isOtpComplete && !otpError;

  return (
    <AnimatedModal
      open={isOpen}
      onClose={onClose}
      overlayClassName="protected-modal-overlay"
      dialogClassName="protected-modal"
    >
      <div className={`protected-header is-${tone}`}>
          <div className="protected-shield-wrap">
            <div className="protected-shield-rings">
              <span />
              <span />
              <span />
            </div>
            <div className="protected-shield-icon">
              <svg viewBox="0 0 24 24" fill="none" width="30" height="30">
                <path
                  d="M12 3 4.5 6v5.2c0 4.5 3.1 8.4 7.5 9.8 4.4-1.4 7.5-5.3 7.5-9.8V6L12 3Z"
                  fill="currentColor"
                  opacity="0.25"
                />
                <path
                  d="M12 3.4 5.2 6v5.2c0 4.1 2.8 7.6 6.8 8.9 4-1.3 6.8-4.8 6.8-8.9V6L12 3.4Zm0 4.7a3.1 3.1 0 0 1 3.1 3.1c0 1.3-.8 2.4-1.9 2.9v1.7h-2.4v-1.7c-1.1-.5-1.9-1.6-1.9-2.9A3.1 3.1 0 0 1 12 8.1Zm-1 4.9c.3.2.6.4 1 .5V15h2v-1.5c.4-.1.7-.3 1-.5l.4.7 1.7-1.7-.7-.4c.2-.3.3-.6.4-1h1.2v-2.4H16c-.1-.4-.2-.7-.4-1l.7-.4-1.7-1.7-.4.7c-.3-.2-.6-.4-1-.5V4.9h-2.4v1.5c-.4.1-.7.3-1 .5l-.4-.7L8.1 7.9l.7.4c-.2.3-.3.6-.4 1H7.2v2.4H8c.1.4.2.7.4 1l-.7.4 1.7 1.7.7-.7Z"
                  fill="currentColor"
                />
              </svg>
            </div>
          </div>
          <span className="protected-badge">{badge}</span>
          <h3>{title}</h3>
        </div>

        <div className="protected-body">
          <p className="protected-message">{message}</p>
          {item && (
            <div className="protected-item-chip">
              <span className="protected-item-dot" />
              {item}
            </div>
          )}

          {/* First gate — optional TOTP code entry */}
          {needsOtp && (
            <div className="protected-gate">
              <div className="protected-gate-label">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                Authenticator App code
              </div>
              <div className="protected-otp-row">
                <input
                  ref={otpInputRef}
                  className="protected-otp-input"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setOtpError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isOtpComplete && !otpBusy) handleVerifyOtp();
                  }}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  aria-label="Authenticator App code"
                />
                {otpVerifiedOk && (
                  <span className="protected-otp-ok">Verified</span>
                )}
              </div>
              {otpError && <div className="protected-gate-error">{otpError}</div>}
              {!otpVerifiedOk && (
                <button
                  type="button"
                  className="protected-verifier-btn"
                  onClick={handleVerifyOtp}
                  disabled={!isOtpComplete || otpBusy}
                >
                  {otpBusy ? 'Checking…' : 'Verify code'}
                </button>
              )}
            </div>
          )}

          {/* Second gate — optional passkey re-verification */}
          {showPasskey && (
            <div className="protected-gate">
              <div className="protected-gate-label">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="8" r="4" />
                  <path d="M3 20c1-4 4-6 8-6s7 2 8 6" />
                </svg>
                Passkey
              </div>
              {passkeyVerified ? (
                <div className="protected-passkey-success">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Identity verified with Passkey
                </div>
              ) : (
                <button
                  type="button"
                  className="protected-passkey-btn"
                  onClick={handleVerifyPasskey}
                  disabled={passkeyBusy}
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z" />
                    <path d="M8 16v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3" />
                  </svg>
                  {passkeyBusy ? 'Waiting for passkey…' : 'Verify with Passkey'}
                </button>
              )}
              {passkeyError && <div className="protected-gate-error">{passkeyError}</div>}
            </div>
          )}

          {/* Third gate — typed confirmation for destructive actions */}
          {needsKeyword && (
            <div className="protected-gate">
              <div className="protected-gate-label">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3l7 4v5c0 4.4-2.9 8-7 9-4.1-1-7-4.6-7-9V7l7-4Z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                Type <strong>{confirmKeyword}</strong> to confirm
              </div>
              <input
                className="protected-keyword-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={`Type ${confirmKeyword} here`}
                autoComplete="off"
                autoCapitalize="characters"
                aria-label={`Type ${confirmKeyword} to confirm`}
              />
            </div>
          )}

          {hint && <p className="protected-hint">{hint}</p>}
          {error && <div className="protected-gate-error protected-error">{error}</div>}
        </div>

        <div className="protected-footer">
          <div className="protected-summary">
            <span className={`protected-summary-check ${canConfirm ? 'is-ok' : ''}`}>
              {canConfirm ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                  <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              )}
              {canConfirm ? 'Ready to proceed' : 'Complete the verification above'}
            </span>
          </div>
          <div className="protected-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={confirming}>
              Cancel
            </button>
            <button
              type="button"
              className={tone === 'danger' ? 'btn-danger' : tone === 'warning' ? 'btn-warning' : 'btn-primary'}
              onClick={handleConfirm}
              disabled={!canConfirm || confirming}
            >
              {confirming ? (
                <>
                  <span className="btn-spinner" />
                  Working…
                </>
              ) : (
                confirmLabel ?? 'Confirm Action'
              )}
            </button>
          </div>
        </div>
    </AnimatedModal>
  );
};

export default ProtectedActionModal;