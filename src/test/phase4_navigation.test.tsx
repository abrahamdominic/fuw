// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthContext, AuthContextType } from '../lib/AuthContext';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { MarketplaceRoutes } from '../marketplace/MarketplaceRoutes';

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-wrapper">
      <Header />
      <div className="content-grow">{children}</div>
      <Footer />
    </div>
  );
}

function buildMockAuth(): AuthContextType {
  return {
    user: { id: 'test-user-1', email: 'student@fuw.edu.ng' } as any,
    session: null,
    profile: {
      id: 'test-user-1',
      fullName: 'Test Student',
      displayName: 'Test',
      email: 'student@fuw.edu.ng',
      role: 'student' as any,
      matricNumber: 'FUW/2023/001',
      faculty: 'Science',
      department: 'Computer Science',
      level: '300 Level',
      permissions: [],
      isActive: true
    },
    isAuthenticated: true,
    isProfileComplete: true,
    isLoading: false,
    isAdmin: false,
    isSuperAdmin: false,
    isStudent: true,
    role: 'student' as any,
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
    refreshEntitlement: async () => {}
  };
}

describe('Phase 4 Navigation Architecture Verification', () => {
  beforeEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderRoute = (initialPath: string) => {
    return render(
      <HelmetProvider>
        <AuthContext.Provider value={buildMockAuth()}>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              {/* Marketplace isolation - renders MarketplaceRoutes directly without PublicLayout */}
              <Route path="/marketplace/*" element={<MarketplaceRoutes />} />

              {/* Global layouts - render PublicLayout containing Header (GlobalNavbar) */}
              <Route
                path="/hub"
                element={
                  <PublicLayout>
                    <div data-testid="hub-content">Campus Hub</div>
                  </PublicLayout>
                }
              />
              <Route
                path="/library"
                element={
                  <PublicLayout>
                    <div data-testid="library-content">E Library</div>
                  </PublicLayout>
                }
              />
              <Route
                path="/accommodation"
                element={
                  <PublicLayout>
                    <div data-testid="accommodation-content">Accommodation</div>
                  </PublicLayout>
                }
              />
              <Route
                path="/courses"
                element={
                  <PublicLayout>
                    <div data-testid="courses-content">Courses Directory</div>
                  </PublicLayout>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </HelmetProvider>
    );
  };

  describe('1. Marketplace Navigation Isolation', () => {
    const marketplacePaths = [
      '/marketplace',
      '/marketplace/browse',
      '/marketplace/cart',
      '/marketplace/checkout',
      '/marketplace/wallet'
    ];

    it.each(marketplacePaths)(
      'renders exactly ONE MarketplaceNavbar and ZERO GlobalNavbar on %s',
      async (path) => {
        const { container } = renderRoute(path);

        await waitFor(() => {
          const mpNavbars = container.querySelectorAll('.mp-navbar');
          const globalNavbars = container.querySelectorAll('.main-header');

          // Exactly ONE MarketplaceNavbar
          expect(mpNavbars.length).toBe(1);
          // ZERO GlobalNavbar
          expect(globalNavbars.length).toBe(0);
        });
      }
    );
  });

  describe('2. Non-Marketplace Navigation Isolation', () => {
    const nonMarketplacePaths = [
      '/hub',
      '/library',
      '/accommodation',
      '/courses'
    ];

    it.each(nonMarketplacePaths)(
      'renders exactly ONE GlobalNavbar and ZERO MarketplaceNavbar on %s',
      async (path) => {
        const { container } = renderRoute(path);

        await waitFor(() => {
          const mpNavbars = container.querySelectorAll('.mp-navbar');
          const globalNavbars = container.querySelectorAll('.main-header');

          // ZERO MarketplaceNavbar
          expect(mpNavbars.length).toBe(0);
          // Exactly ONE GlobalNavbar
          expect(globalNavbars.length).toBe(1);
        });
      }
    );
  });

  describe('3. Clean DOM and Absence of Duplicate Navigation Workarounds', () => {
    it('does not render multiple header elements simultaneously on any tested route', async () => {
      const mpResult = renderRoute('/marketplace');
      expect(mpResult.container.querySelectorAll('header').length).toBe(1);
      cleanup();

      const hubResult = renderRoute('/hub');
      expect(hubResult.container.querySelectorAll('header').length).toBe(1);
      cleanup();
    });
  });
});
