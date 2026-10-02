import React, { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate, Routes, Route } from 'react-router-dom';
import {
  LayoutDashboard,
  Home,
  Upload,
  FileText,
  Heart,
  Clock,
  Download,
  BookOpen,
  Bookmark,
  Users,
  Settings,
  LogOut,
  ChevronRight,
  Search,
  Loader2,
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
  Check,
  GraduationCap,
  List,
  ArrowLeft,
  Pencil,
  MessageSquare,
  Send,
  FileWarning,
  UserCog,
  BadgeCheck,
  Crown,
  Wifi,
  Monitor,
  Bot,
  Copy,
  CornerDownLeft,
  CalendarRange,
  StickyNote,
  HelpCircle,
  Smartphone as SmartphoneIcon
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem, getTimeGreeting, getUserTimeZone, formatUserTime } from '../lib/store';
import { Logo } from '../components/Logo';
import { MaterialCard } from '../components/MaterialCard';
import { SuggestedMaterialsSection } from '../components/SuggestedMaterialsSection';
import { TrendingMaterialsSection } from '../components/TrendingMaterialsSection';
import { StudyInsightsPanel } from '../components/StudyInsightsPanel';
import { StudyPlannerTab } from '../components/StudyPlannerTab';
import { StudentNotesTab } from '../components/StudentNotesTab';
import { ReadingListsTab, ReadingListDetailTab } from '../components/ReadingListsTabs';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { MultiDepartmentPicker, MultiDepartmentState, EMPTY_MULTI_DEPARTMENT } from '../components/MultiDepartmentPicker';
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
import { friendlyError } from '../lib/friendlyError';
import { requireSupabase } from '../lib/supabase';
import { ConfirmDialog, ConfirmDialogState } from '../components/ConfirmDialog';
import ProtectedActionModal from '../components/ProtectedActionModal';
import { AuthenticatorAppCard } from '../components/AuthenticatorAppCard';
import { PasskeysManager } from '../components/PasskeysManager';
import { ProfileSetupBanner } from '../components/ProfileSetupBanner';
import { VerificationReminderBanner } from '../components/VerificationReminderBanner';
import { StudentVerificationTab } from '../pages/StudentVerificationTab';
import { StudentSubscriptionTab } from '../pages/StudentSubscriptionTab';
import { useAuth } from '../lib/AuthContext';
import { MessageComposer } from '../components/MessageComposer';
import { MessageText } from '../components/MessageText';
import { messagePreview, richPasteText, capLength } from '../lib/messageFormat';
import { useToast } from '../components/Toast';
import type { StudentCourse } from '../lib/studentCourses';
import { submitDeletionRequest, fetchMyDeletionRequests, DeletionRequest } from '../lib/deletionRequests';
import { fetchMyStudentCourses } from '../lib/studentCourses';
import { fetchConversations, fetchMessages, sendMessage, markConversationRead, startConversation, getOrCreateDirectConversation, searchStudents, Conversation, Message, StudentSearchResult } from '../lib/messages';
import { submitProfileChangeRequest, fetchMyChangeRequests, ProfileChangeRequest } from '../lib/profileChangeRequests';
import { fetchMySessions, terminateSession, terminateAllOtherSessions, detectConnection, ActiveSession } from '../lib/sessions';
import { fetchAcademicSessions, AcademicSession } from '../lib/academicSessions';
import { analyticsTracker } from '../lib/analyticsTracker';
import { fx, staggerDelay } from '../lib/motion';
import { AnimatedModal } from '../components/animations/AnimatedModal';


interface StudentPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

