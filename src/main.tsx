import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import './styles.css';

import { MaterialItem } from './lib/store';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ToastProvider } from './components/Toast';
import { DocumentReaderModal } from './components/DocumentReaderModal';
import { AppSplash } from './components/AppSplash';

import { AuthProvider, useAuth } from './lib/AuthContext';

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
import { ProtectedRoute } from './components/ProtectedRoute';
import { MaintenanceGate } from './components/MaintenanceGate';
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
 * Auth-first gate: everything except the explicitly public auth pages requires
 * a live session. While the session is still loading we render nothing (the
 * AppSplash overlay covers the screen), so unauthenticated visitors can never
 * glimpse the main site.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function AppSplashBoundary() {
  const { isLoading } = useAuth();
  return <AppSplash visible={isLoading} />;
}

function App() {
  const [readingMaterial, setReadingMaterial] = useState<MaterialItem | null>(null);

  const handleReadOnline = (material: MaterialItem) => {
    setReadingMaterial(material);
  };

  return (
    <AuthProvider>
      <AnalyticsLayer />
      <AppSplashBoundary />
      <ToastProvider>
        <MaintenanceGate>
          <Suspense
            fallback={
              <div className="route-fallback" role="status" aria-label="Loading">
                <span className="route-fallback-spinner" />
              </div>
            }
          >
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

            {/* Public Pages Layout — everything here is behind the auth gate */}
            <Route
              path="/"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <HomePage onReadOnline={handleReadOnline} />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <LibraryPage onReadOnline={handleReadOnline} />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/faculties"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <FacultiesPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/departments"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <FacultiesPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/courses"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <CoursesPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/materials/:id"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <MaterialDetailPage onReadOnline={handleReadOnline} />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/about"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <AboutPage />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="/contact"
              element={
                <RequireAuth>
                  <PublicLayout onReadOnline={handleReadOnline}>
                    <AboutPage contact />
                  </PublicLayout>
                </RequireAuth>
              }
            />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <Navigate to="/student" replace />
                </RequireAuth>
              }
            />
          </Routes>
          </Suspense>

          {/* Global Interactive Document Reader Modal */}
          {readingMaterial && (
            <DocumentReaderModal
              material={readingMaterial}
              onClose={() => setReadingMaterial(null)}
            />
          )}
        </MaintenanceGate>
      </ToastProvider>
    </AuthProvider>
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
