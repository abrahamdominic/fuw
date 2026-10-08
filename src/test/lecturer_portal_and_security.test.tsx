import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { isLecturerRole, roleLabel } from '../lib/rbac';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { PORTAL_ROUTES } from '../lib/seo/routes';
import * as AuthContextModule from '../lib/AuthContext';
import type { AuthContextType } from '../lib/AuthContext';

function buildMockAuth(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: { id: 'test-user-id', email: 'test@fuw.edu.ng' } as any,
    session: null,
    profile: {
      id: 'test-user-id',
      fullName: 'Dr. Test Lecturer',
      displayName: 'Test',
      email: 'test@fuw.edu.ng',
      role: 'lecturer' as any,
      matricNumber: '',
      faculty: 'Faculty of Science',
      department: 'Computer Science',
      level: '',
      permissions: [],
      isActive: true
    },
    isAuthenticated: true,
    isProfileComplete: true,
    isLoading: false,
    isAdmin: false,
    isSuperAdmin: false,
    isStudent: false,
    isLecturer: true,
    role: 'lecturer' as any,
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

describe('Lecturer Role, RBAC, and Route Security', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('identifies lecturer role and returns correct label', () => {
    expect(isLecturerRole('lecturer')).toBe(true);
    expect(isLecturerRole('student')).toBe(false);
    expect(isLecturerRole('admin')).toBe(false);
    expect(roleLabel('lecturer')).toBe('Lecturer');
  });

  it('allows authenticated lecturer to access lecturerOnly routes', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        role: 'lecturer',
        isLecturer: true,
        isStudent: false,
        isAdmin: false
      })
    );

    render(
      <MemoryRouter initialEntries={['/lecturer']}>
        <Routes>
          <Route
            path="/lecturer"
            element={
              <ProtectedRoute lecturerOnly>
                <div data-testid="lecturer-portal">Lecturer Portal Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('lecturer-portal')).toBeDefined();
    expect(screen.getByText('Lecturer Portal Content')).toBeDefined();
  });

  it('redirects students attempting to access /lecturer to /student', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        role: 'student',
        isLecturer: false,
        isStudent: true,
        isAdmin: false,
        profile: {
          id: 'student-id',
          fullName: 'Student User',
          displayName: 'Student',
          email: 'student@fuw.edu.ng',
          role: 'student',
          matricNumber: 'FUW/2023/123',
          faculty: 'Science',
          department: 'Computer Science',
          level: '300 Level',
          permissions: [],
          isActive: true
        }
      })
    );

    render(
      <MemoryRouter initialEntries={['/lecturer']}>
        <Routes>
          <Route
            path="/lecturer"
            element={
              <ProtectedRoute lecturerOnly>
                <div data-testid="lecturer-portal">Lecturer Portal Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/student" element={<div data-testid="student-portal">Student Portal</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('lecturer-portal')).toBeNull();
    expect(screen.getByTestId('student-portal')).toBeDefined();
  });

  it('redirects lecturers attempting to access studentOnly routes to /lecturer', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        role: 'lecturer',
        isLecturer: true,
        isStudent: false,
        isAdmin: false
      })
    );

    render(
      <MemoryRouter initialEntries={['/student']}>
        <Routes>
          <Route
            path="/student"
            element={
              <ProtectedRoute studentOnly>
                <div data-testid="student-portal">Student Portal</div>
              </ProtectedRoute>
            }
          />
          <Route path="/lecturer" element={<div data-testid="lecturer-portal">Lecturer Portal</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('student-portal')).toBeNull();
    expect(screen.getByTestId('lecturer-portal')).toBeDefined();
  });

  it('redirects lecturers attempting to access adminOnly routes to /lecturer', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        role: 'lecturer',
        isLecturer: true,
        isStudent: false,
        isAdmin: false
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute adminOnly>
                <div data-testid="admin-portal">Admin Portal</div>
              </ProtectedRoute>
            }
          />
          <Route path="/lecturer" element={<div data-testid="lecturer-portal">Lecturer Portal</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('admin-portal')).toBeNull();
    expect(screen.getByTestId('lecturer-portal')).toBeDefined();
  });

  it('enforces SEO protection and noindex for /lecturer', () => {
    const meta = PORTAL_ROUTES['/lecturer'];
    expect(meta).toBeDefined();
    expect(meta.indexability).toBe('noindex');
    expect(meta.path).toBe('/lecturer');
  });
});
