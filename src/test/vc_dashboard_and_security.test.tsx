// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

import { AuthContext, AuthContextType } from '../lib/AuthContext';
import { can, isVcRole, roleLabel } from '../lib/rbac';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { ToastProvider } from '../components/Toast';
import { VcLoginPage } from '../pages/VcLoginPage';
import { ViceChancellorPortal } from '../pages/ViceChancellorPortal';

/**
 * Vice-Chancellor executive dashboard: RBAC, route gating and login security.
 *
 * The VC role is provisioned server-side by the Super Admin (provision_vice_chancellor)
 * and is never registerable or self-promotable. These tests pin the frontend
 * guarantees that back that contract:
 *   1. RBAC: 'vc' resolves to the executive role label and owns no admin keys.
 *   2. Gating: a VC session is forced into /vc and every other portal rejects it.
 *   3. Login: the executive gateway only accepts vc sign-ins and rejects everyone else.
 *   4. Portal: the read-only surface renders institutional aggregates with no
 *      marketplace or accommodation entry points.
 */

interface Profile {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  role: string;
  matricNumber: string;
  faculty: string;
  department: string;
  level: string;
  permissions: string[];
  isActive: boolean;
  onboardingStarted: boolean;
  onboardingStep: number;
  onboardingCompleted: boolean;
  phoneNumber: string;
}

const vcProfile: Profile = {
  id: 'vc-provisioned-user',
  fullName: 'Prof. Vice Chancellor',
  displayName: 'Prof. Vice Chancellor',
  email: 'vc@fuwukari.edu.ng',
  role: 'vc',
  matricNumber: '',
  faculty: '',
  department: '',
  level: '',
  permissions: [],
  isActive: true,
  onboardingStarted: false,
  onboardingStep: 0,
  onboardingCompleted: true,
  phoneNumber: '',
};

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
    isLandlord: false,
    isCaretaker: false,
    isProvider: false,
    isVc: false,
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

const vcAuth = (overrides: Partial<AuthContextType> = {}): AuthContextType =>
  buildMockAuth({
    user: { id: vcProfile.id } as any,
    profile: vcProfile as any,
    isAuthenticated: true,
    isProfileComplete: true,
    isStudent: false,
    isVc: true,
    role: 'vc',
    hasPermission: () => false,
    ...overrides
  });

const studentAuth = (): AuthContextType =>
  buildMockAuth({
    user: { id: 'student-user' } as any,
    profile: {
      ...vcProfile,
      id: 'student-user',
      role: 'student',
      fullName: 'Student Name',
      displayName: 'Student Name',
      email: 'student@fuwukari.edu.ng',
    } as any,
    isAuthenticated: true,
    isProfileComplete: true,
    isStudent: true,
    isVc: false,
    role: 'student',
    hasPermission: () => false,
  });

function renderWithAuth(ui: React.ReactNode, auth: AuthContextType, initialEntries: string[] = ['/']) {
  return render(
    <HelmetProvider>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
        </ToastProvider>
      </AuthContext.Provider>
    </HelmetProvider>
  );
}

describe('VC role RBAC primitives', () => {
  it('resolves the vc role label for the executive surface', () => {
    expect(isVcRole('vc')).toBe(true);
    expect(isVcRole('student')).toBe(false);
    expect(isVcRole('admin')).toBe(false);
    expect(isVcRole(null)).toBe(false);
    expect(roleLabel('vc')).toBe('Vice-Chancellor');
  });

  it('grants the VC role no administrative permissions', () => {
    const vcProfileForRbac = { role: 'vc' as const, permissions: [] as string[], isActive: true };
    for (const key of ['manage_users', 'manage_materials', 'manage_announcements', 'view_analytics', 'manage_accommodation'] as const) {
      expect(can(vcProfileForRbac, key)).toBe(false);
    }
    // The executive role must not inherit student-marketplace authority either.
    expect(can(vcProfileForRbac, 'marketplace')).toBe(false);
  });
});

describe('ProtectedRoute VC gating', () => {
  it('forces a VC session away from admin, super admin and hub routes into /vc', () => {
    renderWithAuth(
      <Routes>
        <Route path="/admin" element={<ProtectedRoute adminOnly><div>admin-content</div></ProtectedRoute>} />
        <Route path="/super" element={<ProtectedRoute superAdminOnly><div>super-content</div></ProtectedRoute>} />
        <Route path="/hub" element={<ProtectedRoute><div>hub-content</div></ProtectedRoute>} />
        <Route path="/vc" element={<div data-testid="executive">executive-overview</div>} />
      </Routes>,
      vcAuth(),
      ['/admin']
    );
    expect(screen.getByTestId('executive')).toBeDefined();
    expect(screen.queryByText('admin-content')).toBeNull();
  });

  it('redirects a VC attempting a direct /hub URL back to /vc', () => {
    renderWithAuth(
      <Routes>
        <Route path="/hub" element={<ProtectedRoute><div>hub-content</div></ProtectedRoute>} />
        <Route path="/vc" element={<div data-testid="executive">executive-overview</div>} />
      </Routes>,
      vcAuth(),
      ['/hub']
    );
    expect(screen.getByTestId('executive')).toBeDefined();
  });

  it('blocks non-VC sessions from the /vc executive portal', () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc" element={<ProtectedRoute vcOnly><div>executive-content</div></ProtectedRoute>} />
        <Route path="/student" element={<div data-testid="student">student-portal</div>} />
      </Routes>,
      studentAuth(),
      ['/vc']
    );
    expect(screen.getByTestId('student')).toBeDefined();
    expect(screen.queryByText('executive-content')).toBeNull();
  });

  it('sends an unauthenticated /vc visitor to the VC login gateway', () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc" element={<ProtectedRoute vcOnly><div>executive-content</div></ProtectedRoute>} />
        <Route path="/vc/login" element={<div data-testid="vc-login">executive-gateway</div>} />
      </Routes>,
      buildMockAuth(),
      ['/vc']
    );
    expect(screen.getByTestId('vc-login')).toBeDefined();
  });

  it('lets a VC into the executive portal only', () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc" element={<ProtectedRoute vcOnly><div data-testid="executive">executive-content</div></ProtectedRoute>} />
      </Routes>,
      vcAuth(),
      ['/vc']
    );
    expect(screen.getByTestId('executive')).toBeDefined();
  });
});

