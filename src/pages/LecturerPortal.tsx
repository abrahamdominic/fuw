import React, { useState, useEffect, useMemo } from 'react';
import {
  Routes,
  Route,
  NavLink,
  Link,
  useNavigate,
  useLocation
} from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  UploadCloud,
  UserCheck,
  Bell,
  HelpCircle,
  Menu,
  X,
  LogOut,
  LayoutGrid,
  Home,
  Download,
  Eye,
  CheckCircle2,
  Trash2,
  Edit3,
  Search,
  BookOpen,
  Building2,
  GraduationCap,
  Calendar,
  Layers,
  Phone,
  MapPin,
  FileDown,
  Clock,
  AlertCircle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Plus
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useStore } from '../lib/useStore';
import { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';
import { fx, staggerDelay } from '../lib/motion';
import { MessageText } from '../components/MessageText';
import { ConfirmDialog, ConfirmDialogState } from '../components/ConfirmDialog';
import { EditMaterialModal } from '../components/EditMaterialModal';
import { DepartmentAssigner } from '../components/DepartmentAssigner';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  fetchMaterials,
  submitMaterial,
  deleteMaterial as deleteMaterialDb,
  validateMaterialFile,
  type DepartmentOption,
  fetchDepartmentCatalogue
} from '../lib/materials';
import {
  lecturerUpdateOwnProfile,
  lecturerBroadcastAnnouncement,
  lecturerDeleteAnnouncement
} from '../lib/academics';
import { requireSupabase, supabase } from '../lib/supabase';
import { catalogue, materialTypes, levelsFor } from '../data/catalogue';
import type { MaterialItem } from '../lib/store';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
  type NotificationItem
} from '../lib/notifications';

interface LecturerPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

interface LecturerRecord {
  id: string;
  fullName: string;
  staffEmail: string | null;
  phone: string | null;
  staffId: string | null;
  academicRank: string;
  officeLocation: string;
  bio: string;
  facultyId: string | null;
  departmentId: string | null;
  facultyName?: string;
  departmentName?: string;
}

const navItems = [
  { label: 'Dashboard', path: '/lecturer', icon: LayoutDashboard, exact: true },
  { label: 'My Materials', path: '/lecturer/materials', icon: FileText },
  { label: 'Upload Material', path: '/lecturer/upload', icon: UploadCloud },
  { label: 'Academic Scope', path: '/lecturer/profile', icon: UserCheck },
  { label: 'Announcements', path: '/lecturer/announcements', icon: Bell },
  { label: 'Help & Policy', path: '/lecturer/help', icon: HelpCircle }
];

