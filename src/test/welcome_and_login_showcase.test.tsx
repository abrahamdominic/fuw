// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { FirstVisitWelcome } from '../components/FirstVisitWelcome';
import { AuthShowcase, MacPage } from '../pages/AuthScreens';
import { hasSeenWelcome, markWelcomeSeen, resetWelcomeSeen } from '../lib/welcomePersistence';
import { BASELINE_PLATFORM_STATS } from '../lib/platformStats';

describe('FUW Campus Hub - First Visit Welcome Animation & Login Showcase', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWelcomeSeen();
    cleanup();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe('1. First Visit Persistence Invariants', () => {
    it('detects fresh visitors when no persistence token exists', () => {
      expect(hasSeenWelcome()).toBe(false);
    });

    it('persists welcome state upon completion or dismissal', () => {
      markWelcomeSeen();
      expect(hasSeenWelcome()).toBe(true);
      expect(window.localStorage.getItem('fuw_first_visit_welcomed_v1')).toBe('true');
    });

    it('supports clean reset without runtime exceptions', () => {
      markWelcomeSeen();
      expect(hasSeenWelcome()).toBe(true);
      resetWelcomeSeen();
      expect(hasSeenWelcome()).toBe(false);
      expect(window.localStorage.getItem('fuw_first_visit_welcomed_v1')).toBeNull();
    });
  });

  describe('2. FirstVisitWelcome Component Presentation & Interaction', () => {
    it('renders the welcome presentation for first-time visitors', () => {
      render(<FirstVisitWelcome />);

      // Title & Branding
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('FEDERAL UNIVERSITY WUKARI')).toBeDefined();
      expect(screen.getByText('FUW Campus Hub')).toBeDefined();
      expect(screen.getByText('Your gateway to everything in FUW.')).toBeDefined();

      // 3 Core Pillars
      expect(screen.getByText('Academic E-Library')).toBeDefined();
      expect(screen.getByText('Student Marketplace')).toBeDefined();
      expect(screen.getByText('Accommodation')).toBeDefined();

      // Action button
      expect(screen.getByRole('button', { name: /continue to login/i })).toBeDefined();
    });

    it('does not render for returning visitors who have already seen the welcome', () => {
      markWelcomeSeen();
      const { container } = render(<FirstVisitWelcome />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('dismisses cleanly and records persistence when Continue is clicked', () => {
      render(<FirstVisitWelcome />);
      const btn = screen.getByRole('button', { name: /continue to login/i });

      act(() => {
        fireEvent.click(btn);
      });

      expect(hasSeenWelcome()).toBe(true);
    });
  });

  describe('3. Login Screen Showcase Copy & Authoritative Statistics', () => {
    it('renders the updated FUW Campus Hub headline and description', () => {
      render(<AuthShowcase />);

      expect(screen.getByRole('heading', { name: /FUW Campus Hub/i })).toBeDefined();
      expect(screen.getByText(/Your gateway to everything in FUW/i)).toBeDefined();
      expect(
        screen.getByText(
          /Access your academic resources, campus marketplace, and student accommodation from one connected FUW platform/i
        )
      ).toBeDefined();
    });

    it('displays authoritative live platform statistics instead of outdated hardcoded claims', () => {
      render(<AuthShowcase />);

      // Authoritative accredited faculties (14) and departments (67)
      expect(screen.getByText(String(BASELINE_PLATFORM_STATS.faculties))).toBeDefined();
      expect(screen.getByText('Faculties')).toBeDefined();

      expect(screen.getByText(String(BASELINE_PLATFORM_STATS.departments))).toBeDefined();
      expect(screen.getByText('Departments')).toBeDefined();

      expect(screen.getByText('Study Resources')).toBeDefined();
    });

    it('renders the 3 campus hub pillar chips', () => {
      const { container } = render(<AuthShowcase />);
      const pillars = container.querySelector('.mac-showcase-pillars');
      expect(pillars).not.toBeNull();
      expect(pillars?.textContent).toContain('E-Library');
      expect(pillars?.textContent).toContain('Marketplace');
      expect(pillars?.textContent).toContain('Accommodation');
    });

    it('renders all 6 modernized academic & campus feature highlights', () => {
      render(<AuthShowcase />);

      expect(screen.getByText(/24\/7 access across mobile, tablet, and desktop/i)).toBeDefined();
      expect(screen.getByText(/Faculty and department academic resources/i)).toBeDefined();
      expect(screen.getByText(/Fast access to study materials & textbooks/i)).toBeDefined();
      expect(screen.getByText(/Past questions and examination resources/i)).toBeDefined();
      expect(screen.getByText(/Organized, curriculum-aligned academic materials/i)).toBeDefined();
      expect(screen.getByText(/Campus services through the wider FUW Campus Hub/i)).toBeDefined();
    });

    it('renders the mobile pillar indicator in MacPage shell', () => {
      const { container } = render(
        <MacPage pill="TEST PILL">
          <div>Login Form Children</div>
        </MacPage>
      );

      const mobilePillars = container.querySelector('.mac-mobile-pillars');
      expect(mobilePillars).not.toBeNull();
      expect(mobilePillars?.textContent).toContain('E-Library');
      expect(mobilePillars?.textContent).toContain('Marketplace');
      expect(mobilePillars?.textContent).toContain('Accommodation');
    });
  });
});
