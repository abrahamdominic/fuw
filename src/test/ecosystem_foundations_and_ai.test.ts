import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'card-1',
              deck_id: 'deck-1',
              user_id: 'user-1',
              front: 'Test Front',
              back: 'Test Back',
              repetitions: 0,
              interval_days: 1,
              ease_factor: 2.3,
              difficulty: 'hard'
            },
            error: null
          })
        })
      })
    })
  });

  return {
    supabase: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: mockFrom
    },
    requireSupabase: vi.fn().mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: mockFrom
    })
  };
});

import {
  calculateExamReadiness
} from '../lib/examPrep';
import {
  reviewFlashcard,
  Flashcard
} from '../lib/flashcards';
import {
  getDismissedRecommendationIds,
  dismissRecommendation,
  clearDismissedRecommendations
} from '../lib/recommendations';

describe('FUW Ecosystem Foundations & AI Modules', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Recommendations Dismissal & Storage', () => {
    it('initializes with an empty dismissed list', () => {
      expect(getDismissedRecommendationIds()).toEqual([]);
    });

    it('correctly records dismissed recommendation IDs in localStorage', () => {
      dismissRecommendation('mat_123');
      dismissRecommendation('acc_456');

      const dismissed = getDismissedRecommendationIds();
      expect(dismissed).toContain('mat_123');
      expect(dismissed).toContain('acc_456');
      expect(dismissed.length).toBe(2);
    });

    it('does not duplicate dismissed recommendation IDs', () => {
      dismissRecommendation('mat_123');
      dismissRecommendation('mat_123');

      const dismissed = getDismissedRecommendationIds();
      expect(dismissed.length).toBe(1);
    });

    it('clears dismissed recommendations', () => {
      dismissRecommendation('mat_123');
      clearDismissedRecommendations();
      expect(getDismissedRecommendationIds()).toEqual([]);
    });
  });

  describe('Flashcards SM-2 Spaced Repetition Engine', () => {
    const baseCard: Flashcard = {
      id: 'card-1',
      deck_id: 'deck-1',
      user_id: 'user-1',
      front: 'What is Big-O of binary search?',
      back: 'O(log n)',
      hint: 'Divides in half',
      difficulty: 'medium',
      repetitions: 4,
      interval_days: 14,
      ease_factor: 2.5,
      next_review_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    it('resets interval and repetitions when rating is "again"', async () => {
      const reviewed = await reviewFlashcard(baseCard, 'again');
      expect(reviewed.repetitions).toBe(0);
      expect(reviewed.interval_days).toBe(1);
    });
  });

  describe('Exam Readiness Scoring Algorithm', () => {
    it('computes deterministic score and appropriate tier', async () => {
      const readiness = await calculateExamReadiness('CSC 201');

      expect(readiness.courseCode).toBe('CSC 201');
      expect(typeof readiness.score).toBe('number');
      expect(readiness.score).toBeGreaterThanOrEqual(0);
      expect(readiness.score).toBeLessThanOrEqual(100);
      expect(['Exam Ready', 'Good Progress', 'Needs Review', 'Critical Revision']).toContain(readiness.tier);
      expect(Array.isArray(readiness.actionableInsights)).toBe(true);
      expect(readiness.actionableInsights.length).toBeGreaterThan(0);
    });
  });
});