export function LecturerPortal({ onReadOnline }: LecturerPortalProps) {
  const { user, profile, signOut } = useAuth();
  const store = useStore();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifFilter, setNotifFilter] = useState('');

  // Lecturer specific state
  const [lecturerRecord, setLecturerRecord] = useState<LecturerRecord | null>(null);
  const [secondaryDepartments, setSecondaryDepartments] = useState<DepartmentOption[]>([]);
  const [isLoadingRecord, setIsLoadingRecord] = useState(true);

  // Materials state
  const [myMaterials, setMyMaterials] = useState<MaterialItem[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);

  // Modals
  const [editMaterial, setEditMaterial] = useState<MaterialItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; material: MaterialItem | null }>({
    open: false,
    material: null
  });
  const [deleting, setDeleting] = useState(false);

  // Load lecturer database details
  const loadLecturerDetails = async () => {
    if (!user) return;
    setIsLoadingRecord(true);
    try {
      if (supabase) {
        // Query public.lecturers by profile_id OR staff_email
        const { data: lData, error: lErr } = await supabase
          .from('lecturers')
          .select('*, departments:department_id(name), faculties:faculty_id(name)')
          .or(`profile_id.eq.${user.id},staff_email.eq.${user.email?.toLowerCase()}`)
          .maybeSingle();

        if (!lErr && lData) {
          setLecturerRecord({
            id: lData.id,
            fullName: lData.full_name || profile?.fullName || 'Lecturer',
            staffEmail: lData.staff_email || user.email || null,
            phone: lData.phone || profile?.phoneNumber || null,
            staffId: lData.staff_id || null,
            academicRank: lData.academic_rank || 'Lecturer',
            officeLocation: lData.office_location || '',
            bio: lData.bio || profile?.bio || '',
            facultyId: lData.faculty_id || null,
            departmentId: lData.department_id || null,
            facultyName: lData.faculties?.name || profile?.faculty || '',
            departmentName: lData.departments?.name || profile?.department || ''
          });

          // Fetch secondary departments
          const { data: deptRows } = await supabase
            .from('lecturer_departments')
            .select('department_id, departments:department_id(id, name, faculty_id, faculties:faculty_id(name))')
            .eq('lecturer_id', lData.id);

          if (deptRows && deptRows.length > 0) {
            setSecondaryDepartments(
              deptRows.map((row: any) => ({
                id: row.departments?.id || row.department_id,
                name: row.departments?.name || 'Department',
                facultyId: row.departments?.faculty_id,
                facultyName: row.departments?.faculties?.name || 'Faculty'
              }))
            );
          }
        } else {
          // Fallback to profile
          setLecturerRecord({
            id: user.id,
            fullName: profile?.fullName || 'Academic Lecturer',
            staffEmail: user.email || null,
            phone: profile?.phoneNumber || null,
            staffId: null,
            academicRank: 'Lecturer',
            officeLocation: '',
            bio: profile?.bio || '',
            facultyId: null,
            departmentId: null,
            facultyName: profile?.faculty || '',
            departmentName: profile?.department || ''
          });
        }
      }
    } catch {
      // Non-critical: continue with fallback
    } finally {
      setIsLoadingRecord(false);
    }
  };

  // Load lecturer materials from DB
  const loadMyMaterials = async () => {
    if (!user) return;
    setLoadingMaterials(true);
    try {
      const res = await fetchMaterials({ uploadedBy: user.id, status: 'all' }, { field: 'created_at', ascending: false }, 0, 100);
      setMyMaterials(res.items);
    } catch {
      // Fallback to store
      setMyMaterials(store.getStudentUploads(user.id));
    } finally {
      setLoadingMaterials(false);
    }
  };

  useEffect(() => {
    void loadLecturerDetails();
    void loadMyMaterials();
  }, [user?.id]);

  // Notifications
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
      } catch {}
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.id]);

  const unreadNotifCount = (notifications || []).filter((n) => !n.read).length;
  const visibleNotifications = (notifications || []).filter((n) => {
    if (!notifFilter.trim()) return true;
    const q = notifFilter.trim().toLowerCase();
    return ((n?.title || '').toLowerCase().includes(q) || (n?.body || '').toLowerCase().includes(q));
  });

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const handleDeleteMaterial = async () => {
    if (!deleteConfirm.material) return;
    setDeleting(true);
    try {
      await deleteMaterialDb(deleteConfirm.material.id);
      toast('Material removed from the library repository.', 'info');
      setMyMaterials((prev) => prev.filter((m) => m.id !== deleteConfirm.material?.id));
      setDeleteConfirm({ open: false, material: null });
    } catch (err: any) {
      toast(err?.message || 'Failed to delete material.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const totalDownloads = useMemo(
    () => myMaterials.reduce((acc, m) => acc + (m.downloads || 0), 0),
    [myMaterials]
  );
  const totalViews = useMemo(
    () => myMaterials.reduce((acc, m) => acc + (m.views || 0), 0),
    [myMaterials]
  );

  const currentPath = location.pathname;

  return (
    <div className="portal">
      {/* Sidebar Navigation */}
      <aside className={`side lecturer-side ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="side-header">
          <Link to="/lecturer" className="side-brand" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={32} />
            <div className="side-brand-meta">
              <strong style={{ color: '#ffffff', fontSize: 16 }}>FUW Portal</strong>
              <span className="side-role-badge lecturer-badge">LECTURER</span>
            </div>
          </Link>
          <button
            type="button"
            className="side-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        {/* User Card */}
        <div className="side-user-card">
          <div className="user-avatar-circle" style={{ backgroundColor: '#1a6b41', color: '#ffffff' }}>
            <GraduationCap size={20} />
          </div>
          <div className="side-user-meta" style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 13, color: '#ffffff', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lecturerRecord?.academicRank ? `${lecturerRecord.academicRank} ` : ''}
              {lecturerRecord?.fullName || profile?.fullName || 'Lecturer'}
            </strong>
            <small style={{ color: '#95be9f', fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lecturerRecord?.departmentName || profile?.department || 'Academic Staff'}
            </small>
            {lecturerRecord?.staffId && (
              <span style={{ fontSize: 10, background: 'rgba(255, 255, 255, 0.15)', color: '#e5f3e8', padding: '1px 6px', borderRadius: 4, marginTop: 4, display: 'inline-block' }}>
                ID: {lecturerRecord.staffId}
              </span>
            )}
          </div>
        </div>

        {/* Navigation items */}
        <nav className="side-nav">
          <span className="side-nav-heading">ACADEMIC WORKSPACE</span>
          <div className="side-nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.exact
                ? currentPath === item.path
                : item.path === '/lecturer/announcements'
                  ? currentPath.startsWith('/lecturer/announcements') || currentPath.startsWith('/lecturer/notifications')
                  : currentPath.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.exact}
                  className={`side-link ${isActive ? 'active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {item.label === 'My Materials' && myMaterials.length > 0 && (
                    <span className="side-badge">{myMaterials.length}</span>
                  )}
                  {item.label === 'Announcements' && unreadNotifCount > 0 && (
                    <span className="side-badge" style={{ backgroundColor: '#0284c7' }}>{unreadNotifCount}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        </nav>

        <div className="side-footer-actions">
          <button type="button" onClick={handleLogout} className="side-link logout-link logout-btn">
            <LogOut size={17} />
            <span>Sign out / Exit</span>
          </button>
        </div>
      </aside>

      {/* Scrim for mobile drawer */}
      {mobileMenuOpen && (
        <button
          type="button"
          className="portal-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <main className="portal-main">
        {/* Top Header / Actions Bar */}
        <div className="portal-mobile-bar lecturer-mobile-bar">
          <button
            type="button"
            className="portal-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
            <span>Menu</span>
          </button>
          <Link to="/lecturer" className="portal-mobile-title" style={{ textDecoration: 'none', color: '#ffffff' }}>
            Lecturer Portal
          </Link>
          <div className="portal-mobile-actions">
            <Link to="/hub" className="portal-mobile-upload" title="Return to Campus Hub" aria-label="Campus Hub Home">
              <Home size={16} />
            </Link>
            <Link to="/lecturer/upload" className="portal-mobile-upload" title="Upload Material">
              <UploadCloud size={16} />
            </Link>
            <button
              type="button"
              className="portal-mobile-logout"
              onClick={handleLogout}
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Notification bell */}
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
            <div className={`notif-panel ${fx.fadeDown}`} role="dialog" aria-label="Notifications">
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
                  />
                  {notifFilter && (
                    <button type="button" onClick={() => setNotifFilter('')}>
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
              <div className="notif-list">
                {notifications.length === 0 ? (
                  <p className="notif-empty">No notifications yet.</p>
                ) : visibleNotifications.length === 0 ? (
                  <p className="notif-empty">No notifications match filter.</p>
                ) : (
                  visibleNotifications.map((n) => (
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
                        }}
                      >
                        <b>{n.title}</b>
                        <span><MessageText body={n.body} inline /></span>
                        <small>{new Date(n.createdAt).toLocaleDateString()}</small>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Content routing */}
        <div key={currentPath} className={fx.page} style={{ animationDuration: '180ms' }}>
          <ErrorBoundary>
            {currentPath === '/lecturer' || currentPath === '/lecturer/' ? (
              <LecturerOverviewTab
                lecturer={lecturerRecord}
                materials={myMaterials}
                totalDownloads={totalDownloads}
                totalViews={totalViews}
                secondaryDepartments={secondaryDepartments}
                onReadOnline={onReadOnline}
                onEditMaterial={(m) => setEditMaterial(m)}
                onDeleteMaterial={(m) => setDeleteConfirm({ open: true, material: m })}
              />
            ) : currentPath.startsWith('/lecturer/materials') ? (
              <LecturerMaterialsTab
                materials={myMaterials}
                loading={loadingMaterials}
                onReadOnline={onReadOnline}
                onEditMaterial={(m) => setEditMaterial(m)}
                onDeleteMaterial={(m) => setDeleteConfirm({ open: true, material: m })}
                onRefresh={loadMyMaterials}
              />
            ) : currentPath.startsWith('/lecturer/upload') ? (
              <LecturerUploadTab
                lecturer={lecturerRecord}
                onUploaded={async () => {
                  await loadMyMaterials();
                  navigate('/lecturer/materials');
                }}
              />
            ) : currentPath.startsWith('/lecturer/profile') ? (
              <LecturerProfileTab
                lecturer={lecturerRecord}
                secondaryDepartments={secondaryDepartments}
                onUpdated={loadLecturerDetails}
              />
            ) : currentPath.startsWith('/lecturer/announcements') || currentPath.startsWith('/lecturer/notifications') ? (
              <LecturerNotificationsTab
                notifications={notifications}
                lecturer={lecturerRecord}
                secondaryDepartments={secondaryDepartments}
                onRefresh={async () => {
                  const items = await fetchNotifications();
                  setNotifications(items);
                }}
              />
            ) : (
              <LecturerHelpTab />
            )}
          </ErrorBoundary>
        </div>
      </main>

      {/* Edit Material Modal */}
      {editMaterial && (
        <EditMaterialModal
          material={editMaterial}
          isOpen={!!editMaterial}
          onClose={() => setEditMaterial(null)}
          onSaved={async () => {
            setEditMaterial(null);
            await loadMyMaterials();
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirm.open}
        title="Delete library material?"
        tone="danger"
        confirmLabel={deleting ? 'Deleting…' : 'Delete Material'}
        message={
          deleteConfirm.material
            ? `Are you sure you want to permanently delete "${deleteConfirm.material.title}"? This removes the document file and catalogue entry for all students.`
            : ''
        }
        onConfirm={handleDeleteMaterial}
        onClose={() => setDeleteConfirm({ open: false, material: null })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Lecturer Overview / Dashboard Tab                                       */
/* -------------------------------------------------------------------------- */
function LecturerOverviewTab({
  lecturer,
  materials,
  totalDownloads,
  totalViews,
  secondaryDepartments,
  onReadOnline,
  onEditMaterial,
  onDeleteMaterial
}: {
  lecturer: LecturerRecord | null;
  materials: MaterialItem[];
  totalDownloads: number;
  totalViews: number;
  secondaryDepartments: DepartmentOption[];
  onReadOnline: (m: MaterialItem) => void;
  onEditMaterial: (m: MaterialItem) => void;
  onDeleteMaterial: (m: MaterialItem) => void;
}) {
  const recentMaterials = materials.slice(0, 5);

  return (
    <div className="portal-view-fade">
      {/* Academic Institutional Banner */}
      <div
        className="portal-card"
        style={{
          background: 'linear-gradient(135deg, #133e26 0%, #1e6f43 100%)',
          color: '#fff',
          padding: '28px 32px',
          borderRadius: '14px',
          marginBottom: '24px',
          boxShadow: '0 8px 24px rgba(19, 62, 38, 0.15)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                marginBottom: '10px'
              }}
            >
              FEDERAL UNIVERSITY WUKARI · ACADEMIC STAFF
            </span>
            <h1 style={{ fontSize: '24px', margin: '0 0 6px', fontWeight: 800 }}>
              Welcome back, {lecturer?.academicRank ? `${lecturer.academicRank} ` : ''}
              {lecturer?.fullName || 'Lecturer'}
            </h1>
            <p style={{ margin: 0, opacity: 0.9, fontSize: '14px' }}>
              {lecturer?.departmentName || 'Department'} · {lecturer?.facultyName || 'Faculty'}
              {lecturer?.staffId && ` · Staff ID: ${lecturer.staffId}`}
            </p>
          </div>
          <Link
            to="/lecturer/upload"
            className="primary"
            style={{
              backgroundColor: '#fff',
              color: '#133e26',
              fontWeight: 700,
              padding: '10px 20px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}
          >
            <UploadCloud size={16} /> Publish New Material
          </Link>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '16px', marginBottom: '28px' }}>
        <div className="portal-stat-card">
          <div className="portal-stat-icon" style={{ backgroundColor: '#e7f5eb', color: '#1e6f43' }}>
            <FileText size={22} />
          </div>
          <div>
            <span className="portal-stat-label">Published Materials</span>
            <b className="portal-stat-value">{materials.length}</b>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon" style={{ backgroundColor: '#e0f2fe', color: '#0284c7' }}>
            <Download size={22} />
          </div>
          <div>
            <span className="portal-stat-label">Student Downloads</span>
            <b className="portal-stat-value">{totalDownloads.toLocaleString()}</b>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon" style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
            <Eye size={22} />
          </div>
          <div>
            <span className="portal-stat-label">Total Document Views</span>
            <b className="portal-stat-value">{totalViews.toLocaleString()}</b>
          </div>
        </div>

        <div className="portal-stat-card">
          <div className="portal-stat-icon" style={{ backgroundColor: '#f3e8ff', color: '#9333ea' }}>
            <Building2 size={22} />
          </div>
          <div>
            <span className="portal-stat-label">Teaching Scope</span>
            <b className="portal-stat-value">{1 + secondaryDepartments.length} Dept{secondaryDepartments.length !== 0 ? 's' : ''}</b>
          </div>
        </div>
      </div>

      {/* Recent Materials & Actions */}
      <div className="portal-card" style={{ padding: 'clamp(16px, 3.5vw, 24px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#133e26' }}>
              Your Recently Published Materials
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#577565' }}>
              Verified library materials published under your academic credentials.
            </p>
          </div>
          <Link to="/lecturer/materials" className="outline-btn" style={{ fontSize: '13px' }}>
            View All ({materials.length}) →
          </Link>
        </div>

        {recentMaterials.length === 0 ? (
          <div className="portal-empty" style={{ padding: '40px 20px', textAlign: 'center' }}>
            <BookOpen size={36} style={{ color: '#889e90', marginBottom: '10px' }} />
            <h4 style={{ margin: '0 0 6px', color: '#133e26' }}>No materials published yet</h4>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#577565' }}>
              Publish verified lecture notes, syllabi, past questions, or handouts directly to your students.
            </p>
            <Link to="/lecturer/upload" className="primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <UploadCloud size={15} /> Upload First Material
            </Link>
          </div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Course & Title</th>
                  <th>Type</th>
                  <th>Level / Sem</th>
                  <th>Downloads</th>
                  <th>Views</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentMaterials.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <b>{m.course}</b> {m.courseTitle ? `· ${m.courseTitle}` : ''}
                      <div style={{ fontSize: '12px', color: '#577565' }}>{m.title}</div>
                    </td>
                    <td>
                      <span className="badge" style={{ backgroundColor: '#f0f5f1', color: '#1e6f43', fontSize: '11px' }}>
                        {m.type}
                      </span>
                    </td>
                    <td>{m.level} · {m.semester?.includes('First') ? '1st' : '2nd'}</td>
                    <td>{m.downloads}</td>
                    <td>{m.views}</td>
                    <td>
                      <span className="status-badge approved" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={11} /> Published
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="table-action-btn"
                          onClick={() => onReadOnline(m)}
                          title="Read Online"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          type="button"
                          className="table-action-btn"
                          onClick={() => onEditMaterial(m)}
                          title="Edit Material"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          className="table-action-btn outline"
                          onClick={() => onDeleteMaterial(m)}
                          title="Delete Material"
                          style={{ color: '#b91c1c' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Lecturer Materials Tab (Full Table with Search & Filters)              */
/* -------------------------------------------------------------------------- */
function LecturerMaterialsTab({
  materials,
  loading,
  onReadOnline,
  onEditMaterial,
  onDeleteMaterial,
  onRefresh
}: {
  materials: MaterialItem[];
  loading: boolean;
  onReadOnline: (m: MaterialItem) => void;
  onEditMaterial: (m: MaterialItem) => void;
  onDeleteMaterial: (m: MaterialItem) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const filtered = useMemo(() => {
    return materials.filter((m) => {
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const matches =
          m.title.toLowerCase().includes(q) ||
          m.course.toLowerCase().includes(q) ||
          (m.courseTitle || '').toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (typeFilter && m.type !== typeFilter) return false;
      if (levelFilter && m.level !== levelFilter) return false;
      return true;
    });
  }, [materials, query, typeFilter, levelFilter]);

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">MY REPOSITORY</p>
          <h1>Published Course Materials ({materials.length})</h1>
          <p className="subtitle">
            Manage your verified lecture notes, past questions, and academic resources.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link to="/lecturer/upload" className="primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <UploadCloud size={15} /> Upload Material
          </Link>
          <button type="button" className="outline-btn" onClick={onRefresh} disabled={loading}>
            <Loader2 size={14} className={loading ? 'spin-icon' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '11px', color: '#668070' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, course code (e.g. CSC 301)..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '9px 12px 9px 36px',
              borderRadius: '6px',
              border: '1px solid #cddcd2',
              fontSize: '13px'
            }}
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', boxSizing: 'border-box', maxWidth: '100%' }}
        >
          <option value="">All Material Types</option>
          {materialTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', boxSizing: 'border-box', maxWidth: '100%' }}
        >
          <option value="">All Levels</option>
          {['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', '600 Level'].map((lvl) => (
            <option key={lvl} value={lvl}>{lvl}</option>
          ))}
        </select>
      </div>

      {/* Materials Table */}
      <div className="portal-card" style={{ padding: '0', overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state" style={{ padding: '40px' }}>
            <Loader2 size={28} className="spin-icon" />
            <b>Loading your materials…</b>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px 20px', textAlign: 'center' }}>
            <BookOpen size={36} style={{ color: '#889e90', marginBottom: '8px' }} />
            <b>No materials found</b>
            <span>{query ? 'No materials matched your filter.' : 'You have not uploaded any materials yet.'}</span>
          </div>
        ) : (
          <div className="table-scroll-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Course & Title</th>
                  <th>Assigned Departments</th>
                  <th>Type & Level</th>
                  <th>Session</th>
                  <th>Stats</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <b style={{ color: '#133e26', fontSize: '14px' }}>{m.course}</b>
                      {m.courseTitle && <span style={{ color: '#577565', fontSize: '13px' }}> · {m.courseTitle}</span>}
                      <div style={{ fontSize: '13px', fontWeight: 500, marginTop: '2px' }}>{m.title}</div>
                      <small style={{ color: '#7a9685' }}>Added on {new Date(m.createdAt || Date.now()).toLocaleDateString()}</small>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '240px' }}>
                        <span className="badge" style={{ backgroundColor: '#e7f5eb', color: '#1e6f43', fontSize: '11px' }}>
                          {m.department}
                        </span>
                        {(m.assignedDepartments || [])
                          .filter((d) => d.name !== m.department)
                          .map((d) => (
                            <span key={d.id} className="badge" style={{ backgroundColor: '#f0f5f1', color: '#3f5949', fontSize: '10px' }}>
                              +{d.name}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td>
                      <div>{m.type}</div>
                      <small style={{ color: '#7a9685' }}>{m.level} · {m.semester}</small>
                    </td>
                    <td>{m.session || '2025/2026'}</td>
                    <td>
                      <div style={{ fontSize: '12px' }}>
                        <span title="Downloads">📥 {m.downloads}</span> · <span title="Views">👁 {m.views}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="table-action-btn"
                          onClick={() => onReadOnline(m)}
                          title="Read Online"
                        >
                          <Eye size={14} /> Preview
                        </button>
                        <button
                          type="button"
                          className="table-action-btn"
                          onClick={() => onEditMaterial(m)}
                          title="Edit Material"
                        >
                          <Edit3 size={14} /> Edit
                        </button>
                        <button
                          type="button"
                          className="table-action-btn outline"
                          onClick={() => onDeleteMaterial(m)}
                          title="Delete Material"
                          style={{ color: '#b91c1c' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Direct Lecturer Publishing Upload Tab                                   */
/* -------------------------------------------------------------------------- */
function LecturerUploadTab({
  lecturer,
  onUploaded
}: {
  lecturer: LecturerRecord | null;
  onUploaded: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [level, setLevel] = useState('100 Level');
  const [semester, setSemester] = useState('First Semester');
  const [materialType, setMaterialType] = useState('Lecture Note');
  const [academicSession, setAcademicSession] = useState('2025/2026');
  const [description, setDescription] = useState('');

  const [faculty, setFaculty] = useState(lecturer?.facultyName || catalogue[0]?.name || '');
  const [department, setDepartment] = useState(lecturer?.departmentName || catalogue[0]?.departments[0]?.name || '');
  const [assignedDepartments, setAssignedDepartments] = useState<DepartmentOption[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (lecturer?.facultyName) setFaculty(lecturer.facultyName);
    if (lecturer?.departmentName) setDepartment(lecturer.departmentName);
  }, [lecturer]);

  const handleFacultyChange = (newFac: string) => {
    setFaculty(newFac);
    const depts = catalogue.find((f) => f.name === newFac)?.departments || [];
    if (depts.length > 0) {
      setDepartment(depts[0].name);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    try {
      await validateMaterialFile(chosen);
      setFile(chosen);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid file format.');
      setFile(null);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!file) {
      setErrorMsg('Please select a document file to upload.');
      return;
    }
    if (!title.trim() || !courseCode.trim()) {
      setErrorMsg('Material title and course code are required.');
      return;
    }

    setBusy(true);
    try {
      const extraDeptIds = assignedDepartments
        .map((d) => d.id)
        .filter((id) => id && id.length > 10 && id.includes('-'));

      await submitMaterial({
        title: title.trim(),
        description: description.trim(),
        faculty,
        department,
        department_ids: extraDeptIds.length > 0 ? extraDeptIds : undefined,
        course_code: courseCode.trim().toUpperCase(),
        course_title: courseTitle.trim() || undefined,
        level,
        semester,
        material_type: materialType,
        academic_session: academicSession.trim(),
        file
      });

      toast('Material published directly to library repository and student audience notified!', 'success');
      onUploaded();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to publish material.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">INSTITUTIONAL DIRECT PUBLISHING</p>
          <h1>Publish Course Material</h1>
          <p className="subtitle">
            As a verified academic staff member, your uploaded materials are instantly published without admin bottleneck and notified directly to students in assigned departments.
          </p>
        </div>
      </div>

      <div className="portal-card" style={{ maxWidth: '820px', padding: '28px' }}>
        {errorMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              backgroundColor: '#fde8e8',
              color: '#9b1c1c',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '13px'
            }}
          >
            <AlertCircle size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* File Picker Box */}
          <div
            style={{
              border: '2px dashed #b8d4c2',
              backgroundColor: '#f8fbf9',
              borderRadius: '10px',
              padding: '24px',
              textAlign: 'center'
            }}
          >
            <UploadCloud size={36} style={{ color: '#1e6f43', marginBottom: '8px' }} />
            <h4 style={{ margin: '0 0 4px', fontSize: '15px', color: '#133e26' }}>
              {file ? file.name : 'Choose Course Document'}
            </h4>
            <p style={{ margin: '0 0 14px', fontSize: '12px', color: '#577565' }}>
              PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT (Maximum 25 MB)
            </p>
            <label
              className="primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                padding: '8px 18px',
                fontSize: '13px'
              }}
            >
              <span>{file ? 'Change Document File' : 'Browse Files'}</span>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"
                style={{ display: 'none' }}
                disabled={busy}
              />
            </label>
          </div>

          {/* Title & Description */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Material Title *</label>
            <input
              required
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Complete Lecture Notes on Database Systems & Indexing"
              disabled={busy}
              style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px' }}
            />
          </div>

          {/* Course Code & Course Title */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Course Code *</label>
              <input
                required
                type="text"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                placeholder="e.g. CSC 301"
                disabled={busy}
                style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Course Title (Optional)</label>
              <input
                type="text"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                placeholder="e.g. Database Management Systems"
                disabled={busy}
                style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Level, Semester, Material Type, Session */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Academic Level</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                disabled={busy}
                style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', width: '100%', boxSizing: 'border-box' }}
              >
                {['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', '600 Level'].map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Semester</label>
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                disabled={busy}
                style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', width: '100%', boxSizing: 'border-box' }}
              >
                <option value="First Semester">First Semester</option>
                <option value="Second Semester">Second Semester</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Material Type</label>
              <select
                value={materialType}
                onChange={(e) => setMaterialType(e.target.value)}
                disabled={busy}
                style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', width: '100%', boxSizing: 'border-box' }}
              >
                {materialTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>Academic Session</label>
              <input
                type="text"
                value={academicSession}
                onChange={(e) => setAcademicSession(e.target.value)}
                placeholder="2025/2026"
                disabled={busy}
                style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Department Alignment */}
          <div style={{ borderTop: '1px solid #e1ece3', paddingTop: '16px' }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#133e26', fontWeight: 700 }}>
              Audience & Department Alignment
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '14px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#133e26' }}>Primary Faculty *</label>
                <select
                  value={faculty}
                  onChange={(e) => handleFacultyChange(e.target.value)}
                  disabled={busy}
                  style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', width: '100%', boxSizing: 'border-box' }}
                >
                  {catalogue.map((f) => (
                    <option key={f.name} value={f.name}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#133e26' }}>Primary Department *</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={busy}
                  style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', backgroundColor: '#fff', width: '100%', boxSizing: 'border-box' }}
                >
                  {(catalogue.find((f) => f.name === faculty)?.departments || []).map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Multi-department picker for courses taught across departments */}
            <div style={{ marginTop: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#133e26', display: 'block', marginBottom: '6px' }}>
                Secondary Departments Offering This Course (Optional)
              </span>
              <DepartmentAssigner
                selectedDepartments={assignedDepartments}
                onChange={setAssignedDepartments}
                required={false}
              />
            </div>
          </div>

          {/* Description */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#133e26' }}>
              Notes / Description for Students
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide context, syllabus chapters covered, or key reading guidance..."
              disabled={busy}
              style={{ padding: '9px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px' }}
            />
          </div>

          {/* Submit Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button
              type="submit"
              className="primary"
              disabled={busy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: 700
              }}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="spin-icon" /> Publishing Document…
                </>
              ) : (
                <>
                  <UploadCloud size={16} /> Publish Material Directly
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Lecturer Profile & Academic Scope Tab                                  */
/* -------------------------------------------------------------------------- */
function LecturerProfileTab({
  lecturer,
  secondaryDepartments,
  onUpdated
}: {
  lecturer: LecturerRecord | null;
  secondaryDepartments: DepartmentOption[];
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [phone, setPhone] = useState(lecturer?.phone || '');
  const [officeLocation, setOfficeLocation] = useState(lecturer?.officeLocation || '');
  const [bio, setBio] = useState(lecturer?.bio || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lecturer) {
      setPhone(lecturer.phone || '');
      setOfficeLocation(lecturer.officeLocation || '');
      setBio(lecturer.bio || '');
    }
  }, [lecturer]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await lecturerUpdateOwnProfile({
        phone: phone.trim(),
        officeLocation: officeLocation.trim(),
        bio: bio.trim()
      });
      toast('Academic profile updated successfully.', 'success');
      onUpdated();
    } catch (err: any) {
      toast(err?.message || 'Failed to update profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">INSTITUTIONAL PROFILE</p>
          <h1>Academic Profile & Teaching Scope</h1>
          <p className="subtitle">
            View your institutional affiliations and manage your contact details and academic statement.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '20px', maxWidth: '960px' }}>
        {/* Read-only Institutional Credentials */}
        <div className="portal-card" style={{ padding: 'clamp(16px, 3.5vw, 24px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <ShieldCheck size={20} style={{ color: '#1e6f43', flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontSize: '16px', color: '#133e26' }}>Institutional Credentials</h3>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#577565', lineHeight: 1.5 }}>
            Managed by university administration. Contact the Dean's office or Academic Registry to request changes.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <span style={{ fontSize: '11px', color: '#7a9685', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Academic Title & Rank
              </span>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#133e26', marginTop: '2px', wordBreak: 'break-word' }}>
                {lecturer?.academicRank || 'Academic Lecturer'}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#7a9685', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Staff File ID
              </span>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#133e26', marginTop: '2px', wordBreak: 'break-all' }}>
                {lecturer?.staffId || 'Pending Administrative Assignment'}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#7a9685', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Primary Faculty & Department
              </span>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#133e26', marginTop: '2px', wordBreak: 'break-word' }}>
                {lecturer?.departmentName || 'Department'} · {lecturer?.facultyName || 'Faculty'}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#7a9685', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Secondary Teaching Departments
              </span>
              <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {secondaryDepartments.length === 0 ? (
                  <span style={{ fontSize: '13px', color: '#7a9685' }}>None assigned</span>
                ) : (
                  secondaryDepartments.map((dept) => (
                    <span key={dept.id} className="badge" style={{ backgroundColor: '#e7f5eb', color: '#1e6f43', maxWidth: '100%', wordBreak: 'break-word' }}>
                      {dept.name}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#7a9685', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Official University Email
              </span>
              <div style={{ fontSize: '13px', color: '#133e26', marginTop: '2px', wordBreak: 'break-all' }}>
                {lecturer?.staffEmail || 'Not configured'}
              </div>
            </div>
          </div>
        </div>

        {/* Editable Personal Contact & Academic Statement */}
        <div className="portal-card" style={{ padding: 'clamp(16px, 3.5vw, 24px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <UserCheck size={20} style={{ color: '#1e6f43', flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontSize: '16px', color: '#133e26' }}>Editable Contact & Profile</h3>
          </div>

          <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#133e26' }}>Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 08012345678"
                disabled={saving}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#133e26' }}>Office Location</label>
              <input
                type="text"
                value={officeLocation}
                onChange={(e) => setOfficeLocation(e.target.value)}
                placeholder="e.g. Science Complex, Office 204"
                disabled={saving}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#133e26' }}>
                Academic Statement / Research Interests
              </label>
              <textarea
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Brief summary of research areas, office consultation hours, and academic focus..."
                disabled={saving}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cddcd2', fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="submit"
              className="primary"
              disabled={saving}
              style={{
                alignSelf: 'flex-start',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '6px'
              }}
            >
              {saving ? <Loader2 size={14} className="spin-icon" /> : null}
              Save Profile Changes
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Lecturer Notifications & Broadcast Announcements Tab                    */
/* -------------------------------------------------------------------------- */
function LecturerNotificationsTab({
  notifications = [],
  lecturer,
  secondaryDepartments = [],
  onRefresh
}: {
  notifications?: NotificationItem[];
  lecturer: LecturerRecord | null;
  secondaryDepartments?: DepartmentOption[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'received' | 'broadcasts'>('broadcasts');
  const [broadcastModalOpen, setBroadcastModalOpen] = useState(false);
  const [sentBroadcasts, setSentBroadcasts] = useState<any[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);

  // Form state for creating/editing announcement
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [announcementType, setAnnouncementType] = useState<'general' | 'important' | 'assignment' | 'exam'>('general');
  const [targetScope, setTargetScope] = useState<'department' | 'all_departments' | 'faculty'>('department');
  const [targetLevels, setTargetLevels] = useState<string[]>([]);
  const [isDraft, setIsDraft] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const ALL_LEVELS = ['100L', '200L', '300L', '400L', '500L'];

  const toggleLevel = (lvl: string) => {
    setTargetLevels((prev) =>
      prev.includes(lvl) ? prev.filter((l) => l !== lvl) : [...prev, lvl]
    );
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
    setAnnouncementType('general');
    setTargetScope('department');
    setTargetLevels([]);
    setIsDraft(false);
    setBroadcastModalOpen(true);
  };

  const handleOpenEdit = (b: any) => {
    setEditingId(b.id);
    setTitle(b.title || '');
    setBody(b.body || '');
    setAnnouncementType(b.announcement_type || 'general');
    setTargetScope(b.target_faculty_id ? 'faculty' : (b.target_department_ids && b.target_department_ids.length > 1 ? 'all_departments' : 'department'));
    setTargetLevels(Array.isArray(b.target_levels) ? b.target_levels : []);
    setIsDraft(!b.is_published);
    setBroadcastModalOpen(true);
  };

  const handleDelete = async (broadcastId: string) => {
    if (!window.confirm('Are you sure you want to delete this announcement?')) return;
    try {
      await lecturerDeleteAnnouncement(broadcastId);
      toast('Announcement deleted successfully.', 'success');
      await loadSentBroadcasts();
      onRefresh();
    } catch (err: any) {
      toast(err.message || 'Failed to delete announcement.', 'error');
    }
  };

  const handlePublishDraft = async (b: any) => {
    try {
      await lecturerBroadcastAnnouncement({
        title: b.title,
        body: b.body,
        facultyId: b.target_faculty_id,
        departmentIds: b.target_department_ids,
        announcementType: b.announcement_type,
        targetLevels: b.target_levels,
        isDraft: false,
        announcementId: b.id
      });
      toast('Draft announcement published and broadcast to students!', 'success');
      await loadSentBroadcasts();
      onRefresh();
    } catch (err: any) {
      toast(err.message || 'Failed to publish announcement.', 'error');
    }
  };

  const loadSentBroadcasts = async () => {
    if (!supabase) return;
    setLoadingBroadcasts(true);
    try {
      const { data, error } = await supabase
        .from('library_announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (!error && data) {
        setSentBroadcasts(data);
      }
    } catch {
      // non-blocking
    } finally {
      setLoadingBroadcasts(false);
    }
  };

  useEffect(() => {
    void loadSentBroadcasts();
  }, []);

  const formatBroadcastDate = (dateVal: any) => {
    if (!dateVal) return 'Recently';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return 'Recently';
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Recently';
    }
  };

  const handleBroadcast = async (e: React.FormEvent, forceDraft: boolean = isDraft) => {
    e.preventDefault();
    if (!title.trim()) {
      toast('Please enter an announcement title.', 'error');
      return;
    }
    if (!body.trim()) {
      toast('Please enter the announcement body.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      let facultyId: string | null = null;
      let deptIds: string[] | null = null;

      if (targetScope === 'faculty') {
        facultyId = lecturer?.facultyId || null;
      } else if (targetScope === 'department') {
        deptIds = lecturer?.departmentId ? [lecturer.departmentId] : null;
      } else if (targetScope === 'all_departments') {
        const allDepts = [
          ...(lecturer?.departmentId ? [lecturer.departmentId] : []),
          ...(secondaryDepartments || []).map((d) => d.id).filter((id) => Boolean(id))
        ];
        deptIds = Array.from(new Set(allDepts));
      }

      await lecturerBroadcastAnnouncement({
        title: title.trim(),
        body: body.trim(),
        facultyId: facultyId || undefined,
        departmentIds: deptIds && deptIds.length > 0 ? deptIds : undefined,
        announcementType,
        targetLevels: targetLevels.length > 0 ? targetLevels : undefined,
        isDraft: forceDraft,
        announcementId: editingId
      });

      toast(
        forceDraft
          ? 'Announcement saved as draft.'
          : (editingId ? 'Announcement updated successfully.' : 'Announcement broadcast successfully to students!'),
        'success'
      );
      setBroadcastModalOpen(false);
      await loadSentBroadcasts();
      onRefresh();
    } catch (err: any) {
      toast(err.message || 'Failed to process announcement.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">COMMUNICATIONS & OUTREACH</p>
          <h1>Department Announcements & Alerts</h1>
          <p className="subtitle">
            Broadcast targeted assignments, lecture updates, and view system alerts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="primary"
            onClick={handleOpenCreate}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13
            }}
          >
            <Plus size={16} /> Broadcast Announcement
          </button>
          <button
            type="button"
            className="outline-btn"
            onClick={() => {
              onRefresh();
              void loadSentBroadcasts();
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveTab('broadcasts')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: activeTab === 'broadcasts' ? '1px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
            background: activeTab === 'broadcasts' ? '#e8f5ec' : 'var(--surface, #ffffff)',
            color: activeTab === 'broadcasts' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer'
          }}
        >
          Sent Broadcasts ({sentBroadcasts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('received')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: activeTab === 'received' ? '1px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
            background: activeTab === 'received' ? '#e8f5ec' : 'var(--surface, #ffffff)',
            color: activeTab === 'received' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer'
          }}
        >
          Received Alerts ({notifications.length})
        </button>
      </div>

      {/* Broadcasts Tab */}
      {activeTab === 'broadcasts' && (
        <div className="portal-card" style={{ padding: '0', overflow: 'hidden' }}>
          {loadingBroadcasts ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary, #55675b)' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
              <div>Loading broadcasts…</div>
            </div>
          ) : sentBroadcasts.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px' }}>
              <Bell size={32} style={{ color: '#889e90', marginBottom: '8px' }} />
              <b>No broadcasts sent yet.</b>
              <p style={{ margin: '4px 0 16px', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                You can broadcast an announcement directly to students in your department or faculty.
              </p>
              <button
                type="button"
                className="primary"
                onClick={handleOpenCreate}
                style={{ fontSize: 13 }}
              >
                Create Announcement
              </button>
            </div>
          ) : (
            <div className="notif-list" style={{ padding: '8px' }}>
              {sentBroadcasts.map((b) => (
                <div
                  key={b.id}
                  style={{
                    padding: '16px 18px',
                    borderBottom: '1px solid var(--border, #edf4f0)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 15, color: 'var(--green-900, #0d4a2f)' }}>{b.title || 'Announcement'}</strong>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: b.is_published ? '#e8f5ec' : '#f1f5f9',
                          color: b.is_published ? '#065f46' : '#64748b',
                          border: `1px solid ${b.is_published ? '#bbf7d0' : '#cbd5e1'}`
                        }}
                      >
                        {b.is_published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: b.announcement_type === 'important' ? '#fee2e2' : '#e0f2fe',
                          color: b.announcement_type === 'important' ? '#991b1b' : '#0369a1'
                        }}
                      >
                        {b.announcement_type || 'General'}
                      </span>
                      {b.target_levels && b.target_levels.length > 0 && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                          {b.target_levels.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary, #17231d)' }}>
                    <MessageText body={b.body || ''} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 8 }}>
                    <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 12 }}>
                      {b.is_published
                        ? `Broadcast on ${formatBroadcastDate(b.published_at || b.created_at)}`
                        : `Saved as draft on ${formatBroadcastDate(b.created_at)}`}
                    </small>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!b.is_published && (
                        <button
                          type="button"
                          onClick={() => handlePublishDraft(b)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            borderRadius: 6,
                            background: '#e8f5ec',
                            color: '#0d4a2f',
                            border: '1px solid #bbf7d0',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          <CheckCircle2 size={13} /> Publish Now
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(b)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'transparent',
                          color: 'var(--text-secondary, #55675b)',
                          border: '1px solid var(--border, #dcebe0)',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <Edit3 size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(b.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'transparent',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Received Alerts Tab */}
      {activeTab === 'received' && (
        <div className="portal-card" style={{ padding: '0', overflow: 'hidden' }}>
          {notifications.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px' }}>
              <Bell size={32} style={{ color: '#889e90', marginBottom: '8px' }} />
              <b>No incoming alerts right now.</b>
            </div>
          ) : (
            <div className="notif-list" style={{ padding: '8px' }}>
              {notifications.map((n) => (
                <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} style={{ padding: '12px 16px', borderRadius: '6px' }}>
                  <b>{n.title}</b>
                  <div style={{ margin: '6px 0', fontSize: '13px' }}>
                    <MessageText body={n.body} />
                  </div>
                  <small style={{ color: '#7a9685' }}>{formatBroadcastDate(n.createdAt)}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Broadcast Announcement Modal */}
      {broadcastModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setBroadcastModalOpen(false)}
        >
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 16,
              maxWidth: 560,
              width: '100%',
              padding: 'clamp(16px, 3.5vw, 24px)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--green-900, #0d4a2f)' }}>
                {editingId ? 'Edit Announcement' : 'Broadcast Student Announcement'}
              </h3>
              <button
                type="button"
                onClick={() => setBroadcastModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} color="var(--text-secondary, #55675b)" />
              </button>
            </div>

            <form onSubmit={(e) => handleBroadcast(e, false)}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Announcement Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. CSC 401 Assignment Submission Deadline"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Target Department / Faculty Scope *
                    </label>
                    <select
                      value={targetScope}
                      onChange={(e) => setTargetScope(e.target.value as any)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14
                      }}
                    >
                      <option value="department">
                        Primary ({lecturer?.departmentName || 'Your Department'})
                      </option>
                      {secondaryDepartments.length > 0 && (
                        <option value="all_departments">
                          All Assigned ({1 + secondaryDepartments.length} Departments)
                        </option>
                      )}
                      <option value="faculty">
                        Entire Faculty ({lecturer?.facultyName || 'Your Faculty'})
                      </option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Notice Category
                    </label>
                    <select
                      value={announcementType}
                      onChange={(e) => setAnnouncementType(e.target.value as any)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14
                      }}
                    >
                      <option value="general">General Notice</option>
                      <option value="assignment">Assignment / Coursework</option>
                      <option value="exam">Exam / Test Notice</option>
                      <option value="important">Urgent Advisory</option>
                    </select>
                  </div>
                </div>

                {/* Level Targeting */}
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Target Academic Level (optional)
                  </label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ALL_LEVELS.map((lvl) => {
                      const isSelected = targetLevels.includes(lvl);
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => toggleLevel(lvl)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: isSelected ? '1px solid #12603d' : '1px solid var(--border, #dcebe0)',
                            background: isSelected ? '#e8f5ec' : 'var(--surface-alt, #f4f8f5)',
                            color: isSelected ? '#12603d' : 'var(--text-secondary, #55675b)'
                          }}
                        >
                          {lvl}
                        </button>
                      );
                    })}
                    {targetLevels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setTargetLevels([])}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: 'none',
                          background: 'transparent',
                          color: '#dc2626',
                          cursor: 'pointer'
                        }}
                      >
                        Clear (All Levels)
                      </button>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', display: 'block', marginTop: 4 }}>
                    {targetLevels.length === 0
                      ? 'Targeting all student levels in the chosen scope.'
                      : `Notifications will be restricted to students in ${targetLevels.join(', ')}.`}
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Announcement Message *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Enter detailed notice for students..."
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      fontSize: 14,
                      resize: 'vertical'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setBroadcastModalOpen(false)}
                  className="btn btn-secondary"
                  style={{
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !title.trim() || !body.trim()}
                  onClick={(e) => handleBroadcast(e, true)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#f1f5f9',
                    color: '#334155',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 700
                  }}
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !title.trim() || !body.trim()}
                  onClick={(e) => handleBroadcast(e, false)}
                  className="btn btn-primary"
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    background: 'var(--green-900, #0d4a2f)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>Broadcast &amp; Notify</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Lecturer Help & Guidelines Tab                                         */
/* -------------------------------------------------------------------------- */
function LecturerHelpTab() {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SUPPORT & REGISTRY</p>
          <h1>Lecturer Guidelines & Repository Policies</h1>
          <p className="subtitle">Best practices for material uploads and academic repository standards.</p>
        </div>
      </div>

      <div className="portal-card" style={{ maxWidth: '800px', padding: '28px' }}>
        <h3 style={{ margin: '0 0 10px', color: '#133e26' }}>Direct Publishing Authority</h3>
        <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#334e3e' }}>
          As an authenticated lecturer, any material you publish is instantly approved and catalogued into the FUW E-Library. There is no waiting for librarian approval. Students enrolled in your assigned departments receive immediate targeted notifications.
        </p>

        <h3 style={{ margin: '20px 0 10px', color: '#133e26' }}>Acceptable File Formats</h3>
        <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#334e3e' }}>
          Ensure all uploaded documents are in one of the approved formats: PDF, DOCX, PPTX, XLSX, or plain text. The maximum allowed file size per material is 25 MB.
        </p>

        <h3 style={{ margin: '20px 0 10px', color: '#133e26' }}>Cross-Department Courses</h3>
        <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#334e3e' }}>
          When uploading a course material taught to multiple programmes (e.g. general courses or shared science units), use the <b>Secondary Departments</b> selector during upload. This ensures students in all relevant departments can discover the material on their dashboard.
        </p>
      </div>
    </div>
  );
}
