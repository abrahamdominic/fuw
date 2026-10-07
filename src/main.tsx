import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { PageTransition } from './components/animations/PageTransition';
import './styles.css';

import { MaterialItem } from './lib/store';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ToastProvider } from './components/Toast';
import { DocumentReaderModal } from './components/DocumentReaderModal';
import { AppSplash } from './components/AppSplash';
import { FirstVisitWelcome } from './components/FirstVisitWelcome';

import { AuthProvider, useAuth } from './lib/AuthContext';
import { ThemeProvider } from './lib/ThemeContext';

// Route-level code splitting. Each portal/page bundle loads on demand so the
// initial shell stays small and the vendor cache stays warm across deploys.
const HomePage = lazy(() => import('./pages/PublicPages').then((m) => ({ default: m.HomePage })));
const LibraryPage = lazy(() => import('./pages/PublicPages').then((m) => ({ default: m.LibraryPage })));
const FacultiesPage = lazy(() => import('./pages/PublicPages').then((m) => ({ default: m.FacultiesPage })));
const CoursesPage = lazy(() => import('./pages/PublicPages').then((m) => ({ default: m.CoursesPage })));
const MaterialDetailPage = lazy(() =>
  import('./pages/PublicPages').then((m) => ({ default: m.MaterialDetailPage }))
);
const AboutPage = lazy(() => import('./pages/PublicPages').then((m) => ({ default: m.AboutPage })));
const ResetPasswordPage = lazy(() =>
  import('./pages/PublicPages').then((m) => ({ default: m.ResetPasswordPage }))
);
const AdminLoginPage = lazy(() => import('./pages/PublicPages').then((m) => ({ default: m.AdminLoginPage })));
const AuthPage = lazy(() => import('./pages/AuthScreens').then((m) => ({ default: m.AuthPage })));
const StudentPortal = lazy(() => import('./pages/StudentPortal').then((m) => ({ default: m.StudentPortal })));
const AdminPortal = lazy(() => import('./pages/AdminPortal').then((m) => ({ default: m.AdminPortal })));
const SuperAdminPortal = lazy(() =>
  import('./pages/SuperAdminPortal').then((m) => ({ default: m.SuperAdminPortal }))
);
const MaintenancePage = lazy(() =>
  import('./pages/MaintenancePage').then((m) => ({ default: m.MaintenancePage }))
);
const RepositoryPage = lazy(() =>
  import('./pages/RepositoryPages').then((m) => ({ default: m.RepositoryPage }))
);
const RepositoryDetailPage = lazy(() =>
  import('./pages/RepositoryPages').then((m) => ({ default: m.RepositoryDetailPage }))
);
const RepositorySubmitPage = lazy(() =>
  import('./pages/RepositoryPages').then((m) => ({ default: m.RepositorySubmitPage }))
);
const HelpPage = lazy(() => import('./pages/HelpPages').then((m) => ({ default: m.HelpPage })));
const ReportProblemPage = lazy(() =>
  import('./pages/HelpPages').then((m) => ({ default: m.ReportProblemPage }))
);
const ReportCopyrightPage = lazy(() =>
  import('./pages/HelpPages').then((m) => ({ default: m.ReportCopyrightPage }))
);
const CollectionsPage = lazy(() =>
  import('./pages/CollectionPages').then((m) => ({ default: m.CollectionsPage }))
);
const CollectionDetailPage = lazy(() =>
  import('./pages/CollectionPages').then((m) => ({ default: m.CollectionDetailPage }))
);
const FacultyDetailPage = lazy(() =>
  import('./pages/DirectoryPages').then((m) => ({ default: m.FacultyDetailPage }))
);
const DepartmentDetailPage = lazy(() =>
  import('./pages/DirectoryPages').then((m) => ({ default: m.DepartmentDetailPage }))
);
const CourseDetailPage = lazy(() =>
  import('./pages/DirectoryPages').then((m) => ({ default: m.CourseDetailPage }))
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage }))
);
const CampusHubPage = lazy(() =>
  import('./pages/CampusHubPage').then((m) => ({ default: m.CampusHubPage }))
);
const AccommodationPage = lazy(() =>
  import('./pages/AccommodationPage').then((m) => ({ default: m.AccommodationPage }))
);
const AccommodationDetailPage = lazy(() =>
  import('./pages/AccommodationDetailPage').then((m) => ({ default: m.AccommodationDetailPage }))
);
const RoommateFinderPage = lazy(() =>
  import('./pages/RoommateFinderPage').then((m) => ({ default: m.RoommateFinderPage }))
);
// FUW Student Marketplace. Mounted under /marketplace/* so the whole platform
// ships as one SPA with one dev server and one session (must.md Phase 10).
const MarketplaceRoutes = lazy(() => import('./marketplace/MarketplaceRoutes'));
import { BootFallback } from './components/BootFallback';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { MaintenanceGate } from './components/MaintenanceGate';
import { CrawlPolicyGuard } from './components/CrawlPolicyGuard';
import { analyticsTracker } from './lib/analyticsTracker';

