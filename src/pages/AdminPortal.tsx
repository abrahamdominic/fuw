import React, { useState, useEffect, useCallback } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { supabase, requireSupabase } from '../lib/supabase';
import {
  LayoutDashboard,
  Home,
  Compass,
  Bed,
  FileText,
  Upload,
  Users,
  BadgeCheck,
  Crown,
  Building2,
  GraduationCap,
  Bookmark,
  ShieldCheck,
  Settings,
  LogOut,
  Search,
  Plus,
  Minus,
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
  Store,
  Sparkles,
  Check,
  Info,
  Globe,
  Mail,
  Phone,
  MapPin,
  Laptop,
  Smartphone,
  Tablet,
  List,
  Loader2,
  FileWarning,
  MessageSquare,
  Send,
  UserCog,
  Pencil,
  ArrowLeft,
  Calendar,
  Archive,
  Layers,
  HelpCircle,
  CalendarRange,
  Briefcase,
  SearchX,
  BookOpen,
  UserPlus
} from 'lucide-react';
import { fx, staggerDelay } from '../lib/motion';
import { AnimatedModal } from '../components/animations/AnimatedModal';
import { useStore } from '../lib/useStore';
import { useLiveCatalogue } from '../lib/useLiveCatalogue';
import { AuditLogItem, MaterialItem } from '../lib/store';
import { Logo } from '../components/Logo';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { catalogue, materialTypes, courseTitleByCode } from '../data/catalogue';
import { useAuth } from '../lib/AuthContext';
import { MessageComposer } from '../components/MessageComposer';
import { MessageText } from '../components/MessageText';
import { messagePreview, richPasteText, capLength, MESSAGE_MAX_LENGTH } from '../lib/messageFormat';
import { roleLabel, can } from '../lib/rbac';
import {
  submitMaterial as submitMaterialDb,
  approveMaterial as approveMaterialDb,
  rejectMaterial as rejectMaterialDb,
  deleteMaterial as deleteMaterialDb,
  fetchMaterials,
  type DepartmentOption
} from '../lib/materials';
import { DepartmentAssigner } from '../components/DepartmentAssigner';
import { EditMaterialModal } from '../components/EditMaterialModal';
import { AssignedDepartmentsModal } from '../components/AssignedDepartmentsModal';
import { aiProcessMaterial } from '../lib/ai';
import { ConfirmDialog, ConfirmDialogState, PromptDialog } from '../components/ConfirmDialog';
import ProtectedActionModal from '../components/ProtectedActionModal';
import { AdminAcademicsModule } from '../components/AdminAcademics';
import { LecturerOnboardModal, type LecturerOnboardTarget } from '../components/LecturerOnboardModal';
import { AuthenticatorAppCard } from '../components/AuthenticatorAppCard';
import { PasskeysManager } from '../components/PasskeysManager';
import { DashboardSearch } from '../components/DashboardSearch';
import { useToast } from '../components/Toast';
import { fetchMaintenanceStatus, MaintenanceStatus } from '../lib/maintenance';
import { fetchAllDeletionRequests, updateDeletionRequestStatus, DeletionRequest } from '../lib/deletionRequests';
import { fetchConversations, fetchMessages, sendMessage, markConversationRead, startConversation, Conversation, Message } from '../lib/messages';
import { fetchAllChangeRequests, approveProfileChangeRequest, rejectProfileChangeRequest, ProfileChangeRequest } from '../lib/profileChangeRequests';
import { fetchAllSessions, terminateSession as terminateSessionDb, ActiveSession } from '../lib/sessions';
import { fetchGenderCounts, fetchMaterialsByFaculty, fetchMaterialsByDepartment, fetchAnalyticsDashboard, fetchTopMaterials, fetchRecentAnalyticsEvents, purgeAnalyticsData, fetchSearchInsights, type SearchInsights } from '../lib/analytics';
import { AnalyticsChart, AnalyticsDatum } from '../components/AnalyticsCharts';
import type { AnalyticsDashboard, TopMaterialRow, RecentAnalyticsEventRow } from '../lib/analyticsTypes';
import {
  AdminRepositoryTab,
  AdminCollectionsTab,
  AdminCopyrightReportsTab,
  AdminHelpTab,
  AdminAnnouncementsTab
} from './AdminRepositoryTabs';
import { AdminVerificationTab } from './AdminVerificationTab';
import { AdminPlansTab } from './AdminPlansTab';
import { AdminCampusTab } from './AdminCampusTab';
import { AdminAccommodationTab } from './AdminAccommodationTab';

interface AdminPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

const adminNavItems = [
  { label: 'Campus Hub', path: '/hub', icon: Compass, permission: null },
  { label: 'Overview', path: '/admin', icon: LayoutDashboard, exact: true, permission: null },
  { label: 'Materials & Approvals', path: '/admin/materials', icon: FileText, permission: null },
  { label: 'Upload material', path: '/admin/upload', icon: Upload, permission: 'upload_as_approved' },
  { label: 'Repository', path: '/admin/repository', icon: Archive, permission: 'manage_catalogue' },
  { label: 'Collections', path: '/admin/collections', icon: Layers, permission: 'manage_catalogue' },
  { label: 'Copyright reports', path: '/admin/copyright-reports', icon: FileWarning, permission: 'manage_students' },
  { label: 'Help center', path: '/admin/help', icon: HelpCircle, permission: 'manage_students' },
  { label: 'Announcements', path: '/admin/announcements', icon: Bell, permission: 'manage_students' },
  { label: 'Search & indexing', path: '/admin/ai', icon: Database, permission: 'manage_ai' },
  { label: 'Students & users', path: '/admin/users', icon: Users, permission: 'manage_students' },
  { label: 'Deletion requests', path: '/admin/deletion-requests', icon: FileWarning, permission: 'manage_students' },
  { label: 'Profile change requests', path: '/admin/change-requests', icon: UserCog, permission: 'manage_students' },
  { label: 'Verification queue', path: '/admin/verification', icon: BadgeCheck, permission: 'manage_students' },
  { label: 'Premium plans', path: '/admin/plans', icon: Crown, permission: 'manage_students' },
  { label: 'Student messages', path: '/admin/messages', icon: MessageSquare, permission: 'manage_students' },
  { label: 'Active sessions', path: '/admin/sessions', icon: Laptop, permission: 'manage_students' },
  { label: 'Faculties', path: '/admin/faculties', icon: Building2, permission: 'manage_catalogue' },
  { label: 'Departments', path: '/admin/departments', icon: Building2, permission: 'manage_catalogue' },
  { label: 'Courses & levels', path: '/admin/courses', icon: GraduationCap, permission: 'manage_catalogue' },
  { label: 'Student Courses', path: '/admin/student-courses', icon: List, permission: 'manage_catalogue' },
  { label: 'Categories & sessions', path: '/admin/categories', icon: Bookmark, permission: 'manage_catalogue' },
  { label: 'Academic records', path: '/admin/academics', icon: GraduationCap, permission: null },
  { label: 'Events', path: '/admin/events', icon: CalendarRange, permission: 'manage_events' },
  { label: 'Organizations', path: '/admin/organizations', icon: Users, permission: 'manage_organizations' },
  { label: 'Jobs & Gigs', path: '/admin/jobs', icon: Briefcase, permission: 'moderate_jobs' },
  { label: 'Lost & Found', path: '/admin/lost-found', icon: SearchX, permission: 'moderate_lost_found' },
  { label: 'Study Groups', path: '/admin/study-groups', icon: BookOpen, permission: 'manage_study_groups' },
  { label: 'Skills & Learning', path: '/admin/learning', icon: GraduationCap, permission: 'manage_learning' },
  { label: 'Accommodation', path: '/admin/accommodation', icon: Bed, permission: null },
  { label: 'Platform reports', path: '/admin/reports', icon: AlertTriangle, permission: 'moderate_reports' },
  { label: 'Audit logs', path: '/admin/logs', icon: ShieldCheck, permission: 'view_analytics' },
  { label: 'Usage analytics', path: '/admin/usage-analytics', icon: BarChart3, permission: 'view_analytics' },
  { label: 'Settings', path: '/admin/settings', icon: Settings, permission: null }
];

