// AdminPlansTab — grant, extend and revoke premium entitlements.
//
// Entitlement writes go through the `admin_grant_plan` / `admin_revoke_plan`
// RPCs. Those are admin-guarded on the server and, crucially, the premium gate
// itself requires a verified academic identity, so granting a plan to an
// unverified student unlocks nothing.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Crown,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserRound
} from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import {
  fetchCatalogPlans,
  fetchUserEntitlement,
  grantPlan,
  naira,
  revokePlan,
  type CatalogPlan,
  type ManagedSubscription
} from '../lib/verification';
import { useToast } from '../components/Toast';

interface StudentRow {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  matric_number: string | null;
  faculty: string | null;
  department: string | null;
  verification_status: string;
}

export function AdminPlansTab() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [subs, setSubs] = useState<ManagedSubscription[]>([]);
  const [busy, setBusy] = useState(false);
  const [grantSlug, setGrantSlug] = useState('premium');
  const [grantDays, setGrantDays] = useState('');
  const [grantNote, setGrantNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = requireSupabase();
      const [catalog, rows] = await Promise.all([
        fetchCatalogPlans(),
        client
          .from('profiles')
          .select('id, full_name, username, email, matric_number, faculty, department, verification_status')
          .eq('role', 'student')
          .order('full_name')
          .limit(500),
      ]);
      if (rows.error) throw new Error(rows.error.message);
      setPlans(catalog);
      setStudents((rows.data ?? []) as StudentRow[]);
      if (!catalog.some((p) => p.slug === 'premium')) setGrantSlug(catalog[0]?.slug ?? 'premium');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load plans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openStudent = async (s: StudentRow) => {
    setSelected(s);
    setSubs([]);
    try {
      setSubs(await fetchUserEntitlement(s.id));
    } catch {
      setSubs([]);
    }
  };

  const doGrant = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const days = grantDays.trim() ? Number(grantDays) : undefined;
      await grantPlan(selected.id, grantSlug, Number.isFinite(days) ? days : undefined, grantNote);
      toast(`Plan granted to ${selected.full_name ?? selected.email ?? 'student'}.`, 'success');
      setGrantDays('');
      setGrantNote('');
      setSubs(await fetchUserEntitlement(selected.id));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not grant that plan.');
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await revokePlan(selected.id, grantNote);
      toast('Premium access ended.', 'info');
      setGrantNote('');
      setSubs(await fetchUserEntitlement(selected.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke that plan.');
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students.slice(0, 60);
    return students
      .filter((s) =>
        [s.full_name, s.username, s.email, s.matric_number, s.department]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      )
      .slice(0, 60);
  }, [students, query]);

  const activeSub = subs.find((s) => s.status === 'active' && new Date(s.expires_at) > new Date());

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <h1>Premium plans</h1>
          <p>
            Grant entitlements manually. A plan only unlocks downloads once the student&rsquo;s
            academic identity has been verified.
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && (
        <p className="inline-notice is-error" role="alert">
          {error}
        </p>
      )}

      <div className="plan-grid">
        {plans.map((p) => (
          <section key={p.id} className={`plan-card ${p.is_premium ? 'is-premium' : ''}`}>
            {p.is_premium && <span className="plan-ribbon">Premium</span>}
            <h3>{p.name}</h3>
            <p className="plan-price">
              {p.price_kobo === 0 ? 'Free' : naira(p.price_kobo)}
              {p.price_kobo > 0 && <span className="muted"> / {p.duration_days} days</span>}
            </p>
            {p.description && <p className="plan-desc">{p.description}</p>}
            <ul className="plan-features">
              {p.features.slice(0, 4).map((f) => (
                <li key={f}>
                  <BadgeCheck size={13} aria-hidden="true" /> {f}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="verify-admin-row" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div>
          <div className="search search-inline" style={{ marginBottom: 14 }}>
            <Search size={16} className="search-icon" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a student by name, username, matric number…"
              aria-label="Search students"
            />
          </div>

          {loading ? (
            <p className="muted-row" role="status">
              <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading students…
            </p>
          ) : visible.length === 0 ? (
            <p className="muted-row">No students match that search.</p>
          ) : (
            <ul className="verify-admin-list">
              {visible.map((s) => (
                <li key={s.id} className="verify-admin-row" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
                  <div className="verify-admin-main">
                    <div className="verify-admin-title">
                      <UserRound size={15} aria-hidden="true" />
                      <b>{s.full_name || s.username || s.email || 'Student'}</b>
                      <span className={`verify-pill is-${s.verification_status}`}>
                        {s.verification_status}
                      </span>
                    </div>
                    <dl className="verify-admin-facts">
                      <div>
                        <dt>Matric</dt>
                        <dd>{s.matric_number || '—'}</dd>
                      </div>
                      <div>
                        <dt>Department</dt>
                        <dd>{s.department || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="verify-admin-actions">
                    <button type="button" className="secondary-btn" onClick={() => void openStudent(s)}>
                      <Crown size={14} aria-hidden="true" /> Manage plan
                    </button>
                    {s.verification_status !== 'verified' && (
                      <p className="verify-hint">
                        <ShieldAlert size={12} aria-hidden="true" /> Verify this student before the
                        plan can unlock anything.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" role="presentation" onClick={() => setSelected(null)}>
          <div className="protected-modal premium-gate-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="premium-gate-body" style={{ textAlign: 'left' }}>
              <h3 style={{ textAlign: 'center' }}>Manage premium</h3>
              <p style={{ textAlign: 'center' }}>
                {selected.full_name || selected.email}
                <br />
                <span className="muted">
                  Verification: {selected.verification_status}
                  {selected.verification_status !== 'verified' &&
                    ' — downloads stay locked until this is verified.'}
                </span>
              </p>

              <div className="verify-admin-actions">
                <label className="field-label" htmlFor="grant-plan">Plan</label>
                <select
                  id="grant-plan"
                  className="form-input"
                  value={grantSlug}
                  onChange={(e) => setGrantSlug(e.target.value)}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <label className="field-label" htmlFor="grant-days">
                  Days <span className="muted">(blank uses the plan default)</span>
                </label>
                <input
                  id="grant-days"
                  type="number"
                  min={1}
                  max={3650}
                  className="form-input"
                  value={grantDays}
                  onChange={(e) => setGrantDays(e.target.value)}
                  placeholder="30"
                />

                <label className="field-label" htmlFor="grant-note">Note <span className="muted">(optional)</span></label>
                <textarea
                  id="grant-note"
                  className="form-textarea"
                  rows={2}
                  maxLength={500}
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                />

                <div className="verify-admin-buttons">
                  <button type="button" className="primary" onClick={() => void doGrant()} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <BadgeCheck size={14} aria-hidden="true" />}
                    Grant / extend
                  </button>
                  {activeSub && (
                    <button type="button" className="danger-btn" onClick={() => void doRevoke()} disabled={busy}>
                      <Trash2 size={14} aria-hidden="true" /> Revoke
                    </button>
                  )}
                </div>
              </div>

              {subs.length > 0 && (
                <ul className="verify-history" style={{ marginTop: 16, textAlign: 'left' }}>
                  {subs.map((s) => (
                    <li key={s.id}>
                      <span className={`verify-pill is-${s.is_premium ? 'approved' : 'pending'}`}>{s.plan_name}</span>
                      <span className="verify-history-when">{s.status}</span>
                      <span className="verify-history-id">
                        until {new Date(s.expires_at).toLocaleDateString('en-NG')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="premium-gate-actions">
                <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AdminPlansTab;