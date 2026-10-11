import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import { useToast } from '../components/Toast';
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog';
import {
  CampusIssue,
  ISSUE_CATEGORIES,
  ISSUE_STATUS_LABELS,
  IssuePriority,
  IssueStatus,
  SafetyCategory,
  SafetyContact,
  deleteIssue,
  deleteSafetyContact,
  fetchAllIssues,
  fetchSafetyContacts,
  issueCategoryLabel,
  updateIssueStatus,
  upsertSafetyContact
} from '../lib/safety';

type Mode = 'contacts' | 'issues';

const EMPTY_CONTACT = {
  id: '',
  label: '',
  category: 'general' as SafetyCategory,
  phone: '',
  email: '',
  address: '',
  description: '',
  isEmergency: false,
  isPublished: true,
  sortOrder: 100
};

const ISSUE_STATUSES: IssueStatus[] = ['open', 'in_review', 'in_progress', 'resolved', 'closed'];
const PRIORITIES: IssuePriority[] = ['low', 'normal', 'high', 'urgent'];

export function AdminSafetyTab() {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('contacts');

  return (
    <div className="platform-shell">
      <div className="platform-header">
        <div>
          <p className="kicker">ADMIN · SAFETY</p>
          <h2>Campus safety &amp; issues</h2>
          <p className="subtitle">Maintain verified support contacts and triage student issue reports.</p>
        </div>
        <div className="segmented-pills" role="tablist" aria-label="Safety admin sections">
          <button type="button" role="tab" aria-selected={mode === 'contacts'} className={`segmented-pill ${mode === 'contacts' ? 'active' : ''}`} onClick={() => setMode('contacts')}>Contacts</button>
          <button type="button" role="tab" aria-selected={mode === 'issues'} className={`segmented-pill ${mode === 'issues' ? 'active' : ''}`} onClick={() => setMode('issues')}>Issues</button>
        </div>
      </div>
      {mode === 'contacts' ? <ContactsPanel /> : <IssuesPanel toast={toast} />}
    </div>
  );
}

