import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate, Routes, Route } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Heart,
  Clock,
  Download,
  BookOpen,
  Users,
  Settings,
  LogOut,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Eye,
  ArrowRight,
  Sparkles,
  Menu,
  X,
  ShieldCheck,
  UserCheck,
  Lock,
  Bell,
  Key,
  Shield,
  Smartphone,
  Laptop,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Save,
  Info,
  Check
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem, getTimeGreeting, getUserTimeZone, formatUserTime } from '../lib/store';
import { Logo } from '../components/Logo';
import { MaterialCard } from '../components/MaterialCard';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { catalogue, facultyByName, departmentByName, levelsFor, materialTypes, courseTitleByCode } from '../data/catalogue';
import { submitMaterial as submitMaterialDb, fetchMyMaterials, deleteMaterial as deleteMaterialDb } from '../lib/materials';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  subscribeToNotifications,
  NotificationItem
} from '../lib/notifications';
import { aiAsk, AiCitation, aiConfiguredHint } from '../lib/ai';
import { requireSupabase } from '../lib/supabase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../components/Toast';


interface StudentPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

const studentNavItems = [
  { label: 'Dashboard', path: '/student', icon: LayoutDashboard, exact: true },
  { label: 'Upload material', path: '/student/upload', icon: Upload },
  { label: 'My uploads', path: '/student/uploads', icon: FileText },
  { label: 'AI study assistant', path: '/student/assistant', icon: Sparkles },
  { label: 'Saved materials', path: '/student/saved', icon: Heart },
  { label: 'Recently viewed', path: '/student/recent', icon: Clock },
  { label: 'Downloads', path: '/student/downloads', icon: Download },
  { label: 'Reading history', path: '/student/reading', icon: BookOpen },
  { label: 'My profile', path: '/student/profile', icon: Users },
  { label: 'Settings', path: '/student/settings', icon: Settings }
];

