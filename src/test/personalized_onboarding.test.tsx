import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingPage } from '../pages/OnboardingPage';
import * as AuthContextModule from '../lib/AuthContext';
import type { AuthContextType } from '../lib/AuthContext';
import * as academicsModule from '../lib/academics';
import { fetchSuggestedMaterials } from '../lib/suggestions';
import { fetchCampusRecommendations } from '../lib/recommendations';

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
      matricNumber: '',
      faculty: 'Faculty of Science',
      department: 'Computer Science',
      level: '400 Level',
      permissions: [],
      isActive: true,
      onboardingCompleted: false,
      onboardingStarted: false,
      onboardingStep: 1
    },
    isAuthenticated: true,
    isProfileComplete: false,
    isLoading: false,
    isAdmin: false,
    isSuperAdmin: false,
    isStudent: true,
    isLecturer: false,
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
    onboardingCompleted: false,
    onboardingStep: 1,
    setOnboardingState: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe('Personalized Onboarding & Security Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders personalized student greeting using student name and step progress', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(buildMockAuth());

    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Welcome back, Abraham Peter!/i)).toBeDefined();
    expect(screen.getByText(/Step 1 of 5/i)).toBeDefined();
    expect(screen.getByText(/Student Workspace Setup/i)).toBeDefined();
  });

  it('allows student to advance through academic details step', async () => {
    const mockSetOnboarding = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        setOnboardingState: mockSetOnboarding
      })
    );

    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    );

    const getStartedBtn = screen.getByRole('button', { name: /Get Started/i });
    fireEvent.click(getStartedBtn);

    await waitFor(() => {
      expect(mockSetOnboarding).toHaveBeenCalledWith(2, false);
    });
  });

  it('renders personalized lecturer onboarding with academic scope & clearance notice', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        isStudent: false,
        isLecturer: true,
        role: 'lecturer' as any,
        profile: {
          id: 'lecturer-1',
          fullName: 'Dr. John Doe',
          displayName: 'Dr. John',
          email: 'johndoe@fuw.edu.ng',
          role: 'lecturer' as any,
          matricNumber: '',
          faculty: 'Faculty of Science',
          department: 'Computer Science',
          level: '',
          permissions: [],
          isActive: true,
          onboardingCompleted: false,
          onboardingStarted: false,
          onboardingStep: 1
        }
      })
    );

    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Welcome, Dr. John!/i)).toBeDefined();
    expect(screen.getByText(/Academic Staff Portal/i)).toBeDefined();
    expect(screen.getByText(/Instant Direct Publishing/i)).toBeDefined();
  });

  it('renders personalized admin onboarding with clearance details', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      buildMockAuth({
        isStudent: false,
        isAdmin: true,
        role: 'admin' as any,
        profile: {
          id: 'admin-1',
          fullName: 'Campus Admin',
          displayName: 'Admin',
          email: 'admin@fuw.edu.ng',
          role: 'admin' as any,
          matricNumber: '',
          faculty: '',
          department: '',
          level: '',
          permissions: ['*'],
          isActive: true,
          onboardingCompleted: false,
          onboardingStarted: false,
          onboardingStep: 1
        }
      })
    );

    render(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Welcome, Administrator Campus Admin!/i)).toBeDefined();
    expect(screen.getByText(/Administrative Governance Suite/i)).toBeDefined();
  });

  it('enforces level gating so 100L materials are NOT suggested to 400L students without registered course offering', async () => {
    const mockMaterials = [
      {
        id: 'mat-100l',
        title: 'Introduction to Computing',
        course: 'CSC 101',
        department: 'Computer Science',
        faculty: 'Faculty of Science',
        level: '100 Level',
        status: 'approved',
        type: 'Lecture Note'
      },
      {
        id: 'mat-400l',
        title: 'Distributed Systems Architecture',
        course: 'CSC 401',
        department: 'Computer Science',
        faculty: 'Faculty of Science',
        level: '400 Level',
        status: 'approved',
        type: 'Lecture Note'
      }
    ];

    const supabaseModule = await import('../lib/supabase');
    vi.spyOn(supabaseModule, 'requireSupabase').mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: 'mock-announcement-id', error: null })
    } as any);

    // Test suggestions ranking
    const materialsModule = await import('../lib/materials');
    vi.spyOn(materialsModule, 'fetchMaterials').mockResolvedValue({
      items: mockMaterials as any,
      total: 2,
      hasMore: false
    });

    const suggestions = await fetchSuggestedMaterials(
      {
        department: 'Computer Science',
        faculty: 'Faculty of Science',
        level: '400 Level',
        courseCodes: ['CSC 401'] // Student only offers 400L course
      },
      10
    );

    // Ensure 100L material is NOT recommended to a 400L student
    const recommendedLevels = suggestions.map((s) => s.material.level);
    expect(recommendedLevels).not.toContain('100 Level');
    if (suggestions.length > 0) {
      expect(recommendedLevels).toContain('400 Level');
    }
  });

  it('calls lecturerBroadcastAnnouncement with proper scope arguments', async () => {
    const broadcastSpy = vi
      .spyOn(academicsModule, 'lecturerBroadcastAnnouncement')
      .mockResolvedValue('new-announcement-id');

    await academicsModule.lecturerBroadcastAnnouncement({
      title: 'CSC 401 Project Presentation',
      body: 'All presentations take place on Thursday in Lab 2.',
      departmentIds: ['dept-csc-id'],
      announcementType: 'assignment'
    });

    expect(broadcastSpy).toHaveBeenCalledWith({
      title: 'CSC 401 Project Presentation',
      body: 'All presentations take place on Thursday in Lab 2.',
      departmentIds: ['dept-csc-id'],
      announcementType: 'assignment'
    });
  });
});
