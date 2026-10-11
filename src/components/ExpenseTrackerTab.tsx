import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Loader2,
  PiggyBank,
  Plus,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { useToast } from './Toast';
import { ConfirmDialog, PromptDialog } from './ConfirmDialog';
import {
  Budget,
  BudgetPeriod,
  BudgetCategory,
  EXPENSE_CATEGORIES,
  Expense,
  ExpenseCategory,
  SavingsGoal,
  categoryLabel,
  createExpense,
  createSavingsGoal,
  deleteBudget,
  deleteExpense,
  deleteSavingsGoal,
  fetchBudgets,
  fetchExpenses,
  fetchSavingsGoals,
  formatNaira,
  monthSpendByCategory,
  parseNairaToKobo,
  summarizeSpending,
  updateSavingsGoal,
  upsertBudget,
  weekSpendByCategory
} from '../lib/expenses';

type View = 'overview' | 'expenses' | 'budgets' | 'savings';

const VIEWS: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'savings', label: 'Savings' }
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not complete that request.';
}

export function ExpenseTrackerTab() {
  const { toast } = useToast();
  const [view, setView] = useState<View>('overview');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Expense form
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('food');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [expenseNotes, setExpenseNotes] = useState('');

  // Savings form
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDue, setGoalDue] = useState('');

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({ open: false, title: '', message: '', action: async () => {} });

  const [contributeGoal, setContributeGoal] = useState<SavingsGoal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseRows, budgetRows, goalRows] = await Promise.all([
        fetchExpenses(),
        fetchBudgets(),
        fetchSavingsGoals()
      ]);
      setExpenses(expenseRows);
      setBudgets(budgetRows);
      setGoals(goalRows);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const monthSummary = useMemo(() => summarizeSpending(expenses, 31), [expenses]);
  const monthByCategory = useMemo(() => monthSpendByCategory(expenses), [expenses]);
  const weekByCategory = useMemo(() => weekSpendByCategory(expenses), [expenses]);

  const savingsTotal = goals.reduce((sum, goal) => sum + goal.savedKobo, 0);
  const overallMonthly = budgets.find((b) => b.period === 'monthly' && b.category === 'overall');
  const overallWeekly = budgets.find((b) => b.period === 'weekly' && b.category === 'overall');
  const monthTotal = monthSummary.totalKobo;

  const submitExpense = async () => {
    const amountKobo = parseNairaToKobo(expenseAmount);
    if (!expenseTitle.trim()) {
      toast('Give the expense a short title.', 'error');
      return;
    }
    if (amountKobo <= 0) {
      toast('Enter an amount greater than zero.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await createExpense({
        title: expenseTitle,
        amountKobo,
        category: expenseCategory,
        spentOn: expenseDate || todayIso(),
        notes: expenseNotes
      });
      setExpenses((prev) => [created, ...prev]);
      setExpenseTitle('');
      setExpenseAmount('');
      setExpenseNotes('');
      toast('Expense added.', 'success');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveBudget = async (period: BudgetPeriod, category: BudgetCategory, raw: string) => {
    const limitKobo = parseNairaToKobo(raw);
    if (limitKobo <= 0) {
      toast('Enter a budget amount greater than zero.', 'error');
      return;
    }
    setBusy(true);
    try {
      await upsertBudget(period, category, limitKobo);
      setBudgets((prev) => {
        const next = prev.filter((b) => !(b.period === period && b.category === category));
        return [...next, {
          id: `local-${period}-${category}`,
          period,
          category,
          limitKobo
        }];
      });
      toast('Budget saved.', 'success');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeBudget = (budget: Budget) => {
    setConfirmState({
      open: true,
      title: 'Remove this budget?',
      message: `The ${categoryLabel(budget.category)} ${budget.period} budget will be removed. Your expenses are not affected.`,
      action: async () => {
        try {
          await deleteBudget(budget.id);
          setBudgets((prev) => prev.filter((b) => b.id !== budget.id));
          toast('Budget removed.', 'info');
        } catch (cause) {
          toast(errorText(cause), 'error');
        }
      }
    });
  };

  const removeExpense = (expense: Expense) => {
    setConfirmState({
      open: true,
      title: 'Delete this expense?',
      message: `"${expense.title}" will be permanently removed.`,
      action: async () => {
        try {
          await deleteExpense(expense.id);
          setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
          toast('Expense deleted.', 'info');
        } catch (cause) {
          toast(errorText(cause), 'error');
        }
      }
    });
  };

  const addGoal = async () => {
    const targetKobo = parseNairaToKobo(goalTarget);
    if (!goalTitle.trim() || targetKobo <= 0) {
      toast('Add a goal name and a target amount.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await createSavingsGoal({
        title: goalTitle,
        targetKobo,
        dueOn: goalDue || null
      });
      setGoals((prev) => [created, ...prev]);
      setGoalTitle('');
      setGoalTarget('');
      setGoalDue('');
      toast('Savings goal created.', 'success');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const contribute = (goal: SavingsGoal) => {
    setContributeGoal(goal);
  };

  const submitContribution = async (value: string) => {
    if (!contributeGoal) return;
    const amountKobo = parseNairaToKobo(value);
    if (amountKobo <= 0) {
      toast('Enter a valid amount.', 'error');
      return;
    }
    const goal = contributeGoal;
    setBusy(true);
    try {
      const next = Math.min(goal.targetKobo, goal.savedKobo + amountKobo);
      await updateSavingsGoal(goal.id, { savedKobo: next });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, savedKobo: next } : g)));
      toast('Savings updated.', 'success');
    } catch (cause) {
      toast(errorText(cause), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeGoal = (goal: SavingsGoal) => {
    setConfirmState({
      open: true,
      title: 'Delete this goal?',
      message: `"${goal.title}" and its saved progress will be removed.`,
      action: async () => {
        try {
          await deleteSavingsGoal(goal.id);
          setGoals((prev) => prev.filter((g) => g.id !== goal.id));
          toast('Goal removed.', 'info');
        } catch (cause) {
          toast(errorText(cause), 'error');
        }
      }
    });
  };

  const progressBar = (spent: number, limit: number) => {
    const pct = limit <= 0 ? 0 : Math.min(100, Math.round((spent / limit) * 100));
    const over = spent > limit;
    return (
      <div className="budget-progress" aria-hidden="true">
        <div
          className={`budget-progress-fill ${over ? 'is-over' : pct > 80 ? 'is-warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  };

  return (
    <div className="portal-view-fade platform-shell">
      <header className="platform-header">
        <div>
          <p className="kicker">MONEY · PRIVATE TO YOU</p>
          <h2>Expense tracker &amp; budget planner</h2>
          <p className="subtitle">
            Track what you spend, set weekly and monthly budgets, and grow your savings. These are
            your personal notes — they are not wallet transactions and never move real money.
          </p>
        </div>
      </header>

      <div className="segmented-pills" role="tablist" aria-label="Expense tracker sections">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`segmented-pill ${view === item.key ? 'active' : ''}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="inline-notice is-error" role="alert">{error}</p>}

      {loading ? (
        <div className="portal-empty" role="status"><Loader2 className="empty-icon" /> Loading your finances…</div>
      ) : (
        <>
          {view === 'overview' && (
            <>
              <div className="portal-stats">
                <section><Wallet /><b>{formatNaira(monthTotal)}</b><span>Spent in last 31 days</span></section>
                <section><TrendingDown /><b>{overallMonthly ? formatNaira(Math.max(0, overallMonthly.limitKobo - monthTotal)) : '—'}</b><span>Monthly budget left</span></section>
                <section><PiggyBank /><b>{formatNaira(savingsTotal)}</b><span>Saved toward goals</span></section>
                <section><TrendingUp /><b>{monthSummary.byCategory.length}</b><span>Active categories</span></section>
              </div>

              <section className="platform-card">
                <div className="platform-card-head">
                  <div><h3>Where your money goes</h3><p className="platform-help">Last 31 days by category.</p></div>
                </div>
                {monthSummary.byCategory.length === 0 ? (
                  <div className="portal-empty"><p>No expenses logged yet. Add your first one in the Expenses tab.</p></div>
                ) : (
                  <div className="platform-list">
                    {monthSummary.byCategory.map((row) => (
                      <div className="budget-row" key={row.category}>
                        <div className="budget-row-head">
                          <strong>{categoryLabel(row.category)}</strong>
                          <span>{formatNaira(row.totalKobo)} · {Math.round(row.share * 100)}%</span>
                        </div>
                        <div className="budget-progress" aria-hidden="true">
                          <div className="budget-progress-fill" style={{ width: `${Math.round(row.share * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {monthSummary.topCategory && (
                <p className="platform-help">
                  Tip: {categoryLabel(monthSummary.topCategory)} is your largest category. Setting a dedicated
                  budget for it below can help you trim it next month.
                </p>
              )}
            </>
          )}

          {view === 'expenses' && (
            <>
              <section className="platform-card">
                <div className="platform-card-head"><div><h3>Log an expense</h3></div></div>
                <div className="platform-form-grid">
                  <label className="platform-field">
                    <span>Title *</span>
                    <input value={expenseTitle} onChange={(e) => setExpenseTitle(e.target.value)} maxLength={120} placeholder="e.g. Lunch at the cafeteria" />
                  </label>
                  <label className="platform-field">
                    <span>Amount (₦) *</span>
                    <input value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 1500" />
                  </label>
                  <label className="platform-field">
                    <span>Category</span>
                    <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value as ExpenseCategory)}>
                      {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="platform-field">
                    <span>Date</span>
                    <input type="date" value={expenseDate} max={todayIso()} onChange={(e) => setExpenseDate(e.target.value)} />
                  </label>
                  <label className="platform-field platform-field-wide">
                    <span>Notes (optional)</span>
                    <input value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} maxLength={240} />
                  </label>
                </div>
                <div className="platform-form-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => void submitExpense()}>
                    {busy ? <Loader2 size={15} /> : <Plus size={15} />} Add expense
                  </button>
                </div>
              </section>

              <section className="platform-card">
                <div className="platform-card-head"><div><h3>Recent expenses</h3><p className="platform-help">{expenses.length} recorded</p></div></div>
                {expenses.length === 0 ? (
                  <div className="portal-empty"><p>Nothing logged yet.</p></div>
                ) : (
                  <div className="platform-list">
                    {expenses.slice(0, 60).map((expense) => (
                      <article className="platform-list-item" key={expense.id}>
                        <div className="platform-course-copy">
                          <strong>{expense.title}</strong>
                          <small>{categoryLabel(expense.category)} · {new Date(`${expense.spentOn}T00:00:00`).toLocaleDateString()}{expense.notes ? ` · ${expense.notes}` : ''}</small>
                        </div>
                        <div className="platform-list-meta">
                          <b>{formatNaira(expense.amountKobo)}</b>
                          <button type="button" className="planner-icon-btn danger" aria-label={`Delete ${expense.title}`} onClick={() => removeExpense(expense)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {view === 'budgets' && (
            <>
              <BudgetsView
                title="Monthly budgets"
                period="monthly"
                budgets={budgets}
                spendByCategory={monthByCategory}
                overall={overallMonthly}
                busy={busy}
                onSave={saveBudget}
                onRemove={removeBudget}
                progressBar={progressBar}
              />
              <BudgetsView
                title="Weekly budgets"
                period="weekly"
                budgets={budgets}
                spendByCategory={weekByCategory}
                overall={overallWeekly}
                busy={busy}
                onSave={saveBudget}
                onRemove={removeBudget}
                progressBar={progressBar}
              />
            </>
          )}

          {view === 'savings' && (
            <>
              <section className="platform-card">
                <div className="platform-card-head"><div><h3>New savings goal</h3><p className="platform-help">Set a target and track your progress manually.</p></div></div>
                <div className="platform-form-grid">
                  <label className="platform-field">
                    <span>Goal name *</span>
                    <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} maxLength={120} placeholder="e.g. Next semester rent" />
                  </label>
                  <label className="platform-field">
                    <span>Target (₦) *</span>
                    <input value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} inputMode="decimal" placeholder="e.g. 60000" />
                  </label>
                  <label className="platform-field">
                    <span>Target date (optional)</span>
                    <input type="date" value={goalDue} onChange={(e) => setGoalDue(e.target.value)} />
                  </label>
                </div>
                <div className="platform-form-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => void addGoal()}>
                    {busy ? <Loader2 size={15} /> : <Target size={15} />} Create goal
                  </button>
                </div>
              </section>

              <section className="platform-card">
                <div className="platform-card-head"><div><h3>Your goals</h3></div></div>
                {goals.length === 0 ? (
                  <div className="portal-empty"><p>No savings goals yet.</p></div>
                ) : (
                  <div className="platform-list">
                    {goals.map((goal) => {
                      const pct = goal.targetKobo <= 0 ? 0 : Math.min(100, Math.round((goal.savedKobo / goal.targetKobo) * 100));
                      return (
                        <div className="budget-row" key={goal.id}>
                          <div className="budget-row-head">
                            <strong>{goal.title}</strong>
                            <span>{formatNaira(goal.savedKobo)} of {formatNaira(goal.targetKobo)}</span>
                          </div>
                          <div className="budget-progress" aria-hidden="true">
                            <div className="budget-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="platform-list-meta" style={{ marginTop: 8 }}>
                            <span className="status-badge">{pct}% funded</span>
                            {goal.dueOn && <span className="platform-help">due {new Date(`${goal.dueOn}T00:00:00`).toLocaleDateString()}</span>}
                            <button type="button" className="secondary-btn" disabled={busy} onClick={() => void contribute(goal)}>Add savings</button>
                            <button type="button" className="planner-icon-btn danger" aria-label={`Delete ${goal.title}`} onClick={() => removeGoal(goal)}><Trash2 size={15} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      <p className="platform-disclaimer">
        <AlertCircle size={13} /> Estimated amounts only. This tracker does not read your bank, card, or
        Campus Wallet balance and cannot move money.
      </p>

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={() => confirmState.action()}
        onClose={() => setConfirmState((s) => ({ ...s, open: false }))}
      />

      <PromptDialog
        open={contributeGoal !== null}
        title="Add to savings"
        message={contributeGoal ? `How much are you adding to "${contributeGoal.title}"? (₦)` : ''}
        placeholder="e.g. 5000"
        confirmLabel="Add savings"
        onSubmit={submitContribution}
        onClose={() => setContributeGoal(null)}
      />
    </div>
  );
}

function BudgetsView({
  title,
  period,
  budgets,
  spendByCategory,
  overall,
  busy,
  onSave,
  onRemove,
  progressBar
}: {
  title: string;
  period: BudgetPeriod;
  budgets: Budget[];
  spendByCategory: Map<ExpenseCategory, number>;
  overall?: Budget;
  busy: boolean;
  onSave: (period: BudgetPeriod, category: BudgetCategory, raw: string) => Promise<void>;
  onRemove: (budget: Budget) => void;
  progressBar: (spent: number, limit: number) => ReactNode;
}) {
  const [overallInput, setOverallInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<ExpenseCategory>('food');
  const [categoryAmount, setCategoryAmount] = useState('');

  const periodBudgets = budgets.filter((b) => b.period === period);
  const totalSpent = [...spendByCategory.values()].reduce((sum, value) => sum + value, 0);

  return (
    <section className="platform-card">
      <div className="platform-card-head">
        <div><h3>{title}</h3><p className="platform-help">Set an overall cap and optional per-category caps.</p></div>
      </div>

      {overall && (
        <div className="budget-row">
          <div className="budget-row-head">
            <strong>Overall</strong>
            <span>{formatNaira(totalSpent)} of {formatNaira(overall.limitKobo)}</span>
          </div>
          {progressBar(totalSpent, overall.limitKobo)}
          <div className="platform-list-meta" style={{ marginTop: 8 }}>
            <button type="button" className="planner-icon-btn danger" aria-label="Remove overall budget" onClick={() => onRemove(overall)}><Trash2 size={15} /></button>
          </div>
        </div>
      )}

      {periodBudgets.filter((b) => b.category !== 'overall').map((budget) => {
        const spent = spendByCategory.get(budget.category as ExpenseCategory) ?? 0;
        return (
          <div className="budget-row" key={budget.id}>
            <div className="budget-row-head">
              <strong>{categoryLabel(budget.category)}</strong>
              <span>{formatNaira(spent)} of {formatNaira(budget.limitKobo)}</span>
            </div>
            {progressBar(spent, budget.limitKobo)}
            <div className="platform-list-meta" style={{ marginTop: 8 }}>
              <button type="button" className="planner-icon-btn danger" aria-label={`Remove ${budget.category} budget`} onClick={() => onRemove(budget)}><Trash2 size={15} /></button>
            </div>
          </div>
        );
      })}

      <div className="platform-form-grid" style={{ marginTop: 12 }}>
        <label className="platform-field">
          <span>Overall {period} cap (₦)</span>
          <input value={overallInput} onChange={(e) => setOverallInput(e.target.value)} inputMode="decimal" placeholder="e.g. 40000" />
        </label>
        <div className="platform-field" style={{ alignSelf: 'end' }}>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => void onSave(period, 'overall', overallInput)}>Save overall</button>
        </div>
        <label className="platform-field">
          <span>Category</span>
          <select value={categoryInput} onChange={(e) => setCategoryInput(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="platform-field">
          <span>Category cap (₦)</span>
          <input value={categoryAmount} onChange={(e) => setCategoryAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 12000" />
        </label>
        <div className="platform-field" style={{ alignSelf: 'end' }}>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => void onSave(period, categoryInput, categoryAmount)}>Save category</button>
        </div>
      </div>
    </section>
  );
}
