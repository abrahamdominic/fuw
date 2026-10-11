// Student expense tracker & budget planner data access.
//
// These are private, student-entered notes. They are NOT wallet transactions and
// are never reconciled against the campus wallet ledger. All reads/writes are
// scoped to the signed-in user by RLS (`user_id = auth.uid()`).
import { requireSupabase } from './supabase';

export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'accommodation'
  | 'academic'
  | 'data'
  | 'health'
  | 'personal'
  | 'savings'
  | 'other';

export type BudgetPeriod = 'weekly' | 'monthly';
export type BudgetCategory = 'overall' | ExpenseCategory;

export interface Expense {
  id: string;
  category: ExpenseCategory;
  title: string;
  amountKobo: number;
  spentOn: string;
  notes: string;
  createdAt: string;
}

export interface ExpenseInput {
  category: ExpenseCategory;
  title: string;
  amountKobo: number;
  spentOn: string;
  notes?: string;
}

export interface Budget {
  id: string;
  period: BudgetPeriod;
  category: BudgetCategory;
  limitKobo: number;
}

export interface SavingsGoal {
  id: string;
  title: string;
  targetKobo: number;
  savedKobo: number;
  dueOn: string | null;
  createdAt: string;
}

export const EXPENSE_CATEGORIES: { key: ExpenseCategory; label: string }[] = [
  { key: 'food', label: 'Food & provisions' },
  { key: 'transport', label: 'Transport' },
  { key: 'accommodation', label: 'Accommodation & rent' },
  { key: 'academic', label: 'Academic materials' },
  { key: 'data', label: 'Data & airtime' },
  { key: 'health', label: 'Health' },
  { key: 'personal', label: 'Personal care' },
  { key: 'savings', label: 'Savings' },
  { key: 'other', label: 'Other' }
];

