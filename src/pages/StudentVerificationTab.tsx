// StudentVerificationTab — the student's academic identity verification screen.
//
// Reads and writes only through the guarded server RPCs plus the
// verify-document edge function. The client can never grant verification: the
// document is uploaded, the RPC parks it in `processing`, and trusted backend
// logic records the decision.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchMyVerificationRequests,
  fetchVerificationState,
  getDocumentUrl,
  runDocumentVerification,
  submitVerification,
  type DocumentType,
  type VerificationRequest,
  type VerificationState
} from '../lib/verification';

const STEPS = [
  'Confirm your matriculation number, faculty and department',
  'Choose a document and upload a clear copy',
  'Automated authenticity checks run instantly',
  'Unlock premium access once verified'
];

const ACCEPTED_DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_DOC_BYTES = 5 * 1024 * 1024;

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  student_id: 'Student ID card',
  admission_letter: 'Admission letter'
};

const STALE_PROCESSING_MS = 90_000;

export function StudentVerificationTab() {
  const { profile, isProfileComplete, refreshProfile, refreshEntitlement, plan, hasPremium } = useAuth();
  const [state, setState] = useState<VerificationState | null>(null);
  const [history, setHistory] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('student_id');
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

  // Verification is a server state; keep it fresh on focus and while the
  // automated checks are running.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const status = state?.status ?? 'unsubmitted';

  useEffect(() => {
    if (status !== 'processing') return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      void load();
      if (ticks >= 20) window.clearInterval(timer);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [status, load]);

  const latestRequest = history[0] ?? null;
  const activeRequest =
    latestRequest &&
    ['processing', 'pending', 'action_required', 'verification_unavailable'].includes(latestRequest.status)
      ? latestRequest
      : latestRequest;

  const processingStale = useMemo(() => {
    if (status !== 'processing') return false;
    const submittedAt = state?.submittedAt ? Date.parse(state.submittedAt) : NaN;
    return Number.isFinite(submittedAt) && Date.now() - submittedAt > STALE_PROCESSING_MS;
  }, [status, state?.submittedAt]);

  const handleSubmit = async () => {
    if (!file) {
      setError('Choose the document you want to verify with.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitVerification({ documentType, file, note });
      setNote('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setNotice('We’re checking your document. You’ll see the result here in a moment.');
      // Give the pipeline a head start, then refresh.
      setTimeout(() => void load(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your document.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryCheck = async () => {
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      await runDocumentVerification(activeRequest?.id);
      setNotice('Checking again… this can take a few seconds.');
      setTimeout(() => void load(), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification is temporarily unavailable.');
    } finally {
      setChecking(false);
    }
  };

  const openDocument = async (path: string | null) => {
    const url = await getDocumentUrl(path);
    if (!url) {
      setError('That document could not be opened. Try again in a moment.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onPickDocument = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    if (picked.size > MAX_DOC_BYTES) {
      setError('That file is larger than 5 MB. Please upload a smaller scan or photo.');
      e.target.value = '';
      return;
    }
    if (!ACCEPTED_DOC_TYPES.includes(picked.type)) {
      setError('Your document must be a JPG, PNG, WebP or PDF file.');
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(picked);
  };

  const canSubmit =
    isProfileComplete &&
    (status === 'unsubmitted' || status === 'rejected' || status === 'action_required');

  const statusTitle =
    status === 'verified'
      ? 'Identity verified'
      : status === 'processing'
        ? 'Checking your document'
        : status === 'pending'
          ? 'Under review'
          : status === 'rejected'
            ? 'Verification not accepted'
            : status === 'action_required'
              ? 'A clearer document is needed'
              : status === 'verification_unavailable'
                ? 'Verification temporarily unavailable'
                : 'Not submitted yet';

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>Academic verification</h1>
          <p>
            Confirm you are a registered FUW student. Choose either your student ID card or your
            admission letter, and the system verifies it automatically.
          </p>
        </div>
      </div>

      {loading && !state ? (
        <div className="card" role="status">
          <p className="muted-row">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading your status…
          </p>
        </div>
      ) : (
        <>
          <section className={`verify-status-card is-${status}`} aria-live="polite">
            <span className="verify-status-icon" aria-hidden="true">
              {status === 'verified' ? (
                <BadgeCheck size={24} />
              ) : status === 'processing' || status === 'pending' ? (
                <Clock3 size={24} />
              ) : status === 'unsubmitted' ? (
                <ShieldCheck size={24} />
              ) : (
                <AlertTriangle size={24} />
              )}
            </span>
            <div className="verify-status-body">
              <b>{statusTitle}</b>
              <span>
                {status === 'verified' &&
                  'Your document has been verified. Your account is now verified, and premium materials are unlocked once you hold an active plan.'}
                {status === 'processing' &&
                  'We’re checking your document. This usually takes a few seconds.'}
                {status === 'pending' &&
                  'Your document needs a quick manual check by the library. You’ll be notified once a decision is made.'}
                {status === 'rejected' &&
                  (state?.reason ||
                    'Your submission was not accepted. Review the reason and submit again.').toString()}
                {status === 'action_required' &&
                  (state?.reason ||
                    'Your document could not be read clearly. Upload a clearer copy.').toString()}
                {status === 'verification_unavailable' &&
                  (state?.reason ||
                    'Verification could not be completed yet. Retry in a moment.').toString()}
                {status === 'unsubmitted' &&
                  'Choose either your student ID card or your admission letter and upload it once.'}
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

          {(status === 'processing' || status === 'verification_unavailable') && (
            <div className="verify-retry">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleRetryCheck()}
                disabled={checking || status === 'processing' && !processingStale}
                aria-busy={checking}
              >
                {checking ? (
                  <>
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Checking…
                  </>
                ) : (
                  <>
                    <RotateCw size={14} aria-hidden="true" /> Retry verification check
                  </>
                )}
              </button>
              {status === 'processing' && !processingStale && (
                <span className="muted">
                  Checks are still running. This button activates if they take longer than expected.
                </span>
              )}
            </div>
          )}

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
                what the checks compare against your document.
              </span>
            </div>
          )}

          <ol className="verify-steps">
            {STEPS.map((step, i) => (
              <li
                key={step}
                className={
                  status === 'verified' ? 'is-done' : i === 0 && !isProfileComplete ? 'is-current' : ''
                }
              >
                <span className="verify-step-index">{status === 'verified' ? '✓' : i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {canSubmit && (
            <section className="card verify-form" aria-labelledby="verify-form-heading">
              <h3 id="verify-form-heading">
                {status === 'action_required'
                  ? 'Upload a clearer document'
                  : status === 'rejected'
                    ? 'Submit again'
                    : 'Verify your identity'}
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

              <fieldset className="verify-doctype">
                <legend className="field-label">Which document are you submitting?</legend>
                <div className="segmented" role="radiogroup" aria-label="Document type">
                  {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={documentType === type}
                      className={documentType === type ? 'is-active' : ''}
                      onClick={() => setDocumentType(type)}
                    >
                      {DOCUMENT_LABELS[type]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="field-label" htmlFor="verify-document">
                {DOCUMENT_LABELS[documentType]} <span className="muted">(required, max 5 MB)</span>
              </label>
              <div className="verify-file-row">
                <input
                  ref={fileRef}
                  id="verify-document"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={onPickDocument}
                  className="sr-only"
                />
                <button type="button" className="secondary-btn" onClick={() => fileRef.current?.click()}>
                  <Paperclip size={15} aria-hidden="true" /> Choose file
                </button>
                {file && (
                  <span className="verify-file-chip">
                    <FileText size={14} aria-hidden="true" />
                    <span className="verify-file-name">{file.name}</span>
                    <span className="muted">({Math.round(file.size / 1024)} KB)</span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setFile(null);
                        if (fileRef.current) fileRef.current.value = '';
                      }}
                      aria-label="Remove document"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>

              <label className="field-label" htmlFor="verify-note">
                Anything else the system should know? <span className="muted">(optional)</span>
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
              <p className="verify-hint">
                Only the verification service and the library can open what you upload. Your
                document stays private and is never shown on your profile.
              </p>

              <button
                type="button"
                className="primary"
                onClick={() => void handleSubmit()}
                disabled={submitting || !isProfileComplete || !file}
                aria-busy={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Submitting…
                  </>
                ) : (
                  <>
                    <Send size={15} aria-hidden="true" /> Verify with this document
                  </>
                )}
              </button>
            </section>
          )}

          {status === 'pending' && (
            <p className="verify-footnote">
              The library has been notified and will complete the check. No action is needed from
              you right now.
            </p>
          )}

          {history.length > 0 && (
            <section className="card" aria-labelledby="verify-history-heading">
              <h3 id="verify-history-heading">Submission history</h3>
              <ul className="verify-history">
                {history.map((h) => (
                  <li key={h.id}>
                    <span className={`verify-pill is-${h.status}`}>{h.status.replace(/_/g, ' ')}</span>
                    <span className="verify-history-when">
                      {new Date(h.created_at).toLocaleDateString('en-NG', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                    <span className="verify-history-id">
                      {h.document_type ? `${DOCUMENT_LABELS[h.document_type]} · ` : ''}
                      {h.matric_number}
                    </span>
                    {h.reviewer_note && <span className="verify-history-note">“{h.reviewer_note}”</span>}
                    {h.decision_code && (
                      <span className="verify-history-note muted">
                        Check: {h.decision_code.replace(/_/g, ' ')}
                      </span>
                    )}
                    {h.student_id_path && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void openDocument(h.student_id_path)}
                      >
                        <FileText size={13} aria-hidden="true" /> Student ID
                      </button>
                    )}
                    {h.admission_letter_path && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void openDocument(h.admission_letter_path)}
                      >
                        <FileText size={13} aria-hidden="true" /> Admission letter
                      </button>
                    )}
                    {h.evidence_path && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void openDocument(h.evidence_path)}
                      >
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
