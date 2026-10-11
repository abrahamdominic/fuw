import { describe, it, expect } from 'vitest';
import {
  Expense,
  categoryLabel,
  formatNaira,
  monthSpendByCategory,
  parseNairaToKobo,
  summarizeSpending,
  weekSpendByCategory
} from '../lib/expenses';
import { daysUntil, opportunityCategoryLabel } from '../lib/opportunities';
import { ISSUE_STATUS_LABELS, issueCategoryLabel } from '../lib/safety';

function makeExpense(partial: Partial<Expense> & Pick<Expense, 'amountKobo' | 'spentOn' | 'category'>): Expense {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    title: partial.title ?? 'Expense',
    notes: partial.notes ?? '',
    createdAt: partial.createdAt ?? new Date().toISOString(),
    ...partial
  } as Expense;
}

describe('Expense tracker — money parsing & formatting', () => {
  it('parses Naira input (with symbols/commas) into integer kobo', () => {
    expect(parseNairaToKobo('1,500.50')).toBe(150050);
    expect(parseNairaToKobo('₦2,000')).toBe(200000);
    expect(parseNairaToKobo('0.99')).toBe(99);
  });

  it('rejects blank, zero and negative amounts', () => {
    expect(parseNairaToKobo('')).toBe(0);
    expect(parseNairaToKobo('abc')).toBe(0);
    expect(parseNairaToKobo('0')).toBe(0);
    expect(parseNairaToKobo('-500')).toBe(0);
  });

  it('formats kobo back to a Naira string', () => {
    expect(formatNaira(150000)).toBe('₦1,500');
    expect(formatNaira(0)).toBe('₦0');
    expect(formatNaira(5050)).toBe('₦50.5');
  });

  it('resolves budget/category labels', () => {
    expect(categoryLabel('overall')).toBe('Overall');
    expect(categoryLabel('food')).toBe('Food & provisions');
  });
});

describe('Expense tracker — derived statistics', () => {
  it('totals only the current calendar month per category', () => {
    const expenses = [
      makeExpense({ category: 'food', amountKobo: 100000, spentOn: '2026-10-05' }),
      makeExpense({ category: 'food', amountKobo: 50000, spentOn: '2026-10-20' }),
      makeExpense({ category: 'transport', amountKobo: 20000, spentOn: '2026-10-11' }),
      makeExpense({ category: 'food', amountKobo: 990000, spentOn: '2026-09-30' })
    ];
    const totals = monthSpendByCategory(expenses, new Date('2026-10-15T10:00:00'));
    expect(totals.get('food')).toBe(150000);
    expect(totals.get('transport')).toBe(20000);
  });

  it('totals the current ISO week (Mon–Sun) per category', () => {
    // 2026-10-05 is a Monday; the week runs Mon 05 → Sun 11.
    const expenses = [
      makeExpense({ category: 'food', amountKobo: 10000, spentOn: '2026-10-04' }), // previous Sunday
      makeExpense({ category: 'food', amountKobo: 30000, spentOn: '2026-10-05' }),
      makeExpense({ category: 'food', amountKobo: 20000, spentOn: '2026-10-11' }),
      makeExpense({ category: 'food', amountKobo: 70000, spentOn: '2026-10-12' }) // next Monday
    ];
    const totals = weekSpendByCategory(expenses, new Date('2026-10-07T12:00:00'));
    expect(totals.get('food')).toBe(50000);
  });

  it('summarizes spending and identifies the top category', () => {
    const today = new Date();
    const iso = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    };
    const expenses = [
      makeExpense({ category: 'food', amountKobo: 40000, spentOn: iso(0) }),
      makeExpense({ category: 'data', amountKobo: 10000, spentOn: iso(-2) }),
      makeExpense({ category: 'food', amountKobo: 400000, spentOn: iso(-60) }) // outside window
    ];
    const summary = summarizeSpending(expenses, 7);
    expect(summary.totalKobo).toBe(50000);
    expect(summary.topCategory).toBe('food');
    expect(summary.byCategory[0].share).toBeCloseTo(0.8, 5);
  });
});

describe('Opportunities hub — helpers', () => {
  it('resolves category labels with a safe fallback', () => {
    expect(opportunityCategoryLabel('scholarship')).toBe('Scholarship');
    expect(opportunityCategoryLabel('graduate_trainee')).toBe('Graduate trainee');
    expect(opportunityCategoryLabel('nonsense' as never)).toBe('nonsense');
  });

  it('computes days until a deadline', () => {
    expect(daysUntil(null)).toBeNull();
    const past = new Date();
    past.setDate(past.getDate() - 5);
    const future = new Date();
    future.setDate(future.getDate() + 10);
    expect(daysUntil(past.toISOString().slice(0, 10))).toBeLessThan(0);
    expect(daysUntil(future.toISOString().slice(0, 10))).toBeGreaterThan(0);
  });
});

describe('Campus safety — labels', () => {
  it('maps issue categories to human labels', () => {
    expect(issueCategoryLabel('water')).toBe('Water supply');
    expect(issueCategoryLabel('accessibility')).toBe('Accessibility');
    expect(issueCategoryLabel('unknown' as never)).toBe('unknown');
  });

  it('exposes friendly status labels', () => {
    expect(ISSUE_STATUS_LABELS.open).toBe('Submitted');
    expect(ISSUE_STATUS_LABELS.in_progress).toBe('In progress');
    expect(ISSUE_STATUS_LABELS.resolved).toBe('Resolved');
  });
});
