import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { Logo } from './Logo';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Requires an admin or super admin account. */
  adminOnly?: boolean;
  /** Requires a super admin account (used by the /super portal). */
  superAdminOnly?: boolean;
  /** Requires a lecturer account (used by the /lecturer portal). */
  lecturerOnly?: boolean;
  /** Requires a student account (used by the /student portal). */
  studentOnly?: boolean;
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  superAdminOnly = false,
  lecturerOnly = false,
  studentOnly = false
}: ProtectedRouteProps) {
  const { user, profile, isLoading, isAuthenticated, isAdmin, isSuperAdmin, isLecturer, refreshProfile, signOut } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <Logo size={48} />
          <h2>Verifying credentials…</h2>
          <p>Connecting to Federal University Wukari secure repository</p>
          <div className="loading-spinner-bar" />
        </div>
      </div>
    );
  }

  // Unauthenticated user -> redirect to login
  if (!isAuthenticated || !user) {
    const loginTarget = superAdminOnly || adminOnly ? '/admin/login' : '/login';
    return <Navigate to={loginTarget} state={{ from: location }} replace />;
  }

  // Session exists but the profile/role could not be loaded.
  if (!profile) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <Logo size={48} />
          <h2>Unable to verify your account</h2>
          <p>
            Your session is active but we could not load your account role. Please try refreshing verification
            or sign in again.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="primary" onClick={() => void refreshProfile()}>
              Retry verification
            </button>
            <button type="button" className="secondary" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Deactivated accounts are blocked everywhere.
  if (profile.isActive === false) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-card">
          <Logo size={48} />
          <h2>Account deactivated</h2>
          <p>This account has been deactivated. Please contact the library administrator.</p>
        </div>
      </div>
    );
  }

  // First-time onboarding redirection: ensure new users complete role-specific onboarding
  if (profile.onboardingCompleted === false && !location.pathname.startsWith('/onboarding')) {
    return <Navigate to="/onboarding" replace />;
  }

  // Super Admin portal
  if (superAdminOnly && !isSuperAdmin) {
    return <Navigate to={isAdmin ? '/admin' : isLecturer ? '/lecturer' : '/student'} replace />;
  }

  // If page requires Admin privileges
  if (adminOnly && !isAdmin) {
    return <Navigate to={isLecturer ? '/lecturer' : '/student'} replace />;
  }

  // If page requires Lecturer privileges
  if (lecturerOnly && !isLecturer) {
    return <Navigate to={isAdmin ? '/admin' : '/student'} replace />;
  }

  // Student routes: redirect lecturers to their own portal
  if (studentOnly && isLecturer) {
    return <Navigate to="/lecturer" replace />;
  }

  return <>{children}</>;
}
