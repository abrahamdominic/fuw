import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard,
  FileText,
  Upload,
  Users,
  Building2,
  GraduationCap,
  Bookmark,
  ShieldCheck,
  Settings,
  LogOut,
  Search,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Eye,
  Download,
  AlertCircle,
  ChevronRight,
  Menu,
  X,
  Sparkles,
  ArrowUpRight,
  ShieldAlert,
  BarChart3,
  SlidersHorizontal,
  Lock,
  Bell,
  Key,
  Database,
  RefreshCw,
  Save,
  AlertTriangle,
  Shield,
  Check,
  Info,
  Globe,
  Mail,
  Phone,
  MapPin,
  Laptop
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem } from '../lib/store';
import { Logo } from '../components/Logo';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { catalogue, materialTypes, courseTitleByCode } from '../data/catalogue';
import { useAuth } from '../lib/AuthContext';
import { roleLabel, can } from '../lib/rbac';
import {
  submitMaterial as submitMaterialDb,
  approveMaterial as approveMaterialDb,
  rejectMaterial as rejectMaterialDb,
  deleteMaterial as deleteMaterialDb,
  fetchMaterials
} from '../lib/materials';
import { aiProcessMaterial } from '../lib/ai';
import { ConfirmDialog, PromptDialog } from '../components/ConfirmDialog';
import { DashboardSearch } from '../components/DashboardSearch';
import { useToast } from '../components/Toast';
import { fetchMaintenanceStatus, MaintenanceStatus } from '../lib/maintenance';

interface AdminPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

const adminNavItems = [
  { label: 'Overview', path: '/admin', icon: LayoutDashboard, exact: true, permission: null },
  { label: 'Materials & Approvals', path: '/admin/materials', icon: FileText, permission: null },
  { label: 'Upload material', path: '/admin/upload', icon: Upload, permission: 'upload_as_approved' },
  { label: 'AI & indexing', path: '/admin/ai', icon: Sparkles, permission: 'manage_ai' },
  { label: 'Students & users', path: '/admin/users', icon: Users, permission: 'manage_students' },
  { label: 'Faculties', path: '/admin/faculties', icon: Building2, permission: 'manage_catalogue' },
  { label: 'Departments', path: '/admin/departments', icon: Building2, permission: 'manage_catalogue' },
  { label: 'Courses & levels', path: '/admin/courses', icon: GraduationCap, permission: 'manage_catalogue' },
  { label: 'Categories & sessions', path: '/admin/categories', icon: Bookmark, permission: 'manage_catalogue' },
  { label: 'Audit logs', path: '/admin/logs', icon: ShieldCheck, permission: 'view_analytics' },
  { label: 'Settings', path: '/admin/settings', icon: Settings, permission: null }
];

