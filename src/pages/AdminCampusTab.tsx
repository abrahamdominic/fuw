import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  X,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';

export type AdminCampusModule =
  | 'events'
  | 'organizations'
  | 'jobs'
  | 'lost-found'
  | 'study-groups'
  | 'services'
  | 'reports';

interface AdminCampusTabProps {
  module: AdminCampusModule;
}

interface ListingRow {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  created_at?: string;
  organizer_id?: string;
  owner_id?: string;
  profiles?: { full_name?: string; username?: string } | null;
}

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type?: string;
  category?: string;
  description?: string;
  status?: string;
  created_at?: string;
  reporter?: { full_name?: string; username?: string } | null;
}

const MODULE_TABLE: Record<AdminCampusModule, string> = {
  events: 'events',
  organizations: 'organizations',
  jobs: 'job_listings',
  'lost-found': 'lost_found_items',
  'study-groups': 'study_groups',
  services: 'service_listings',
  reports: 'platform_reports'
};

const MODULE_LABELS: Record<AdminCampusModule, string> = {
  events: 'Events',
  organizations: 'Organizations',
  jobs: 'Jobs & Gigs',
  'lost-found': 'Lost & Found',
  'study-groups': 'Study Groups',
  services: 'Services',
  reports: 'Platform Reports'
};

// Owner FK column per module
const OWNER_COLUMN: Partial<Record<AdminCampusModule, string>> = {
  events: 'organizer_id',
  organizations: 'owner_id',
  jobs: 'owner_id',
  'lost-found': 'owner_id',
  'study-groups': 'owner_id',
  services: 'owner_id'
};

// Approve/reject status values per module — must match DB CHECK constraints exactly.
// events:        draft → published | cancelled
// organizations: pending → published | suspended
// jobs:          pending → published | rejected | closed
// lost-found:    open by default; admin resolves by marking resolved | closed
// study-groups:  pending → published | suspended
// services:      pending → published | rejected | closed
const APPROVE_STATUS: Partial<Record<AdminCampusModule, string>> = {
  events: 'published',
  organizations: 'published',
  jobs: 'published',
  'lost-found': 'resolved',
  'study-groups': 'published',
  services: 'published'
};

const REJECT_STATUS: Partial<Record<AdminCampusModule, string>> = {
  events: 'cancelled',
  organizations: 'suspended',
  jobs: 'rejected',
  'lost-found': 'closed',
  'study-groups': 'suspended',
  services: 'rejected'
};

function formatDate(iso?: string) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function ownerName(row: ListingRow): string {
  if (row.profiles) {
    return row.profiles.full_name || row.profiles.username || 'Unknown';
  }
  return 'Unknown';
}

