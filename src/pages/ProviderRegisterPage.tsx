import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Home, KeyRound, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { SEO } from '../components/SEO';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthContext';
import { PASSWORD_REQUIREMENTS_TEXT } from '../lib/AuthContext';
import {
  fetchMyProvider,
  registerProvider,
  uploadProviderDocument,
  type ProviderType
} from '../lib/accommodationPortal';
import { fx } from '../lib/motion';

type Phase = 'loading' | 'account' | 'application' | 'confirm-email';

const STEP_LABELS = ['Account', 'Role & details'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <React.Fragment key={label}>
            {i > 0 && (
              <span style={{ color: 'var(--text-muted, #999)', fontSize: 13 }}>
                <ArrowRight size={13} />
              </span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  fontWeight: 800,
                  color: done || active ? '#fff' : 'var(--text-secondary)',
                  background: done ? 'var(--green-600, #16a34a)' : active ? 'var(--primary)' : 'var(--surface-alt)',
                  border: active ? 'none' : '1px solid var(--border)'
                }}
              >
                {done ? <CheckCircle2 size={14} /> : step}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: active ? 800 : 500,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)'
                }}
              >
                {label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

const OWNERSHIP_OPTIONS = [
  { value: 'owner', label: 'I own the property' },
  { value: 'family', label: 'Family-owned property' },
  { value: 'manager', label: 'I manage it for the owner' },
  { value: 'agent', label: 'I am an agent' }
] as const;

export function ProviderRegisterPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    isAuthenticated,
    isLoading,
    user,
    profile,
    refreshProfile,
    signUpWithPassword,
    updateProfile
  } = useAuth();

  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Account fields (only when signing up from this page)
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Application fields
  const [accountType, setAccountType] = useState<ProviderType>('landlord');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredContact, setPreferredContact] = useState('phone');
  const [stateName, setStateName] = useState('');
  const [lga, setLga] = useState('');
  const [town, setTown] = useState('');
  const [address, setAddress] = useState('');
  const [ownershipStatus, setOwnershipStatus] = useState('owner');
  const [propertiesCount, setPropertiesCount] = useState('');
  const [intendedLocation, setIntendedLocation] = useState('');
  const [rentKobo, setRentKobo] = useState('');
  const [identityPath, setIdentityPath] = useState('');
  const [ownershipPath, setOwnershipPath] = useState('');
  const [authorizationPath, setAuthorizationPath] = useState('');
  const [uploading, setUploading] = useState<{ identity?: boolean; ownership?: boolean; authorization?: boolean }>({});
  const [agreed, setAgreed] = useState(false);

  // Personal details already stored on the FUW account (from registration).
  const phoneOnFile = (profile?.phoneNumber || '').trim();

  useEffect(() => {
    let active = true;
    (async () => {
      if (isLoading) return;
      if (!isAuthenticated) {
        if (active) setPhase('account');
        return;
      }
      try {
        const existing = await fetchMyProvider();
        if (!active) return;
        if (existing.registered) {
          navigate('/provider', { replace: true });
          return;
        }
      } catch {
        // A read failure must not block registration.
      }
      if (active) {
        // Personal details already live on the FUW account — reuse them instead
        // of asking for the same information again.
        setFullName((prev) => prev || profile?.fullName || user?.user_metadata?.full_name || '');
        setPhone((prev) => prev || profile?.phoneNumber || '');
        setPhase('application');
      }
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated, isLoading, navigate, profile?.fullName, profile?.phoneNumber, user?.user_metadata?.full_name]);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!fullName.trim()) {
      setErrorMsg('Enter your full legal name.');
      return;
    }
    setBusy(true);
    try {
      const { error, needsEmailConfirmation } = await signUpWithPassword({
        fullName: fullName.trim(),
        username,
        email,
        password
      });
      if (error) {
        setErrorMsg(error.message);
        return;
      }
      if (needsEmailConfirmation) {
        setPhase('confirm-email');
        return;
      }
      const existing = await fetchMyProvider().catch(() => null);
      if (existing?.registered) {
        navigate('/provider', { replace: true });
        return;
      }
      toast('Account created. Complete your provider application.', 'success');
      setPhase('application');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Registration failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDocument = async (
    file: File | undefined,
    kind: 'identity' | 'ownership' | 'authorization'
  ) => {
    if (!file) return;
    setUploading((u) => ({ ...u, [kind]: true }));
    try {
      const path = await uploadProviderDocument(file);
      if (kind === 'identity') setIdentityPath(path);
      else if (kind === 'ownership') setOwnershipPath(path);
      else setAuthorizationPath(path);
      toast('Document uploaded.', 'success');
    } catch (err: any) {
      toast(err?.message || 'Upload failed.', 'error');
    } finally {
      setUploading((u) => ({ ...u, [kind]: false }));
    }
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    // Personal details come from the authenticated profile, never re-entered.
    const effectiveFullName = (profile?.fullName || user?.user_metadata?.full_name || fullName || '').trim();
    const effectivePhone = (phone.trim() || phoneOnFile).trim();
    if (effectiveFullName.length < 3) return setErrorMsg('Your profile is missing your full legal name. Update it before submitting.');
    if (effectivePhone.replace(/\D/g, '').length < 10)
      return setErrorMsg('Enter a valid phone number so tenants and FUW can reach you.');
    if (!agreed) return setErrorMsg('Please confirm the declaration before submitting.');

    setBusy(true);
    try {
      const count = propertiesCount.trim() ? Number(propertiesCount) : undefined;
      await registerProvider({
        accountType,
        fullName: effectiveFullName,
        phone: effectivePhone,
        state: stateName.trim() || undefined,
        lga: lga.trim() || undefined,
        town: town.trim() || undefined,
        address: address.trim() || undefined,
        preferredContact,
        ownershipStatus,
        propertiesCount: Number.isFinite(count) ? count : undefined,
        intendedLocation: intendedLocation.trim() || undefined,
        advertRentKobo: rentKobo.trim() ? Math.round(Number(rentKobo) * 100) : undefined,
        businessName: businessName.trim() || undefined,
        identityDocumentPath: identityPath || undefined,
        ownershipEvidencePath: accountType === 'landlord' ? ownershipPath || undefined : undefined,
        authorizationEvidencePath: accountType === 'caretaker' ? authorizationPath || undefined : undefined
      });

      // Persist the contact details onto the trusted FUW profile so the same
      // information is never requested again (it also powers future sign-ins).
      const sync: { phoneNumber?: string; fullName?: string } = {};
      if (effectivePhone && !phoneOnFile) sync.phoneNumber = effectivePhone;
      if (effectiveFullName && !profile?.fullName) sync.fullName = effectiveFullName;
      if (Object.keys(sync).length > 0) {
        await updateProfile(sync).catch(() => null);
      }

      // Providers do not go through student onboarding.
      try {
        const { supabase } = await import('../lib/supabase');
        await supabase?.rpc('complete_user_onboarding', { p_step: 1, p_completed: true });
      } catch {
        // Non-fatal: the portal works either way.
      }
      await refreshProfile().catch(() => null);
      toast('Application submitted. An administrator will review it shortly.', 'success');
      navigate('/provider', { replace: true });
    } catch (err: any) {
      const message: string = err?.message || 'Could not submit your application.';
      if (message.startsWith('INSUFFICIENT_FUNDS')) {
        setErrorMsg('Your wallet balance is too low. Fund your wallet before submitting listings.');
      } else {
        setErrorMsg(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: 760,
    width: '100%',
    margin: '32px auto',
    padding: 28,
    borderRadius: 16
  };

  return (
    <div className="site-wrapper">
      <Header />
      <div className="content-grow">
        <SEO
          title="Landlord & Caretaker Registration"
          description="Register as a FUW landlord or caretaker to list verified student accommodation on the FUW Campus Hub."
          path="/register/provider"
          noindex
        />

        <main className={fx.fadeIn} style={{ padding: '0 16px' }}>
          <div className="card" style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: 'var(--green-100, #dcfce7)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--green-800, #166534)'
                }}
              >
                <Home size={24} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Landlord &amp; Caretaker Portal</h1>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                  List off-campus accommodation for FUW students. Every listing is reviewed before it goes live.
                </p>
              </div>
            </div>

            {phase === 'loading' && (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <Loader2 className="animate-spin" size={26} style={{ color: 'var(--primary)' }} />
                <p style={{ color: 'var(--text-secondary)', marginTop: 12 }}>Checking your account…</p>
              </div>
            )}

            {phase === 'confirm-email' && (
              <div style={{ padding: 8 }}>
                <div className="card" style={{ padding: 20, background: 'var(--success-bg, #ecfdf5)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <CheckCircle2 size={22} style={{ color: 'var(--green-800, #166534)', flexShrink: 0 }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: 4 }}>Confirm your email to continue</strong>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                        We sent a confirmation link to <strong>{email}</strong>. Open it, then return to this page and
                        sign in to complete your provider application.
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: 16 }}
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Go to sign in
                </button>
              </div>
            )}

            {phase === 'account' && (
              <form onSubmit={handleCreateAccount} noValidate>
                <StepIndicator current={1} />
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>1. Create your account</h2>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Already have a FUW account? <Link to="/login">Sign in</Link> and register from inside the portal.
                </p>

                {errorMsg && (
                  <div className="card" style={{ padding: 12, marginBottom: 14, background: 'var(--error-bg)', color: 'var(--red-700)' }}>
                    {errorMsg}
                  </div>
                )}

                <Field label="Full legal name">
                  <input className="form-input" style={{ width: '100%' }} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Dominic Abraham" autoComplete="name" disabled={busy} />
                </Field>
                <Field label="Username">
                  <input className="form-input" style={{ width: '100%' }} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="e.g. abraham.lodge" autoComplete="username" maxLength={20} disabled={busy} />
                </Field>
                <Field label="Email address">
                  <input className="form-input" style={{ width: '100%' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" disabled={busy} />
                </Field>
                <Field label="Password">
                  <input className="form-input" style={{ width: '100%' }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" disabled={busy} />
                  <p style={{ fontSize: 11, color: 'var(--text-muted, #888)', margin: '4px 0 0' }}>{PASSWORD_REQUIREMENTS_TEXT}</p>
                </Field>

                <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
                  {busy ? <><Loader2 className="animate-spin" size={16} /> Creating account…</> : <>Continue <ArrowRight size={16} /></>}
                </button>
              </form>
            )}

            {phase === 'application' && (
              <form onSubmit={handleSubmitApplication} noValidate>
                <StepIndicator current={2} />
                <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>2. Role &amp; property details</h2>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Signed in as <strong>{user?.email}</strong>. Only the additional details below are needed; the rest
                  comes from your FUW account.
                </p>

                {errorMsg && (
                  <div className="card" style={{ padding: 12, marginBottom: 14, background: 'var(--error-bg)', color: 'var(--red-700)' }}>
                    {errorMsg}
                  </div>
                )}

                {/* Personal details are pulled from the authenticated profile and are
                    never re-entered. Changes belong in the profile/account editors. */}
                {(profile?.fullName || user?.user_metadata?.full_name) && (
                  <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                    <h3 style={{ fontSize: 13, fontWeight: 800, margin: '0 0 8px' }}>Your details — from your FUW account</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '6px 16px' }}>
                      <SummaryRow label="Full name" value={(profile?.fullName || user?.user_metadata?.full_name || '').trim()} />
                      <SummaryRow label="Email" value={user?.email || ''} />
                      {phoneOnFile ? (
                        <SummaryRow label="Phone (on file)" value={phoneOnFile} />
                      ) : null}
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted, #888)' }}>
                      To change your name or email, update them in your account settings after finishing.
                    </p>
                  </div>
                )}

                <Field label="I am registering as">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {(['landlord', 'caretaker'] as ProviderType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setAccountType(t)}
                        className="btn"
                        style={{
                          flex: '1 1 200px',
                          justifyContent: 'center',
                          gap: 8,
                          border: `2px solid ${accountType === t ? 'var(--green-600, #16a34a)' : 'var(--border)'}`,
                          background: accountType === t ? 'var(--green-50, #f0fdf4)' : 'var(--surface)',
                          color: 'var(--text-primary)'
                        }}
                      >
                        {t === 'landlord' ? <Building2 size={16} /> : <KeyRound size={16} />}
                        {t === 'landlord' ? 'Landlord (property owner)' : 'Caretaker (manages properties)'}
                      </button>
                    ))}
                  </div>
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {!phoneOnFile && (
                    <Field label="Phone number (saved to your profile) *">
                      <input className="form-input" style={{ width: '100%' }} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08012345678" disabled={busy} />
                    </Field>
                  )}
                  <Field label="Business / lodge name (optional)">
                    <input className="form-input" style={{ width: '100%' }} value={businessName} onChange={(e) => setBusinessName(e.target.value)} disabled={busy} />
                  </Field>
                  <Field label="Preferred contact">
                    <select className="form-select" style={{ width: '100%' }} value={preferredContact} onChange={(e) => setPreferredContact(e.target.value)} disabled={busy}>
                      <option value="phone">Phone call</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="sms">SMS</option>
                      <option value="email">Email</option>
                    </select>
                  </Field>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                  <Field label="State">
                    <input className="form-input" style={{ width: '100%' }} value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="Taraba" disabled={busy} />
                  </Field>
                  <Field label="LGA">
                    <input className="form-input" style={{ width: '100%' }} value={lga} onChange={(e) => setLga(e.target.value)} placeholder="Wukari" disabled={busy} />
                  </Field>
                  <Field label="Town / area">
                    <input className="form-input" style={{ width: '100%' }} value={town} onChange={(e) => setTown(e.target.value)} disabled={busy} />
                  </Field>
                </div>

                <Field label="Contact address">
                  <input className="form-input" style={{ width: '100%' }} value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} />
                </Field>

                {accountType === 'landlord' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <Field label="Ownership">
                      <select className="form-select" style={{ width: '100%' }} value={ownershipStatus} onChange={(e) => setOwnershipStatus(e.target.value)} disabled={busy}>
                        {OWNERSHIP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Number of properties">
                      <input className="form-input" style={{ width: '100%' }} type="number" min={0} value={propertiesCount} onChange={(e) => setPropertiesCount(e.target.value)} disabled={busy} />
                    </Field>
                    <Field label="Typical annual rent (₦, optional)">
                      <input className="form-input" style={{ width: '100%' }} type="number" min={0} value={rentKobo} onChange={(e) => setRentKobo(e.target.value)} disabled={busy} />
                    </Field>
                  </div>
                ) : (
                  <Field label="Properties you intend to manage (area/location)">
                    <input className="form-input" style={{ width: '100%' }} value={intendedLocation} onChange={(e) => setIntendedLocation(e.target.value)} placeholder="e.g. New Site, Wukari" disabled={busy} />
                  </Field>
                )}

                <div style={{ marginTop: 8 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, margin: '12px 0 8px' }}>Verification documents</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                    Stored privately. Only you and platform administrators can view them.
                  </p>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <DocRow
                      label="Identity document (required)"
                      onFile={(f) => handleDocument(f, 'identity')}
                      uploading={uploading.identity}
                      done={!!identityPath}
                      disabled={busy}
                    />
                    {accountType === 'landlord' ? (
                      <DocRow
                        label="Ownership evidence (e.g. deed, rent agreement)"
                        onFile={(f) => handleDocument(f, 'ownership')}
                        uploading={uploading.ownership}
                        done={!!ownershipPath}
                        disabled={busy}
                      />
                    ) : (
                      <DocRow
                        label="Authorisation from the owner"
                        onFile={(f) => handleDocument(f, 'authorization')}
                        uploading={uploading.authorization}
                        done={!!authorizationPath}
                        disabled={busy}
                      />
                    )}
                  </div>
                </div>

                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, fontSize: 13 }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
                  <span>
                    I confirm the information is accurate and I am authorised to advertise any property I list. False
                    listings may be removed and my account suspended.
                  </span>
                </label>

                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                  <Link to="/" className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                    Cancel
                  </Link>
                  <button type="submit" className="btn btn-primary" disabled={busy} style={{ flex: 1, justifyContent: 'center' }}>
                    {busy ? <><Loader2 className="animate-spin" size={16} /> Submitting…</> : <><ShieldCheck size={16} /> Submit application</>}
                  </button>
                </div>
              </form>
            )}
          </div>
        </main>
      </div>
      <Footer />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, flex: '1 1 auto' }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
      <strong style={{ fontSize: 13 }}>{value || '—'}</strong>
    </div>
  );
}

function DocRow({
  label,
  onFile,
  uploading,
  done,
  disabled
}: {
  label: string;
  onFile: (file: File | undefined) => void;
  uploading?: boolean;
  done: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <label
        className="btn btn-secondary"
        style={{ cursor: disabled || uploading ? 'not-allowed' : 'pointer', gap: 6, opacity: disabled ? 0.7 : 1 }}
      >
        {uploading ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
        {uploading ? 'Uploading…' : 'Choose file'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: 'none' }}
          disabled={disabled || uploading}
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      <span style={{ fontSize: 12, color: done ? 'var(--green-800, #166534)' : 'var(--text-secondary)' }}>
        {done ? <><CheckCircle2 size={13} style={{ verticalAlign: 'middle' }} /> {label}</> : label}
      </span>
    </div>
  );
}

export default ProviderRegisterPage;
