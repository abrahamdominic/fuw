import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two-tier subscriptions (Free + Premium only). The live catalogue previously
 * carried five active plans; the product decision collapses them to:
 *
 *   free    — ₦0 (untouched)
 *   premium — ₦1,500 (price untouched) / 120 days (the existing semester
 *             duration, absorbed from plus_semester)
 *
 * The plus_* passes are retired (is_active = false, rows kept) and a CHECK
 * constraint makes it impossible to re-activate them or seed new tiers. These
 * assertions pin the migration contract so the rules cannot drift silently.
 */

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const MIGRATION = '20261019130000_two_tier_subscriptions.sql';
const sql = readFileSync(join(MIGRATIONS, MIGRATION), 'utf8');

/** Slice a single `$$ ... $$` body out of the migration by function name. */
function functionBody(name: string): string {
  const marker = `FUNCTION public.${name}(`;
  const start = sql.indexOf(marker);
  expect(start, `migration must define ${name}`).toBeGreaterThan(-1);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 2, close);
}

describe('two-tier subscription migration', () => {
  it('retires exactly the three Campus Hub Plus passes', () => {
    expect(sql).toMatch(
      /slug IN \('plus_monthly', 'plus_semester', 'plus_session'\)[\s\S]*?is_active = false/
    );
  });

  it('keeps premium at ₦1,500 and extends it to the 120-day semester', () => {
    expect(sql).toMatch(/SET duration_days = 120\s+WHERE slug = 'premium'/);
    // The price must never be rewritten by this migration.
    expect(sql).not.toMatch(/price_kobo\s*=/);
  });

  it('blocks any future non-Free/Premium plan from being active', () => {
    expect(sql).toMatch(/ADD CONSTRAINT plans_only_free_premium_active/);
    expect(sql).toMatch(/CHECK \(is_active = false OR slug IN \('free', 'premium'\)\)/);
  });

  it.each(['has_premium_access', 'my_plan', 'my_premium_source'])(
    '%s resolves entitlements without requiring plan.is_active',
    (name) => {
      const body = functionBody(name);
      expect(body).not.toMatch(/\b(?:p|pl)\.is_active\b/);
      expect(body).not.toMatch(/plans?\s+[\w]+\s+is_active/);
    }
  );

  it.each(['has_premium_access', 'my_plan', 'my_premium_source'])(
    '%s still requires the plan to be premium',
    (name) => {
      expect(functionBody(name)).toMatch(/is_premium/);
    }
  );
});

describe('no client depends on retired tiers', () => {
  const CLIENT_FILES = [
    'src/lib/verification.ts',
    'src/lib/premium.ts',
    'src/lib/payments.ts',
    'src/pages/StudentSubscriptionTab.tsx',
    'src/pages/AdminPlansTab.tsx',
    'src/pages/PaymentsAdminTab.tsx',
    'src/components/PremiumGateModal.tsx',
  ];

  it.each(CLIENT_FILES)('%s never hardcodes a plus_* plan slug', (rel) => {
    const source = readFileSync(join(ROOT, rel), 'utf8');
    expect(source).not.toMatch(/plus_(monthly|semester|session)/);
  });

  it('web and mobile catalogs only offer active plans', () => {
    const web = readFileSync(join(ROOT, 'src/lib/verification.ts'), 'utf8');
    const mobile = readFileSync(
      join(ROOT, '..', 'fuw-elibrary-mobile/src/services/verification.ts'),
      'utf8'
    );
    for (const source of [web, mobile]) {
      const catalog = source.slice(source.indexOf('fetchCatalogPlans'));
      expect(catalog).toMatch(/\.eq\('is_active', true\)/);
    }
  });
});
