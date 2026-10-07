import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Fingerprint,
  Globe,
  GraduationCap,
  Home,
  IdCard,
  KeyRound,
  Layers,
  Lock,
  Mail,
  Pause,
  Play,
  Phone,
  RefreshCw,
  School,
  ShieldCheck,
  ShieldPlus,
  ShoppingBag,
  Sparkles,
  UserRound,
  UserPlus,
  X,
  Zap
} from 'lucide-react';
import { SEO } from '../components/SEO';
import { BootFallback } from '../components/BootFallback';
import { Logo } from '../components/Logo';
import { useToast } from '../components/Toast';
import { useLivePlatformStats } from '../lib/platformStats';
import { useAuth, USERNAME_PATTERN, normalizeUsername, validatePasswordPolicy, PASSWORD_REQUIREMENTS_TEXT } from '../lib/AuthContext';
import { catalogue, facultyByName, departmentByName, levelsFor, groupedFaculties } from '../data/catalogue';
import {
  aal2LoginChallenge,
  signInWithPasskey,
  registerPasskey,
  isPasskeySupported,
  isPlatformAuthenticatorAvailable
} from '../lib/security';
import { passkeyErrorMessage } from '../lib/authErrors';
import { fx, staggerDelay } from '../lib/motion';
import { safeMediaPlay, usePrefersStaticBackdrop } from '../lib/backdrop';

type AuthMode = 'login' | 'register' | 'forgot';

/* ---------------------------------------------------------------------------
 * Desktop Institutional Animation Showcase Side Panel
 * ------------------------------------------------------------------------- */
