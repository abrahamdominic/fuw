import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldCheck,
  MailPlus,
  LogOut,
  Menu,
  X,
  Power,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  UserCog,
  AlertCircle,
  KeyRound,
  RefreshCw,
  Save,
  Users,
  FileText,
  Settings2,
  Ban,
  Wrench,
  Loader2
} from 'lucide-react';
import { requireSupabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog';
import { DashboardSearch } from '../components/DashboardSearch';
import { Logo } from '../components/Logo';
import { ALL_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS, roleLabel } from '../lib/rbac';
import { fetchMaterialCounts } from '../lib/materials';
import {
  fetchMaintenanceStatus,
  setMaintenanceMode,
  MaintenanceStatus
} from '../lib/maintenance';

interface AdminRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: 'admin' | 'super_admin';
  permissions: string[] | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  full_name: string | null;
  accepted: boolean;
  created_at: string;
}

const superNavItems = [
  { label: 'Overview', path: '/super', icon: LayoutDashboard, exact: true },
  { label: 'Administrators', path: '/super/admins', icon: ShieldCheck },
  { label: 'Admin invites', path: '/super/invites', icon: MailPlus },
  { label: 'System & maintenance', path: '/super/system', icon: Wrench }
];

export function SuperAdminPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut, profile, refreshProfile } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [materialCounts, setMaterialCounts] = useState({ approved: 0, pending: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);

  // Destructive-action confirmation + rename prompt state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    tone?: 'danger' | 'default';
    action: () => void | Promise<void>;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<AdminRow | null>(null);
  // Permission editor modal state
  const [permEditor, setPermEditor] = useState<{ admin: AdminRow; selected: string[] } | null>(null);

  const currentPath = location.pathname;

  const loadAdmins = async () => {
    try {
      const client = requireSupabase();
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, email, role, permissions, is_active, last_login_at, created_at')
        .in('role', ['admin', 'super_admin'])
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      setAdmins((data ?? []) as AdminRow[]);
    } catch (err: any) {
      toast(err?.message || 'Could not load administrators.', 'error');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const client = requireSupabase();
        await loadAdmins();
        if (cancelled) return;
        const { count } = await client
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'student');
        if (!cancelled) setStudentCount(count ?? 0);
        const counts = await fetchMaterialCounts();
        if (!cancelled) {
          setMaterialCounts({ approved: counts.approved, pending: counts.pending, rejected: counts.rejected });
        }
      } catch {
        // Stats are non-critical.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Run an RPC and surface failures through toasts. */
  const runRpc = async (fn: string, args: Record<string, unknown>, successMsg: string) => {
    try {
      const { error } = await requireSupabase().rpc(fn, args);
      if (error) throw new Error(error.message);
      toast(successMsg, 'success');
      await loadAdmins();
      await refreshProfile();
    } catch (err: any) {
      toast(err?.message || 'Action failed.', 'error');
      throw err;
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="portal">
      {/* Sidebar Navigation */}
      <aside className={`side admin-side ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="side-header">
          <Link className="brand" to="/" onClick={() => setMobileMenuOpen(false)}>
            <Logo size={32} />
            <b>FUW</b> Super Admin
          </Link>
          <button className="side-close-btn" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <div className="side-user-card admin-user-card">
          <div className="user-avatar-circle admin-avatar">
            <KeyRound size={18} />
          </div>
          <div className="user-info-text">
            <b>{profile?.fullName || 'Super Admin'}</b>
            <span>{roleLabel(profile?.role)} · Full control</span>
          </div>
        </div>

        <p className="side-nav-heading">PLATFORM GOVERNANCE</p>

        <nav className="side-nav-list">
          {superNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? currentPath === item.path || currentPath === item.path + '/'
              : currentPath.startsWith(item.path);
            return (
              <NavLink
                key={item.label}
                to={item.path}
                className={`side-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.label === 'Administrators' && admins.length > 0 && (
                  <span className="side-badge">{admins.length}</span>
                )}
              </NavLink>
            );
          })}
          <NavLink to="/admin" className="side-link" onClick={() => setMobileMenuOpen(false)}>
            <Settings2 size={17} />
            <span>Open admin dashboard</span>
          </NavLink>
        </nav>

        <div className="side-footer-actions">
          <button
            type="button"
            onClick={handleLogout}
            className="side-link logout-link"
            style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', textAlign: 'left' }}
          >
            <LogOut size={17} />
            <span>Sign out / Exit</span>
          </button>
        </div>
      </aside>

      {/* Tap-away backdrop for the mobile drawer */}
      {mobileMenuOpen && (
        <button
          type="button"
          className="portal-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Viewport */}
      <main className="portal-main">
        <div className="portal-mobile-bar">
          <button
            className="portal-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={22} />
            <span>Menu</span>
          </button>
          <span className="portal-mobile-title">Platform Governance</span>
          <div className="portal-mobile-actions">
            <button
              type="button"
              className="portal-mobile-logout"
              onClick={handleLogout}
              aria-label="Sign out / Exit"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Global dashboard search (desktop bar / mobile expanding icon) */}
        <DashboardSearch scope="super" />

        {currentPath.startsWith('/super/system') ? (
          <MaintenanceControlTab />
        ) : currentPath.startsWith('/super/admins') ? (
          <AdminManagementTab
            admins={admins}
            loading={loading}
            onPromote={(id) =>
              runRpc(
                'promote_to_admin',
                { target_user_id: id, admin_permissions: DEFAULT_ADMIN_PERMISSIONS },
                'Student promoted to Administrator.'
              )
            }
            onDemote={(a) =>
              setConfirmState({
                open: true,
                title: `Demote ${a.full_name || a.email}?`,
                tone: 'danger',
                message: `${a.full_name || a.email} will lose all administrator rights and become a regular student account.`,
                confirmLabel: 'Demote to student',
                action: () =>
                  runRpc('demote_admin', { target_user_id: a.id }, 'Administrator demoted to student.')
              })
            }
            onToggleActive={(a) =>
              runRpc(
                'set_admin_active',
                { target_user_id: a.id, active: !a.is_active },
                !a.is_active ? 'Administrator reactivated.' : 'Administrator deactivated.'
              )
            }
            onRename={(a) => setRenameTarget(a)}
            onEditPermissions={(a) =>
              setPermEditor({ admin: a, selected: a.role === 'super_admin' ? [] : a.permissions ?? [] })
            }
          />
        ) : currentPath.startsWith('/super/invites') ? (
          <InviteManagementTab />
        ) : (
          <SuperOverviewTab
            admins={admins}
            studentCount={studentCount}
            materialCounts={materialCounts}
            loading={loading}
          />
        )}

        {/* Rename dialog */}
        <PromptDialog
          open={!!renameTarget}
          title="Rename administrator"
          message={renameTarget ? `Update the display name for ${renameTarget.email}.` : ''}
          placeholder="Full name"
          defaultValue={renameTarget?.full_name ?? ''}
          confirmLabel="Save name"
          onSubmit={async (value) => {
            if (renameTarget && value) {
              await runRpc(
                'update_admin_details',
                { target_user_id: renameTarget.id, new_full_name: value },
                'Administrator name updated.'
              );
            }
          }}
          onClose={() => setRenameTarget(null)}
        />

        {/* Permission editor dialog */}
        {permEditor && (
          <PermissionEditorModal
            admin={permEditor.admin}
            initialSelected={permEditor.selected}
            onClose={() => setPermEditor(null)}
            onSave={async (perms) => {
              await runRpc(
                'update_admin_permissions',
                { target_user_id: permEditor.admin.id, admin_permissions: perms },
                'Permissions updated.'
              );
              setPermEditor(null);
            }}
          />
        )}

        {/* Destructive confirmation */}
        <ConfirmDialog
          open={confirmState?.open ?? false}
          title={confirmState?.title ?? ''}
          message={confirmState?.message ?? ''}
          tone={confirmState ? 'danger' : 'default'}
          confirmLabel={confirmState?.confirmLabel}
          onConfirm={confirmState?.action ?? (() => {})}
          onClose={() => setConfirmState(null)}
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------
function SuperOverviewTab({
  admins,
  studentCount,
  materialCounts,
  loading
}: {
  admins: AdminRow[];
  studentCount: number;
  materialCounts: { approved: number; pending: number; rejected: number };
  loading: boolean;
}) {
  const activeAdmins = admins.filter((a) => a.is_active).length;
  const superAdmins = admins.filter((a) => a.role === 'super_admin').length;

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">OWNER CONTROL CENTRE</p>
          <h1>Platform governance overview</h1>
          <p className="subtitle">
            Highest level control of FUW E-Library staff accounts. Only one Super Admin (you) exists by design.
          </p>
        </div>
        <Link className="secondary-btn" to="/super/admins">
          <ShieldCheck size={16} />
          <span>Manage administrators</span>
        </Link>
      </div>

      <div className="portal-stats admin-stats-grid">
        <section>
          <ShieldCheck />
          <b>{loading ? '…' : admins.length}</b>
          <span>Total staff accounts</span>
        </section>
        <section>
          <UserCog />
          <b>{loading ? '…' : activeAdmins}</b>
          <span>Active administrators</span>
        </section>
        <section>
          <KeyRound />
          <b>{loading ? '…' : superAdmins}</b>
          <span>Super admins</span>
        </section>
        <section>
          <Users />
          <b>{studentCount.toLocaleString()}</b>
          <span>Registered students</span>
        </section>
        <section>
          <FileText />
          <b>{materialCounts.approved}</b>
          <span>Approved materials</span>
        </section>
        <section>
          <Clock />
          <b>{materialCounts.pending}</b>
          <span>Pending review</span>
        </section>
      </div>

      <div className="admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">QUICK REFERENCE</p>
            <h2>How administrator management works</h2>
          </div>
        </div>
        <ul className="super-help-list">
          <li><b>Promote:</b> search any registered student in the Administrators tab and grant them an admin account.</li>
          <li><b>Permissions:</b> fine tune what each admin can approve, reject, delete or manage.</li>
          <li><b>Invites:</b> invite a brand new staff member by email their admin role activates automatically when they first sign up.</li>
          <li><b>Safety:</b> you cannot demote or deactivate yourself; every sensitive action is confirmed twice.</li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Administrators tab
// ---------------------------------------------------------------------------
function AdminManagementTab({
  admins,
  loading,
  onPromote,
  onDemote,
  onToggleActive,
  onRename,
  onEditPermissions
}: {
  admins: AdminRow[];
  loading: boolean;
  onPromote: (id: string) => void;
  onDemote: (a: AdminRow) => void;
  onToggleActive: (a: AdminRow) => void;
  onRename: (a: AdminRow) => void;
  onEditPermissions: (a: AdminRow) => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Array<{ id: string; full_name: string | null; email: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Debounced live student lookup — results update as the super admin types.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const escaped = q.replace(/[%_,()\\]/g, (ch) => `\\${ch}`);
        const { data, error } = await requireSupabase()
          .from('profiles')
          .select('id, full_name, email')
          .eq('role', 'student')
          .or(`email.ilike.%${escaped}%,full_name.ilike.%${escaped}%`)
          .limit(10);
        if (cancelled) return;
        if (error) throw new Error(error.message);
        setResults((data ?? []) as any);
        setSearchError(null);
        setSearched(true);
      } catch (err: any) {
        if (!cancelled) {
          setResults([]);
          setSearchError(err?.message || 'Search failed.');
          setSearched(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const [adminFilter, setAdminFilter] = useState('');
  const filteredAdmins = admins.filter((a) => {
    if (!adminFilter.trim()) return true;
    const q = adminFilter.trim().toLowerCase();
    return (
      (a.full_name || '').toLowerCase().includes(q) ||
      (a.email || '').toLowerCase().includes(q) ||
      roleLabel(a.role).toLowerCase().includes(q)
    );
  });

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STAFF ACCOUNT MANAGEMENT</p>
          <h1>Administrators</h1>
          <p className="subtitle">Promote trusted students or staff, assign precise permissions, and deactivate accounts instantly.</p>
        </div>
      </div>

      {/* Promote section */}
      <div className="admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">GRANT ACCESS</p>
            <h2>Promote an existing student</h2>
          </div>
        </div>
        <div className="manage-tools">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && search && setSearch('')}
            placeholder="Search students by name or email..."
            aria-label="Search students by name or email"
          />
          {searching && <Loader2 size={15} className="spin-icon" aria-hidden="true" />}
          {search && (
            <button
              className="clear-search-btn"
              onClick={() => setSearch('')}
              aria-label="Clear student search"
            >
              Clear
            </button>
          )}
        </div>

        {searchError && (
          <div className="form-feedback-box error">
            <AlertCircle size={18} />
            <p>{searchError}</p>
          </div>
        )}

        {!searchError && searched && !searching && results.length === 0 && (
          <div className="empty-state card-empty">
            <Users size={30} />
            <b>No student accounts matched “{search.trim()}”.</b>
            <span>Try a different name, matric-style email, or check the spelling.</span>
          </div>
        )}

        {results.length > 0 && (
          <div className="table">
            <div className="tr head super-search-grid">
              <span>Name</span>
              <span>Email</span>
              <span>Action</span>
            </div>
            {results.map((r) => (
              <div className="tr super-search-grid" key={r.id}>
                <span><b>{r.full_name || 'Unnamed'}</b></span>
                <span>{r.email}</span>
                <span>
                  <button className="approval-btn approve small" onClick={() => onPromote(r.id)}>
                    <ShieldCheck size={13} /> Promote to admin
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Administrators table */}
      <div className="admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">CURRENT STAFF</p>
            <h2>All administrator accounts</h2>
          </div>
          <button className="secondary-btn" onClick={() => window.location.reload()}>
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
        </div>

        {!loading && (
          <div className="manage-tools compact">
            <Search size={17} />
            <input
              value={adminFilter}
              onChange={(e) => setAdminFilter(e.target.value)}
              placeholder="Filter staff by name, email, or role..."
              aria-label="Filter administrator accounts"
            />
            {adminFilter && (
              <button
                className="clear-search-btn"
                onClick={() => setAdminFilter('')}
                aria-label="Clear staff filter"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {loading ? (
          <p className="muted">Loading administrator accounts…</p>
        ) : (
          <div className="table">
            <div className="tr head super-admin-table-grid">
              <span>Administrator</span>
              <span>Role</span>
              <span>Status</span>
              <span>Last sign-in</span>
              <span>Actions</span>
            </div>

            {filteredAdmins.map((a) => (
              <div className="tr super-admin-table-grid" key={a.id}>
                <span>
                  <b>{a.full_name || 'Unnamed admin'}</b>
                  <small>{a.email}</small>
                </span>
                <span>
                  <span className={`status-badge ${a.role === 'super_admin' ? 'info' : 'approved'}`}>
                    <ShieldCheck size={12} /> {roleLabel(a.role)}
                  </span>
                  {a.role === 'admin' && (
                    <small>{(a.permissions ?? []).length} permission{(a.permissions ?? []).length === 1 ? '' : 's'}</small>
                  )}
                </span>
                <span>
                  {a.is_active ? (
                    <span className="status-badge approved"><CheckCircle2 size={12} /> Active</span>
                  ) : (
                    <span className="status-badge rejected"><Ban size={12} /> Deactivated</span>
                  )}
                </span>
                <span>{a.last_login_at ? new Date(a.last_login_at).toLocaleDateString() : 'Never'}</span>
                <span className="admin-row-actions">
                  {a.role === 'admin' && (
                    <button className="action-icon-btn" title="Edit permissions" onClick={() => onEditPermissions(a)}>
                      <KeyRound size={15} />
                    </button>
                  )}
                  <button className="action-icon-btn" title="Rename" onClick={() => onRename(a)}>
                    <UserCog size={15} />
                  </button>
                  <button
                    className="action-icon-btn delete"
                    title={a.is_active ? 'Deactivate account' : 'Reactivate account'}
                    onClick={() => onToggleActive(a)}
                  >
                    {a.is_active ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
                  </button>
                  {a.role === 'admin' && (
                    <button className="action-icon-btn delete" title="Demote to student" onClick={() => onDemote(a)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </div>
            ))}

            {filteredAdmins.length === 0 && admins.length > 0 && (
              <div className="empty-state">
                <Search size={30} />
                <b>No staff accounts match “{adminFilter.trim()}”.</b>
                <span>Adjust the filter above to see all administrator accounts.</span>
              </div>
            )}

            {admins.length === 0 && (
              <div className="empty-state">
                <AlertCircle size={32} />
                <b>No administrator accounts found.</b>
                <span>Promote a student above or create an invite so staff can join.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permission editor modal
// ---------------------------------------------------------------------------
function PermissionEditorModal({
  admin,
  initialSelected,
  onSave,
  onClose
}: {
  admin: AdminRow;
  initialSelected: string[];
  onSave: (permissions: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="confirm-dialog permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-icon">
          <KeyRound size={26} />
        </div>
        <h3 id="perm-dialog-title">Edit permissions — {admin.full_name || admin.email}</h3>
        <p className="confirm-dialog-message">
          Tick exactly what this administrator may do. They can never manage other administrators.
        </p>
        <div className="permission-list">
          {ALL_PERMISSIONS.map((p) => (
            <label key={p.key} className="permission-row">
              <input
                type="checkbox"
                checked={selected.includes(p.key)}
                onChange={() => toggle(p.key)}
                disabled={busy}
              />
              <span className="permission-text">
                <b>{p.label}</b>
                <small>{p.description}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={async () => {
            setBusy(true);
            await onSave(selected);
            setBusy(false);
          }}>
            <Save size={15} /> {busy ? 'Saving…' : 'Save permissions'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invites tab
// ---------------------------------------------------------------------------
function InviteManagementTab() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteFilter, setInviteFilter] = useState('');

  const filteredInvites = invites.filter((i) => {
    if (!inviteFilter.trim()) return true;
    const q = inviteFilter.trim().toLowerCase();
    return (
      i.email.toLowerCase().includes(q) ||
      (i.full_name || '').toLowerCase().includes(q) ||
      (i.accepted ? 'accepted' : 'waiting').includes(q)
    );
  });

  const loadInvites = async () => {
    try {
      const { data, error } = await requireSupabase()
        .from('admin_invites')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      setInvites((data ?? []) as InviteRow[]);
    } catch (err: any) {
      // Non-critical listing.
    }
  };

  useEffect(() => {
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!clean.includes('@')) {
      toast('Enter a valid email address.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc('create_admin_invite', {
        invite_email: clean,
        invite_full_name: fullName.trim()
      });
      if (error) throw new Error(error.message);
      toast(`Invite saved. ${clean} just needs to sign up with this email.`, 'success');
      setEmail('');
      setFullName('');
      loadInvites();
    } catch (err: any) {
      toast(err?.message || 'Could not create invite.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STAFF ONBOARDING</p>
          <h1>Admin invites</h1>
          <p className="subtitle">
            Invite future librarians by email. Their administrator role is applied automatically the moment they
            sign up at <b>/login</b> with the invited address.
          </p>
        </div>
      </div>

      <form className="upload-form" onSubmit={handleInvite}>
        <div className="form-section">
          <div className="form-grid-2">
            <label>
              Staff email address *
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="librarian@fuw.edu.ng"
                disabled={busy}
              />
            </label>
            <label>
              Full name (optional)
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Mrs. Grace Adah"
                disabled={busy}
              />
            </label>
          </div>
          <button className="primary submit-btn" disabled={busy}>
            <MailPlus size={16} />
            {busy ? 'Saving invite…' : 'Create admin invite'}
          </button>
        </div>
      </form>

      <div className="admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">INVITE LOG</p>
            <h2>Recent invitations</h2>
          </div>
        </div>

        {invites.length > 0 && (
          <div className="manage-tools compact">
            <Search size={17} />
            <input
              value={inviteFilter}
              onChange={(e) => setInviteFilter(e.target.value)}
              placeholder="Filter invites by email, name, or status..."
              aria-label="Filter admin invites"
            />
            {inviteFilter && (
              <button
                className="clear-search-btn"
                onClick={() => setInviteFilter('')}
                aria-label="Clear invite filter"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {invites.length === 0 ? (
          <div className="empty-state card-empty">
            <MailPlus size={36} />
            <b>No invites yet.</b>
            <span>Create your first invite above — it activates when the person signs up.</span>
          </div>
        ) : filteredInvites.length === 0 ? (
          <div className="empty-state card-empty">
            <Search size={30} />
            <b>No invites match “{inviteFilter.trim()}”.</b>
            <span>Adjust or clear the filter to see all {invites.length} invitation{invites.length !== 1 ? 's' : ''}.</span>
          </div>
        ) : (
          <div className="table">
            <div className="tr head super-invite-grid">
              <span>Email</span>
              <span>Name</span>
              <span>Status</span>
              <span>Created</span>
            </div>
            {filteredInvites.map((i) => (
              <div className="tr super-invite-grid" key={i.id}>
                <span><b>{i.email}</b></span>
                <span>{i.full_name || '—'}</span>
                <span>
                  {i.accepted ? (
                    <span className="status-badge approved"><CheckCircle2 size={12} /> Accepted</span>
                  ) : (
                    <span className="status-badge pending"><Clock size={12} /> Waiting for signup</span>
                  )}
                </span>
                <span>{new Date(i.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System & maintenance tab (persistent Supabase-backed maintenance mode)
// ---------------------------------------------------------------------------
function MaintenanceControlTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<'enable' | 'disable' | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const next = await fetchMaintenanceStatus();
      setStatus(next);
      setMessageDraft(next.message || '');
    } catch {
      toast('Could not load the current maintenance status.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveMessage = async () => {
    setSavingMessage(true);
    try {
      await setMaintenanceMode(status?.enabled ?? false, messageDraft);
      toast('Maintenance page message updated.', 'success');
      await loadStatus();
    } catch (err: any) {
      toast(err?.message || 'Could not update the maintenance message.', 'error');
    } finally {
      setSavingMessage(false);
    }
  };

  const handleToggle = async () => {
    if (!confirmToggle) return;
    const enabling = confirmToggle === 'enable';
    setBusy(true);
    try {
      await setMaintenanceMode(enabling, messageDraft.trim() || undefined);
      toast(
        enabling
          ? 'Maintenance mode enabled — students and visitors now see the maintenance page.'
          : 'Maintenance mode disabled — everyone has full access again.',
        'success'
      );
      setConfirmToggle(null);
      await loadStatus();
    } catch (err: any) {
      toast(err?.message || 'Could not update maintenance mode.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const active = status?.enabled ?? false;

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">PLATFORM AVAILABILITY</p>
          <h1>System &amp; maintenance</h1>
          <p className="subtitle">
            Temporarily close FUW E-Library for upgrades. Students and visitors are redirected to a
            branded maintenance page while you keep full access. The state is stored in Supabase, so it
            persists across refreshes, devices and deployments.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state card-empty">
          <Loader2 size={28} className="spin-icon" />
          <b>Loading maintenance status…</b>
        </div>
      ) : (
        <>
          <div className="admin-section-block">
            <div className="section-head">
              <div>
                <p className="kicker">GLOBAL ACCESS CONTROL</p>
                <h2>Maintenance mode</h2>
              </div>
            </div>

            <div className={`maintenance-control-card ${active ? 'is-active' : ''}`}>
              <div className="maintenance-status-row">
                <span className={`maintenance-status-dot ${active ? 'on' : ''}`} aria-hidden="true" />
                <div className="maintenance-status-text">
                  <b>Maintenance Mode</b>
                  <span className={`maintenance-status-value ${active ? 'active' : ''}`}>
                    {active ? '● Active' : '○ Inactive'}
                  </span>
                  <small>
                    {active
                      ? 'Students and visitors are redirected to /maintenance.'
                      : 'The full library is online and reachable.'}
                  </small>
                </div>
                <button
                  type="button"
                  className={active ? 'danger-btn-outline' : 'primary'}
                  onClick={() => setConfirmToggle(active ? 'disable' : 'enable')}
                  disabled={busy}
                >
                  {busy && confirmToggle ? (
                    <Loader2 size={15} className="spin-icon" />
                  ) : active ? (
                    <CheckCircle2 size={15} />
                  ) : (
                    <Wrench size={15} />
                  )}
                  <span>{active ? 'Disable Maintenance Mode' : 'Enable Maintenance Mode'}</span>
                </button>
              </div>

              <label className="maintenance-message-label">
                Custom message shown on the maintenance page (optional)
                <textarea
                  rows={3}
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  placeholder="e.g. We are upgrading the repository servers. Back online by 4:00 PM."
                  disabled={busy || savingMessage}
                />
              </label>
              {messageDraft !== (status?.message ?? '') && (
                <button
                  type="button"
                  className="secondary-btn maintenance-save-message-btn"
                  onClick={handleSaveMessage}
                  disabled={savingMessage || busy}
                >
                  {savingMessage ? <Loader2 size={15} className="spin-icon" /> : <Save size={15} />}
                  <span>{savingMessage ? 'Saving…' : 'Save message'}</span>
                </button>
              )}

              {status?.updatedAt && (
                <small className="maintenance-updated">
                  Last updated {new Date(status.updatedAt).toLocaleString()}
                </small>
              )}
            </div>
          </div>

          <div className="super-help-list-block admin-section-block">
            <div className="section-head">
              <div>
                <p className="kicker">GOOD TO KNOW</p>
                <h2>How maintenance mode behaves</h2>
              </div>
            </div>
            <ul className="super-help-list">
              <li><b>Persisted:</b> stored in the <code>system_settings</code> table — survives refreshes, browsers, devices and deployments.</li>
              <li><b>Global redirect:</b> every route except <code>/maintenance</code> sends normal users there automatically.</li>
              <li><b>Super Admin bypass:</b> you always keep full access to this dashboard and can disable the mode instantly.</li>
              <li><b>Instant recovery:</b> disabling restores access immediately; clients re-check within seconds.</li>
            </ul>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmToggle !== null}
        title={confirmToggle === 'enable' ? 'Enable maintenance mode?' : 'Disable maintenance mode?'}
        tone={confirmToggle === 'enable' ? 'danger' : 'default'}
        confirmLabel={confirmToggle === 'enable' ? 'Yes, enable maintenance' : 'Yes, disable maintenance'}
        icon={confirmToggle === 'disable' ? Power : undefined}
        confirmIcon={confirmToggle === 'disable' ? CheckCircle2 : undefined}
        message={
          confirmToggle === 'enable'
            ? 'All students and public visitors will immediately be redirected to the maintenance page until you disable it. You will retain full Super Admin access.'
            : 'Normal users will immediately regain access to the library and their dashboards.'
        }
        onConfirm={handleToggle}
        onClose={() => setConfirmToggle(null)}
      />
    </div>
  );
}