// Captured when the JS bundle begins evaluating — the startup metric measures
// the real path to a usable UI (analytics must not block it).
const APP_BOOT_TS = performance.now();

function AnalyticsLayer() {
  const { user } = useAuth();
  const location = useLocation().pathname;

  useEffect(() => {
    analyticsTracker.init(user?.id ?? null);
    return () => {
      void analyticsTracker.shutdown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    analyticsTracker.setUserId(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    analyticsTracker.onScreenView(location);
  }, [location]);

  useEffect(() => {
    let coldStart = true;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (coldStart) {
          coldStart = false;
          analyticsTracker.onAppOpen();
          analyticsTracker.onSessionStart();
          return;
        }
        analyticsTracker.onAppOpen();
        analyticsTracker.onSessionStart();
      } else {
        analyticsTracker.onAppBackground();
        analyticsTracker.onSessionEnd();
      }
    };

    const onPageHide = () => {
      analyticsTracker.onAppClose();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    // Emit the initial open/session immediately (also covers the case where a
    // hidden tab is loaded in the background).
    analyticsTracker.onAppOpen();
    analyticsTracker.onSessionStart();
    analyticsTracker.trackPerformance(
      'app_startup_ms',
      Math.round(performance.now() - APP_BOOT_TS),
      'ms',
      { platform: 'web' }
    );

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      analyticsTracker.onAppBackground();
      analyticsTracker.onSessionEnd();
    };
  }, []);

  return null;
}

function PublicLayout({
  children,
  onReadOnline
}: {
  children: React.ReactNode;
  onReadOnline: (m: MaterialItem) => void;
}) {
  return (
    <div className="site-wrapper">
      <Header />
      <div className="content-grow">{children}</div>
      <Footer />
    </div>
  );
}

/**
 * A first-time visitor browsing the public library must not sit behind the
 * branded welcome screen. The splash is for people returning to an
 * existing session, where it covers the brief moment while Supabase
 * restores that session.
 *
 * The client is configured with `storageKey: 'fuw-auth-token'`
 * (src/lib/supabase.ts), so that is the primary key to look for. The
 * `sb-<ref>-auth-token` shape is Supabase's default and is still matched so a
 * session written before the key was customised is not mistaken for a
 * first-time visitor.
 */
function hasStoredSupabaseSession(): boolean {
  try {
    if (window.localStorage.getItem('fuw-auth-token')) return true;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) return true;
    }
  } catch {
    // Storage can be blocked; treat as "no stored session".
  }
  return false;
}

/**
 * Auth-first gate for private surfaces, including the authenticated Home page.
 * Browsing catalogue pages remains available without an account.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  if (isLoading) return <BootFallback label="Restoring your session" />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

/**
 * Keep root routing auth-first. Returning null while the persisted Supabase
 * session initializes prevents the public home page from flashing before the
 * correct destination is known.
 */
function RootRedirect() {
  const { isLoading, isAuthenticated, profile } = useAuth();
  if (isLoading) return <BootFallback label="Restoring your session" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const destination =
    profile?.role === 'super_admin' ? '/super' :
    profile?.role === 'admin' ? '/admin' :
    '/hub';
  return <Navigate to={destination} replace />;
}