const studentNavItems = [
  { label: 'Home', path: '/home', icon: Home, exact: true },
  { label: 'Dashboard', path: '/student', icon: LayoutDashboard, exact: true },
  { label: 'Upload material', path: '/student/upload', icon: Upload },
  { label: 'My uploads', path: '/student/uploads', icon: FileText },
  { label: 'Upload Course Code & Title', path: '/student/course-upload', icon: GraduationCap },
  { label: 'My courses', path: '/student/courses', icon: List },
  { label: 'Study planner', path: '/student/planner', icon: CalendarRange },
  { label: 'My notes', path: '/student/notes', icon: StickyNote },
  { label: 'AI study assistant', path: '/student/assistant', icon: Sparkles },
  { label: 'Reading lists', path: '/student/reading-lists', icon: Bookmark },
  { label: 'Saved materials', path: '/student/saved', icon: Heart },
  { label: 'Recently viewed', path: '/student/recent', icon: Clock },
  { label: 'Downloads', path: '/student/downloads', icon: Download },
  { label: 'Reading history', path: '/student/reading', icon: BookOpen },
  { label: 'Messages', path: '/student/messages', icon: MessageSquare },
  { label: 'Academic verification', path: '/student/verification', icon: BadgeCheck },
  { label: 'Premium access', path: '/student/subscription', icon: Crown },
  { label: 'Request deletion', path: '/student/request-deletion', icon: FileWarning },
  { label: 'Profile change requests', path: '/student/change-requests', icon: UserCog },
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
  const [notifFilter, setNotifFilter] = useState('');
  // Server-side paginated + searched "My Uploads"
  const [uploadsPage, setUploadsPage] = useState(0);
  const [pagedUploads, setPagedUploads] = useState<MaterialItem[]>([]);
  const [uploadsTotal, setUploadsTotal] = useState(0);
  const [uploadsVersion, setUploadsVersion] = useState(0);
  const [uploadsSearch, setUploadsSearch] = useState('');
  const [uploadsLoading, setUploadsLoading] = useState(true);
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
    isVerified: profile?.isVerified === true,
    verificationStatus: (profile?.verificationStatus ?? 'unsubmitted').toUpperCase() as
      | 'UNSUBMITTED'
      | 'PENDING'
      | 'VERIFIED'
      | 'REJECTED',
    joinedDate: profile?.joinedDate || storeUser.joinedDate || '2026'
  };
  const approvedMaterials = store.getApprovedMaterialsForDepartment(currentUser.department);
  const studentUploads = store.getStudentUploads(currentUser.id);
  const savedMaterials = store.getSavedMaterials();
  const recentMaterials = store.getRecentMaterials();
  const downloadHistory = store.getDownloadHistory();
  const readingHistory = store.getReadingHistory();

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const visibleNotifications = notifications.filter((n) => {
    if (!notifFilter.trim()) return true;
    const q = notifFilter.trim().toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      (n.body || '').toLowerCase().includes(q)
    );
  });

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

  // Pull server-side bookmarks into local state so saves made on other devices
  // (web or mobile) are visible here. Best-effort and idempotent.
  useEffect(() => {
    if (!user?.id) return;
    void store.pullBookmarksFromDb();
  }, [user?.id, store]);

  // Server-paginated + searched uploads listing (keeps performance stable as
  // history grows). The search term is debounced before hitting Supabase.
  useEffect(() => {
    setUploadsPage(0);
  }, [uploadsVersion]);

  useEffect(() => {
    if (!currentUser.id) return;
    let cancelled = false;
    const trimmedSearch = uploadsSearch.trim();
    const timer = window.setTimeout(() => {
      setUploadsLoading(true);
      fetchMyMaterials(currentUser.id, uploadsPage, UPLOADS_PAGE_SIZE, trimmedSearch || undefined)
        .then((res) => {
          if (cancelled) return;
          setPagedUploads(res.items);
          setUploadsTotal(res.total);
          setUploadsLoading(false);
          if (res.items.length === 0 && res.total > 0 && uploadsPage > 0) {
            // Page shrank below our cursor (e.g. after deletion) — step back.
            setUploadsPage(Math.max(0, Math.ceil(res.total / UPLOADS_PAGE_SIZE) - 1));
          }
        })
        .catch(() => {
          if (!cancelled) setUploadsLoading(false);
        });
    }, trimmedSearch === uploadsSearch ? 0 : 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id, uploadsPage, uploadsVersion, uploadsSearch]);

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
          <Link className="brand" to="/home" onClick={() => setMobileMenuOpen(false)}>
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
          <button type="button" onClick={handleLogout} className="side-link logout-link logout-btn">
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
            <div className={`notif-panel ${fx.fadeDown}`} role="dialog" aria-label="Your notifications">
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
              {notifications.length > 3 && (
                <div className="notif-filter-row">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="text"
                    value={notifFilter}
                    onChange={(e) => setNotifFilter(e.target.value)}
                    placeholder="Filter notifications..."
                    aria-label="Filter notifications by title or message"
                  />
                  {notifFilter && (
                    <button
                      type="button"
                      onClick={() => setNotifFilter('')}
                      aria-label="Clear notification filter"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
              <div className="notif-list">
                  {notifications.length === 0 ? (
                    <p className={`notif-empty ${fx.fadeUp}`}>
                      You're all caught up — no notifications yet.
                    </p>
                  ) : visibleNotifications.length === 0 ? (
                    <p className={`notif-empty ${fx.fadeUp}`}>
                      No notifications match “{notifFilter.trim()}”.
                    </p>
                  ) : (
                    visibleNotifications.map((n, nIdx) => (
                      <div
                        key={n.id}
                        className={`notif-item ${fx.listRow} ${n.read ? '' : 'unread'}`}
                        style={staggerDelay(nIdx, 30)}
                      >
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
                          <NotificationTag type={n.type} />
                          <MessageText body={n.body} inline />
                          <small>
                            {n.senderName ? `By ${n.senderName} · ` : ''}
                            {new Date(n.createdAt).toLocaleString()}
                          </small>
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
          <div className="portal-mobile-actions">
            <Link to="/student/upload" className="portal-mobile-upload">
              <Upload size={16} />
            </Link>
            <button
              type="button"
              className="portal-mobile-logout"
              onClick={handleLogout}
              aria-label="Sign out / Exit"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {/* Session-scoped reminders: incomplete profile, then unverified identity. */}
        <ProfileSetupBanner />
        <VerificationReminderBanner />

        {/* Dynamic Subpages based on Path */}
        <div key={currentPath} className={fx.page} style={{ animationDuration: '180ms' }}>
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
            onSignOut={handleLogout}
          />
        ) : currentPath.startsWith('/student/uploads') ? (
          <StudentMyUploadsTab
            uploads={pagedUploads}
            total={uploadsTotal}
            page={uploadsPage}
            pageSize={UPLOADS_PAGE_SIZE}
            onPageChange={setUploadsPage}
            search={uploadsSearch}
            onSearchChange={setUploadsSearch}
            loading={uploadsLoading}
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
        ) : currentPath.startsWith('/student/upload') ? (
          <StudentUploadTab
            onUploaded={() => {
              setUploadsVersion((v) => v + 1);
              void store.syncMaterialsFromSupabase();
              navigate('/student/uploads');
            }}
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
        ) : currentPath.startsWith('/student/verification') ? (
          <StudentVerificationTab />
        ) : currentPath.startsWith('/student/subscription') ? (
          <StudentSubscriptionTab />
        ) : currentPath.startsWith('/student/settings') ? (
          <StudentSettingsTab currentUser={currentUser} />
        ) : currentPath.startsWith('/student/course-upload') ? (
          <StudentCourseUploadTab onSubmitted={() => navigate('/student/courses')} />
        ) : currentPath.startsWith('/student/courses') ? (
          <StudentCourseHistoryTab />
        ) : currentPath.startsWith('/student/planner') ? (
          <StudyPlannerTab />
        ) : currentPath.startsWith('/student/notes') ? (
          <StudentNotesTab />
        ) : currentPath.startsWith('/student/reading-lists/') ? (
          <ReadingListDetailTab />
        ) : currentPath.startsWith('/student/reading-lists') ? (
          <ReadingListsTab onReadOnline={onReadOnline} />
        ) : currentPath.startsWith('/student/messages') ? (
          <StudentMessagesTab />
        ) : currentPath.startsWith('/student/request-deletion') ? (
          <StudentDeletionRequestsTab />
        ) : currentPath.startsWith('/student/change-requests') ? (
          <StudentChangeRequestsTab />
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
        </div>

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
  onAskAi,
  onSignOut
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

  const handleSignOut = async () => {
    if (typeof onSignOut === 'function') {
      await onSignOut();
    }
  };

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
          <button type="button" className="portal-top-logout" onClick={handleSignOut} aria-label="Sign out / Exit">
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </div>


      {/* Metrics Stats Grid */}
      <div className="portal-stats">
        <section className={fx.fadeUp} style={staggerDelay(0, 60)}>
          <Heart />
          <b>{savedCount}</b>
          <span>Saved materials</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(1, 60)}>
          <Clock />
          <b>{recentCount}</b>
          <span>Recently viewed</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(2, 60)}>
          <Download />
          <b>{downloadsCount}</b>
          <span>Downloads</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(3, 60)}>
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

      {/* Personalized Study Insights */}
      <StudyInsightsPanel />

      {/* Personalized Suggested Materials Section */}
      <SuggestedMaterialsSection
        currentUser={{
          id: currentUser.id,
          department: currentUser.department,
          faculty: currentUser.faculty,
          level: currentUser.level
        }}
        onReadOnline={onReadOnline}
        onAskAi={onAskAi}
      />

      {/* Trending now — most-downloaded approved materials */}
      <TrendingMaterialsSection onReadOnline={onReadOnline} onAskAi={onAskAi} />

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
  const [academicSessions, setAcademicSessions] = useState<AcademicSession[]>([]);
  const [academicSession, setAcademicSession] = useState('');

  // Multi-department course availability (see MultiDepartmentPicker).
  const [multiDept, setMultiDept] = useState<MultiDepartmentState>(EMPTY_MULTI_DEPARTMENT);

  const [filters, setFilters] = useState<FilterState>({
    faculty: 'Faculty of Computing & Information System',
    department: 'Computer Science',
    course: '',
    level: '100 Level',
    semester: 'First Semester',
    type: materialTypes[0]
  });

  useEffect(() => {
    fetchAcademicSessions()
      .then((rows) => {
        setAcademicSessions(rows);
        if (rows.length) {
          setAcademicSession((current) => rows.some((row) => row.name === current) ? current : rows[0].name);
        }
      })
      .catch((err: Error) => {
        setMessage({ type: 'error', text: err.message || 'Unable to load academic sessions.' });
      });
  }, []);

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
    if (!academicSession) {
      setMessage({ type: 'error', text: 'Please select an academic session.' });
      return;
    }

    // Multi-department availability must be fully answered when the student
    // opted in: every "additional department" slot needs a valid selection.
    if (multiDept.enabled) {
      const chosen = multiDept.departments.filter(Boolean);
      if (chosen.length < multiDept.count) {
        setMessage({
          type: 'error',
          text: `You selected ${multiDept.count} additional department${multiDept.count > 1 ? 's' : ''}. Please select ${multiDept.count} department${multiDept.count > 1 ? 's' : ''} below.`
        });
        return;
      }
      const invalid = chosen.some((d) => !d.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.id));
      if (invalid) {
        setMessage({ type: 'error', text: 'One of the selected departments is not valid. Please re-select it from the list.' });
        return;
      }
    }

    setBusy(true);
    setMessage(null);

    // Primary department = the student's own; additional departments = the
    // ones chosen in the multi-department wizard. submitMaterialDb stores the
    // whole set atomically in material_departments (no duplicated material).
    // The own department MUST occupy index 0, so sharing is skipped entirely
    // (safe fallback: own department only) when its UUID is not yet resolved.
    const departmentIds: string[] | undefined = (() => {
      if (!multiDept.enabled || !multiDept.primaryDepartmentId) return undefined;
      const ids: string[] = [multiDept.primaryDepartmentId];
      for (const d of multiDept.departments) if (d?.id && !ids.includes(d.id)) ids.push(d.id);
      return ids;
    })();

    try {
      // Database-first submission: the row is created immediately and the file
      // is attached to Storage right after. Status (pending/approved) is
      // decided server-side from the account's role.
      await submitMaterialDb({
        title,
        description,
        faculty: filters.faculty || 'Faculty of Computing & Information System',
        department: filters.department || 'Computer Science',
        department_ids: departmentIds,
        course_code: filters.course || '',
        course_title: filters.course ? courseTitleByCode(filters.course) : undefined,
        level: filters.level || '100 Level',
        semester: filters.semester || 'First Semester',
        academic_session: academicSession,
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
            <label>
              Academic Session *
              <select
                required
                disabled={!academicSessions.length}
                value={academicSession}
                onChange={(e) => setAcademicSession(e.target.value)}
              >
                {academicSessions.map((session) => (
                  <option key={session.name} value={session.name}>
                    {session.label || `${session.name} Academic Session`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-section">
            <h3>Optional — Share with Other Departments</h3>
            <MultiDepartmentPicker
              ownDepartment={filters.department}
              value={multiDept}
              onChange={setMultiDept}
              disabled={busy}
              ready={!!filters.department}
            />
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
  search,
  onSearchChange,
  loading,
  stats,
  onRequestDelete,
  onReadOnline
}: {
  uploads: MaterialItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearchChange: (term: string) => void;
  loading: boolean;
  stats: { total: number; approved: number; pending: number; rejected: number; downloads: number };
  onRequestDelete: (m: MaterialItem) => void;
  onReadOnline: (m: MaterialItem) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasQuery = search.trim().length > 0;

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

      {(total > 0 || hasQuery) && (
        <div className="manage-tools compact">
          <Search size={17} />
          <input
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value);
              if (page !== 0) onPageChange(0);
            }}
            placeholder="Search your uploads by title, course, or department..."
            aria-label="Search your uploaded materials"
          />
          {loading && <Loader2 size={15} className="spin-icon" aria-hidden="true" />}
          {hasQuery && (
            <button
              className="clear-search-btn"
              onClick={() => onSearchChange('')}
              aria-label="Clear upload search"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty-state card-empty">
          <Loader2 size={30} className="spin-icon" />
          <b>Loading your uploads…</b>
          <span>Fetching the latest submission statuses from the library database.</span>
        </div>
      ) : uploads.length === 0 ? (
        <div className="empty-state card-empty">
          <FileText size={40} />
          {hasQuery ? (
            <>
              <b>No uploads match “{search.trim()}”.</b>
              <span>Try a different title or course keyword, or clear the search.</span>
            </>
          ) : (
            <>
              <b>No uploaded materials yet.</b>
              <span>Upload your lecture notes, handouts, or past questions to earn academic repository contribution credits.</span>
              <Link to="/student/upload" className="primary empty-btn">
                <Upload size={15} /> Upload Your First Material
              </Link>
            </>
          )}
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
  const [scopeCleared, setScopeCleared] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [mode, setMode] = useState<'explainer' | 'exam' | 'summary' | 'quiz'>('explainer');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // Monotonic generation counter: stale in-flight responses (e.g. after a
  // "New conversation" reset) are dropped instead of resurrecting old state.
  const genRef = useRef(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks the most recent question so the "Try Again" action can resend it.
  const lastQuestionRef = useRef('');

  const copyAnswer = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(index);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard access may be blocked; quietly ignore.
    }
  };

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
          // Restore the conversation's scope so follow-ups keep using (and the
          // UI keeps showing) the material this conversation is about.
          if (conv.material_id) setMaterialId(conv.material_id);
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
    { label: 'Summarize', prompt: 'Summarize this material into clear exam-ready revision points.', icon: FileText as React.ComponentType<{ size?: number }> },
    { label: 'Key points', prompt: 'List the most important key points, definitions and formulas from this material.', icon: List as React.ComponentType<{ size?: number }> },
    { label: 'Practice quiz', prompt: 'Generate 10 practice questions with answers from this material.', icon: GraduationCap as React.ComponentType<{ size?: number }> },
    { label: 'Revision notes', prompt: 'Create concise revision notes covering every major topic in this material.', icon: Pencil as React.ComponentType<{ size?: number }> }
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
    if (!question || busy || !historyLoaded) return;
    lastQuestionRef.current = question;
    const gen = ++genRef.current;
    const clear = scopeCleared;
    setScopeCleared(false);
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '…' }]);
    setBusy(true);
    try {
      const res = await aiAsk({ message: question, conversationId, materialId, clearScope: clear, mode });
      if (genRef.current !== gen) return; // conversation was reset mid-flight
      setNotConfigured(false);
      setConversationId(res.conversationId);
      setMessages((prev) => {
        const copy = [...prev];
        if (copy.length === 0) return copy;
        copy[copy.length - 1] = { role: 'assistant', content: res.answer, citations: res.citations };
        return copy;
      });
    } catch (err: any) {
      if (genRef.current !== gen) return;
      // Drop the placeholder bubble and surface a friendly error.
      setMessages((prev) => prev.slice(0, -1));
      if (aiConfiguredHint(err)) setNotConfigured(true);
      setError(friendlyError(err, 'The AI assistant is unavailable right now.'));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  };

  const clearConversation = () => {
    genRef.current++; // invalidate any in-flight response
    setMessages([]);
    setConversationId(null);
    setMaterialId(null);
    setScopeCleared(false);
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
          <button type="button" className="secondary-btn" onClick={clearConversation} disabled={busy}>
            <RefreshCw size={15} />
            <span>New conversation</span>
          </button>
        )}
      </div>

      <div className="ai-chat-shell">
        {/* Scoped-material context banner */}
        <div className={`ai-context-chip ${materialId ? '' : 'hidden'}`}>
          <BookOpen size={14} />
          <span>
            Asking about: <b>{focusMaterial?.title || 'Selected material'}</b>
          </span>
          <button
            type="button"
            onClick={() => {
              // Ask the whole library instead — explicit scope clear.
              setMaterialId(null);
              setScopeCleared(true);
              onClearFocus?.();
            }}
            disabled={busy}
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
                <div className="ai-empty-hero" aria-hidden="true">
                  <Sparkles size={30} />
                </div>
                <span className="ai-empty-badge">
                  <BookOpen size={11} /> Grounded in your e-library
                </span>
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
              <div key={i} className={`chat-row user ${fx.listRow}`}>
                <div className="chat-bubble user">{m.content}</div>
                <div className="chat-avatar user" aria-hidden="true">
                  {(profile?.fullName?.charAt(0) || 'S').toUpperCase()}
                </div>
              </div>
            ) : (
              <div key={i} className={`chat-row assistant ${fx.listRow}`}>
                <div className="chat-avatar assistant" aria-hidden="true">
                  <Bot size={15} />
                </div>
                <div className="chat-bubble assistant">
                  <div className="chat-bubble-head">
                    <span className="chat-bubble-role">Study assistant</span>
                    <button
                      type="button"
                      className="chat-copy-btn"
                      onClick={() => copyAnswer(i, m.content)}
                      aria-label="Copy answer to clipboard"
                      title="Copy answer"
                    >
                      {copiedId === i ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
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
          <div className="form-feedback-box error ai-error-box">
            <AlertCircle size={18} />
            <p>{error || 'Sorry, the AI Assistant is temporarily unavailable. Please try again later.'}</p>
            {lastQuestionRef.current && (
              <button
                type="button"
                className="ai-error-retry"
                onClick={() => {
                  setNotConfigured(false);
                  void send(lastQuestionRef.current);
                }}
              >
                Try Again
              </button>
            )}
          </div>
        )}

        {/* Study mode selector — shapes how the assistant responds */}
        <div className="ai-mode-row" role="group" aria-label="Study mode">
          {(
            [
              { key: 'explainer', label: 'Explain', icon: BookOpen },
              { key: 'summary', label: 'Summarise', icon: List },
              { key: 'exam', label: 'Exam prep', icon: GraduationCap },
              { key: 'quiz', label: 'Quiz me', icon: HelpCircle }
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              className={`ai-mode-chip ${mode === m.key ? 'active' : ''}`}
              onClick={() => setMode(m.key)}
              disabled={busy}
            >
              <m.icon size={13} /> {m.label}
            </button>
          ))}
        </div>

        {/* One-tap study actions for the focused material / whole library */}
        <div className="ai-quick-actions">
          {quickActions.map((qa) => (
            <button key={qa.label} type="button" onClick={() => send(qa.prompt)} disabled={busy || !historyLoaded}>
              <qa.icon size={13} /> {qa.label}
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
          <button
            type="button"
            className="ai-composer-add"
            onClick={() => inputRef.current?.focus()}
            aria-label="Focus the message box"
          >
            <Plus size={16} />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your course materials…"
            maxLength={2000}
            disabled={busy || !historyLoaded}
            aria-label="Message the AI assistant"
          />
          <button type="submit" className="ai-composer-send" disabled={busy || !historyLoaded || !input.trim()}>
            {busy ? <Loader2 size={16} className="spin-icon" /> : <Send size={16} />}
            <span className="ai-send-label">Send</span>
          </button>
        </form>
        <div className="ai-chat-hints">
          <span>
            <Info size={12} /> Answers cite e-library sources where possible.
          </span>
          <span className="ai-chat-hint-key">
            <CornerDownLeft size={12} /> Enter to send &middot; {input.length}/2000
          </span>
        </div>
      </div>
    </div>
  );
}

/** Small visual tag for announcement-type notifications. */
function NotificationTag({ type }: { type: NotificationItem['type'] }) {
  const meta: Record<string, { label: string; cls: string }> = {
    announcement: { label: 'ANNOUNCEMENT', cls: 'announcement' },
    maintenance: { label: 'MAINTENANCE', cls: 'maintenance' },
    important: { label: 'IMPORTANT', cls: 'important' },
    system_update: { label: 'SYSTEM UPDATE', cls: 'system-update' },
    // Verification workflow and premium entitlement lifecycle.
    verification_submitted: { label: 'VERIFICATION PENDING', cls: 'maintenance' },
    verification_approved: { label: 'VERIFIED', cls: 'announcement' },
    verification_rejected: { label: 'VERIFICATION NEEDS ATTENTION', cls: 'important' },
    plan_activated: { label: 'PREMIUM ACTIVE', cls: 'system-update' },
    plan_expired: { label: 'PREMIUM ENDED', cls: 'announcement' }
  };
  const tag = meta[type];
  if (!tag) return null;
  return <span className={`notif-tag ${tag.cls}`}>{tag.label}</span>;
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
                {formData.matricNumber ? (
                  <div className="input-with-badge">
                    <input
                      value={formData.matricNumber}
                      readOnly
                      className="input-readonly"
                      title="Matriculation number is your verified institutional identifier and cannot be edited once set. Submit a profile change request to update it."
                    />
                    <span className="readonly-tag">
                      <ShieldCheck size={12} /> Locked
                    </span>
                  </div>
                ) : (
                  <input
                    required
                    placeholder="e.g. BSC/BCH/24/0142"
                    value={formData.matricNumber}
                    onChange={(e) => setFormData({ ...formData, matricNumber: e.target.value.toUpperCase() })}
                    title="Enter your matriculation number. It is locked once saved."
                  />
                )}
              </label>
            </div>

            <div className="form-grid-2">
              <label>
                Faculty
                {profile?.facultyLocked ? (
                  <div className="input-with-badge">
                    <input
                      value={formData.faculty}
                      readOnly
                      className="input-readonly"
                      title="Faculty is locked after being set. Submit a profile change request to update it."
                    />
                    <span className="readonly-tag">
                      <Lock size={12} /> Locked
                    </span>
                  </div>
                ) : (
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
                )}
              </label>

              <label>
                Department
                {profile?.departmentLocked ? (
                  <div className="input-with-badge">
                    <input
                      value={formData.department}
                      readOnly
                      className="input-readonly"
                      title="Department is locked after being set. Submit a profile change request to update it."
                    />
                    <span className="readonly-tag">
                      <Lock size={12} /> Locked
                    </span>
                  </div>
                ) : (
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
                )}
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
  const { updateProfile, changePassword, signOut, user, profile, isProfileComplete } = useAuth();

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

  // ── Identity-field lock state (new "change twice, then lock" rule) ──
  // While the profile is INCOMPLETE each identity field may be edited up to 2
  // times (tracked by the *_changes_used counters). Once the profile is
  // COMPLETE every identity field locks permanently.
  const profileLock = {
    matric: isProfileComplete || (profile?.matricChangesUsed ?? 0) >= 2,
    faculty: isProfileComplete || (profile?.facultyChangesUsed ?? 0) >= 2,
    department: isProfileComplete || (profile?.departmentChangesUsed ?? 0) >= 2,
    level: isProfileComplete || (profile?.levelChangesUsed ?? 0) >= 2,
    viaChanges: true
  };
  const editsRemaining = (n?: number) => Math.max(0, 2 - (n ?? 0));

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

  // ── Active Sessions ──────────────────────────────────────
  const [mySessions, setMySessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [connectionInfo, setConnectionInfo] = useState(detectConnection());

  const loadSessions = async () => {
    try {
      const sessions = await fetchMySessions();
      setMySessions(sessions);
    } catch { /* ignore */ }
    setSessionsLoading(false);
  };

  useEffect(() => {
    loadSessions();
    analyticsTracker.trackEvent('profile_view', 'student', { profile_view_name: 'settings' });
    // Refresh connection info periodically
    const connInterval = setInterval(() => setConnectionInfo(detectConnection()), 30_000);
    return () => clearInterval(connInterval);
  }, []);

  const handleTerminateSession = async (sessionId: string) => {
    try {
      await terminateSession(sessionId);
      setMySessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast('Session terminated.', 'success');
    } catch {
      toast('Failed to terminate session.', 'error');
    }
  };

  const handleSignOutOtherSessions = async () => {
    try {
      await terminateAllOtherSessions();
      // Reload to show only current session
      const sessions = await fetchMySessions();
      setMySessions(sessions);
      toast('All other sessions have been signed out.', 'success');
    } catch {
      toast('Failed to sign out other sessions.', 'error');
    }
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
                    {profileLock.matric ? (
                      <div className="input-with-badge">
                        <input
                          value={profileData.matricNumber}
                          readOnly
                          className="input-readonly"
                          title="Your matriculation number locks once your profile is complete or your allowed changes run out. Submit a profile change request to update it."
                        />
                        <span className="readonly-tag" title="Institutional Identifier">
                          <ShieldCheck size={12} /> Locked
                        </span>
                      </div>
                    ) : (
                      <div>
                        <input
                          placeholder="e.g. CIS/CSC/20/001"
                          value={profileData.matricNumber}
                          onChange={(e) => setProfileData({ ...profileData, matricNumber: e.target.value.toUpperCase() })}
                          required={!profileData.matricNumber}
                          disabled={busy}
                          title="Enter your matriculation number. It locks after your allowed changes are used."
                        />
                        {profileData.matricNumber && (
                          <small className="field-lock-hint">
                            {editsRemaining(profile?.matricChangesUsed)} change(s) remaining before this locks.
                          </small>
                        )}
                      </div>
                    )}
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Faculty
                    {profileLock.faculty ? (
                      <div className="input-with-badge">
                        <input
                          value={profileData.faculty}
                          readOnly
                          className="input-readonly"
                          title="Faculty locks once your profile is complete or your allowed changes run out. Submit a profile change request to update it."
                        />
                        <span className="readonly-tag">
                          <Lock size={12} /> Locked
                        </span>
                      </div>
                    ) : (
                      <div>
                        <select
                          value={profileData.faculty}
                          onChange={(e) => handleFacultyChange(e.target.value)}
                          disabled={busy}
                          required
                        >
                          <option value="" disabled>Select your faculty</option>
                          {catalogue.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        {profileData.faculty && (
                          <small className="field-lock-hint">
                            {editsRemaining(profile?.facultyChangesUsed)} change(s) remaining before this locks.
                          </small>
                        )}
                      </div>
                    )}
                  </label>
                  <label>
                    Department
                    {profileLock.department ? (
                      <div className="input-with-badge">
                        <input
                          value={profileData.department}
                          readOnly
                          className="input-readonly"
                          title="Department locks once your profile is complete or your allowed changes run out. Submit a profile change request to update it."
                        />
                        <span className="readonly-tag">
                          <Lock size={12} /> Locked
                        </span>
                      </div>
                    ) : (
                      <div>
                        <select
                          value={profileData.department}
                          onChange={(e) => handleDeptChange(e.target.value)}
                          disabled={busy}
                          required
                        >
                          <option value="" disabled>Select your department</option>
                          {currentFaculty.departments.map((d) => (
                            <option key={d.name} value={d.name}>
                              {d.name} ({d.duration} Years)
                            </option>
                          ))}
                        </select>
                        {profileData.department && (
                          <small className="field-lock-hint">
                            {editsRemaining(profile?.departmentChangesUsed)} change(s) remaining before this locks.
                          </small>
                        )}
                      </div>
                    )}
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Level of Study (Restricted to {currentDepartment?.duration || 4}-Year Degree Duration)
                    {profileLock.level ? (
                      <div className="input-with-badge">
                        <input value={profileData.level} readOnly className="input-readonly" />
                        <span className="readonly-tag">
                          <Lock size={12} /> Locked
                        </span>
                      </div>
                    ) : (
                      <div>
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
                        {profileData.level && (
                          <small className="field-lock-hint">
                            {editsRemaining(profile?.levelChangesUsed)} change(s) remaining before this locks.
                          </small>
                        )}
                      </div>
                    )}
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
                  <p>Protect your student portal access with a strong password and extra sign-in verification.</p>
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

              <div className="security-tools-section">
                <div className="settings-card-header">
                  <div>
                    <h3>Two-Factor Sign-In</h3>
                    <p>Add an Authenticator App or a passkey so your account stays protected even if your password is compromised.</p>
                  </div>
                </div>
                <AuthenticatorAppCard />
                <PasskeysManager />
              </div>
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

                  <label className="switch-row inline-switch mt-lg">
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
                  <p>Manage and monitor devices currently signed in to your account.</p>
                </div>
                {mySessions.filter((s) => !s.is_current).length > 0 && (
                  <button type="button" className="danger-btn-outline" onClick={handleSignOutOtherSessions}>
                    <LogOut size={14} /> Log Out All Other Devices
                  </button>
                )}
              </div>

              {/* Connection Info */}
              <div className="connection-info-bar">
                <div className="connection-info-item">
                  <Wifi size={14} />
                  <span>Connection: {connectionInfo.connection_type === 'wifi' ? 'Wi-Fi' : connectionInfo.connection_type === 'cellular' ? 'Mobile Data' : connectionInfo.connection_type === 'ethernet' ? 'Ethernet' : 'Unknown'}</span>
                </div>
                <div className="connection-info-item">
                  <span>Network: {connectionInfo.network_name || 'Network name unavailable'}</span>
                </div>
              </div>

              {sessionsLoading ? (
                <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading sessions…</div>
              ) : mySessions.length === 0 ? (
                <div className="empty-state-card">
                  <Laptop size={36} />
                  <b>No active sessions</b>
                  <span>Session data will appear here once you log in.</span>
                </div>
              ) : (
                <div className="sessions-list">
                  {/* Current session first */}
                  {mySessions.filter((s) => s.is_current).map((s) => {
                    const Icon = s.device_type === 'mobile' ? Smartphone : s.device_type === 'tablet' ? Smartphone : Laptop;
                    const timeSince = (ts: string) => {
                      const diff = Date.now() - new Date(ts).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 1) return 'Just now';
                      if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
                      const days = Math.floor(hrs / 24);
                      return `${days} day${days === 1 ? '' : 's'} ago`;
                    };
                    return (
                      <div key={s.id} className="session-item current">
                        <div className="session-icon current-icon">
                          <Icon size={20} />
                        </div>
                        <div className="session-details">
                          <div className="session-title-row">
                            <b>This Device</b>
                            <span className="current-session-badge">Active Now</span>
                          </div>
                          <div className="session-subtitle">{s.browser} · {s.os}</div>
                          <div className="session-meta-row">
                            <span className="session-meta">
                              <span className="meta-dot active-dot" />
                              Active now
                            </span>
                            {s.device_name && (
                              <span className="session-meta">
                                <Monitor size={11} />
                                {s.device_name}
                              </span>
                            )}
                            {s.ip_address && (
                              <span className="session-meta">
                                IP: {s.ip_address}
                              </span>
                            )}
                            {s.connection_type && s.connection_type !== 'unknown' && (
                              <span className="session-meta">
                                <Wifi size={11} />
                                {s.connection_type === 'wifi' ? 'Wi-Fi' : s.connection_type === 'cellular' ? 'Mobile Data' : s.connection_type === 'ethernet' ? 'Ethernet' : s.connection_type}
                              </span>
                            )}
                          </div>
                          <span className="session-time">Logged in: {new Date(s.login_time).toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Other sessions */}
                  {mySessions.filter((s) => !s.is_current).length > 0 && (
                    <div className="session-divider">Other Active Sessions</div>
                  )}
                  {mySessions.filter((s) => !s.is_current).map((s) => {
                    const Icon = s.device_type === 'mobile' ? Smartphone : s.device_type === 'tablet' ? Smartphone : Laptop;
                    const timeSince = (ts: string) => {
                      const diff = Date.now() - new Date(ts).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 1) return 'Just now';
                      if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
                      const days = Math.floor(hrs / 24);
                      return `${days} day${days === 1 ? '' : 's'} ago`;
                    };
                    const isStale = (Date.now() - new Date(s.last_active).getTime()) > 10 * 60 * 1000;
                    return (
                      <div key={s.id} className="session-item">
                        <div className="session-icon">
                          <Icon size={20} />
                        </div>
                        <div className="session-details">
                          <div className="session-title-row">
                            <b>{s.browser} · {s.os}</b>
                          </div>
                          <div className="session-subtitle">{s.device_type.charAt(0).toUpperCase() + s.device_type.slice(1)}{s.device_name ? ` · ${s.device_name}` : ''}</div>
                          <div className="session-meta-row">
                            <span className={`session-meta ${isStale ? 'stale' : ''}`}>
                              <span className={`meta-dot ${isStale ? '' : 'active-dot'}`} />
                              {isStale ? `Idle · ${timeSince(s.last_active)}` : `Active ${timeSince(s.last_active)}`}
                            </span>
                            {s.connection_type && s.connection_type !== 'unknown' && (
                              <span className="session-meta">
                                <Wifi size={11} />
                                {s.connection_type === 'wifi' ? 'Wi-Fi' : s.connection_type === 'cellular' ? 'Mobile Data' : s.connection_type === 'ethernet' ? 'Ethernet' : s.connection_type}
                              </span>
                            )}
                            {s.ip_address && (
                              <span className="session-meta">
                                IP: {s.ip_address}
                              </span>
                            )}
                          </div>
                          <span className="session-time">Logged in: {new Date(s.login_time).toLocaleString()}</span>
                        </div>
                        <button
                          type="button"
                          className="session-terminate-btn"
                          onClick={() => handleTerminateSession(s.id)}
                          title="Terminate this session"
                        >
                          <LogOut size={14} /> Sign out
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 7. Danger Zone / Actions */}
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

      {/* Account Deactivation — modern protected-action dialog */}
      <ProtectedActionModal
        isOpen={deactivateModalOpen}
        onClose={() => setDeactivateModalOpen(false)}
        title="Deactivate Student Account?"
        tone="danger"
        badge="Protected Action"
        message="Are you sure you want to deactivate your student portal access? Your reading history, saved bookmarks, and uploads will be archived."
        confirmKeyword="DEACTIVATE"
        confirmLabel="Yes, Deactivate & Sign Out"
        onConfirm={handleConfirmDeactivate}
      />
    </div>
  );
}

// ─── Student Course Upload Tab ────────────────────────────────────────
interface CourseEntry {
  id: string;
  code: string;
  title: string;
  errors: { code?: string; title?: string };
}

function StudentCourseUploadTab({ onSubmitted }: { onSubmitted: () => void }) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FilterState>({
    faculty: '',
    department: '',
    level: '',
    semester: '',
    type: '',
    course: ''
  });
  const [courses, setCourses] = useState<CourseEntry[]>([
    { id: crypto.randomUUID(), code: '', title: '', errors: {} }
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [step, setStep] = useState<'form' | 'preview'>('form');

  const addCourse = () => {
    setCourses((prev) => [...prev, { id: crypto.randomUUID(), code: '', title: '', errors: {} }]);
  };

  const removeCourse = (id: string) => {
    setCourses((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.id !== id)));
  };

  const updateCourse = (id: string, field: 'code' | 'title', value: string) => {
    setCourses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value, errors: { ...c.errors, [field]: undefined } } : c))
    );
  };

  const editCourse = (id: string) => {
    setStep('form');
    // Scroll to the course entry
    setTimeout(() => {
      const el = document.getElementById(`course-entry-${id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const validate = (): boolean => {
    if (!filters.faculty || !filters.department || !filters.level || !filters.semester) {
      setMessage({ type: 'error', text: 'Please select Faculty, Department, Level, and Semester.' });
      return false;
    }

    let valid = true;
    const seen = new Set<string>();
    const updated = courses.map((c) => {
      const errors: CourseEntry['errors'] = {};
      const code = c.code.trim().toUpperCase();
      const title = c.title.trim();

      if (!code) {
        errors.code = 'Course Code is required.';
        valid = false;
      } else if (seen.has(code)) {
        errors.code = `${code} has already been added.`;
        valid = false;
      } else {
        seen.add(code);
      }

      if (!title) {
        errors.title = 'Course Title is required.';
        valid = false;
      }

      return { ...c, code, title, errors };
    });

    setCourses(updated);
    if (!valid) {
      setMessage({ type: 'error', text: 'Please fix the highlighted errors below.' });
    } else {
      setMessage(null);
    }
    return valid;
  };

  const handlePreview = () => {
    if (validate()) {
      setStep('preview');
      setMessage(null);
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { submitStudentCourses } = await import('../lib/studentCourses');
      const input = courses.map((c) => ({
        faculty: filters.faculty,
        department: filters.department,
        level: filters.level,
        semester: filters.semester,
        course_code: c.code.trim().toUpperCase(),
        course_title: c.title.trim()
      }));

      const result = await submitStudentCourses(input);

      if (result.inserted > 0) {
        toast(`${result.inserted} course(s) submitted successfully!`, 'success');
        let text = `${result.inserted} course(s) submitted for review.`;
        if (result.skipped > 0) {
          text += ` ${result.skipped} duplicate(s) were skipped.`;
        }
        setMessage({ type: 'success', text });
        setTimeout(() => onSubmitted(), 1500);
      } else {
        setMessage({ type: 'error', text: 'All courses already exist for this academic structure.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to submit courses.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">COURSE REGISTRATION</p>
          <h1>Upload Course Code & Title</h1>
          <p className="subtitle">
            Manually enter your courses for the selected academic period. You can add, edit, or remove courses before submitting.
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="step-pills">
        <span className={`step-pill${step === 'form' ? ' active' : ''}`}>
          1. Enter Courses
        </span>
        <ChevronRight size={16} className="step-pill-arrow" />
        <span className={`step-pill${step === 'preview' ? ' active' : ''}`}>
          2. Review & Submit
        </span>
      </div>

      {step === 'form' ? (
        <div className="upload-container">
          <div className="upload-form full-upload-form">
            <div className="form-section">
              <h3>Academic Information</h3>
              <CatalogueFilters
                filters={filters}
                onChange={setFilters}
                compact
                fields={['faculty', 'department', 'level', 'semester']}
              />
            </div>

            <div className="form-section">
              <h3>Courses</h3>
              {courses.map((c, idx) => (
                <div
                  key={c.id}
                  id={`course-entry-${c.id}`}
                  className="course-entry-row"
                >
                  <label>
                    Course Code *
                    <input
                      value={c.code}
                      placeholder="e.g. ECO 101"
                      onChange={(e) => updateCourse(c.id, 'code', e.target.value)}
                      className={c.errors.code ? 'course-entry-input-error' : ''}
                    />
                    {c.errors.code && (
                      <span className="course-entry-error">{c.errors.code}</span>
                    )}
                  </label>
                  <label>
                    Course Title *
                    <input
                      value={c.title}
                      placeholder="e.g. Introduction to Economics"
                      onChange={(e) => updateCourse(c.id, 'title', e.target.value)}
                      className={c.errors.title ? 'course-entry-input-error' : ''}
                    />
                    {c.errors.title && (
                      <span className="course-entry-error">{c.errors.title}</span>
                    )}
                  </label>
                  <button
                    type="button"
                    className="icon-btn danger mt-lg"
                    onClick={() => removeCourse(c.id)}
                    disabled={courses.length <= 1}
                    title="Remove course"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              <button type="button" className="add-course-btn" onClick={addCourse}>
                <Plus size={18} /> Add Another Course
              </button>
            </div>

            {message && (
              <div className={`form-feedback-box ${message.type}`}>
                {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <p>{message.text}</p>
              </div>
            )}

            <div className="form-submit-row">
              <button className="primary submit-btn" onClick={handlePreview}>
                <Eye size={16} /> Review Courses
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* PREVIEW STEP */
        <div className="upload-container">
          <div className="upload-form full-upload-form">
            <div className="form-section">
              <h3>Academic Information</h3>
              <div className="course-preview-grid">
                <div><b>Faculty:</b> {filters.faculty}</div>
                <div><b>Department:</b> {filters.department}</div>
                <div><b>Level:</b> {filters.level}</div>
                <div><b>Semester:</b> {filters.semester}</div>
              </div>
            </div>

            <div className="form-section">
              <h3>Courses ({courses.length})</h3>
              <div className="course-preview-table-wrap">
                <table className="course-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Course Code</th>
                      <th>Course Title</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((c, idx) => (
                      <tr key={c.id}>
                        <td className="preview-idx">{idx + 1}</td>
                        <td className="preview-code">{c.code}</td>
                        <td className="preview-title">{c.title}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <div className="course-preview-actions">
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => editCourse(c.id)}
                            >
                              <Pencil size={13} /> Edit
                            </button>
                            <button
                              type="button"
                              className="link-btn danger"
                              onClick={() => {
                                setCourses((prev) => prev.filter((x) => x.id !== c.id));
                                if (courses.length <= 1) setStep('form');
                              }}
                            >
                              <Trash2 size={13} /> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {message && (
              <div className={`form-feedback-box ${message.type}`}>
                {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <p>{message.text}</p>
              </div>
            )}

            <div className="form-submit-row">
              <button className="back-to-edit-btn" onClick={() => setStep('form')}>
                <ArrowLeft size={16} /> Back to Edit
              </button>
              <button className="primary submit-btn" disabled={busy} onClick={handleSubmit}>
                <Upload size={16} />
                {busy ? 'Submitting…' : 'Submit Courses'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Student Course History Tab ───────────────────────────────────────
function StudentCourseHistoryTab() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<StudentCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [confirm, setConfirm] = useState<ConfirmDialogState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const loadCourses = async () => {
    try {
      const { fetchMyStudentCourses } = await import('../lib/studentCourses');
      const data = await fetchMyStudentCourses();
      setCourses(data);
    } catch (err: any) {
      toast(err.message || 'Failed to load courses.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCourses();
  }, []);

  const handleDelete = async (id: string) => {
    setConfirm({
      open: true,
      title: 'Remove course',
      message: 'Remove this course from your submitted course history?',
      confirmLabel: 'Remove course',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const { deleteStudentCourse } = await import('../lib/studentCourses');
          await deleteStudentCourse(id);
          setCourses((prev) => prev.filter((c) => c.id !== id));
          toast('Course removed.', 'success');
        } catch (err: any) {
          toast(err.message || 'Failed to delete.', 'error');
        }
      }
    });
  };

  const handleEdit = async (id: string) => {
    if (!editCode.trim() || !editTitle.trim()) {
      toast('Both fields are required.', 'error');
      return;
    }
    try {
      const { updateStudentCourse } = await import('../lib/studentCourses');
      await updateStudentCourse(id, { course_code: editCode, course_title: editTitle });
      setCourses((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, course_code: editCode.trim().toUpperCase(), course_title: editTitle.trim() } : c
        )
      );
      setEditingId(null);
      toast('Course updated.', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to update.', 'error');
    }
  };

  const startEdit = (c: StudentCourse) => {
    setEditingId(c.id);
    setEditCode(c.course_code);
    setEditTitle(c.course_title);
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: '#f59e0b',
      approved: '#10b981',
      rejected: '#e53e3e'
    };
    return (
      <span
        className="status-badge-pill"
        style={{
          background: colors[status] || '#888'
        }}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">MY COURSES</p>
          <h1>Course History</h1>
          <p className="subtitle">View and manage courses you have previously submitted.</p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state card-empty">
          <Loader2 size={32} className="spin" />
          <span>Loading courses…</span>
        </div>
      ) : courses.length === 0 ? (
        <div className="empty-state card-empty">
          <GraduationCap size={40} />
          <b>No courses submitted yet</b>
          <span>Go to "Upload Course Code & Title" to submit your first courses.</span>
        </div>
      ) : (
        <div className="courses-table-wrapper">
          <table className="courses-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Code</th>
                <th>Title</th>
                <th>Faculty</th>
                <th>Department</th>
                <th>Level</th>
                <th>Semester</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c, idx) => (
                <tr key={c.id}>
                  <td>{idx + 1}</td>
                  <td className="cell-bold">
                    {editingId === c.id ? (
                      <input
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        style={{ width: '100px' }}
                      />
                    ) : (
                      c.course_code
                    )}
                  </td>
                  <td>
                    {editingId === c.id ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        style={{ width: '200px' }}
                      />
                    ) : (
                      c.course_title
                    )}
                  </td>
                  <td className="cell-secondary">{c.faculty}</td>
                  <td className="cell-secondary">{c.department}</td>
                  <td>{c.level}</td>
                  <td>{c.semester}</td>
                  <td>{statusBadge(c.status)}</td>
                  <td className="cell-secondary">
                    {new Date(c.submitted_at).toLocaleDateString()}
                  </td>
                  <td className="cell-nowrap">
                    {c.status === 'approved' ? (
                      <span className="locked-course-badge" title="Approved courses are locked after approval. Submit a deletion request to change or remove this course.">
                        <Lock size={13} /> Locked
                      </span>
                    ) : editingId === c.id ? (
                      <>
                        <button className="link-btn mr-sm" onClick={() => handleEdit(c.id)}>
                          Save
                        </button>
                        <button className="link-btn danger" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="link-btn mr-sm" onClick={() => startEdit(c)}>
                          Edit
                        </button>
                        <button className="link-btn danger" onClick={() => handleDelete(c.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog {...confirm} onClose={() => setConfirm((c) => ({ ...c, open: false }))} />
    </div>
  );
}

/* ── Student Messages Tab ────────────────────────────────────── */
function StudentMessagesTab() {
  const { profile } = useAuth();
  const userId = profile?.id;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [sendOk, setSendOk] = useState<string | null>(null);
  const [convSearch, setConvSearch] = useState('');
  const { toast } = useToast();

  // New Chat mode state
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMsgAdmin, setShowMsgAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<StudentSearchResult[]>([]);
  const [startingDirect, setStartingDirect] = useState(false);
  // Message Admin form
  const [adminSubject, setAdminSubject] = useState('');
  const [adminBody, setAdminBody] = useState('');
  const [adminSending, setAdminSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchConversations();
        if (!cancelled) setConversations(data);
      } catch (err: any) { toast(err.message, 'error'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      setMessagesLoading(true);
      try {
        const data = await fetchMessages(activeConvId);
        if (!cancelled) setMessages(data);
        await markConversationRead(activeConvId);
      } catch (err: any) { toast(err.message, 'error'); }
      finally { if (!cancelled) setMessagesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeConvId]);

  // Realtime: live-append messages for the open conversation. RLS ensures only
  // participants receive the row (sender identity is server-derived).
  useEffect(() => {
    if (!activeConvId || !userId) return;
    const client = requireSupabase();
    const channel = client
      .channel(`msg-${activeConvId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConvId}`
        },
        async (payload) => {
          const row = payload.new as any;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row as Message]
          );
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [activeConvId, userId]);

  const searchDebounce = useRef<number | null>(null);

  const runSearch = async (q: string) => {
    const query = q.trim();
    if (!query) { setSearchResults([]); return; }
    setSearching(true);
    setSearchError(null);
    try {
      const rows = await searchStudents(query);
      setSearchResults(rows);
    } catch (err: any) {
      setSearchError(err?.message || 'Search failed. Please try again.');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchDebounce.current) window.clearTimeout(searchDebounce.current);
    const t = value.trim();
    if (t.length >= 2) {
      searchDebounce.current = window.setTimeout(() => runSearch(t), 300);
    } else {
      setSearchResults([]);
    }
  };

  const handleStartDirect = async (peerId: string) => {
    if (startingDirect) return;
    setStartingDirect(true);
    try {
      const conv = await getOrCreateDirectConversation(peerId);
      setShowNewChat(false);
      setSearchQuery('');
      setSearchResults([]);
      await loadConversations();
      setActiveConvId(conv.id);
      setSendOk(null);
    } catch (err: any) {
      toast(err?.message || 'Could not start the conversation.', 'error');
    } finally {
      setStartingDirect(false);
    }
  };

  const loadConversations = async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const handleSend = async () => {
    if (!activeConvId || !newMsg.trim() || sending) return;
    setSending(true);
    setSendOk(null);
    try {
      const msg = await sendMessage(activeConvId, newMsg.trim());
      setMessages((prev) => [...prev, msg]);
      setNewMsg('');
      setSendOk('Message sent successfully. Your message has been delivered.');
      setTimeout(() => setSendOk(null), 3500);
      setConversations((prev) =>
        prev.map((c) => c.id === activeConvId ? { ...c, last_message_at: msg.created_at, last_message_body: msg.body } : c)
          .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );
    } catch (err: any) {
      toast(err?.message || 'Message could not be sent. Your draft was kept.', 'error');
    } finally { setSending(false); }
  };

  const handleMsgAdmin = async () => {
    if (!adminSubject.trim() || !adminBody.trim() || adminSending) return;
    setAdminSending(true);
    try {
      const conv = await startConversation(userId!, adminSubject.trim(), adminBody.trim());
      toast('Message sent successfully. Your message has been sent to the admin.', 'success');
      setShowMsgAdmin(false);
      setAdminSubject('');
      setAdminBody('');
      await loadConversations();
      setActiveConvId(conv.id);
    } catch (err: any) {
      toast(err?.message || 'Message could not be sent. Your draft was kept.', 'error');
    } finally { setAdminSending(false); }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const peerOf = (conv: Conversation) => {
    if (conv.is_direct) {
      return conv.peer?.display_name || conv.peer?.username || conv.peer?.full_name || 'Student';
    }
    return 'Administrator';
  };

  const filteredConversations = convSearch
    ? conversations.filter((c) => {
        const q = convSearch.toLowerCase();
        return (c.subject || '').toLowerCase().includes(q)
          || (peerOf(c) || '').toLowerCase().includes(q)
          || (c.peer?.username || '').toLowerCase().includes(q);
      })
    : conversations;

  const timeSince = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="student-messages-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><MessageSquare size={22} />Messages</h2>
          <p className="page-subtitle">Message administrators about your uploads, requests, and account — or chat directly with other students.</p>
        </div>
        <div className="msg-actions">
          <button className="secondary-btn" onClick={() => { setShowMsgAdmin(true); setAdminSubject(''); setAdminBody(''); }}>
            <MessageSquare size={14} /> Message Admin
          </button>
          <button className="primary" onClick={() => { setShowNewChat(true); setSearchQuery(''); setSearchResults([]); setSearchError(null); }}>
            <Plus size={15} /> New Student Chat
          </button>
        </div>
      </div>

      {/* Message Admin modal */}
      <AnimatedModal
        open={showMsgAdmin}
        onClose={() => setShowMsgAdmin(false)}
        dialogClassName="conv-modal"
        labelledBy="msg-admin-title"
      >
        <form onSubmit={(e) => { e.preventDefault(); handleMsgAdmin(); }}>
          <div className="modal-header">
            <div className="modal-header-title">
              <span className="modal-head-icon"><MessageSquare size={17} /></span>
              <div>
                <h3 id="msg-admin-title">Message an Administrator</h3>
                <p className="modal-header-sub">Your message will be delivered securely to the admin team.</p>
              </div>
            </div>
            <button type="button" className="link-btn" onClick={() => setShowMsgAdmin(false)}><X size={18} /></button>
          </div>
              <div className="modal-body">
                <div className="form-field">
                  <label className="form-label">Subject *</label>
                  <input className="form-input" value={adminSubject} onChange={(e) => setAdminSubject(e.target.value)} placeholder="e.g. Question about my upload" maxLength={120} />
                </div>
                <div className="form-field">
                  <label className="form-label">Message *</label>
                  <textarea className="form-input" rows={5} value={adminBody} onChange={(e) => setAdminBody(e.target.value)} placeholder="Write your message to the admin…" maxLength={2000} onPaste={(e) => {
                    const inserted = richPasteText(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'));
                    if (inserted == null) return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const start = el.selectionStart ?? 0;
                    const end = el.selectionEnd ?? 0;
                    setAdminBody(capLength(adminBody.slice(0, start) + inserted + adminBody.slice(end), 2000));
                    const pos = start + inserted.length;
                    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
                  }} />
                </div>
                <button className="primary w-full" type="submit" disabled={adminSending || !adminSubject.trim() || !adminBody.trim()}>
                  {adminSending ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send Message</>}
                </button>
              </div>
            </form>
      </AnimatedModal>

      {/* New Student Chat modal */}
      <AnimatedModal
        open={showNewChat}
        onClose={() => setShowNewChat(false)}
        dialogClassName="conv-modal"
        labelledBy="new-chat-title"
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <span className="modal-head-icon"><Users size={17} /></span>
            <div>
              <h3 id="new-chat-title">New Student Chat</h3>
              <p className="modal-header-sub">Find another student by username and start a conversation.</p>
            </div>
          </div>
          <button type="button" className="link-btn" onClick={() => setShowNewChat(false)}><X size={18} /></button>
        </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">Search students</label>
                <div className="filter-input-wrap">
                  <Search size={14} />
                  <input className="form-input" placeholder="@username…" value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)} autoFocus />
                </div>
              </div>

              {searching && (
                <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Searching…</div>
              )}
              {searchError && (
                <div className="alert alert-error"><AlertCircle size={15} /> {searchError}</div>
              )}
              {!searching && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <div className="empty-state-card">
                  <Users size={32} />
                  <b>No students found.</b>
                  <span>Try checking the username and search again.</span>
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="student-search-results">
                  {searchResults.map((s) => (
                    <div key={s.id} className="student-result-row">
                      <div className="avatar-mini">{((s.display_name || s.full_name || s.username || '?').charAt(0)).toUpperCase()}</div>
                      <div className="student-result-info">
                        <div className="student-result-name">@{s.username || 'user'}</div>
                        <div className="student-result-sub">
                          {s.display_name || s.full_name || 'Student'}
                          {s.matric_number ? ` · ${s.matric_number}` : ''}
                        </div>
                      </div>
                      <button className="primary" onClick={() => handleStartDirect(s.id)} disabled={startingDirect}>
                        {startingDirect ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} Message
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
      </AnimatedModal>

      <div className="conv-layout">
        {/* Conversation list */}
        <div className="conv-panel">
          <div className="conv-search">
            <input className="form-input" placeholder="Search conversations…" value={convSearch} onChange={(e) => setConvSearch(e.target.value)} />
          </div>
          {loading ? (
            <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
          ) : filteredConversations.length === 0 ? (
            <div className="empty-state-card mt-md">
              <MessageSquare size={36} />
              <b>{convSearch ? 'No Matches' : 'No Conversations'}</b>
              <span>{convSearch
                ? 'No conversations match your search.'
                : 'No conversations yet. Start a conversation with another student using their username, or message an administrator.'}</span>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => setActiveConvId(conv.id)}
                className={`conv-list-item ${fx.listRow}${activeConvId === conv.id ? ' active' : ''}`}
              >
                <div className="conv-list-head">
                  <div className="conv-subject">{conv.is_direct ? (conv.peer?.username ? `@${conv.peer.username}` : peerOf(conv)) : (conv.subject || 'Message to Admin')}</div>
                  <div className="conv-meta">{timeSince(conv.last_message_at)}</div>
                </div>
                <div className={`conv-peer-name${conv.is_direct ? ' direct' : ''}`}>{peerOf(conv)}</div>
                {conv.last_message_body && <div className="conv-preview">{messagePreview(conv.last_message_body, 60)}</div>}
                {(conv.unread_count ?? 0) > 0 && <span className="unread-badge">{conv.unread_count} unread</span>}
              </div>
            ))
          )}
        </div>

        {/* Message thread */}
        {activeConvId && (
          <div className="thread-panel">
            <div className="thread-header">
              <div className="thread-title-wrap">
                <div className="thread-subject">{activeConv?.is_direct ? (activeConv.peer?.display_name || peerOf(activeConv!)) : (activeConv?.subject || 'Message to Admin')}</div>
                <div className="thread-sub">{activeConv?.is_direct
                  ? (activeConv.peer?.username ? `@${activeConv.peer.username}` : 'Direct message')
                  : 'Administrator'}</div>
              </div>
              {sendOk && (
                <div className="msg-sent-confirm"><CheckCircle2 size={15} /> {sendOk}</div>
              )}
            </div>

            <div className="thread-messages">
              {messagesLoading ? (
                <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading messages…</div>
              ) : messages.length === 0 ? (
                <div className="empty-state-card mt-lg mx-auto">
                  <MessageSquare size={36} />
                  <b>No messages yet.</b>
                  <span>Start the conversation by sending the first message.</span>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOwn = msg.sender_id === profile?.id;
                  return (
                    <div key={msg.id} className={`msg-bubble-wrap ${fx.listRow}`}>
                      {!isOwn && msg.sender?.display_name && (
                        <div className="msg-sender-name">{msg.sender.display_name || msg.sender.full_name || 'User'}</div>
                      )}
                      <div className={`msg-bubble ${isOwn ? 'sent' : 'received'}`}>
                        <MessageText body={msg.body} />
                        <div className="msg-bubble-time">{new Date(msg.created_at).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <MessageComposer value={newMsg} onChange={setNewMsg} onSend={handleSend} sending={sending} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Student Deletion Requests Tab ──────────────────────────── */
function StudentDeletionRequestsTab() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<'course' | 'material'>('material');
  const [itemName, setItemName] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [detailReq, setDetailReq] = useState<DeletionRequest | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const { toast } = useToast();

  // Item selector state
  const [myItems, setMyItems] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => { loadRequests(); }, []);

  const loadRequests = async () => {
    try {
      const data = await fetchMyDeletionRequests();
      setRequests(data);
    } catch (err: any) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  // Load student's own items when form opens or type changes
  useEffect(() => {
    if (!showForm || !profile?.id) return;
    setItemsLoading(true);
    setItemName(''); setItemCode(''); setItemSearch('');
    (async () => {
      try {
        if (formType === 'material') {
          const result = await fetchMyMaterials(profile.id, 0, 100);
          setMyItems(result.items.map((m: any) => ({ id: m.id, name: m.title, code: m.courseCode || null })));
        } else {
          const courses = await fetchMyStudentCourses();
          setMyItems(courses.map((c) => ({ id: c.id, name: c.course_title, code: c.course_code })));
        }
      } catch { setMyItems([]); }
      finally { setItemsLoading(false); }
    })();
  }, [showForm, formType, profile?.id]);

  const filteredItems = itemSearch
    ? myItems.filter((i) => i.name.toLowerCase().includes(itemSearch.toLowerCase()) || (i.code || '').toLowerCase().includes(itemSearch.toLowerCase()))
    : myItems;

  const handleItemSelect = (item: { id: string; name: string; code: string | null }) => {
    setItemName(item.name);
    setItemCode(item.code || '');
    setItemSearch(`${item.name}${item.code ? ` (${item.code})` : ''}`);
    setShowDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim() || !reason.trim()) return;
    setConfirmState({
      open: true,
      title: 'Submit Deletion Request?',
      message: `You are requesting deletion of ${formType === 'material' ? 'material' : 'course'} "${itemName.trim()}". An administrator will review this request.`,
      onConfirm: async () => {
        setSubmitting(true);
        try {
          await submitDeletionRequest({ request_type: formType, item_name: itemName.trim(), item_code: itemCode.trim() || undefined, reason: reason.trim() });
          toast('Deletion request submitted successfully. An administrator will review your request.', 'success');
          setItemName(''); setItemCode(''); setReason(''); setItemSearch(''); setShowForm(false);
          await loadRequests();
        } catch (err: any) { toast(err.message, 'error'); }
        finally { setSubmitting(false); }
      }
    });
  };

  const statusBadge = (s: string) => <span className={`status-badge ${s}`}>{s}</span>;
  const timeSince = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const pending = requests.filter((r) => r.status === 'pending').length;
  const approved = requests.filter((r) => r.status === 'approved').length;
  const rejected = requests.filter((r) => r.status === 'rejected').length;
  const completed = requests.filter((r) => r.status === 'completed').length;

  return (
    <div className="student-deletion-requests-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><FileWarning size={22} />Request Deletion</h2>
          <p className="page-subtitle">Made a mistake with a course or material you uploaded? Submit a deletion request for an administrator to review.</p>
        </div>
        <button className={showForm ? 'secondary-btn' : 'primary'} onClick={() => setShowForm(!showForm)}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Request</>}
        </button>
      </div>

      {/* Stat Cards */}
      {!loading && requests.length > 0 && (
        <div className="stat-cards">
          <div className="stat-card"><span className="stat-value">{requests.length}</span><span className="stat-label">Total</span></div>
          <div className="stat-card pending"><span className="stat-value">{pending}</span><span className="stat-label">Pending</span></div>
          <div className="stat-card approved"><span className="stat-value">{approved}</span><span className="stat-label">Approved</span></div>
          <div className="stat-card rejected"><span className="stat-value">{rejected}</span><span className="stat-label">Rejected</span></div>
          {completed > 0 && <div className="stat-card completed"><span className="stat-value">{completed}</span><span className="stat-label">Completed</span></div>}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="card request-form-card">
          <div className="form-card-head">
            <span className="form-card-head-icon"><FileWarning size={18} /></span>
            <div>
              <h3>Submit a Deletion Request</h3>
              <p>Select the item you want administrators to remove from the library.</p>
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Request Type</label>
            <div className="form-segmented">
              <button
                type="button"
                className={`form-segmented-option${formType === 'material' ? ' active' : ''}`}
                onClick={() => setFormType('material')}
              >
                <FileText size={15} /> Material
              </button>
              <button
                type="button"
                className={`form-segmented-option${formType === 'course' ? ' active' : ''}`}
                onClick={() => setFormType('course')}
              >
                <GraduationCap size={15} /> Course
              </button>
            </div>
          </div>

          <div className="form-field item-selector-field">
            <label className="form-label">{formType === 'material' ? 'Select Material' : 'Select Course'} *</label>
            {itemsLoading ? (
              <div className="loading-spinner-row"><Loader2 size={14} className="animate-spin" /> Loading your {formType === 'material' ? 'materials' : 'courses'}…</div>
            ) : myItems.length === 0 ? (
              <div className="item-empty-state">
                <FileWarning size={28} />
                <b>{formType === 'material' ? 'No Uploaded Materials' : 'No Submitted Courses'}</b>
                <span>You have no uploaded {formType === 'material' ? 'materials' : 'courses'} to request deletion for.</span>
              </div>
            ) : (
              <div className="item-selector-wrapper">
                <div className="filter-input-wrap">
                  <Search size={14} />
                  <input
                    className="form-input"
                    value={itemSearch}
                    onChange={(e) => { setItemSearch(e.target.value); setShowDropdown(true); setItemName(''); setItemCode(''); }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                    placeholder={`Search your ${formType === 'material' ? 'materials' : 'courses'}…`}
                  />
                </div>
                {showDropdown && (
                  filteredItems.length > 0 ? (
                    <div className="item-dropdown">
                      {filteredItems.slice(0, 15).map((item) => (
                        <div key={item.id} className="item-dropdown-item" onMouseDown={() => handleItemSelect(item)}>
                          <div className="student-cell-main">
                            <span className="cell-bold">{item.name}</span>
                            {item.code && <span className="cell-code cell-secondary">{item.code}</span>}
                          </div>
                          <span className="dropdown-select-icon"><ChevronRight size={14} /></span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="item-dropdown-empty">
                      <Search size={14} /> No matching {formType === 'material' ? 'materials' : 'courses'}
                    </div>
                  )
                )}
                {itemName && (
                  <div className="selected-item-chip">
                    <CheckCircle2 size={15} />
                    <span className="selected-item-name">{itemName}</span>
                    <button type="button" className="link-btn" onClick={() => { setItemName(''); setItemCode(''); setItemSearch(''); }}>Change</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Reason for Deletion *</label>
            <textarea
              className="form-input form-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={4}
              maxLength={500}
              placeholder="Explain why this item should be removed (e.g. wrong file, duplicate upload, incorrect course code)…"
            />
            <div className="field-hint char-count">{reason.length}/500</div>
          </div>

          {!itemName.trim() && (
            <div className="form-error-hint">
              <AlertCircle size={13} /> Select the {formType === 'material' ? 'material' : 'course'} you want to remove.
            </div>
          )}

          <button type="submit" className="primary submit-btn form-submit-btn" disabled={submitting || !itemName.trim() || !reason.trim()}>
            {submitting ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : <><Send size={15} /> Submit Request</>}
          </button>
        </form>
      )}

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : requests.length === 0 ? (
        <div className="empty-state-card">
          <FileWarning size={36} />
          <b>No Deletion Requests</b>
          <span>You haven't submitted any deletion requests yet.</span>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="table-scroll-wrapper desktop-only">
            <table className="admin-table">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Item</th><th>Code</th><th>Reason</th><th>Status</th><th>Admin Note</th></tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} onClick={() => setDetailReq(r)} className="clickable-row">
                    <td className="cell-secondary">{timeSince(r.created_at)}</td>
                    <td><span className="field-tag">{r.request_type}</span></td>
                    <td className="cell-bold">{r.item_name}</td>
                    <td className="cell-code">{r.item_code || '—'}</td>
                    <td className="cell-reason">{r.reason}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="cell-note">{r.admin_note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mobile-only request-cards">
            {requests.map((r) => (
              <div key={r.id} className="request-card" onClick={() => setDetailReq(r)}>
                <div className="request-card-header">
                  <div className="cell-bold">{r.item_name}</div>
                  {statusBadge(r.status)}
                </div>
                <div className="request-card-body">
                  <div className="cell-secondary">{r.request_type}{r.item_code ? ` · ${r.item_code}` : ''}</div>
                  <div className="cell-secondary mt-xs">{r.reason}</div>
                </div>
                <div className="request-card-footer">
                  <span className="cell-secondary">{timeSince(r.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {detailReq && (
        <div className="modal-overlay" onClick={() => setDetailReq(null)}>
          <div className="modal-card request-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Deletion Request Details</h3>
              <button className="link-btn" onClick={() => setDetailReq(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="detail-info-grid">
                <div><div className="di-label">Item Name</div><div className="di-value cell-bold">{detailReq.item_name}</div></div>
                <div><div className="di-label">Type</div><div className="di-value capitalize">{detailReq.request_type}</div></div>
                {detailReq.item_code && <div><div className="di-label">Course Code</div><div className="di-value cell-code">{detailReq.item_code}</div></div>}
                <div><div className="di-label">Status</div><div>{statusBadge(detailReq.status)}</div></div>
                <div className="di-full"><div className="di-label">Reason</div><div className="di-value">{detailReq.reason}</div></div>
                <div><div className="di-label">Submitted</div><div className="di-value cell-secondary">{new Date(detailReq.created_at).toLocaleString()}</div></div>
                {detailReq.updated_at && <div><div className="di-label">Last Updated</div><div className="di-value cell-secondary">{new Date(detailReq.updated_at).toLocaleString()}</div></div>}
                {detailReq.admin_note && <div className="di-full"><div className="di-label">Admin Response</div><div className="di-value">{detailReq.admin_note}</div></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Submit"
        onConfirm={confirmState.onConfirm}
        onClose={() => setConfirmState({ ...confirmState, open: false })}
      />
    </div>
  );
}

/* ── Student Change Requests Tab ────────────────────────────── */
function StudentChangeRequestsTab() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState<ProfileChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [fieldName, setFieldName] = useState<ProfileChangeRequest['field_name']>('matric_number');
  const [requestedValue, setRequestedValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [detailReq, setDetailReq] = useState<ProfileChangeRequest | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const { toast } = useToast();

  useEffect(() => { loadRequests(); }, []);

  const loadRequests = async () => {
    try {
      const data = await fetchMyChangeRequests();
      setRequests(data);
    } catch (err: any) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  const currentValue = (() => {
    if (!profile) return '';
    switch (fieldName) {
      case 'matric_number': return profile.matricNumber;
      case 'faculty': return profile.faculty;
      case 'department': return profile.department;
      case 'level': return profile.level;
      default: return '';
    }
  })();

  const fieldLocked = (() => {
    switch (fieldName) {
      case 'matric_number': return true;
      case 'faculty': return !!profile?.faculty;
      case 'department': return !!profile?.department;
      default: return false;
    }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestedValue.trim() || !reason.trim()) return;
    if (requestedValue.trim() === currentValue) { toast('New value must be different from the current value.', 'error'); return; }
    const fieldLabel = fieldLabels[fieldName] || fieldName;
    setConfirmState({
      open: true,
      title: 'Submit Change Request?',
      message: `You are requesting to change your ${fieldLabel} from "${currentValue}" to "${requestedValue.trim()}". An administrator will review this request.`,
      onConfirm: async () => {
        setSubmitting(true);
        try {
          await submitProfileChangeRequest({ field_name: fieldName, current_value: currentValue, requested_value: requestedValue.trim(), reason: reason.trim() });
          toast('Change request submitted successfully.', 'success');
          setRequestedValue(''); setReason(''); setShowForm(false);
          await loadRequests();
        } catch (err: any) { toast(err.message, 'error'); }
        finally { setSubmitting(false); }
      }
    });
  };

  const fieldLabels: Record<string, string> = { matric_number: 'Matric Number', faculty: 'Faculty', department: 'Department', level: 'Level' };
  const statusBadge = (s: string) => <span className={`status-badge ${s}`}>{s}</span>;
  const allDepartments = Array.from(new Set(catalogue.flatMap((f) => f.departments.map((d) => d.name)))).sort();
  const changeableLevels = levelsFor(6);
  const timeSince = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const pending = requests.filter((r) => r.status === 'pending').length;
  const approved = requests.filter((r) => r.status === 'approved').length;
  const rejected = requests.filter((r) => r.status === 'rejected').length;

  return (
    <div className="student-change-requests-tab">
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><UserCog size={22} />Profile Change Requests</h2>
          <p className="page-subtitle">View and track requests submitted to administrators for changes to your academic information.</p>
        </div>
        <button className={showForm ? 'secondary-btn' : 'primary'} onClick={() => setShowForm(!showForm)}>
          {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Request</>}
        </button>
      </div>

      {/* Stat Cards */}
      {!loading && requests.length > 0 && (
        <div className="stat-cards">
          <div className="stat-card"><span className="stat-value">{requests.length}</span><span className="stat-label">Total</span></div>
          <div className="stat-card pending"><span className="stat-value">{pending}</span><span className="stat-label">Pending</span></div>
          <div className="stat-card approved"><span className="stat-value">{approved}</span><span className="stat-label">Approved</span></div>
          <div className="stat-card rejected"><span className="stat-value">{rejected}</span><span className="stat-label">Rejected</span></div>
        </div>
      )}

      <div className="request-info-banner">
        <Info size={14} /> Your matric number is a verified identifier, and your faculty and department are locked once they've been saved. To change any of these, submit a request here and an administrator will review it.
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card request-form-card">
          <div className="form-card-head">
            <span className="form-card-head-icon"><UserCog size={18} /></span>
            <div>
              <h3>Request a Profile Change</h3>
              <p>Ask an administrator to update locked academic information.</p>
            </div>
          </div>
          <div className="form-row-2col">
            <div className="form-field">
              <label className="form-label">Field to Change *</label>
              <select className="form-input" value={fieldName} onChange={(e) => setFieldName(e.target.value as ProfileChangeRequest['field_name'])}>
                <option value="matric_number">Matric Number</option>
                <option value="faculty">Faculty</option>
                <option value="department">Department</option>
                <option value="level">Level</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Current Value</label>
              <input className="form-input input-readonly" value={currentValue || 'Not set yet'} disabled />
              {fieldLocked ? (
                <div className="change-limit-alert">
                  <Lock size={14} /> Locked — admin approval required
                </div>
              ) : (
                <div className="field-hint">Set this now — once saved it becomes locked and requires admin approval to change.</div>
              )}
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Requested New Value *</label>
            {fieldName === 'matric_number' && (
              <input className="form-input" value={requestedValue} onChange={(e) => setRequestedValue(e.target.value)} required placeholder="Enter new matric number" />
            )}
            {fieldName === 'faculty' && (
              <select className="form-input" value={requestedValue} onChange={(e) => setRequestedValue(e.target.value)} required>
                <option value="">Select a faculty…</option>
                {catalogue.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            )}
            {fieldName === 'department' && (
              <select className="form-input" value={requestedValue} onChange={(e) => setRequestedValue(e.target.value)} required>
                <option value="">Select a department…</option>
                {allDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            {fieldName === 'level' && (
              <select className="form-input" value={requestedValue} onChange={(e) => setRequestedValue(e.target.value)} required>
                <option value="">Select a level…</option>
                {changeableLevels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
          </div>
          <div className="form-field">
            <label className="form-label">Reason *</label>
            <textarea
              className="form-input form-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={4}
              maxLength={500}
              placeholder="Explain why you need to change this information…"
            />
            <div className="field-hint char-count">{reason.length}/500 characters</div>
          </div>
          <button type="submit" className="primary submit-btn form-submit-btn" disabled={submitting || !requestedValue.trim() || !reason.trim()}>
            {submitting ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : <><Send size={15} /> Submit Change Request</>}
          </button>
        </form>
      )}

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : requests.length === 0 ? (
        <div className="empty-state-card">
          <UserCog size={36} />
          <b>No Change Requests</b>
          <span>You haven't submitted any profile change requests yet.</span>
        </div>
      ) : (
        <>
          <div className="table-scroll-wrapper desktop-only">
            <table className="admin-table">
              <thead>
                <tr><th>Date</th><th>Field</th><th>Current</th><th>Requested</th><th>Reason</th><th>Status</th><th>Admin Note</th></tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} onClick={() => setDetailReq(r)} className="clickable-row">
                    <td className="cell-secondary">{timeSince(r.created_at)}</td>
                    <td><span className="field-tag">{fieldLabels[r.field_name] || r.field_name}</span></td>
                    <td>{r.current_value}</td>
                    <td className="cell-bold">{r.requested_value}</td>
                    <td className="cell-reason">{r.reason}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="cell-note">{r.admin_note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-only request-cards">
            {requests.map((r) => (
              <div key={r.id} className="request-card" onClick={() => setDetailReq(r)}>
                <div className="request-card-header">
                  <span className="field-tag">{fieldLabels[r.field_name] || r.field_name}</span>
                  {statusBadge(r.status)}
                </div>
                <div className="request-card-body">
                  <div className="request-card-change">
                    <span>{r.current_value}</span>
                    <ChevronRight size={14} />
                    <span className="cell-bold">{r.requested_value}</span>
                  </div>
                  <div className="cell-secondary mt-xs">{r.reason}</div>
                </div>
                <div className="request-card-footer">
                  <span className="cell-secondary">{timeSince(r.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {detailReq && (
        <div className="modal-overlay" onClick={() => setDetailReq(null)}>
          <div className="modal-card request-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Request Details</h3>
              <button className="link-btn" onClick={() => setDetailReq(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="detail-info-grid">
                <div><div className="di-label">Field</div><div><span className="field-tag">{fieldLabels[detailReq.field_name] || detailReq.field_name}</span></div></div>
                <div><div className="di-label">Status</div><div>{statusBadge(detailReq.status)}</div></div>
                <div><div className="di-label">Current Value</div><div className="di-value">{detailReq.current_value}</div></div>
                <div><div className="di-label">Requested Value</div><div className="di-value cell-bold">{detailReq.requested_value}</div></div>
                <div className="di-full"><div className="di-label">Reason</div><div className="di-value">{detailReq.reason}</div></div>
                <div><div className="di-label">Submitted</div><div className="di-value cell-secondary">{new Date(detailReq.created_at).toLocaleString()}</div></div>
                {detailReq.admin_note && <div className="di-full"><div className="di-label">Admin Response</div><div className="di-value">{detailReq.admin_note}</div></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Submit"
        onConfirm={confirmState.onConfirm}
        onClose={() => setConfirmState({ ...confirmState, open: false })}
      />
    </div>
  );
}
