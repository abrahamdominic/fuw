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
  /** Requires a landlord or caretaker account (used by the /provider portal). */
  providerOnly?: boolean;
  /** Requires the Vice-Chancellor account (used by the /vc portal). */
  vcOnly?: boolean;
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  superAdminOnly = false,
  lecturerOnly = false,
  studentOnly = false,
  providerOnly = false,
  vcOnly = false
}: ProtectedRouteProps) {
  const { user, profile, isLoading, isAuthenticated, isAdmin, isSuperAdmin, isLecturer, isProvider, isVc, refreshProfile, signOut } = useAuth();
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
    const loginTarget = vcOnly ? '/vc/login' : superAdminOnly || adminOnly ? '/admin/login' : '/login';
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

  // First-time onboarding redirection: ensure new users complete role-specific onboarding.
  // Landlords and caretakers complete a dedicated provider registration instead, so
  // they are never pushed into the student onboarding flow. The Vice-Chancellor is
  // provisioned by the Super Admin and never runs the student onboarding.
  const isProviderRole = profile.role === 'landlord' || profile.role === 'caretaker';
  if (profile.onboardingCompleted === false && !isProviderRole && profile.role !== 'vc' && !location.pathname.startsWith('/onboarding')) {
    return <Navigate to="/onboarding" replace />;
  }

  // The Vice-Chancellor lives exclusively in the executive portal. Any attempt to
  // reach a student, lecturer, admin, super admin or Campus Hub route (including
  // a direct URL) is redirected back to /vc.
  if (isVc && !vcOnly) {
    return <Navigate to="/vc" replace />;
  }

  // Super Admin portal
  if (superAdminOnly && !isSuperAdmin) {
    return <Navigate to={isAdmin ? '/admin' : isLecturer ? '/lecturer' : isProvider ? '/provider' : '/student'} replace />;
  }

  // If page requires Admin privileges
  if (adminOnly && !isAdmin) {
    return <Navigate to={isLecturer ? '/lecturer' : isProvider ? '/provider' : '/student'} replace />;
  }

  // If page requires Lecturer privileges
  if (lecturerOnly && !isLecturer) {
    return <Navigate to={isAdmin ? '/admin' : isProvider ? '/provider' : '/student'} replace />;
  }

  // Provider routes: landlords and caretakers only their own portal.
  if (providerOnly && !isProvider) {
    return <Navigate to={isAdmin ? '/admin' : isLecturer ? '/lecturer' : '/student'} replace />;
  }

  // VC routes: only the Vice-Chancellor may enter.
  if (vcOnly && !isVc) {
    return <Navigate to={isSuperAdmin ? '/super' : isAdmin ? '/admin' : isLecturer ? '/lecturer' : isProvider ? '/provider' : '/student'} replace />;
  }

  // Student routes: redirect staff and providers to their own portal.
  if (studentOnly && isLecturer) {
    return <Navigate to="/lecturer" replace />;
  }
  if (studentOnly && isProvider) {
    return <Navigate to="/provider" replace />;
  }

  return <>{children}</>;
}
