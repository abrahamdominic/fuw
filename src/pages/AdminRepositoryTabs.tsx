import React, { useState, useEffect, useCallback } from 'react';
import {
  Landmark, Loader2, Check, X, Archive, ShieldCheck, Eye, Trash2, FileWarning,
  Layers, Plus, ExternalLink, RefreshCw, Bell, Send, Megaphone
} from 'lucide-react';
import {
  fetchResearchReviewQueue,
  fetchMyResearchItems,
  approveResearchItem,
  rejectResearchItem,
  verifyResearchItem,
  archiveResearchItem,
  deleteResearchItem,
  getRepositoryStats,
  RESEARCH_TYPE_LABELS,
  ResearchItem,
  ResearchStatus
} from '../lib/repository';
import {
  fetchCollections,
  createCollection,
  toggleCollectionPublished,
  CollectionGroup
} from '../lib/collections';
import {
  fetchCopyrightReports,
  updateCopyrightReport,
  CopyrightReport,
  COMPLAINT_TYPES
} from '../lib/copyrightReports';
import {
  fetchAllHelpTopics,
  saveHelpTopic,
  deleteHelpTopic,
  fetchAllFaqItems,
  saveFaqItem,
  deleteFaqItem,
  fetchAllAnnouncements,
  saveAnnouncement,
  deleteAnnouncement,
  sendAnnouncement,
  setAnnouncementPublished,
  ANNOUNCEMENT_TYPES,
  AUDIENCE_OPTIONS,
  AnnouncementType,
  HelpTopic,
  FaqItem,
  LibraryAnnouncement
} from '../lib/helpCenter';
import { useToast } from '../components/Toast';
import { MessageText } from '../components/MessageText';
import { richPasteText, capLength, MESSAGE_MAX_LENGTH } from '../lib/messageFormat';