export function AuthShowcase() {
  const stats = useLivePlatformStats();
  const [isPlaying, setIsPlaying] = useState(true);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const useStaticPoster = usePrefersStaticBackdrop();
  // A GIF rendered by <img> has no playback API and cannot be frozen with CSS.
  // A <video> can, so the motion toggle genuinely pauses it. The sources are
  // attached after first paint and never at all for reduced-motion visitors or
  // small/low-memory viewports.
  const showStaticPoster = useStaticPoster || videoError;

  useEffect(() => {
    if (useStaticPoster) return;
    const load = () => setShouldLoadVideo(true);
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;

    if (typeof idle === 'function') {
      const handle = idle(load, { timeout: 2500 });
      return () => {
        const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
        if (cancel) cancel(handle);
      };
    }
    const timer = window.setTimeout(load, 1200);
    return () => window.clearTimeout(timer);
  }, [useStaticPoster]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) safeMediaPlay(video);
    else video.pause();
  }, [isPlaying, shouldLoadVideo]);

  return (
    <aside className="mac-showcase" aria-label="FUW Campus Hub Institutional Showcase">
      {/* The layer is opacity:0 until it has something painted, and the still
          frame counts — otherwise the reduced-motion fallback would be blank. */}
      <div className={`mac-showcase-video-box ${showStaticPoster || shouldLoadVideo ? 'loaded' : ''}`}>
        {showStaticPoster ? (
          <img
            className="mac-showcase-video"
            src="/images/animation-poster.jpg"
            alt=""
            aria-hidden="true"
            width={272}
            height={484}
            decoding="async"
          />
        ) : (
          <video
            ref={videoRef}
            className="mac-showcase-video"
            poster="/images/animation-poster.jpg"
            width={272}
            height={484}
            muted
            loop
            playsInline
            autoPlay={shouldLoadVideo}
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            onError={() => setVideoError(true)}
          >
            {shouldLoadVideo && (
              <>
                <source src="/images/hero-loop.webm" type="video/webm" />
                <source src="/images/hero-loop.mp4" type="video/mp4" />
              </>
            )}
          </video>
        )}
        <div className="mac-showcase-gradient" />
      </div>

      <div className="mac-showcase-content">
        <div className="mac-showcase-badge">
          <GraduationCap size={15} />
          <span>FEDERAL UNIVERSITY WUKARI</span>
        </div>

        <h2 className="mac-showcase-title">
          FUW Campus Hub <br />
          <em>Your gateway to everything in FUW</em>
        </h2>

        <p className="mac-showcase-desc">
          Access your academic resources, campus marketplace, and student accommodation from one connected FUW platform.
        </p>

        <div className="mac-showcase-pillars" aria-label="Connected FUW Services">
          <span className="mac-pillar-pill"><BookOpen size={13} /> E-Library</span>
          <span className="mac-pillar-pill"><ShoppingBag size={13} /> Marketplace</span>
          <span className="mac-pillar-pill"><Home size={13} /> Accommodation</span>
        </div>

        <div className="mac-showcase-stats" aria-label="Authoritative University Platform Statistics">
          <div className="mac-showcase-stat">
            <b>{stats.faculties}</b>
            <span>Faculties</span>
          </div>
          <div className="mac-showcase-stat-divider" />
          <div className="mac-showcase-stat">
            <b>{stats.departments}</b>
            <span>Departments</span>
          </div>
          <div className="mac-showcase-stat-divider" />
          <div className="mac-showcase-stat">
            <b>{stats.materials > 0 ? `${stats.materials}+` : '65+'}</b>
            <span>Study Resources</span>
          </div>
        </div>

        <div className="mac-showcase-features" aria-label="Campus Hub Highlights">
          <div className="mac-showcase-feat">
            <Globe size={15} />
            <span>24/7 access across mobile, tablet, and desktop</span>
          </div>
          <div className="mac-showcase-feat">
            <Building2 size={15} />
            <span>Faculty and department academic resources</span>
          </div>
          <div className="mac-showcase-feat">
            <Zap size={15} />
            <span>Fast access to study materials &amp; textbooks</span>
          </div>
          <div className="mac-showcase-feat">
            <FileText size={15} />
            <span>Past questions and examination resources</span>
          </div>
          <div className="mac-showcase-feat">
            <BookOpen size={15} />
            <span>Organized, curriculum-aligned academic materials</span>
          </div>
          <div className="mac-showcase-feat">
            <Sparkles size={15} />
            <span>Campus services through the wider FUW Campus Hub</span>
          </div>
        </div>

        {/* Motion toggle for the background animation */}
        {!showStaticPoster && (
          <div className="mac-showcase-media-bar">
            <button
              type="button"
              className="mac-media-pill"
              onClick={() => setIsPlaying((p) => !p)}
              aria-pressed={!isPlaying}
              aria-label={isPlaying ? 'Pause background animation' : 'Play background animation'}
              title={isPlaying ? 'Pause animation' : 'Play animation'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              <span>{isPlaying ? 'Pause Motion' : 'Play Motion'}</span>
            </button>
            {useStaticPoster && (
              <span className="mac-media-note">Still image shown to save data</span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------------------
 * Shared shell — mobile-style layout with responsive desktop showcase
 * ------------------------------------------------------------------------- */
export function MacPage({
  pill,
  subtitle,
  children
}: {
  pill: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mac-page">
      <div className="mac-orb mac-orb-a" aria-hidden />
      <div className="mac-orb mac-orb-b" aria-hidden />
      
      <div className="mac-container">
        {/* Left Side Showcase (Desktop / Laptop) */}
        <AuthShowcase />

        {/* Right Side / Centered Mobile Card Shell */}
        <div className="mac-shell">
          <div className="mac-header">
            <div className={`mac-logo-circle ${fx.fadeUp}`} style={staggerDelay(0, 70)}>
              <Logo size={54} />
            </div>
            <span className={`mac-pill ${fx.fadeUp}`} style={staggerDelay(1, 70)}>
              <School size={12} />
              <span>{pill}</span>
            </span>
            <h1 className={`mac-title ${fx.fadeUp}`} style={staggerDelay(2, 70)}>FUW Campus Hub</h1>
            <p className={`mac-subtitle ${fx.fadeUp}`} style={staggerDelay(3, 70)}>
              {subtitle ?? 'Your gateway to everything in FUW.'}
            </p>
            <div className={`mac-mobile-pillars ${fx.fadeUp}`} style={staggerDelay(4, 70)}>
              <span className="mac-mobile-pillar"><BookOpen size={11} /> E-Library</span>
              <span className="mac-mobile-dot">•</span>
              <span className="mac-mobile-pillar"><ShoppingBag size={11} /> Marketplace</span>
              <span className="mac-mobile-dot">•</span>
              <span className="mac-mobile-pillar"><Home size={11} /> Accommodation</span>
            </div>
          </div>

          {children}

          <footer className="mac-footer">
            <span className="mac-badge">
              <ShieldCheck size={13} />
              Protected by FUW ICT
            </span>
            <p>
              By continuing, you agree to Federal University Wukari’s Academic Fair Use Policy.
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}

export function MacCard({ children }: { children: React.ReactNode }) {
  return <div className="mac-card">{children}</div>;
}

export function MacBanner({
  type,
  children
}: {
  type: 'error' | 'success';
  children: React.ReactNode;
}) {
  return (
    <div
      className={`mac-banner mac-banner-${type}`}
      role={type === 'error' ? 'alert' : 'status'}
    >
      {type === 'error' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
      <p>{children}</p>
    </div>
  );
}

export function PasswordControl({
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  disabled,
  rightLabel,
  onRightLabel
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  rightLabel?: string;
  onRightLabel?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mac-field">
      <div className="mac-label-row">
        <label className="mac-label">{label}</label>
        {rightLabel && (
          <button type="button" className="mac-link-btn" onClick={onRightLabel} tabIndex={-1}>
            {rightLabel}
          </button>
        )}
      </div>
      <div className={`mac-input-row${visible ? ' mac-input-row-focused' : ''}`}>
        <Lock size={18} className="mac-icon" aria-hidden />
        <input
          className="mac-input"
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
          className="mac-trailing"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

export function TextControl({
  icon,
  label,
  value,
  onChange,
  onClear,
  placeholder,
  type = 'text',
  autoComplete,
  disabled,
  hint,
  maxLength,
  spellCheck
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  disabled?: boolean;
  hint?: string;
  maxLength?: number;
  spellCheck?: boolean;
}) {
  return (
    <div className="mac-field">
      <label className="mac-label">{label}</label>
      <div className="mac-input-row">
        {icon}
        <input
          className="mac-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          maxLength={maxLength}
          spellCheck={spellCheck}
          autoCapitalize={type === 'email' || type === 'text' ? 'none' : undefined}
          autoCorrect="off"
          required
        />
        {onClear && value.length > 0 && (
          <button
            type="button"
            className="mac-trailing mac-clear-btn"
            onClick={onClear}
            aria-label="Clear field"
            title="Clear"
            tabIndex={-1}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {hint && <p className="mac-hint">{hint}</p>}
    </div>
  );
}

export function SelectControl({
  icon,
  label,
  value,
  onChange,
  disabled,
  children
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mac-field">
      <label className="mac-label">{label}</label>
      <div className="mac-input-row mac-input-row-select">
        {icon}
        <select
          className="mac-input mac-select-native"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required
        >
          {children}
        </select>
        <ChevronDown size={18} className="mac-select-chevron" aria-hidden />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Two-step registration stepper
 * ------------------------------------------------------------------------- */
function RegisterStepper({
  currentStep,
  onStepOne
}: {
  currentStep: 1 | 2;
  onStepOne: () => void;
}) {
  return (
    <div className="mac-stepper" role="group" aria-label="Registration progress">
      <div className="mac-stepper-track">
        <div
          className="mac-stepper-fill"
          style={{ width: currentStep === 1 ? '50%' : '100%' }}
        />
      </div>
      <div className="mac-stepper-labels">
        <button
          type="button"
          className="mac-step"
          onClick={onStepOne}
          aria-current={currentStep === 1 ? 'step' : undefined}
        >
          <span className={`mac-step-dot${currentStep > 1 ? ' mac-step-dot-done' : ''}${currentStep === 1 ? ' mac-step-dot-active' : ''}`}>
            {currentStep > 1 ? '✓' : '1'}
          </span>
          <span className={`mac-step-label${currentStep === 1 ? ' mac-step-label-active' : ''}`}>
            Credentials
          </span>
        </button>
        <button type="button" className="mac-step" tabIndex={-1} aria-disabled="true">
          <span
            className={`mac-step-dot${currentStep === 2 ? ' mac-step-dot-active' : ' mac-step-dot-inactive'}`}
          >
            2
          </span>
          <span className={`mac-step-label${currentStep === 2 ? ' mac-step-label-active' : ''}`}>
            Academic Profile
          </span>
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Main Auth Page (login / register / forgot)
 * ------------------------------------------------------------------------- */
export function AuthPage({ initialMode = 'login' }: { initialMode?: AuthMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const {
    signInWithUsername,
    signUpWithPassword,
    completeProfile,
    sendPasswordReset,
    signOut,
    isAuthenticated,
    isProfileComplete,
    isLoading,
    profile,
    mfaRequired,
    mfaVerifiedFactor,
    clearMfaRequired
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [registerStep, setRegisterStep] = useState<1 | 2>(1);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Credentials
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Recovery
  const [forgotEmail, setForgotEmail] = useState('');
  const [accountNotFound, setAccountNotFound] = useState(false);

  // Academic profile (register step 2)
  const [profileData, setProfileData] = useState({
    matricNumber: '',
    faculty: catalogue[0]?.name || '',
    department: catalogue[0]?.departments[0]?.name || '',
    level: '100 Level',
    gender: '' as 'Male' | 'Female' | '',
    phoneNumber: '',
    bio: ''
  });

  // MFA challenge
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const lastAutoOtpRef = useRef<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // Registration welcome dialog modal
  const [welcome, setWelcome] = useState<{
    fullName: string;
    username: string;
    email: string;
    department: string;
    level: string;
    needsEmailConfirmation: boolean;
  } | null>(null);

  // Passkey registration flow states
  const [passkeyPromptShown, setPasskeyPromptShown] = useState(false);
  const [passkeyRegistering, setPasskeyRegistering] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyFailMsg, setPasskeyFailMsg] = useState<string | null>(null);
  const [passkeySuccess, setPasskeySuccess] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false);

  // Same cascade logic the mobile app uses: level choices follow the
  // selected department's programme duration (4/5/6 years).
  const currentFaculty = useMemo(() => facultyByName(profileData.faculty) || catalogue[0], [profileData.faculty]);
  const currentDepartment = useMemo(
    () =>
      departmentByName(profileData.faculty, profileData.department) ||
      currentFaculty.departments[0],
    [profileData.faculty, profileData.department, currentFaculty]
  );
  const availableLevels = useMemo(() => levelsFor(currentDepartment?.duration || 4), [currentDepartment]);

  const handleFacultySelect = (facName: string) => {
    const fac = facultyByName(facName) || catalogue[0];
    const firstDept = fac.departments[0];
    const deptLevels = levelsFor(firstDept.duration);
    setProfileData((prev) => ({
      ...prev,
      faculty: facName,
      department: firstDept.name,
      level: deptLevels.includes(prev.level) ? prev.level : deptLevels[0]
    }));
  };

  const handleDepartmentSelect = (deptName: string) => {
    const dept = departmentByName(profileData.faculty, deptName);
    const deptLevels = levelsFor(dept?.duration || 4);
    setProfileData((prev) => ({
      ...prev,
      department: deptName,
      level: deptLevels.includes(prev.level) ? prev.level : deptLevels[0]
    }));
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setStep('credentials');
    setRegisterStep(1);
    setErrorMsg(null);
    setSuccessMsg(null);
    setAccountNotFound(false);
    setOtp('');
  };

  const fromPath = (location.state as any)?.from?.pathname;

  const goToPortal = (roleOverride?: string) => {
    if (fromPath && fromPath !== '/login' && fromPath !== '/register' && fromPath !== '/') {
      navigate(fromPath, { replace: true });
      return;
    }
    const role = roleOverride || profile?.role;
    if (role === 'super_admin') navigate('/super', { replace: true });
    else if (role === 'admin') navigate('/admin', { replace: true });
    else navigate('/hub', { replace: true });
  };

  // Check passkey support on mount
  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
    isPlatformAuthenticatorAvailable().then(setPlatformAuthAvailable).catch(() => setPlatformAuthAvailable(false));
  }, []);

  // If already authenticated with a completed profile, forward to the right
  // portal or requested route.
  useEffect(() => {
    if (isAuthenticated && isProfileComplete && step !== 'otp' && !mfaRequired) {
      if (fromPath && fromPath !== '/login' && fromPath !== '/register' && fromPath !== '/') {
        navigate(fromPath, { replace: true });
      } else if (profile?.role === 'super_admin') {
        navigate('/super', { replace: true });
      } else if (profile?.role === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/hub', { replace: true });
      }
    }
  }, [isAuthenticated, isProfileComplete, profile, navigate, step, mfaRequired, fromPath]);

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!username.trim() || !password) {
      setErrorMsg('Please enter your email or username and password.');
      return;
    }

    setBusy(true);
    const res = await signInWithUsername(username, password);
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
      return;
    }

    if (res.mfaRequired) {
      setOtp('');
      setOtpError(null);
      setStep('otp');
      return;
    }

    toast('Welcome back to FUW Campus Hub!', 'success');
    goToPortal(res.role);
  };

  // MFA code verification
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
      goToPortal();
    } catch (err: any) {
      setOtpError(
        err?.message || 'That code was not accepted. Please check your Authenticator App and try again.'
      );
    } finally {
      setOtpBusy(false);
    }
  };

  useEffect(() => {
    if (step !== 'otp' || otp.length !== 6 || otpBusy || !mfaVerifiedFactor) return;
    if (lastAutoOtpRef.current === otp) return;
    lastAutoOtpRef.current = otp;
    void handleVerifyOtp();
  }, [otp, otpBusy, step, mfaVerifiedFactor]);

  // Passkey sign-in
  const handlePasskeySignIn = async () => {
    setErrorMsg(null);
    setPasskeyBusy(true);
    try {
      await signInWithPasskey();
      toast('Signed in with your passkey!', 'success');
      goToPortal();
    } catch (err: any) {
      setErrorMsg(err?.message || 'The secure login could not be completed. Please use your password instead.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  // Forgot password
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setAccountNotFound(false);

    const identifier = forgotEmail.trim();
    if (!identifier) {
      setErrorMsg('Please enter your registered email address or username.');
      return;
    }
    if (identifier.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (!identifier.includes('@') && !USERNAME_PATTERN.test(identifier)) {
      setErrorMsg('Please enter a valid username or email address.');
      return;
    }

    setBusy(true);
    const res = await sendPasswordReset(identifier);
    setBusy(false);

    if (res.error) {
      if (res.notFound) {
        setAccountNotFound(true);
      }
      setErrorMsg(res.error.message);
      return;
    }

    setAccountNotFound(false);
    setForgotEmail('');
    setSuccessMsg(
      'A password reset link has been sent to your email address. Please check your inbox and spam folder.'
    );
  };

  // Register — step 1 validation
  const validateStepOne = (): boolean => {
    setErrorMsg(null);
    if (!fullName.trim()) {
      setErrorMsg('Please enter your full name.');
      return false;
    }
    const uname = normalizeUsername(username);
    if (!USERNAME_PATTERN.test(uname)) {
      setErrorMsg(
        'Username must be 3–20 characters using only lowercase letters, numbers, dots, dashes, or underscores.'
      );
      return false;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return false;
    }
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      setErrorMsg(passwordError);
      return false;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return false;
    }
    return true;
  };

  // Register — step 2 validation + account creation
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const matric = profileData.matricNumber.trim();
    if (!matric) {
      setErrorMsg('Matriculation Number is required.');
      return;
    }
    if (matric.length < 4 || !/[A-Z]/.test(matric) || !/[0-9]/.test(matric)) {
      setErrorMsg('Please enter a valid matriculation number (e.g. CIS/CSC/20/001).');
      return;
    }
    if (!profileData.gender) {
      setErrorMsg('Please select your gender (Male or Female).');
      return;
    }
    const phone = profileData.phoneNumber.trim();
    const validPhone =
      /^\+?[0-9\s()-]{7,20}$/.test(phone) &&
      (phone.match(/\d/g) || []).length >= 8 &&
      (phone.match(/\d/g) || []).length <= 15;
    if (!phone) {
      setErrorMsg('Phone Number is required.');
      return;
    }
    if (!validPhone) {
      setErrorMsg('Please enter a valid phone number (8–15 digits).');
      return;
    }

    setBusy(true);
    const res = await signUpWithPassword({ fullName, username, email, password });
    if (res.error) {
      setBusy(false);
      setErrorMsg(res.error.message);
      return;
    }

    if (res.needsEmailConfirmation) {
      setBusy(false);
      setPassword('');
      setConfirmPassword('');
      setWelcome({
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        department: profileData.department,
        level: profileData.level,
        needsEmailConfirmation: true
      });
      return;
    }

    // Immediate session — finish the academic profile before entering.
    const cp = await completeProfile({
      fullName: fullName.trim(),
      matricNumber: matric,
      faculty: profileData.faculty,
      department: profileData.department,
      level: profileData.level,
      gender: profileData.gender,
      phoneNumber: phone,
      bio: profileData.bio
    });
    setBusy(false);

    if (cp.error) {
      setErrorMsg(cp.error.message);
      return;
    }

    setWelcome({
      fullName: fullName.trim(),
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      department: profileData.department,
      level: profileData.level,
      needsEmailConfirmation: false
    });
  };

  // Passkey registration handlers
  const handleRegisterPasskey = async () => {
    // Safety check: don't attempt registration if not supported
    if (!passkeySupported) {
      setPasskeyError('Passkeys are not supported on this browser or connection.');
      return;
    }

    setPasskeyError(null);
    setPasskeyFailMsg(null);
    setPasskeyRegistering(true);
    try {
      await registerPasskey('FUW Campus Hub Account');
      setPasskeySuccess(true);
      setPasskeyPromptShown(true);
      toast('Passkey registered successfully!', 'success');
    } catch (err: any) {
      setPasskeyFailMsg(passkeyErrorMessage(err));
      setPasskeyPromptShown(true);
    } finally {
      setPasskeyRegistering(false);
    }
  };

  const handleRetryPasskey = () => {
    setPasskeyFailMsg(null);
    setPasskeySuccess(false);
    setPasskeyPromptShown(false);
    // Give the retry a tick so the prompt re-renders before the native prompt.
    window.setTimeout(() => handleRegisterPasskey(), 50);
  };

  const handleSkipPasskey = () => {
    setPasskeyPromptShown(true); // Mark as shown so we don't prompt again
    setPasskeySuccess(false);
    setPasskeyError(null);
    setPasskeyFailMsg(null);
  };

  const handleFinishWelcome = () => {
    const needsConfirm = welcome?.needsEmailConfirmation;
    setWelcome(null);
    setPasskeyPromptShown(false);
    setPasskeySuccess(false);
    setPasskeyError(null);
    setPasskeyFailMsg(null);
    if (needsConfirm) {
      switchMode('login');
    } else {
      goToPortal();
    }
  };

  const title = mode === 'register' ? 'Create Student Account' : mode === 'forgot' ? 'Reset your Password' : 'Sign In';
  const seoPath = mode === 'register' ? '/register' : mode === 'forgot' ? '/forgot-password' : '/login';
  // If the URL contains recovery token or hash, redirect immediately to /reset-password
  if (
    typeof window !== 'undefined' &&
    (window.location.hash.includes('type=recovery') ||
      new URLSearchParams(window.location.search).get('type') === 'recovery')
  ) {
    return <Navigate to="/reset-password" replace />;
  }

  // Prevent flash of login screen if already authenticated or while loading
  if (isLoading) {
    return <BootFallback label="Restoring your session" />;
  }
  if (isAuthenticated && isProfileComplete && step !== 'otp' && !mfaRequired) {
    const defaultTarget =
      profile?.role === 'super_admin' ? '/super' : profile?.role === 'admin' ? '/admin' : '/hub';
    const dest = fromPath && fromPath !== '/login' && fromPath !== '/register' && fromPath !== '/' ? fromPath : defaultTarget;
    return <Navigate to={dest} replace />;
  }

  return (
    <MacPage
      pill={mode === 'register' ? 'STUDENT REGISTRATION' : 'FEDERAL UNIVERSITY WUKARI'}
      subtitle={
        mode === 'register'
          ? 'Access thousands of verified lecture notes, test & exam past questions'
          : undefined
      }
    >
      <SEO
        title={title}
        description={
          mode === 'register'
            ? 'Create a student account on the FUW Campus Hub to access university services, academic materials, and campus marketplace.'
            : mode === 'forgot'
              ? 'Reset your FUW Campus Hub password and regain access to your account.'
              : 'Sign in to the FUW Campus Hub to access student services, marketplace and verified materials.'
        }
        path={seoPath}
        noindex
      />

      {/* ============================ LOGIN ============================ */}
      {mode === 'login' && (
        <MacCard>
          {step === 'credentials' ? (
            <div className="mac-view" key="login">
              <div className="mac-card-header">
                <h2 className="mac-card-title">Welcome Back</h2>
                <p className="mac-card-subtitle">
                  Sign in with your registered username or email
                </p>
              </div>

              {errorMsg && <MacBanner type="error">{errorMsg}</MacBanner>}
              {successMsg && <MacBanner type="success">{successMsg}</MacBanner>}

              <form onSubmit={handleLogin} noValidate>
                <TextControl
                  icon={
                    username.includes('@') ? (
                      <Mail size={18} className="mac-icon" aria-hidden />
                    ) : (
                      <UserRound size={18} className="mac-icon" aria-hidden />
                    )
                  }
                  label="Email or username"
                  value={username}
                  onChange={(v) => {
                    setUsername(v);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  onClear={() => setUsername('')}
                  placeholder="Enter your email or username"
                  autoComplete="username"
                  disabled={busy}
                />

                <PasswordControl
                  label="Password"
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Enter your account password"
                  disabled={busy}
                  rightLabel="Forgot Password?"
                  onRightLabel={() => switchMode('forgot')}
                />

                <button type="submit" className="mac-btn mac-btn-primary" disabled={busy}>
                  {busy ? (
                    <>
                      <RefreshCw size={17} className="spin-icon" /> Signing in…
                    </>
                  ) : (
                    <>
                      Sign In <ArrowRight size={17} aria-hidden />
                    </>
                  )}
                </button>
              </form>

              <div className="mac-divider">
                <span>NEW TO FUW CAMPUS HUB?</span>
              </div>

              <button type="button" className="mac-btn mac-btn-register" onClick={() => switchMode('register')}>
                <UserPlus size={18} aria-hidden />
                Create Student Account
              </button>

              <button
                type="button"
                className="mac-btn mac-btn-passkey"
                onClick={handlePasskeySignIn}
                disabled={passkeyBusy}
              >
                {passkeyBusy ? (
                  <>
                    <RefreshCw size={17} className="spin-icon" /> Waiting for passkey…
                  </>
                ) : (
                  <>
                    <Fingerprint size={18} aria-hidden /> Sign in with a Passkey
                  </>
                )}
              </button>

              {errorMsg && (
                <p className="mac-passkey-hint">
                  Prefer to use your password? Use the password fields above to sign in instead.
                </p>
              )}
            </div>
          ) : (
            <div className="mac-view" key="otp">
              <div className="mac-card-header">
                <h2 className="mac-card-title">Two-Factor Verification</h2>
                <p className="mac-card-subtitle">
                  Enter the 6-digit code from your authenticator app to finish signing in.
                </p>
              </div>

              {errorMsg && <MacBanner type="error">{errorMsg}</MacBanner>}

              <form onSubmit={handleVerifyOtp} noValidate>
                <div className="mac-field">
                  <label className="mac-label">Authenticator code</label>
                  <div className="mac-input-row">
                    <KeyRound size={18} className="mac-icon" aria-hidden />
                    <input
                      className="mac-input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={otp}
                      onChange={(e) => {
                        const nextOtp = e.target.value.replace(/\D/g, '').slice(0, 6);
                        if (nextOtp !== otp) lastAutoOtpRef.current = null;
                        setOtp(nextOtp);
                        if (otpError) setOtpError(null);
                      }}
                      disabled={otpBusy}
                      autoFocus
                    />
                  </div>
                </div>

                {otpError && <MacBanner type="error">{otpError}</MacBanner>}

                <button
                  type="submit"
                  className="mac-btn mac-btn-primary"
                  disabled={otpBusy || otp.trim().length !== 6}
                >
                  {otpBusy ? (
                    <>
                      <RefreshCw size={17} className="spin-icon" /> Verifying…
                    </>
                  ) : (
                    <>
                      Verify & Continue <ShieldCheck size={17} aria-hidden />
                    </>
                  )}
                </button>
              </form>

              <button
                type="button"
                className="mac-btn mac-btn-ghost"
                onClick={async () => {
                  await signOut().catch(() => {});
                  clearMfaRequired();
                  setOtp('');
                  setOtpError(null);
                  setStep('credentials');
                }}
              >
                <ArrowLeft size={16} aria-hidden /> Back to sign in
              </button>
            </div>
          )}
        </MacCard>
      )}

      {/* ============================ REGISTER ============================ */}
      {mode === 'register' && (
        <MacCard>
          <RegisterStepper currentStep={registerStep} onStepOne={() => { setRegisterStep(1); setErrorMsg(null); }} />

          <div className="mac-view" key={`register-${registerStep}`}>
            {registerStep === 1 ? (
              <form onSubmit={(e) => { e.preventDefault(); if (validateStepOne()) setRegisterStep(2); }} noValidate>
                <div className="mac-card-header">
                  <h2 className="mac-card-title">1. Account Information</h2>
                  <p className="mac-card-subtitle">
                    Enter your official name and login credentials.
                  </p>
                </div>

                {errorMsg && <MacBanner type="error">{errorMsg}</MacBanner>}

                <TextControl
                  icon={<UserRound size={18} className="mac-icon" aria-hidden />}
                  label="Full Name *"
                  value={fullName}
                  onChange={(v) => { setFullName(v); if (errorMsg) setErrorMsg(null); }}
                  placeholder="e.g. Dominic Abraham"
                  autoComplete="name"
                  disabled={busy}
                />

                <TextControl
                  icon={<AtSign size={18} className="mac-icon" aria-hidden />}
                  label="Choose Username *"
                  value={username}
                  onChange={(v) => { setUsername(v.toLowerCase()); if (errorMsg) setErrorMsg(null); }}
                  onClear={() => setUsername('')}
                  placeholder="e.g. abraham.d"
                  autoComplete="username"
                  disabled={busy}
                  maxLength={20}
                  hint="3–20 characters. Lowercase letters, numbers, dot, dash, underscore only."
                />

                <TextControl
                  icon={<Mail size={18} className="mac-icon" aria-hidden />}
                  label="Email Address *"
                  value={email}
                  onChange={(v) => { setEmail(v); if (errorMsg) setErrorMsg(null); }}
                  placeholder="e.g. student@fuwukari.edu.ng"
                  type="email"
                  autoComplete="email"
                  disabled={busy}
                />

                <PasswordControl
                  label="Password *"
                  value={password}
                  onChange={(v) => { setPassword(v); if (errorMsg) setErrorMsg(null); }}
                  placeholder="At least 8 characters (upper + lower + number + special)"
                  autoComplete="new-password"
                  disabled={busy}
                />
                <p className="mac-hint">{PASSWORD_REQUIREMENTS_TEXT}</p>

                <PasswordControl
                  label="Confirm Password *"
                  value={confirmPassword}
                  onChange={(v) => { setConfirmPassword(v); if (errorMsg) setErrorMsg(null); }}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  disabled={busy}
                />

                <button type="submit" className="mac-btn mac-btn-primary">
                  Continue to Academic Info <ArrowRight size={17} aria-hidden />
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignUp} noValidate>
                <div className="mac-card-header">
                  <h2 className="mac-card-title">2. Academic & Contact Details</h2>
                  <p className="mac-card-subtitle">
                    Your department and level personalize your library syllabus.
                  </p>
                </div>

                {errorMsg && <MacBanner type="error">{errorMsg}</MacBanner>}

                <TextControl
                  icon={<IdCard size={18} className="mac-icon" aria-hidden />}
                  label="Matriculation Number *"
                  value={profileData.matricNumber}
                  onChange={(v) => {
                    setProfileData((prev) => ({ ...prev, matricNumber: v.toUpperCase() }));
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="e.g. CIS/CSC/20/001"
                  autoComplete="off"
                  disabled={busy}
                />

                <SelectControl
                  icon={<School size={18} className="mac-icon" aria-hidden />}
                  label="Faculty *"
                  value={profileData.faculty}
                  onChange={handleFacultySelect}
                  disabled={busy}
                >
                  {groupedFaculties().map((group) =>
                    group.college ? (
                      <optgroup key={group.college} label={group.college}>
                        {group.faculties.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      group.faculties.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))
                    )
                  )}
                </SelectControl>

                <SelectControl
                  icon={<Building2 size={18} className="mac-icon" aria-hidden />}
                  label="Department *"
                  value={profileData.department}
                  onChange={handleDepartmentSelect}
                  disabled={busy}
                >
                  {currentFaculty.departments.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} ({d.duration} Years)
                    </option>
                  ))}
                </SelectControl>

                <SelectControl
                  icon={<Layers size={18} className="mac-icon" aria-hidden />}
                  label={`Academic Level * (${currentDepartment?.duration || 4}-Year Curriculum)`}
                  value={profileData.level}
                  onChange={(v) => setProfileData((prev) => ({ ...prev, level: v }))}
                  disabled={busy}
                >
                  {availableLevels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </SelectControl>

                <div className="mac-field">
                  <label className="mac-label">Gender *</label>
                  <div className="mac-gender">
                    <button
                      type="button"
                      className={`mac-gender-opt${profileData.gender === 'Male' ? ' mac-gender-opt-active' : ''}`}
                      onClick={() => setProfileData((prev) => ({ ...prev, gender: 'Male' }))}
                      disabled={busy}
                    >
                      <GraduationCap size={17} aria-hidden /> Male
                    </button>
                    <button
                      type="button"
                      className={`mac-gender-opt${profileData.gender === 'Female' ? ' mac-gender-opt-active' : ''}`}
                      onClick={() => setProfileData((prev) => ({ ...prev, gender: 'Female' }))}
                      disabled={busy}
                    >
                      <GraduationCap size={17} aria-hidden /> Female
                    </button>
                  </div>
                </div>

                <TextControl
                  icon={<Phone size={18} className="mac-icon" aria-hidden />}
                  label="Phone Number *"
                  value={profileData.phoneNumber}
                  onChange={(v) => {
                    setProfileData((prev) => ({ ...prev, phoneNumber: v }));
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="e.g. 08012345678"
                  autoComplete="tel"
                  disabled={busy}
                />

                <div className="mac-btn-row">
                  <button
                    type="button"
                    className="mac-btn mac-btn-back"
                    onClick={() => setRegisterStep(1)}
                    disabled={busy}
                  >
                    <ArrowLeft size={16} aria-hidden /> Back
                  </button>
                  <button type="submit" className="mac-btn mac-btn-primary" disabled={busy}>
                    {busy ? (
                      <>
                        <RefreshCw size={17} className="spin-icon" /> Registering…
                      </>
                    ) : (
                      <>
                        Complete Signup <Sparkles size={17} aria-hidden />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>

          <button type="button" className="mac-btn mac-btn-ghost" onClick={() => switchMode('login')}>
            <span className="mac-btn-ghost-text">Already registered at FUW?</span>
            <span className="mac-btn-ghost-action">Sign in to your portal</span>
          </button>
        </MacCard>
      )}

      {/* ============================ FORGOT ============================ */}
      {mode === 'forgot' && (
        <MacCard>
          <div className="mac-view" key="forgot">
            <div className="mac-card-header">
              <h2 className="mac-card-title">Reset your Password</h2>
              <p className="mac-card-subtitle">
                Enter the email address or username tied to your account and we will send you a reset link.
              </p>
            </div>

            {accountNotFound && errorMsg ? (
              <div
                className="mac-banner mac-banner-error"
                role="alert"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={18} aria-hidden />
                  <span style={{ fontWeight: 500 }}>{errorMsg}</span>
                </div>
                <button
                  type="button"
                  className="mac-btn mac-btn-register"
                  style={{ alignSelf: 'flex-start', margin: 0, padding: '9px 16px', fontSize: '13px' }}
                  onClick={() => {
                    if (forgotEmail.includes('@')) {
                      setEmail(forgotEmail);
                    } else {
                      setUsername(forgotEmail);
                    }
                    setAccountNotFound(false);
                    setErrorMsg(null);
                    switchMode('register');
                  }}
                >
                  <UserPlus size={16} aria-hidden /> Create Account
                </button>
              </div>
            ) : (
              errorMsg && <MacBanner type="error">{errorMsg}</MacBanner>
            )}
            {successMsg && <MacBanner type="success">{successMsg}</MacBanner>}

            <form onSubmit={handleForgotPassword} noValidate>
              <TextControl
                icon={<Mail size={18} className="mac-icon" aria-hidden />}
                label="Email or Username"
                value={forgotEmail}
                onChange={(v) => {
                  setForgotEmail(v);
                  if (errorMsg) setErrorMsg(null);
                }}
                onClear={() => setForgotEmail('')}
                placeholder="your.name@fuwukari.edu.ng or your.username"
                autoComplete="email"
                disabled={busy}
              />

              <button type="submit" className="mac-btn mac-btn-primary" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={17} className="spin-icon" /> Sending reset link…
                  </>
                ) : (
                  <>
                    <Mail size={17} aria-hidden /> Send Reset Link
                  </>
                )}
              </button>
            </form>

            <button type="button" className="mac-btn mac-btn-ghost" onClick={() => switchMode('login')}>
              <ArrowLeft size={16} aria-hidden /> Back to sign in
            </button>
          </div>
        </MacCard>
      )}

      {/* ============================ REGISTRATION WELCOME MODAL ============================ */}
      {welcome && (
        <div className="mac-welcome-overlay" role="dialog" aria-modal="true">
          <div className="mac-welcome-card">
            <div className="mac-welcome-icon-circle">
              <Sparkles size={34} color="#0B6B3A" />
            </div>
            <span className="mac-welcome-eyebrow">WELCOME TO FUW CAMPUS HUB</span>
            <h2 className="mac-welcome-title">
              You&apos;re all set, {welcome.fullName.split(/\s+/)[0] || 'student'}!
            </h2>
            <p className="mac-welcome-desc">
              Your student account is ready for a focused, smarter study experience.
            </p>

            <div className="mac-welcome-summary">
              <div className="mac-welcome-summary-row">
                <AtSign size={16} color="#0B6B3A" />
                <span>@{welcome.username}</span>
              </div>
              <div className="mac-welcome-summary-row">
                <School size={16} color="#0B6B3A" />
                <span>
                  {welcome.department} · {welcome.level}
                </span>
              </div>
            </div>

            <div className="mac-welcome-notice">
              {welcome.needsEmailConfirmation ? (
                <>
                  <Mail size={18} color="#15803D" />
                  <p>
                    We sent a confirmation link to <b>{welcome.email}</b>. Please confirm your email before signing in.
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} color="#15803D" />
                  <p>
                    Your student profile is active. You can now explore verified lecture notes, past questions, and research materials.
                  </p>
                </>
              )}
            </div>

            {/* STEP 1 — Passkey registration prompt (no email confirmation, supported) */}
            {!welcome.needsEmailConfirmation && passkeySupported && !passkeyPromptShown && !passkeySuccess && !passkeyRegistering && !passkeyFailMsg && (
              <div className="mac-passkey-prompt">
                <div className="mac-passkey-prompt-header">
                  <div className="mac-passkey-icon">
                    <ShieldPlus size={20} color="#0B6B3A" />
                  </div>
                  <h3 className="mac-passkey-prompt-title">Secure Your Account with a Passkey</h3>
                </div>
                <p className="mac-passkey-prompt-desc">
                  {platformAuthAvailable
                    ? 'Sign in faster using your fingerprint, Face ID, or Windows Hello. No passwords to remember.'
                    : 'Sign in securely without typing a password. Your device will store your credentials safely.'}
                </p>

                {passkeyError && (
                  <div className="mac-passkey-error">
                    <AlertCircle size={16} />
                    <span>{passkeyError}</span>
                  </div>
                )}

                <div className="mac-passkey-actions">
                  <button
                    type="button"
                    className="mac-btn mac-btn-secondary"
                    onClick={handleSkipPasskey}
                    disabled={passkeyRegistering}
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    className="mac-btn mac-btn-primary"
                    onClick={handleRegisterPasskey}
                    disabled={passkeyRegistering}
                  >
                    <>
                      <Fingerprint size={16} /> Create Passkey
                    </>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — Waiting for the device authenticator */}
            {!welcome.needsEmailConfirmation && passkeySupported && passkeyRegistering && (
              <div className="mac-passkey-prompt mac-passkey-waiting">
                <div className="mac-passkey-prompt-header">
                  <div className="mac-passkey-icon">
                    <RefreshCw size={20} color="#0B6B3A" className="spin-icon" />
                  </div>
                  <h3 className="mac-passkey-prompt-title">Waiting for device authentication…</h3>
                </div>
                <p className="mac-passkey-prompt-desc">
                  {platformAuthAvailable
                    ? 'Use your fingerprint, Face ID, or Windows Hello when your device prompts you.'
                    : 'Follow the prompts on your screen to create your passkey. This usually takes a few seconds.'}
                </p>
                <button
                  type="button"
                  className="mac-btn mac-btn-ghost"
                  onClick={handleSkipPasskey}
                  disabled={passkeyRegistering}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Passkey success screen */}
            {!welcome.needsEmailConfirmation && passkeySuccess && !passkeyRegistering && (
              <div className="mac-passkey-result mac-passkey-result-success">
                <div className="mac-passkey-result-icon">
                  <CheckCircle2 size={28} color="#15803D" />
                </div>
                <h3 className="mac-passkey-result-title">Passkey successfully created</h3>
                <p className="mac-passkey-result-desc">
                  Your account is now protected with secure biometric sign-in. You can sign in on this device using your
                  fingerprint, Face ID, or Windows Hello (no password needed).
                </p>
                <div className="mac-passkey-success">
                  <CheckCircle2 size={18} color="#15803D" />
                  <p>
                    <b>Secure sign-in enabled.</b> You can also add more passkeys or an Authenticator App anytime in
                    Settings {`>`} Security.
                  </p>
                </div>
              </div>
            )}

            {/* Passkey failure screen */}
            {!welcome.needsEmailConfirmation && passkeyFailMsg && !passkeySuccess && !passkeyRegistering && (
              <div className="mac-passkey-result mac-passkey-result-fail">
                <div className="mac-passkey-result-icon">
                  <AlertCircle size={28} color="#B91C1C" />
                </div>
                <h3 className="mac-passkey-result-title">
                  {passkeyFailMsg.includes('cancelled') || passkeyFailMsg.includes('dismissed')
                    ? 'Passkey setup cancelled'
                    : 'Passkey setup could not be completed'}
                </h3>
                <p className="mac-passkey-result-desc">{passkeyFailMsg}</p>
                <p className="mac-passkey-result-note">
                  Your account has already been created. You can try again now, or set up a passkey later from
                  Settings {`>`} Security.
                </p>
                <div className="mac-passkey-result-actions">
                  <button
                    type="button"
                    className="mac-btn mac-btn-secondary"
                    onClick={handleRetryPasskey}
                  >
                    <RefreshCw size={15} /> Try Again
                  </button>
                  <button
                    type="button"
                    className="mac-btn mac-btn-primary"
                    onClick={handleFinishWelcome}
                  >
                    Continue without Passkey <ArrowRight size={16} aria-hidden />
                  </button>
                </div>
              </div>
            )}

            {/* Passkey not supported message */}
            {!welcome.needsEmailConfirmation && !passkeySupported && passkeyPromptShown && (
              <div className="mac-passkey-info">
                <AlertCircle size={18} color="#92400E" />
                <p>
                  Passkeys are not supported on this browser or connection. You can set up a passkey later from a supported device.
                </p>
              </div>
            )}

            {/* Final action button - only show when passkey flow is complete or skipped,
                or passkeys are unsupported (never leave the user stuck) */}
            {(welcome.needsEmailConfirmation ||
              !passkeySupported ||
              (passkeyPromptShown && !passkeyFailMsg && passkeySuccess) ||
              (passkeyPromptShown && !passkeyFailMsg && !passkeySuccess && !passkeyRegistering)) && (
              <button
                type="button"
                className="mac-btn mac-btn-primary mac-welcome-btn"
                onClick={handleFinishWelcome}
              >
                <span>
                  {welcome.needsEmailConfirmation
                    ? 'Continue to Sign In'
                    : passkeySuccess
                      ? 'Continue to Campus Hub'
                      : 'Start Learning'}
                </span>
                <ArrowRight size={17} aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </MacPage>
  );
}