import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Trash2,
  XCircle
} from 'lucide-react';
import { useToast } from '../components/Toast';
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog';
import {
  Opportunity,
  OpportunityStatus,
  deleteOpportunity,
  expireOpportunities,
  fetchAllOpportunities,
  opportunityCategoryLabel,
  setOpportunityFeatured,
  setOpportunityStatus,
  verifyOpportunity
} from '../lib/opportunities';

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function AdminOpportunitiesTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OpportunityStatus>('all');
  const [busy, setBusy] = useState('');

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({ open: false, title: '', message: '', action: async () => {} });

  const [rejectTarget, setRejectTarget] = useState<Opportunity | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchAllOpportunities());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load opportunities.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runExpiry = async () => {
    setBusy('expire');
    try {
      const count = await expireOpportunities();
      toast(count > 0 ? `${count} expired listing(s) updated.` : 'No newly expired listings.', 'info');
      await load();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Expiry sweep failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const approve = async (row: Opportunity) => {
    setBusy(row.id);
    try {
      await setOpportunityStatus(row.id, 'published');
      await verifyOpportunity(row.id, true);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'published', lastVerifiedAt: new Date().toISOString().slice(0, 10) } : r)));
      toast('Opportunity published.', 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const reject = (row: Opportunity) => {
    setRejectTarget(row);
  };

  const submitRejection = async (note: string) => {
    if (!rejectTarget) return;
    const row = rejectTarget;
    setBusy(row.id);
    try {
      await setOpportunityStatus(row.id, 'rejected', note);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'rejected', moderationNote: note } : r)));
      toast('Opportunity rejected.', 'info');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleFeatured = async (row: Opportunity) => {
    setBusy(row.id);
    try {
      const next = !row.isFeatured;
      await setOpportunityFeatured(row.id, next);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isFeatured: next } : r)));
      toast(next ? 'Marked as featured.' : 'Removed from featured.', 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'error');
    } finally {
      setBusy('');
    }
  };

  const remove = (row: Opportunity) => {
    setConfirmState({
      open: true,
      title: `Delete "${row.title}"?`,
      message: 'This permanently removes the listing.',
      action: async () => {
        setBusy(row.id);
        try {
          await deleteOpportunity(row.id);
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          toast('Opportunity deleted.', 'info');
        } catch (cause) {
          toast(cause instanceof Error ? cause.message : 'Delete failed.', 'error');
        } finally {
          setBusy('');
        }
      }
    });
  };

  const filtered = rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${row.title} ${row.organization} ${row.category}`.toLowerCase().includes(q);
  });

  const statuses: OpportunityStatus[] = ['pending', 'published', 'rejected', 'expired', 'closed'];

  return (
    <div className="platform-shell">
      <div className="platform-header">
        <div>
          <p className="kicker">ADMIN MODERATION</p>
          <h2>Opportunities hub</h2>
          <p className="subtitle">Review, publish, feature and expire student opportunity listings.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary-btn" disabled={busy === 'expire'} onClick={() => void runExpiry()}>
            {busy === 'expire' ? <Loader2 size={15} className="spin" /> : <Clock size={15} />} Run expiry sweep
          </button>
          <button type="button" className="secondary-btn" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="platform-card-head" style={{ marginBottom: 12 }}>
        <div className="campus-search">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, organization or category…" aria-label="Search opportunities" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={statusFilter === 'all' ? 'primary' : 'secondary-btn'} onClick={() => setStatusFilter('all')}>All</button>
          {statuses.map((s) => (
            <button key={s} type="button" className={statusFilter === s ? 'primary' : 'secondary-btn'} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {error && <div className="inline-notice is-error" role="alert">{error}</div>}

      {loading ? (
        <div className="portal-empty"><Loader2 size={28} className="spin" /><p>Loading opportunities…</p></div>
      ) : filtered.length === 0 ? (
        <div className="portal-empty"><p>No opportunities found.</p></div>
      ) : (
        <section className="platform-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5ede9' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Title</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Organization</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Category</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Deadline</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isBusy = busy === row.id;
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f0f5f2' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                      {row.isFeatured && <Star size={12} style={{ marginRight: 4 }} />}
                      {row.title}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{row.organization}</td>
                    <td style={{ padding: '8px 12px' }}>{opportunityCategoryLabel(row.category)}</td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatDate(row.deadline)}</td>
                    <td style={{ padding: '8px 12px' }}><span className={`status-badge status-${row.status}`}>{row.status}</span></td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {row.status !== 'published' && (
                          <button type="button" className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#2e7d52' }} disabled={isBusy} onClick={() => void approve(row)}>
                            {isBusy ? <Loader2 size={12} className="spin" /> : <CheckCircle2 size={13} />} Publish
                          </button>
                        )}
                        {row.status === 'pending' && (
                          <button type="button" className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#c0392b' }} disabled={isBusy} onClick={() => reject(row)}>
                            <XCircle size={13} /> Reject
                          </button>
                        )}
                        {row.status === 'published' && (
                          <button type="button" className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.78rem' }} disabled={isBusy} onClick={() => void toggleFeatured(row)}>
                            <Star size={13} /> {row.isFeatured ? 'Unfeature' : 'Feature'}
                          </button>
                        )}
                        <button type="button" className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#d94f4f' }} disabled={isBusy} onClick={() => remove(row)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        tone="danger"
        confirmLabel="Confirm"
        onConfirm={() => confirmState.action()}
        onClose={() => setConfirmState((s) => ({ ...s, open: false }))}
      />

      <PromptDialog
        open={rejectTarget !== null}
        title="Reject this opportunity?"
        message="The submitter will see this moderation note. Re-publishing can reverse it."
        placeholder="Reason for rejection (shown to the submitter)"
        confirmLabel="Reject"
        onSubmit={submitRejection}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}
