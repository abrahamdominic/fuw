import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Building2,
  Clock,
  Download,
  Eye,
  FileText,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X
} from 'lucide-react';
import { Logo } from '../components/Logo';
import { useAuth } from '../lib/AuthContext';
import { roleLabel } from '../lib/rbac';
import { useToast } from '../components/Toast';
import { fx, staggerDelay } from '../lib/motion';
import { AnalyticsChart, type AnalyticsDatum } from '../components/AnalyticsCharts';
import { MessageText } from '../components/MessageText';
import { VcWelcome } from '../components/VcWelcome';
import {
  fetchVcOverview,
  fetchVcStudentInsights,
  fetchVcAcademicResources,
  fetchVcReportsOverview,
  type AnnouncementRow,
  type RecentMaterialRow,
  type TopMaterialRow,
  type VcAcademicResources,
  type VcOverviewStats,
  type VcReportsOverview,
  type VcStudentInsights,
  type NameCount,
  type MonthCount
} from '../lib/vc';

const vcNavItems = [
  { label: 'Overview', path: '/vc', icon: LayoutDashboard, exact: true },
  { label: 'Student Insights', path: '/vc/students', icon: Users },
  { label: 'Academic Resources', path: '/vc/resources', icon: BookOpen },
  { label: 'Reports', path: '/vc/reports', icon: FileText }
];

function toDatum(rows: NameCount[] | undefined, fallbackLabel = 'Unassigned'): AnalyticsDatum[] {
  return (rows ?? []).map((r) => ({
    label: r.name || fallbackLabel,
    value: Number(r.count) || 0
  }));
}

function toMonthDatum(rows: MonthCount[]): AnalyticsDatum[] {
  return (rows ?? []).map((r) => {
    const label = (r.label || '').length === 7
      ? new Date(`${r.label}-01`).toLocaleString('en-US', { month: 'short', year: '2-digit' })
      : r.label || '—';
    return { label, value: Number(r.count) || 0 };
  });
}

