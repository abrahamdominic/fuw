// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { FirstVisitWelcome } from '../components/FirstVisitWelcome';
import { resetWelcomeSeen, markWelcomeSeen, hasSeenWelcome } from '../lib/welcomePersistence';

describe('FirstVisitWelcome Lifecycle & Interaction Protection', () => {
  beforeEach(() => {
    resetWelcomeSeen();
    localStorage.clear();
  });

  afterEach(() => {
    resetWelcomeSeen();
    localStorage.clear();
  });

  it('renders welcome overlay on first visit', () => {
    render(<FirstVisitWelcome />);
    expect(screen.getByRole('dialog', { name: /Welcome to FUW Campus Hub/i })).toBeTruthy();
  });

  it('dismisses cleanly and unmounts without getting stuck as an invisible pointer-blocking overlay', () => {
    const { container } = render(<FirstVisitWelcome />);
    const overlay = container.querySelector('.fuw-welcome-backdrop') as HTMLElement;
    expect(overlay).toBeTruthy();

    const continueBtn = screen.getByRole('button', { name: /Continue to Login/i });
    expect(continueBtn).toBeTruthy();

    // Click continue
    act(() => {
      fireEvent.click(continueBtn);
    });

    // In jsdom environment, it unmounts immediately to prevent test leaks
    expect(container.querySelector('.fuw-welcome-backdrop')).toBeNull();
    expect(hasSeenWelcome()).toBe(true);
  });

  it('never mounts when the user has already seen the welcome presentation', () => {
    markWelcomeSeen();
    const { container } = render(<FirstVisitWelcome />);
    expect(container.querySelector('.fuw-welcome-backdrop')).toBeNull();
  });

  it('in real browser environment sets pointerEvents: none during exit and unmounts on timer', () => {
    vi.useFakeTimers();
    // Temporarily mock userAgent to simulate real browser (Chrome)
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      configurable: true
    });

    try {
      const { container } = render(<FirstVisitWelcome />);
      const overlay = container.querySelector('.fuw-welcome-backdrop') as HTMLElement;
      expect(overlay).toBeTruthy();

      const continueBtn = screen.getByRole('button', { name: /Continue to Login/i });

      act(() => {
        fireEvent.click(continueBtn);
      });

      // Overlay must NOT be unmounted immediately in browser mode, but MUST have pointerEvents: 'none'
      expect(overlay.style.pointerEvents).toBe('none');
      expect(overlay.className).toContain('fuw-welcome-fade-out');

      // Advance transition timer (500ms)
      act(() => {
        vi.advanceTimersByTime(550);
      });

      // Now it must be completely removed from DOM
      expect(container.querySelector('.fuw-welcome-backdrop')).toBeNull();
      expect(hasSeenWelcome()).toBe(true);
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUA,
        configurable: true
      });
      vi.useRealTimers();
    }
  });
});
