-- =============================================================================
-- STUDENT EXPENSE TRACKER & BUDGET PLANNER  (Feature D)
--
-- Private, per-student budgeting notes. These rows are manual records a student
-- types in themselves. They are NOT financial transactions, are NOT tied to the
-- campus wallet ledger, and are never represented as real money movement.
--
-- SECURITY
--   * RLS on every table: a row is only ever visible to (and writable by) its
--     owning account (`user_id = auth.uid()`). Admins have NO read access — a
--     student's spending is nobody's business but their own.
--   * `anon` is revoked; only `authenticated` is granted DML (RLS is the bound).
--   * Money is stored as integer kobo (never floats).
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.student_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('food','transport','accommodation','academic','data','health','personal','savings','other')),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0 AND amount_kobo <= 100000000000),
  spent_on date NOT NULL DEFAULT CURRENT_DATE,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('weekly','monthly')),
  category text NOT NULL DEFAULT 'overall'
    CHECK (category IN ('overall','food','transport','accommodation','academic','data','health','personal','savings','other')),
  limit_kobo bigint NOT NULL CHECK (limit_kobo > 0 AND limit_kobo <= 100000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, category)
);

CREATE TABLE IF NOT EXISTS public.student_savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  target_kobo bigint NOT NULL CHECK (target_kobo > 0 AND target_kobo <= 100000000000),
  saved_kobo bigint NOT NULL DEFAULT 0 CHECK (saved_kobo >= 0 AND saved_kobo <= 100000000000),
  due_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_expenses_user_date
  ON public.student_expenses (user_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_student_budgets_user
  ON public.student_budgets (user_id);
CREATE INDEX IF NOT EXISTS idx_student_savings_goals_user
  ON public.student_savings_goals (user_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.student_expenses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_expenses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.student_budgets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_budgets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON public.student_savings_goals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.student_savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.student_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_savings_goals ENABLE ROW LEVEL SECURITY;

-- ── RLS: owner-only for each of the three tables ─────────────────────────────
DROP POLICY IF EXISTS student_expenses_select_own ON public.student_expenses;
CREATE POLICY student_expenses_select_own ON public.student_expenses
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS student_expenses_insert_own ON public.student_expenses;
CREATE POLICY student_expenses_insert_own ON public.student_expenses
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS student_expenses_update_own ON public.student_expenses;
CREATE POLICY student_expenses_update_own ON public.student_expenses
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS student_expenses_delete_own ON public.student_expenses;
CREATE POLICY student_expenses_delete_own ON public.student_expenses
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS student_budgets_select_own ON public.student_budgets;
CREATE POLICY student_budgets_select_own ON public.student_budgets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS student_budgets_insert_own ON public.student_budgets;
CREATE POLICY student_budgets_insert_own ON public.student_budgets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS student_budgets_update_own ON public.student_budgets;
CREATE POLICY student_budgets_update_own ON public.student_budgets
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS student_budgets_delete_own ON public.student_budgets;
CREATE POLICY student_budgets_delete_own ON public.student_budgets
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS student_savings_goals_select_own ON public.student_savings_goals;
CREATE POLICY student_savings_goals_select_own ON public.student_savings_goals
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS student_savings_goals_insert_own ON public.student_savings_goals;
CREATE POLICY student_savings_goals_insert_own ON public.student_savings_goals
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS student_savings_goals_update_own ON public.student_savings_goals;
CREATE POLICY student_savings_goals_update_own ON public.student_savings_goals
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS student_savings_goals_delete_own ON public.student_savings_goals;
CREATE POLICY student_savings_goals_delete_own ON public.student_savings_goals
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── Grants ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_budgets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_savings_goals TO authenticated;
REVOKE ALL ON public.student_expenses FROM anon;
REVOKE ALL ON public.student_budgets FROM anon;
REVOKE ALL ON public.student_savings_goals FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