export function AdminCampusTab({ module }: AdminCampusTabProps) {
  const { toast } = useToast();
  const isReports = module === 'reports';

  const [listings, setListings] = useState<ListingRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);

  // Confirm dialog state
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    tone?: 'danger' | 'default';
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const closeConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = requireSupabase();
      if (isReports) {
        const { data, error: err } = await client
          .from('platform_reports')
          .select('id,reporter_id,target_type,category,description,status,created_at,reporter:profiles!reporter_id(full_name,username)')
          .order('created_at', { ascending: false });
        if (err) throw new Error(err.message);
        setReports((data ?? []) as unknown as ReportRow[]);
      } else {
        const table = MODULE_TABLE[module];
        const ownerCol = OWNER_COLUMN[module] ?? 'owner_id';
        // Fetch row data + join profiles via foreign key alias
        // Using a separate profiles join keyed to the owner column
        let selectFields = `id,status,created_at,${ownerCol}`;
        if (table === 'organizations' || table === 'study_groups') {
          selectFields += ',name';
        } else if (table === 'events' || table === 'job_listings' || table === 'lost_found_items' || table === 'service_listings') {
          selectFields += ',title';
        }
        const { data, error: err } = await client
          .from(table)
          .select(`${selectFields},profiles:profiles!${ownerCol}(full_name,username)`)
          .order('created_at', { ascending: false });
        if (err) throw new Error(err.message);
        setListings((data ?? []) as unknown as ListingRow[]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, [module, isReports]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Listing actions ────────────────────────────────────────────
  const handleSetStatus = async (id: string, status: string) => {
    setBusy(id);
    try {
      const { error: err } = await requireSupabase()
        .from(MODULE_TABLE[module])
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (err) throw new Error(err.message);
      setListings((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      toast(`Status updated to "${status}".`, 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Update failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = (id: string, label: string) => {
    setConfirm({
      open: true,
      title: `Delete "${label}"?`,
      message: 'This will permanently remove the item. This action cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete permanently',
      onConfirm: async () => {
        setBusy(id);
        try {
          const { error: err } = await requireSupabase()
            .from(MODULE_TABLE[module])
            .delete()
            .eq('id', id);
          if (err) throw new Error(err.message);
          setListings((prev) => prev.filter((r) => r.id !== id));
          setReports((prev) => prev.filter((r) => r.id !== id));
          toast('Item deleted.', 'info');
        } catch (err: unknown) {
          toast(err instanceof Error ? err.message : 'Delete failed.', 'error');
        } finally {
          setBusy(null);
        }
      }
    });
  };

  // ── Report actions ─────────────────────────────────────────────
  const handleReportStatus = async (id: string, status: string) => {
    setBusy(id);
    try {
      const { error: err } = await requireSupabase()
        .from('platform_reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (err) throw new Error(err.message);
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      toast(`Report marked as "${status}".`, 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Update failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // ── Filter helpers ─────────────────────────────────────────────
  const filteredListings = listings.filter((row) => {
    const label = (row.title ?? row.name ?? '').toLowerCase();
    if (search.trim() && !label.includes(search.trim().toLowerCase())) return false;
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    return true;
  });

  const filteredReports = reports.filter((row) => {
    const text = `${row.category ?? ''} ${row.description ?? ''} ${row.target_type ?? ''}`.toLowerCase();
    if (search.trim() && !text.includes(search.trim().toLowerCase())) return false;
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    return true;
  });

  const title = MODULE_LABELS[module];
  const approveStatus = APPROVE_STATUS[module];
  const rejectStatus = REJECT_STATUS[module];

  // Unique statuses for filter buttons
  const uniqueStatuses = isReports
    ? Array.from(new Set(reports.map((r) => r.status ?? 'unknown')))
    : Array.from(new Set(listings.map((r) => r.status ?? 'unknown')));

  return (
    <div className="platform-shell">
      <div className="platform-header">
        <div>
          <p className="kicker">ADMIN MODERATION</p>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void loadData()}
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Toolbar */}
      <div className="platform-card-head" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="campus-search">
            <Search size={14} />
            <input
              type="search"
              placeholder={isReports ? 'Search reports…' : `Search ${title.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${title}`}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={statusFilter === 'all' ? 'primary' : 'secondary-btn'}
            onClick={() => setStatusFilter('all')}
          >
            All
          </button>
          {uniqueStatuses.map((s) => (
            <button
              key={s}
              type="button"
              className={statusFilter === s ? 'primary' : 'secondary-btn'}
              onClick={() => setStatusFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="inline-notice is-error" role="alert">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="portal-empty">
          <Loader2 size={28} className="spin" />
          <p>Loading {title.toLowerCase()}…</p>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <>
          {isReports ? (
            filteredReports.length === 0 ? (
              <div className="portal-empty">
                <AlertTriangle size={28} className="empty-icon" />
                <p>No reports found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.</p>
              </div>
            ) : (
              <section className="platform-card" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5ede9' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Reporter</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Target type</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Category</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Description</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Date</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReports.map((row) => {
                      const isBusy = busy === row.id;
                      const reporterName = row.reporter
                        ? (row.reporter.full_name || row.reporter.username || 'Unknown')
                        : 'Unknown';
                      return (
                        <tr key={row.id} style={{ borderBottom: '1px solid #f0f5f2' }}>
                          <td style={{ padding: '8px 12px' }}>{reporterName}</td>
                          <td style={{ padding: '8px 12px' }}>{row.target_type ?? '-'}</td>
                          <td style={{ padding: '8px 12px' }}>{row.category ?? '-'}</td>
                          <td style={{ padding: '8px 12px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.description}>
                            {row.description ?? '-'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span className={`status-badge status-${row.status ?? 'pending'}`}>
                              {row.status ?? 'pending'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatDate(row.created_at)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {row.status !== 'reviewing' && (
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                                  disabled={isBusy}
                                  onClick={() => void handleReportStatus(row.id, 'reviewing')}
                                >
                                  {isBusy ? <Loader2 size={12} className="spin" /> : null}
                                  Reviewing
                                </button>
                              )}
                              {row.status !== 'resolved' && (
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                                  disabled={isBusy}
                                  onClick={() => void handleReportStatus(row.id, 'resolved')}
                                >
                                  Resolved
                                </button>
                              )}
                              {row.status !== 'dismissed' && (
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                                  disabled={isBusy}
                                  onClick={() => void handleReportStatus(row.id, 'dismissed')}
                                >
                                  Dismiss
                                </button>
                              )}
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#d94f4f' }}
                                disabled={isBusy}
                                onClick={() => handleDelete(row.id, `Report #${row.id.slice(0, 8)}`)}
                                aria-label="Delete report"
                              >
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
            )
          ) : (
            filteredListings.length === 0 ? (
              <div className="portal-empty">
                <AlertTriangle size={28} className="empty-icon" />
                <p>No {title.toLowerCase()} found{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.</p>
              </div>
            ) : (
              <section className="platform-card" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5ede9' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Title / Name</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Owner / Organizer</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Created</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredListings.map((row) => {
                      const isBusy = busy === row.id;
                      const label = row.title ?? row.name ?? 'Untitled';
                      const currentStatus = row.status ?? 'pending';
                      return (
                        <tr key={row.id} style={{ borderBottom: '1px solid #f0f5f2' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 500 }}>{label}</td>
                          <td style={{ padding: '8px 12px' }}>{ownerName(row)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span className={`status-badge status-${currentStatus}`}>
                              {currentStatus}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatDate(row.created_at)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {approveStatus && currentStatus !== approveStatus && (
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#2e7d52' }}
                                  disabled={isBusy}
                                  onClick={() => void handleSetStatus(row.id, approveStatus)}
                                  aria-label={`Approve ${label}`}
                                >
                                  {isBusy ? <Loader2 size={12} className="spin" /> : <CheckCircle2 size={13} />}
                                  Approve
                                </button>
                              )}
                              {rejectStatus && currentStatus !== rejectStatus && (
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#c0392b' }}
                                  disabled={isBusy}
                                  onClick={() => void handleSetStatus(row.id, rejectStatus)}
                                  aria-label={`Reject ${label}`}
                                >
                                  <XCircle size={13} />
                                  Reject
                                </button>
                              )}
                              <button
                                type="button"
                                className="secondary-btn"
                                style={{ padding: '4px 8px', fontSize: '0.78rem', color: '#d94f4f' }}
                                disabled={isBusy}
                                onClick={() => handleDelete(row.id, label)}
                                aria-label={`Delete ${label}`}
                              >
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
            )
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        tone={confirm.tone}
        confirmLabel={confirm.confirmLabel}
        onConfirm={confirm.onConfirm}
        onClose={closeConfirm}
      />
    </div>
  );
}