function ContactsPanel() {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_CONTACT });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContacts(await fetchSafetyContacts(true));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load contacts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (form.label.trim().length < 2) {
      toast('Give the contact a label.', 'error');
      return;
    }
    setSaving(true);
    try {
      await upsertSafetyContact({ ...form, id: form.id || undefined });
      toast(form.id ? 'Contact updated.' : 'Contact added.', 'success');
      setForm({ ...EMPTY_CONTACT });
      await load();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = (contact: SafetyContact) => {
    setForm({
      id: contact.id,
      label: contact.label,
      category: contact.category,
      phone: contact.phone,
      email: contact.email,
      address: contact.address,
      description: contact.description,
      isEmergency: contact.isEmergency,
      isPublished: contact.isPublished,
      sortOrder: contact.sortOrder
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async () => {
    if (!confirmId) return;
    try {
      await deleteSafetyContact(confirmId);
      setContacts((prev) => prev.filter((c) => c.id !== confirmId));
      toast('Contact deleted.', 'info');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Delete failed.', 'error');
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <>
      {error && <div className="inline-notice is-error" role="alert">{error}</div>}
      <section className="platform-card">
        <div className="platform-card-head"><div><h3>{form.id ? 'Edit contact' : 'Add contact'}</h3><p className="platform-help">Only publish numbers you can verify. Never invent official contacts.</p></div></div>
        <div className="platform-form-grid">
          <label className="platform-field"><span>Label *</span><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={120} placeholder="e.g. Campus Security Control Room" /></label>
          <label className="platform-field">
            <span>Category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SafetyCategory })}>
              {['emergency','security','health','counselling','academic','admin','general'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="platform-field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} /></label>
          <label className="platform-field"><span>Email</span><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={160} /></label>
          <label className="platform-field platform-field-wide"><span>Address / office</span><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={200} /></label>
          <label className="platform-field platform-field-wide"><span>Description</span><textarea rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label className="platform-field"><span>Sort order</span><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} /></label>
          <label className="platform-field"><span className="platform-checkbox-label"><input type="checkbox" checked={form.isEmergency} onChange={(e) => setForm({ ...form, isEmergency: e.target.checked })} /> Emergency contact</span></label>
          <label className="platform-field"><span className="platform-checkbox-label"><input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} /> Published to students</span></label>
        </div>
        <div className="platform-form-actions">
          {form.id && <button type="button" className="secondary-btn" onClick={() => setForm({ ...EMPTY_CONTACT })}>Cancel edit</button>}
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 size={15} className="spin" /> : form.id ? <Save size={15} /> : <Plus size={15} />} {form.id ? 'Save changes' : 'Add contact'}
          </button>
        </div>
      </section>

      <section className="platform-card">
        <div className="platform-card-head">
          <div><h3>Published contacts</h3></div>
          <button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
        </div>
        {loading ? (
          <div className="portal-empty"><Loader2 size={28} className="spin" /><p>Loading…</p></div>
        ) : contacts.length === 0 ? (
          <div className="portal-empty"><p>No contacts yet. Add verified support numbers above.</p></div>
        ) : (
          <div className="platform-list">
            {contacts.map((contact) => (
              <article className="platform-list-item" key={contact.id}>
                <div className="platform-course-copy">
                  <strong>{contact.label}{contact.isEmergency ? ' · Emergency' : ''}</strong>
                  <small>{contact.category} · {contact.phone || 'no phone'}{contact.email ? ` · ${contact.email}` : ''}</small>
                </div>
                <div className="platform-list-meta">
                  <span className={`status-badge`}>{contact.isPublished ? 'published' : 'hidden'}</span>
                  <button type="button" className="secondary-btn" onClick={() => edit(contact)}>Edit</button>
                  <button type="button" className="planner-icon-btn danger" aria-label={`Delete ${contact.label}`} onClick={() => setConfirmId(contact.id)}><Trash2 size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this contact?"
        message="Students will no longer see this contact."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={remove}
        onClose={() => setConfirmId(null)}
      />
    </>
  );
}

function IssuesPanel({ toast }: { toast: (message: string, type?: 'success' | 'error' | 'info') => void }) {
  const [issues, setIssues] = useState<CampusIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | IssueStatus>('all');
  const [busy, setBusy] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<CampusIssue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIssues(await fetchAllIssues());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load issues.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async (issue: CampusIssue, status: IssueStatus) => {
    setBusy(issue.id);
    try {
      await updateIssueStatus(issue.id, status);
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, status } : i)));
      toast(`Marked as ${ISSUE_STATUS_LABELS[status]}.`, 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const submitNote = async (note: string) => {
    if (!noteTarget) return;
    const issue = noteTarget;
    setBusy(issue.id);
    try {
      await updateIssueStatus(issue.id, issue.status, { adminNotes: note });
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, adminNotes: note } : i)));
      toast('Note saved.', 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const setPriority = async (issue: CampusIssue, priority: IssuePriority) => {
    setBusy(issue.id);
    try {
      await updateIssueStatus(issue.id, issue.status, { priority });
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? { ...i, priority } : i)));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!confirmId) return;
    try {
      await deleteIssue(confirmId);
      setIssues((prev) => prev.filter((i) => i.id !== confirmId));
      toast('Issue deleted.', 'info');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Delete failed.', 'error');
    } finally {
      setConfirmId(null);
    }
  };

  const filtered = issues.filter((issue) => {
    if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${issue.reference} ${issue.title} ${issue.location} ${issue.category}`.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="platform-card-head" style={{ marginBottom: 12 }}>
        <div className="campus-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference, title or location…" aria-label="Search issues" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={statusFilter === 'all' ? 'primary' : 'secondary-btn'} onClick={() => setStatusFilter('all')}>All</button>
          {ISSUE_STATUSES.map((s) => (
            <button key={s} type="button" className={statusFilter === s ? 'primary' : 'secondary-btn'} onClick={() => setStatusFilter(s)}>{ISSUE_STATUS_LABELS[s]}</button>
          ))}
          <button type="button" className="secondary-btn" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
        </div>
      </div>

      {error && <div className="inline-notice is-error" role="alert">{error}</div>}

      {loading ? (
        <div className="portal-empty"><Loader2 size={28} className="spin" /><p>Loading issues…</p></div>
      ) : filtered.length === 0 ? (
        <div className="portal-empty"><p>No issues found.</p></div>
      ) : (
        <div className="platform-list">
          {filtered.map((issue) => {
            const isBusy = busy === issue.id;
            return (
              <article className="platform-list-item" key={issue.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div className="platform-course-copy">
                    <strong>{issueCategoryLabel(issue.category)}: {issue.title}</strong>
                    <small>Ref {issue.reference} · {new Date(issue.createdAt).toLocaleDateString()}{issue.location ? ` · ${issue.location}` : ''}</small>
                    {issue.description && <small>{issue.description}</small>}
                    {issue.adminNotes && <small>Update: {issue.adminNotes}</small>}
                  </div>
                  <span className={`status-badge status-${issue.status}`}>{ISSUE_STATUS_LABELS[issue.status]}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {ISSUE_STATUSES.filter((s) => s !== issue.status).map((s) => (
                    <button key={s} type="button" className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.78rem' }} disabled={isBusy} onClick={() => void advance(issue, s)}>{ISSUE_STATUS_LABELS[s]}</button>
                  ))}
                  <select aria-label="Priority" value={issue.priority} disabled={isBusy} onChange={(e) => void setPriority(issue, e.target.value as IssuePriority)}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button type="button" className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.78rem' }} disabled={isBusy} onClick={() => setNoteTarget(issue)}>Add update</button>
                  <button type="button" className="planner-icon-btn danger" aria-label={`Delete ${issue.reference}`} onClick={() => setConfirmId(issue.id)}><Trash2 size={15} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this issue?"
        message="The report and its reference will be permanently removed."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={remove}
        onClose={() => setConfirmId(null)}
      />

      <PromptDialog
        open={noteTarget !== null}
        title="Add a public update"
        message={noteTarget ? `This update will be visible to the reporter of ${noteTarget.reference}.` : ''}
        placeholder="Status update shown to the reporter"
        defaultValue={noteTarget?.adminNotes ?? ''}
        confirmLabel="Save update"
        onSubmit={submitNote}
        onClose={() => setNoteTarget(null)}
      />
    </>
  );
}