export function ViceChancellorPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, profile, role } = useAuth();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentPath = location.pathname;

  const handleVcLogout = async () => {
    await signOut();
    toast('Logged out of Executive Overview', 'info');
    navigate('/vc/login');
  };

  const activeTab = (item: { path: string; exact?: boolean }) =>
    item.exact
      ? currentPath === item.path || currentPath === item.path + '/'
      : currentPath.startsWith(item.path);

  return (
    <div className="portal">
      <aside className={`side vc-side ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="side-header">
          <Link className="brand vc-brand" to="/vc" onClick={() => setMobileMenuOpen(false)} title="Executive Overview">
            <Logo size={32} />
            <b>FUW</b> Executive Office
          </Link>
          <button className="side-close-btn" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <div className="side-user-card vc-user-card">
          <div className="user-avatar-circle vc-avatar">
            <Landmark size={18} />
          </div>
          <div className="user-info-text">
            <b>{profile?.fullName || 'Office of the Vice-Chancellor'}</b>
            <span>{roleLabel(role)}</span>
          </div>
        </div>

        <p className="side-nav-heading">EXECUTIVE OVERSIGHT</p>

        <nav className="side-nav-list">
          {vcNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.label}
                to={item.path}
                className={`side-link vc-side-link ${activeTab(item) ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="side-footer-actions">
          <button type="button" onClick={handleVcLogout} className="side-link logout-link logout-btn">
            <LogOut size={17} />
            <span>Sign out / Exit</span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          type="button"
          className="portal-scrim"
          aria-label="Close executive navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <main className="portal-main">
        <div className="portal-mobile-bar vc-mobile-bar">
          <button
            className="portal-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open executive menu"
          >
            <Menu size={22} />
            <span>Executive Menu</span>
          </button>
          <span className="portal-mobile-title">Executive Overview</span>
          <div className="portal-mobile-actions">
            <button
              type="button"
              className="portal-mobile-logout"
              onClick={handleVcLogout}
              aria-label="Sign out / Exit"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        <VcWelcome userId={profile?.id ?? ''} />

        {currentPath === '/vc' || currentPath === '/vc/' ? (
          <VcOverviewTab />
        ) : currentPath.startsWith('/vc/students') ? (
          <VcStudentInsightsTab />
        ) : currentPath.startsWith('/vc/resources') ? (
          <VcAcademicResourcesTab />
        ) : currentPath.startsWith('/vc/reports') ? (
          <VcReportsTab />
        ) : (
          <VcOverviewTab />
        )}
      </main>
    </div>
  );
}

// ── Section A: Executive Overview ────────────────────────────────────────────
function VcOverviewTab() {
  const [overview, setOverview] = useState<VcOverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await fetchVcOverview();
    setOverview(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const o = overview;
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">EXECUTIVE OVERVIEW</p>
          <h1>Institutional overview</h1>
          <p className="subtitle">
            Read-only university-wide statistics across FUW Campus Hub. Marketplace,
            accommodation and administration details are excluded from this surface.
          </p>
        </div>
        <div className="portal-top-actions">
          <Link className="secondary-btn" to="/vc/students">
            <Users size={16} />
            <span>Student Insights</span>
          </Link>
          <Link className="vc-primary-link" to="/vc/resources">
            <BookOpen size={16} />
            <span>Academic Resources</span>
          </Link>
        </div>
      </div>

      {loading && !o ? (
        <div className="portal-stats admin-stats-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <section key={i} className="vc-stat-skeleton" aria-hidden="true">
              <Loader2 size={22} className="spin-icon" />
            </section>
          ))}
        </div>
      ) : (
        <div className="portal-stats admin-stats-grid">
          <section className={fx.fadeUp} style={staggerDelay(0, 50)}>
            <Users />
            <b>{(o?.students ?? 0).toLocaleString()}</b>
            <span>Registered students</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(1, 50)}>
            <ShieldCheck />
            <b>{(o?.verified_students ?? 0).toLocaleString()}</b>
            <span>Verified students</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(2, 50)}>
            <Clock />
            <b>{(o?.pending_verifications ?? 0).toLocaleString()}</b>
            <span>Pending verification</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(3, 50)}>
            <GraduationCap />
            <b>{(o?.lecturers ?? 0).toLocaleString()}</b>
            <span>Lecturers</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(4, 50)}>
            <Building2 />
            <b>{(o?.faculties ?? 0).toLocaleString()}</b>
            <span>Faculties</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(5, 50)}>
            <BookOpen />
            <b>{(o?.departments ?? 0).toLocaleString()}</b>
            <span>Departments</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(6, 50)}>
            <Download />
            <b>{(o?.total_downloads ?? 0).toLocaleString()}</b>
            <span>Total downloads</span>
          </section>
          <section className={fx.fadeUp} style={staggerDelay(7, 50)}>
            <Eye />
            <b>{(o?.total_views ?? 0).toLocaleString()}</b>
            <span>Total views</span>
          </section>
        </div>
      )}

      <div className="vc-overview-panels">
        <div className="admin-chart">
          <div className="chart-header">
            <div>
              <p className="kicker">E-LIBRARY TELEMETRY</p>
              <h2>Repository health</h2>
            </div>
            <span className="chart-tag">Academic Resources</span>
          </div>
          <div className="vc-panel-grid">
            <PanelStat label="Approved materials" value={o?.approved_materials} />
            <PanelStat label="Pending materials" value={o?.pending_materials} />
            <PanelStat label="Rejected materials" value={o?.rejected_materials} />
            <PanelStat label="Courses" value={o?.courses} />
            <PanelStat label="Published announcements" value={o?.announcements} />
            <PanelStat label="Active students" value={o?.active_students} />
          </div>
        </div>
        <div className="admin-chart vc-governance-card">
          <div className="chart-header">
            <div>
              <p className="kicker">EXECUTIVE GOVERNANCE</p>
              <h2>Scope &amp; boundaries</h2>
            </div>
          </div>
          <p className="vc-governance-text">
            The Executive Overview is a strictly read-only surface for the Office of the
            Vice-Chancellor. It reports aggregate institutional statistics and never exposes
            administrator accounts, permissions, wallets, or accommodation and marketplace
            back-office data. All data is served by server-side aggregate functions restricted
            to this role.
          </p>
        </div>
      </div>
    </div>
  );
}

function PanelStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="vc-panel-stat">
      <b>{(value ?? 0).toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}

