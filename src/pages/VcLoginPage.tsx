import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Landmark, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { Logo } from '../components/Logo';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthContext';
import { aal2LoginChallenge } from '../lib/security';
import { friendlyError } from '../lib/friendlyError';

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  disabled
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="auth-field-label">
      <span>{label}</span>
      <div className="password-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required
        />
        <button
          type="button"
          className="password-toggle-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}

/**
 * Vice-Chancellor executive gateway.
 *
 * Only a provisioned Vice-Chancellor account may use this page; every other
 * role is forwarded to its own portal. The VC role cannot be registered or
 * self-promoted — it is granted exclusively by the Super Admin through the
 * provision_vice_chancellor() RPC.
 */
export function VcLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { signInWithUsername, signOut, profile, mfaVerifiedFactor, clearMfaRequired } = useAuth();
  const fromPath = (location.state as any)?.from?.pathname;

  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [vcUsername, setVcUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const goToVcPortal = () => {
    navigate(fromPath && fromPath.startsWith('/vc') ? fromPath : '/vc', { replace: true });
  };

  const handleVcSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!vcUsername.trim() || !password) {
      setErrorMsg('Please enter your Vice-Chancellor email or username and password.');
      return;
    }

    setBusy(true);
    const res = await signInWithUsername(vcUsername, password);
    setBusy(false);

    if (res.error) {
      setErrorMsg(friendlyError(res.error, 'Unable to complete the request. Please try again.'));
      return;
    }

    // Second-factor (Authenticator App code) challenge first.
    if (res.mfaRequired) {
      setOtp('');
      setOtpError(null);
      setStep('otp');
      return;
    }

    routeByRole(res.role);
  };

  const routeByRole = (role?: string) => {
    if (role === 'vc') {
      toast('Vice-Chancellor access granted', 'success');
      goToVcPortal();
      return;
    }
    if (role === 'super_admin') {
      toast('Super Administrator accounts use the Super Admin gateway', 'info');
      navigate('/super');
      return;
    }
    if (role === 'admin') {
      toast('Administrator accounts use the Admin gateway', 'info');
      navigate('/admin');
      return;
    }
    if (role === 'lecturer') {
      toast('Lecturer accounts use the Lecturer Portal', 'info');
      navigate('/lecturer');
      return;
    }
    setErrorMsg(
      'Access Denied: This gateway is reserved for the Office of the Vice-Chancellor.'
    );
    toast('Access Denied: Non-VC account blocked from executive gateway', 'error');
  };

  const handleVcVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setOtpError(null);
    if (!mfaVerifiedFactor) {
      setOtpError('No security factor is available. Please go back and try again.');
      return;
    }
    if (otp.trim().length !== 6) {
      setOtpError('Enter the 6-digit code from your Authenticator App.');
      return;
    }
    setOtpBusy(true);
    try {
      await aal2LoginChallenge(mfaVerifiedFactor.id, otp.trim());
      clearMfaRequired();
      setOtp('');
      routeByRole(profile?.role);
    } catch (err: any) {
      setOtpError(
        err?.message || 'That code was not accepted. Please check your Authenticator App and try again.'
      );
    } finally {
      setOtpBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-panel admin-auth-panel vc-auth-panel">
        <div className="brand">
          <Logo size={36} />
          <b>FUW</b> Executive Office
        </div>

        {step === 'credentials' && (
          <>
            <p className="kicker">VICE-CHANCELLOR&apos;S EXECUTIVE GATEWAY</p>
            <h1>Executive overview sign in</h1>
            <p>
              Sign in with your Vice-Chancellor email or username and password to review
              institutional statistics, student insights, academic resources and reports.
            </p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleVcSignIn} className="auth-flow-form">
              <label className="auth-field-label">
                <span>VC email or username</span>
                <input
                  required
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="e.g. vice.chancellor or vc@fuwukari.edu.ng"
                  value={vcUsername}
                  onChange={(e) => setVcUsername(e.target.value.toLowerCase())}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="VC account password"
                disabled={busy}
              />

              <button type="submit" className="primary auth-submit-btn vc-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Authorizing…
                  </>
                ) : (
                  <>
                    <Landmark size={16} /> Verify & Enter Executive Overview
                  </>
                )}
              </button>

              <p className="auth-back-link">
                <Link to="/home">← Return to Public Library</Link>
              </p>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="kicker">TWO-FACTOR VERIFICATION</p>
            <h1>Enter your security code</h1>
            <p>Open your Authenticator App and enter the 6-digit code to verify it&apos;s really you.</p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleVcVerifyOtp} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Authenticator App code</span>
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  className="mfa-login-input"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setOtpError(null);
                  }}
                  disabled={otpBusy}
                  autoFocus
                />
              </label>

              {otpError && (
                <div className="form-feedback-box error">
                  <AlertCircle size={17} />
                  <p>{otpError}</p>
                </div>
              )}

              <button type="submit" className="primary auth-submit-btn vc-submit-btn" disabled={otpBusy || otp.trim().length !== 6}>
                {otpBusy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Verify & Continue
                  </>
                )}
              </button>

              <p className="auth-back-link">
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={async () => {
                    await signOut().catch(() => {});
                    clearMfaRequired();
                    setOtp('');
                    setOtpError(null);
                    setStep('credentials');
                  }}
                >
                  ← Use a different account
                </button>
              </p>
            </form>
          </>
        )}

        <p className="vc-login-note">
          <LogIn size={13} aria-hidden="true" />
          The Vice-Chancellor role is provisioned by the Super Admin and cannot be self-registered.
        </p>
      </div>
    </main>
  );
}