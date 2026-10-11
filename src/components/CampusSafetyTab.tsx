import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShieldAlert,
  Trash2
} from 'lucide-react';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { FileUploader } from './FileUploader';
import {
  CampusIssue,
  ISSUE_CATEGORIES,
  ISSUE_STATUS_LABELS,
  IssueCategory,
  SafetyContact,
  deleteMyIssue,
  fetchMyIssues,
  fetchSafetyContacts,
  issueCategoryLabel,
  submitIssue
} from '../lib/safety';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete that request.';
}

const CATEGORY_LABELS: Record<string, string> = {
  emergency: 'Emergency',
  security: 'Campus security',
  health: 'Health',
  counselling: 'Counselling',
  academic: 'Academic',
  admin: 'Administration',
  general: 'General'
};

function ContactCard({ contact }: { contact: SafetyContact }) {
  return (
    <article className="platform-tile">
      <div className="platform-tile-top">
        <strong>{contact.label}</strong>
        <span className="status-badge">{CATEGORY_LABELS[contact.category] ?? contact.category}</span>
      </div>
      {contact.description && <p className="campus-listing-description">{contact.description}</p>}
      {contact.address && <p className="platform-help"><MapPin size={13} /> {contact.address}</p>}
      <div className="platform-list-meta" style={{ marginTop: 8 }}>
        {contact.phone && <a className="secondary-btn" href={`tel:${contact.phone.replace(/\s+/g, '')}`}><Phone size={14} /> {contact.phone}</a>}
        {contact.email && <a className="secondary-btn" href={`mailto:${contact.email}`}><Mail size={14} /> Email</a>}
      </div>
    </article>
  );
}

