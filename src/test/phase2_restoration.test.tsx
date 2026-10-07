// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import {
  MarketplaceSplash,
  hasSeenMarketplaceSplash,
  markMarketplaceSplashSeen,
  resetMarketplaceSplashSeen,
  MARKETPLACE_SPLASH_KEY
} from '../marketplace/components/MarketplaceSplash';
import { CampusHubPage } from '../pages/CampusHubPage';
import { AuthProvider } from '../lib/AuthContext';

describe('Phase 2 Restoration - User Experience & Campus Hub', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    resetMarketplaceSplashSeen();
    cleanup();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  describe('1. Marketplace Welcome Animation Restoration', () => {
    it('detects fresh session visitors when no splash token exists in sessionStorage', () => {
      expect(hasSeenMarketplaceSplash()).toBe(false);
    });

    it('persists marketplace splash state upon completion or dismissal', () => {
      markMarketplaceSplashSeen();
      expect(hasSeenMarketplaceSplash()).toBe(true);
      expect(window.sessionStorage.getItem(MARKETPLACE_SPLASH_KEY)).toBe('1');
    });

    it('supports clean reset of marketplace splash token', () => {
      markMarketplaceSplashSeen();
      expect(hasSeenMarketplaceSplash()).toBe(true);
      resetMarketplaceSplashSeen();
      expect(hasSeenMarketplaceSplash()).toBe(false);
      expect(window.sessionStorage.getItem(MARKETPLACE_SPLASH_KEY)).toBeNull();
    });

    it('renders the dedicated FUW Student Marketplace welcome animation on first visit', () => {
      render(<MarketplaceSplash />);

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('FEDERAL UNIVERSITY WUKARI')).toBeDefined();
      expect(screen.getByText('FUW Student Marketplace')).toBeDefined();
      expect(screen.getByText('Buy. Sell. Thrive.')).toBeDefined();
      expect(
        screen.getByText(/Verified campus commerce: products, services and trusted student vendors/i)
      ).toBeDefined();
      expect(screen.getByText('Preparing your marketplace')).toBeDefined();

      const skipBtn = screen.getByRole('button', { name: /skip marketplace welcome animation/i });
      expect(skipBtn).toBeDefined();
    });

    it('does not render for returning visitors who have already seen the marketplace splash', () => {
      markMarketplaceSplashSeen();
      const { container } = render(<MarketplaceSplash />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('dismisses cleanly and persists session flag when Skip is clicked', () => {
      render(<MarketplaceSplash />);
      const skipBtn = screen.getByRole('button', { name: /skip marketplace welcome animation/i });

      act(() => {
        fireEvent.click(skipBtn);
      });

      expect(hasSeenMarketplaceSplash()).toBe(true);
    });
  });

  describe('2. FUW Campus Hub Service Cards Restoration', () => {
    const renderCampusHub = async () => {
      let result: ReturnType<typeof render> = {} as ReturnType<typeof render>;
      await act(async () => {
        result = render(
          <HelmetProvider>
            <MemoryRouter initialEntries={['/hub']}>
              <AuthProvider>
                <CampusHubPage />
              </AuthProvider>
            </MemoryRouter>
          </HelmetProvider>
        );
      });
      return result;
    };

    it('renders the official FUW Campus Hub heading and gateway subtitle', async () => {
      await renderCampusHub();

      expect(screen.getByRole('heading', { level: 1, name: /FUW Campus Hub/i })).toBeDefined();
      expect(screen.getByText('Your gateway to everything in FUW')).toBeDefined();
    });

    it('renders exactly three primary university service cards with correct destinations', async () => {
      await renderCampusHub();

      // Card 1: FUW E Library
      expect(screen.getByRole('heading', { level: 3, name: /FUW E Library/i })).toBeDefined();
      const libraryLink = screen.getByRole('link', { name: /open e library/i });
      expect(libraryLink).toBeDefined();
      expect(libraryLink.getAttribute('href')).toBe('/library');

      // Card 2: FUW Marketplace
      expect(screen.getByRole('heading', { level: 3, name: /FUW Marketplace/i })).toBeDefined();
      const marketplaceLink = screen.getByRole('link', { name: /open marketplace/i });
      expect(marketplaceLink).toBeDefined();
      expect(marketplaceLink.getAttribute('href')).toBe('/marketplace');

      // Card 3: FUW Accommodation
      expect(screen.getByRole('heading', { level: 3, name: /FUW Accommodation/i })).toBeDefined();
      const accommodationLink = screen.getByRole('link', { name: /find accommodation/i });
      expect(accommodationLink).toBeDefined();
      expect(accommodationLink.getAttribute('href')).toBe('/accommodation');
    });

    it('includes responsive grid class for mobile and desktop viewports', async () => {
      const { container } = await renderCampusHub();
      const grid = container.querySelector('.hub-services-grid');
      expect(grid).not.toBeNull();

      const cards = container.querySelectorAll('.service-card');
      expect(cards.length).toBe(3);
    });
  });
});