export function AdminPortal({ onReadOnline }: AdminPortalProps) {
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut, profile, hasPermission, role, isSuperAdmin } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [auditActors, setAuditActors] = useState<Record<string, AuditActorProfile>>({});
  // Marketplace staff grants come from `marketplace_admin_staff` (a separate
  // authority from the platform admin role). Vendor-verification requests are
  // reviewed in the Marketplace Admin Portal, so only show the link to admins
  // who actually hold a marketplace staff grant.
  const [isMarketplaceStaff, setIsMarketplaceStaff] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!supabase) {
          if (mounted) setIsMarketplaceStaff(false);
          return;
        }
        const res = await supabase.rpc('mp_is_staff');
        if (mounted) setIsMarketplaceStaff(Boolean(res.data));
      } catch {
        if (mounted) setIsMarketplaceStaff(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  // Confirmation dialog for destructive actions
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    tone?: 'danger' | 'default';
    confirmLabel?: string;
    action: () => void | Promise<void>;
  } | null>(null);

  // Modern "verify protected action" dialog for the most sensitive actions.
  const [protectedConfirm, setProtectedConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    item?: string;
    tone?: 'danger' | 'warning' | 'primary';
    confirmLabel?: string;
    confirmKeyword?: string;
    badge?: string;
    action: () => void | Promise<void>;
  } | null>(null);

  const [, setStoreVersion] = useState(0);

  // Pull fresh live data from Supabase whenever the admin portal opens
  useEffect(() => {
    store.syncMaterialsFromSupabase();
    store.fetchUserStats();
    const unsubscribe = store.subscribe(() => {
      setStoreVersion((v) => v + 1);
    });
    return unsubscribe;
  }, []);

  const currentUser = store.getCurrentUser();
  const allMaterials = store.getAllMaterials();
  const pendingMaterials = store.getPendingMaterials();
  const approvedMaterials = store.getApprovedMaterials();
  const rejectedMaterials = store.getRejectedMaterials();
  const auditLogs = store.getAuditLogs();
  const auditActorIds = [...new Set(
    auditLogs.map((log) => log.performedById).filter((id): id is string =>
      !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
  )];
  const auditActorIdsKey = auditActorIds.join('|');
  const stats = store.getSystemStats();

  const currentPath = location.pathname;

  useEffect(() => {
    if (!supabase || !auditActorIdsKey) {
      setAuditActors({});
      return;
    }
    let active = true;
    const ids = auditActorIdsKey.split('|');
    void supabase
      .from('profiles')
      .select('id, full_name, username, matric_number, email, role')
      .in('id', ids)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          toast('Could not load audit account details.', 'error');
          setAuditActors({});
          return;
        }
        setAuditActors(Object.fromEntries((data || []).map((row) => [row.id, row])));
      });
    return () => {
      active = false;
    };
  }, [auditActorIdsKey, toast]);

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
      toast(err?.message || 'Action failed. Check your permissions.', 'error');
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
    setProtectedConfirm({
      open: true,
      title: 'Delete this material?',
      tone: 'danger',
      message:
        'This material will be permanently removed from the library along with its stored file. Students will no longer be able to access it.',
      item: m.title,
      confirmKeyword: 'DELETE',
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
          <Link className="brand" to="/admin" onClick={() => setMobileMenuOpen(false)} title="Admin Portal">
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
          {isMarketplaceStaff && (
            <NavLink
              to="/marketplace/admin?tab=verifications"
              className={`side-link ${currentPath.startsWith('/marketplace/admin') ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
              title="Review vendor verification requests in the Marketplace Admin Portal"
            >
              <Store size={17} />
              <span>Vendor verification</span>
            </NavLink>
          )}
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
            className="side-link logout-link logout-btn"
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
          <div className="portal-mobile-actions">
            <Link to="/hub" className="portal-mobile-upload" title="Return to Campus Hub" aria-label="Campus Hub Home">
              <Home size={16} />
            </Link>
            <Link to="/admin/upload" className="portal-mobile-upload">
              <Upload size={16} />
            </Link>
            <button
              type="button"
              className="portal-mobile-logout"
              onClick={handleAdminLogout}
              aria-label="Sign out / Exit"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
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
        ) : currentPath.startsWith('/admin/repository') ? (
          hasPermission('manage_catalogue') ? (
            <AdminRepositoryTab />
          ) : (
            <div className="empty-state card-empty">
              <Lock size={40} />
              <b>Repository management is restricted.</b>
              <span>Your account does not have the "Manage catalogue" permission.</span>
            </div>
          )
        ) : currentPath.startsWith('/admin/collections') ? (
          <AdminCollectionsTab />
        ) : currentPath.startsWith('/admin/copyright-reports') ? (
          <AdminCopyrightReportsTab />
        ) : currentPath.startsWith('/admin/help') ? (
          hasPermission('manage_students') ? (
            <AdminHelpTab />
          ) : (
            <div className="empty-state card-empty">
              <Lock size={40} />
              <b>Help center management is restricted.</b>
              <span>Your account does not have the "Manage students" permission.</span>
            </div>
          )
        ) : currentPath.startsWith('/admin/announcements') ? (
          hasPermission('manage_students') ? (
            <AdminAnnouncementsTab />
          ) : (
            <div className="empty-state card-empty">
              <Lock size={40} />
              <b>Announcement management is restricted.</b>
              <span>Your account does not have the "Manage students" permission.</span>
            </div>
          )
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
        ) : currentPath.startsWith('/admin/deletion-requests') ? (
          <AdminDeletionRequestsTab />
        ) : currentPath.startsWith('/admin/plans') ? (
          <AdminPlansTab />
        ) : currentPath.startsWith('/admin/verification') ? (
          <AdminVerificationTab />
        ) : currentPath.startsWith('/admin/change-requests') ? (
          <AdminChangeRequestsTab />
        ) : currentPath.startsWith('/admin/messages') ? (
          <AdminMessagesTab />
        ) : currentPath.startsWith('/admin/sessions') ? (
          <AdminActiveSessionsTab />
        ) : currentPath.startsWith('/admin/faculties') ? (
          <AdminFacultiesTab />
        ) : currentPath.startsWith('/admin/departments') ? (
          <AdminDepartmentsTab />
        ) : currentPath.startsWith('/admin/courses') ? (
          <AdminCoursesTab />
        ) : currentPath.startsWith('/admin/student-courses') ? (
          <AdminStudentCoursesTab />
        ) : currentPath.startsWith('/admin/categories') ? (
          <AdminCategoriesTab />
        ) : currentPath.startsWith('/admin/logs') ? (
          <AdminAuditLogsTab logs={auditLogs} actors={auditActors} />
        ) : currentPath.startsWith('/admin/usage-analytics') ? (
          <AdminUsageAnalyticsTab />
        ) : currentPath.startsWith('/admin/settings') ? (
          <AdminSettingsTab />
        ) : currentPath.startsWith('/admin/academics') ? (
          <AdminAcademicsModule />
        ) : currentPath.startsWith('/admin/events') ? (
          can(profile, 'manage_events') ? <AdminCampusTab module="events" /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : currentPath.startsWith('/admin/organizations') ? (
          can(profile, 'manage_organizations') ? <AdminCampusTab module="organizations" /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : currentPath.startsWith('/admin/jobs') ? (
          can(profile, 'moderate_jobs') ? <AdminCampusTab module="jobs" /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : currentPath.startsWith('/admin/lost-found') ? (
          can(profile, 'moderate_lost_found') ? <AdminCampusTab module="lost-found" /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : currentPath.startsWith('/admin/study-groups') ? (
          can(profile, 'manage_study_groups') ? <AdminCampusTab module="study-groups" /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : currentPath.startsWith('/admin/learning') ? (
          can(profile, 'manage_learning') ? <AdminLearningStubTab /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : currentPath.startsWith('/admin/accommodation') || currentPath.startsWith('/admin/services') ? (
          <AdminAccommodationTab />
        ) : currentPath.startsWith('/admin/reports') ? (
          can(profile, 'moderate_reports') ? <AdminCampusTab module="reports" /> : <div className="portal-empty"><ShieldAlert size={32} className="empty-icon" /><p>You do not have permission to access this section.</p></div>
        ) : (
          <AdminOverviewTab
            stats={stats}
            pendingCount={pendingMaterials.length}
            auditLogs={auditLogs}
            auditActors={auditActors}
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

        {/* Modern "verify protected action" dialog */}
        <ProtectedActionModal
          isOpen={protectedConfirm?.open ?? false}
          title={protectedConfirm?.title ?? ''}
          message={protectedConfirm?.message ?? ''}
          item={protectedConfirm?.item}
          tone={protectedConfirm?.tone ?? 'danger'}
          confirmLabel={protectedConfirm?.confirmLabel}
          confirmKeyword={protectedConfirm?.confirmKeyword}
          badge={protectedConfirm?.badge}
          onConfirm={protectedConfirm?.action ?? (() => {})}
          onClose={() => setProtectedConfirm(null)}
        />
      </main>
    </div>
  );
}

interface AuditActorProfile {
  id: string;
  full_name: string | null;
  username: string | null;
  matric_number: string | null;
  email: string | null;
  role: string | null;
}

function AuditActor({ log, actors }: { log: AuditLogItem; actors: Record<string, AuditActorProfile> }) {
  const actor = log.performedById ? actors[log.performedById] : undefined;
  if (actor) {
    return (
      <span className="audit-actor">
        <b>{actor.full_name || actor.username || 'Account holder'}</b>
        {actor.matric_number && <small>Matric: {actor.matric_number}</small>}
        <small>{[actor.role, actor.email].filter(Boolean).join(' · ')}</small>
      </span>
    );
  }
  const legacyName = log.performedBy && !/^[0-9a-f-]{30,}$/i.test(log.performedBy)
    ? log.performedBy
    : 'Former or unavailable account';
  return <span>{legacyName}</span>;
}

// 1. Admin Overview Tab
function AdminOverviewTab({
  stats,
  pendingCount,
  auditLogs,
  auditActors,
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

  // Live analytics: gender distribution + material volume by faculty and
  // department, aggregated server-side and refreshed on an interval.
  const analyticsBusy = React.useRef(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [genderData, setGenderData] = useState<AnalyticsDatum[]>([]);
  const [facultyData, setFacultyData] = useState<AnalyticsDatum[]>([]);
  const [deptData, setDeptData] = useState<AnalyticsDatum[]>([]);

  const loadAnalytics = React.useCallback(async () => {
    if (analyticsBusy.current) return;
    analyticsBusy.current = true;
    try {
      const [gRes, fRes, dRes] = await Promise.allSettled([
        fetchGenderCounts(),
        fetchMaterialsByFaculty(),
        fetchMaterialsByDepartment()
      ]);
      if (gRes.status === 'fulfilled') {
        setGenderData(gRes.value.map((row) => ({ label: row.gender, value: row.count })));
      }
      if (fRes.status === 'fulfilled') {
        setFacultyData(fRes.value.map((row) => ({ label: row.name, value: row.count })));
      }
      if (dRes.status === 'fulfilled') {
        setDeptData(dRes.value.map((row) => ({ label: row.name, value: row.count })));
      }
    } catch {
      // Keep previous values on a refresh failure; first load falls back to
      // the empty state so the dashboard never crashes on a hiccup.
    } finally {
      analyticsBusy.current = false;
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
    const id = window.setInterval(loadAnalytics, 60000);
    return () => window.clearInterval(id);
  }, [loadAnalytics]);

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
        <section className={fx.fadeUp} style={staggerDelay(0, 50)}>
          <Users />
          <b>{stats.studentsCount.toLocaleString()}</b>
          <span>Registered students</span>
        </section>
            <section className={fx.fadeUp} style={staggerDelay(1, 50)}>
              <ShieldCheck />
              <b>{stats.verifiedStudents.toLocaleString()}</b>
              <span>Verified students</span>
            </section>
            <section className={fx.fadeUp} style={staggerDelay(2, 50)}>
              <FileText />
              <b>{stats.approvedMaterials}</b>
              <span>Approved materials</span>
            </section>
            <section className={fx.fadeUp} style={staggerDelay(3, 50)}>
              <Clock />
              <b>{pendingCount}</b>
              <span>Pending approval</span>
            </section>
            <section className={fx.fadeUp} style={staggerDelay(4, 50)}>
              <Building2 />
              <b>{stats.facultiesCount}</b>
              <span>Faculties</span>
            </section>
            <section className={fx.fadeUp} style={staggerDelay(5, 50)}>
              <GraduationCap />
              <b>{stats.departmentsCount}</b>
              <span>Departments</span>
            </section>
            <section className={fx.fadeUp} style={staggerDelay(6, 50)}>
              <Download />
              <b>{stats.totalDownloads.toLocaleString()}</b>
              <span>Total downloads</span>
            </section>
            <section className={fx.fadeUp} style={staggerDelay(7, 50)}>
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

      {/* Student Demographics — real gender distribution from profiles */}
      <div className="analytics-block">
        <div className="analytics-block-head">
          <p className="kicker">LIVE STUDENT DATA</p>
          <h2>Student Demographics</h2>
          <p>Distribution of registered student accounts, aggregated live from the database.</p>
        </div>
        <div className="analytics-grid">
          <AnalyticsChart
            title="Students by Gender"
            description="Total registered students by gender."
            items={genderData.map((d) =>
              d.label === 'Male'
                ? { ...d, color: 'linear-gradient(180deg, #5aa7f8 0%, #2563eb 100%)' }
                : d.label === 'Female'
                  ? { ...d, color: 'linear-gradient(180deg, #f485b8 0%, #db2777 100%)' }
                  : d
            )}
            loading={analyticsLoading}
            emptyText="No gender data recorded yet."
            valueLabel="students"
          />
        </div>
      </div>

      {/* Material Analytics — uploaded volume by faculty & department */}
      <div className="analytics-block">
        <div className="analytics-block-head">
          <p className="kicker">REPOSITORY ANALYTICS</p>
          <h2>Material Analytics</h2>
          <p>Materials uploaded across the university, grouped by faculty and department.</p>
        </div>
        <div className="analytics-grid">
          <AnalyticsChart
            title="Materials Uploaded by Faculty"
            description="Total uploads grouped by faculty."
            items={facultyData}
            loading={analyticsLoading}
            horizontal
            emptyText="No materials uploaded yet."
            valueLabel="materials"
          />
          <AnalyticsChart
            title="Materials Uploaded by Department"
            description="Total uploads grouped by department."
            items={deptData}
            loading={analyticsLoading}
            horizontal
            emptyText="No materials uploaded yet."
            valueLabel="materials"
          />
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
              <AuditActor log={log} actors={auditActors || {}} />
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
  const [editingMaterial, setEditingMaterial] = useState<MaterialItem | null>(null);
  const [deptListModalMaterial, setDeptListModalMaterial] = useState<MaterialItem | null>(null);

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
        m.faculty.toLowerCase().includes(q) ||
        m.assignedDepartments?.some(
          (d) => d.name.toLowerCase().includes(q) || d.facultyName?.toLowerCase().includes(q)
        ) ||
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
          displayed.map((m) => {
            const depts =
              m.assignedDepartments && m.assignedDepartments.length > 0
                ? m.assignedDepartments
                : [{ id: '', name: m.department, facultyName: m.faculty }];

            return (
              <div className="tr admin-materials-grid" key={m.id}>
                <span>
                  <b>{m.title}</b>
                  <small>{m.course} · {m.type} · {m.fileSize}</small>
                </span>
                <span>
                  {depts.length === 1 ? (
                    <>
                      <b>{depts[0].name}</b>
                      <small>{m.level} · {depts[0].facultyName || m.faculty}</small>
                    </>
                  ) : depts.length === 2 ? (
                    <>
                      <b>{depts[0].name}, {depts[1].name}</b>
                      <small>{m.level} · Multi-Department</small>
                    </>
                  ) : (
                    <>
                      <b>{depts[0].name}, {depts[1].name}</b>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <button
                          type="button"
                          onClick={() => setDeptListModalMaterial(m)}
                          style={{
                            background: '#eaf3ec',
                            border: '1px solid #cbe3d1',
                            color: '#0B6B3A',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '10px',
                            cursor: 'pointer'
                          }}
                          title="Click to see all assigned departments"
                        >
                          +{depts.length - 2} more
                        </button>
                        <small style={{ color: '#666' }}>· {m.level}</small>
                      </div>
                    </>
                  )}
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

                  <button
                    className="action-icon-btn edit"
                    onClick={() => setEditingMaterial(m)}
                    title="Edit material details & assigned departments"
                  >
                    <Pencil size={15} />
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
            );
          })
        )}
      </div>

      {/* Edit Material Modal */}
      <EditMaterialModal
        isOpen={!!editingMaterial}
        material={editingMaterial}
        onClose={() => setEditingMaterial(null)}
        onSaved={() => {
          setEditingMaterial(null);
        }}
      />

      {/* Assigned Departments Viewer Modal */}
      <AssignedDepartmentsModal
        isOpen={!!deptListModalMaterial}
        material={deptListModalMaterial}
        onClose={() => setDeptListModalMaterial(null)}
      />

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

  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [level, setLevel] = useState('100 Level');
  const [semester, setSemester] = useState('First Semester');
  const [materialType, setMaterialType] = useState(materialTypes[0] || 'Lecture Note');
  const [academicSession, setAcademicSession] = useState('2025/2026');

  const [assignedDepartments, setAssignedDepartments] = useState<DepartmentOption[]>([
    { id: '', name: 'Computer Science', facultyName: 'Faculty of Computing' }
  ]);

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

    if (assignedDepartments.length === 0) {
      setMessage({ type: 'error', text: 'Please assign this material to at least one department.' });
      return;
    }

    setBusy(true);
    setMessage(null);

    const primaryDept = assignedDepartments[0].name;
    const primaryFaculty = assignedDepartments[0].facultyName || 'General Faculty';
    const departmentIds = assignedDepartments.map((d) => d.id).filter(Boolean);

    try {
      // Database-first publish: admins with the "upload_as_approved" permission
      // have their submissions approved immediately; others go to the queue.
      await submitMaterialDb({
        title,
        description,
        faculty: primaryFaculty,
        department: primaryDept,
        department_ids: departmentIds,
        course_code: courseCode.trim() || 'GEN 101',
        course_title: courseTitle.trim() || (courseCode ? courseTitleByCode(courseCode) : undefined),
        level,
        semester,
        material_type: materialType,
        academic_session: academicSession,
        file,
        admin: true
      });
      void store.syncMaterialsFromSupabase();

      toast('Material published successfully! It is now live in all assigned department catalogues.', 'success');
      setMessage({
        type: 'success',
        text: `Material successfully published! Assigned to ${assignedDepartments.length} department${assignedDepartments.length > 1 ? 's' : ''} and immediately accessible in the library.`
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
            Admin published materials are automatically approved and instantly made live across all assigned departments and the public library.
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
                placeholder="e.g. CSC 201: Data Structures and Algorithms"
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '8px' }}>
              <label>
                Course Code
                <input
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="e.g. CSC 201"
                />
              </label>

              <label>
                Course Title
                <input
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="e.g. Data Structures"
                />
              </label>

              <label>
                Level
                <select value={level} onChange={(e) => setLevel(e.target.value)}>
                  {['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', '600 Level'].map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Semester
                <select value={semester} onChange={(e) => setSemester(e.target.value)}>
                  <option value="First Semester">First Semester</option>
                  <option value="Second Semester">Second Semester</option>
                </select>
              </label>

              <label>
                Material Type
                <select value={materialType} onChange={(e) => setMaterialType(e.target.value)}>
                  {materialTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Academic Session
                <input
                  value={academicSession}
                  onChange={(e) => setAcademicSession(e.target.value)}
                  placeholder="2025/2026"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <h3>2. Department & Faculty Assignment</h3>
            <DepartmentAssigner
              selectedDepartments={assignedDepartments}
              onChange={setAssignedDepartments}
              error={assignedDepartments.length === 0 ? 'Please assign this material to at least one department.' : null}
            />
          </div>

          <div className="form-section">
            <h3>3. Academic Document File</h3>
            <div className="drop file-dropzone">
              <Upload size={32} />
              <b>{file ? file.name : 'Select or drop academic resource file'}</b>
              <span>PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX (Up to 25 MB)</span>
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
              {busy ? 'Publishing live…' : 'Publish Material to Assigned Departments'}
            </button>
            <span className="submit-hint">Material will be immediately live and searchable across assigned departments.</span>
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
          [m.id]: { ok: true, text: `Indexed successfully: ${res.chunks ?? '?'} text chunks embedded.` }
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
          <Database size={40} />
          <b>No approved materials available.</b>
          <span>Only approved materials can be indexed for search.</span>
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
                    <Database size={13} />
                    {processingId === m.id ? 'Processing…' : 'Index Material'}
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
  role: 'student' | 'admin' | 'lecturer' | 'super_admin';
  verified: boolean | null;
  has_golden_badge?: boolean | null;
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
  const [onboardModalOpen, setOnboardModalOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<LecturerOnboardTarget | null>(null);

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
        .select('id, full_name, email, matric_number, faculty, department, level, role, verified, has_golden_badge, created_at')
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

  // Role changes go through SECURITY DEFINER RPCs so that plain administrators
  // (who cannot UPDATE another user's profile row under RLS) can still manage
  // roles without the update being silently rejected.
  const handleToggleRole = async (u: AdminUserRow) => {
    if (!supabase) return;
    setBusyId(u.id);
    try {
      if (u.role === 'admin') {
        const { error } = await supabase.rpc('demote_admin', { target_user_id: u.id });
        if (error) throw error;
        setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, role: 'student' } : row)));
        toast(`${u.full_name || u.email} is now a student.`, 'success');
      } else if (u.role === 'lecturer') {
        const { error } = await supabase.rpc('admin_demote_lecturer', { target_user_id: u.id });
        if (error) throw error;
        setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, role: 'student' } : row)));
        toast(`${u.full_name || u.email} lecturer role removed. Account set to student.`, 'success');
      } else {
        const { error } = await supabase.rpc('promote_to_admin', { target_user_id: u.id, admin_permissions: [] });
        if (error) throw error;
        setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, role: 'admin' } : row)));
        toast(`${u.full_name || u.email} is now an administrator.`, 'success');
      }
    } catch (err: any) {
      toast(err?.message || 'Role update was blocked by database security policies.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Verification is likewise RPC-guarded and notifies the affected user.
  const handleToggleVerified = async (u: AdminUserRow) => {
    if (!supabase) return;
    const nextVerified = u.verified !== true;

    setBusyId(u.id);
    try {
      const { error } = await supabase.rpc('admin_set_user_verified', {
        p_user_id: u.id,
        p_verified: nextVerified
      });
      if (error) {
        toast('Verification update was blocked by database security policies.', 'error');
      } else {
        setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, verified: nextVerified } : row)));
        toast(
          `${u.full_name || u.email} is now ${nextVerified ? 'verified' : 'unverified'}.`,
          'success'
        );
      }
    } catch {
      toast('Network error while updating verification.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleGoldenBadge = async (u: AdminUserRow) => {
    if (!supabase) return;
    const nextGolden = u.has_golden_badge !== true;
    setBusyId(u.id);
    try {
      const { error } = await supabase.rpc('admin_set_golden_badge', {
        p_user_id: u.id,
        p_enabled: nextGolden
      });
      if (error) {
        toast('Golden badge update failed: ' + error.message, 'error');
      } else {
        setUsers((prev) => prev.map((row) => (row.id === u.id ? { ...row, has_golden_badge: nextGolden } : row)));
        toast(
          `${u.full_name || u.email} ${nextGolden ? 'granted' : 'revoked'} Golden Honor Badge.`,
          'success'
        );
      }
    } catch {
      toast('Network error while updating golden badge.', 'error');
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
          <p className="subtitle">Live registered accounts from the university database with librarian and lecturer management.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setConvertTarget(null);
              setOnboardModalOpen(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <UserPlus size={15} /> Onboard Lecturer
          </button>
          <button type="button" className="outline-btn" onClick={loadUsers} disabled={isLoading}>
            <RefreshCw size={15} className={isLoading ? 'spin-icon' : ''} /> Refresh List
          </button>
        </div>
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
            const verified = u.verified === true;
            const joined = u.created_at
              ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
              : '-';
            return (
              <div className="tr users-table-grid" key={u.id}>
                <span>
                  <b>{u.full_name || 'Unnamed account'}</b>
                  <small>{u.email}</small>
                  <small className="block-text opacity-70">Joined {joined}</small>
                </span>
                <span>{u.matric_number || 'Not submitted'}</span>
                <span>
                  {u.department || '-'} · {u.level || '-'}
                  <small className="block-text opacity-70">{u.faculty || ''}</small>
                </span>
                <span>
                  <span className={`role-pill ${u.role}`}>{u.role.toUpperCase()}</span>
                </span>
                <span>
                  <span className={`status-badge ${verified ? 'approved' : 'pending'}`}>
                    {verified ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                    {verified ? 'VERIFIED' : u.matric_number ? 'UNVERIFIED' : 'PROFILE INCOMPLETE'}
                  </span>
                  {u.has_golden_badge && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        marginTop: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fcd34d',
                        fontSize: 10,
                        fontWeight: 700
                      }}
                      title="Golden Honor Scholar Badge (Granted by Administration)"
                    >
                      <Sparkles size={11} color="#b45309" /> GOLDEN BADGE
                    </span>
                  )}
                </span>
                <span className="table-action-stack">
                  {u.role === 'admin' ? (
                    <button
                      className="table-action-btn"
                      disabled={busyId === u.id}
                      onClick={() => setRoleChangeTarget(u)}
                      title="Demote this account to student"
                    >
                      {busyId === u.id ? 'Updating…' : 'Set as Student'}
                    </button>
                  ) : u.role === 'lecturer' ? (
                    <button
                      className="table-action-btn"
                      disabled={busyId === u.id}
                      onClick={() => setRoleChangeTarget(u)}
                      title="Demote lecturer account to student"
                    >
                      {busyId === u.id ? 'Updating…' : 'Demote to Student'}
                    </button>
                  ) : (
                    <>
                      <button
                        className="table-action-btn"
                        disabled={busyId === u.id}
                        onClick={() => setRoleChangeTarget(u)}
                        title="Promote this account to administrator"
                      >
                        {busyId === u.id ? 'Updating…' : 'Make Admin'}
                      </button>
                      <button
                        className="table-action-btn outline"
                        disabled={busyId === u.id}
                        onClick={() =>
                          setConvertTarget({
                            id: u.id,
                            fullName: u.full_name,
                            email: u.email,
                            faculty: u.faculty,
                            department: u.department
                          })
                        }
                        title="Convert this account to a Lecturer"
                      >
                        Make Lecturer
                      </button>
                    </>
                  )}
                  <button
                    className={`table-action-btn ${verified ? 'outline' : ''}`}
                    disabled={busyId === u.id}
                    onClick={() => void handleToggleVerified(u)}
                    title={verified ? 'Remove verified status from this account' : 'Mark this account as verified'}
                  >
                    {verified ? 'Unverify' : 'Verify'}
                  </button>
                  <button
                    className={`table-action-btn ${u.has_golden_badge ? 'outline' : ''}`}
                    disabled={busyId === u.id}
                    onClick={() => void handleToggleGoldenBadge(u)}
                    title={u.has_golden_badge ? 'Revoke Golden Honor Badge' : 'Grant Golden Honor Badge'}
                  >
                    {u.has_golden_badge ? 'Revoke Gold' : 'Grant Gold'}
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
        title={
          roleChangeTarget?.role === 'admin'
            ? 'Demote administrator account?'
            : roleChangeTarget?.role === 'lecturer'
              ? 'Demote lecturer account?'
              : 'Grant administrator rights?'
        }
        tone={roleChangeTarget?.role === 'admin' || roleChangeTarget?.role === 'lecturer' ? 'danger' : 'default'}
        confirmLabel={
          roleChangeTarget?.role === 'admin' || roleChangeTarget?.role === 'lecturer'
            ? 'Set as Student'
            : 'Make Admin'
        }
        message={
          roleChangeTarget
            ? `Change ${roleChangeTarget.full_name || roleChangeTarget.email} from "${roleChangeTarget.role}" to "student"? Database security policies protect this action.`
            : ''
        }
        onConfirm={() => {
          if (roleChangeTarget) void handleToggleRole(roleChangeTarget);
          setRoleChangeTarget(null);
        }}
        onClose={() => setRoleChangeTarget(null)}
      />

      {/* Lecturer Onboarding / Conversion Modal */}
      <LecturerOnboardModal
        isOpen={onboardModalOpen || !!convertTarget}
        targetUser={convertTarget}
        onClose={() => {
          setOnboardModalOpen(false);
          setConvertTarget(null);
        }}
        onSuccess={() => void loadUsers()}
      />
    </div>
  );
}

// 5. Admin Faculties Tab
function AdminFacultiesTab() {
  const store = useStore();
  const { catalogue: liveCatalogue } = useLiveCatalogue();
  const [expanded, setExpanded] = useState<string | null>(null);
  const approved = React.useMemo(() => store.getApprovedMaterials(), []);

  const countFaculty = (name: string) => approved.filter((m) => m.faculty === name).length;
  const countDept = (fac: string, dep: string) =>
    approved.filter((m) => m.faculty === fac && m.department === dep).length;

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC STRUCTURE</p>
          <h1>Faculties directory ({liveCatalogue.length})</h1>
          <p className="subtitle">Click a faculty to see its departments, course counts and associated library materials.</p>
        </div>
      </div>

      <div className="grid faculty-grid">
        {liveCatalogue.map((f, i) => {
          const open = expanded === f.name;
          const matCount = countFaculty(f.name);
          return (
            <div className={`faculty admin-faculty-card${open ? ' open' : ''}`} key={f.name}>
              <button
                type="button"
                className="faculty-toggle"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : f.name)}
              >
                <span className="faculty-toggle-head">
                  <span className="faculty-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="faculty-toggle-info">
                    <h3>{f.name}</h3>
                    <p>{f.departments.length} accredited departments · {matCount} materials</p>
                  </span>
                  <ChevronRight size={16} className={`chev${open ? ' rotated' : ''}`} />
                </span>
              </button>

              {open && (
                <div className="faculty-detail">
                  {f.departments.map((d) => (
                    <div className="faculty-dept-row" key={d.name}>
                      <div className="faculty-dept-info">
                        <b>{d.name}</b>
                        <small>{d.courses.length} courses · {countDept(f.name, d.name)} materials</small>
                      </div>
                      <Link
                        to={`/library?faculty=${encodeURIComponent(f.name)}&department=${encodeURIComponent(d.name)}`}
                        className="table-action-btn"
                      >
                        Browse
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 6. Admin Departments Tab
function AdminDepartmentsTab() {
  const store = useStore();
  const { catalogue: liveCatalogue } = useLiveCatalogue();
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const approved = React.useMemo(() => store.getApprovedMaterials(), []);

  const countDept = (fac: string, dep: string) =>
    approved.filter((m) => m.faculty === fac && m.department === dep).length;
  const countCourse = (dep: string, code: string) =>
    approved.filter((m) => m.department === dep && m.course.toUpperCase() === code.toUpperCase()).length;

  const allDepts = liveCatalogue.flatMap((f) =>
    f.departments.map((d) => ({
      faculty: f.name,
      name: d.name,
      duration: d.duration,
      coursesCount: d.courses.length,
      courses: d.courses
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
          <p className="subtitle">Complete catalogue of {allDepts.length} academic departments. Click a department to see its courses and materials.</p>
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

        {displayed.map((d) => {
          const open = expanded === d.name;
          return (
            <div className="admin-row-group" key={`${d.faculty}-${d.name}`}>
              <div
                className={`tr depts-table-grid admin-expand-row${open ? ' open' : ''}`}
                onClick={() => setExpanded(open ? null : d.name)}
              >
                <span>
                  <b>{d.name}</b>
                  <small>{countDept(d.faculty, d.name)} materials in the library</small>
                </span>
                <span>{d.faculty}</span>
                <span>{d.duration} Years Degree</span>
                <span>{d.coursesCount} Courses Loaded</span>
                <span className="row-action-cell">
                  {open ? 'Hide Details' : 'Show Details'}
                  <ChevronRight size={14} className={`chev${open ? ' rotated' : ''}`} />
                </span>
              </div>

              {open && (
                <div className="admin-row-detail">
                  <div className="detail-summary">
                    <span>
                      <b>{d.coursesCount}</b> courses offered
                    </span>
                    <span>
                      <b>{countDept(d.faculty, d.name)}</b> library materials
                    </span>
                    <Link
                      to={`/library?department=${encodeURIComponent(d.name)}`}
                      className="table-action-btn"
                    >
                      Browse All Materials
                    </Link>
                  </div>

                  <div className="table">
                    <div className="tr head admin-dept-courses-grid">
                      <span>Course Code</span>
                      <span>Course Title</span>
                      <span>Level</span>
                      <span>Semester</span>
                      <span>Materials</span>
                      <span>Action</span>
                    </div>
                    {d.courses.length === 0 ? (
                      <div className="tr empty-state-row">
                        <span className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '1rem' }}>
                          No courses listed for this department.
                        </span>
                      </div>
                    ) : (
                      d.courses.map((c, idx) => (
                        <div className="tr admin-dept-courses-grid" key={`${c.code}-${idx}`}>
                          <span>
                            <b className="course-code-highlight">{c.code}</b>
                          </span>
                          <span>{c.name}</span>
                          <span>{c.level} Level</span>
                          <span>{c.semester}</span>
                          <span>{countCourse(d.name, c.code)}</span>
                          <span>
                            <Link
                              to={`/library?department=${encodeURIComponent(d.name)}&q=${encodeURIComponent(c.code)}`}
                              className="table-action-btn"
                            >
                              Search Files
                            </Link>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// 7. Admin Courses Tab
function AdminCoursesTab() {
  const { toast } = useToast();
  const { profile, isSuperAdmin } = useAuth();
  const store = useStore();
  const [liveRefresh, setLiveRefresh] = useState(0);
  const { catalogue: liveCatalogue } = useLiveCatalogue(liveRefresh);
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPublisher, setShowPublisher] = useState(false);
  const [published, setPublished] = useState<any[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, title: '', message: '', onConfirm: () => {} });
  const approved = React.useMemo(() => store.getApprovedMaterials(), []);

  const countCourse = (dept: string, code: string) =>
    approved.filter((m) => m.department === dept && m.course.toUpperCase() === code.toUpperCase()).length;

  const allCourses = liveCatalogue.flatMap((f) =>
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

  const loadPublished = async () => {
    setPublishedLoading(true);
    try {
      const { fetchAdminPublishedCourses } = await import('../lib/adminCourses');
      const data = await fetchAdminPublishedCourses();
      setPublished(data);
    } catch (err: any) {
      toast(err.message || 'Failed to load published courses.', 'error');
    } finally {
      setPublishedLoading(false);
    }
  };

  useEffect(() => {
    void loadPublished();
  }, []);

  const handlePublished = async () => {
    try {
      const { invalidateLiveCourseCache } = await import('../lib/liveCatalogue');
      invalidateLiveCourseCache();
    } catch {
      // cache invalidation is best-effort
    }
    setLiveRefresh((n) => n + 1);
    await loadPublished();
  };

  const handleDeletePublished = async (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Remove course from catalogue',
      message: 'Delete this course from the official catalogue? Any linked material stays in the library.',
      confirmLabel: 'Remove course',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const { deleteAdminPublishedCourse } = await import('../lib/adminCourses');
          await deleteAdminPublishedCourse(id);
          setPublished((prev) => prev.filter((c) => c.id !== id));
          toast('Course removed from the catalogue.', 'success');
        } catch (err: any) {
          toast(err.message || 'Delete failed.', 'error');
        }
      }
    });
  };

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
          <p className="subtitle">Accredited course codes mapped across departments and academic semesters. Publish new courses instantly from here.</p>
        </div>
        <button
          type="button"
          className="primary submit-btn"
          style={{ maxWidth: 'fit-content', whiteSpace: 'nowrap' }}
          onClick={() => setShowPublisher((v) => !v)}
        >
          <Plus size={16} /> {showPublisher ? 'Close Publisher' : 'Add Course'}
        </button>
      </div>

      {showPublisher && <AdminCoursePublisher onPublished={() => void handlePublished()} />}

      {/* Courses published directly by administrators (auto-published, live now) */}
      <div className="form-section" style={{ marginTop: '1rem' }}>
        <h3>Published by administrators ({published.length})</h3>
        {publishedLoading ? (
          <div className="empty-state card-empty">
            <Loader2 size={28} className="animate-spin" />
            <span>Loading published courses…</span>
          </div>
        ) : published.length === 0 ? (
          <div className="empty-state card-empty">
            <GraduationCap size={32} />
            <b>No administrator-published courses yet.</b>
            <span>Publish courses using "Add Course" above. Published courses are added to the official catalogue immediately (no approval needed).</span>
          </div>
        ) : (
          <div className="table">
            <div className="tr head admin-published-courses-grid">
              <span>Course Code</span>
              <span>Course Title</span>
              <span>Department</span>
              <span>Level</span>
              <span>Semester</span>
              <span>Published</span>
              <span>Action</span>
            </div>
            {published.map((c) => (
              <div className="tr admin-published-courses-grid" key={c.id}>
                <span>
                  <b className="course-code-highlight">{c.code}</b>
                </span>
                <span>{c.title}</span>
                <span>
                  {c.department}
                  {c.faculty && <small>{c.faculty}</small>}
                </span>
                <span>{c.level || '-'}</span>
                <span>{c.semester || '-'}</span>
                <span>{new Date(c.created_at).toLocaleDateString()}</span>
                <span>
                  {isSuperAdmin || c.created_by === profile?.id ? (
                    <button type="button" className="table-action-btn danger" onClick={() => handleDeletePublished(c.id)}>
                      <Trash2 size={13} /> Remove
                    </button>
                  ) : (
                    <span className="table-action-btn" style={{ opacity: 0.55, cursor: 'default' }}>Locked</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="manage-tools compact" style={{ marginTop: '1rem' }}>
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
          <b>No courses match "{searchTerm.trim()}".</b>
          <span>Try a course code like "CSC 201", a title keyword, or clear the search.</span>
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

        {displayed.map((c, idx) => {
          const open = expanded === `${c.dept}\u0001${c.code}`;
          const rowKey = `${c.dept}-${c.code}-${idx}`;
          const courseMaterials = countCourse(c.dept, c.code);
          return (
            <div className="admin-row-group" key={rowKey}>
              <div
                className={`tr courses-table-grid admin-expand-row${open ? ' open' : ''}`}
                onClick={() => setExpanded(open ? null : `${c.dept}\u0001${c.code}`)}
              >
                <span>
                  <b className="course-code-highlight">{c.code}</b>
                </span>
                <span>{c.name}</span>
                <span>{c.dept}</span>
                <span>{c.level}</span>
                <span>{c.semester}</span>
                <span className="row-action-cell">
                  <Link
                    to={`/library?q=${encodeURIComponent(c.code)}`}
                    className="table-action-btn"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Search Files
                  </Link>
                </span>
              </div>

              {open && (
                <div className="admin-row-detail">
                  <div className="detail-summary">
                    <span>
                      <b>{courseMaterials}</b> materials in the library for {c.code}
                    </span>
                    <Link
                      to={`/library?department=${encodeURIComponent(c.dept)}&q=${encodeURIComponent(c.code)}`}
                      className="table-action-btn"
                    >
                      Browse All Materials
                    </Link>
                  </div>

                  <div className="detail-fields">
                    <label>
                      Course Code<b>{c.code}</b>
                    </label>
                    <label>
                      Course Title<b>{c.name}</b>
                    </label>
                    <label>
                      Department<b>{c.dept}</b>
                    </label>
                    <label>
                      Faculty<b>{c.faculty}</b>
                    </label>
                    <label>
                      Level<b>{c.level}</b>
                    </label>
                    <label>
                      Semester<b>{c.semester}</b>
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
      <ConfirmDialog {...confirmDialog} onClose={() => setConfirmDialog((c) => ({ ...c, open: false }))} />
    </div>
  );
}

// 7b. Admin Course Publisher — admins add courses that publish automatically
// (no pending/approval stage, unlike the student course-upload workflow).
interface AdminCourseEntry {
  id: string;
  code: string;
  title: string;
  errors: { code?: string; title?: string };
}

function AdminCoursePublisher({ onPublished }: { onPublished: () => void }) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FilterState>({
    faculty: '',
    department: '',
    level: '',
    semester: '',
    type: '',
    course: ''
  });
  const [entries, setEntries] = useState<AdminCourseEntry[]>([
    { id: crypto.randomUUID(), code: '', title: '', errors: {} }
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [step, setStep] = useState<'form' | 'preview'>('form');

  const addEntry = () => {
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), code: '', title: '', errors: {} }]);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => (prev.length <= 1 ? prev : prev.filter((e) => e.id !== id)));
  };

  const updateEntry = (id: string, field: 'code' | 'title', value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value, errors: { ...e.errors, [field]: undefined } } : e))
    );
  };

  const editEntry = (id: string) => {
    setStep('form');
    setTimeout(() => {
      const el = document.getElementById(`admin-course-entry-${id}`);
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
    const updated = entries.map((e) => {
      const errors: AdminCourseEntry['errors'] = {};
      const code = e.code.trim().toUpperCase();
      const title = e.title.trim();

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

      return { ...e, code, title, errors };
    });

    setEntries(updated);
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
      const { publishAdminCourses } = await import('../lib/adminCourses');
      const input = entries.map((e) => ({
        faculty: filters.faculty,
        department: filters.department,
        level: filters.level,
        semester: filters.semester,
        course_code: e.code.trim().toUpperCase(),
        course_title: e.title.trim()
      }));

      const result = await publishAdminCourses(input);

      if (result.inserted > 0) {
        toast(`${result.inserted} course(s) published to the catalogue.`, 'success');
        let text = `${result.inserted} course(s) published to the official catalogue.`;
        if (result.skipped > 0) {
          text += ` ${result.skipped} duplicate(s) were skipped.`;
        }
        setMessage({ type: 'success', text });
        setTimeout(() => {
          onPublished();
          setStep('form');
          setEntries([{ id: crypto.randomUUID(), code: '', title: '', errors: {} }]);
        }, 1500);
      } else {
        setMessage({ type: 'error', text: 'All courses already exist in the catalogue for this academic structure.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to publish courses.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="upload-container">
      <div className="upload-form full-upload-form">
        <div className="form-section">
          <h3>Publish new courses</h3>
          <p className="subtitle">
            Courses published here appear in the official catalogue immediately (no approval step required).
          </p>
        </div>

        {/* Step indicator */}
        <div className="step-pills">
          <span className={`step-pill${step === 'form' ? ' active' : ''}`}>1. Enter Courses</span>
          <ChevronRight size={16} className="step-pill-arrow" />
          <span className={`step-pill${step === 'preview' ? ' active' : ''}`}>2. Review & Publish</span>
        </div>

        {step === 'form' ? (
          <>
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
              {entries.map((e) => (
                <div
                  key={e.id}
                  id={`admin-course-entry-${e.id}`}
                  className="course-entry-row"
                >
                  <label>
                    Course Code *
                    <input
                      value={e.code}
                      placeholder="e.g. ECO 101"
                      onChange={(ev) => updateEntry(e.id, 'code', ev.target.value)}
                      className={e.errors.code ? 'course-entry-input-error' : ''}
                    />
                    {e.errors.code && <span className="course-entry-error">{e.errors.code}</span>}
                  </label>
                  <label>
                    Course Title *
                    <input
                      value={e.title}
                      placeholder="e.g. Introduction to Economics"
                      onChange={(ev) => updateEntry(e.id, 'title', ev.target.value)}
                      className={e.errors.title ? 'course-entry-input-error' : ''}
                    />
                    {e.errors.title && <span className="course-entry-error">{e.errors.title}</span>}
                  </label>
                  <button
                    type="button"
                    className="icon-btn danger mt-lg"
                    onClick={() => removeEntry(e.id)}
                    disabled={entries.length <= 1}
                    title="Remove course"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}

              <button type="button" className="add-course-btn" onClick={addEntry}>
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
          </>
        ) : (
          <>
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
              <h3>Courses ({entries.length})</h3>
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
                    {entries.map((e, idx) => (
                      <tr key={e.id}>
                        <td className="preview-idx">{idx + 1}</td>
                        <td className="preview-code">{e.code}</td>
                        <td className="preview-title">{e.title}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <div className="course-preview-actions">
                            <button type="button" className="link-btn" onClick={() => editEntry(e.id)}>
                              <Pencil size={13} /> Edit
                            </button>
                            <button
                              type="button"
                              className="link-btn danger"
                              onClick={() => {
                                setEntries((prev) => prev.filter((x) => x.id !== e.id));
                                if (entries.length <= 1) setStep('form');
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
                {busy ? 'Publishing…' : 'Publish Courses'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 8. Admin Categories Tab
function AdminCategoriesTab() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    label: '',
    is_active: false,
    starts_on: '',
    ends_on: ''
  });
  const [formError, setFormError] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, title: '', message: '', onConfirm: () => {} });

  const loadSessions = async () => {
    setLoading(true);
    try {
      const { fetchAcademicSessions } = await import('../lib/academicSessions');
      const data = await fetchAcademicSessions();
      setSessions(data);
    } catch (err: any) {
      toast(err.message || 'Failed to load academic sessions.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('A session name is required (e.g. 2026/2027).');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      const { createAcademicSession } = await import('../lib/academicSessions');
      const { created } = await createAcademicSession(form);
      toast(created ? `Session “${form.name.trim()}” created.` : `Session “${form.name.trim()}” updated.`, 'success');
      setShowCreate(false);
      setForm({ name: '', label: '', is_active: false, starts_on: '', ends_on: '' });
      await loadSessions();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save session.');
    } finally {
      setBusy(false);
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      const { setActiveAcademicSession } = await import('../lib/academicSessions');
      await setActiveAcademicSession(id);
      toast('Active session updated.', 'success');
      await loadSessions();
    } catch (err: any) {
      toast(err.message || 'Failed to update active session.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Delete academic session',
      message: 'Delete this academic session? This cannot be undone.',
      confirmLabel: 'Delete session',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const { deleteAcademicSession } = await import('../lib/academicSessions');
          await deleteAcademicSession(id);
          setSessions((prev) => prev.filter((s) => s.id !== id));
          toast('Session deleted.', 'success');
        } catch (err: any) {
          toast(err.message || 'Delete failed.', 'error');
        }
      }
    });
  };

  const activeSession = sessions.find((s) => s.is_active);

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
          <div className="category-box-head">
            <h3 style={{ margin: 0 }}>Academic Calendar Sessions</h3>
            <button type="button" className="add-course-btn" onClick={() => setShowCreate((v) => !v)}>
              <Plus size={14} /> {showCreate ? 'Cancel' : 'Create Session'}
            </button>
          </div>

          {activeSession && (
            <div className="active-session-banner">
              <Calendar size={15} />
              <b>{activeSession.label || activeSession.name}</b> is the session currently marked active.
            </div>
          )}

          {showCreate && (
            <div className="session-create-form">
              <label>
                Session name *
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. 2026/2027"
                />
              </label>
              <label>
                Display label
                <input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="e.g. 2026/2027 Academic Session"
                />
              </label>
              <div className="form-grid-2">
                <label>
                  Starts
                  <input
                    type="date"
                    value={form.starts_on}
                    onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
                  />
                </label>
                <label>
                  Ends
                  <input
                    type="date"
                    value={form.ends_on}
                    onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
                  />
                </label>
              </div>
              <label className="session-active-toggle">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Mark as active / current session
              </label>
              {formError && <div className="form-feedback-box error"><AlertCircle size={18} /><p>{formError}</p></div>}
              <button className="primary submit-btn" disabled={busy} onClick={handleCreate}>
                {busy ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Session</>}
              </button>
            </div>
          )}

          {loading ? (
            <div className="empty-state"><Loader2 size={28} className="animate-spin" /><span>Loading sessions…</span></div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">
              <Calendar size={28} />
              <b>No academic sessions yet.</b>
              <span>Click “Create Session” to add the first academic calendar session.</span>
            </div>
          ) : (
            <ul className="cat-list session-list">
              {sessions.map((s) => (
                <li className="session-item" key={s.id}>
                  <span className="session-item-main">
                    {s.label || s.name}
                    <small>
                      {s.starts_on ? `Starts ${s.starts_on}` : ''}
                      {s.starts_on && s.ends_on ? ' · ' : ''}
                      {s.ends_on ? `Ends ${s.ends_on}` : ''}
                    </small>
                  </span>
                  {s.is_active ? (
                    <span className="status-badge-pill" style={{ background: '#10b981' }}>Active</span>
                  ) : (
                    <span className="session-actions">
                      <button type="button" className="link-btn" onClick={() => handleSetActive(s.id)}>Set Active</button>
                      <button type="button" className="link-btn danger" onClick={() => handleDelete(s.id)}>Delete</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// 9. Admin Audit Logs Tab
function AdminAuditLogsTab({ logs, actors }: { logs: AuditLogItem[]; actors: Record<string, AuditActorProfile> }) {
  const [searchTerm, setSearchTerm] = useState('');

  const displayed = logs.filter((log) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      (log.action || '').toLowerCase().includes(q) ||
      (log.performedBy || '').toLowerCase().includes(q) ||
      (actors[log.performedById || '']?.full_name || '').toLowerCase().includes(q) ||
      (actors[log.performedById || '']?.matric_number || '').toLowerCase().includes(q) ||
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
              <AuditActor log={log} actors={actors} />
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

// 9c. Usage / Platform analytics tab (20260913_platform_analytics migration).
function AdminUsageAnalyticsTab() {
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null);
  const [topMaterials, setTopMaterials] = useState<TopMaterialRow[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentAnalyticsEventRow[]>([]);
  const [searchInsights, setSearchInsights] = useState<SearchInsights | null>(null);
  const [purgeDays, setPurgeDays] = useState(180);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeConfirming, setPurgeConfirming] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const [dash, top, recent, insights] = await Promise.all([
      fetchAnalyticsDashboard(),
      fetchTopMaterials(10, 30),
      fetchRecentAnalyticsEvents(30),
      fetchSearchInsights(14)
    ]);
    setDashboard(dash);
    setTopMaterials(top);
    setRecentEvents(recent);
    setSearchInsights(insights);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const handlePurge = async () => {
    setPurgeBusy(true);
    try {
      const removed = await purgeAnalyticsData(purgeDays);
      toast(`Purged ${removed} analytics rows older than ${purgeDays} days.`, 'success');
      load();
    } catch {
      toast('Failed to purge analytics data.', 'error');
    }
    setPurgeBusy(false);
    setPurgeConfirming(false);
  };

  const toPairs = (list?: { screen?: string; platform?: string; version?: string; device_type?: string; network?: string; country?: string; count?: number }[]) =>
    (list || []).map((x) => ({
      label: x.screen ?? x.platform ?? x.version ?? x.device_type ?? x.network ?? x.country ?? 'Unknown',
      value: x.count ?? 0
    }));

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">PLATFORM ANALYTICS</p>
          <h1>Usage analytics</h1>
          <p className="subtitle">
            Anonymous usage, device and performance telemetry collected from the app and website
            (no IP addresses or precise locations are recorded).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <Loader2 size={32} className="spin-icon" />
          <b>Loading analytics&hellip;</b>
        </div>
      ) : !dashboard ? (
        <div className="empty-state">
          <BarChart3 size={40} />
          <b>No analytics data yet</b>
          <span>Open the website or mobile app to start collecting usage telemetry. If this persists, confirm the 20260913_platform_analytics migration has been applied.</span>
        </div>
      ) : (
        <>
          <div className="stat-cards">
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(0, 40)}><span className="stat-value">{dashboard.total_sessions.toLocaleString()}</span><span className="stat-label">Total sessions</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(1, 40)}><span className="stat-value">{dashboard.total_events.toLocaleString()}</span><span className="stat-label">Total events</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(2, 40)}><span className="stat-value">{dashboard.daily_active_users}</span><span className="stat-label">Active today</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(3, 40)}><span className="stat-value">{dashboard.weekly_active_users}</span><span className="stat-label">Active (7d)</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(4, 40)}><span className="stat-value">{dashboard.monthly_active_users}</span><span className="stat-label">Active (30d)</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(5, 40)}><span className="stat-value">{Math.round(dashboard.avg_session_duration_seconds)}s</span><span className="stat-label">Avg session</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(6, 40)}><span className="stat-value">{dashboard.searches_last_7d}</span><span className="stat-label">Searches (7d)</span></div>
            <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(7, 40)}><span className="stat-value">{dashboard.errors_last_7d}</span><span className="stat-label">Errors (7d)</span></div>
          </div>

          <div className="analytics-block">
            <div className="analytics-block-head">
              <p className="kicker">AUDIENCE</p>
              <h2>Most used screens</h2>
              <p>Frequently visited screens across web and mobile.</p>
            </div>
            <div className="analytics-grid">
              <AnalyticsChart
                title="Top Screens"
                description="Most frequent screen views."
                items={toPairs(dashboard.most_used_screens).slice(0, 10)}
                loading={false}
                horizontal
                emptyText="No screen views recorded yet."
                valueLabel="views"
              />
            </div>
          </div>

          <div className="analytics-block">
            <div className="analytics-block-head">
              <p className="kicker">DISTRIBUTIONS</p>
              <h2>Devices & networks</h2>
              <p>Coarse platform, version, device and network information.</p>
            </div>
            <div className="analytics-grid">
              <AnalyticsChart title="Platform" description="iOS, Android, web, etc." items={toPairs(dashboard.platform_distribution)} loading={false} horizontal emptyText="No platform data yet." valueLabel="users" />
              <AnalyticsChart title="App Version" description="Major deployment versions." items={toPairs(dashboard.app_version_distribution)} loading={false} horizontal emptyText="No version data yet." valueLabel="users" />
            </div>
            <div className="analytics-grid">
              <AnalyticsChart title="Device Type" description="Phone / tablet / desktop / TV." items={toPairs(dashboard.device_type_distribution)} loading={false} horizontal emptyText="No device data yet." valueLabel="users" />
              <AnalyticsChart title="Network" description="wifi / cellular / ethernet." items={toPairs(dashboard.network_type_distribution)} loading={false} horizontal emptyText="No network data yet." valueLabel="users" />
            </div>
          </div>

          <div className="analytics-block">
            <div className="analytics-block-head">
              <p className="kicker">COUNTRY</p>
              <h2>Geographic distribution</h2>
              <p>Coarse country aggregation derived from timezone/locale only (no precise location is stored).</p>
            </div>
            <div className="analytics-grid">
              <AnalyticsChart title="Countries" description="Derived from timezone and locale." items={toPairs(dashboard.country_distribution)} loading={false} horizontal emptyText="No country data yet." valueLabel="users" />
            </div>
          </div>

          <div className="analytics-block">
            <div className="analytics-block-head">
              <p className="kicker">MATERIALS</p>
              <h2>Top materials (last 30 days)</h2>
              <p>Most viewed and downloaded materials.</p>
            </div>
            {topMaterials.length === 0 ? (
              <div className="empty-state">
                <FileText size={32} />
                <b>No material activity yet.</b>
                <span>Views and downloads will appear here as students use the platform.</span>
              </div>
            ) : (
              <div className="table">
                <div className="tr head audit-table-grid">
                  <span>Material</span>
                  <span>Type</span>
                  <span>Views</span>
                  <span>Downloads</span>
                </div>
                {topMaterials.map((m) => (
                  <div className="tr audit-table-grid" key={m.material_id}>
                    <span>
                      <b>{m.material_title}</b>
                      <small>{m.material_id}</small>
                    </span>
                    <span><span className="status-badge approved">{m.material_type}</span></span>
                    <span>{m.views.toLocaleString()}</span>
                    <span>{m.downloads.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="analytics-block">
            <div className="analytics-block-head">
              <p className="kicker">SEARCH ANALYTICS</p>
              <h2>Search insights</h2>
              <p>What students search for, and which queries return nothing.</p>
            </div>
            {!searchInsights ? (
              <div className="empty-state">
                <Search size={32} />
                <b>No search data yet.</b>
                <span>
                  Searches are recorded when the consolidated study/social migration is applied. Queries with zero
                  results appear here so the library team can close content gaps.
                </span>
              </div>
            ) : (
              <>
                <div className="stat-cards">
                  <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(8, 40)}><span className="stat-value">{searchInsights.total_searches.toLocaleString()}</span><span className="stat-label">Searches (14d)</span></div>
                  <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(9, 40)}>{searchInsights.failed_searches > 0 ? <span className="stat-value warn">{searchInsights.failed_searches}</span> : <span className="stat-value">{searchInsights.failed_searches}</span>}<span className="stat-label">No results</span></div>
                  <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(10, 40)}><span className="stat-value">{searchInsights.searches_with_click.toLocaleString()}</span><span className="stat-label">With results</span></div>
                  <div className={`stat-card ${fx.fadeUp}`} style={staggerDelay(11, 40)}><span className="stat-value">{searchInsights.no_result_queries.length}</span><span className="stat-label">Missing topics</span></div>
                </div>
                <div className="analytics-grid">
                  <div>
                    <h3 className="analytics-subhead">No-results queries (learning gaps)</h3>
                    {searchInsights.no_result_queries.length === 0 ? (
                      <p className="analytics-muted">No zero-result searches recorded in the last 14 days.</p>
                    ) : (
                      <ul className="search-insight-list">
                        {searchInsights.no_result_queries.map((q) => (
                          <li key={q.query}>
                            <span className="search-insight-badge failed" title="No matching materials">0</span>
                            <b>{q.query}</b>
                            <small>{q.count.toLocaleString()}× · last {q.last_at ? new Date(q.last_at).toLocaleDateString() : '-'}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="analytics-subhead">Top successful queries</h3>
                    {searchInsights.top_queries.length === 0 ? (
                      <p className="analytics-muted">No successful searches recorded yet.</p>
                    ) : (
                      <ul className="search-insight-list">
                        {searchInsights.top_queries.map((q) => (
                          <li key={q.query}>
                            <span className="search-insight-badge ok">✓</span>
                            <b>{q.query}</b>
                            <small>{q.count.toLocaleString()}×</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="analytics-block">
            <div className="analytics-block-head">
              <p className="kicker">EVENTS</p>
              <h2>Recent telemetry events</h2>
              <p>The 30 most recent events received from clients.</p>
            </div>
            {recentEvents.length === 0 ? (
              <div className="empty-state">
                <Clock size={32} />
                <b>No events yet.</b>
                <span>Events will stream in as clients begin sending telemetry.</span>
              </div>
            ) : (
              <div className="table">
                <div className="tr head audit-table-grid">
                  <span>Event</span>
                  <span>Screen</span>
                  <span>User</span>
                  <span>Platform</span>
                  <span>Timestamp</span>
                </div>
                {recentEvents.map((ev) => (
                  <div className="tr audit-table-grid" key={ev.id}>
                    <span><b>{ev.event_name}</b></span>
                    <span>{ev.screen_name || '-'}</span>
                    <span>{ev.user_id ? 'Authenticated' : 'Anonymous'}</span>
                    <span>{ev.platform || '-'}</span>
                    <span>{new Date(ev.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="analytics-block purge-block">
            <div className="analytics-block-head">
              <p className="kicker">DATA LIFECYCLE</p>
              <h2>Retention &amp; purge</h2>
              <p>Control how long anonymous telemetry is kept, then remove anything older.</p>
            </div>

          <div className="purge-card">
            <div className="purge-card-icon" aria-hidden="true">
              <Database size={20} />
            </div>

            <div className="purge-card-body">
              <div className="purge-card-title">
                <span className="purge-tag">Danger zone</span>
                <b>Purge analytics data</b>
              </div>
              <p className="purge-card-desc">
                Choose how many days of history to keep. Anything older is
                permanently erased from every analytics table and cannot be recovered.
              </p>

              <div className="purge-retention">
                <div className="purge-stepper">
                  <button
                    type="button"
                    aria-label="Keep less history"
                    disabled={purgeBusy || purgeDays <= 30}
                    onClick={() => setPurgeDays((d) => Math.max(30, d - 15))}
                  >
                    <Minus size={15} />
                  </button>
                  <label htmlFor="purge-days" className="purge-days-cell">
                    <input
                      id="purge-days"
                      type="number"
                      min={30}
                      max={3650}
                      value={purgeDays}
                      disabled={purgeBusy}
                      onChange={(e) =>
                        setPurgeDays(Math.min(3650, Math.max(30, Number(e.target.value) || 30)))
                      }
                    />
                    <span>days kept</span>
                  </label>
                  <button
                    type="button"
                    aria-label="Keep more history"
                    disabled={purgeBusy || purgeDays >= 3650}
                    onClick={() => setPurgeDays((d) => Math.min(3650, d + 15))}
                  >
                    <Plus size={15} />
                  </button>
                </div>

                <input
                  type="range"
                  className="purge-range"
                  min={30}
                  max={3650}
                  step={15}
                  value={purgeDays}
                  disabled={purgeBusy}
                  onChange={(e) => setPurgeDays(Number(e.target.value))}
                  aria-label="Days of history to keep"
                />

                <p className="purge-consequence">
                  <Calendar size={13} />
                  <span>
                    Deletes everything recorded before{' '}
                    <b>{new Date(Date.now() - purgeDays * 86400000).toLocaleDateString()}</b>
                    {' '}(this action is irreversible).
                  </span>
                </p>
              </div>
            </div>

            <div className="purge-card-action">
              {purgeConfirming ? (
                <>
                  <button
                    type="button"
                    className="danger-btn-solid purge-btn"
                    disabled={purgeBusy}
                    onClick={handlePurge}
                  >
                    {purgeBusy ? (
                      <>
                        <Loader2 size={15} className="spin-icon" /> Purging&hellip;
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={15} /> Confirm purge
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setPurgeConfirming(false)}
                    disabled={purgeBusy}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="danger-btn-solid purge-btn"
                  disabled={purgeBusy}
                  onClick={() => setPurgeConfirming(true)}
                >
                  <Trash2 size={15} /> Purge old data
                </button>
              )}
            </div>
          </div>
          </div>
        </>
      )}
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
  const [semesterCalendar, setSemesterCalendar] = useState({
    first: { label: 'First Semester', starts_on: '2025-09-15', ends_on: '2026-01-31' },
    second: { label: 'Second Semester', starts_on: '2026-02-01', ends_on: '2026-06-30' }
  });
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [adminPasswordState, setAdminPasswordState] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    import('../lib/academicCalendar')
      .then(({ fetchSemesterCalendar }) => fetchSemesterCalendar())
      .then(setSemesterCalendar)
      .catch(() => {});
  }, []);

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

              <div className="settings-section-card" style={{ marginTop: 16 }}>
                <div className="settings-card-header">
                  <div>
                    <h2>Semester Duration</h2>
                    <p>Set the dates shown to students when they choose a level and semester.</p>
                  </div>
                </div>
                <div className="form-grid-2">
                  {(['first', 'second'] as const).map((key) => (
                    <div key={key} className="category-box">
                      <h3>{semesterCalendar[key].label}</h3>
                      <label>
                        Starts
                        <input
                          type="date"
                          value={semesterCalendar[key].starts_on}
                          onChange={(e) => setSemesterCalendar((current) => ({
                            ...current,
                            [key]: { ...current[key], starts_on: e.target.value }
                          }))}
                        />
                      </label>
                      <label>
                        Ends
                        <input
                          type="date"
                          value={semesterCalendar[key].ends_on}
                          onChange={(e) => setSemesterCalendar((current) => ({
                            ...current,
                            [key]: { ...current[key], ends_on: e.target.value }
                          }))}
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <div className="settings-actions-bar">
                  <button
                    type="button"
                    className="primary save-btn"
                    onClick={async () => {
                      try {
                        const { saveSemesterCalendar } = await import('../lib/academicCalendar');
                        await saveSemesterCalendar(semesterCalendar);
                        toast('Semester dates updated for all users.', 'success');
                      } catch (err: any) {
                        toast(err.message || 'Failed to update semester dates.', 'error');
                      }
                    }}
                  >
                    <Save size={15} /> Save Semester Dates
                  </button>
                </div>
              </div>
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

                <div className="form-grid-2 mt-md">
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

                <div className="switch-group mt-md">
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
              <form onSubmit={handlePasswordChange} className="mb-lg">
                <span className="section-label-bold">Change Administrator Password</span>
                <label className="mt-sm">
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

                <button type="submit" className="outline-btn mt-sm">
                  <Key size={14} /> Update Administrator Password
                </button>
              </form>

              <hr className="settings-divider" />

              {/* Personal two-factor sign-in tools (Authenticator App + passkeys) */}
              <div className="security-tools-section">
                <span className="section-label-bold">Your Two-Factor Sign-In</span>
                <p className="settings-section-hint">
                  Protect your own administrator account with an Authenticator App or a passkey.
                </p>
                <div className="mt-sm">
                  <AuthenticatorAppCard />
                  <PasskeysManager />
                </div>
              </div>

              <hr className="settings-divider" />

              {/* Session Policies */}
              <form onSubmit={handleSaveSettings}>
                <span className="section-label-bold">Session & Traffic Controls</span>
                <div className="form-grid-2 mt-sm">
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

                <div className="switch-group mt-sm">
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

// ─── Admin Student Courses Tab ────────────────────────────────────────
function AdminStudentCoursesTab() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ faculty: '', department: '', level: '', semester: '', status: '' });
  const [page, setPage] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, title: '', message: '', onConfirm: () => {} });
  const PAGE_SIZE = 20;

  const loadCourses = async () => {
    setLoading(true);
    try {
      const { fetchAllStudentCourses } = await import('../lib/studentCourses');
      const data = await fetchAllStudentCourses({
        faculty: filters.faculty || undefined,
        department: filters.department || undefined,
        level: filters.level || undefined,
        semester: filters.semester || undefined,
        status: filters.status || undefined,
        search: search || undefined
      });
      setCourses(data);
    } catch (err: any) {
      toast(err.message || 'Failed to load student courses.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCourses();
  }, [filters, search]);

  const handleStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const { updateStudentCourseStatus } = await import('../lib/studentCourses');
      await updateStudentCourseStatus(id, status);
      setCourses((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status } : c))
      );
      toast(`Course ${status}.`, 'success');
    } catch (err: any) {
      toast(err.message || 'Action failed.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Delete course record',
      message: 'Delete this course record? This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const { deleteStudentCourse } = await import('../lib/studentCourses');
          await deleteStudentCourse(id);
          setCourses((prev) => prev.filter((c) => c.id !== id));
          toast('Course deleted.', 'success');
        } catch (err: any) {
          toast(err.message || 'Delete failed.', 'error');
        }
      }
    });
  };

  const filtered = courses;
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = { pending: '#f59e0b', approved: '#10b981', rejected: '#e53e3e' };
    return (
      <span className="status-badge-pill" style={{ background: colors[status] || '#888' }}>
        {status}
      </span>
    );
  };

  const uniqueValues = (key: string) => [...new Set(courses.map((c) => c[key]).filter(Boolean))].sort();

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC MANAGEMENT</p>
          <h1>Student Courses ({filtered.length})</h1>
          <p className="subtitle">View, approve, or reject courses submitted by students.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="admin-filter-card">
        <div className="admin-filter-card-head">
          <span className="admin-filter-title"><SlidersHorizontal size={15} /> Filters</span>
        </div>
        <div className="filter-bar admin-filter-toolbar">
          <div className="filter-field filter-search">
            <label className="filter-label">Search</label>
            <div className="filter-input-wrap">
              <Search size={14} />
              <input className="form-input search-wide" placeholder="Search course code or title…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div className="filter-field">
            <label className="filter-label">Faculty</label>
            <select className="form-input" value={filters.faculty} onChange={(e) => { setFilters((f) => ({ ...f, faculty: e.target.value })); setPage(0); }}>
              <option value="">All Faculties</option>
              {uniqueValues('faculty').map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Department</label>
            <select className="form-input" value={filters.department} onChange={(e) => { setFilters((f) => ({ ...f, department: e.target.value })); setPage(0); }}>
              <option value="">All Departments</option>
              {uniqueValues('department').map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Level</label>
            <select className="form-input" value={filters.level} onChange={(e) => { setFilters((f) => ({ ...f, level: e.target.value })); setPage(0); }}>
              <option value="">All Levels</option>
              {uniqueValues('level').map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Semester</label>
            <select className="form-input" value={filters.semester} onChange={(e) => { setFilters((f) => ({ ...f, semester: e.target.value })); setPage(0); }}>
              <option value="">All Semesters</option>
              {uniqueValues('semester').map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Status</label>
            <select className="form-input" value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(0); }}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="admin-results-card">
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton-avatar" />
              <span className="skeleton skeleton-line w25" />
              <span className="skeleton skeleton-line w30" />
              <span className="skeleton skeleton-line w20" />
              <span className="skeleton skeleton-badge" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="admin-results-card admin-empty-state">
          <span className="admin-empty-icon"><GraduationCap size={26} /></span>
          <h3>No student courses found</h3>
          <p>No courses match your current filters.</p>
        </div>
      ) : (
        <>
          <div className="courses-table-wrapper">
            <table className="courses-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Code</th>
                  <th>Title</th>
                  <th>Student</th>
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
                {paged.map((c: any, idx: number) => (
                  <tr key={c.id}>
                    <td>{page * PAGE_SIZE + idx + 1}</td>
                    <td className="cell-bold">{c.course_code}</td>
                    <td>{c.course_title}</td>
                    <td className="cell-secondary">
                      {c.profiles?.full_name || '-'}<br />
                      <span className="opacity-60">{c.profiles?.matric_number || ''}</span>
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
                      {c.status === 'pending' && (
                        <>
                          <button className="link-btn approve mr-sm" onClick={() => handleStatus(c.id, 'approved')}>
                            Approve
                          </button>
                          <button className="link-btn danger mr-sm" onClick={() => handleStatus(c.id, 'rejected')}>
                            Reject
                          </button>
                        </>
                      )}
                      <button className="link-btn danger" onClick={() => handleDelete(c.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="admin-pagination">
              <button className="secondary-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <button className="secondary-btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
      <ConfirmDialog {...confirmDialog} onClose={() => setConfirmDialog((c) => ({ ...c, open: false }))} />
    </div>
  );
}

/* ── Admin Deletion Requests Tab ────────────────────────────── */
const adminInitials = (name?: string | null) =>
  (name || '?').split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';

const adminAvatarColor = (name?: string | null) => {
  const palette = ['#12603d', '#2f6f4f', '#3d7a5c', '#25603f', '#163f2c', '#4a8a68'];
  let h = 0;
  for (const ch of (name || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};

const formatConvTime = (ts: string) => {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function AdminDeletionRequestsTab() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [facultyFilter, setFacultyFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [detailReq, setDetailReq] = useState<DeletionRequest | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; title: string; message: string; tone?: 'danger' | 'default'; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const { toast } = useToast();

  useEffect(() => { loadRequests(); }, [statusFilter, typeFilter, searchFilter, facultyFilter, departmentFilter, levelFilter, dateFrom, dateTo]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await fetchAllDeletionRequests({
        status: statusFilter || undefined,
        request_type: typeFilter || undefined,
        search: searchFilter || undefined,
        faculty: facultyFilter || undefined,
        department: departmentFilter || undefined,
        level: levelFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setRequests(data);
      setPage(0);
    } catch (err: any) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

  // Cascading filter data
  const selectedFacultyObj = catalogue.find((f) => f.name === facultyFilter);
  const departments = selectedFacultyObj ? selectedFacultyObj.departments : [];
  const maxDuration = selectedFacultyObj
    ? Math.max(...selectedFacultyObj.departments.map((d) => d.duration))
    : 6;
  const levels = Array.from({ length: maxDuration }, (_, i) => `${i + 1}00`);

  const handleAction = async (id: string, status: 'approved' | 'rejected') => {
    const req = requests.find((r) => r.id === id);
    const student = req?.profiles?.full_name || 'this student';
    const item = req?.item_name || 'this item';
    setConfirmState({
      open: true,
      title: status === 'approved' ? 'Approve Deletion?' : 'Reject Deletion?',
      message: status === 'approved'
        ? `Approve ${student}'s request to delete "${item}"? The item will be removed from the library.`
        : `Reject ${student}'s request to delete "${item}"? The item will remain in the library.`,
      tone: status === 'approved' ? 'default' : 'danger',
      onConfirm: async () => {
        try {
          await updateDeletionRequestStatus(id, status, reviewNote || undefined);
          toast(`Request ${status}.`, 'success');
          setReviewingId(null); setReviewNote('');
          if (detailReq?.id === id) setDetailReq(null);
          await loadRequests();
        } catch (err: any) { toast(err.message, 'error'); }
      }
    });
  };

  const paged = requests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(requests.length / PAGE_SIZE);
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

  const hasActiveFilters = !!(searchFilter || statusFilter || typeFilter || facultyFilter || departmentFilter || levelFilter || dateFrom || dateTo);
  const activeFilterCount = [searchFilter, statusFilter, typeFilter, facultyFilter, departmentFilter, levelFilter, dateFrom, dateTo].filter(Boolean).length;

  const clearFilters = () => {
    setSearchFilter(''); setStatusFilter(''); setTypeFilter('');
    setFacultyFilter(''); setDepartmentFilter(''); setLevelFilter('');
    setDateFrom(''); setDateTo(''); setPage(0);
  };

  const avatarColor = (name?: string | null) =>
    ['#0d4a2f', '#12603d', '#1f7a52', '#8c4e1e', '#365f91', '#6d4b9e'][
      ((name || '').length + (name || '').charCodeAt(0) || 0) % 6
    ];

  return (
    <div className="admin-deletion-requests-tab admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head-main">
          <span className="admin-page-head-icon">
            <FileWarning size={22} />
          </span>
          <div>
            <h2 className="admin-page-title">Deletion Requests</h2>
            <p className="admin-page-desc">Review and act on student requests to remove uploaded materials or courses from the library.</p>
          </div>
        </div>
        {!loading && (
          <span className="admin-count-badge">
            {requests.length} request{requests.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Stat chips */}
      {!loading && requests.length > 0 && (
        <div className="admin-stat-chips">
          <div className="admin-stat-chip"><b>{requests.length}</b><span>Total</span></div>
          <div className="admin-stat-chip pending"><b>{pending}</b><span>Pending</span></div>
          <div className="admin-stat-chip approved"><b>{approved}</b><span>Approved</span></div>
          <div className="admin-stat-chip rejected"><b>{rejected}</b><span>Rejected</span></div>
          {completed > 0 && <div className="admin-stat-chip completed"><b>{completed}</b><span>Completed</span></div>}
        </div>
      )}

      {/* Filters */}
      <div className="admin-filter-card">
        <div className="admin-filter-card-head">
          <span className="admin-filter-title"><SlidersHorizontal size={15} /> Filters{hasActiveFilters ? ` · ${activeFilterCount}` : ''}</span>
          {hasActiveFilters && (
            <button type="button" className="clear-filters-btn" onClick={clearFilters}>
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
        <div className="filter-bar admin-filter-toolbar">
          <div className="filter-field filter-search">
            <label className="filter-label">Search</label>
            <div className="filter-input-wrap">
              <Search size={14} />
              <input className="form-input search-wide" placeholder="Search students, items, reasons…" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} />
            </div>
          </div>
          <div className="filter-field">
            <label className="filter-label">Status</label>
            <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Type</label>
            <select className="form-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="material">Material</option>
              <option value="course">Course</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Faculty</label>
            <select className="form-input" value={facultyFilter} onChange={(e) => { setFacultyFilter(e.target.value); setDepartmentFilter(''); setLevelFilter(''); }}>
              <option value="">All faculties</option>
              {catalogue.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Department</label>
            <select className="form-input" value={departmentFilter} onChange={(e) => { setDepartmentFilter(e.target.value); setLevelFilter(''); }} disabled={!facultyFilter}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Level</label>
            <select className="form-input" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} disabled={!facultyFilter}>
              <option value="">All levels</option>
              {levels.map((l) => <option key={l} value={l}>Level {l}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">From</label>
            <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
          </div>
          <div className="filter-field">
            <label className="filter-label">To</label>
            <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="admin-results-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton-avatar" />
              <span className="skeleton skeleton-line w25" />
              <span className="skeleton skeleton-line w15" />
              <span className="skeleton skeleton-line w20" />
              <span className="skeleton skeleton-line w30" />
              <span className="skeleton skeleton-badge" />
              <span className="skeleton skeleton-line w10" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="admin-results-card admin-empty-state">
          <span className="admin-empty-icon"><FileWarning size={26} /></span>
          <h3>{hasActiveFilters ? 'No matching requests' : 'No deletion requests yet'}</h3>
          <p>
            {hasActiveFilters
              ? 'No requests match your current filters. Try adjusting the search or clear them below.'
              : 'Student removal requests will appear here when submitted.'}
          </p>
          {hasActiveFilters && (
            <button type="button" className="secondary-btn" onClick={clearFilters}>
              <RefreshCw size={14} /> Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="admin-results-card">
          {/* Desktop table */}
          <div className="table-scroll-wrapper desktop-only">
            <table className="admin-table">
              <thead>
                <tr><th>Student</th><th>Type</th><th>Item</th><th>Reason</th><th>Submitted</th><th>Status</th><th className="th-actions">Actions</th></tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="student-cell">
                        <span className="avatar-mini" style={{ background: avatarColor(r.profiles?.full_name) }}>{adminInitials(r.profiles?.full_name)}</span>
                        <span className="student-cell-main">
                          <span className="student-name-cell">{r.profiles?.full_name || '-'}</span>
                          <span className="cell-secondary">{r.profiles?.matric_number || r.profiles?.email}</span>
                        </span>
                      </div>
                    </td>
                    <td><span className="field-tag">{r.request_type}</span></td>
                    <td>
                      <div className="cell-bold">{r.item_name}</div>
                      {r.item_code && <div className="cell-code cell-secondary">{r.item_code}</div>}
                    </td>
                    <td className="cell-reason">{r.reason}</td>
                    <td className="cell-secondary nowrap-cell">{timeSince(r.created_at)}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="action-cell">
                      <button className="btn-icon" onClick={() => setDetailReq(r)} title="View details"><Eye size={15} /></button>
                      {r.status === 'pending' && (
                        reviewingId === r.id ? (
                          <div className="review-inline">
                            <input className="form-input" placeholder="Admin note (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                            <div className="review-inline-actions">
                              <button className="approval-btn approve" onClick={() => handleAction(r.id, 'approved')}><CheckCircle2 size={14} /> Approve</button>
                              <button className="approval-btn reject" onClick={() => handleAction(r.id, 'rejected')}><XCircle size={14} /> Reject</button>
                              <button className="link-btn" onClick={() => { setReviewingId(null); setReviewNote(''); }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button className="btn-ghost btn-sm" onClick={() => { setReviewingId(r.id); setDetailReq(null); }}>
                            <CheckCircle2 size={14} /> Review
                          </button>
                        )
                      )}
                      {r.status !== 'pending' && (
                        <button className="btn-ghost btn-sm" onClick={() => setDetailReq(r)}>View</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mobile-only request-cards">
            {paged.map((r) => (
              <div key={r.id} className="request-card">
                <div className="request-card-header">
                  <div className="student-cell">
                    <span className="avatar-mini" style={{ background: avatarColor(r.profiles?.full_name) }}>{adminInitials(r.profiles?.full_name)}</span>
                    <span className="student-cell-main">
                      <div className="cell-bold">{r.item_name}</div>
                      <div className="cell-secondary">{r.profiles?.full_name || '-'} · {r.profiles?.matric_number || ''}</div>
                    </span>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <div className="request-card-body">
                  <span className="field-tag">{r.request_type}</span>
                  {r.reason && <div className="cell-secondary mt-xs">{r.reason}</div>}
                </div>
                <div className="request-card-footer">
                  <span className="cell-secondary">{timeSince(r.created_at)}</span>
                  <div className="request-card-actions">
                    <button className="link-btn" onClick={() => setDetailReq(r)}>{r.status === 'pending' ? 'Review' : 'View'}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination-controls">
              <button className="secondary-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button className="secondary-btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
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
              <div className="detail-summary">
                <span className="avatar-lg" style={{ background: avatarColor(detailReq.profiles?.full_name) }}>{adminInitials(detailReq.profiles?.full_name)}</span>
                <div>
                  <div className="detail-value cell-bold">{detailReq.profiles?.full_name || '-'}</div>
                  <div className="cell-secondary">{detailReq.profiles?.matric_number} · {detailReq.profiles?.email}</div>
                  {detailReq.profiles?.faculty && <div className="cell-secondary">{detailReq.profiles.faculty} · {detailReq.profiles.department} · Level {detailReq.profiles.level}</div>}
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-section">
                  <div className="detail-label">Item</div>
                  <div className="detail-value cell-bold">{detailReq.item_name}</div>
                  {detailReq.item_code && <div className="cell-code cell-secondary">{detailReq.item_code}</div>}
                </div>
                <div className="detail-section">
                  <div className="detail-label">Type</div>
                  <span className="field-tag">{detailReq.request_type}</span>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-label">Reason</div>
                <div className="detail-value">{detailReq.reason}</div>
              </div>
              <div className="detail-grid">
                <div className="detail-section">
                  <div className="detail-label">Submitted</div>
                  <div className="cell-secondary">{new Date(detailReq.created_at).toLocaleString()}</div>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Status</div>
                  {statusBadge(detailReq.status)}
                </div>
              </div>
              {detailReq.admin_note && (
                <div className="detail-section">
                  <div className="detail-label">Admin Note</div>
                  <div className="cell-secondary">{detailReq.admin_note}</div>
                </div>
              )}

              {/* Inline review for pending requests */}
              {detailReq.status === 'pending' && (
                <div className="detail-review-section">
                  <hr className="settings-divider" />
                  <div className="detail-label">Admin Note (optional)</div>
                  <input className="form-input" placeholder="Add a note for the student…" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                  <div className="detail-actions">
                    <button className="approval-btn approve" onClick={() => handleAction(detailReq.id, 'approved')}><CheckCircle2 size={14} /> Approve</button>
                    <button className="approval-btn reject" onClick={() => handleAction(detailReq.id, 'rejected')}><XCircle size={14} /> Reject</button>
                  </div>
                </div>
              )}

              {/* Contact Student */}
              {detailReq.student_id && (
                <div className="detail-actions mt-sm">
                  <button className="secondary-btn" onClick={() => { setDetailReq(null); navigate(`/admin/messages?student=${detailReq.student_id}`); }}>
                    <MessageSquare size={14} /> Contact Student
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        tone={confirmState.tone}
        onConfirm={confirmState.onConfirm}
        onClose={() => setConfirmState({ ...confirmState, open: false })}
      />
    </div>
  );
}

/* ── Admin Change Requests Tab ──────────────────────────────── */
function AdminChangeRequestsTab() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ProfileChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [facultyFilter, setFacultyFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [detailRequest, setDetailRequest] = useState<ProfileChangeRequest | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadRequests();
  }, [statusFilter, fieldFilter, searchFilter, facultyFilter, departmentFilter, levelFilter, dateFrom, dateTo]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await fetchAllChangeRequests({
        status: statusFilter || undefined,
        field_name: fieldFilter || undefined,
        search: searchFilter || undefined,
        faculty: facultyFilter || undefined,
        department: departmentFilter || undefined,
        level: levelFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined
      });
      setRequests(data);
      setPage(0);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveProfileChangeRequest(id, reviewNote || undefined);
      toast('Request approved and profile updated.', 'success');
      setReviewingId(null);
      setReviewNote('');
      await loadRequests();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectProfileChangeRequest(id, reviewNote || undefined);
      toast('Request rejected.', 'info');
      setReviewingId(null);
      setReviewNote('');
      await loadRequests();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const fieldLabels: Record<string, string> = {
    matric_number: 'Matric Number',
    faculty: 'Faculty',
    department: 'Department',
    level: 'Level'
  };

  // Cascading filter data
  const selectedFacultyObj = catalogue.find((f) => f.name === facultyFilter);
  const departments = selectedFacultyObj ? selectedFacultyObj.departments : [];
  const maxDuration = selectedFacultyObj
    ? Math.max(...selectedFacultyObj.departments.map((d) => d.duration))
    : 6;
  const levels = Array.from({ length: maxDuration }, (_, i) => `${i + 1}00`);

  const paged = requests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(requests.length / PAGE_SIZE);

  const statusBadge = (s: string) => <span className={`status-badge ${s}`}>{s}</span>;

  const pending = requests.filter((r) => r.status === 'pending').length;
  const approved = requests.filter((r) => r.status === 'approved').length;
  const rejected = requests.filter((r) => r.status === 'rejected').length;

  const clearFilters = () => {
    setStatusFilter(''); setFieldFilter(''); setSearchFilter('');
    setFacultyFilter(''); setDepartmentFilter(''); setLevelFilter('');
    setDateFrom(''); setDateTo(''); setPage(0);
  };

  const timeSince = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const hasActiveFilters = !!(searchFilter || statusFilter || fieldFilter || facultyFilter || departmentFilter || levelFilter || dateFrom || dateTo);
  const activeFilterCount = [searchFilter, statusFilter, fieldFilter, facultyFilter, departmentFilter, levelFilter, dateFrom, dateTo].filter(Boolean).length;

  const avatarColor = (name?: string | null) =>
    ['#0d4a2f', '#12603d', '#1f7a52', '#8c4e1e', '#365f91', '#6d4b9e'][
      ((name || '').length + (name || '').charCodeAt(0) || 0) % 6
    ];

  return (
    <div className="admin-change-requests-tab admin-page">
      {/* Header */}
      <div className="admin-page-head">
        <div className="admin-page-head-main">
          <span className="admin-page-head-icon">
            <UserCog size={22} />
          </span>
          <div>
            <h2 className="admin-page-title">Profile Change Requests</h2>
            <p className="admin-page-desc">Review and approve student requests to change restricted academic information such as matric number, faculty, department, or level.</p>
          </div>
        </div>
        {!loading && (
          <span className="admin-count-badge">{requests.length} total request{requests.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Stat chips */}
      {!loading && requests.length > 0 && (
        <div className="admin-stat-chips">
          <div className="admin-stat-chip"><b>{requests.length}</b><span>Total</span></div>
          <div className="admin-stat-chip pending"><b>{pending}</b><span>Pending</span></div>
          <div className="admin-stat-chip approved"><b>{approved}</b><span>Approved</span></div>
          <div className="admin-stat-chip rejected"><b>{rejected}</b><span>Rejected</span></div>
        </div>
      )}

      {/* Filters */}
      <div className="admin-filter-card">
        <div className="admin-filter-card-head">
          <span className="admin-filter-title"><SlidersHorizontal size={15} /> Filters{hasActiveFilters ? ` · ${activeFilterCount}` : ''}</span>
          {hasActiveFilters && (
            <button type="button" className="clear-filters-btn" onClick={clearFilters}>
              <X size={12} /> Clear filters
            </button>
          )}
        </div>
        <div className="filter-bar admin-filter-toolbar">
          <div className="filter-field filter-search">
            <label className="filter-label">Search</label>
            <div className="filter-input-wrap">
              <Search size={14} />
              <input
                className="form-input search-wide"
                placeholder="Search name, email, matric, values…"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="filter-field">
            <label className="filter-label">Status</label>
            <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Field</label>
            <select className="form-input" value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)}>
              <option value="">All fields</option>
              <option value="matric_number">Matric Number</option>
              <option value="faculty">Faculty</option>
              <option value="department">Department</option>
              <option value="level">Level</option>
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Faculty</label>
            <select className="form-input" value={facultyFilter} onChange={(e) => { setFacultyFilter(e.target.value); setDepartmentFilter(''); }}>
              <option value="">All faculties</option>
              {catalogue.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Department</label>
            <select className="form-input" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} disabled={!facultyFilter}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">Level</label>
            <select className="form-input" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} disabled={!facultyFilter}>
              <option value="">All levels</option>
              {levels.map((l) => <option key={l} value={l}>Level {l}</option>)}
            </select>
          </div>
          <div className="filter-field">
            <label className="filter-label">From</label>
            <input className="form-input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
          </div>
          <div className="filter-field">
            <label className="filter-label">To</label>
            <input className="form-input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="admin-results-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton-avatar" />
              <span className="skeleton skeleton-line w25" />
              <span className="skeleton skeleton-line w15" />
              <span className="skeleton skeleton-line w20" />
              <span className="skeleton skeleton-line w30" />
              <span className="skeleton skeleton-badge" />
              <span className="skeleton skeleton-line w10" />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="admin-results-card admin-empty-state">
          <span className="admin-empty-icon"><UserCog size={26} /></span>
          <h3>{hasActiveFilters ? 'No matching requests' : 'No profile change requests yet'}</h3>
          <p>
            {hasActiveFilters
              ? 'No requests match your current filters. Try adjusting the search or clear them below.'
              : 'New requests will appear here when students submit profile updates.'}
          </p>
          {hasActiveFilters && (
            <button type="button" className="secondary-btn" onClick={clearFilters}>
              <RefreshCw size={14} /> Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="admin-results-card">
          {/* Desktop table */}
          <div className="table-scroll-wrapper desktop-only">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Field</th>
                  <th>Change</th>
                  <th>Reason</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="student-cell">
                        <span className="avatar-mini" style={{ background: avatarColor(r.profiles?.full_name) }}>{adminInitials(r.profiles?.full_name)}</span>
                        <span className="student-cell-main">
                          <span className="student-name-cell">{r.profiles?.full_name || '-'}</span>
                          <span className="cell-secondary">{r.profiles?.matric_number || r.profiles?.email}</span>
                        </span>
                      </div>
                    </td>
                    <td><span className="field-tag">{fieldLabels[r.field_name] || r.field_name}</span></td>
                    <td>
                      <div className="change-inline">
                        <span className="change-old">{r.current_value}</span>
                        <ChevronRight size={14} className="change-arrow" />
                        <span className="change-new">{r.requested_value}</span>
                      </div>
                    </td>
                    <td className="cell-reason">{r.reason}</td>
                    <td className="cell-secondary nowrap-cell">{timeSince(r.created_at)}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td>
                      <div className="action-cell">
                        <button className="btn-icon" onClick={() => setDetailRequest(r)} title="View details">
                          <Eye size={15} />
                        </button>
                        {r.status === 'pending' && (
                          <button className="btn-ghost btn-sm" onClick={() => { setReviewingId(reviewingId === r.id ? null : r.id); setReviewNote(''); }}>
                            <CheckCircle2 size={14} /> Review
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mobile-only request-cards">
            {paged.map((r) => (
              <div key={r.id} className="request-card" onClick={() => setDetailRequest(r)}>
                <div className="request-card-header">
                  <div className="student-cell">
                    <span className="avatar-mini" style={{ background: avatarColor(r.profiles?.full_name) }}>{adminInitials(r.profiles?.full_name)}</span>
                    <span className="student-cell-main">
                      <div className="student-name-cell">{r.profiles?.full_name || '-'}</div>
                      <div className="cell-secondary">{r.profiles?.matric_number || r.profiles?.email}</div>
                    </span>
                  </div>
                  {statusBadge(r.status)}
                </div>
                <div className="request-card-body">
                  <span className="field-tag">{fieldLabels[r.field_name] || r.field_name}</span>
                  <div className="request-card-change">
                    <span>{r.current_value}</span>
                    <ChevronRight size={14} />
                    <span className="cell-bold">{r.requested_value}</span>
                  </div>
                </div>
                <div className="request-card-footer">
                  <span className="cell-secondary">{timeSince(r.created_at)}</span>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination-controls">
              <button className="secondary-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button className="secondary-btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {detailRequest && (
        <div className="modal-overlay" onClick={() => setDetailRequest(null)}>
          <div className="modal-card request-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Request Details</h3>
              <button className="link-btn" onClick={() => setDetailRequest(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="detail-summary">
                <span className="avatar-lg" style={{ background: avatarColor(detailRequest.profiles?.full_name) }}>{adminInitials(detailRequest.profiles?.full_name)}</span>
                <div>
                  <div className="detail-value cell-bold">{detailRequest.profiles?.full_name || '-'}</div>
                  <div className="cell-secondary">{detailRequest.profiles?.matric_number} · {detailRequest.profiles?.email}</div>
                  {detailRequest.profiles?.faculty && <div className="cell-secondary">{detailRequest.profiles.faculty} · {detailRequest.profiles.department} · Level {detailRequest.profiles.level}</div>}
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-section">
                  <div className="detail-label">Field</div>
                  <span className="field-tag">{fieldLabels[detailRequest.field_name] || detailRequest.field_name}</span>
                </div>
                <div className="detail-section">
                  <div className="detail-label">Status</div>
                  {statusBadge(detailRequest.status)}
                </div>
              </div>
              <div className="detail-change-card">
                <div>
                  <div className="detail-label">Current Value</div>
                  <div className="detail-value change-old">{detailRequest.current_value}</div>
                </div>
                <ChevronRight size={18} className="change-arrow" />
                <div>
                  <div className="detail-label">Requested Value</div>
                  <div className="detail-value cell-bold change-new">{detailRequest.requested_value}</div>
                </div>
              </div>
              <div className="detail-section">
                <div className="detail-label">Reason</div>
                <div className="detail-value">{detailRequest.reason}</div>
              </div>
              <div className="detail-grid">
                <div className="detail-section">
                  <div className="detail-label">Submitted</div>
                  <div className="cell-secondary">{new Date(detailRequest.created_at).toLocaleString()}</div>
                </div>
                {detailRequest.reviewed_at && (
                  <div className="detail-section">
                    <div className="detail-label">Reviewed</div>
                    <div className="cell-secondary">{new Date(detailRequest.reviewed_at).toLocaleString()}</div>
                  </div>
                )}
              </div>
              {detailRequest.admin_note && (
                <div className="detail-section">
                  <div className="detail-label">Admin Note</div>
                  <div className="cell-secondary">{detailRequest.admin_note}</div>
                </div>
              )}

              {/* Inline review for pending requests */}
              {detailRequest.status === 'pending' && (
                <div className="detail-review-section">
                  <hr className="settings-divider" />
                  <div className="detail-label">Admin Note (optional)</div>
                  <input
                    className="form-input"
                    placeholder="Add a note for the student…"
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                  <div className="detail-actions">
                    <button className="approval-btn approve" onClick={async () => { await handleApprove(detailRequest.id); setDetailRequest(null); }}>
                      <CheckCircle2 size={14} /> Approve Request
                    </button>
                    <button className="approval-btn reject" onClick={async () => { await handleReject(detailRequest.id); setDetailRequest(null); }}>
                      <XCircle size={14} /> Reject Request
                    </button>
                  </div>
                </div>
              )}

              {/* Contact Student */}
              {detailRequest.student_id && (
                <div className="detail-actions mt-sm">
                  <button className="secondary-btn" onClick={() => { setDetailRequest(null); navigate(`/admin/messages?student=${detailRequest.student_id}`); }}>
                    <MessageSquare size={14} /> Contact Student
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Admin Messages Tab ─────────────────────────────────────── */
function AdminMessagesTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [studentCtx, setStudentCtx] = useState<{ full_name: string; email: string; matric_number: string; faculty: string; department: string; level: string } | null>(null);
  const [studentActivity, setStudentActivity] = useState<{ materials: number; courses: number; deletionRequests: number; changeRequests: number }>({ materials: 0, courses: 0, deletionRequests: 0, changeRequests: 0 });
  const { toast } = useToast();

  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvStudentId, setNewConvStudentId] = useState('');
  const [newConvSubject, setNewConvSubject] = useState('');
  const [newConvBody, setNewConvBody] = useState('');
  const [newConvMaterialId, setNewConvMaterialId] = useState('');
  const [students, setStudents] = useState<{ id: string; full_name: string; matric_number: string; email: string }[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [studentDropdownOpen, setStudentDropdownOpen] = useState(false);
  const [startingConv, setStartingConv] = useState(false);

  useEffect(() => { loadConversations(); }, []);

  const loadConversations = async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err: any) { toast(err.message, 'error'); }
    finally { setLoading(false); }
  };

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

  const loadStudents = async () => {
    setStudentLoading(true);
    setStudentError(null);
    try {
      const { data, error } = await requireSupabase().from('profiles').select('id, full_name, matric_number, email').eq('role', 'student').order('full_name');
      if (error) throw new Error(error.message);
      setStudents(data || []);
    } catch (err: any) {
      setStudentError(err?.message || 'Failed to load students.');
      setStudents([]);
    } finally {
      setStudentLoading(false);
    }
  };

  useEffect(() => {
    if (!showNewConv) return;
    if (students.length === 0 && !studentLoading && !studentError) loadStudents();
    setStudentDropdownOpen(!!studentSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewConv]);

  // Load student context when conversation is selected
  useEffect(() => {
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv?.student_id) { setStudentCtx(null); return; }
    const studentId = conv.student_id;
    (async () => {
      try {
        const client = requireSupabase();
        const { data: profile } = await client.from('profiles').select('full_name, email, matric_number, faculty, department, level').eq('id', studentId).single();
        if (profile) setStudentCtx(profile);

        // Fetch related activity counts
        const [matCount, courseCount, delCount, changeCount] = await Promise.all([
          client.from('materials').select('id', { count: 'exact', head: true }).eq('uploaded_by', studentId),
          client.from('student_courses').select('id', { count: 'exact', head: true }).eq('student_id', studentId),
          client.from('deletion_requests').select('id', { count: 'exact', head: true }).eq('student_id', studentId),
          client.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('student_id', studentId)
        ]);
        setStudentActivity({
          materials: matCount.count || 0,
          courses: courseCount.count || 0,
          deletionRequests: delCount.count || 0,
          changeRequests: changeCount.count || 0
        });
      } catch { setStudentCtx(null); }
    })();
  }, [activeConvId, conversations]);

  const handleSend = async () => {
    if (!activeConvId || !newMsg.trim() || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(activeConvId, newMsg.trim());
      setMessages((prev) => [...prev, msg]);
      setNewMsg('');
      setConversations((prev) =>
        prev.map((c) => c.id === activeConvId ? { ...c, last_message_at: msg.created_at, last_message_body: msg.body } : c)
          .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );
      toast('Message sent successfully.', 'success');
    } catch (err: any) { toast(err.message || 'Message could not be sent. Your draft was kept.', 'error'); }
    finally { setSending(false); }
  };

  const handleStartConv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConvStudentId || !newConvSubject.trim() || !newConvBody.trim()) return;
    setStartingConv(true);
    try {
      const conv = await startConversation(newConvStudentId, newConvSubject.trim(), newConvBody.trim(), newConvMaterialId.trim() || undefined);
      toast('Conversation started.', 'success');
      setShowNewConv(false);
      setNewConvStudentId(''); setNewConvSubject(''); setNewConvBody(''); setNewConvMaterialId(''); setStudentSearch(''); setStudentDropdownOpen(false);
      await loadConversations();
      setActiveConvId(conv.id);
    } catch (err: any) { toast(err.message, 'error'); }
    finally { setStartingConv(false); }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const filteredStudents = (() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.matric_number || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
  })();

  const selectStudent = (s: { id: string; full_name: string; matric_number: string; email: string }) => {
    setNewConvStudentId(s.id);
    setStudentSearch((s.full_name || 'Student') + (s.matric_number ? ` (${s.matric_number})` : ''));
    setStudentDropdownOpen(false);
  };

  const filteredConversations = convSearch
    ? conversations.filter((c) => {
        const q = convSearch.toLowerCase();
        return (c.subject || '').toLowerCase().includes(q) || (c.peer?.full_name || '').toLowerCase().includes(q) || (c.peer?.matric_number || '').toLowerCase().includes(q);
      })
    : conversations;

  return (
    <div className="admin-messages-tab admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head-main">
          <span className="admin-page-head-icon"><MessageSquare size={22} /></span>
          <div>
            <h2 className="admin-page-title">Student Messages</h2>
            <p className="admin-page-desc">Communicate directly with students and manage conversations.</p>
          </div>
        </div>
        <button className="primary new-conv-btn" onClick={() => setShowNewConv(true)}>
          <Plus size={15} /> New Conversation
        </button>
      </div>

      {showNewConv && (
        <div className="modal-overlay" onClick={() => setShowNewConv(false)}>
          <div className="modal-card conv-modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleStartConv}>
              <div className="modal-header">
                <div className="modal-header-title">
                  <span className="modal-head-icon"><MessageSquare size={17} /></span>
                  <div>
                    <h3>Start a New Conversation</h3>
                    <p className="modal-header-sub">Send the first message to a student.</p>
                  </div>
                </div>
                <button type="button" className="link-btn" onClick={() => setShowNewConv(false)}><X size={18} /></button>
              </div>
              <div className="modal-body">
                <div className="form-field">
                  <label className="form-label">Search Student *</label>
                  <div className="filter-input-wrap">
                    <Search size={14} />
                    <input
                      className="form-input"
                      placeholder="Search by name, matric number, or email…"
                      value={studentSearch}
                      onFocus={() => setStudentDropdownOpen(true)}
                      onChange={(e) => { setStudentSearch(e.target.value); setNewConvStudentId(''); setStudentDropdownOpen(true); }}
                    />
                    {newConvStudentId && (
                      <button type="button" className="input-clear-btn" title="Clear selection" onClick={() => { setStudentSearch(''); setNewConvStudentId(''); setStudentDropdownOpen(true); }}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  {studentError && (
                    <div className="student-search-hint error">
                      <AlertCircle size={13} /> {studentError}
                      <button type="button" className="link-btn" onClick={loadStudents}>Retry</button>
                    </div>
                  )}
                  {!studentError && studentDropdownOpen && studentSearch && (
                    <div className="student-search-dropdown">
                      {studentLoading ? (
                        <div className="student-search-state-row"><Loader2 size={13} className="animate-spin" /> Loading students…</div>
                      ) : filteredStudents.length === 0 ? (
                        <div className="student-search-state-row">No students found</div>
                      ) : (
                        filteredStudents.slice(0, 10).map((s) => (
                          <div key={s.id} onClick={() => selectStudent(s)} className="student-search-item">
                            <span className="avatar-mini xs" style={{ background: adminAvatarColor(s.full_name) }}>{adminInitials(s.full_name)}</span>
                            <span className="student-cell-main">
                              <span className="student-name-cell">{s.full_name || 'Student'}</span>
                              <span className="cell-secondary">{[s.matric_number, s.email].filter(Boolean).join(' · ') || 'No contact info'}</span>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="form-row-2col">
                  <div className="form-field">
                    <label className="form-label">Subject</label>
                    <input className="form-input" value={newConvSubject} onChange={(e) => setNewConvSubject(e.target.value)} required placeholder="Conversation subject" />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Related Material ID (Optional)</label>
                    <input className="form-input" value={newConvMaterialId} onChange={(e) => setNewConvMaterialId(e.target.value)} placeholder="Material ID" />
                  </div>
                </div>
                <div className="form-field">
                  <label className="form-label">Message *</label>
                  <textarea className="form-input conv-body-input" value={newConvBody} onChange={(e) => setNewConvBody(e.target.value)} required rows={5} placeholder="Type your message…" maxLength={2000} onPaste={(e) => {
                    const inserted = richPasteText(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'));
                    if (inserted == null) return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const start = el.selectionStart ?? 0;
                    const end = el.selectionEnd ?? 0;
                    setNewConvBody(capLength(newConvBody.slice(0, start) + inserted + newConvBody.slice(end), 2000));
                    const pos = start + inserted.length;
                    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
                  }} />
                  <div className="field-hint count-hint text-right">{newConvBody.length}/2000</div>
                </div>
                <div className="detail-actions">
                  <button type="button" className="secondary-btn" onClick={() => setShowNewConv(false)}>Cancel</button>
                  <button type="submit" className="primary submit-btn" disabled={startingConv || !newConvStudentId || !newConvSubject.trim() || !newConvBody.trim()}>
                    {startingConv ? <><Loader2 size={14} className="animate-spin" /> Starting…</> : <><Send size={14} /> Start Conversation</>}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="conv-layout">
        {/* Conversation list sidebar */}
        <div className="conv-panel">
          <div className="conv-search">
            <div className="filter-input-wrap">
              <Search size={14} />
              <input className="form-input" placeholder="Search conversations…" value={convSearch} onChange={(e) => setConvSearch(e.target.value)} />
            </div>
          </div>
          {loading ? (
            <div className="conv-skeleton-list">
              {Array.from({ length: 4 }).map((_, i) => (
                <div className="conv-skeleton-item" key={i}>
                  <span className="skeleton skeleton-avatar" />
                  <div className="conv-skeleton-lines">
                    <span className="skeleton skeleton-line w40" />
                    <span className="skeleton skeleton-line w25" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="conv-empty-state">
              <span className="admin-empty-icon small"><MessageSquare size={20} /></span>
              <b>{convSearch ? 'No Matches' : 'No Conversations'}</b>
              <span>{convSearch ? 'No conversations match your search.' : 'Start a conversation with a student to begin messaging.'}</span>
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div key={conv.id} onClick={() => { setActiveConvId(conv.id); setShowNewConv(false); }} className={`conv-list-item${activeConvId === conv.id ? ' active' : ''}`}>
                <span className="avatar-mini" style={{ background: adminAvatarColor(conv.peer?.full_name) }}>{adminInitials(conv.peer?.full_name)}</span>
                <div className="conv-item-main">
                  <div className="conv-item-top">
                    <span className="conv-subject">{conv.subject || (conv.is_direct ? 'Student Chat' : 'Untitled')}</span>
                    <span className="conv-meta-sm nowrap-cell">{formatConvTime(conv.last_message_at)}</span>
                  </div>
                  <div className="conv-admin-name">{conv.peer?.full_name || 'Student'}{conv.peer?.matric_number ? ` · ${conv.peer.matric_number}` : ''}</div>
                  {conv.last_message_body && <div className="conv-preview">{messagePreview(conv.last_message_body, 60)}</div>}
                  {(conv.unread_count ?? 0) > 0 && <span className="unread-badge">{conv.unread_count}</span>}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Thread panel */}
        {activeConv ? (
          <div className="thread-panel">
            <div className="thread-header">
              <span className="avatar-mini" style={{ background: adminAvatarColor(activeConv?.peer?.full_name) }}>{adminInitials(activeConv?.peer?.full_name)}</span>
              <div className="thread-header-main">
                <div className="thread-subject">{activeConv.subject || (activeConv.is_direct ? 'Student Chat' : 'Untitled')}</div>
                <div className="thread-sub">
                  <span className="thread-student-name">{activeConv?.peer?.full_name || 'Student'}</span>
                  {activeConv?.peer?.matric_number && <span className="cell-secondary"> · {activeConv.peer.matric_number}</span>}
                  {activeConv?.peer?.faculty && <span className="cell-secondary"> · {activeConv.peer.faculty} · {activeConv.peer.department}</span>}
                </div>
              </div>
            </div>

            <div className="thread-messages">
              {messagesLoading ? (
                <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading messages…</div>
              ) : messages.length === 0 ? (
                <div className="thread-empty-state">
                  <MessageSquare size={28} />
                  <b>No Messages</b>
                  <span>Start the conversation by sending a message below.</span>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isOwn = msg.sender_id !== activeConv.student_id;
                  const prev = messages[i - 1];
                  const showDay = !prev || new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString();
                  const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <React.Fragment key={msg.id}>
                      {showDay && (
                        <div className="msg-day-divider"><span>{new Date(msg.created_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
                      )}
                      <div className={`msg-row ${isOwn ? 'sent' : 'received'}`}>
                        {!isOwn && <span className="avatar-mini xs" style={{ background: adminAvatarColor(activeConv?.peer?.full_name) }}>{adminInitials(activeConv?.peer?.full_name)}</span>}
                        <div className="msg-bubble">
                          <MessageText body={msg.body} />
                          <div className="msg-bubble-time">{timeStr}</div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
            </div>

            <MessageComposer value={newMsg} onChange={setNewMsg} onSend={handleSend} sending={sending} />
          </div>
        ) : (
          <div className="thread-panel thread-panel-empty">
            <div className="thread-empty-state hosted">
              <span className="admin-empty-icon"><MessageSquare size={26} /></span>
              <b>Select a conversation</b>
              <span>Choose a conversation from the list to start reading and replying.</span>
            </div>
          </div>
        )}

        {/* Student Context Panel */}
        {activeConvId && studentCtx && (
          <div className="student-context-panel">
            <div className="context-section">
              <h4 className="context-heading"><Users size={14} /> Student</h4>
              <div className="context-field"><span className="context-label">Name</span><span className="context-value">{studentCtx.full_name}</span></div>
              <div className="context-field"><span className="context-label">Matric No.</span><span className="context-value cell-code">{studentCtx.matric_number}</span></div>
              <div className="context-field"><span className="context-label">Email</span><span className="context-value">{studentCtx.email}</span></div>
              <div className="context-field"><span className="context-label">Faculty</span><span className="context-value">{studentCtx.faculty}</span></div>
              <div className="context-field"><span className="context-label">Department</span><span className="context-value">{studentCtx.department}</span></div>
              <div className="context-field"><span className="context-label">Level</span><span className="context-value">{studentCtx.level}</span></div>
            </div>
            <hr className="settings-divider" />
            <div className="context-section">
              <h4 className="context-heading"><BarChart3 size={14} /> Related Activity</h4>
              <div className="context-field"><span className="context-label">Uploaded Materials</span><span className="context-value">{studentActivity.materials}</span></div>
              <div className="context-field"><span className="context-label">Submitted Courses</span><span className="context-value">{studentActivity.courses}</span></div>
              <div className="context-field"><span className="context-label">Deletion Requests</span><span className="context-value">{studentActivity.deletionRequests}</span></div>
              <div className="context-field"><span className="context-label">Profile Changes</span><span className="context-value">{studentActivity.changeRequests}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Admin Active Sessions Tab ───────────────────────────────── */
function AdminActiveSessionsTab() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await fetchAllSessions({ search: searchFilter || undefined, device_type: deviceFilter || undefined });
      setSessions(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    loadSessions();
  }, [searchFilter, deviceFilter]);

  const [terminateTarget, setTerminateTarget] = useState<ActiveSession | null>(null);

  const handleTerminate = async (sessionId: string) => {
    try {
      await terminateSessionDb(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast('Session terminated.', 'success');
    } catch {
      toast('Failed to terminate session.', 'error');
    }
  };

  const filtered = sessions;
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const timeSince = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const devicePills = [
    { value: '', label: 'All devices', icon: null },
    { value: 'desktop', label: 'Desktop', icon: <Laptop size={13} /> },
    { value: 'mobile', label: 'Mobile', icon: <Smartphone size={13} /> },
    { value: 'tablet', label: 'Tablet', icon: <Tablet size={13} /> }
  ];

  const deviceIcon = (d: string) => d === 'mobile' ? <Smartphone size={15} /> : d === 'tablet' ? <Tablet size={15} /> : <Laptop size={15} />;

  const connectionLabel = (c?: string) =>
    c === 'wifi' ? 'Wi-Fi' : c === 'cellular' ? 'Mobile Data' : c === 'ethernet' ? 'Ethernet' : 'Unknown';

  const connClass = (c?: string) =>
    c === 'wifi' ? 'conn-wifi' : c === 'cellular' ? 'conn-cellular' : c === 'ethernet' ? 'conn-ethernet' : 'conn-unknown';

  return (
    <div className="admin-sessions-tab admin-page">
      <div className="admin-page-head">
        <div className="admin-page-head-main">
          <span className="admin-page-head-icon"><Laptop size={22} /></span>
          <div>
            <h2 className="admin-page-title">Active Login Sessions</h2>
            <p className="admin-page-desc">View and manage devices currently signed in to students' accounts.</p>
          </div>
        </div>
        {!loading && (
          <span className="admin-count-badge">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="admin-filter-card">
        <div className="filter-bar admin-filter-toolbar">
          <div className="filter-field filter-search">
            <label className="filter-label">Search</label>
            <div className="filter-input-wrap">
              <Search size={14} />
              <input className="form-input search-wide" placeholder="Search student, browser, or OS…" value={searchFilter} onChange={(e) => { setSearchFilter(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div className="filter-field">
            <span className="filter-label">Device Type</span>
            <div className="segmented-pills" role="tablist" aria-label="Device filter">
              {devicePills.map((p) => (
                <button
                  key={p.value}
                  className={`segmented-pill${deviceFilter === p.value ? ' active' : ''}`}
                  onClick={() => { setDeviceFilter(p.value); setPage(0); }}
                  role="tab"
                  aria-selected={deviceFilter === p.value}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="admin-results-card">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton skeleton-avatar" />
              <span className="skeleton skeleton-line w25" />
              <span className="skeleton skeleton-line w30" />
              <span className="skeleton skeleton-badge" />
            </div>
          ))
        ) : sessions.length === 0 ? (
          <div className="admin-results-card admin-empty-state">
            <span className="admin-empty-icon"><Laptop size={26} /></span>
            <h3>No Active Sessions</h3>
            <p>There are currently no sessions matching your filters.</p>
          </div>
        ) : (
          <>
            <div className="table-scroll-wrapper">
              <table className="admin-table sessions-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Device</th>
                    <th>Browser</th>
                    <th>OS</th>
                    <th>IP Address</th>
                    <th>Connection</th>
                    <th>Last Active</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => {
                    const isStale = (Date.now() - new Date(s.last_active).getTime()) > 10 * 60 * 1000;
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="student-cell">
                            <span className="avatar avatar-mini xs">{adminInitials(s.profiles?.full_name)}</span>
                            <div className="student-cell-main">
                              <span className="cell-bold">{s.profiles?.full_name || '-'}</span>
                              <span className="cell-code cell-secondary">{s.profiles?.matric_number || s.profiles?.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="session-device-cell">
                            <span className="session-device-icon">{deviceIcon(s.device_type)}</span>
                            <span className="cell-bold">{s.device_type.charAt(0).toUpperCase() + s.device_type.slice(1)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="session-browser-cell">
                            <Globe size={13} />
                            <span>{s.browser}</span>
                          </div>
                        </td>
                        <td>{s.os}</td>
                        <td className="cell-code">{s.ip_address || '-'}</td>
                        <td><span className={`conn-badge ${connClass(s.connection_type)}`}>{connectionLabel(s.connection_type)}</span></td>
                        <td className="cell-secondary">{timeSince(s.last_active)}</td>
                        <td>
                          {isStale ? (
                            <span className="status-badge inactive">Inactive</span>
                          ) : (
                            <span className="status-badge approved">Active</span>
                          )}
                        </td>
                        <td>
                          <button className="btn-icon btn-danger" title="Terminate session" onClick={() => setTerminateTarget(s)}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-only request-cards">
              {paged.map((s) => {
                const isStale = (Date.now() - new Date(s.last_active).getTime()) > 10 * 60 * 1000;
                return (
                  <div key={s.id} className="request-card">
                    <div className="request-card-header">
                      <div className="student-cell">
                        <span className="avatar avatar-mini xs">{adminInitials(s.profiles?.full_name)}</span>
                        <div className="student-cell-main">
                          <div className="student-name-cell">{s.profiles?.full_name || '-'}</div>
                          <div className="cell-secondary">{s.profiles?.matric_number || s.profiles?.email}</div>
                        </div>
                      </div>
                      {isStale ? <span className="status-badge inactive">Inactive</span> : <span className="status-badge approved">Active</span>}
                    </div>
                    <div className="request-card-body session-card-body">
                      <div className="session-device-cell">
                        <span className="session-device-icon">{deviceIcon(s.device_type)}</span>
                        <span className="cell-bold">{s.device_type.charAt(0).toUpperCase() + s.device_type.slice(1)}</span>
                        <span className="cell-secondary"> · {s.browser} · {s.os}</span>
                      </div>
                      <div className="cell-secondary mt-xs">{s.ip_address || '-'} · <span className={`conn-badge ${connClass(s.connection_type)}`}>{connectionLabel(s.connection_type)}</span></div>
                      <div className="cell-secondary mt-xs">Last active {timeSince(s.last_active)}</div>
                    </div>
                    <div className="request-card-footer">
                      <button className="btn-ghost btn-danger-ghost" onClick={() => setTerminateTarget(s)}>
                        <Trash2 size={13} /> Terminate
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="pagination-controls">
                <button className="secondary-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <span>Page {page + 1} of {totalPages}</span>
                <button className="secondary-btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Terminate confirmation modal — modern protected-action dialog */}
      <ProtectedActionModal
        isOpen={!!terminateTarget}
        title="Terminate this session?"
        tone="warning"
        badge="Protected Action"
        message={`This will sign ${terminateTarget?.profiles?.full_name || 'the student'} out of this device and revoke their access to the library.`}
        item={
          terminateTarget
            ? `${terminateTarget.browser} on ${terminateTarget.os} · ${terminateTarget.location ?? 'Unknown location'}`
            : undefined
        }
        confirmKeyword="TERMINATE"
        confirmLabel="Terminate Session"
        onConfirm={async () => {
          if (terminateTarget) await handleTerminate(terminateTarget.id);
        }}
        onClose={() => setTerminateTarget(null)}
      />
    </div>
  );
}

// Skills & Learning admin stub — Phase 6 (ff.md §30). Routes and permissions
// are live. Full content authoring UI will be added in a future release.
function AdminLearningStubTab() {
  return (
    <div className="platform-shell">
      <div className="platform-header">
        <div>
          <p className="kicker">ADMIN · SKILLS &amp; LEARNING</p>
          <h2>Learning content management</h2>
          <p className="subtitle">
            Manage learning paths, modules and lessons for the FUW Campus Platform.
          </p>
        </div>
      </div>
      <div className="portal-empty" style={{ minHeight: 240 }}>
        <GraduationCap size={36} className="empty-icon" />
        <strong>Content authoring coming soon</strong>
        <p>
          The <code>manage_learning</code> permission, student route{' '}
          <code>/student/learning</code> and the Skills &amp; Learning section are
          all in place. Full learning-path authoring, lesson editor and progress
          reporting will be released in the Phase 6 rollout.
        </p>
      </div>
      <p className="platform-disclaimer">
        No learning content has been created yet. Once the full editor is
        available, published content will appear at{' '}
        <strong>/student/learning</strong> for enrolled students.
      </p>
    </div>
  );
}
