import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { Logo } from './Logo';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, profile, isLoading, isAuthenticated, isAdmin } = useAuth();
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
    const loginTarget = adminOnly ? '/admin/login' : '/login';
    return <Navigate to={loginTarget} state={{ from: location }} replace />;
  }

  // If page requires Admin privileges
  if (adminOnly) {
    if (!isAdmin) {
      // Normal student attempting to access /admin -> redirect to student portal
      return <Navigate to="/student" replace />;
    }
  }

  return <>{children}</>;
}
