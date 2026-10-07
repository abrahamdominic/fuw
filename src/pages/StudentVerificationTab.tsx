// StudentVerificationTab — the student's academic identity verification screen.
//
// Reads and writes only through the guarded server RPCs in
// supabase/migrations/20260924_academic_verification_and_plans.sql.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchMyVerificationRequests,
  fetchVerificationState,
  getEvidenceUrl,
  submitVerification,
  type VerificationRequest,
  type VerificationState
} from '../lib/verification';

const STEPS = [
  'Add your matriculation number, faculty and department',
  'Upload a clear photo of your student ID or admission letter',
  'Wait for the library to review it',
  'Unlock premium access once approved'
];

export function StudentVerificationTab() {
  const { profile, isProfileComplete, refreshProfile, refreshEntitlement, plan, hasPremium } = useAuth();
  const [state, setState] = useState<VerificationState | null>(null);
  const [history, setHistory] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, past] = await Promise.all([fetchVerificationState(), fetchMyVerificationRequests()]);
      setState(next);
      setHistory(past);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your verification status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Verification is a re-checked server state, so keep it fresh on focus.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitVerification({ note, file });
      setNote('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setNotice('Sent to the library. You will get a notification as soon as it is reviewed.');
      await Promise.all([load(), refreshProfile(), refreshEntitlement()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your request.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEvidence = async (req: VerificationRequest) => {
    const url = await getEvidenceUrl(req);
    if (!url) {
      setError('That evidence file could not be opened. Try again in a moment.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const removeFile = () => {
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    if (picked.size > 5 * 1024 * 1024) {
      setError('That file is larger than 5 MB. Please compress it or upload a smaller photo.');
      e.target.value = '';
      return;
    }
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(picked.type);
    if (!ok) {
      setError('Evidence must be a JPG, PNG, WebP or PDF.');
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(picked);
  };

  const status = state?.status ?? 'unsubmitted';
  const canSubmit = isProfileComplete && (status === 'unsubmitted' || status === 'rejected');

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>Academic verification</h1>
          <p>
            Confirm you are a registered FUW student. Verification is required before premium
            materials can be downloaded.
          </p>
        </div>
      </div>

      {loading ? (
      <div className="card" role="status">
        <p className="muted-row">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading your status…
        </p>
      </div>
    ) : (
      <>
        <section className={`verify-status-card is-${status}`} aria-live="polite">
          <span className="verify-status-icon" aria-hidden="true">
            {status === 'verified' ? <BadgeCheck size={24} /> : status === 'pending' ? <Clock3 size={24} /> : status === 'rejected' ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
          </span>
          <div className="verify-status-body">
            <b>
              {status === 'verified' && 'Identity verified'}
              {status === 'pending' && 'Under review'}
              {status === 'rejected' && 'Verification needs attention'}
              {status === 'unsubmitted' && 'Not submitted yet'}
            </b>
            <span>
              {status === 'verified' &&
                'The library has confirmed your academic identity. Premium materials are unlocked once you hold an active plan.'}
              {status === 'pending' &&
                'The library has your details. You will get a notification when a decision is made.'}
              {status === 'rejected' &&
                (state?.reason || 'Your submission was not accepted. Review the reason and submit again.').toString()}
              {status === 'unsubmitted' &&
                'Submit your student ID or admission letter so the library can confirm your identity.'}
            </span>
          </div>
          <button
            type="button"
            className="link-btn"
            onClick={() => void load()}
            aria-label="Refresh verification status"
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </section>

        {notice && (
          <p className="inline-notice is-success" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="inline-notice is-error" role="alert">
            {error}
          </p>
        )}

        {!isProfileComplete && (
          <div className="verify-prereq">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>
              Complete your profile first. Your matriculation number, faculty and department are
              what the library checks against the student register.
            </span>
          </div>
        )}

        <ol className="verify-steps">
          {STEPS.map((step, i) => (
            <li key={step} className={status === 'verified' ? 'is-done' : i === 0 && !isProfileComplete ? 'is-current' : ''}>
              <span className="verify-step-index">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {canSubmit && (
          <section className="card verify-form" aria-labelledby="verify-form-heading">
            <h3 id="verify-form-heading">
              {status === 'rejected' ? 'Submit again' : 'Request verification'}
            </h3>

            <dl className="verify-summary">
              <div>
                <dt>Matriculation number</dt>
                <dd>{profile?.matricNumber || 'Not set'}</dd>
              </div>
              <div>
                <dt>Faculty</dt>
                <dd>{profile?.faculty || 'Not set'}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{profile?.department || 'Not set'}</dd>
              </div>
              <div>
                <dt>Level</dt>
                <dd>{profile?.level || 'Not set'}</dd>
              </div>
            </dl>
            <p className="verify-hint">
              These are the details the library will review. If any of them is wrong, correct it in
              Settings before submitting.
            </p>

            <label className="field-label" htmlFor="verify-note">
              Anything the reviewer should know? <span className="muted">(optional)</span>
            </label>
            <textarea
              id="verify-note"
              className="form-textarea"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. My admission letter lists Computer Science, but I registered late."
            />

            <label className="field-label" htmlFor="verify-evidence">
              Student ID or admission letter <span className="muted">(optional, max 5 MB)</span>
            </label>
            <div className="verify-file-row">
              <input
                ref={fileRef}
                id="verify-evidence"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={onPickFile}
                className="sr-only"
              />
              <button
                type="button"
                className="secondary-btn"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip size={15} aria-hidden="true" /> Choose file
              </button>
              {file && (
                <span className="verify-file-chip">
                  <FileText size={14} aria-hidden="true" />
                  <span className="verify-file-name">{file.name}</span>
                  <span className="muted">({Math.round(file.size / 1024)} KB)</span>
                  <button type="button" className="link-btn" onClick={removeFile} aria-label="Remove selected file">
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
            <p className="verify-hint">
              Only the library can open what you upload. It is stored privately and never shown on
              your profile.
            </p>

            <button
              type="button"
              className="primary"
              onClick={() => void handleSubmit()}
              disabled={submitting || !isProfileComplete}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Submitting…
                </>
              ) : (
                <>
                  <Send size={15} aria-hidden="true" /> Submit for review
                </>
              )}
            </button>
          </section>
        )}

        {history.length > 0 && (
          <section className="card" aria-labelledby="verify-history-heading">
            <h3 id="verify-history-heading">Submission history</h3>
            <ul className="verify-history">
              {history.map((h) => (
                <li key={h.id}>
                  <span className={`verify-pill is-${h.status}`}>{h.status}</span>
                  <span className="verify-history-when">
                    {new Date(h.created_at).toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                  <span className="verify-history-id">
                    {h.matric_number} · {h.department}
                  </span>
                  {h.reviewer_note && <span className="verify-history-note">“{h.reviewer_note}”</span>}
                  {h.evidence_path && (
                    <button type="button" className="link-btn" onClick={() => void openEvidence(h)}>
                      <FileText size={13} aria-hidden="true" /> View file
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {status === 'verified' && (
          <p className="verify-footnote">
            {plan && hasPremium
              ? plan.expires_at
                ? `Premium plan ${plan.name} is active until ${new Date(plan.expires_at).toLocaleDateString('en-NG')}.`
                : `Premium plan ${plan.name} is active with no scheduled expiration.`
              : plan
                ? 'Your entitlement is saved, but Premium access is temporarily paused.'
              : 'You are verified but do not have an active plan yet. Ask the library about premium access.'}
          </p>
          )}
        </>
      )}
    </>
  );
}

export default StudentVerificationTab;