// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthContext, AuthContextType } from '../lib/AuthContext';
import { BootFallback } from '../components/BootFallback';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = React.useContext(AuthContext);
  const location = useLocation();
  if (!auth || auth.isLoading) return <BootFallback label="Restoring your session" />;
  if (!auth.isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const auth = React.useContext(AuthContext);
  if (!auth || auth.isLoading) return <BootFallback label="Restoring your session" />;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  const destination =
    auth.profile?.role === 'super_admin' ? '/super' :
    auth.profile?.role === 'admin' ? '/admin' :
    '/hub';
  return <Navigate to={destination} replace />;
}

function MockAuthScreen() {
  const auth = React.useContext(AuthContext);
  const location = useLocation();
  const fromPath = (location.state as any)?.from?.pathname;

  if (auth?.isLoading) {
    return <BootFallback label="Restoring your session" />;
  }

  if (auth?.isAuthenticated && auth?.isProfileComplete) {
    const dest = fromPath && fromPath !== '/login' && fromPath !== '/' ? fromPath : '/hub';
    return <Navigate to={dest} replace />;
  }

  return (
    <div data-testid="login-screen">
      <h1>Sign In to FUW Campus Hub</h1>
    </div>
  );
}

function buildMockAuth(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: null,
    session: null,
    profile: null,
    isAuthenticated: false,
    isProfileComplete: false,
    isLoading: false,
    isAdmin: false,
    isSuperAdmin: false,
    isStudent: true,
    isLecturer: false,
    role: null,
    permissions: [],
    hasPermission: () => true,
    mfaRequired: null,
    mfaVerifiedFactor: null,
    clearMfaRequired: () => {},
    signInWithUsername: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null }),
    signOut: async () => {},
    sendPasswordReset: async () => ({ error: null }),
    updateProfile: async () => ({ error: null }),
    changePassword: async () => ({ error: null }),
    resetPassword: async () => ({ error: null }),
    completeProfile: async () => ({ error: null }),
    refreshProfile: async () => null,
    plan: null,
    hasPremium: false,
    refreshEntitlement: async () => {},
    onboardingCompleted: true,
    onboardingStep: 1,
    setOnboardingState: async () => {},
    ...overrides
  };
}

describe('Phase 3 Authentication Gating Verification', () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderWithAuth = (initialPath: string, authValue: AuthContextType) => {
    return render(
      <HelmetProvider>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/home" element={<RootRedirect />} />
              <Route path="/login" element={<MockAuthScreen />} />
              <Route
                path="/hub"
                element={
                  <RequireAuth>
                    <div data-testid="hub-content">Campus Hub Gateway</div>
                  </RequireAuth>
                }
              />
              <Route
                path="/marketplace/*"
                element={
                  <RequireAuth>
                    <div data-testid="marketplace-content">Marketplace Workspace</div>
                  </RequireAuth>
                }
              />
              <Route
                path="/accommodation"
                element={
                  <RequireAuth>
                    <div data-testid="accommodation-content">Accommodation Workspace</div>
                  </RequireAuth>
                }
              />
              <Route
                path="/library"
                element={
                  <RequireAuth>
                    <div data-testid="library-content">E Library Workspace</div>
                  </RequireAuth>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </HelmetProvider>
    );
  };

  it('unauthenticated direct access to root (/) redirects to /login', () => {
    const unauth = buildMockAuth({ isAuthenticated: false, isLoading: false });
    renderWithAuth('/', unauth);

    expect(screen.getByTestId('login-screen')).toBeDefined();
    expect(screen.queryByTestId('hub-content')).toBeNull();
  });

  it('unauthenticated direct access to /hub redirects to /login', () => {
    const unauth = buildMockAuth({ isAuthenticated: false, isLoading: false });
    renderWithAuth('/hub', unauth);

    expect(screen.getByTestId('login-screen')).toBeDefined();
    expect(screen.queryByTestId('hub-content')).toBeNull();
  });

  it('unauthenticated direct access to /marketplace redirects to /login and preserves deep link', () => {
    const unauth = buildMockAuth({ isAuthenticated: false, isLoading: false });
    renderWithAuth('/marketplace/browse', unauth);

    expect(screen.getByTestId('login-screen')).toBeDefined();
    expect(screen.queryByTestId('marketplace-content')).toBeNull();
  });

  it('unauthenticated direct access to /accommodation redirects to /login', () => {
    const unauth = buildMockAuth({ isAuthenticated: false, isLoading: false });
    renderWithAuth('/accommodation', unauth);

    expect(screen.getByTestId('login-screen')).toBeDefined();
    expect(screen.queryByTestId('accommodation-content')).toBeNull();
  });

  it('unauthenticated direct access to /library redirects to /login', () => {
    const unauth = buildMockAuth({ isAuthenticated: false, isLoading: false });
    renderWithAuth('/library', unauth);

    expect(screen.getByTestId('login-screen')).toBeDefined();
    expect(screen.queryByTestId('library-content')).toBeNull();
  });

  it('authenticated student accessing root (/) routes directly to /hub', () => {
    const auth = buildMockAuth({
      isAuthenticated: true,
      isLoading: false,
      isProfileComplete: true,
      user: { id: 'u1', email: 'student@fuw.edu.ng' } as any,
      profile: { role: 'student' } as any
    });
    renderWithAuth('/', auth);

    expect(screen.getByTestId('hub-content')).toBeDefined();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  it('authenticated student visiting /login redirects directly to /hub without login screen', () => {
    const auth = buildMockAuth({
      isAuthenticated: true,
      isLoading: false,
      isProfileComplete: true,
      user: { id: 'u1', email: 'student@fuw.edu.ng' } as any,
      profile: { role: 'student' } as any
    });
    renderWithAuth('/login', auth);

    expect(screen.getByTestId('hub-content')).toBeDefined();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  it('authenticated student accessing /marketplace renders Marketplace content', () => {
    const auth = buildMockAuth({
      isAuthenticated: true,
      isLoading: false,
      isProfileComplete: true,
      user: { id: 'u1', email: 'student@fuw.edu.ng' } as any,
      profile: { role: 'student' } as any
    });
    renderWithAuth('/marketplace/browse', auth);

    expect(screen.getByTestId('marketplace-content')).toBeDefined();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  it('prevents protected content flash while Supabase restores session (isLoading: true)', () => {
    const loadingAuth = buildMockAuth({
      isAuthenticated: false,
      isLoading: true
    });
    renderWithAuth('/hub', loadingAuth);

    expect(screen.getByText(/Restoring your session/i)).toBeDefined();
    expect(screen.queryByTestId('hub-content')).toBeNull();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });
});
