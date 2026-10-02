// AdminVerificationTab — the library's academic identity review queue.
//
// Every decision goes through the `admin_review_verification` RPC, which is
// itself admin-guarded, so nothing here can approve a student on its own.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Crown,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldX
} from 'lucide-react';
import {
  fetchVerificationQueue,
  getEvidenceUrl,
  reviewVerification,
  type RequestStatus,
  type VerificationQueueRow
} from '../lib/verification';
import { useToast } from '../components/Toast';

const FILTERS: Array<{ key: RequestStatus | 'all'; label: string }> = [
  { key: 'pending', label: 'Awaiting review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' }
];

export function AdminVerificationTab() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<RequestStatus | 'all'>('pending');
  const [rows, setRows] = useState<VerificationQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (which: RequestStatus | 'all') => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchVerificationQueue(which));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the verification queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.full_name, r.email, r.username, r.matric_number, r.department, r.faculty]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, query]);

  const decide = async (row: VerificationQueueRow, approve: boolean) => {
    const note = (notes[row.id] ?? '').trim();
    if (!approve && !note) {
      setError('Add a reason so the student knows what to correct.');
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await reviewVerification(row.id, approve, note);
      toast(
        approve
          ? `${row.full_name ?? 'Student'} is now verified.`
          : `${row.full_name ?? 'Student'} was asked to correct their details.`,
        approve ? 'success' : 'info'
      );
      setNotes((n) => {
        const next = { ...n };
        delete next[row.id];
        return next;
      });
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  };

  const openEvidence = async (row: VerificationQueueRow) => {
    if (!row.evidence_path) return;
    const url = await getEvidenceUrl(row);
    if (!url) {
      setError('That evidence file could not be opened.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>Academic verification</h1>
          <p>Confirm each student's identity against the register. Approving unlocks premium access.</p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void load(filter)}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="verify-admin-toolbar">
        <div className="segmented" role="tablist" aria-label="Verification queue filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={filter === f.key ? 'is-active' : ''}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="search search-inline">
          <Search size={16} className="search-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, matric number, department…"
            aria-label="Search verification requests"
          />
        </div>
      </div>

      {error && (
        <p className="inline-notice is-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="card" role="status">
          <p className="muted-row">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading requests…
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card verify-admin-empty">
          <BadgeCheck size={24} aria-hidden="true" />
          <b>Nothing here</b>
          <span>
            {filter === 'pending'
              ? 'No student is waiting for review.'
              : 'No requests match this filter.'}
          </span>
        </div>
      ) : (
        <ul className="verify-admin-list">
          {visible.map((row) => (
            <li key={row.id} className="verify-admin-row">
              <div className="verify-admin-main">
                <div className="verify-admin-title">
                  <b>{row.full_name || row.username || row.email || 'Student'}</b>
                  <span className={`verify-pill is-${row.status}`}>{row.status}</span>
                  {!row.is_active && (
                    <span className="verify-pill is-rejected">
                      <AlertTriangle size={11} aria-hidden="true" /> suspended
                    </span>
                  )}
                </div>
                <dl className="verify-admin-facts">
                  <div>
                    <dt>Matric number</dt>
                    <dd>{row.matric_number}</dd>
                  </div>
                  <div>
                    <dt>Faculty</dt>
                    <dd>{row.faculty}</dd>
                  </div>
                  <div>
                    <dt>Department</dt>
                    <dd>{row.department}</dd>
                  </div>
                  <div>
                    <dt>Level</dt>
                    <dd>{row.level || '—'}</dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd>{new Date(row.created_at).toLocaleDateString('en-NG')}</dd>
                  </div>
                </dl>
                {row.student_note && <p className="verify-admin-note">Student said: {row.student_note}</p>}
                {row.reviewer_note && (
                  <p className="verify-admin-note">
                    <Crown size={12} aria-hidden="true" /> Reviewer: {row.reviewer_note}
                  </p>
                )}
              </div>

              {row.status === 'pending' && (
                <div className="verify-admin-actions">
                  {row.evidence_path && (
                    <button type="button" className="secondary-btn" onClick={() => void openEvidence(row)}>
                      <FileText size={14} aria-hidden="true" /> View evidence
                    </button>
                  )}
                  <label className="sr-only" htmlFor={`verify-note-${row.id}`}>
                    Note for {row.full_name ?? 'student'}
                  </label>
                  <textarea
                    id={`verify-note-${row.id}`}
                    className="form-textarea"
                    rows={2}
                    maxLength={1000}
                    placeholder="Reason (required to reject)"
                    value={notes[row.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                  />
                  <div className="verify-admin-buttons">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void decide(row, true)}
                      disabled={busyId === row.id}
                      aria-busy={busyId === row.id}
                    >
                      {busyId === row.id ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Check size={14} aria-hidden="true" />
                      )}
                      Approve
                    </button>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() => void decide(row, false)}
                      disabled={busyId === row.id}
                    >
                      {busyId === row.id ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <ShieldX size={14} aria-hidden="true" />
                      )}
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default AdminVerificationTab;