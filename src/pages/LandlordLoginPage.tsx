import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Home,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  UserRound
} from 'lucide-react';
import { SEO } from '../components/SEO';
import { Logo } from '../components/Logo';
import { BootFallback } from '../components/BootFallback';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthContext';
import { friendlyError } from '../lib/friendlyError';
import { aal2LoginChallenge } from '../lib/security';

/**
 * Dedicated sign-in for landlords and caretakers (/landlord-login).
 *
 * Security model:
 *  - Roles come from the backend profile via signInWithUsername — never from
 *    the browser.
 *  - A student who signs in here is NOT sent to any provider dashboard; they
 *    see a clear message and are offered their own portal.
 *  - An already-authenticated visitor on the wrong login page is bounced to
 *    exactly the surface their role is allowed to use (no open redirects: all
 *    destinations are hard-coded).
 *  - Password state is never persisted; the existing Supabase session and the
 *    existing password-recovery flow are reused.
 */
export function LandlordLoginPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    signInWithUsername,
    signOut,
    clearMfaRequired,
    mfaVerifiedFactor,
    isAuthenticated,
    isLoading,
    profile
  } = useAuth();

  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const port = (role?: string | null): string => {
    if (role === 'super_admin') return '/super';
    if (role === 'admin') return '/admin';
    if (role === 'lecturer') return '/lecturer';
    if (role === 'landlord' || role === 'caretaker') return '/provider';
    return '/student';
  };

  // An already-authenticated visitor on the wrong login page is redirected to
  // the dashboard their role is authorized to use.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !profile) return;
    navigate(port(profile.role), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, profile]);

  const handleProviderSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!identifier.trim() || !password) {
      setErrorMsg('Please enter your registered email or username and password.');
      return;
    }

    setBusy(true);
    const res = await signInWithUsername(identifier, password);
    setBusy(false);

    if (res.error) {
      setErrorMsg(friendlyError(res.error, 'Unable to sign you in. Please try again.'));
      return;
    }

    if (res.mfaRequired) {
      setOtp('');
      setOtpError(null);
      setStep('otp');
      return;
    }

    const role = res.role ?? profile?.role ?? 'student';

    if (role === 'landlord' || role === 'caretaker') {
      toast('Welcome to the Landlord & Caretaker Portal', 'success');
      navigate('/provider', { replace: true });
      return;
    }

    if (role === 'super_admin' || role === 'admin' || role === 'lecturer') {
      toast('Authorized account detected. Redirecting to your dashboard…', 'info');
      navigate(port(role), { replace: true });
      return;
    }

    // Student accounts must never enter the provider portal. Keep them on the
    // page with a clear explanation instead of silently routing them.
    setErrorMsg(
      'Your account is registered as a student, not a landlord or caretaker. The provider portal is only for approved accommodation providers.'
    );
    toast('Access denied: student accounts cannot use the provider portal', 'error');
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
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
      toast('Identity verified. Welcome back!', 'success');
      navigate(port(profile?.role), { replace: true });
    } catch (err: any) {
      setOtpError(
        err?.message || 'That code was not accepted. Please check your Authenticator App and try again.'
      );
    } finally {
      setOtpBusy(false);
    }
  };

  if (isLoading) {
    return <BootFallback label="Restoring your session" />;
  }

  return (
    <main className="auth">
      <SEO
        title="Landlord & Caretaker Portal Sign In | FUW Campus Hub"
        description="Sign in to the Landlord & Caretaker Portal to manage your properties, listings, approvals and wallet on the FUW Campus Hub."
        path="/landlord-login"
        noindex
      />

      <div className="provider-login-panel">
        <div className="provider-login-hero">
          <div className="brand">
            <Logo size={38} />
            <b>FUW</b> Landlord &amp; Caretaker Portal
          </div>
          <span className="provider-login-badge">
            <Building2 size={13} /> ACCOMMODATION PROVIDER GATEWAY
          </span>
          <h1>Portal sign in</h1>
          <p>
            Manage your properties, publish accommodation listings, track advertisement approvals, and
            manage your wallet — all from one secure dashboard.
          </p>
        </div>

        <div className="provider-login-body">
          {step === 'credentials' ? (
            <form onSubmit={handleProviderSignIn} noValidate>
              {errorMsg && (
                <div className="form-feedback-box error" role="alert">
                  <AlertCircle size={17} />
                  <p>{errorMsg}</p>
                </div>
              )}

              <label className="auth-field-label">
                <span>Email or username</span>
                <div className="password-input-wrap" style={{ marginTop: 6 }}>
                  <input
                    className="auth-field-input"
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="e.g. landlord@fuw.edu.ng"
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    disabled={busy}
                    autoComplete="username"
                    required
                  />
                </div>
              </label>

              <PasswordField
                label="Password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="Enter your portal password"
                disabled={busy}
              />

              <div className="forgot-row">
                <Link to="/forgot-password" className="forgot-link">
                  Forgot password?
                </Link>
              </div>

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Signing in…
                  </>
                ) : (
                  <>
                    <KeyRound size={16} /> Sign in to your portal
                    <ArrowRight size={16} />
                  </>
                )}
              </button>

              <p className="provider-login-help">
                <UserRound size={15} aria-hidden />
                Not a landlord or caretaker yet?
              </p>
              <div className="provider-login-links">
                <Link to="/register/provider">
                  Apply as a landlord or caretaker
                  <ArrowRight size={14} />
                </Link>
                <Link to="/login">
                  Student? Use the student sign-in
                  <ArrowRight size={14} />
                </Link>
              </div>

              <p className="provider-login-security-note">
                <ShieldCheck size={16} aria-hidden />
                Your access is verified against your approved provider record. Only
                verified landlords and caretakers can reach the portal; student
                accounts stay in the student area.
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} noValidate>
              <div className="form-feedback-box success" style={{ marginBottom: 6 }}>
                <CheckCircle2 size={17} />
                <p>First, complete the second-factor check so we know it&apos;s really you.</p>
              </div>

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

              <button
                type="submit"
                className="primary auth-submit-btn"
                disabled={otpBusy || otp.trim().length !== 6}
              >
                {otpBusy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Verify &amp; Continue
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
          )}
        </div>
      </div>
    </main>
  );
}

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