export function categoryLabel(category: BudgetCategory): string {
  if (category === 'overall') return 'Overall';
  return EXPENSE_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

/** Format integer kobo as a Naira string, e.g. 150000 -> "₦1,500". */
export function formatNaira(kobo: number): string {
  const naira = (Number(kobo) || 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/** Parse a user-typed Naira amount (e.g. "1,500.50") into integer kobo. */
export function parseNairaToKobo(value: string): number {
  const raw = String(value).trim();
  // A leading minus means the user typed a negative amount; treat it as invalid
  // rather than silently dropping the sign and recording a positive value.
  if (raw.startsWith('-')) return 0;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const naira = Number(cleaned);
  if (!Number.isFinite(naira) || naira <= 0) return 0;
  return Math.round(naira * 100);
}

function mapExpense(row: any): Expense {
  return {
    id: row.id,
    category: (row.category as ExpenseCategory) || 'other',
    title: row.title,
    amountKobo: Number(row.amount_kobo) || 0,
    spentOn: row.spent_on,
    notes: row.notes || '',
    createdAt: row.created_at
  };
}

function mapBudget(row: any): Budget {
  return {
    id: row.id,
    period: (row.period as BudgetPeriod) || 'monthly',
    category: (row.category as BudgetCategory) || 'overall',
    limitKobo: Number(row.limit_kobo) || 0
  };
}

function mapSavingsGoal(row: any): SavingsGoal {
  return {
    id: row.id,
    title: row.title,
    targetKobo: Number(row.target_kobo) || 0,
    savedKobo: Number(row.saved_kobo) || 0,
    dueOn: row.due_on ?? null,
    createdAt: row.created_at
  };
}

async function currentUserId(): Promise<string> {
  const client = requireSupabase();
  const { data: { user }, error } = await client.auth.getUser();
  if (error) throw new Error(error.message);
  if (!user) throw new Error('Sign in to use your expense tracker.');
  return user.id;
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export async function fetchExpenses(limit = 500): Promise<Expense[]> {
  const { data, error } = await requireSupabase()
    .from('student_expenses')
    .select('*')
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapExpense);
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const userId = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('student_expenses')
    .insert({
      user_id: userId,
      category: input.category,
      title: input.title.trim(),
      amount_kobo: input.amountKobo,
      spent_on: input.spentOn,
      notes: input.notes?.trim() ?? ''
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapExpense(data);
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.amountKobo !== undefined) row.amount_kobo = patch.amountKobo;
  if (patch.spentOn !== undefined) row.spent_on = patch.spentOn;
  if (patch.notes !== undefined) row.notes = patch.notes.trim();
  const { error } = await requireSupabase().from('student_expenses').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await requireSupabase().from('student_expenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Budgets ──────────────────────────────────────────────────────────────────

export async function fetchBudgets(): Promise<Budget[]> {
  const { data, error } = await requireSupabase()
    .from('student_budgets')
    .select('*')
    .order('period')
    .order('category');
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapBudget);
}

export async function upsertBudget(
  period: BudgetPeriod,
  category: BudgetCategory,
  limitKobo: number
): Promise<void> {
  const userId = await currentUserId();
  const { error } = await requireSupabase()
    .from('student_budgets')
    .upsert(
      { user_id: userId, period, category, limit_kobo: limitKobo },
      { onConflict: 'user_id,period,category' }
    );
  if (error) throw new Error(error.message);
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await requireSupabase().from('student_budgets').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Savings goals ────────────────────────────────────────────────────────────

export async function fetchSavingsGoals(): Promise<SavingsGoal[]> {
  const { data, error } = await requireSupabase()
    .from('student_savings_goals')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapSavingsGoal);
}

export async function createSavingsGoal(input: {
  title: string;
  targetKobo: number;
  savedKobo?: number;
  dueOn?: string | null;
}): Promise<SavingsGoal> {
  const userId = await currentUserId();
  const { data, error } = await requireSupabase()
    .from('student_savings_goals')
    .insert({
      user_id: userId,
      title: input.title.trim(),
      target_kobo: input.targetKobo,
      saved_kobo: input.savedKobo ?? 0,
      due_on: input.dueOn || null
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapSavingsGoal(data);
}

export async function updateSavingsGoal(
  id: string,
  patch: { title?: string; targetKobo?: number; savedKobo?: number; dueOn?: string | null }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.targetKobo !== undefined) row.target_kobo = patch.targetKobo;
  if (patch.savedKobo !== undefined) row.saved_kobo = Math.max(0, patch.savedKobo);
  if (patch.dueOn !== undefined) row.due_on = patch.dueOn || null;
  const { error } = await requireSupabase().from('student_savings_goals').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const { error } = await requireSupabase().from('student_savings_goals').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Derived statistics ───────────────────────────────────────────────────────

export interface SpendSummary {
  totalKobo: number;
  byCategory: { category: ExpenseCategory; totalKobo: number; share: number }[];
  topCategory: ExpenseCategory | null;
}

/** Sum expenses within the last `days` days (inclusive of today). */
export function summarizeSpending(expenses: Expense[], days: number): SpendSummary {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const inRange = expenses.filter((e) => e.spentOn >= cutoffIso);

  const totals = new Map<ExpenseCategory, number>();
  let totalKobo = 0;
  for (const expense of inRange) {
    totalKobo += expense.amountKobo;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amountKobo);
  }
  const byCategory = [...totals.entries()]
    .map(([category, value]) => ({
      category,
      totalKobo: value,
      share: totalKobo === 0 ? 0 : value / totalKobo
    }))
    .sort((a, b) => b.totalKobo - a.totalKobo);

  return {
    totalKobo,
    byCategory,
    topCategory: byCategory[0]?.category ?? null
  };
}

/** Total spending for the current calendar month per category. */
export function monthSpendByCategory(expenses: Expense[], reference = new Date()): Map<ExpenseCategory, number> {
  const prefix = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}`;
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of expenses) {
    if (!expense.spentOn.startsWith(prefix)) continue;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amountKobo);
  }
  return totals;
}

/** Total spending for the current ISO week (Mon–Sun) per category. */
export function weekSpendByCategory(expenses: Expense[], reference = new Date()): Map<ExpenseCategory, number> {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const day = (start.getDay() + 6) % 7; // Monday = 0
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of expenses) {
    const spent = new Date(`${expense.spentOn}T00:00:00`);
    if (spent >= start && spent < end) {
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amountKobo);
    }
  }
  return totals;
}