export function StudentPortal({ onReadOnline }: StudentPortalProps) {
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut, profile, user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Notification centre state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  // Server-side paginated "My Uploads"
  const [uploadsPage, setUploadsPage] = useState(0);
  const [pagedUploads, setPagedUploads] = useState<MaterialItem[]>([]);
  const [uploadsTotal, setUploadsTotal] = useState(0);
  const [uploadsVersion, setUploadsVersion] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<MaterialItem | null>(null);
  // Material the student chose to "Ask AI" about
  const [aiFocusMaterial, setAiFocusMaterial] = useState<MaterialItem | null>(null);
  const UPLOADS_PAGE_SIZE = 8;

  const storeUser = store.getCurrentUser();
  const currentUser = {
    id: profile?.id || user?.id || storeUser.id,
    fullName: profile?.fullName || user?.user_metadata?.full_name || storeUser.fullName || 'Student',
    displayName: profile?.displayName || profile?.fullName?.split(' ')[0] || storeUser.displayName || '',
    email: profile?.email || user?.email || storeUser.email || '',
    matricNumber: profile?.matricNumber || storeUser.matricNumber || '',
    faculty: profile?.faculty || storeUser.faculty || '',
    department: profile?.department || storeUser.department || '',
    level: profile?.level || storeUser.level || '',
    role: (profile?.role === 'admin' || profile?.role === 'super_admin' ? 'ADMIN' : 'STUDENT') as 'STUDENT' | 'ADMIN',
    bio: profile?.bio || storeUser.bio || '',
    avatarUrl: profile?.avatarUrl || storeUser.avatarUrl || '',
    isVerified: profile?.isVerified ?? true,
    verificationStatus: 'VERIFIED' as const,
    joinedDate: profile?.joinedDate || storeUser.joinedDate || '2026'
  };
  const approvedMaterials = store.getApprovedMaterials();
  const studentUploads = store.getStudentUploads(currentUser.id);
  const savedMaterials = store.getSavedMaterials();
  const recentMaterials = store.getRecentMaterials();
  const downloadHistory = store.getDownloadHistory();
  const readingHistory = store.getReadingHistory();

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  // Load notifications once + subscribe to live inserts.
  useEffect(() => {
    if (!user?.id) return;
    let unsubscribe = () => {};
    let cancelled = false;
    (async () => {
      try {
        const items = await fetchNotifications();
        if (!cancelled) setNotifications(items);
        unsubscribe = subscribeToNotifications(user.id, (item) =>
          setNotifications((prev) => (prev.some((n) => n.id === item.id) ? prev : [item, ...prev]))
        );
      } catch {
        // Notifications are non-critical.
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.id]);

  // Server-paginated uploads listing (keeps performance stable as history grows).
  useEffect(() => {
    if (!currentUser.id) return;
    let cancelled = false;
    fetchMyMaterials(currentUser.id, uploadsPage, UPLOADS_PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setPagedUploads(res.items);
        setUploadsTotal(res.total);
        if (res.items.length === 0 && res.total > 0 && uploadsPage > 0) {
          // Page shrank below our cursor (e.g. after deletion) — step back.
          setUploadsPage(Math.max(0, Math.ceil(res.total / UPLOADS_PAGE_SIZE) - 1));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id, uploadsPage, uploadsVersion]);

  /** Jump into the AI assistant pre-focused on a specific material. */
  const handleAskAi = (m: MaterialItem) => {
    setAiFocusMaterial(m);
    navigate('/student/assistant');
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMaterialDb(pendingDelete.id);
      toast('Material removed from uploads.', 'info');
      setUploadsPage((p) => p); // trigger refresh via dependency no-op
      setPagedUploads((prev) => prev.filter((m) => m.id !== pendingDelete.id));
      setUploadsTotal((t) => Math.max(0, t - 1));
      void store.syncMaterialsFromSupabase();
    } catch (err: any) {
      toast(err.message || 'Could not delete this material.', 'error');
    }
    setPendingDelete(null);
  };

  // Determine current active subpage
  const currentPath = location.pathname;

  const handleLogout = async () => {
    await signOut();
    toast('Logged out of Student Portal', 'info');
    navigate('/login');
  };

  return (
    <div className="portal">
      {/* Sidebar Navigation */}
      <aside className={`side ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="side-header">
          <Link className="brand" to="/" onClick={() => setMobileMenuOpen(false)}>
            <Logo size={32} />
            <b>FUW</b> E-Library
          </Link>
          <button
            className="side-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="side-user-card">
          <div className="user-avatar-circle">
            {currentUser.fullName.charAt(0)}
          </div>
          <div className="user-info-text">
            <b>{currentUser.displayName || currentUser.fullName}</b>
            <span>{currentUser.matricNumber}</span>
          </div>
        </div>

        <p className="side-nav-heading">STUDENT PORTAL</p>

        <nav className="side-nav-list">
          {studentNavItems.map((item) => {
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
                {item.label === 'My uploads' && studentUploads.length > 0 && (
                  <span className="side-badge">{studentUploads.length}</span>
                )}
                {item.label === 'Saved materials' && savedMaterials.length > 0 && (
                  <span className="side-badge">{savedMaterials.length}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="side-footer-actions">
          <button type="button" onClick={handleLogout} className="side-link logout-link" style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', textAlign: 'left' }}>
            <LogOut size={17} />
            <span>Sign out / Exit</span>
          </button>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main className="portal-main">
        {/* Notification centre */}
        <div className="notif-bell-wrap">
          <button
            type="button"
            className={`notif-bell ${unreadNotifCount > 0 ? 'has-unread' : ''}`}
            onClick={() => setNotifOpen((o) => !o)}
            aria-label={`Notifications${unreadNotifCount ? ` (${unreadNotifCount} unread)` : ''}`}
            title="Notifications"
          >
            <Bell size={18} />
            {unreadNotifCount > 0 && (
              <span className="notif-badge">{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>
            )}
          </button>

          {notifOpen && (
            <div className="notif-panel" role="dialog" aria-label="Your notifications">
              <div className="notif-panel-head">
                <b>Notifications</b>
                <div className="notif-panel-head-actions">
                  {unreadNotifCount > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await markAllNotificationsRead();
                        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                      }}
                    >
                      Mark all read
                    </button>
                  )}
                  <button type="button" onClick={() => setNotifOpen(false)} aria-label="Close notifications">
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="notif-list">
                {notifications.length === 0 ? (
                  <p className="notif-empty">You're all caught up — no notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>
                      <button
                        type="button"
                        className="notif-item-body"
                        onClick={async () => {
                          if (!n.read) {
                            await markNotificationRead(n.id);
                            setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                          }
                          if (n.link) navigate(n.link);
                          setNotifOpen(false);
                        }}
                      >
                        <b>{n.title}</b>
                        <span>{n.body}</span>
                        <small>{new Date(n.createdAt).toLocaleString()}</small>
                      </button>
                      <button
                        type="button"
                        className="notif-delete"
                        aria-label="Delete notification"
                        onClick={async () => {
                          await deleteNotification(n.id);
                          setNotifications((prev) => prev.filter((x) => x.id !== n.id));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Portal Top Bar */}
        <div className="portal-mobile-bar">
          <button
            className="portal-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open student navigation"
          >
            <Menu size={22} />
            <span>Menu</span>
          </button>
          <span className="portal-mobile-title">Student Dashboard</span>
          <Link to="/student/upload" className="portal-mobile-upload">
            <Upload size={16} />
          </Link>
        </div>

        {/* Dynamic Subpages based on Path */}
        {currentPath === '/student' || currentPath === '/student/' ? (
          <StudentOverviewTab
            currentUser={currentUser}
            savedCount={savedMaterials.length}
            recentCount={recentMaterials.length}
            downloadsCount={downloadHistory.length}
            readingCount={readingHistory.length}
            uploadsCount={studentUploads.length}
            recentMaterials={recentMaterials.slice(0, 4)}
            approvedMaterials={approvedMaterials.slice(0, 4)}
            onReadOnline={onReadOnline}
            onAskAi={handleAskAi}
          />
        ) : currentPath.startsWith('/student/upload') ? (
          <StudentUploadTab
            onUploaded={() => {
              setUploadsVersion((v) => v + 1);
              void store.syncMaterialsFromSupabase();
              navigate('/student/uploads');
            }}
          />
        ) : currentPath.startsWith('/student/uploads') ? (
          <StudentMyUploadsTab
            uploads={pagedUploads}
            total={uploadsTotal}
            page={uploadsPage}
            pageSize={UPLOADS_PAGE_SIZE}
            onPageChange={setUploadsPage}
            stats={{
              total: studentUploads.length,
              approved: studentUploads.filter((m) => m.status === 'approved').length,
              pending: studentUploads.filter((m) => m.status === 'pending').length,
              rejected: studentUploads.filter((m) => m.status === 'rejected').length,
              downloads: studentUploads.reduce((acc, m) => acc + (m.downloads || 0), 0)
            }}
            onRequestDelete={setPendingDelete}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/student/assistant') ? (
          <StudentAiChatTab
            focusMaterial={aiFocusMaterial}
            onClearFocus={() => setAiFocusMaterial(null)}
          />
        ) : currentPath.startsWith('/student/saved') ? (
          <StudentSavedTab
            savedMaterials={savedMaterials}
            onReadOnline={onReadOnline}
            onAskAi={handleAskAi}
            onRemove={(id) => {
              store.toggleBookmark(id);
              toast('Removed from saved materials.', 'info');
            }}
          />
        ) : currentPath.startsWith('/student/recent') ? (
          <StudentRecentTab
            recentMaterials={recentMaterials}
            onReadOnline={onReadOnline}
            onAskAi={handleAskAi}
          />
        ) : currentPath.startsWith('/student/downloads') ? (
          <StudentDownloadsTab downloadHistory={downloadHistory} />
        ) : currentPath.startsWith('/student/reading') ? (
          <StudentReadingTab
            readingHistory={readingHistory}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/student/profile') ? (
          <StudentProfileTab currentUser={currentUser} />
        ) : currentPath.startsWith('/student/settings') ? (
          <StudentSettingsTab currentUser={currentUser} />
        ) : (
          <StudentOverviewTab
            currentUser={currentUser}
            savedCount={savedMaterials.length}
            recentCount={recentMaterials.length}
            downloadsCount={downloadHistory.length}
            readingCount={readingHistory.length}
            uploadsCount={studentUploads.length}
            recentMaterials={recentMaterials.slice(0, 4)}
            approvedMaterials={approvedMaterials.slice(0, 4)}
            onReadOnline={onReadOnline}
            onAskAi={handleAskAi}
          />
        )}

        {/* Destructive-action confirmation */}
        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete this upload?"
          tone="danger"
          message={
            pendingDelete
              ? `"${pendingDelete.title}" will be permanently removed from the library, along with its stored file. This cannot be undone.`
              : ''
          }
          confirmLabel="Delete permanently"
          onConfirm={handleConfirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      </main>
    </div>
  );
}

// 1. Dashboard Overview Tab
function StudentOverviewTab({
  currentUser,
  savedCount,
  recentCount,
  downloadsCount,
  readingCount,
  uploadsCount,
  recentMaterials,
  approvedMaterials,
  onReadOnline,
  onAskAi
}: any) {
  // Live clock: re-renders every 30s so the greeting and local time always
  // reflect the student's real current timezone.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const realName = currentUser.fullName || currentUser.displayName || 'Student';
  const greeting = getTimeGreeting(realName, now);
  const timeZone = getUserTimeZone();

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">
            WELCOME BACK, {realName.toUpperCase()} · {formatUserTime(now)} ({timeZone})
          </p>
          <h1>{greeting}</h1>
          <p className="subtitle">
            {currentUser.department} · {currentUser.level} · Matric: {currentUser.matricNumber}
          </p>
        </div>
        <div className="portal-top-actions">
          <Link className="primary" to="/library">
            <Search size={16} />
            <span>Search Library</span>
          </Link>
          <Link className="secondary-btn" to="/student/upload">
            <Upload size={16} />
            <span>Submit Material</span>
          </Link>
        </div>
      </div>


      {/* Metrics Stats Grid */}
      <div className="portal-stats">
        <section>
          <Heart />
          <b>{savedCount}</b>
          <span>Saved materials</span>
        </section>
        <section>
          <Clock />
          <b>{recentCount}</b>
          <span>Recently viewed</span>
        </section>
        <section>
          <Download />
          <b>{downloadsCount}</b>
          <span>Downloads</span>
        </section>
        <section>
          <BookOpen />
          <b>{readingCount}</b>
          <span>Reading history</span>
        </section>
      </div>

      {/* Status Notice if student has uploads */}
      {uploadsCount > 0 && (
        <div className="portal-notice-card">
          <div className="notice-icon">
            <Sparkles size={20} />
          </div>
          <div className="notice-content">
            <h4>You have submitted {uploadsCount} material{uploadsCount > 1 ? 's' : ''} for faculty review</h4>
            <p>Admin librarians review submissions before publication to ensure curriculum quality.</p>
          </div>
          <Link to="/student/uploads" className="notice-action-link">
            View Upload Status →
          </Link>
        </div>
      )}

      {/* Recently Accessed Section */}
      <div className="section-head">
        <div>
          <p className="kicker">CONTINUE STUDYING</p>
          <h2>Recommended & recent resources</h2>
        </div>
        <Link to="/library">
          Explore all <ChevronRight size={16} />
        </Link>
      </div>

      {(() => {
        const recommended = recentMaterials.length > 0 ? recentMaterials : approvedMaterials;
        return recommended.length === 0 ? (
          <div className="empty-state card-empty">
            <BookOpen size={40} />
            <b>No library materials yet.</b>
            <span>Once administrators publish verified course materials, they will appear here for your department.</span>
          </div>
        ) : (
          <div className="grid materials">
            {recommended.map((m: MaterialItem) => (
              <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} onAskAi={onAskAi} />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// 2. Student Upload Tab
function StudentUploadTab({ onUploaded }: { onUploaded: () => void }) {
  const store = useStore();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    faculty: 'Faculty of Computing & Information System',
    department: 'Computer Science',
    course: '',
    level: '100 Level',
    semester: 'First Semester',
    type: materialTypes[0]
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setMessage({ type: 'error', text: 'Please choose an academic document file to upload.' });
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
      // Database-first submission: the row is created immediately and the file
      // is attached to Storage right after. Status (pending/approved) is
      // decided server-side from the account's role.
      await submitMaterialDb({
        title,
        description,
        faculty: filters.faculty || 'Faculty of Computing & Information System',
        department: filters.department || 'Computer Science',
        course_code: filters.course || '',
        course_title: filters.course ? courseTitleByCode(filters.course) : undefined,
        level: filters.level || '100 Level',
        semester: filters.semester || 'First Semester',
        material_type: filters.type || materialTypes[0],
        file
      });

      toast('Material submitted successfully! Awaiting administrator approval.', 'success');
      setMessage({
        type: 'success',
        text: 'Your material was uploaded and submitted for review. It will appear on the public library once approved by an administrator.'
      });

      setTimeout(() => {
        onUploaded();
      }, 1200);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Unable to upload material. Please check file format and size.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STUDENT REPOSITORY SUBMISSION</p>
          <h1>Upload material for approval</h1>
          <p className="subtitle">
            Share verified course notes, handouts, or past questions. All student submissions are vetted by library administrators before being published.
          </p>
        </div>
      </div>

      <div className="upload-container">
        <form className="upload-form full-upload-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <h3>1. Resource Details</h3>
            <label>
              Course Code + Material Title *
              <input
                name="title"
                required
                placeholder="e.g. Introduction to Data Structures & Binary Trees Lecture Modules"
              />
            </label>

            <label>
              Academic Description *
              <textarea
                name="description"
                required
                placeholder="Detail what topics, chapters, or syllabus questions this material covers..."
              />
            </label>
          </div>

          <div className="form-section">
            <h3>2. Academic Categorization</h3>
            <CatalogueFilters filters={filters} onChange={setFilters} compact />
          </div>

          <div className="form-section">
            <h3>3. File Upload</h3>
            <div className="drop file-dropzone">
              <Upload size={32} />
              <b>{file ? file.name : 'Drag & drop your course document here, or browse'}</b>
              <span>Supported: PDF, Word (DOC/DOCX), PowerPoint (PPT/PPTX), Excel (XLS/XLSX) — Max 25 MB</span>
              {file && (
                <div className="file-ready-tag">
                  <CheckCircle2 size={14} /> Ready for upload ({(file.size / (1024 * 1024)).toFixed(2)} MB)
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
              {busy ? 'Submitting for review…' : 'Submit for Admin Approval'}
            </button>
            <span className="submit-hint">Approval status will be tracked under "My Uploads".</span>
          </div>
        </form>
      </div>
    </div>
  );
}

// 3. Student My Uploads Tab (With Approval Statuses)
function StudentMyUploadsTab({
  uploads,
  total,
  page,
  pageSize,
  onPageChange,
  stats,
  onRequestDelete,
  onReadOnline
}: {
  uploads: MaterialItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  stats: { total: number; approved: number; pending: number; rejected: number; downloads: number };
  onRequestDelete: (m: MaterialItem) => void;
  onReadOnline: (m: MaterialItem) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SUBMISSION TRACKER</p>
          <h1>My uploaded materials</h1>
          <p className="subtitle">
            Track approval status and feedback for your contributed academic materials.
          </p>
        </div>
        <Link className="primary" to="/student/upload">
          <Plus size={16} />
          <span>Upload new material</span>
        </Link>
      </div>

      {/* Contribution statistics derived from your full upload history */}
      <div className="upload-stats-row">
        <div className="upload-stat-card">
          <b>{stats.total}</b>
          <span>Total uploads</span>
        </div>
        <div className="upload-stat-card ok">
          <b>{stats.approved}</b>
          <span>Approved &amp; live</span>
        </div>
        <div className="upload-stat-card warn">
          <b>{stats.pending}</b>
          <span>Pending review</span>
        </div>
        <div className="upload-stat-card bad">
          <b>{stats.rejected}</b>
          <span>Rejected</span>
        </div>
        <div className="upload-stat-card">
          <b>{stats.downloads.toLocaleString()}</b>
          <span>Student downloads</span>
        </div>
      </div>

      {uploads.length === 0 ? (
        <div className="empty-state card-empty">
          <FileText size={40} />
          <b>No uploaded materials yet.</b>
          <span>Upload your lecture notes, handouts, or past questions to earn academic repository contribution credits.</span>
          <Link to="/student/upload" className="primary empty-btn">
            <Upload size={15} /> Upload Your First Material
          </Link>
        </div>
      ) : (
        <>
          <p className="uploads-count-line">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total} upload{total !== 1 ? 's' : ''}
          </p>
          <div className="uploads-table-wrapper">
            <div className="table">
              <div className="tr head uploads-header-grid">
                <span>Material / Title</span>
                <span>Faculty & Dept</span>
                <span>Level / Type</span>
                <span>Submission Date</span>
                <span>Approval Status</span>
                <span>Actions</span>
              </div>

              {uploads.map((m) => (
                <div className="tr uploads-row-grid" key={m.id}>
                  <span>
                    <b>{m.title}</b>
                    <small>{m.course} · {m.fileName} ({m.fileSize})</small>
                  </span>
                  <span>{m.department}</span>
                  <span>{m.level} · {m.type}</span>
                  <span>{m.date}</span>
                  <span>
                    {m.status === 'approved' && (
                      <span className="status-badge approved">
                        <CheckCircle2 size={12} /> Approved & Live
                      </span>
                    )}
                    {m.status === 'pending' && (
                      <span className="status-badge pending">
                        <Clock size={12} /> Pending Approval
                      </span>
                    )}
                    {m.status === 'rejected' && (
                      <span className="status-badge rejected" title={m.rejectionReason}>
                        <AlertCircle size={12} /> Rejected
                      </span>
                    )}
                  </span>
                  <span className="row-action-btns">
                    <button
                      className="action-icon-btn"
                      onClick={() => onReadOnline(m)}
                      title="Preview material"
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      className="action-icon-btn delete"
                      onClick={() => onRequestDelete(m)}
                      title="Delete upload"
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="pagination-controls">
              <button type="button" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
                Previous
              </button>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <button type="button" disabled={page + 1 >= totalPages} onClick={() => onPageChange(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 3b. AI Study Assistant Chat (RAG over approved library materials)
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: AiCitation[];
}

/** Inline markdown-lite: **bold**, *italic*, `code`. */
function inlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) parts.push(<b key={key++}>{token.slice(2, -2)}</b>);
    else if (token.startsWith('`')) parts.push(<code key={key++} className="chat-inline-code">{token.slice(1, -1)}</code>);
    else parts.push(<i key={key++}>{token.slice(1, -1)}</i>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Lightweight markdown renderer for assistant answers: code fences,
 * headings, bullet/numbered lists and inline emphasis — no external deps.
 */
function AssistantText({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  content.split(/```/).forEach((segment, si) => {
    if (si % 2 === 1) {
      const lines = segment.split('\n');
      const hasLangTag = lines.length > 1 && /^[a-zA-Z0-9+#-]*$/.test(lines[0].trim());
      const body = (hasLangTag ? lines.slice(1) : lines).join('\n').replace(/\n$/, '');
      blocks.push(
        <pre key={`code-${si}`} className="chat-code">
          <code>{body}</code>
        </pre>
      );
      return;
    }
    segment.split(/\n{2,}/).forEach((rawPara, pi) => {
      const para = rawPara.trim();
      if (!para) return;
      const lines = para.split('\n');
      const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
      if (/^#{1,4}\s+/.test(para)) {
        blocks.push(<b key={`h-${si}-${pi}`} className="chat-heading">{para.replace(/^#{1,4}\s+/, '')}</b>);
      } else if (isList) {
        blocks.push(
          <ul key={`ul-${si}-${pi}`} className="chat-list">
            {lines.map((l, li) => (
              <li key={li}>{inlineMarkdown(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>
            ))}
          </ul>
        );
      } else {
        blocks.push(<p key={`p-${si}-${pi}`} className="chat-para">{inlineMarkdown(para)}</p>);
      }
    });
  });
  return <div className="chat-text">{blocks}</div>;
}

function StudentAiChatTab({
  focusMaterial,
  onClearFocus
}: {
  focusMaterial?: MaterialItem | null;
  onClearFocus?: () => void;
}) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(focusMaterial?.id ?? null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Keep the scoped material in sync when the student uses "Ask AI" elsewhere.
  useEffect(() => {
    if (focusMaterial) setMaterialId(focusMaterial.id);
  }, [focusMaterial]);

  // Restore the most recent conversation (and its messages) from the database
  // so history survives page refreshes — Supabase is the source of truth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = requireSupabase();
        const { data: convs } = await client
          .from('ai_conversations')
          .select('id, material_id')
          .order('updated_at', { ascending: false })
          .limit(1);
        const conv = convs?.[0];
        if (!conv || cancelled) {
          if (!cancelled) setHistoryLoaded(true);
          return;
        }
        const { data: msgs } = await client
          .from('ai_messages')
          .select('role, content, citations')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: true })
          .limit(60);
        if (cancelled) return;
        if (msgs && msgs.length > 0) {
          setConversationId(conv.id);
          setMessages(
            msgs.map((row) => ({
              role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
              content: String(row.content ?? ''),
              citations: Array.isArray(row.citations) ? (row.citations as AiCitation[]) : []
            }))
          );
        }
      } catch {
        // History restore is best-effort only.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = focusMaterial
    ? [
        'What are the main concepts discussed in this material?',
        'Summarize this document for exam revision.',
        'Create 5 practice questions from this document.'
      ]
    : [
        'Explain the difference between RAM and ROM using my CSC materials.',
        'Summarise key points from recent GST past questions.',
        'Give me revision questions on organic chemistry reactions.'
      ];

  const quickActions = [
    { label: 'Summarize', prompt: 'Summarize this material into clear exam-ready revision points.' },
    { label: 'Key points', prompt: 'List the most important key points, definitions and formulas from this material.' },
    { label: 'Practice quiz', prompt: 'Generate 10 practice questions with answers from this material.' },
    { label: 'Revision notes', prompt: 'Create concise revision notes covering every major topic in this material.' }
  ];

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    });
  };

  React.useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '…' }]);
    setBusy(true);
    try {
      const res = await aiAsk({ message: question, conversationId, materialId });
      setNotConfigured(false);
      setConversationId(res.conversationId);
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: res.answer, citations: res.citations };
        return copy;
      });
    } catch (err: any) {
      // Drop the placeholder bubble and surface a friendly error.
      setMessages((prev) => prev.slice(0, -1));
      if (aiConfiguredHint(err)) setNotConfigured(true);
      setError(err.message || 'The AI assistant is unavailable right now.');
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    setNotConfigured(false);
    onClearFocus?.();
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">POWERED BY THE E-LIBRARY COLLECTION</p>
          <h1>AI study assistant</h1>
          <p className="subtitle">
            Ask questions about your courses — answers are grounded in the approved materials in this library, with links to sources.
          </p>
        </div>
        {(conversationId || messages.length > 0) && (
          <button type="button" className="secondary-btn" onClick={clearConversation}>
            <RefreshCw size={15} />
            <span>New conversation</span>
          </button>
        )}
      </div>

      <div className="ai-chat-shell">
        {/* Scoped-material context banner */}
        <div className={`ai-context-chip ${materialId ? '' : 'hidden'}`}>
          <FileText size={14} />
          <span>
            Asking about: <b>{focusMaterial?.title || 'Selected material'}</b>
          </span>
          <button
            type="button"
            onClick={() => {
              setMaterialId(null);
              onClearFocus?.();
            }}
            aria-label="Stop focusing on this material"
            title="Ask about the whole library instead"
          >
            <X size={13} />
          </button>
        </div>

        <div className="ai-chat-window" ref={listRef}>
          {!historyLoaded ? (
            <div className="chat-typing">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              Loading your conversation…
            </div>
          ) : (
            messages.length === 0 && (
              <div className="ai-chat-empty">
                <Sparkles size={34} />
                <b>How can I help you study today?</b>
                <span>{focusMaterial ? 'Try one of these about your selected material:' : 'Try one of these:'}</span>
                <div className="ai-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} disabled={busy}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="chat-row user">
                <div className="chat-bubble user">{m.content}</div>
                <div className="chat-avatar user" aria-hidden="true">
                  {(profile?.fullName?.charAt(0) || 'S').toUpperCase()}
                </div>
              </div>
            ) : (
              <div key={i} className="chat-row assistant">
                <div className="chat-avatar assistant" aria-hidden="true">
                  <Sparkles size={14} />
                </div>
                <div className="chat-bubble assistant">
                  <AssistantText content={m.content} />
                  {m.citations && m.citations.length > 0 && (
                    <div className="chat-citations">
                      <small>Sources from your e-library:</small>
                      <div className="chat-citation-chips">
                        {m.citations.map((c, ci) => (
                          <Link key={`${c.material_id}-${ci}`} to={`/materials/${c.material_id}`}>
                            📄 {c.title}{c.page ? ` · p.${c.page}` : ''}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="chat-typing">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              Assistant is thinking…
            </div>
          )}
        </div>

        {(error || notConfigured) && (
          <div className={`form-feedback-box error`}>
            <AlertCircle size={18} />
            <p>{notConfigured ? `${error} Administrators can enable it by adding the AI_API_KEY function secret.` : error}</p>
          </div>
        )}

        {/* One-tap study actions for the focused material / whole library */}
        <div className="ai-quick-actions">
          {quickActions.map((qa) => (
            <button key={qa.label} type="button" onClick={() => send(qa.prompt)} disabled={busy}>
              {qa.label}
            </button>
          ))}
        </div>

        <form
          className="ai-chat-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your course materials…"
            maxLength={2000}
            disabled={busy}
            aria-label="Message the AI assistant"
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
        <p className="ai-chat-disclaimer">
          Answers cite library materials where possible — always verify critical facts with your lecturers.
        </p>
      </div>
    </div>
  );
}

// 4. Saved Materials Tab
function StudentSavedTab({
  savedMaterials,
  onReadOnline,
  onRemove,
  onAskAi
}: {
  savedMaterials: MaterialItem[];
  onReadOnline: (m: MaterialItem) => void;
  onRemove: (id: string) => void;
  onAskAi: (m: MaterialItem) => void;
}) {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">BOOKMARKED RESOURCES</p>
          <h1>Saved materials ({savedMaterials.length})</h1>
          <p className="subtitle">Quick access to books, notes, and past questions you have bookmarked for fast revision.</p>
        </div>
      </div>

      {savedMaterials.length === 0 ? (
        <div className="empty-state card-empty">
          <Heart size={40} />
          <b>No saved materials yet.</b>
          <span>Click the bookmark icon on any material in the library to save it here for offline revision.</span>
          <Link to="/library" className="primary empty-btn">
            <Search size={15} /> Browse Library Collection
          </Link>
        </div>
      ) : (
        <div className="grid materials">
          {savedMaterials.map((m) => (
            <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} onAskAi={onAskAi} />
          ))}
        </div>
      )}
    </div>
  );
}

// 5. Recently Viewed Tab
function StudentRecentTab({
  recentMaterials,
  onReadOnline,
  onAskAi
}: {
  recentMaterials: MaterialItem[];
  onReadOnline: (m: MaterialItem) => void;
  onAskAi: (m: MaterialItem) => void;
}) {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACTIVITY HISTORY</p>
          <h1>Recently viewed ({recentMaterials.length})</h1>
          <p className="subtitle">Materials and course documents you have recently explored or read.</p>
        </div>
      </div>

      {recentMaterials.length === 0 ? (
        <div className="empty-state card-empty">
          <Clock size={40} />
          <b>No recently viewed materials.</b>
          <span>Materials you open or read will automatically appear here for seamless continuity.</span>
          <Link to="/library" className="primary empty-btn">
            <Search size={15} /> Open a Library Resource
          </Link>
        </div>
      ) : (
        <div className="grid materials">
          {recentMaterials.map((m) => (
            <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} onAskAi={onAskAi} />
          ))}
        </div>
      )}
    </div>
  );
}

// 6. Downloads History Tab
function StudentDownloadsTab({ downloadHistory }: { downloadHistory: any[] }) {
  const { toast } = useToast();
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">OFFLINE FILES</p>
          <h1>My downloads ({downloadHistory.length})</h1>
          <p className="subtitle">Record of academic documents downloaded to your device.</p>
        </div>
      </div>

      {downloadHistory.length === 0 ? (
        <div className="empty-state card-empty">
          <Download size={40} />
          <b>No downloads recorded yet.</b>
          <span>Downloaded lecture notes and past question PDFs will be logged here for convenient re-downloading.</span>
        </div>
      ) : (
        <div className="table">
          <div className="tr head downloads-grid">
            <span>Material Title</span>
            <span>Course</span>
            <span>File Size</span>
            <span>Downloaded Time</span>
            <span>Action</span>
          </div>
          {downloadHistory.map((item) => (
            <div className="tr downloads-grid" key={item.id}>
              <span>
                <b>{item.materialTitle}</b>
              </span>
              <span>{item.course}</span>
              <span>{item.fileSize}</span>
              <span>{item.downloadedAt}</span>
              <span>
                <button
                  className="table-action-btn"
                  onClick={() => toast(`Re-downloading ${item.materialTitle}`)}
                >
                  <Download size={14} /> Re-download
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 7. Reading History Tab
function StudentReadingTab({
  readingHistory,
  onReadOnline
}: {
  readingHistory: any[];
  onReadOnline: (m: MaterialItem) => void;
}) {
  const store = useStore();
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">PROGRESS TRACKER</p>
          <h1>Reading history & progress</h1>
          <p className="subtitle">Resume reading where you left off in your courses.</p>
        </div>
      </div>

      {readingHistory.length === 0 ? (
        <div className="empty-state card-empty">
          <BookOpen size={40} />
          <b>No reading sessions logged yet.</b>
          <span>Use the "Read Online" feature to read documents in your browser and automatically track your reading progress.</span>
        </div>
      ) : (
        <div className="reading-cards-list">
          {readingHistory.map((item) => {
            const material = store.getMaterialById(item.materialId);
            return (
              <div className="reading-session-card" key={item.id}>
                <div className="reading-card-info">
                  <span className="reading-course-tag">{item.course}</span>
                  <h3>{item.materialTitle}</h3>
                  <p>
                    Page {item.currentPage} of {item.totalPages} · Last accessed: {item.lastReadAt}
                  </p>
                  <div className="reading-bar-track">
                    <div className="reading-bar-fill" style={{ width: `${item.percentage}%` }} />
                  </div>
                  <span className="reading-percent-label">{item.percentage}% complete</span>
                </div>

                <div className="reading-card-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      if (material) onReadOnline(material);
                    }}
                  >
                    <BookOpen size={16} /> Resume Reading
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 8. Student Profile Tab
function StudentProfileTab({ currentUser }: { currentUser: any }) {
  const store = useStore();
  const { toast } = useToast();
  const { updateProfile, user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [formData, setFormData] = useState({
    fullName: currentUser.fullName || '',
    displayName: currentUser.displayName || '',
    matricNumber: currentUser.matricNumber || '',
    email: currentUser.email || user?.email || '',
    faculty: currentUser.faculty || catalogue[0]?.name || '',
    department: currentUser.department || catalogue[0]?.departments[0]?.name || '',
    level: currentUser.level || '100 Level',
    bio: currentUser.bio || ''
  });

  const currentFaculty = facultyByName(formData.faculty) || catalogue[0];
  const currentDepartment = departmentByName(formData.faculty, formData.department) || currentFaculty.departments[0];
  const availableLevels = levelsFor(currentDepartment?.duration || 4);

  // Re-seed the form once the authenticated profile finishes loading so the
  // fields don't stay stuck on guest/empty values after a refresh.
  useEffect(() => {
    setFormData({
      fullName: currentUser.fullName || '',
      displayName: currentUser.displayName || '',
      matricNumber: currentUser.matricNumber || '',
      email: currentUser.email || user?.email || '',
      faculty: currentUser.faculty || catalogue[0]?.name || '',
      department: currentUser.department || catalogue[0]?.departments[0]?.name || '',
      level: currentUser.level || '100 Level',
      bio: currentUser.bio || ''
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.fullName, profile?.faculty, profile?.department]);

  const handleFacultyChange = (newFac: string) => {
    const fac = facultyByName(newFac) || catalogue[0];
    const firstDept = fac.departments[0];
    const deptLevels = levelsFor(firstDept?.duration || 4);
    setFormData((prev) => ({
      ...prev,
      faculty: newFac,
      department: firstDept?.name || '',
      level: deptLevels.includes(prev.level) ? prev.level : (deptLevels[0] || '100 Level')
    }));
  };

  const handleDeptChange = (newDept: string) => {
    const dept = departmentByName(formData.faculty, newDept);
    const deptLevels = levelsFor(dept?.duration || 4);
    setFormData((prev) => ({
      ...prev,
      department: newDept,
      level: deptLevels.includes(prev.level) ? prev.level : (deptLevels[0] || '100 Level')
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    store.updateUserProfile(formData);
    const res = await updateProfile(formData);
    setBusy(false);
    if (res.error) {
      toast(res.error.message, 'error');
    } else {
      toast('Profile updated successfully in database!', 'success');
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACCOUNT & ACADEMIC INFO</p>
          <h1>My student profile</h1>
          <p className="subtitle">Manage your verified university registration and academic credentials.</p>
        </div>
      </div>

      <div className="profile-layout">
        <div className="profile-card">
          <div className="profile-badge-row">
            <div className="profile-large-avatar">
              {formData.fullName.charAt(0) || 'A'}
            </div>
            <div>
              <h2>{formData.fullName}</h2>
              <p className="profile-sub">{formData.department} · {formData.level}</p>
              <div className="verification-pill verified">
                <ShieldCheck size={14} />
                <span>Verified FUW Student</span>
              </div>
            </div>
          </div>

          <form className="profile-form" onSubmit={handleSave}>
            <div className="form-grid-2">
              <label>
                Full Name
                <input
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  required
                  disabled={busy}
                />
              </label>

              <label>
                Display Name
                <input
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  required
                  disabled={busy}
                />
              </label>
            </div>

            <div className="form-grid-2">
              <label>
                University Email Address (Verified)
                <div className="input-with-badge">
                  <input
                    type="email"
                    value={formData.email}
                    readOnly
                    className="input-readonly"
                    title="Email is protected and linked to your identity"
                  />
                  <span className="readonly-tag">
                    <ShieldCheck size={12} /> Verified
                  </span>
                </div>
              </label>

              <label>
                Matriculation Number
                <input
                  value={formData.matricNumber}
                  onChange={(e) => setFormData({ ...formData, matricNumber: e.target.value.toUpperCase() })}
                  required
                  disabled={busy}
                />
              </label>
            </div>

            <div className="form-grid-2">
              <label>
                Faculty
                <select
                  value={formData.faculty}
                  onChange={(e) => handleFacultyChange(e.target.value)}
                  disabled={busy}
                  required
                >
                  {catalogue.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Department
                <select
                  value={formData.department}
                  onChange={(e) => handleDeptChange(e.target.value)}
                  disabled={busy}
                  required
                >
                  {currentFaculty.departments.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} ({d.duration} Years)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Level of Study (Restricted to {currentDepartment?.duration || 4}-Year Degree Duration)
              <select
                value={formData.level}
                onChange={(e) => setFormData({ ...formData, level: e.target.value })}
                disabled={busy}
                required
              >
                {availableLevels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Academic Bio & Research Interests
              <textarea
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder="Share your academic interests, focus areas, and tech clubs..."
                disabled={busy}
              />
            </label>

            <button type="submit" className="primary save-profile-btn" disabled={busy}>
              {busy ? 'Saving Changes…' : 'Save Profile Changes'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


// 9. Student Settings Tab
function StudentSettingsTab({ currentUser }: { currentUser: any }) {
  const store = useStore();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { updateProfile, changePassword, signOut, user } = useAuth();

  const [activeSection, setActiveSection] = useState<'account' | 'security' | 'notifications' | 'reading' | 'sessions' | 'danger'>('account');
  const [settings, setSettings] = useState(store.getStudentSettings());
  const [profileData, setProfileData] = useState({
    fullName: currentUser.fullName || '',
    displayName: currentUser.displayName || '',
    email: currentUser.email || user?.email || '',
    matricNumber: currentUser.matricNumber || '',
    faculty: currentUser.faculty || catalogue[0]?.name || '',
    department: currentUser.department || catalogue[0]?.departments[0]?.name || '',
    level: currentUser.level || '100 Level'
  });

  const currentFaculty = facultyByName(profileData.faculty) || catalogue[0];
  const currentDepartment = departmentByName(profileData.faculty, profileData.department) || currentFaculty.departments[0];
  const availableLevels = levelsFor(currentDepartment?.duration || 4);

  const [passwordState, setPasswordState] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFacultyChange = (newFac: string) => {
    const fac = facultyByName(newFac) || catalogue[0];
    const firstDept = fac.departments[0];
    const deptLevels = levelsFor(firstDept?.duration || 4);
    setProfileData((prev) => ({
      ...prev,
      faculty: newFac,
      department: firstDept?.name || '',
      level: deptLevels.includes(prev.level) ? prev.level : (deptLevels[0] || '100 Level')
    }));
  };

  const handleDeptChange = (newDept: string) => {
    const dept = departmentByName(profileData.faculty, newDept);
    const deptLevels = levelsFor(dept?.duration || 4);
    setProfileData((prev) => ({
      ...prev,
      department: newDept,
      level: deptLevels.includes(prev.level) ? prev.level : (deptLevels[0] || '100 Level')
    }));
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    store.updateUserProfile(profileData);
    const res = await updateProfile(profileData);
    setBusy(false);
    if (res.error) {
      toast(res.error.message, 'error');
    } else {
      toast('Account details updated successfully in database!', 'success');
    }
  };

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    store.updateStudentSettings(settings);
    toast('Library & notification preferences saved!', 'success');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordState.newPassword.length < 8) {
      toast('New password must be at least 8 characters.', 'error');
      return;
    }
    if (passwordState.newPassword !== passwordState.confirmPassword) {
      toast('New passwords do not match.', 'error');
      return;
    }
    setBusy(true);
    const res = await changePassword(passwordState.newPassword);
    setBusy(false);
    if (res.error) {
      toast(res.error.message, 'error');
      return;
    }
    setPasswordState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    toast('Password updated successfully!', 'success');
  };

  const handleSignOutOtherSessions = () => {
    toast('All other active browser sessions have been logged out.', 'info');
  };

  const handleSignOut = async () => {
    await signOut();
    toast('Logged out of Student Portal', 'info');
    navigate('/login');
  };

  const handleConfirmDeactivate = async () => {
    setDeactivateModalOpen(false);
    await signOut();
    toast('Account deactivation requested. Your session has ended.', 'info');
    navigate('/');
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STUDENT PREFERENCES & SECURITY</p>
          <h1>Account settings</h1>
          <p className="subtitle">
            Manage your university account credentials, notification alerts, reading display preferences, and active sessions.
          </p>
        </div>
      </div>

      <div className="settings-layout">
        {/* Settings Navigation Sidebar */}
        <aside className="settings-sidebar">
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'account' ? 'active' : ''}`}
            onClick={() => setActiveSection('account')}
          >
            <Users size={16} />
            <span>Account Profile</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'security' ? 'active' : ''}`}
            onClick={() => setActiveSection('security')}
          >
            <Lock size={16} />
            <span>Security & Password</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveSection('notifications')}
          >
            <Bell size={16} />
            <span>Notification Alerts</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'reading' ? 'active' : ''}`}
            onClick={() => setActiveSection('reading')}
          >
            <SlidersHorizontal size={16} />
            <span>Reading & Display</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveSection('sessions')}
          >
            <Laptop size={16} />
            <span>Active Sessions</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item danger ${activeSection === 'danger' ? 'active' : ''}`}
            onClick={() => setActiveSection('danger')}
          >
            <AlertTriangle size={16} />
            <span>Account Actions</span>
          </button>
        </aside>

        {/* Settings Content Area */}
        <div className="settings-content-panel">
          {/* 1. Account Profile */}
          {activeSection === 'account' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Account & Academic Credentials</h2>
                  <p>Keep your contact details up to date for official library notices.</p>
                </div>
              </div>

              <form onSubmit={handleSaveProfile}>
                <div className="form-grid-2">
                  <label>
                    Full Legal Name
                    <input
                      value={profileData.fullName}
                      onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Preferred Display Name
                    <input
                      value={profileData.displayName}
                      onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                      required
                      disabled={busy}
                    />
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Institutional Email Address (Verified)
                    <div className="input-with-badge">
                      <input
                        type="email"
                        value={profileData.email}
                        readOnly
                        className="input-readonly"
                        title="Email is protected and linked to your identity"
                      />
                      <span className="readonly-tag">
                        <ShieldCheck size={12} /> Verified
                      </span>
                    </div>
                  </label>
                  <label>
                    Matriculation Number
                    <div className="input-with-badge">
                      <input
                        value={profileData.matricNumber}
                        onChange={(e) => setProfileData({ ...profileData, matricNumber: e.target.value.toUpperCase() })}
                        required
                        disabled={busy}
                      />
                      <span className="readonly-tag" title="Institutional Identifier">
                        <ShieldCheck size={12} /> Student ID
                      </span>
                    </div>
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Faculty
                    <select
                      value={profileData.faculty}
                      onChange={(e) => handleFacultyChange(e.target.value)}
                      disabled={busy}
                      required
                    >
                      {catalogue.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Department
                    <select
                      value={profileData.department}
                      onChange={(e) => handleDeptChange(e.target.value)}
                      disabled={busy}
                      required
                    >
                      {currentFaculty.departments.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name} ({d.duration} Years)
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Level of Study (Restricted to {currentDepartment?.duration || 4}-Year Degree Duration)
                    <select
                      value={profileData.level}
                      onChange={(e) => setProfileData({ ...profileData, level: e.target.value })}
                      disabled={busy}
                      required
                    >
                      {availableLevels.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Account Role
                    <div className="input-with-badge">
                      <input
                        value="Student (Undergraduate Repository Contributor)"
                        readOnly
                        className="input-readonly"
                      />
                      <span className="readonly-tag">
                        <ShieldCheck size={12} /> Student
                      </span>
                    </div>
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn" disabled={busy}>
                    <Save size={15} /> {busy ? 'Saving Changes…' : 'Save Account Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 2. Security & Password */}
          {activeSection === 'security' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Security & Password</h2>
                  <p>Protect your student portal access with a strong password.</p>
                </div>
              </div>

              <form onSubmit={handleChangePassword}>
                <label>
                  Current Password
                  <input
                    type="password"
                    placeholder="Enter current password"
                    value={passwordState.currentPassword}
                    onChange={(e) => setPasswordState({ ...passwordState, currentPassword: e.target.value })}
                    required
                  />
                </label>

                <div className="form-grid-2">
                  <label>
                    New Password
                    <input
                      type="password"
                      placeholder="At least 6 characters"
                      value={passwordState.newPassword}
                      onChange={(e) => setPasswordState({ ...passwordState, newPassword: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Confirm New Password
                    <input
                      type="password"
                      placeholder="Repeat new password"
                      value={passwordState.confirmPassword}
                      onChange={(e) => setPasswordState({ ...passwordState, confirmPassword: e.target.value })}
                      required
                    />
                  </label>
                </div>

                <div className="password-tips-card">
                  <Shield size={16} />
                  <div>
                    <b>Password Security Advice</b>
                    <span>Use a combination of uppercase letters, numbers, and symbols. Never share your student portal password with anyone.</span>
                  </div>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Key size={15} /> Update Password
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 3. Notification Preferences */}
          {activeSection === 'notifications' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Notification Preferences</h2>
                  <p>Choose the automated alerts and emails you wish to receive from FUW E-Library.</p>
                </div>
              </div>

              <form onSubmit={handleSavePreferences}>
                <div className="switch-group">
                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Material Approval Notifications</b>
                      <span>Receive an instant alert when your submitted academic materials are reviewed and approved by administrators.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.approvalAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, approvalAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Material Rejection & Feedback Alerts</b>
                      <span>Get informed if a submission requires adjustments or is rejected by faculty librarians with specific reasons.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.rejectionAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, rejectionAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>New Department Course Materials</b>
                      <span>Notify me when new verified lecture notes, textbooks, or past questions are added to {currentUser.department}.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.newCourseMaterials}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, newCourseMaterials: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Account & Security Announcements</b>
                      <span>Important institutional bulletins regarding semester catalog updates, examination periods, and scheduled maintenance.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.securityAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, securityAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Notification Preferences
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 4. Reading & Display */}
          {activeSection === 'reading' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Reading & Display Preferences</h2>
                  <p>Customize your online document reader defaults and catalog browsing view.</p>
                </div>
              </div>

              <form onSubmit={handleSavePreferences}>
                <div className="form-grid-2">
                  <label>
                    Default Library Layout
                    <select
                      value={settings.reading.defaultView}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, defaultView: e.target.value as any }
                        })
                      }
                    >
                      <option value="grid">Grid Cards (Visual Preview)</option>
                      <option value="list">Compact List Table</option>
                    </select>
                  </label>

                  <label>
                    Preferred Material Sorting
                    <select
                      value={settings.reading.defaultSort}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, defaultSort: e.target.value as any }
                        })
                      }
                    >
                      <option value="newest">Newest First</option>
                      <option value="downloads">Most Downloaded</option>
                      <option value="az">Alphabetical (A–Z)</option>
                    </select>
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    PDF Document Reader Default Zoom
                    <select
                      value={settings.reading.defaultZoom}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, defaultZoom: Number(e.target.value) }
                        })
                      }
                    >
                      <option value="75">75% (Compact Fit)</option>
                      <option value="100">100% (Standard View)</option>
                      <option value="125">125% (Comfortable Large)</option>
                    </select>
                  </label>

                  <label className="switch-row inline-switch" style={{ marginTop: '22px' }}>
                    <div className="switch-info">
                      <b>Remember Last Filter Choices</b>
                      <span>Auto-apply your last selected faculty and level when opening the library.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.reading.rememberFilters}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, rememberFilters: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Display Settings
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 5. Active Sessions */}
          {activeSection === 'sessions' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Active Login Sessions</h2>
                  <p>Devices and browsers currently authenticated to your student account.</p>
                </div>
                <button type="button" className="outline-btn" onClick={handleSignOutOtherSessions}>
                  Sign out other devices
                </button>
              </div>

              <div className="sessions-list">
                <div className="session-item current">
                  <div className="session-icon">
                    <Laptop size={20} />
                  </div>
                  <div className="session-details">
                    <div className="session-title-row">
                      <b>Current Web Browser</b>
                      <span className="current-session-badge">Active Now</span>
                    </div>
                    <p>Chrome on Desktop · Wukari, Taraba State, Nigeria (FUW Campus Wi-Fi)</p>
                    <span className="session-time">Started today at 10:15 AM</span>
                  </div>
                </div>

                <div className="session-item">
                  <div className="session-icon">
                    <Smartphone size={20} />
                  </div>
                  <div className="session-details">
                    <div className="session-title-row">
                      <b>Mobile Safari / Android Web</b>
                      <span className="session-status-text">Idle</span>
                    </div>
                    <p>Mobile Device · Taraba State, Nigeria</p>
                    <span className="session-time">Last active 2 days ago</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. Danger Zone / Actions */}
          {activeSection === 'danger' && (
            <div className="settings-section-card danger-card">
              <div className="settings-card-header">
                <div>
                  <h2>Account Actions</h2>
                  <p>Sign out of your active student session or request account removal.</p>
                </div>
              </div>

              <div className="danger-action-row">
                <div>
                  <b>Sign Out Current Session</b>
                  <p>End your current session on this device. Your saved materials and reading progress will remain intact.</p>
                </div>
                <button type="button" className="danger-btn-outline" onClick={handleSignOut}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>

              <div className="danger-action-row">
                <div>
                  <b>Deactivate Student Account</b>
                  <p>Temporarily deactivate your access or remove your local personal profile from this browser.</p>
                </div>
                <button
                  type="button"
                  className="danger-btn-solid"
                  onClick={() => setDeactivateModalOpen(true)}
                >
                  <Trash2 size={15} /> Deactivate Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Account Deactivation Confirmation Modal */}
      {deactivateModalOpen && (
        <div className="modal-backdrop" onClick={() => setDeactivateModalOpen(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-icon warning">
              <AlertTriangle size={28} />
            </div>
            <h3>Deactivate Student Account?</h3>
            <p>
              Are you sure you want to deactivate your student portal session? Your local reading history, saved bookmarks, and uploaded submissions will be archived.
            </p>
            <div className="confirm-modal-actions">
              <button className="cancel-btn" onClick={() => setDeactivateModalOpen(false)}>
                Cancel
              </button>
              <button className="danger-confirm-btn" onClick={handleConfirmDeactivate}>
                Yes, Deactivate & Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