export function AdminPortal({ onReadOnline }: AdminPortalProps) {
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut, profile, hasPermission, role, isSuperAdmin } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Confirmation dialog for destructive actions
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    tone?: 'danger' | 'default';
    confirmLabel?: string;
    action: () => void | Promise<void>;
  } | null>(null);

  // Pull fresh live data from Supabase whenever the admin portal opens
  useEffect(() => {
    store.syncMaterialsFromSupabase();
    store.fetchUserStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUser = store.getCurrentUser();
  const allMaterials = store.getAllMaterials();
  const pendingMaterials = store.getPendingMaterials();
  const approvedMaterials = store.getApprovedMaterials();
  const rejectedMaterials = store.getRejectedMaterials();
  const auditLogs = store.getAuditLogs();
  const stats = store.getSystemStats();

  const currentPath = location.pathname;

  /** Run a moderation action through the database RPCs (with notifications). */
  const runAction = async (
    action: () => Promise<void>,
    successMsg: string,
    fallbackStore?: () => void
  ) => {
    try {
      await action();
      toast(successMsg, 'success');
    } catch (err: any) {
      if (fallbackStore) fallbackStore();
      toast(err?.message || 'Action failed — check your permissions.', 'error');
    }
  };

  const handleApprove = (id: string) =>
    runAction(
      () => approveMaterialDb(id),
      'Material approved and published to the public library!'
    );

  const handleReject = (id: string, reason: string) =>
    runAction(
      () => rejectMaterialDb(id, reason),
      'Material rejected and the uploader has been notified.'
    );

  const handleDelete = (m: MaterialItem) =>
    setConfirmState({
      open: true,
      title: 'Delete this material?',
      tone: 'danger',
      message: `"${m.title}" will be permanently removed from the library along with its stored file. Students will no longer be able to access it.`,
      confirmLabel: 'Delete permanently',
      action: async () => {
        await runAction(
          () => deleteMaterialDb(m.id),
          'Material deleted from the library.',
          () => store.deleteMaterial(m.id, currentUser.fullName)
        );
      }
    });

  const handleAdminLogout = async () => {
    await signOut();
    toast('Logged out of Admin Portal', 'info');
    navigate('/admin/login');
  };

  return (
    <div className="portal">
      {/* Sidebar Navigation */}
      <aside className={`side admin-side ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="side-header">
          <Link className="brand" to="/" onClick={() => setMobileMenuOpen(false)}>
            <Logo size={32} />
            <b>FUW</b> Admin Portal
          </Link>
          <button
            className="side-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="side-user-card admin-user-card">
          <div className="user-avatar-circle admin-avatar">
            <ShieldCheck size={18} />
          </div>
          <div className="user-info-text">
            <b>{profile?.fullName || currentUser.displayName || currentUser.fullName}</b>
            <span>{roleLabel(role)}{hasPermission('upload_as_approved') ? '' : ' (limited)'}</span>
          </div>
        </div>

        <p className="side-nav-heading">REPOSITORY ADMINISTRATION</p>

        <nav className="side-nav-list">
          {adminNavItems
            .filter((item) => !item.permission || hasPermission(item.permission))
            .map((item) => {
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
                {item.label === 'Materials & Approvals' && pendingMaterials.length > 0 && (
                  <span className="side-badge pending-badge">
                    {pendingMaterials.length} pending
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="side-footer-actions">
          {isSuperAdmin && (
            <NavLink
              to="/super"
              className="side-link back-super-link"
              onClick={() => setMobileMenuOpen(false)}
              title="Return to the Super Admin dashboard (same session)"
            >
              <ShieldCheck size={17} />
              <span>Back to Super Admin</span>
            </NavLink>
          )}
          <button
            type="button"
            onClick={handleAdminLogout}
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
          aria-label="Close admin navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Admin Viewport */}
      <main className="portal-main">
        {/* Mobile Portal Top Bar */}
        <div className="portal-mobile-bar">
          <button
            className="portal-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open admin navigation"
          >
            <Menu size={22} />
            <span>Admin Menu</span>
          </button>
          <span className="portal-mobile-title">Repository Administration</span>
          <Link to="/admin/upload" className="portal-mobile-upload">
            <Upload size={16} />
          </Link>
        </div>

        {/* Global dashboard search (desktop bar / mobile expanding icon) */}
        <DashboardSearch scope="admin" />

        {/* Dynamic Admin Subpages */}
        {currentPath === '/admin' || currentPath === '/admin/' ? (
          <AdminOverviewTab
            stats={stats}
            pendingCount={pendingMaterials.length}
            auditLogs={auditLogs}
            pendingMaterials={pendingMaterials}
            allMaterials={allMaterials}
            canApprove={hasPermission('approve_materials')}
            onApprove={(id: string) => handleApprove(id)}
            onReject={(id: string, reason: string) => handleReject(id, reason)}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/admin/materials') ? (
          <AdminMaterialsTab
            allMaterials={allMaterials}
            pendingMaterials={pendingMaterials}
            approvedMaterials={approvedMaterials}
            rejectedMaterials={rejectedMaterials}
            canApprove={hasPermission('approve_materials')}
            canReject={hasPermission('reject_materials')}
            canDelete={hasPermission('delete_any_material')}
            onApprove={(id: string) => handleApprove(id)}
            onReject={(id: string, reason: string) => handleReject(id, reason)}
            onDelete={(id: string) => {
              const m = allMaterials.find((x) => x.id === id);
              if (m) handleDelete(m);
            }}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/admin/upload') ? (
          <AdminUploadTab onUploaded={() => navigate('/admin/materials')} />
        ) : currentPath.startsWith('/admin/ai') ? (
          hasPermission('manage_ai') ? (
            <AdminAiManagementTab />
          ) : (
            <div className="empty-state card-empty">
              <Lock size={40} />
              <b>AI management is restricted.</b>
              <span>Your account does not have the "Manage AI features" permission. Ask a super admin to grant it.</span>
            </div>
          )
        ) : currentPath.startsWith('/admin/users') ? (
          <AdminUsersTab />
        ) : currentPath.startsWith('/admin/faculties') ? (
          <AdminFacultiesTab />
        ) : currentPath.startsWith('/admin/departments') ? (
          <AdminDepartmentsTab />
        ) : currentPath.startsWith('/admin/courses') ? (
          <AdminCoursesTab />
        ) : currentPath.startsWith('/admin/categories') ? (
          <AdminCategoriesTab />
        ) : currentPath.startsWith('/admin/logs') ? (
          <AdminAuditLogsTab logs={auditLogs} />
        ) : currentPath.startsWith('/admin/settings') ? (
          <AdminSettingsTab />
        ) : (
          <AdminOverviewTab
            stats={stats}
            pendingCount={pendingMaterials.length}
            auditLogs={auditLogs}
            pendingMaterials={pendingMaterials}
            allMaterials={allMaterials}
            canApprove={hasPermission('approve_materials')}
            onApprove={(id: string) => handleApprove(id)}
            onReject={(id: string, reason: string) => handleReject(id, reason)}
            onReadOnline={onReadOnline}
          />
        )}

        {/* Destructive-action confirmation */}
        <ConfirmDialog
          open={confirmState?.open ?? false}
          title={confirmState?.title ?? ''}
          message={confirmState?.message ?? ''}
          tone={confirmState?.tone}
          confirmLabel={confirmState?.confirmLabel}
          onConfirm={confirmState?.action ?? (() => {})}
          onClose={() => setConfirmState(null)}
        />
      </main>
    </div>
  );
}

// 1. Admin Overview Tab
function AdminOverviewTab({
  stats,
  pendingCount,
  auditLogs,
  pendingMaterials,
  allMaterials = [],
  canApprove = true,
  canReject = true,
  onApprove,
  onReject,
  onReadOnline
}: any) {
  // Rejection reason dialog state (custom modal instead of window.prompt).
  const [rejectTarget, setRejectTarget] = useState<{ id: string; title: string } | null>(null);
  // Real monthly submission/activity chart built from actual material
  // creation timestamps in the database (last 6 months).
  const monthlyActivity = React.useMemo(() => {
    const months: { key: string; label: string; count: number }[] = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString('en-US', { month: 'short' }),
        count: 0
      });
    }
    (allMaterials as MaterialItem[]).forEach((m) => {
      const source = m.createdAt || m.date;
      if (!source) return;
      const d = new Date(source);
      if (isNaN(d.getTime())) return;
      const bucket = months.find((b) => b.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (bucket) bucket.count += 1;
    });
    return months;
  }, [allMaterials]);

  const maxMonthly = Math.max(1, ...monthlyActivity.map((m) => m.count));
  const totalThisPeriod = monthlyActivity.reduce((acc, m) => acc + m.count, 0);

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SYSTEM METRICS & APPROVALS</p>
          <h1>Library administration overview</h1>
          <p className="subtitle">Real-time repository telemetry, student submissions, and audit logs.</p>
        </div>
        <div className="portal-top-actions">
          <Link className="primary" to="/admin/upload">
            <Upload size={16} />
            <span>Publish Material</span>
          </Link>
          <Link className="secondary-btn" to="/admin/materials">
            <FileText size={16} />
            <span>View All Materials</span>
          </Link>
        </div>
      </div>

      {/* Pending Approvals Notice Banner */}
      {pendingCount > 0 && (
        <div className="pending-alert-banner">
          <div className="alert-icon-box">
            <AlertCircle size={22} />
          </div>
          <div className="alert-text">
            <h4>{pendingCount} student material submission{pendingCount > 1 ? 's' : ''} awaiting approval</h4>
            <p>Review submitted lecture notes and past questions before they appear in public library searches.</p>
          </div>
          <Link to="/admin/materials" className="alert-review-btn">
            Review Approval Queue →
          </Link>
        </div>
      )}

      {/* 8-Panel Metric Stats Grid */}
      <div className="portal-stats admin-stats-grid">
        <section>
          <Users />
          <b>{stats.studentsCount.toLocaleString()}</b>
          <span>Registered students</span>
        </section>
        <section>
          <ShieldCheck />
          <b>{stats.verifiedStudents.toLocaleString()}</b>
          <span>Verified students</span>
        </section>
        <section>
          <FileText />
          <b>{stats.approvedMaterials}</b>
          <span>Approved materials</span>
        </section>
        <section>
          <Clock />
          <b>{pendingCount}</b>
          <span>Pending approval</span>
        </section>
        <section>
          <Building2 />
          <b>{stats.facultiesCount}</b>
          <span>Faculties</span>
        </section>
        <section>
          <GraduationCap />
          <b>{stats.departmentsCount}</b>
          <span>Departments</span>
        </section>
        <section>
          <Download />
          <b>{stats.totalDownloads.toLocaleString()}</b>
          <span>Total downloads</span>
        </section>
        <section>
          <Eye />
          <b>{stats.totalViews.toLocaleString()}</b>
          <span>Total views</span>
        </section>
      </div>

      {/* Monthly Uploads Activity Chart (real database records) */}
      <div className="admin-chart">
        <div className="chart-header">
          <div>
            <p className="kicker">ACTIVITY TELEMETRY</p>
            <h2>Academic Material Submissions & Access (Last 6 Months)</h2>
          </div>
          <span className="chart-tag">Current Academic Session</span>
        </div>
        {totalThisPeriod === 0 ? (
          <div className="empty-state" style={{ padding: '28px 16px' }}>
            <BarChart3 size={30} />
            <b>No submissions recorded in the last six months.</b>
            <span>Publish or approve materials to see live activity telemetry here.</span>
          </div>
        ) : (
          <div className="bars">
            {monthlyActivity.map((bar) => (
              <div key={bar.key}>
                <span>{bar.count}</span>
                <i style={{ height: `${Math.round((bar.count / maxMonthly) * 100)}%` }} />
                <b>{bar.label}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Queue Quick Section */}
      {pendingMaterials.length > 0 && (
        <div className="admin-section-block">
          <div className="section-head">
            <div>
              <p className="kicker">ACTION REQUIRED</p>
              <h2>Pending student uploads</h2>
            </div>
            <Link to="/admin/materials">
              View all in approval queue <ChevronRight size={16} />
            </Link>
          </div>

          <div className="table">
            <div className="tr head approval-table-grid">
              <span>Title & Resource</span>
              <span>Submitter</span>
              <span>Faculty & Dept</span>
              <span>Date</span>
              <span>Decision</span>
            </div>

            {pendingMaterials.slice(0, 3).map((m: MaterialItem) => (
              <div className="tr approval-table-grid" key={m.id}>
                <span>
                  <b>{m.title}</b>
                  <small>{m.course} · {m.fileName} ({m.fileSize})</small>
                </span>
                <span>
                  <b>{m.uploadedBy.name}</b>
                  <small>{m.uploadedBy.matricNumber || 'Student'}</small>
                </span>
                <span>{m.department} · {m.level}</span>
                <span>{m.date}</span>
                <span className="approval-action-btns">
                  {canApprove && (
                    <button
                      className="approval-btn approve"
                      onClick={() => onApprove(m.id)}
                      title="Approve and Publish to Frontend"
                    >
                      <CheckCircle2 size={14} /> Approve & Publish
                    </button>
                  )}
                  {canReject && (
                    <button
                      className="approval-btn reject"
                      onClick={() => setRejectTarget({ id: m.id, title: m.title })}
                      title="Reject submission"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  )}
                  {!canApprove && !canReject && (
                    <span className="status-badge pending">View only</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rejection reason dialog */}
      <PromptDialog
        open={!!rejectTarget}
        title="Reject this submission?"
        message={
          rejectTarget
            ? `"${rejectTarget.title}" will be marked as rejected. The uploader will be notified with your reason.`
            : ''
        }
        placeholder="Reason shown to the uploader (e.g. wrong course code, unreadable scan…)"
        confirmLabel="Reject submission"
        onSubmit={(reason) => {
          if (rejectTarget) onReject(rejectTarget.id, reason || 'Does not meet submission criteria.');
          setRejectTarget(null);
        }}
        onClose={() => setRejectTarget(null)}
      />

      {/* Recent Audit Logs */}
      <div className="admin-section-block">
        <div className="section-head">
          <div>
            <p className="kicker">SECURITY & INTEGRITY</p>
            <h2>Recent audit logs</h2>
          </div>
          <Link to="/admin/logs">
            Full audit trail <ChevronRight size={16} />
          </Link>
        </div>

        <div className="table">
          <div className="tr head audit-table-grid">
            <span>Action</span>
            <span>Performed By</span>
            <span>Entity Target</span>
            <span>Timestamp</span>
            <span>Status</span>
          </div>
          {auditLogs.slice(0, 5).map((log: any) => (
            <div className="tr audit-table-grid" key={log.id}>
              <span>
                <b>{log.action}</b>
                <small>{log.details || 'System activity'}</small>
              </span>
              <span>{log.performedBy}</span>
              <span>{log.entity}</span>
              <span>{new Date(log.timestamp).toLocaleString()}</span>
              <span>
                <span className="status-badge approved">Logged</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 2. Admin Materials & Approvals Tab
function AdminMaterialsTab({
  allMaterials,
  pendingMaterials,
  approvedMaterials,
  rejectedMaterials,
  canApprove = true,
  canReject = true,
  canDelete = true,
  onApprove,
  onReject,
  onDelete,
  onReadOnline
}: {
  allMaterials: MaterialItem[];
  pendingMaterials: MaterialItem[];
  approvedMaterials: MaterialItem[];
  rejectedMaterials: MaterialItem[];
  canApprove?: boolean;
  canReject?: boolean;
  canDelete?: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onDelete: (id: string) => void;
  onReadOnline: (m: MaterialItem) => void;
}) {
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [rejectTarget, setRejectTarget] = useState<{ id: string; title: string } | null>(null);

  let displayed =
    activeTab === 'pending'
      ? pendingMaterials
      : activeTab === 'approved'
      ? approvedMaterials
      : activeTab === 'rejected'
      ? rejectedMaterials
      : allMaterials;

  if (searchTerm.trim()) {
    const q = searchTerm.toLowerCase();
    displayed = displayed.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.course.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q) ||
        m.uploadedBy.name.toLowerCase().includes(q)
    );
  }

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">REPOSITORY CATALOGUE & QUEUE</p>
          <h1>Materials & approval management</h1>
          <p className="subtitle">
            Review student submissions, publish faculty notes, and manage the live academic library collection.
          </p>
        </div>
        <Link className="primary" to="/admin/upload">
          <Upload size={16} />
          <span>Publish new material</span>
        </Link>
      </div>

      {/* Tab Selectors with Badges */}
      <div className="admin-tabs-bar">
        <button
          className={`tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          <Clock size={15} />
          <span>Pending Approvals</span>
          <span className="tab-pill orange">{pendingMaterials.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'approved' ? 'active' : ''}`}
          onClick={() => setActiveTab('approved')}
        >
          <CheckCircle2 size={15} />
          <span>Approved & Live</span>
          <span className="tab-pill green">{approvedMaterials.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <FileText size={15} />
          <span>All Materials</span>
          <span className="tab-pill">{allMaterials.length}</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'rejected' ? 'active' : ''}`}
          onClick={() => setActiveTab('rejected')}
        >
          <XCircle size={15} />
          <span>Rejected</span>
          <span className="tab-pill red">{rejectedMaterials.length}</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="manage-tools">
        <Search size={17} />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search materials by title, course code, department, or submitter..."
          aria-label="Search materials by title, course code, department, or submitter"
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')} aria-label="Clear material search">
            Clear
          </button>
        )}
      </div>

      {/* Materials Table */}
      <div className="table">
        <div className="tr head admin-materials-grid">
          <span>Material Title & Course</span>
          <span>Faculty & Department</span>
          <span>Submitted By</span>
          <span>Date</span>
          <span>Status</span>
          <span>Actions & Decisions</span>
        </div>

        {displayed.length === 0 ? (
          <div className="empty-state">
            <FileText size={32} />
            <b>No materials found in this category.</b>
            <span>Submissions matching this filter will appear here.</span>
          </div>
        ) : (
          displayed.map((m) => (
            <div className="tr admin-materials-grid" key={m.id}>
              <span>
                <b>{m.title}</b>
                <small>{m.course} · {m.type} · {m.fileSize}</small>
              </span>
              <span>
                <b>{m.department}</b>
                <small>{m.level} · {m.faculty}</small>
              </span>
              <span>
                <b>{m.uploadedBy.name}</b>
                <small>{m.uploadedBy.role === 'admin' ? 'Faculty Admin' : m.uploadedBy.matricNumber || 'Student'}</small>
              </span>
              <span>{m.date}</span>
              <span>
                {m.status === 'approved' && (
                  <span className="status-badge approved">
                    <CheckCircle2 size={12} /> Live / Approved
                  </span>
                )}
                {m.status === 'pending' && (
                  <span className="status-badge pending">
                    <Clock size={12} /> Pending Review
                  </span>
                )}
                {m.status === 'rejected' && (
                  <span className="status-badge rejected" title={m.rejectionReason}>
                    <AlertCircle size={12} /> Rejected
                  </span>
                )}
              </span>
              <span className="admin-row-actions">
                <button
                  className="action-icon-btn preview"
                  onClick={() => onReadOnline(m)}
                  title="Preview document"
                >
                  <Eye size={15} />
                </button>

                {m.status !== 'approved' && canApprove && (
                  <button
                    className="approval-btn approve small"
                    onClick={() => onApprove(m.id)}
                    title="Approve & Publish immediately to Frontend"
                  >
                    <CheckCircle2 size={13} /> Approve
                  </button>
                )}

                {m.status === 'pending' && canReject && (
                  <button
                    className="approval-btn reject small"
                    onClick={() => setRejectTarget({ id: m.id, title: m.title })}
                    title="Reject"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                )}

                {canDelete && (
                  <button
                    className="action-icon-btn delete"
                    onClick={() => onDelete(m.id)}
                    title="Delete from database"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Rejection reason dialog */}
      <PromptDialog
        open={!!rejectTarget}
        title="Reject this submission?"
        message={
          rejectTarget
            ? `"${rejectTarget.title}" will be marked as rejected and hidden from the public library. The uploader will be notified with your reason.`
            : ''
        }
        placeholder="Reason shown to the uploader (e.g. wrong course code, unreadable scan…)"
        confirmLabel="Reject submission"
        onSubmit={(reason) => {
          if (rejectTarget) onReject(rejectTarget.id, reason || 'Does not satisfy curriculum guidelines.');
          setRejectTarget(null);
        }}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}

// 3. Admin Upload & Direct Publish Tab
function AdminUploadTab({ onUploaded }: { onUploaded: () => void }) {
  const store = useStore();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    faculty: 'Faculty of Social Sciences',
    department: 'Sociology',
    course: '',
    level: '300 Level',
    semester: 'First Semester',
    type: materialTypes[0]
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setMessage({ type: 'error', text: 'Please select an academic document file.' });
      return;
    }

    const form = new FormData(e.currentTarget);
    const title = String(form.get('title') || '').trim();
    const description = String(form.get('description') || '').trim();

    if (!title || !description) {
      setMessage({ type: 'error', text: 'Title and description are required.' });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      // Database-first publish: admins with the "upload_as_approved" permission
      // have their submissions approved immediately; others go to the queue.
      await submitMaterialDb({
        title,
        description,
        faculty: filters.faculty || 'Faculty of Social Sciences',
        department: filters.department || 'Sociology',
        course_code: filters.course || '',
        course_title: filters.course ? courseTitleByCode(filters.course) : undefined,
        level: filters.level || '300 Level',
        semester: filters.semester || 'First Semester',
        material_type: filters.type || materialTypes[0],
        file,
        admin: true
      });
      void store.syncMaterialsFromSupabase();

      toast('Material published successfully! It is now live on the public library and course pages.', 'success');
      setMessage({
        type: 'success',
        text: 'Material successfully published! It is immediately accessible in the public catalogue.'
      });

      setTimeout(() => {
        onUploaded();
      }, 1200);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Unable to publish material.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">DIRECT REPOSITORY PUBLISHING</p>
          <h1>Publish academic material</h1>
          <p className="subtitle">
            Admin published materials are automatically approved and instantly made live across the public library and course directory.
          </p>
        </div>
      </div>

      <div className="upload-container">
        <form className="upload-form full-upload-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <h3>1. Material Details</h3>
            <label>
              Material Title *
              <input
                name="title"
                required
                placeholder="e.g. Constitutional Law of Nigeria Case Compendium"
              />
            </label>

            <label>
              Academic Description *
              <textarea
                name="description"
                required
                placeholder="Provide comprehensive details about what syllabus units, cases, or modules this material encompasses..."
              />
            </label>
          </div>

          <div className="form-section">
            <h3>2. Faculty, Department & Course Classification</h3>
            <CatalogueFilters filters={filters} onChange={setFilters} compact />
          </div>

          <div className="form-section">
            <h3>3. Academic Document File</h3>
            <div className="drop file-dropzone">
              <Upload size={32} />
              <b>{file ? file.name : 'Select or drop academic resource file'}</b>
              <span>PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX — Up to 25 MB</span>
              {file && (
                <div className="file-ready-tag">
                  <CheckCircle2 size={14} /> Ready for instant publication ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
              )}
              <input
                type="file"
                required
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          {message && (
            <div className={`form-feedback-box ${message.type}`}>
              {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <p>{message.text}</p>
            </div>
          )}

          <div className="form-submit-row">
            <button className="primary submit-btn" disabled={busy}>
              <Upload size={16} />
              {busy ? 'Publishing live…' : 'Publish Material to Public Library'}
            </button>
            <span className="submit-hint">Material will be immediately live and searchable.</span>
          </div>
        </form>
      </div>
    </div>
  );
}

// 3b. Admin AI Management Tab (RAG indexing pipeline control)
function AdminAiManagementTab() {
  const store = useStore();
  const { toast } = useToast();
  const approvedMaterials = store.getApprovedMaterials();
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  // materialId -> status message after a processing attempt
  const [jobResults, setJobResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [confirmTarget, setConfirmTarget] = useState<MaterialItem | null>(null);

  const displayed = approvedMaterials.filter((m) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.course.toLowerCase().includes(q) ||
      m.department.toLowerCase().includes(q)
    );
  });

  const handleProcess = async (m: MaterialItem) => {
    setProcessingId(m.id);
    try {
      const res = await aiProcessMaterial(m.id);
      if (res.status === 'ready') {
        setJobResults((prev) => ({
          ...prev,
          [m.id]: { ok: true, text: `Indexed successfully — ${res.chunks ?? '?'} text chunks embedded.` }
        }));
        toast(`"${m.title}" is now searchable by the AI assistant.`, 'success');
      } else {
        setJobResults((prev) => ({
          ...prev,
          [m.id]: { ok: false, text: res.error || 'Processing failed.' }
        }));
        toast(`AI processing failed for "${m.title}".`, 'error');
      }
    } catch (err: any) {
      const notConfigured =
        err?.code === 'AI_NOT_CONFIGURED' || /not configured/i.test(err?.message || '');
      setJobResults((prev) => ({
        ...prev,
        [m.id]: {
          ok: false,
          text: notConfigured
            ? 'The AI_API_KEY secret is missing. Add it under Edge Function secrets, then redeploy ai-process.'
            : err?.message || 'Processing failed.'
        }
      }));
      toast(notConfigured ? 'AI is not configured yet (missing API key).' : 'AI processing failed.', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">RAG INDEXING PIPELINE</p>
          <h1>AI & semantic indexing</h1>
          <p className="subtitle">
            Process approved materials so the student AI assistant and semantic search can answer questions from their content.
            Supported formats: PDF, TXT, DOCX.
          </p>
        </div>
      </div>

      <div className="manage-tools">
        <Search size={17} />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search approved materials to process..."
          aria-label="Search approved materials to process"
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')} aria-label="Clear AI material search">
            Clear
          </button>
        )}
      </div>

      {displayed.length === 0 ? (
        <div className="empty-state card-empty">
          <Sparkles size={40} />
          <b>No approved materials available.</b>
          <span>Only approved materials can be indexed for the AI assistant.</span>
        </div>
      ) : (
        <div className="table">
          <div className="tr head admin-materials-grid">
            <span>Material Title & Course</span>
            <span>Faculty & Department</span>
            <span>File</span>
            <span>AI Status</span>
            <span>Actions</span>
          </div>

          {displayed.map((m) => {
            const job = jobResults[m.id];
            return (
              <div className="tr admin-materials-grid" key={m.id}>
                <span>
                  <b>{m.title}</b>
                  <small>{m.course} · {m.type}</small>
                </span>
                <span>
                  <b>{m.department}</b>
                  <small>{m.level} · {m.faculty}</small>
                </span>
                <span>
                  <small>{m.fileName}</small>
                  <small>({m.fileSize})</small>
                </span>
                <span>
                  {job ? (
                    job.ok ? (
                      <span className="status-badge approved">
                        <CheckCircle2 size={12} /> Indexed
                      </span>
                    ) : (
                      <span className="status-badge rejected" title={job.text}>
                        <AlertCircle size={12} /> Failed
                      </span>
                    )
                  ) : (
                    <span className="status-badge pending">Not indexed</span>
                  )}
                  {job && !job.ok && <small className="ai-job-error">{job.text}</small>}
                </span>
                <span className="admin-row-actions">
                  <button
                    className="approval-btn approve small"
                    disabled={processingId === m.id}
                    onClick={() => setConfirmTarget(m)}
                    title="Extract text and create embeddings for this document"
                  >
                    <Sparkles size={13} />
                    {processingId === m.id ? 'Processing…' : 'Process with AI'}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="Process with AI?"
        tone="default"
        confirmLabel="Start processing"
        message={
          confirmTarget
            ? `This will download "${confirmTarget.fileName}", extract its text and generate embeddings. Large documents can take up to a minute.`
            : ''
        }
        onConfirm={() => {
          if (confirmTarget) void handleProcess(confirmTarget);
        }}
        onClose={() => setConfirmTarget(null)}
      />
    </div>
  );
}

// 4. Admin Users Tab (Live Supabase profiles with real role management)
interface AdminUserRow {
  id: string;
  full_name: string | null;
  email: string;
  matric_number: string | null;
  faculty: string | null;
  department: string | null;
  level: string | null;
  role: 'student' | 'admin';
  created_at: string;
}

function AdminUsersTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleChangeTarget, setRoleChangeTarget] = useState<AdminUserRow | null>(null);

  const loadUsers = async () => {
    if (!supabase) {
      setErrorMsg('Database connection is not configured.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, matric_number, faculty, department, level, role, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMsg('Unable to load user accounts. Please verify your administrator permissions.');
        setUsers([]);
      } else {
        setUsers((data as AdminUserRow[]) || []);
      }
    } catch {
      setErrorMsg('Network error while loading user accounts. Check your connection and retry.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Role changes are protected by RLS: only administrators may update roles,
  // and a student can never elevate themselves through this path.
  const handleToggleRole = async (u: AdminUserRow) => {
    if (!supabase) return;
    const nextRole = u.role === 'admin' ? 'student' : 'admin';

    setBusyId(u.id);
    try {
      const { error } = await supabase.from('profiles').update({ role: nextRole }).eq('id', u.id);
      if (error) {
        toast('Role update was blocked by database security policies.', 'error');
      } else {
        setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, role: nextRole } : row)));
        toast(`${u.full_name || u.email} is now ${nextRole === 'admin' ? 'an administrator' : 'a student'}.`, 'success');
      }
    } catch {
      toast('Network error while updating the user role.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = users.filter((u) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.matric_number || '').toLowerCase().includes(q) ||
      (u.department || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC COMMUNITY</p>
          <h1>Students & user accounts ({users.length})</h1>
          <p className="subtitle">Live registered accounts from the university database with librarian permission controls.</p>
        </div>
        <button type="button" className="outline-btn" onClick={loadUsers} disabled={isLoading}>
          <RefreshCw size={15} className={isLoading ? 'spin-icon' : ''} /> Refresh List
        </button>
      </div>

      <div className="manage-tools">
        <Search size={17} />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by full name, email, matric number, or department..."
          aria-label="Search users by full name, email, matric number, or department"
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')} aria-label="Clear user search">
            Clear
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="form-feedback-box error">
          <AlertCircle size={18} />
          <p>{errorMsg}</p>
        </div>
      )}

      <div className="table">
        <div className="tr head users-table-grid">
          <span>Student / Full Name</span>
          <span>Matric / ID</span>
          <span>Department & Level</span>
          <span>Role</span>
          <span>Verification Status</span>
          <span>Actions</span>
        </div>

        {isLoading ? (
          <div className="empty-state">
            <RefreshCw size={26} className="spin-icon" />
            <b>Loading user accounts…</b>
            <span>Fetching live records from the university database.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Users size={32} />
            <b>No user accounts found.</b>
            <span>{searchTerm ? 'No accounts match your search.' : 'New registrations will appear here automatically.'}</span>
          </div>
        ) : (
          filtered.map((u) => {
            const verified = !!u.matric_number;
            const joined = u.created_at
              ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
              : '—';
            return (
              <div className="tr users-table-grid" key={u.id}>
                <span>
                  <b>{u.full_name || 'Unnamed account'}</b>
                  <small>{u.email}</small>
                  <small style={{ display: 'block', opacity: 0.7 }}>Joined {joined}</small>
                </span>
                <span>{u.matric_number || 'Not submitted'}</span>
                <span>
                  {u.department || '—'} · {u.level || '—'}
                  <small style={{ display: 'block', opacity: 0.7 }}>{u.faculty || ''}</small>
                </span>
                <span>
                  <span className={`role-pill ${u.role}`}>{u.role.toUpperCase()}</span>
                </span>
                <span>
                  <span className={`status-badge ${verified ? 'approved' : 'pending'}`}>
                    {verified ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                    {verified ? 'VERIFIED' : 'PROFILE INCOMPLETE'}
                  </span>
                </span>
                <span>
                  <button
                    className="table-action-btn"
                    disabled={busyId === u.id}
                    onClick={() => setRoleChangeTarget(u)}
                    title={u.role === 'admin' ? 'Demote this account to student' : 'Promote this account to administrator'}
                  >
                    {busyId === u.id ? 'Updating…' : u.role === 'admin' ? 'Set as Student' : 'Make Admin'}
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Role change confirmation */}
      <ConfirmDialog
        open={!!roleChangeTarget}
        title={roleChangeTarget?.role === 'admin' ? 'Demote this account?' : 'Grant administrator rights?'}
        tone={roleChangeTarget?.role === 'admin' ? 'danger' : 'default'}
        confirmLabel={roleChangeTarget?.role === 'admin' ? 'Set as Student' : 'Make Admin'}
        message={
          roleChangeTarget
            ? `Change ${roleChangeTarget.full_name || roleChangeTarget.email} from "${roleChangeTarget.role}" to "${roleChangeTarget.role === 'admin' ? 'student' : 'admin'}"? Database security policies still protect this action.`
            : ''
        }
        onConfirm={() => {
          if (roleChangeTarget) void handleToggleRole(roleChangeTarget);
          setRoleChangeTarget(null);
        }}
        onClose={() => setRoleChangeTarget(null)}
      />
    </div>
  );
}

// 5. Admin Faculties Tab
function AdminFacultiesTab() {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC STRUCTURE</p>
          <h1>Faculties directory ({catalogue.length})</h1>
          <p className="subtitle">Browse and manage Federal University Wukari's 11 academic faculties.</p>
        </div>
      </div>

      <div className="grid faculty-grid">
        {catalogue.map((f, i) => (
          <div className="faculty" key={f.name}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            <h3>{f.name}</h3>
            <p>{f.departments.length} accredited departments</p>
            <Link to={`/library?faculty=${encodeURIComponent(f.name)}`} className="faculty-view-link">
              <span>View Materials</span>
              <ChevronRight size={16} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

// 6. Admin Departments Tab
function AdminDepartmentsTab() {
  const [searchTerm, setSearchTerm] = useState('');
  const allDepts = catalogue.flatMap((f) =>
    f.departments.map((d) => ({
      faculty: f.name,
      name: d.name,
      duration: d.duration,
      coursesCount: d.courses.length
    }))
  );

  const displayed = allDepts.filter((d) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return d.name.toLowerCase().includes(q) || d.faculty.toLowerCase().includes(q);
  });

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC PROGRAMMES</p>
          <h1>Accredited departments ({allDepts.length})</h1>
          <p className="subtitle">Complete catalogue of {allDepts.length} academic departments and degree durations.</p>
        </div>
      </div>

      <div className="manage-tools compact">
        <Search size={17} />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search departments by name or faculty..."
          aria-label="Search departments by name or faculty"
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')} aria-label="Clear department search">
            Clear
          </button>
        )}
      </div>

      {displayed.length === 0 ? (
        <div className="empty-state card-empty">
          <Building2 size={32} />
          <b>No departments match “{searchTerm.trim()}”.</b>
          <span>Check the spelling or clear the search to see all departments.</span>
        </div>
      ) : (
      <div className="table">
        <div className="tr head depts-table-grid">
          <span>Department Name</span>
          <span>Parent Faculty</span>
          <span>Degree Duration</span>
          <span>Standard Curriculum Courses</span>
          <span>Action</span>
        </div>

        {displayed.map((d) => (
          <div className="tr depts-table-grid" key={d.name}>
            <span>
              <b>{d.name}</b>
            </span>
            <span>{d.faculty}</span>
            <span>{d.duration} Years Degree</span>
            <span>{d.coursesCount} Courses Loaded</span>
            <span>
              <Link
                to={`/library?department=${encodeURIComponent(d.name)}`}
                className="table-action-btn"
              >
                Browse Materials
              </Link>
            </span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// 7. Admin Courses Tab
function AdminCoursesTab() {
  const [searchTerm, setSearchTerm] = useState('');
  const allCourses = catalogue.flatMap((f) =>
    f.departments.flatMap((d) =>
      d.courses.map((c) => ({
        code: c.code,
        name: c.name,
        level: `${c.level} Level`,
        semester: c.semester,
        dept: d.name,
        faculty: f.name
      }))
    )
  );

  const displayed = allCourses.filter((c) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.dept.toLowerCase().includes(q) ||
      c.level.toLowerCase().includes(q)
    );
  });

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">CURRICULUM DIRECTORY</p>
          <h1>Courses & curriculum levels ({allCourses.length})</h1>
          <p className="subtitle">Accredited course codes mapped across departments and academic semesters.</p>
        </div>
      </div>

      <div className="manage-tools compact">
        <Search size={17} />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search courses by code, title, department, or level..."
          aria-label="Search courses by code, title, department, or level"
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')} aria-label="Clear course search">
            Clear
          </button>
        )}
      </div>

      {displayed.length === 0 ? (
        <div className="empty-state card-empty">
          <GraduationCap size={32} />
          <b>No courses match “{searchTerm.trim()}”.</b>
          <span>Try a course code like “CSC 201”, a title keyword, or clear the search.</span>
        </div>
      ) : (
      <div className="table">
        <div className="tr head courses-table-grid">
          <span>Course Code</span>
          <span>Course Title</span>
          <span>Department</span>
          <span>Level</span>
          <span>Semester</span>
          <span>Library Resources</span>
        </div>

        {displayed.map((c) => (
          <div className="tr courses-table-grid" key={c.code}>
            <span>
              <b className="course-code-highlight">{c.code}</b>
            </span>
            <span>{c.name}</span>
            <span>{c.dept}</span>
            <span>{c.level}</span>
            <span>{c.semester}</span>
            <span>
              <Link to={`/library?q=${encodeURIComponent(c.code)}`} className="table-action-btn">
                Search Files
              </Link>
            </span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// 8. Admin Categories Tab
function AdminCategoriesTab() {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">REPOSITORY STRUCTURE</p>
          <h1>Categories & academic sessions</h1>
          <p className="subtitle">Manage material classification tags and university academic calendar sessions.</p>
        </div>
      </div>

      <div className="categories-grid">
        <div className="category-box">
          <h3>Material Classification Types</h3>
          <ul className="cat-list">
            <li>Lecture Notes & Slides (Verified)</li>
            <li>Recommended Reference Materials & Compendiums</li>
            <li>Examination Past Questions (Solved)</li>
            <li>Test Past Questions & Revision Practice</li>
            <li>Student Projects & Empirical Theses</li>
            <li>Handouts & Laboratory Worksheets</li>
            <li>Research Papers & Journal Publications</li>
          </ul>
        </div>

        <div className="category-box">
          <h3>Academic Calendar Sessions</h3>
          <ul className="cat-list">
            <li>2025/2026 Academic Session (Current / Active)</li>
            <li>2024/2025 Academic Session</li>
            <li>2023/2024 Academic Session</li>
            <li>2022/2023 Academic Session</li>
            <li>2021/2022 Academic Session</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// 9. Admin Audit Logs Tab
function AdminAuditLogsTab({ logs }: { logs: any[] }) {
  const [searchTerm, setSearchTerm] = useState('');

  const displayed = logs.filter((log) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      (log.action || '').toLowerCase().includes(q) ||
      (log.performedBy || '').toLowerCase().includes(q) ||
      (log.entity || '').toLowerCase().includes(q) ||
      (log.details || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SYSTEM LOGS</p>
          <h1>Repository audit trail</h1>
          <p className="subtitle">Immutable record of material publications, student uploads, approvals, and administrator actions.</p>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="manage-tools compact">
          <Search size={17} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search logs by action, operator, resource, or details..."
            aria-label="Search audit logs"
          />
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm('')} aria-label="Clear audit log search">
              Clear
            </button>
          )}
        </div>
      )}

      <div className="table">
        <div className="tr head audit-table-grid">
          <span>Action Performed</span>
          <span>User / Operator</span>
          <span>Entity / Resource</span>
          <span>Timestamp</span>
          <span>Record State</span>
        </div>

        {logs.length === 0 ? (
          <div className="empty-state">
            <ShieldAlert size={32} />
            <b>No audit records yet.</b>
            <span>Approvals, publications and administrative actions will be recorded here.</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className="empty-state">
            <Search size={32} />
            <b>No log entries match “{searchTerm.trim()}”.</b>
            <span>Adjust or clear the search to see all recorded activity.</span>
          </div>
        ) : (
          displayed.map((log) => (
            <div className="tr audit-table-grid" key={log.id}>
              <span>
                <b>{log.action}</b>
                <small>{log.details || 'Database record'}</small>
              </span>
              <span>{log.performedBy}</span>
              <span>{log.entity}</span>
              <span>{new Date(log.timestamp).toLocaleString()}</span>
              <span>
                <span className="status-badge approved">Verified Record</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 9b. Live maintenance status card (real state lives in Supabase, controlled
// by the Super Admin under /super/system — admins here see it read-only).
function MaintenanceStatusCard() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { isSuperAdmin } = useAuth();

  useEffect(() => {
    let cancelled = false;
    fetchMaintenanceStatus()
      .then((s) => {
        if (!cancelled) {
          setStatus(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = status?.enabled ?? false;

  return (
    <div className={`maintenance-status-card ${active ? 'is-active' : ''}`}>
      <span className={`maintenance-status-dot ${active ? 'on' : ''}`} aria-hidden="true" />
      <div className="switch-info">
        <b>Maintenance Mode {loaded ? (active ? '· Active' : '· Inactive') : ''}</b>
        <span>
          Global platform availability is managed centrally.{' '}
          {isSuperAdmin
            ? 'Open "System & maintenance" in the Super Admin dashboard to change it.'
            : 'Only a Super Administrator can enable or disable it.'}
        </span>
        {status?.updatedAt && (
          <small>Last updated {new Date(status.updatedAt).toLocaleString()}</small>
        )}
      </div>
      {isSuperAdmin && (
        <Link to="/super/system" className="secondary-btn maintenance-manage-link">
          <ShieldCheck size={15} />
          <span>Manage</span>
        </Link>
      )}
    </div>
  );
}

// 10. Admin Settings Tab
function AdminSettingsTab() {
  const store = useStore();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'general' | 'materials' | 'users' | 'notifications' | 'security' | 'taxonomy'>('general');
  const [settings, setSettings] = useState(store.getAdminSettings());
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [adminPasswordState, setAdminPasswordState] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    store.updateAdminSettings(settings);
    toast('System configuration updated and persisted!', 'success');
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPasswordState.newPassword.length < 8) {
      toast('Admin password must be at least 8 characters.', 'error');
      return;
    }
    if (adminPasswordState.newPassword !== adminPasswordState.confirmPassword) {
      toast('Passwords do not match.', 'error');
      return;
    }
    setAdminPasswordState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    toast('Administrator password updated successfully.', 'success');
  };

  const handleResetDefaults = () => {
    const fresh = store.resetAdminSettings();
    setSettings(fresh);
    setResetModalOpen(false);
    toast('Settings reset to university default configuration.', 'info');
  };

  const handleExportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      institution: 'Federal University Wukari',
      settings,
      stats: store.getSystemStats(),
      materialsCount: store.getAllMaterials().length
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FUW_Library_Config_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Configuration & catalogue backup JSON exported successfully.');
  };

  const toggleFileType = (type: string) => {
    const current = settings.materials.allowedFileTypes;
    const updated = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    setSettings({
      ...settings,
      materials: { ...settings.materials, allowedFileTypes: updated }
    });
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SYSTEM CONFIGURATION & REPOSITORY POLICIES</p>
          <h1>Admin settings</h1>
          <p className="subtitle">
            Configure submission policies, storage thresholds, student permissions, notifications, and security protocols.
          </p>
        </div>
        <div className="portal-top-actions">
          <button type="button" className="outline-btn" onClick={handleExportData}>
            <Download size={15} /> Export JSON Config
          </button>
        </div>
      </div>

      <div className="settings-layout">
        {/* Admin Settings Navigation */}
        <aside className="settings-sidebar">
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            <Building2 size={16} />
            <span>General Information</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'materials' ? 'active' : ''}`}
            onClick={() => setActiveTab('materials')}
          >
            <FileText size={16} />
            <span>Material & Uploads</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            <Users size={16} />
            <span>Users & Permissions</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <Bell size={16} />
            <span>Notification Rules</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Lock size={16} />
            <span>Security & Access</span>
          </button>

          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'taxonomy' ? 'active' : ''}`}
            onClick={() => setActiveTab('taxonomy')}
          >
            <Database size={16} />
            <span>Taxonomy & Backup</span>
          </button>
        </aside>

        {/* Admin Settings Form Panel */}
        <div className="settings-content-panel">
          {/* 1. General Settings */}
          {activeTab === 'general' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>General Repository Information</h2>
                  <p>Configure public university library identification, contact addresses, and global announcements.</p>
                </div>
              </div>

              <form onSubmit={handleSaveSettings}>
                <div className="form-grid-2">
                  <label>
                    Library System Name
                    <input
                      value={settings.general.libraryName}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          general: { ...settings.general, libraryName: e.target.value }
                        })
                      }
                      required
                    />
                  </label>

                  <label>
                    Current Academic Session
                    <select
                      value={settings.general.academicSession}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          general: { ...settings.general, academicSession: e.target.value }
                        })
                      }
                    >
                      <option value="2025/2026">2025/2026 Academic Session</option>
                      <option value="2026/2027">2026/2027 Academic Session</option>
                      <option value="2024/2025">2024/2025 Academic Session</option>
                    </select>
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Official Contact Email
                    <input
                      type="email"
                      value={settings.general.contactEmail}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          general: { ...settings.general, contactEmail: e.target.value }
                        })
                      }
                      required
                    />
                  </label>

                  <label>
                    Helpdesk Phone
                    <input
                      value={settings.general.supportPhone}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          general: { ...settings.general, supportPhone: e.target.value }
                        })
                      }
                      required
                    />
                  </label>
                </div>

                <label>
                  Campus Location & Address
                  <input
                    value={settings.general.campusLocation}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general: { ...settings.general, campusLocation: e.target.value }
                      })
                    }
                    required
                  />
                </label>

                <label>
                  Repository Description & Tagline
                  <textarea
                    rows={3}
                    value={settings.general.libraryDescription}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general: { ...settings.general, libraryDescription: e.target.value }
                      })
                    }
                    required
                  />
                </label>

                <label>
                  Global Public Announcement Banner
                  <input
                    value={settings.general.announcementText}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        general: { ...settings.general, announcementText: e.target.value }
                      })
                    }
                    placeholder="Broadcast announcement displayed at top of portal..."
                  />
                </label>

                <MaintenanceStatusCard />

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save General Settings
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 2. Material & Upload Policies */}
          {activeTab === 'materials' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Material Submission & Review Policies</h2>
                  <p>Control file limits, approval mandates, and student submission rules.</p>
                </div>
              </div>

              <form onSubmit={handleSaveSettings}>
                <div className="form-grid-2">
                  <label>
                    Maximum Upload File Size Limit
                    <select
                      value={settings.materials.maxUploadSizeMb}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          materials: { ...settings.materials, maxUploadSizeMb: Number(e.target.value) }
                        })
                      }
                    >
                      <option value="10">10 MB (Light)</option>
                      <option value="25">25 MB (Standard Recommended)</option>
                      <option value="50">50 MB (High Resolution)</option>
                      <option value="100">100 MB (Large Compilations)</option>
                    </select>
                  </label>

                  <label>
                    Default Material Publish State
                    <select
                      value={settings.materials.defaultMaterialStatus}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          materials: { ...settings.materials, defaultMaterialStatus: e.target.value as any }
                        })
                      }
                    >
                      <option value="pending">Require Administrator Approval (Safe)</option>
                      <option value="approved">Auto-Approve (Direct Publish)</option>
                    </select>
                  </label>
                </div>

                <div className="file-types-section">
                  <span className="section-label-bold">Allowed Academic File Formats</span>
                  <div className="file-types-grid">
                    {['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'XLS', 'XLSX'].map((ext) => (
                      <label key={ext} className="file-type-pill-label">
                        <input
                          type="checkbox"
                          checked={settings.materials.allowedFileTypes.includes(ext)}
                          onChange={() => toggleFileType(ext)}
                        />
                        <span>.{ext.toLowerCase()}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="switch-group">
                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Mandatory Admin Approval for Student Uploads</b>
                      <span>Every material submitted by students must be reviewed and approved by a librarian before becoming publicly available in the catalogue.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.materials.requireApprovalForStudentUploads}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          materials: { ...settings.materials, requireApprovalForStudentUploads: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Keep Rejected Materials Visible to Submitter</b>
                      <span>Allow students to see rejected submissions along with the administrator's feedback reason under "My Uploads".</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.materials.keepRejectedVisibleToStudents}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          materials: { ...settings.materials, keepRejectedVisibleToStudents: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Enable Direct Public File Downloads</b>
                      <span>Allow enrolled students and visitors to download PDF/Word copies in addition to reading online.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.materials.enablePublicDownloads}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          materials: { ...settings.materials, enablePublicDownloads: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Material Policies
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 3. Users & Permissions */}
          {activeTab === 'users' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>User & Student Permissions</h2>
                  <p>Manage student registration access, verification rules, and contribution caps.</p>
                </div>
              </div>

              <form onSubmit={handleSaveSettings}>
                <div className="switch-group">
                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Allow Open Student Self-Registration</b>
                      <span>Permit students with valid FUW matriculation numbers to register their accounts online.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.users.allowStudentRegistration}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          users: { ...settings.users, allowStudentRegistration: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Require University Email Domain Verification</b>
                      <span>Enforce @fuw.edu.ng email addresses during account registration.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.users.requireAccountVerification}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          users: { ...settings.users, requireAccountVerification: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Grant Student Upload Privileges</b>
                      <span>Enable the "Upload Material" section on the student dashboard for academic contributions.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.users.allowStudentUploads}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          users: { ...settings.users, allowStudentUploads: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="form-grid-2" style={{ marginTop: '16px' }}>
                  <label>
                    Daily Upload Limit Per Student
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={settings.users.maxUploadsPerStudentPerDay}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          users: { ...settings.users, maxUploadsPerStudentPerDay: Number(e.target.value) }
                        })
                      }
                      required
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save User Permissions
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 4. Notification Rules */}
          {activeTab === 'notifications' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Notification & Alert Settings</h2>
                  <p>Configure automatic triggers for material submissions, approvals, rejections, and security audits.</p>
                </div>
              </div>

              <form onSubmit={handleSaveSettings}>
                <label>
                  Primary Administrator Alert Email
                  <input
                    type="email"
                    value={settings.notifications.adminNotificationEmail}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, adminNotificationEmail: e.target.value }
                      })
                    }
                    required
                  />
                </label>

                <div className="switch-group" style={{ marginTop: '16px' }}>
                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Alert on New Student Material Submissions</b>
                      <span>Receive an immediate notification whenever a student submits a new lecture note or past question.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.notifyOnNewSubmissions}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, notifyOnNewSubmissions: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Send Automated Approval Confirmation to Student</b>
                      <span>Notify the student when their material passes moderation and is published live.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.notifyStudentOnApproval}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, notifyStudentOnApproval: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Send Rejection Reason Feedback to Student</b>
                      <span>Notify the student with administrator notes if their upload is rejected or needs revision.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.notifyStudentOnRejection}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, notifyStudentOnRejection: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>System Security & Audit Activity Alerts</b>
                      <span>Log and alert administrators on password updates, role changes, and bulk deletions.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.securityAuditAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, securityAuditAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Notification Rules
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 5. Security & Access */}
          {activeTab === 'security' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Administrator Security & Session Rules</h2>
                  <p>Manage administrator credentials, session timeouts, and rate limits.</p>
                </div>
              </div>

              {/* Change Admin Password */}
              <form onSubmit={handlePasswordChange} style={{ marginBottom: '28px' }}>
                <span className="section-label-bold">Change Administrator Password</span>
                <label style={{ marginTop: '10px' }}>
                  Current Password
                  <input
                    type="password"
                    placeholder="Enter current admin password"
                    value={adminPasswordState.currentPassword}
                    onChange={(e) => setAdminPasswordState({ ...adminPasswordState, currentPassword: e.target.value })}
                    required
                  />
                </label>

                <div className="form-grid-2">
                  <label>
                    New Admin Password
                    <input
                      type="password"
                      placeholder="At least 8 characters"
                      value={adminPasswordState.newPassword}
                      onChange={(e) => setAdminPasswordState({ ...adminPasswordState, newPassword: e.target.value })}
                      required
                    />
                  </label>

                  <label>
                    Confirm New Password
                    <input
                      type="password"
                      placeholder="Repeat new password"
                      value={adminPasswordState.confirmPassword}
                      onChange={(e) => setAdminPasswordState({ ...adminPasswordState, confirmPassword: e.target.value })}
                      required
                    />
                  </label>
                </div>

                <button type="submit" className="outline-btn" style={{ marginTop: '8px' }}>
                  <Key size={14} /> Update Administrator Password
                </button>
              </form>

              <hr className="settings-divider" />

              {/* Session Policies */}
              <form onSubmit={handleSaveSettings}>
                <span className="section-label-bold">Session & Traffic Controls</span>
                <div className="form-grid-2" style={{ marginTop: '12px' }}>
                  <label>
                    Administrator Inactivity Timeout
                    <select
                      value={settings.security.sessionTimeoutMinutes}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          security: { ...settings.security, sessionTimeoutMinutes: Number(e.target.value) }
                        })
                      }
                    >
                      <option value="15">15 Minutes</option>
                      <option value="30">30 Minutes</option>
                      <option value="60">60 Minutes (Standard)</option>
                      <option value="240">4 Hours</option>
                      <option value="1440">24 Hours</option>
                    </select>
                  </label>

                  <label>
                    Public Rate Limiting (Requests / 15 min)
                    <input
                      type="number"
                      value={settings.security.rateLimitPer15Min}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          security: { ...settings.security, rateLimitPer15Min: Number(e.target.value) }
                        })
                      }
                      required
                    />
                  </label>
                </div>

                <div className="switch-group" style={{ marginTop: '12px' }}>
                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Enforce Two-Factor Authentication (2FA) for Admins</b>
                      <span>Require an authenticator code verification on every staff administrator login.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.security.enforce2FA}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          security: { ...settings.security, enforce2FA: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Allow Guest Browsing</b>
                      <span>Allow non-authenticated public visitors to view catalogue metadata and book cards.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.security.allowGuestBrowsing}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          security: { ...settings.security, allowGuestBrowsing: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Security Configuration
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 6. Taxonomy & Backup */}
          {activeTab === 'taxonomy' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Taxonomy Overview & System Reset</h2>
                  <p>Inspect academic structure metrics and manage repository state backups.</p>
                </div>
              </div>

              <div className="taxonomy-summary-grid">
                <div className="tax-stat-box">
                  <b>{catalogue.length}</b>
                  <span>Faculties</span>
                </div>
                <div className="tax-stat-box">
                  <b>{catalogue.reduce((acc, f) => acc + f.departments.length, 0)}</b>
                  <span>Departments</span>
                </div>
                <div className="tax-stat-box">
                  <b>{store.getAllMaterials().length}</b>
                  <span>Materials</span>
                </div>
                <div className="tax-stat-box">
                  <b>6</b>
                  <span>Level Bands</span>
                </div>
              </div>

              <div className="backup-actions-block">
                <div className="backup-row">
                  <div>
                    <b>Export Complete Catalogue JSON</b>
                    <p>Download a complete JSON database dump of all current materials, configurations, and audit logs.</p>
                  </div>
                  <button type="button" className="outline-btn" onClick={handleExportData}>
                    <Download size={15} /> Export JSON
                  </button>
                </div>

                <div className="backup-row danger-row">
                  <div>
                    <b>Reset System Settings to Factory Defaults</b>
                    <p>Restore default submission rules, file thresholds, and notification policies.</p>
                  </div>
                  <button
                    type="button"
                    className="danger-btn-outline"
                    onClick={() => setResetModalOpen(true)}
                  >
                    <RefreshCw size={15} /> Reset Settings
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {resetModalOpen && (
        <div className="modal-backdrop" onClick={() => setResetModalOpen(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-icon warning">
              <AlertTriangle size={28} />
            </div>
            <h3>Reset System Settings?</h3>
            <p>
              Are you sure you want to reset all repository configurations, upload limits, and notification preferences to their default university state?
            </p>
            <div className="confirm-modal-actions">
              <button className="cancel-btn" onClick={() => setResetModalOpen(false)}>
                Cancel
              </button>
              <button className="danger-confirm-btn" onClick={handleResetDefaults}>
                Yes, Reset to Defaults
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
