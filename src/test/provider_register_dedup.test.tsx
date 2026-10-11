import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProviderRegisterPage from '../pages/ProviderRegisterPage';
import * as AuthContextModule from '../lib/AuthContext';
import type { AuthContextType } from '../lib/AuthContext';
import {
  fetchMyProvider,
  registerProvider,
  uploadProviderDocument
} from '../lib/accommodationPortal';
import type { ProviderProfile } from '../lib/accommodationPortal';

vi.mock('../components/Header', () => ({
  Header: () => <div data-testid="header" />
}));
vi.mock('../components/Footer', () => ({
  Footer: () => <div data-testid="footer" />
}));
vi.mock('../components/SEO', () => ({
  SEO: () => null
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() })
}));
vi.mock('../lib/accommodationPortal', () => ({
  fetchMyProvider: vi.fn(),
  registerProvider: vi.fn(),
  uploadProviderDocument: vi.fn()
}));
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
  requireSupabase: () => ({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) })
}));

const mockedFetchMyProvider = vi.mocked(fetchMyProvider);
const mockedRegister = vi.mocked(registerProvider);
const mockedUpload = vi.mocked(uploadProviderDocument);

function buildMockAuth(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: { id: 'test-user-id', email: 'abraham@fuw.edu.ng' } as any,
    session: null,
    profile: {
      id: 'test-user-id',
      fullName: 'Abraham Peter',
      displayName: 'Abraham',
      email: 'abraham@fuw.edu.ng',
      role: 'student' as any,
      phoneNumber: '',
      matricNumber: '',
      faculty: '',
      department: '',
      level: '',
      permissions: [],
      isActive: true,
      onboardingCompleted: true,
      onboardingStarted: true,
      onboardingStep: 1
    },
    isAuthenticated: true,
    isProfileComplete: true,
    isLoading: false,
    isAdmin: false,
    isSuperAdmin: false,
    isStudent: true,
    isLecturer: false,
    isLandlord: false,
    isCaretaker: false,
    isProvider: false,
    isVc: false,
    role: 'student' as any,
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
    onboardingCompleted: true,
    onboardingStep: 1,
    setOnboardingState: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function mockAuth(auth: AuthContextType) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(auth);
}

describe('Provider registration avoids duplicate information', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockedFetchMyProvider.mockResolvedValue({ registered: false, role: null } as ProviderProfile);
    mockedRegister.mockResolvedValue({ ok: true } as any);
    mockedUpload.mockResolvedValue('test/path.pdf');
  });

  it('reuses the profile name/email and never re-asks for it', async () => {
    const auth = buildMockAuth({
      profile: {
        ...buildMockAuth().profile!,
        phoneNumber: '08012345678'
      }
    });
    mockAuth(auth);

    render(
      <MemoryRouter>
        <ProviderRegisterPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Your details — from your FUW account/i)).toBeDefined();
    });

    // Name, email and phone surface from the profile (email also shown in the
    // "signed in as" line, so it may legitimately appear twice).
    expect(screen.getByText('Abraham Peter')).toBeDefined();
    expect(screen.getAllByText('abraham@fuw.edu.ng').length).toBeGreaterThan(0);
    expect(screen.getByText('08012345678')).toBeDefined();

    // The full legal name is NOT asked again on the application step.
    expect(screen.queryByText(/Full legal name/i)).toBeNull();
    // The phone is NOT asked again because it is already on the profile.
    expect(screen.queryByPlaceholderText('08012345678')).toBeNull();
  });

  it('asks for phone only when missing, then submits and syncs it back to the profile', async () => {
    const updateProfile = vi.fn().mockResolvedValue({ error: null });
    mockAuth(buildMockAuth({ updateProfile }));

    render(
      <MemoryRouter>
        <ProviderRegisterPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Your details — from your FUW account/i)).toBeDefined();
    });

    // Only the phone is requested (profile has none), saved to the profile.
    const phoneInput = screen.getByPlaceholderText('08012345678');
    expect(screen.getByText(/Phone number \(saved to your profile\)/i)).toBeDefined();
    fireEvent.change(phoneInput, { target: { value: '08123456789' } });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Submit application/i }));

    await waitFor(() => {
      expect(mockedRegister).toHaveBeenCalledWith(
        expect.objectContaining({
          accountType: 'landlord',
          fullName: 'Abraham Peter',
          phone: '08123456789'
        })
      );
    });

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({ phoneNumber: '08123456789' });
    });
  });
});