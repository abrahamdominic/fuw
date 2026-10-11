import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Award,
  CalendarClock,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2
} from 'lucide-react';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import {
  OPPORTUNITY_CATEGORIES,
  Opportunity,
  OpportunityCategory,
  daysUntil,
  deleteMyOpportunity,
  fetchMyOpportunitySubmissions,
  fetchPublishedOpportunities,
  opportunityCategoryLabel,
  submitOpportunity
} from '../lib/opportunities';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete that request.';
}

function deadlineLabel(deadline: string | null): { text: string; urgent: boolean; expired: boolean } {
  if (!deadline) return { text: 'Rolling / no deadline', urgent: false, expired: false };
  const days = daysUntil(deadline);
  const dateText = new Date(`${deadline}T00:00:00`).toLocaleDateString();
  if (days === null) return { text: dateText, urgent: false, expired: false };
  if (days < 0) return { text: `Closed ${dateText}`, urgent: false, expired: true };
  if (days === 0) return { text: `Closes today (${dateText})`, urgent: true, expired: false };
  if (days <= 14) return { text: `Closes in ${days} day${days === 1 ? '' : 's'} · ${dateText}`, urgent: true, expired: false };
  return { text: `Deadline ${dateText}`, urgent: false, expired: false };
}

export function OpportunitiesHubTab() {
  const { toast } = useToast();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [mine, setMine] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [showMine, setShowMine] = useState(false);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | OpportunityCategory>('all');
  const [remoteOnly, setRemoteOnly] = useState(false);

  const [form, setForm] = useState({
    title: '',
    organization: '',
    category: 'scholarship' as OpportunityCategory,
    description: '',
    eligibility: '',
    qualification: '',
    discipline: '',
    location: '',
    isRemote: false,
    deadline: '',
    benefits: '',
    applicationInstructions: '',
    applicationUrl: ''
  });

  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [published, submissions] = await Promise.all([
        fetchPublishedOpportunities(),
        fetchMyOpportunitySubmissions()
      ]);
      setOpportunities(published);
      setMine(submissions);
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

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return opportunities.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (remoteOnly && !item.isRemote) return false;
      if (!query) return true;
      return `${item.title} ${item.organization} ${item.discipline} ${item.location} ${item.description}`
        .toLowerCase()
        .includes(query);
    });
  }, [opportunities, search, category, remoteOnly]);

  const submit = async () => {
    if (!form.title.trim() || !form.organization.trim()) {
      toast('A title and organization are required.', 'error');
      return;
    }
    setBusy(true);
    try {
      await submitOpportunity({
        title: form.title,
        organization: form.organization,
        category: form.category,
        description: form.description,
        eligibility: form.eligibility,
        qualification: form.qualification,
        discipline: form.discipline,
        location: form.location,
        isRemote: form.isRemote,
        deadline: form.deadline || null,
        benefits: form.benefits,
        applicationInstructions: form.applicationInstructions,
        applicationUrl: form.applicationUrl || null
      });
      toast('Submitted for review. It becomes public only after moderation.', 'success');
      setForm({
        title: '', organization: '', category: 'scholarship', description: '', eligibility: '',
        qualification: '', discipline: '', location: '', isRemote: false, deadline: '',
        benefits: '', applicationInstructions: '', applicationUrl: ''
      });
      setFormOpen(false);
      await load();
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeMine = (id: string) => setConfirmId(id);

  const confirmRemove = async () => {
    if (!confirmId) return;
    try {
      await deleteMyOpportunity(confirmId);
      setMine((prev) => prev.filter((item) => item.id !== confirmId));
      toast('Submission deleted.', 'info');
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
          <p className="kicker">OPPORTUNITIES</p>
          <h2>Scholarships, internships &amp; more</h2>
          <p className="subtitle">
            A moderated directory of scholarships, bursaries, internships, graduate trainee programmes,
            hackathons, fellowships and certifications. Always confirm details on the official source
            before applying.
          </p>
        </div>
        <button type="button" className="primary" onClick={() => setFormOpen((v) => !v)}>
          <Plus size={16} /> {formOpen ? 'Close form' : 'Submit an opportunity'}
        </button>
      </header>

      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      {formOpen && (
        <section className="platform-card">
          <div className="platform-card-head"><div><h3>Share an opportunity</h3><p className="platform-help">Moderators review every submission before it is published.</p></div></div>
          <div className="platform-form-grid">
            <label className="platform-field"><span>Title *</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={180} /></label>
            <label className="platform-field"><span>Organization *</span><input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} maxLength={160} /></label>
            <label className="platform-field">
              <span>Category</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as OpportunityCategory })}>
                {OPPORTUNITY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className="platform-field"><span>Deadline</span><input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
            <label className="platform-field"><span>Location</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={160} placeholder="e.g. Abuja / Remote" /></label>
            <label className="platform-field"><span>Discipline / field</span><input value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })} maxLength={160} placeholder="e.g. Computer Science, any discipline" /></label>
            <label className="platform-field"><span>Qualification</span><input value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} maxLength={160} placeholder="e.g. 200L and above" /></label>
            <label className="platform-field platform-field-wide"><span>Official application link</span><input value={form.applicationUrl} onChange={(e) => setForm({ ...form, applicationUrl: e.target.value })} placeholder="https://…" /></label>
            <label className="platform-field platform-field-wide"><span>Description</span><textarea rows={3} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="platform-field platform-field-wide"><span>Eligibility</span><textarea rows={2} maxLength={2000} value={form.eligibility} onChange={(e) => setForm({ ...form, eligibility: e.target.value })} /></label>
            <label className="platform-field platform-field-wide"><span>Benefits</span><textarea rows={2} maxLength={2000} value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} /></label>
            <label className="platform-field platform-field-wide"><span>How to apply</span><textarea rows={2} maxLength={2000} value={form.applicationInstructions} onChange={(e) => setForm({ ...form, applicationInstructions: e.target.value })} /></label>
            <label className="platform-field"><span className="platform-checkbox-label"><input type="checkbox" checked={form.isRemote} onChange={(e) => setForm({ ...form, isRemote: e.target.checked })} /> Available remotely</span></label>
          </div>
          <div className="platform-form-actions">
            <button type="button" className="secondary-btn" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit for review'}</button>
          </div>
        </section>
      )}

      <div className="campus-search">
        <Search size={15} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search opportunities" aria-label="Search opportunities" />
      </div>

      <div className="segmented-pills" role="group" aria-label="Opportunity filters">
        <button type="button" className={`segmented-pill ${category === 'all' ? 'active' : ''}`} onClick={() => setCategory('all')}>All</button>
        {OPPORTUNITY_CATEGORIES.map((c) => (
          <button key={c.key} type="button" className={`segmented-pill ${category === c.key ? 'active' : ''}`} onClick={() => setCategory(c.key)}>{c.label}</button>
        ))}
        <button type="button" className={`segmented-pill ${remoteOnly ? 'active' : ''}`} onClick={() => setRemoteOnly((v) => !v)}>Remote only</button>
        <button type="button" className={`segmented-pill ${showMine ? 'active' : ''}`} onClick={() => setShowMine((v) => !v)}>My submissions ({mine.length})</button>
      </div>

      {loading ? (
        <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading opportunities…</div>
      ) : showMine ? (
        <section className="platform-card">
          <div className="platform-card-head"><div><h3>My submissions</h3></div></div>
          {mine.length === 0 ? (
            <div className="portal-empty"><p>You have not submitted any opportunities yet.</p></div>
          ) : (
            <div className="platform-list">
              {mine.map((item) => (
                <article className="platform-list-item" key={item.id}>
                  <div className="platform-course-copy">
                    <strong>{item.title}</strong>
                    <small>{item.organization} · {opportunityCategoryLabel(item.category)}</small>
                    {item.moderationNote && <small>Moderator note: {item.moderationNote}</small>}
                  </div>
                  <div className="platform-list-meta">
                    <span className={`status-badge status-${item.status}`}>{item.status}</span>
                    {item.status === 'pending' && (
                      <button type="button" className="planner-icon-btn danger" aria-label={`Delete ${item.title}`} onClick={() => removeMine(item.id)}><Trash2 size={15} /></button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : visible.length === 0 ? (
        <div className="portal-empty">
          <Award className="empty-icon" size={32} />
          <p>{search || category !== 'all' || remoteOnly ? 'No opportunities match your filters.' : 'No published opportunities yet.'}</p>
          <span>Check back soon or submit one for review.</span>
        </div>
      ) : (
        <div className="platform-grid three-up">
          {visible.map((item) => {
            const dl = deadlineLabel(item.deadline);
            return (
              <article className="platform-tile campus-listing" key={item.id}>
                <div className="platform-tile-top">
                  <strong>{opportunityCategoryLabel(item.category)}</strong>
                  {item.isFeatured && <span className="status-badge">Featured</span>}
                </div>
                <h4>{item.title}</h4>
                <p>{item.organization}{item.location ? ` · ${item.location}` : ''}{item.isRemote ? ' · Remote' : ''}</p>
                {item.description && <p className="campus-listing-description">{item.description}</p>}
                <p className={`opportunity-deadline ${dl.expired ? 'is-expired' : dl.urgent ? 'is-urgent' : ''}`}>
                  <CalendarClock size={13} /> {dl.text}
                </p>
                {(item.eligibility || item.qualification) && (
                  <p className="platform-help">{item.qualification || item.eligibility}</p>
                )}
                {item.lastVerifiedAt && <p className="platform-help">Last verified {new Date(`${item.lastVerifiedAt}T00:00:00`).toLocaleDateString()}</p>}
                <div className="platform-list-meta" style={{ marginTop: 8 }}>
                  {item.applicationUrl ? (
                    <a className="secondary-btn" href={item.applicationUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} /> Apply on official site
                    </a>
                  ) : (
                    <span className="platform-help"><MapPin size={13} /> See instructions</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="platform-disclaimer">
        <ArrowUpRight size={13} /> Listings are community- and moderator-contributed pointers, not endorsements.
        The platform does not guarantee selection and never asks for an application fee.
      </p>

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this submission?"
        message="Your pending opportunity submission will be permanently removed."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={confirmRemove}
        onClose={() => setConfirmId(null)}
      />
    </div>
  );
}