/**
 * Route-level transition shell. Keyed by the resolved pathname so every
 * navigation re-mounts the view and eases it in with the shared `.fx-page-in`
 * CSS keyframe.
 */
function RouteTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <PageTransition
      id={`${location.pathname}${location.search}`}
      className="route-transition"
    >
      {children}
    </PageTransition>
  );
}

function AppSplashBoundary() {
  const { isLoading } = useAuth();
  return <AppSplash visible={isLoading && hasStoredSupabaseSession()} />;
}

/**
 * The whole application, minus the router and the React root.
 *
 * Exported so tests can mount the real route table (see
 * `src/test/route_smoke.test.tsx`) instead of a hand-copied list of routes that
 * would drift. Importing this module still mounts the app to `#root`; tests
 * render `<App/>` themselves so they can unmount it again.
 */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return null;
}

export function App() {
  const [readingMaterial, setReadingMaterial] = useState<MaterialItem | null>(null);

  const handleReadOnline = (material: MaterialItem) => {
    setReadingMaterial(material);
  };

  return (
    <ThemeProvider>
      <AuthProvider>
      <>
        <ScrollToTop />
        <AnalyticsLayer />
        <CrawlPolicyGuard />
        <AppSplashBoundary />
        <FirstVisitWelcome />
        <ToastProvider>
          <MaintenanceGate>
            <ErrorBoundary>
            <Suspense
              fallback={
                <div className="route-fallback" role="status" aria-label="Loading">
                  <span className="route-fallback-spinner" />
                </div>
              }
            >
              <RouteTransition>
                <Routes>
            {/* Global maintenance screen — reachable for everyone */}
            <Route path="/maintenance" element={<MaintenancePage />} />

            {/* Public auth routes — the only pages unauthenticated visitors see */}
            <Route path="/login" element={<AuthPage initialMode="login" />} />
            <Route path="/register" element={<AuthPage initialMode="register" />} />
            <Route path="/forgot-password" element={<AuthPage initialMode="forgot" />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/super/login" element={<AdminLoginPage />} />

            {/* Protected Student Portal Routes */}
            <Route
              path="/student/*"
              element={
                <RequireAuth>
                  <ProtectedRoute>
                    <StudentPortal onReadOnline={handleReadOnline} />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* Protected Admin Portal Routes */}
            <Route
              path="/admin/*"
              element={
                <RequireAuth>
                  <ProtectedRoute adminOnly>
                    <AdminPortal onReadOnline={handleReadOnline} />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* Protected Super Admin Portal (owner only) */}
            <Route
              path="/super"
              element={
                <RequireAuth>
                  <ProtectedRoute superAdminOnly>
                    <SuperAdminPortal />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />
            <Route
              path="/super/*"
              element={
                <RequireAuth>
                  <ProtectedRoute superAdminOnly>
                    <SuperAdminPortal />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* Friendly Route Aliases */}
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Navigate to="/student" replace />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <Navigate to="/student/profile" replace />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <Navigate to="/student/settings" replace />
                </RequireAuth>
              }
            />
            <Route
              path="/wallet"
              element={
                <RequireAuth>
                  <Navigate to="/marketplace/wallet" replace />
                </RequireAuth>
              }
            />
            <Route
              path="/super-admin"
              element={
                <RequireAuth>
                  <Navigate to="/super" replace />
                </RequireAuth>
              }
            />
            <Route
              path="/superadmin"
              element={
                <RequireAuth>
                  <Navigate to="/super" replace />
                </RequireAuth>
              }
            />

            {/* Public Pages — browsable without an account.

                Only approved catalogue data and published repository/collection
                records are readable here, and every authenticated action
                (download, read-online, submit, save) is still gated by the
                session plus the server-side entitlement check. */}
            <Route
              path="/"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <HomePage onReadOnline={handleReadOnline} />
                </PublicLayout>
              }
            />
            {/* FUW Campus Hub Gateway */}
            <Route
              path="/hub"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <CampusHubPage />
                </PublicLayout>
              }
            />
            <Route path="/campus-hub" element={<Navigate to="/hub" replace />} />
            <Route path="/campus" element={<Navigate to="/hub" replace />} />

            {/* FUW Student Marketplace: integrated in-app section inside the unified platform shell */}
            <Route
              path="/marketplace/*"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <ErrorBoundary>
                    <MarketplaceRoutes />
                  </ErrorBoundary>
                </PublicLayout>
              }
            />

            {/* FUW Accommodation Service */}
            <Route
              path="/accommodation"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <AccommodationPage />
                </PublicLayout>
              }
            />
            <Route
              path="/accommodation/roommates"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <RoommateFinderPage />
                </PublicLayout>
              }
            />
            <Route
              path="/accommodation/roommates/post"
              element={<Navigate to="/accommodation/roommates?create=1" replace />}
            />
            <Route
              path="/accommodation/roommates/create"
              element={<Navigate to="/accommodation/roommates?create=1" replace />}
            />
            <Route
              path="/accommodation/:slug"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <AccommodationDetailPage />
                </PublicLayout>
              }
            />

            <Route
              path="/course-upload"
              element={<Navigate to="/student/course-upload" replace />}
            />
            <Route
              path="/home"
              element={<Navigate to="/" replace />}
            />
            <Route
              path="/library"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <LibraryPage onReadOnline={handleReadOnline} />
                </PublicLayout>
              }
            />
            <Route
              path="/faculties"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <FacultiesPage />
                </PublicLayout>
              }
            />
            <Route
              path="/faculties/:slug"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <FacultyDetailPage />
                </PublicLayout>
              }
            />
            {/* Legacy alias: /departments duplicated /faculties, so it is a
                permanent redirect rather than a second copy of the same
                directory. */}
            <Route path="/departments" element={<Navigate to="/faculties" replace />} />
            <Route
              path="/departments/:slug"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <DepartmentDetailPage />
                </PublicLayout>
              }
            />
            <Route
              path="/courses"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <CoursesPage />
                </PublicLayout>
              }
            />
            <Route
              path="/courses/:code"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <CourseDetailPage />
                </PublicLayout>
              }
            />
            <Route
              path="/materials/:id"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <MaterialDetailPage onReadOnline={handleReadOnline} />
                </PublicLayout>
              }
            />
            <Route
              path="/about"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <AboutPage />
                </PublicLayout>
              }
            />

            {/* Institutional Repository */}
            <Route
              path="/repository"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <RepositoryPage />
                </PublicLayout>
              }
            />
            <Route
              path="/repository/submit"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <RepositorySubmitPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/repository/:id"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <RepositoryDetailPage />
                </PublicLayout>
              }
            />

            {/* Help & Library Services */}
            <Route
              path="/help"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <HelpPage />
                </PublicLayout>
              }
            />
            <Route
              path="/report-problem"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <ReportProblemPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/report-copyright"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <ReportCopyrightPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            {/* Curated Collections */}
            <Route
              path="/collections"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <CollectionsPage />
                </PublicLayout>
              }
            />
            <Route
              path="/collections/:slug"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <CollectionDetailPage />
                </PublicLayout>
              }
            />
            <Route
              path="/contact"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <AboutPage contact />
                </PublicLayout>
              }
            />

            {/* Unknown path: a real not-found page, never a silent redirect
                back into the app. netlify.toml answers these with HTTP 404. */}
            <Route
              path="*"
              element={
                <PublicLayout onReadOnline={handleReadOnline}>
                  <NotFoundPage />
                </PublicLayout>
              }
            />
          </Routes>
          </RouteTransition>
          </Suspense>

          {/* Global Interactive Document Reader Modal */}
          {readingMaterial && (
            <DocumentReaderModal
              material={readingMaterial}
              onClose={() => setReadingMaterial(null)}
            />
          )}
            </ErrorBoundary>
        </MaintenanceGate>
      </ToastProvider>
      </>
    </AuthProvider>
    </ThemeProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  );
}