export function CampusSafetyTab() {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [issues, setIssues] = useState<CampusIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [category, setCategory] = useState<IssueCategory>('water');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactRows, issueRows] = await Promise.all([
        fetchSafetyContacts(),
        fetchMyIssues()
      ]);
      setContacts(contactRows);
      setIssues(issueRows);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const emergencyContacts = useMemo(() => contacts.filter((c) => c.isEmergency), [contacts]);
  const otherContacts = useMemo(() => contacts.filter((c) => !c.isEmergency), [contacts]);

  const submit = async () => {
    if (!title.trim() || title.trim().length < 3) {
      toast('Give the problem a short title.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await submitIssue({
        category,
        title,
        description,
        location,
        photoPath,
        isAnonymous
      });
      setIssues((prev) => [created, ...prev]);
      setTitle('');
      setDescription('');
      setLocation('');
      setPhotoPath(null);
      setIsAnonymous(false);
      setFormOpen(false);
      toast(`Report received. Your reference is ${created.reference}.`, 'success');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeIssue = async () => {
    if (!confirmId) return;
    try {
      await deleteMyIssue(confirmId);
      setIssues((prev) => prev.filter((item) => item.id !== confirmId));
      toast('Report withdrawn.', 'info');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div className="portal-view-fade platform-shell">
      <header className="platform-header">
        <div>
          <p className="kicker">SAFETY &amp; CAMPUS ISSUES</p>
          <h2>Safety information &amp; issue reporting</h2>
          <p className="subtitle">
            Verified support contacts and a channel to report campus facilities problems. This is a
            platform-managed reporting tool — it is not an official FUW complaint system and does not
            dispatch emergency services.
          </p>
        </div>
        <button type="button" className="primary" onClick={() => setFormOpen((v) => !v)}>
          <Plus size={16} /> {formOpen ? 'Close form' : 'Report a problem'}
        </button>
      </header>

      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      <div className="inline-notice" role="note" style={{ marginBottom: 12 }}>
        <ShieldAlert size={15} />
        For an immediate emergency, contact the appropriate authority directly. Numbers below are shown
        exactly as published by campus moderators.
      </div>

      {loading ? (
        <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading safety information…</div>
      ) : (
        <>
          <section className="platform-card">
            <div className="platform-card-head"><div><h3>Emergency &amp; support contacts</h3></div></div>
            {contacts.length === 0 ? (
              <div className="portal-empty">
                <ShieldAlert className="empty-icon" size={32} />
                <p>No official contacts have been published yet.</p>
                <span>Campus moderators maintain this list. Until they add verified contacts, use your university’s known official channels.</span>
              </div>
            ) : (
              <>
                {emergencyContacts.length > 0 && (
                  <div className="platform-grid three-up" style={{ marginBottom: 12 }}>
                    {emergencyContacts.map((c) => <ContactCard key={c.id} contact={c} />)}
                  </div>
                )}
                {otherContacts.length > 0 && (
                  <div className="platform-grid three-up">
                    {otherContacts.map((c) => <ContactCard key={c.id} contact={c} />)}
                  </div>
                )}
              </>
            )}
          </section>

          {formOpen && (
            <section className="platform-card">
              <div className="platform-card-head"><div><h3>Report a campus problem</h3><p className="platform-help">You will receive a reference number to track progress.</p></div></div>
              <div className="platform-form-grid">
                <label className="platform-field">
                  <span>Category</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}>
                    {ISSUE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <label className="platform-field"><span>Short title *</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. No water at Hostel C block 2" /></label>
                <label className="platform-field platform-field-wide"><span>Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="e.g. Faculty of Science, Block B" /></label>
                <label className="platform-field platform-field-wide"><span>Describe the problem</span><textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is wrong, since when, and how it affects students." /></label>
                <div className="platform-field platform-field-wide">
                  <span>Photo (optional)</span>
                  {/* Issue photos intentionally reuse the private owner/admin 'lost-found' media scope. */}
                  <FileUploader
                    scope="lost-found"
                    value={photoPath}
                    onChange={setPhotoPath}
                    label="Attach a photo"
                    hint="JPG, PNG, WebP or PDF, up to 10 MB. Visible to you and campus moderators only."
                    onError={(message) => toast(message, 'error')}
                  />
                </div>
                <label className="platform-field"><span className="platform-checkbox-label"><input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} /> Show my report anonymously on any public summary</span></label>
              </div>
              <div className="platform-form-actions">
                <button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit report'}</button>
              </div>
            </section>
          )}

          <section className="platform-card">
            <div className="platform-card-head"><div><h3>My reports</h3><p className="platform-help">{issues.length} submitted</p></div></div>
            {issues.length === 0 ? (
              <div className="portal-empty"><p>You have not reported any campus problems yet.</p></div>
            ) : (
              <div className="platform-list">
                {issues.map((issue) => (
                  <article className="platform-list-item" key={issue.id}>
                    <div className="platform-course-copy">
                      <strong>
                        {issueCategoryLabel(issue.category)}: {issue.title}
                      </strong>
                      <small>
                        Ref {issue.reference} · {new Date(issue.createdAt).toLocaleDateString()}
                        {issue.location ? ` · ${issue.location}` : ''}
                      </small>
                      {issue.description && <small>{issue.description}</small>}
                      {issue.adminNotes && <small>Update: {issue.adminNotes}</small>}
                    </div>
                    <div className="platform-list-meta">
                      <span className={`status-badge status-${issue.status}`}>
                        {issue.status === 'resolved' ? <CheckCircle2 size={12} /> : <Clock size={12} />} {ISSUE_STATUS_LABELS[issue.status]}
                      </span>
                      {['open', 'closed'].includes(issue.status) && (
                        <button type="button" className="planner-icon-btn danger" aria-label={`Withdraw ${issue.reference}`} onClick={() => setConfirmId(issue.id)}><Trash2 size={15} /></button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <p className="platform-disclaimer">
        <AlertTriangle size={13} /> Reports are seen by you and campus moderators. This tool does not
        guarantee a fix or a response time, and it is not an official university channel unless stated.
      </p>

      <ConfirmDialog
        open={confirmId !== null}
        title="Withdraw this report?"
        message="Your report and its reference number will be removed."
        tone="danger"
        confirmLabel="Withdraw"
        onConfirm={removeIssue}
        onClose={() => setConfirmId(null)}
      />
    </div>
  );
}
