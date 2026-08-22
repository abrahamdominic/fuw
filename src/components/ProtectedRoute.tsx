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
}

export function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }: ProtectedRouteProps) {
  const { user, profile, isLoading, isAuthenticated, isAdmin, isSuperAdmin } = useAuth();
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
    const loginTarget = superAdminOnly ? '/admin/login' : adminOnly ? '/admin/login' : '/login';
    return <Navigate to={loginTarget} state={{ from: location }} replace />;
  }

  // Deactivated accounts are blocked everywhere.
  if (profile?.isActive === false) {
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

  // Super Admin portal
  if (superAdminOnly && !isSuperAdmin) {
    return <Navigate to={isAdmin ? '/admin' : '/student'} replace />;
  }

  // If page requires Admin privileges
  if (adminOnly && !isAdmin) {
    // Normal student attempting to access /admin -> redirect to student portal
    return <Navigate to="/student" replace />;
  }

  return <>{children}</>;
}
