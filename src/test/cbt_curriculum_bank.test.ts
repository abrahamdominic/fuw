import { describe, it, expect } from 'vitest';
import { CURATED_BANKS, dedupeKeyForQuestion } from '../data/cbt/curriculum';
import { validateAllCuratedBanks, normalizeQuestionText } from '../lib/cbtValidation';

const LETTERS = ['A', 'B', 'C', 'D'] as const;

describe('Curated CBT banks', () => {
  it('all curated banks are independently valid (120 unique, properly formed)', () => {
    const reports = validateAllCuratedBanks();
    for (const report of reports) {
      expect(report.valid, `${report.courseCode}: ${report.issues.map((i) => i.message).join('; ')}`).toBe(true);
      expect(report.count).toBe(120);
    }
  });

  it('every bank covers a spread of topics with a difficulty mix', () => {
    for (const bank of CURATED_BANKS) {
      const topics = new Set(bank.questions.map((q) => q.t));
      const easy = bank.questions.filter((q) => q.d === 'easy').length;
      const hard = bank.questions.filter((q) => q.d === 'hard').length;
      expect(topics.size, `${bank.courseCode} topics ${topics.size}`).toBeGreaterThanOrEqual(8);
      expect(easy).toBeGreaterThan(0);
      expect(hard).toBeGreaterThan(0);
      expect(easy).toBeLessThanOrEqual(70);
    }
  });

  it('no two questions in a course share a normalized stem (no filler duplicates)', () => {
    for (const bank of CURATED_BANKS) {
      const seen = new Map<string, number>();
      for (const q of bank.questions) {
        const norm = normalizeQuestionText(q.q);
        const prev = seen.get(norm);
        if (prev !== undefined) {
          expect(`${bank.courseCode} dup n=${prev} & n=${q.n}`).toBe('no duplicate stems');
        }
        seen.set(norm, q.n);
      }
    }
  });

  it('seeding maps each curated question to a non-empty lettered option map', () => {
    for (const bank of CURATED_BANKS) {
      for (const q of bank.questions) {
        const letter = LETTERS[q.c];
        const optionMap: Record<string, string> = {};
        q.o.forEach((value, index) => {
          optionMap[LETTERS[index]] = value;
        });
        expect(letter, `${bank.courseCode} n=${q.n}`).toBeDefined();
        expect(optionMap[letter], `${bank.courseCode} n=${q.n} correct option empty`).toBeTruthy();
        expect(Object.keys(optionMap)).toHaveLength(4);
      }
    }
  });

  it('curated dedupe keys are unique across all banks and stable in form', () => {
    const keys = new Set<string>();
    for (const bank of CURATED_BANKS) {
      for (const q of bank.questions) {
        const key = dedupeKeyForQuestion(bank.courseCode, q.n);
        expect(key).toMatch(/^CUR-[A-Z0-9]+-\d{3}$/);
        keys.add(key);
      }
    }
    expect(keys.size).toBe(CURATED_BANKS.length * 120);
  });
});