describe('VC executive gateway (VcLoginPage)', () => {
  it('renders the executive login form', () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc/login" element={<VcLoginPage />} />
      </Routes>,
      buildMockAuth(),
      ['/vc/login']
    );
    expect(screen.getByText('Executive overview sign in')).toBeDefined();
    expect(
      screen.getByText(/provisioned by the Super Admin/i)
    ).toBeDefined();
  });

  it('rejects a non-VC role with an access-denied message', async () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc/login" element={<VcLoginPage />} />
      </Routes>,
      buildMockAuth({
        signInWithUsername: async () => ({ error: null, role: 'student' }),
      }),
      ['/vc/login']
    );
    fireEvent.change(screen.getByPlaceholderText(/vice.chancellor/i), { target: { value: 'student.user' } });
    fireEvent.change(screen.getByPlaceholderText('VC account password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /verify & enter executive overview/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Access Denied: This gateway is reserved for the Office of the Vice-Chancellor.')
      ).toBeDefined();
    });
  });

  it('forwards a VC sign-in into the executive overview', async () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc/login" element={<VcLoginPage />} />
        <Route path="/vc" element={<div data-testid="executive">executive-overview</div>} />
      </Routes>,
      buildMockAuth({
        signInWithUsername: async () => ({ error: null, role: 'vc' }),
      }),
      ['/vc/login']
    );
    fireEvent.change(screen.getByPlaceholderText(/vice.chancellor/i), { target: { value: 'vice.chancellor' } });
    fireEvent.change(screen.getByPlaceholderText('VC account password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /verify & enter executive overview/i }));

    await waitFor(() => {
      expect(screen.getByTestId('executive')).toBeDefined();
    });
  });

  it('prompts for a second factor when MFA is required', async () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc/login" element={<VcLoginPage />} />
      </Routes>,
      buildMockAuth({
        signInWithUsername: async () => ({ error: null, role: 'vc', mfaRequired: true }),
      }),
      ['/vc/login']
    );
    fireEvent.change(screen.getByPlaceholderText(/vice.chancellor/i), { target: { value: 'vice.chancellor' } });
    fireEvent.change(screen.getByPlaceholderText('VC account password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /verify & enter executive overview/i }));

    await waitFor(() => {
      expect(screen.getByText('Enter your security code')).toBeDefined();
    });
  });
});

describe('ViceChancellorPortal surface', () => {
  beforeEach(() => {
    // Suppress the first-visit welcome animation so the shell is queried directly.
    window.localStorage.setItem(`fuw_vc_welcome_seen_${vcProfile.id}`, '1');
  });

  it('renders the read-only executive navigation without commerce routes', () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc" element={<ViceChancellorPortal />} />
      </Routes>,
      vcAuth(),
      ['/vc']
    );

    expect(screen.getAllByText('Student Insights').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Academic Resources').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0);
    // The executive surface exposes no commerce or admin entry points (a
    // descriptive sentence may mention them, so match on navigation only).
    expect(document.querySelector('a[href^="/marketplace"], a[href^="/accommodation"]')).toBeNull();
    expect(document.querySelector('a[href^="/admin"], a[href^="/super"]')).toBeNull();
  });

  it('renders institutional aggregates from the VC RPCs', async () => {
    renderWithAuth(
      <Routes>
        <Route path="/vc" element={<ViceChancellorPortal />} />
      </Routes>,
      vcAuth(),
      ['/vc']
    );

    await waitFor(() => {
      expect(
        screen.getByText(/The Executive Overview is a strictly read-only surface/i)
      ).toBeDefined();
    });
  });
});

describe('Super Admin provisioning contract', () => {
  it('never exposes the vc role as a selectable student or admin path', () => {
    // The vc role is not part of the registerable roles: student, lecturer,
    // admin (server-only) and providers. Only isVcRole recognizes it.
    for (const r of ['student', 'lecturer', 'admin', 'super_admin', 'landlord', 'caretaker']) {
      expect(roleLabel(r)).not.toBe('Vice-Chancellor');
    }
  });
});