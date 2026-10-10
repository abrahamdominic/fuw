import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LandlordLoginPage } from '../pages/LandlordLoginPage';
import * as AuthContextModule from '../lib/AuthContext';
import type { AuthContextType } from '../lib/AuthContext';

vi.mock('../components/SEO', () => ({
  SEO: () => null
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() })
}));
vi.mock('../lib/security', () => ({
  aal2LoginChallenge: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
  requireSupabase: () => ({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) })
}));

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
    isStudent: false,
    isLecturer: false,
    isLandlord: false,
    isCaretaker: false,
    isProvider: false,
    role: null,
    permissions: [],
    hasPermission: () => false,
    mfaRequired: null,
    mfaVerifiedFactor: null,
    clearMfaRequired: () => {},
    signInWithUsername: async () => ({ error: null }),
    signUpWithPassword: async () => ({ error: null }),
    signOut: async () => {},
    sendPasswordReset: async () => ({ error: null }),
    updateProfile: vi.fn().mockResolvedValue({ error: null }),
    changePassword: async () => ({ error: null }),
    resetPassword: async () => ({ error: null }),
    completeProfile: vi.fn().mockResolvedValue({ error: null }),
    refreshProfile: async () => null,
    plan: null,
    hasPremium: false,
    refreshEntitlement: async () => {},
    onboardingCompleted: false,
    onboardingStep: 1,
    setOnboardingState: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function mockAuth(auth: AuthContextType) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(auth);
}

function renderLogin(destinations: Record<string, string>) {
  return render(
    <MemoryRouter initialEntries={['/landlord-login']}>
      <Routes>
        <Route path="/landlord-login" element={<LandlordLoginPage />} />
        <Route
          path="/provider"
          element={<div>provider-dashboard</div>}
        />
        <Route
          path="/admin"
          element={<div>admin-dashboard</div>}
        />
        <Route
          path="/student"
          element={<div>student-dashboard</div>}
        />
        {Object.entries(destinations).map(([path, label]) => (
          <Route key={path} path={path} element={<div>{label}</div>} />
        ))}
      </Routes>
    </MemoryRouter>
  );
}

async function submitCredentials(identifier: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText(/landlord@fuw.edu.ng/i), {
    target: { value: identifier }
  });
  fireEvent.change(screen.getByPlaceholderText(/enter your portal password/i), {
    target: { value: password }
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in to your portal/i }));
}

describe('Landlord & Caretaker portal login (/landlord-login)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the dedicated portal login with brand, fields and links', () => {
    mockAuth(buildMockAuth());
    renderLogin({});

    expect(screen.getByRole('heading', { name: /portal sign in/i })).toBeDefined();
    expect(screen.getByText(/Landlord & Caretaker Portal/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/landlord@fuw.edu.ng/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/enter your portal password/i)).toBeDefined();

    // Password visibility toggle exists.
    expect(screen.getByRole('button', { name: /show password/i })).toBeDefined();

    // Forgot password, provider registration and student sign-in escape hatches.
    expect(screen.getByRole('link', { name: /forgot password/i }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.getByRole('link', { name: /apply as a landlord or caretaker/i }).getAttribute('href')).toBe('/register/provider');
    expect(screen.getByRole('link', { name: /student\? use the student sign-in/i }).getAttribute('href')).toBe('/login');
  });

  it('redirects a verified landlord to the /provider portal after a successful sign-in', async () => {
    const auth = buildMockAuth({
      signInWithUsername: async () => ({ error: null, role: 'landlord' as any })
    });
    mockAuth(auth);
    renderLogin({});

    await submitCredentials('landlord.test@fuw.edu.ng', 'Landlord@Test#2026');

    await waitFor(() => {
      expect(screen.getByText('provider-dashboard')).toBeDefined();
    });
  });

  it('redirects a caretaker to the /provider portal after a successful sign-in', async () => {
    const auth = buildMockAuth({
      signInWithUsername: async () => ({ error: null, role: 'caretaker' as any })
    });
    mockAuth(auth);
    renderLogin({});

    await submitCredentials('testcaretaker', 'Caretaker@Test#2026');

    await waitFor(() => {
      expect(screen.getByText('provider-dashboard')).toBeDefined();
    });
  });

  it('sends authorized staff (admin) to their own dashboard, not the provider portal', async () => {
    const auth = buildMockAuth({
      signInWithUsername: async () => ({ error: null, role: 'admin' as any })
    });
    mockAuth(auth);
    renderLogin({});

    await submitCredentials('admin.test@fuw.edu.ng', 'Admin@Test#2026');

    await waitFor(() => {
      expect(screen.getByText('admin-dashboard')).toBeDefined();
    });
  });

  it('blocks student accounts with a clear message instead of opening the provider portal', async () => {
    const auth = buildMockAuth({
      signInWithUsername: async () => ({ error: null, role: 'student' as any })
    });
    mockAuth(auth);
    renderLogin({});

    await submitCredentials('some.student.001', 'StudentPass#1');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/registered as a student/i);
    });
    expect(screen.queryByText('provider-dashboard')).toBeNull();
    expect(screen.queryByText('student-dashboard')).toBeNull();
  });

  it('bounces an already-authenticated provider to /provider immediately', async () => {
    const auth = buildMockAuth({
      isAuthenticated: true,
      profile: {
        id: 'landlord-id',
        fullName: 'Test Landlord',
        displayName: 'Test Landlord',
        email: 'landlord.test@fuw.edu.ng',
        role: 'landlord' as any,
        isActive: true,
        onboardingCompleted: true,
        onboardingStarted: true,
        onboardingStep: 1
      } as any,
      role: 'landlord' as any,
      isLandlord: true,
      isProvider: true
    });
    mockAuth(auth);
    renderLogin({});

    await waitFor(() => {
      expect(screen.getByText('provider-dashboard')).toBeDefined();
    });
  });
});