// ── Section B: Student Insights ──────────────────────────────────────────────
function VcStudentInsightsTab() {
  const [data, setData] = useState<VcStudentInsights | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setData(await fetchVcStudentInsights());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const d = data;
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STUDENT INSIGHTS</p>
          <h1>Student body analytics</h1>
          <p className="subtitle">
            Aggregate enrolment, demographic and verification statistics. Individual student
            identities are never returned.
          </p>
        </div>
      </div>

      <div className="vc-charts-grid">
        <AnalyticsChart
          title="Enrolment by faculty"
          description="Registered students grouped by faculty"
          items={toDatum(d?.by_faculty)}
          loading={loading}
          horizontal
          valueLabel="students"
        />
        <AnalyticsChart
          title="Top departments"
          description="Largest student departments"
          items={toDatum(d?.by_department)}
          loading={loading}
          horizontal
          valueLabel="students"
        />
        <AnalyticsChart
          title="Students by level"
          description="Distribution across academic levels"
          items={toDatum(d?.by_level)}
          loading={loading}
          horizontal
          valueLabel="students"
        />
        <AnalyticsChart
          title="Students by gender"
          description="Gender distribution of registered students"
          items={toDatum(d?.by_gender)}
          loading={loading}
          valueLabel="students"
        />
        <AnalyticsChart
          title="Verification status"
          description="Registration verification pipeline"
          items={toDatum(d?.verification_breakdown)}
          loading={loading}
          valueLabel="students"
        />
        <AnalyticsChart
          title="New registrations (6 months)"
          description="Student registrations per month"
          items={toMonthDatum(d?.registrations_by_month ?? [])}
          loading={loading}
          horizontal
          valueLabel="registrations"
        />
      </div>
    </div>
  );
}

// ── Section C: Academic Resources ────────────────────────────────────────────
function VcAcademicResourcesTab() {
  const [data, setData] = useState<VcAcademicResources | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setData(await fetchVcAcademicResources());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const d = data;
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACADEMIC RESOURCES</p>
          <h1>E-Library overview</h1>
          <p className="subtitle">Approved academic resources, usage and top accessed materials.</p>
        </div>
      </div>

      <div className="portal-stats admin-stats-grid">
        <section className={fx.fadeUp} style={staggerDelay(0, 50)}>
          <BookOpen />
          <b>{(d?.totals?.approved_materials ?? 0).toLocaleString()}</b>
          <span>Approved materials</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(1, 50)}>
          <Clock />
          <b>{(d?.totals?.pending_materials ?? 0).toLocaleString()}</b>
          <span>Pending review</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(2, 50)}>
          <Download />
          <b>{(d?.totals?.total_downloads ?? 0).toLocaleString()}</b>
          <span>Total downloads</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(3, 50)}>
          <Eye />
          <b>{(d?.totals?.total_views ?? 0).toLocaleString()}</b>
          <span>Total views</span>
        </section>
      </div>

      <div className="vc-charts-grid">
        <AnalyticsChart
          title="Resources by type"
          description="Approved materials grouped by type"
          items={toDatum(d?.by_type)}
          loading={loading}
          horizontal
          valueLabel="materials"
        />
        <AnalyticsChart
          title="Resources by faculty"
          description="Approved materials grouped by faculty"
          items={toDatum(d?.by_faculty)}
          loading={loading}
          horizontal
          valueLabel="materials"
        />
        <AnalyticsChart
          title="Top departments"
          description="Departments with the most approved resources"
          items={toDatum(d?.by_department)}
          loading={loading}
          horizontal
          valueLabel="materials"
        />
      </div>

      <VcMaterialTable rows={d?.top_materials ?? []} loading={loading} />
    </div>
  );
}

