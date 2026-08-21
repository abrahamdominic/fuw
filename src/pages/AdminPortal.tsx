import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  BarChart3
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem } from '../lib/store';
import { Logo } from '../components/Logo';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { catalogue } from '../data/catalogue';
import { useToast } from '../components/Toast';

interface AdminPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

const adminNavItems = [
  { label: 'Overview', path: '/admin', icon: LayoutDashboard, exact: true },
  { label: 'Materials & Approvals', path: '/admin/materials', icon: FileText },
  { label: 'Upload material', path: '/admin/upload', icon: Upload },
  { label: 'Students & users', path: '/admin/users', icon: Users },
  { label: 'Faculties', path: '/admin/faculties', icon: Building2 },
  { label: 'Departments', path: '/admin/departments', icon: Building2 },
  { label: 'Courses & levels', path: '/admin/courses', icon: GraduationCap },
  { label: 'Categories & sessions', path: '/admin/categories', icon: Bookmark },
  { label: 'Audit logs', path: '/admin/logs', icon: ShieldCheck },
  { label: 'Settings', path: '/admin/settings', icon: Settings }
];

export function AdminPortal({ onReadOnline }: AdminPortalProps) {
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentUser = store.getCurrentUser();
  const allMaterials = store.getAllMaterials();
  const pendingMaterials = store.getPendingMaterials();
  const approvedMaterials = store.getApprovedMaterials();
  const rejectedMaterials = store.getRejectedMaterials();
  const auditLogs = store.getAuditLogs();
  const stats = store.getSystemStats();

  const currentPath = location.pathname;

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
            <b>{currentUser.displayName || currentUser.fullName}</b>
            <span>Librarian / Administrator</span>
          </div>
        </div>

        <p className="side-nav-heading">REPOSITORY ADMINISTRATION</p>

        <nav className="side-nav-list">
          {adminNavItems.map((item) => {
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
          <Link to="/" className="side-link logout-link">
            <LogOut size={17} />
            <span>Public Library View</span>
          </Link>
        </div>
      </aside>

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

        {/* Dynamic Admin Subpages */}
        {currentPath === '/admin' || currentPath === '/admin/' ? (
          <AdminOverviewTab
            stats={stats}
            pendingCount={pendingMaterials.length}
            auditLogs={auditLogs}
            pendingMaterials={pendingMaterials}
            onApprove={(id: string) => {
              store.approveMaterial(id, currentUser.fullName);
              toast('Material approved and published to public library!', 'success');
            }}
            onReject={(id: string, reason: string) => {
              store.rejectMaterial(id, reason, currentUser.fullName);
              toast('Material marked as rejected.', 'info');
            }}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/admin/materials') ? (
          <AdminMaterialsTab
            allMaterials={allMaterials}
            pendingMaterials={pendingMaterials}
            approvedMaterials={approvedMaterials}
            rejectedMaterials={rejectedMaterials}
            onApprove={(id: string) => {
              store.approveMaterial(id, currentUser.fullName);
              toast('Material approved and published to public frontend!', 'success');
            }}
            onReject={(id: string, reason: string) => {
              store.rejectMaterial(id, reason, currentUser.fullName);
              toast('Material rejected.', 'info');
            }}
            onDelete={(id: string) => {
              store.deleteMaterial(id, currentUser.fullName);
              toast('Material deleted from database.', 'info');
            }}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/admin/upload') ? (
          <AdminUploadTab onUploaded={() => navigate('/admin/materials')} />
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
            onApprove={(id: string) => {
              store.approveMaterial(id, currentUser.fullName);
              toast('Material approved and published to frontend!', 'success');
            }}
            onReject={(id: string, reason: string) => {
              store.rejectMaterial(id, reason, currentUser.fullName);
              toast('Material rejected.', 'info');
            }}
            onReadOnline={onReadOnline}
          />
        )}
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
  onApprove,
  onReject,
  onReadOnline
}: any) {
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

      {/* Monthly Uploads Activity Chart */}
      <div className="admin-chart">
        <div className="chart-header">
          <div>
            <p className="kicker">ACTIVITY TELEMETRY</p>
            <h2>Academic Material Submissions & Access (2026)</h2>
          </div>
          <span className="chart-tag">Current Academic Session</span>
        </div>
        <div className="bars">
          {[
            { m: 'Jan', h: 45, v: '180' },
            { m: 'Feb', h: 62, v: '248' },
            { m: 'Mar', h: 78, v: '312' },
            { m: 'Apr', h: 90, v: '360' },
            { m: 'May', h: 100, v: '410' },
            { m: 'Jun', h: 30, v: '120' }
          ].map((bar) => (
            <div key={bar.m}>
              <span>{bar.v}</span>
              <i style={{ height: `${bar.h}%` }} />
              <b>{bar.m}</b>
            </div>
          ))}
        </div>
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
                  <button
                    className="approval-btn approve"
                    onClick={() => onApprove(m.id)}
                    title="Approve and Publish to Frontend"
                  >
                    <CheckCircle2 size={14} /> Approve & Publish
                  </button>
                  <button
                    className="approval-btn reject"
                    onClick={() => {
                      const reason = prompt('Optional rejection note:');
                      onReject(m.id, reason || 'Does not meet submission criteria.');
                    }}
                    title="Reject submission"
                  >
                    <XCircle size={14} /> Reject
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
  onApprove,
  onReject,
  onDelete,
  onReadOnline
}: {
  allMaterials: MaterialItem[];
  pendingMaterials: MaterialItem[];
  approvedMaterials: MaterialItem[];
  rejectedMaterials: MaterialItem[];
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  onDelete: (id: string) => void;
  onReadOnline: (m: MaterialItem) => void;
}) {
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [searchTerm, setSearchTerm] = useState('');

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
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')}>
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

                {m.status !== 'approved' && (
                  <button
                    className="approval-btn approve small"
                    onClick={() => onApprove(m.id)}
                    title="Approve & Publish immediately to Frontend"
                  >
                    <CheckCircle2 size={13} /> Approve
                  </button>
                )}

                {m.status === 'pending' && (
                  <button
                    className="approval-btn reject small"
                    onClick={() => {
                      const reason = prompt('Optional rejection note:');
                      onReject(m.id, reason || 'Does not satisfy curriculum guidelines.');
                    }}
                    title="Reject"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                )}

                <button
                  className="action-icon-btn delete"
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete "${m.title}"?`)) {
                      onDelete(m.id);
                    }
                  }}
                  title="Delete from database"
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
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
    department: 'Economics',
    course: 'ECN 201',
    level: '200 Level',
    semester: 'First Semester',
    type: 'Lecture Note'
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
      store.publishMaterialAdmin({
        title,
        description,
        faculty: filters.faculty || 'Faculty of Social Sciences',
        department: filters.department || 'Economics',
        course_code: filters.course || 'GEN 101',
        course_title: filters.course || title,
        level: filters.level || '200 Level',
        semester: filters.semester || 'First Semester',
        material_type: filters.type || 'Lecture Note',
        file
      });

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

// 4. Admin Users Tab
function AdminUsersTab() {
  const { toast } = useToast();
  const sampleUsers = [
    {
      id: 'u-1',
      name: 'Aisha Bello',
      matric: 'FUW/2022/CSC/0142',
      dept: 'Computer Science',
      level: '300 Level',
      status: 'VERIFIED',
      role: 'STUDENT',
      date: 'Nov 12, 2022'
    },
    {
      id: 'u-2',
      name: 'Emmanuel Tarfa',
      matric: 'FUW/2021/AGR/0088',
      dept: 'Agricultural Economics',
      level: '400 Level',
      status: 'VERIFIED',
      role: 'STUDENT',
      date: 'Oct 05, 2021'
    },
    {
      id: 'u-3',
      name: 'Fatima Mohammed',
      matric: 'FUW/2023/ECN/0201',
      dept: 'Economics',
      level: '200 Level',
      status: 'PENDING',
      role: 'STUDENT',
      date: 'Jan 14, 2023'
    },
    {
      id: 'u-4',
      name: 'Dr. Yakubu G. Audu',
      matric: 'STAFF/LIB/001',
      dept: 'Library Repository',
      level: 'Admin',
      status: 'VERIFIED',
      role: 'ADMIN',
      date: 'Oct 01, 2018'
    }
  ];

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC COMMUNITY</p>
          <h1>Students & user accounts</h1>
          <p className="subtitle">Manage student matriculation verification, librarian permissions, and user statuses.</p>
        </div>
      </div>

      <div className="table">
        <div className="tr head users-table-grid">
          <span>Student / Full Name</span>
          <span>Matric / ID</span>
          <span>Department & Level</span>
          <span>Role</span>
          <span>Verification Status</span>
          <span>Actions</span>
        </div>

        {sampleUsers.map((u) => (
          <div className="tr users-table-grid" key={u.id}>
            <span>
              <b>{u.name}</b>
            </span>
            <span>{u.matric}</span>
            <span>{u.dept} · {u.level}</span>
            <span>
              <span className={`role-pill ${u.role.toLowerCase()}`}>{u.role}</span>
            </span>
            <span>
              <span className={`status-badge ${u.status.toLowerCase()}`}>
                {u.status === 'VERIFIED' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                {u.status}
              </span>
            </span>
            <span>
              <button
                className="table-action-btn"
                onClick={() => toast(`User ${u.name} status updated`)}
              >
                Manage
              </button>
            </span>
          </div>
        ))}
      </div>
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
  const allDepts = catalogue.flatMap((f) =>
    f.departments.map((d) => ({
      faculty: f.name,
      name: d.name,
      duration: d.duration,
      coursesCount: d.courses.length
    }))
  );

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC PROGRAMMES</p>
          <h1>Accredited departments ({allDepts.length})</h1>
          <p className="subtitle">Complete catalogue of 52 academic departments and degree durations.</p>
        </div>
      </div>

      <div className="table">
        <div className="tr head depts-table-grid">
          <span>Department Name</span>
          <span>Parent Faculty</span>
          <span>Degree Duration</span>
          <span>Standard Curriculum Courses</span>
          <span>Action</span>
        </div>

        {allDepts.map((d) => (
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
    </div>
  );
}

// 7. Admin Courses Tab
function AdminCoursesTab() {
  const allCourses = catalogue.flatMap((f) =>
    f.departments.flatMap((d) =>
      d.courses.map((c) => ({
        code: c.code,
        name: c.name,
        level: c.level * 100 + ' Level',
        semester: c.semester,
        dept: d.name,
        faculty: f.name
      }))
    )
  );

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">CURRICULUM DIRECTORY</p>
          <h1>Courses & curriculum levels</h1>
          <p className="subtitle">Accredited course codes mapped across departments and academic semesters.</p>
        </div>
      </div>

      <div className="table">
        <div className="tr head courses-table-grid">
          <span>Course Code</span>
          <span>Course Title</span>
          <span>Department</span>
          <span>Level</span>
          <span>Semester</span>
          <span>Library Resources</span>
        </div>

        {allCourses.map((c) => (
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
            <li>Recommended Textbooks & Compendiums</li>
            <li>Examination Past Questions (Solved)</li>
            <li>Test Questions & Revision Practice</li>
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
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SYSTEM LOGS</p>
          <h1>Repository audit trail</h1>
          <p className="subtitle">Immutable record of material publications, student uploads, approvals, and administrator actions.</p>
        </div>
      </div>

      <div className="table">
        <div className="tr head audit-table-grid">
          <span>Action Performed</span>
          <span>User / Operator</span>
          <span>Entity / Resource</span>
          <span>Timestamp</span>
          <span>Record State</span>
        </div>

        {logs.map((log) => (
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
        ))}
      </div>
    </div>
  );
}

// 10. Admin Settings Tab
function AdminSettingsTab() {
  const { toast } = useToast();
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">REPOSITORY CONFIGURATION</p>
          <h1>System settings</h1>
          <p className="subtitle">Configure repository access rules, upload file limits, and administrative controls.</p>
        </div>
      </div>

      <div className="settings-container">
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            toast('Admin system settings saved successfully!', 'success');
          }}
        >
          <div className="settings-section">
            <h3>Submission & Review Policies</h3>
            <label className="checkbox-label">
              <input type="checkbox" defaultChecked />
              <div>
                <b>Mandatory Admin Approval for Student Uploads</b>
                <span>Require an administrator or librarian to approve all student contributed materials before public display.</span>
              </div>
            </label>

            <label className="checkbox-label">
              <input type="checkbox" defaultChecked />
              <div>
                <b>Automated File Integrity & Virus Scanning</b>
                <span>Scan uploaded PDF, Word, and PowerPoint files for security before archiving.</span>
              </div>
            </label>
          </div>

          <div className="settings-section">
            <h3>Storage & Bandwidth Limits</h3>
            <label>
              Maximum Upload File Size
              <select defaultValue="25">
                <option value="10">10 MB</option>
                <option value="25">25 MB (Standard)</option>
                <option value="50">50 MB</option>
                <option value="100">100 MB</option>
              </select>
            </label>

            <label>
              Public Rate Limiting (Requests per 15 min)
              <input defaultValue="300" />
            </label>
          </div>

          <button className="primary save-settings-btn">Save System Configuration</button>
        </form>
      </div>
    </div>
  );
}