export function AdminRepositoryTab() {
  const { toast } = useToast();
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ResearchStatus | 'all'>('submitted');
  const [rejectTarget, setRejectTarget] = useState<ResearchItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let data: ResearchItem[];
      if (statusFilter === 'all') {
        data = await fetchMyResearchItems().catch(() => []);
        const { supabase } = await import('../lib/supabase');
        const { data: all } = await supabase!.from('research_items').select('*').order('created_at', { ascending: false });
        data = (all || []) as ResearchItem[];
      } else {
        data = await fetchResearchReviewQueue(statusFilter as string);
      }
      setItems(data);
      const s = await getRepositoryStats();
      setStats(s);
    } catch (err: any) {
      toast(err.message || 'Could not load repository items.', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = async (item: ResearchItem) => {
    try {
      await approveResearchItem(item.id);
      toast('Publication approved and made public.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not approve.', 'error');
    }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    try {
      await rejectResearchItem(rejectTarget.id, rejectReason);
      toast('Publication rejected.', 'success');
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not reject.', 'error');
    }
  };

  const handleVerify = async (item: ResearchItem) => {
    try {
      await verifyResearchItem(item.id, !item.is_verified);
      toast(item.is_verified ? 'Verification removed.' : 'Publication verified.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not update verification.', 'error');
    }
  };

  const handleArchive = async (item: ResearchItem) => {
    if (!window.confirm(`Archive "${item.title}"? It will be hidden from the public but preserved.`)) return;
    try {
      await archiveResearchItem(item.id, 'Archived by administrator');
      toast('Publication archived.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not archive.', 'error');
    }
  };

  const handleDelete = async (item: ResearchItem) => {
    if (!window.confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
    try {
      await deleteResearchItem(item.id);
      toast('Publication deleted.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not delete.', 'error');
    }
  };

  const statusBadge = (s: string) => <span className={`status-badge ${s}`}>{s.replace('_', ' ')}</span>;

  return (
    <div className="admin-repository-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><Landmark size={22} />Institutional Repository</h2>
          <p className="page-subtitle">Review, verify, publish and preserve the university's scholarly output.</p>
        </div>
        <button className="secondary-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="stat-cards">
        <div className="stat-card"><span className="stat-value">{stats.total_items ?? 0}</span><span className="stat-label">Total Items</span></div>
        <div className="stat-card pending"><span className="stat-value">{stats.pending_review ?? 0}</span><span className="stat-label">Pending Review</span></div>
        <div className="stat-card approved"><span className="stat-value">{stats.published ?? 0}</span><span className="stat-label">Published</span></div>
        <div className="stat-card"><span className="stat-value">{stats.verified ?? 0}</span><span className="stat-label">Verified</span></div>
      </div>

      <div className="repo-filters-row">
        {(['submitted', 'under_review', 'approved', 'published', 'rejected', 'archived', 'all'] as const).map((s) => (
          <button
            key={s}
            className={statusFilter === s ? 'primary btn-sm' : 'secondary-btn btn-sm'}
            onClick={() => setStatusFilter(s)}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <Landmark size={36} />
          <b>No items in this queue</b>
          <span>Repository submissions awaiting review will appear here.</span>
        </div>
      ) : (
        <div className="table-scroll-wrapper" style={{ margin: '0 1rem' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th><th>Type</th><th>Department</th><th>Year</th><th>Status</th><th>Verified</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="cell-bold">{item.title}</td>
                  <td>{RESEARCH_TYPE_LABELS[item.research_type] || item.research_type}</td>
                  <td className="cell-secondary">{item.department || '—'}</td>
                  <td className="cell-secondary">{item.year || '—'}</td>
                  <td>{statusBadge(item.status)}</td>
                  <td>{item.is_verified ? <ShieldCheck size={15} color="#0B6B3A" /> : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <a href={`/repository/${item.id}`} target="_blank" rel="noopener noreferrer" className="link-btn" title="View"><Eye size={14} /></a>
                      {(item.status === 'submitted' || item.status === 'under_review' || item.status === 'draft') && (
                        <>
                          <button className="link-btn" title="Approve" onClick={() => handleApprove(item)}><Check size={14} /></button>
                          <button className="link-btn" title="Reject" onClick={() => setRejectTarget(item)}><X size={14} /></button>
                        </>
                      )}
                      <button className="link-btn" title={item.is_verified ? 'Remove verification' : 'Verify'} onClick={() => handleVerify(item)}><ShieldCheck size={14} /></button>
                      <button className="link-btn" title="Archive" onClick={() => handleArchive(item)}><Archive size={14} /></button>
                      <button className="link-btn danger" title="Delete" onClick={() => handleDelete(item)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectTarget && (
        <div className="modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>Reject Publication</h3>
              <button className="link-btn" onClick={() => setRejectTarget(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.86rem', marginBottom: '0.7rem' }}>{rejectTarget.title}</p>
              <textarea
                className="form-input form-textarea"
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Provide a clear reason for rejection. The author will be notified."
              />
              <button className="primary submit-btn" style={{ marginTop: '0.8rem' }} disabled={!rejectReason.trim()} onClick={handleReject}>
                Reject Publication
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminCollectionsTab() {
  const { toast } = useToast();
  const [collections, setCollections] = useState<CollectionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', slug: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCollections(await fetchCollections());
    } catch (err: any) {
      toast(err.message || 'Could not load collections.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      const slug = form.slug.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await createCollection({ name: form.name, description: form.description, slug });
      toast('Collection created.', 'success');
      setForm({ name: '', description: '', slug: '' });
      setShowCreate(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not create collection.', 'error');
    }
  };

  return (
    <div className="admin-collections-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><Layers size={22} />Curated Collections</h2>
          <p className="page-subtitle">Create curated reading collections to guide students to key resources.</p>
        </div>
        <button className={showCreate ? 'secondary-btn' : 'primary'} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Collection</>}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card" style={{ margin: '0 1rem 1rem', padding: '1.2rem' }}>
          <div className="form-field">
            <label className="form-label">Collection Name *</label>
            <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Research Methodology Collection" />
          </div>
          <div className="form-field">
            <label className="form-label">Slug (optional)</label>
            <input className="form-input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated-from-name" />
          </div>
          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea className="form-input form-textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button type="submit" className="primary submit-btn form-submit-btn" disabled={!form.name.trim()}>Create Collection</button>
        </form>
      )}

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : collections.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <Layers size={36} />
          <b>No collections yet</b>
          <span>Create curated collections to help students discover key materials.</span>
        </div>
      ) : (
        <div className="rl-grid">
          {collections.map((c) => (
            <div className="rl-card" key={c.id}>
              <div className="rl-card-icon"><Layers size={20} /></div>
              <div className="rl-card-name">{c.name}</div>
              {c.description && <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{c.description}</div>}
              <div className="rl-card-count">{c.item_count || 0} items · {c.is_published ? 'Published' : 'Draft'}</div>
              <div className="rl-card-actions">
                <button className="link-btn" onClick={async () => { await toggleCollectionPublished(c.id, !c.is_published); await load(); }}>
                  {c.is_published ? 'Unpublish' : 'Publish'}
                </button>
                <a className="link-btn" href={`/collections/${c.slug}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> View
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminCopyrightReportsTab() {
  const { toast } = useToast();
  const [reports, setReports] = useState<CopyrightReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<CopyrightReport | null>(null);
  const [staffNotes, setStaffNotes] = useState('');
  const [decision, setDecision] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await fetchCopyrightReports(statusFilter));
    } catch (err: any) {
      toast(err.message || 'Could not load reports.', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => { void load(); }, [load]);

  const handleUpdate = async (status: string) => {
    if (!selected) return;
    try {
      await updateCopyrightReport(selected.id, { status, reviewDecision: decision, staffNotes });
      toast('Report updated.', 'success');
      setSelected(null);
      setStaffNotes('');
      setDecision('');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not update the report.', 'error');
    }
  };

  const typeLabel = (v: string) => COMPLAINT_TYPES.find((t) => t.value === v)?.label || v;

  return (
    <div className="admin-copyright-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><FileWarning size={22} />Copyright & Takedown Reports</h2>
          <p className="page-subtitle">Review copyright concerns, incorrect attribution and sensitive-material reports.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'open', 'resolved', 'rejected'].map((s) => (
            <button key={s} className={statusFilter === s ? 'primary btn-sm' : 'secondary-btn btn-sm'} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : reports.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <FileWarning size={36} />
          <b>No reports</b>
          <span>No copyright or takedown reports in this category.</span>
        </div>
      ) : (
        <div className="table-scroll-wrapper" style={{ margin: '0 1rem' }}>
          <table className="admin-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Description</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="clickable-row" onClick={() => { setSelected(r); setStaffNotes(r.staff_notes || ''); setDecision(r.review_decision || ''); }}>
                  <td className="cell-secondary">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td><span className="field-tag">{typeLabel(r.complaint_type)}</span></td>
                  <td className="cell-reason">{r.description.slice(0, 120)}{r.description.length > 120 ? '…' : ''}</td>
                  <td><span className={`status-badge ${r.status}`}>{r.status}</span></td>
                  <td><button className="link-btn">Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>Report Details</h3>
              <button className="link-btn" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="detail-info-grid">
                <div><div className="di-label">Type</div><div>{typeLabel(selected.complaint_type)}</div></div>
                <div><div className="di-label">Status</div><div><span className={`status-badge ${selected.status}`}>{selected.status}</span></div></div>
                <div className="di-full"><div className="di-label">Description</div><div>{selected.description}</div></div>
                {selected.claimant_name && <div><div className="di-label">Claimant</div><div>{selected.claimant_name}</div></div>}
                {selected.claimant_email && <div><div className="di-label">Email</div><div>{selected.claimant_email}</div></div>}
              </div>
              <div className="form-field" style={{ marginTop: '0.9rem' }}>
                <label className="form-label">Decision</label>
                <input className="form-input" value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="e.g. Resource restricted pending review" />
              </div>
              <div className="form-field">
                <label className="form-label">Staff Notes (internal)</label>
                <textarea className="form-input form-textarea" rows={3} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: '0.8rem' }}>
                <button className="primary" onClick={() => handleUpdate('resolved')}>Mark Resolved</button>
                <button className="secondary-btn" onClick={() => handleUpdate('rejected')}>Dismiss</button>
                <button className="secondary-btn" onClick={() => handleUpdate('under_review')}>Under Review</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminHelpTab() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'topics' | 'faqs'>('topics');
  const [topics, setTopics] = useState<HelpTopic[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [topicForm, setTopicForm] = useState<{ id: string | null; slug: string; title: string; category: string; body: string; sortOrder: number }>({ id: null, slug: '', title: '', category: 'general', body: '', sortOrder: 0 });
  const [faqForm, setFaqForm] = useState<{ id: string | null; question: string; answer: string; category: string; sortOrder: number }>({ id: null, question: '', answer: '', category: 'general', sortOrder: 0 });
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, f] = await Promise.all([fetchAllHelpTopics(), fetchAllFaqItems()]);
      setTopics(t);
      setFaqs(f);
    } catch (err: any) {
      toast(err.message || 'Could not load help content.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const resetForms = () => {
    setTopicForm({ id: null, slug: '', title: '', category: 'general', body: '', sortOrder: 0 });
    setFaqForm({ id: null, question: '', answer: '', category: 'general', sortOrder: 0 });
  };

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicForm.title.trim() || !topicForm.body.trim()) return;
    try {
      await saveHelpTopic(topicForm);
      toast(topicForm.id ? 'Help topic updated.' : 'Help topic created.', 'success');
      resetForms();
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not save help topic.', 'error');
    }
  };

  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faqForm.question.trim() || !faqForm.answer.trim()) return;
    try {
      await saveFaqItem(faqForm);
      toast(faqForm.id ? 'FAQ updated.' : 'FAQ created.', 'success');
      resetForms();
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not save FAQ.', 'error');
    }
  };

  const handleDeleteTopic = async (id: string) => {
    if (!window.confirm('Delete this help topic?')) return;
    try {
      await deleteHelpTopic(id);
      toast('Help topic deleted.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not delete help topic.', 'error');
    }
  };

  const handleDeleteFaq = async (id: string) => {
    if (!window.confirm('Delete this FAQ?')) return;
    try {
      await deleteFaqItem(id);
      toast('FAQ deleted.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not delete FAQ.', 'error');
    }
  };

  return (
    <div className="admin-help-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><ShieldCheck size={22} />Help Center</h2>
          <p className="page-subtitle">Manage the help topics and FAQs shown to students in the Help Center.</p>
        </div>
        <button className={showForm ? 'secondary-btn' : 'primary'} onClick={() => { setShowForm(!showForm); resetForms(); }}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New {tab === 'topics' ? 'Topic' : 'FAQ'}</>}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 1rem 1rem' }}>
        <button className={tab === 'topics' ? 'primary btn-sm' : 'secondary-btn btn-sm'} onClick={() => { setTab('topics'); setShowForm(false); resetForms(); }}>Topics ({topics.length})</button>
        <button className={tab === 'faqs' ? 'primary btn-sm' : 'secondary-btn btn-sm'} onClick={() => { setTab('faqs'); setShowForm(false); resetForms(); }}>FAQs ({faqs.length})</button>
      </div>

      {showForm && tab === 'topics' && (
        <form onSubmit={handleSaveTopic} className="card" style={{ margin: '0 1rem 1rem', padding: '1.2rem' }}>
          <div className="form-field">
            <label className="form-label">Title *</label>
            <input className="form-input" value={topicForm.title} onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Slug</label>
              <input className="form-input" value={topicForm.slug} onChange={(e) => setTopicForm({ ...topicForm, slug: e.target.value })} placeholder="auto-from-title" />
            </div>
            <div className="form-field">
              <label className="form-label">Category</label>
              <input className="form-input" value={topicForm.category} onChange={(e) => setTopicForm({ ...topicForm, category: e.target.value })} placeholder="general" />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Body *</label>
            <textarea className="form-input form-textarea" rows={5} value={topicForm.body} onChange={(e) => setTopicForm({ ...topicForm, body: e.target.value })} required />
          </div>
          <button type="submit" className="primary submit-btn form-submit-btn">{topicForm.id ? 'Save Changes' : 'Create Topic'}</button>
        </form>
      )}

      {showForm && tab === 'faqs' && (
        <form onSubmit={handleSaveFaq} className="card" style={{ margin: '0 1rem 1rem', padding: '1.2rem' }}>
          <div className="form-field">
            <label className="form-label">Question *</label>
            <input className="form-input" value={faqForm.question} onChange={(e) => setFaqForm({ ...faqForm, question: e.target.value })} required />
          </div>
          <div className="form-field">
            <label className="form-label">Answer *</label>
            <textarea className="form-input form-textarea" rows={4} value={faqForm.answer} onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })} required />
          </div>
          <div className="form-field">
            <label className="form-label">Category</label>
            <input className="form-input" value={faqForm.category} onChange={(e) => setFaqForm({ ...faqForm, category: e.target.value })} placeholder="general" />
          </div>
          <button type="submit" className="primary submit-btn form-submit-btn">{faqForm.id ? 'Save Changes' : 'Create FAQ'}</button>
        </form>
      )}

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : tab === 'topics' ? (
        topics.length === 0 ? (
          <div className="empty-state-card" style={{ margin: '0 1rem' }}>
            <ShieldCheck size={36} /><b>No help topics</b><span>Create your first help topic.</span>
          </div>
        ) : (
          <div className="table-scroll-wrapper" style={{ margin: '0 1rem' }}>
            <table className="admin-table">
              <thead><tr><th>Title</th><th>Category</th><th>Order</th><th>Actions</th></tr></thead>
              <tbody>
                {topics.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td><span className="field-tag">{t.category}</span></td>
                    <td className="cell-secondary">{t.sort_order}</td>
                    <td>
                      <button className="link-btn" onClick={() => { setTopicForm({ id: t.id, slug: t.slug, title: t.title, category: t.category, body: t.body, sortOrder: t.sort_order }); setShowForm(true); setTab('topics'); }}>Edit</button>
                      <button className="link-btn" style={{ color: '#dc2626' }} onClick={() => handleDeleteTopic(t.id)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : faqs.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <ShieldCheck size={36} /><b>No FAQs</b><span>Create your first FAQ.</span>
        </div>
      ) : (
        <div className="table-scroll-wrapper" style={{ margin: '0 1rem' }}>
          <table className="admin-table">
            <thead><tr><th>Question</th><th>Category</th><th>Actions</th></tr></thead>
            <tbody>
              {faqs.map((f) => (
                <tr key={f.id}>
                  <td>{f.question}</td>
                  <td><span className="field-tag">{f.category}</span></td>
                  <td>
                    <button className="link-btn" onClick={() => { setFaqForm({ id: f.id, question: f.question, answer: f.answer, category: f.category, sortOrder: f.sort_order }); setShowForm(true); setTab('faqs'); }}>Edit</button>
                    <button className="link-btn" style={{ color: '#dc2626' }} onClick={() => handleDeleteFaq(f.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminAnnouncementsTab() {
  const { toast } = useToast();
  const [announcements, setAnnouncements] = useState<LibraryAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState<{ id: string | null; title: string; body: string; audience: string; type: AnnouncementType; isPublished: boolean }>({ id: null, title: '', body: '', audience: 'everyone', type: 'general', isPublished: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAnnouncements(await fetchAllAnnouncements());
    } catch (err: any) {
      toast(err.message || 'Could not load announcements.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const resetForm = () => setForm({ id: null, title: '', body: '', audience: 'everyone', type: 'general', isPublished: true });

  /** Save or update a draft without broadcasting. */
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    try {
      await saveAnnouncement({ ...form, announcementType: form.type });
      toast(form.id ? 'Announcement updated.' : 'Announcement saved as draft.', 'success');
      resetForm();
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not save announcement.', 'error');
    }
  };

  /** Broadcast to every eligible user via the server-side send_announcement RPC. */
  const handleSend = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast('Add a title and message before sending.', 'error');
      return;
    }
    if (!window.confirm('You are about to send this announcement to all registered users. Continue?')) return;
    if (!window.confirm('Announcements are delivered to every student and staff member. This cannot be undone. Send anyway?')) return;
    setSending(true);
    try {
      await sendAnnouncement({ title: form.title, body: form.body, type: form.type, audience: form.audience });
      toast('Announcement sent successfully.', 'success');
      resetForm();
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not send the announcement.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleToggleStatus = async (a: LibraryAnnouncement) => {
    const published = a.is_published === false;
    try {
      await setAnnouncementPublished(a.id, published);
      toast(published ? 'Announcement activated.' : 'Announcement deactivated.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not update announcement.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await deleteAnnouncement(id);
      toast('Announcement deleted.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Could not delete announcement.', 'error');
    }
  };

  const typeLabel = (t?: string) => ANNOUNCEMENT_TYPES.find((x) => x.value === t)?.label ?? 'General';

  return (
    <div className="admin-announcements-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><Bell size={22} />Library Announcements</h2>
          <p className="page-subtitle">Compose, preview, and send announcements to every user’s notification feed.</p>
        </div>
        <button className={showForm ? 'secondary-btn' : 'primary'} onClick={() => { setShowForm(!showForm); resetForm(); }}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Announcement</>}
        </button>
      </div>

      {showForm && (
        <div className="card announcement-composer">
          <form onSubmit={handleSave}>
            <div className="form-field">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Library maintenance on Friday" maxLength={120} required />
            </div>
            <div className="form-field announcement-message-field">
              <label className="form-label">Message *</label>
              <textarea
                className="form-input announcement-message"
                rows={8}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Write a clear, concise announcement for students and staff…
Write short paragraphs separated by blank lines.
Use **bold**, *italics*, `code`, lists (start a line with “- ” or “1. ”), and [links](https://…) where helpful."
                maxLength={MESSAGE_MAX_LENGTH}
                onPaste={(e) => {
                  const inserted = richPasteText(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'));
                  if (inserted == null) return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  const start = el.selectionStart ?? 0;
                  const end = el.selectionEnd ?? 0;
                  setForm({ ...form, body: capLength(form.body.slice(0, start) + inserted + form.body.slice(end), MESSAGE_MAX_LENGTH) });
                  const pos = start + inserted.length;
                  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
                }}
                required
              />
              <div className="field-hint char-count">{form.body.length}/{MESSAGE_MAX_LENGTH}</div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Type</label>
                <select className="form-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AnnouncementType })}>
                  {ANNOUNCEMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Audience</label>
                <select className="form-input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                  {AUDIENCE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>

            {form.title.trim() || form.body.trim() ? (
              <div className="announcement-preview">
                <div className="preview-label"><Eye size={14} /> Live preview</div>
                <div className={`preview-card type-${form.type}`}>
                  <span className="preview-type">{typeLabel(form.type).toUpperCase()}</span>
                  <h3 className="preview-title">{form.title.trim() || 'Announcement title'}</h3>
                  {form.body.trim() ? (
                    <MessageText body={form.body} />
                  ) : (
                    <p className="preview-placeholder">Your announcement message will appear here. Students will receive this in their Alerts feed.</p>
                  )}
                  <div className="preview-meta">
                    <span>Sent to {AUDIENCE_OPTIONS.find((a) => a.value === form.audience)?.label}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="form-row announcement-actions">
              <button type="submit" className="secondary-btn" disabled={sending}>
                <Archive size={14} /> {form.id ? 'Save changes' : 'Save as draft'}
              </button>
              <button type="button" className="primary submit-btn" disabled={sending} onClick={handleSend}>
                <Send size={14} /> {sending ? 'Sending…' : 'Send to Everyone'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : announcements.length === 0 ? (
        <div className="empty-state-card" style={{ margin: '0 1rem' }}>
          <Bell size={36} /><b>No announcements</b><span>Send an announcement to keep students informed.</span>
        </div>
      ) : (
        <div className="table-scroll-wrapper announcement-table-wrap" style={{ margin: '0 1rem' }}>
          <table className="admin-table announcements-table">
            <thead><tr><th>Title</th><th>Type</th><th>Audience</th><th>Status</th><th>Sent</th><th>Actions</th></tr></thead>
            <tbody>
              {announcements.map((a) => (
                <tr key={a.id}>
                  <td data-label="Title">{a.title}</td>
                  <td data-label="Type"><span className={`ann-type-tag type-${a.announcement_type || 'general'}`}>{typeLabel(a.announcement_type)}</span></td>
                  <td data-label="Audience"><span className="field-tag">{a.audience}</span></td>
                  <td data-label="Status">{a.is_published === false ? 'Deactivated' : 'Active'}</td>
                  <td data-label="Sent" className="cell-secondary">{new Date(a.published_at).toLocaleString()}</td>
                  <td data-label="Actions" className="cell-actions">
                    <button className="link-btn" onClick={() => handleToggleStatus(a)}>{a.is_published === false ? 'Activate' : 'Deactivate'}</button>
                    <button className="link-btn" onClick={() => handleDelete(a.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}