function VcMaterialTable({ rows, loading }: { rows: TopMaterialRow[]; loading: boolean }) {
  return (
    <div className="admin-chart">
      <div className="chart-header">
        <div>
          <p className="kicker">ACCESS TELEMETRY</p>
          <h2>Top accessed materials</h2>
        </div>
        <span className="chart-tag">Approved only</span>
      </div>
      {loading ? (
        <div className="analytics-skeleton h-mode" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => <i key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 12px' }}>
          <BookOpen size={28} />
          <b>No approved materials yet.</b>
          <span>Approved resources appear here automatically.</span>
        </div>
      ) : (
        <div className="vc-table">
          <div className="vc-table-row vc-table-head">
            <span>Title</span>
            <span>Faculty / Department</span>
            <span>Level</span>
            <span>Downloads</span>
            <span>Views</span>
          </div>
          {rows.map((m) => (
            <div className="vc-table-row" key={m.id}>
              <span className="vc-table-title">
                {m.title || 'Untitled'}
                {m.course_code ? <em>{m.course_code}</em> : null}
              </span>
              <span>
                {m.faculty || '—'}
                {m.department ? ` / ${m.department}` : ''}
              </span>
              <span>{m.level || '—'}</span>
              <span>{m.downloads.toLocaleString()}</span>
              <span>{m.views.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section F: Reports & Announcements ───────────────────────────────────────
function VcReportsTab() {
  const [data, setData] = useState<VcReportsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setData(await fetchVcReportsOverview());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const d = data;
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">EXECUTIVE REPORTS</p>
          <h1>Reports &amp; announcements</h1>
          <p className="subtitle">Institution-wide announcements and recently published academic resources.</p>
        </div>
      </div>

      <div className="portal-stats admin-stats-grid">
        <section className={fx.fadeUp} style={staggerDelay(0, 50)}>
          <FileText />
          <b>{(d?.published_this_month ?? 0).toLocaleString()}</b>
          <span>Published this month</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(1, 50)}>
          <Landmark />
          <b>{(d?.announcements ?? []).length.toLocaleString()}</b>
          <span>Recent announcements</span>
        </section>
        <section className={fx.fadeUp} style={staggerDelay(2, 50)}>
          <BookOpen />
          <b>{(d?.recent_materials ?? []).length.toLocaleString()}</b>
          <span>Recently published resources</span>
        </section>
      </div>

      <div className="vc-reports-grid">
        <VcAnnouncementList rows={d?.announcements ?? []} loading={loading} />
        <VcRecentMaterialsList rows={d?.recent_materials ?? []} loading={loading} />
      </div>
    </div>
  );
}

function VcAnnouncementList({ rows, loading }: { rows: AnnouncementRow[]; loading: boolean }) {
  return (
    <div className="admin-chart">
      <div className="chart-header">
        <div>
          <p className="kicker">INSTITUTIONAL COMMUNICATION</p>
          <h2>Latest announcements</h2>
        </div>
      </div>
      {loading ? (
        <div className="analytics-skeleton h-mode" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => <i key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 12px' }}>
          <FileText size={28} />
          <b>No published announcements yet.</b>
          <span>Published announcements appear here automatically.</span>
        </div>
      ) : (
        <div className="vc-list">
          {rows.map((a) => (
            <article className="vc-list-item vc-list-announcement" key={a.id}>
              <h4>{a.title}</h4>
              <div className="vc-list-announcement-body">
                <MessageText body={a.body} />
              </div>
              <span className="vc-list-meta">
                {formatDate(a.published_at)}
                {a.audience && a.audience !== 'everyone' ? ` · Audience: ${a.audience}` : ''}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function VcRecentMaterialsList({ rows, loading }: { rows: RecentMaterialRow[]; loading: boolean }) {
  return (
    <div className="admin-chart">
      <div className="chart-header">
        <div>
          <p className="kicker">PUBLISHING PIPELINE</p>
          <h2>Recently published resources</h2>
        </div>
      </div>
      {loading ? (
        <div className="analytics-skeleton h-mode" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => <i key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 12px' }}>
          <BookOpen size={28} />
          <b>Nothing published yet.</b>
          <span>Approved resources appear here automatically.</span>
        </div>
      ) : (
        <div className="vc-list">
          {rows.map((m) => (
            <article className="vc-list-item vc-list-material" key={m.id}>
              <h4>{m.title || 'Untitled'}</h4>
              <p>
                {m.course_code ? `${m.course_code} · ` : ''}
                {m.faculty || '—'}
                {m.department ? ` / ${m.department}` : ''}
                {m.level ? ` · ${m.level}` : ''}
              </p>
              <span className="vc-list-meta">{formatDate(m.created_at)}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(value: string | undefined | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}