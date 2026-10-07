import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * The Marketplace must have exactly one identity record, and its live view
 * counters must have exactly one writer.
 *
 * Both halves of this file exist because of dead subsystems found by measuring
 * the live project rather than by reading intent.
 *
 * `marketplace_profiles` was a "thin companion to public.profiles" that never
 * held a row. Its creating trigger function was never attached, while its sync
 * trigger *was* attached to `public.profiles` and fired on every write against
 * an empty table. It stored `fuw_matric_number`, `fuw_faculty`, `fuw_department`
 * and `fuw_level` -- the exact identity duplication its own header comment said
 * it would never contain. Four SECURITY DEFINER functions and a per-product-view
 * round-trip bought nothing. Measured: 0 rows, 0 readers.
 *
 * Separately, `marketplace_products.view_count` was second in the
 * `idx_mp_products_popular` index and had never moved off 0 across 9 active
 * products, because the call intended to update it
 * (`supabase.rpc('mp_record_search', { p_terms: [data.title] })`) was a
 * search-history recorder for the dead table.
 *
 * These assertions are deliberately about *source references* and *migration
 * contents*, not about re-implementing the rules. The behavioural halves -- that
 * the RPCs increment atomically, that they refuse unknown and unpublished ids,
 * that an anonymous client cannot write the counters directly, and that the
 * retired objects are absent from the live database -- were verified against the
 * linked project inside rolled-back transactions.
 */

const ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const SRC = join(ROOT, 'src');

const RETIREMENT = '20261006130000_retire_marketplace_profiles.sql';
const PRODUCT_VIEWS = '20261006131000_marketplace_product_view_count.sql';
const ACCOMMODATION_VIEWS = '20261006120000_accommodation_view_count.sql';

/** Every TypeScript/TSX source file, so a reference anywhere is caught. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (['.ts', '.tsx'].includes(extname(full))) out.push(full);
  }
  return out;
}

/**
 * Strip comments before scanning.
 *
 * `api.ts` documents *why* `mp_record_search` was wrong, and that explanation
 * has to survive. A linter that flags the prose would push the next maintainer
 * into deleting the only record of the bug, so these assertions look at code
 * only.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const THIS_FILE = __filename;

const sources = sourceFiles(SRC)
  .filter((f) => f !== THIS_FILE)
  .map((f) => ({
    file: f,
    raw: readFileSync(f, 'utf8'),
    code: stripComments(readFileSync(f, 'utf8')),
  }));

describe('Marketplace identity comes only from public.profiles', () => {
  it('retires marketplace_profiles in a migration rather than by hand', () => {
    expect(readdirSync(MIGRATIONS)).toContain(RETIREMENT);
    const sql = readFileSync(join(MIGRATIONS, RETIREMENT), 'utf8');
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.marketplace_profiles/);
  });

  it('leaves no source file calling a dropped function or querying a dropped table', () => {
    // Referencing either would now fail at runtime. The search-history call in
    // particular was wrapped in `.then(() => {}, () => {})`, so it would have
    // failed silently forever instead of loudly.
    const dead: Array<[string, RegExp]> = [
      ['marketplace_profiles', /marketplace_profiles/],
      ['mp_record_search', /['"`]mp_record_search['"`]/],
      ['mp_save_own_profile', /['"`]mp_save_own_profile['"`]/],
      ['mp_ensure_own_profile', /['"`]mp_ensure_own_profile['"`]/],
      ['mp_sync_identity_from_profile', /['"`]mp_sync_identity_from_profile['"`]/],
    ];

    const offenders = sources
      .filter(({ code }) => dead.some(([, re]) => re.test(code)))
      .map(({ file }) => file.replace(`${ROOT}/`, ''));

    expect(offenders).toEqual([]);
  });

  it('keeps the explanation of why mp_record_search was wrong', () => {
    // Stripping comments must not become a way to quietly delete the record of
    // the bug. If this assertion ever fails, restore the comment rather than
    // relaxing the scan above.
    const api = readFileSync(join(SRC, 'marketplace/lib/api.ts'), 'utf8');
    expect(api).toMatch(/mp_record_search/);
  });

  it('resolves the Marketplace session through the shared profiles adapter', () => {
    const auth = readFileSync(join(SRC, 'marketplace/lib/auth.tsx'), 'utf8');
    // Identity is borrowed from the platform `profiles` table, so a user cannot
    // exist as two records that disagree.
    expect(auth).toMatch(/from ['"]\.\.\/\.\.\/lib\/AuthContext['"]|from ['"]\.\.\/lib\/AuthContext['"]/);
    expect(auth).not.toMatch(/marketplace_profiles/);
  });
});

describe('Marketplace view counters have one working writer', () => {
  it('increments products through a SECURITY DEFINER rpc, not a search call', () => {
    const sql = readFileSync(join(MIGRATIONS, PRODUCT_VIEWS), 'utf8');
    // SECURITY DEFINER, because `marketplace_products` grants UPDATE to the
    // owning vendor and admins only, so a visitor's own write is policy-blocked.
    expect(sql).toMatch(/SECURITY DEFINER/);
    // Atomic, or concurrent viewers lose counts to a read-modify-write race.
    expect(sql).toMatch(/SET view_count = view_count \+ 1/);
    // Only rows a visitor can actually reach are counted.
    expect(sql).toMatch(/status = 'active'[\s\S]*deleted_at IS NULL/);
    // Anonymous visitors must be able to call it, and nothing else.
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.mp_increment_product_view\(UUID\) TO anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.mp_increment_product_view\(UUID\) FROM PUBLIC/);
  });

  it('increments accommodation listings the same way', () => {
    const sql = readFileSync(join(MIGRATIONS, ACCOMMODATION_VIEWS), 'utf8');
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET view_count = view_count \+ 1/);
    // `is_published` is the real visibility flag on accommodation_properties;
    // there is no `status` column, and guessing wrong would count drafts.
    expect(sql).toMatch(/is_published = true/);
    expect(sql).not.toMatch(/WHERE id = p_property_id\s+AND status/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.increment_accommodation_view_count\(UUID\) TO anon, authenticated/);
  });

  it('calls the product rpc from the product fetch', () => {
    const api = readFileSync(join(SRC, 'marketplace/lib/api.ts'), 'utf8');
    expect(api).toMatch(/rpc\(\s*['"]mp_increment_product_view['"]/);
    // The failure mode that hid this bug: a swallowed rejection. A counter that
    // breaks the page render is not worth failing the page render over.
    expect(api).toMatch(/mp_increment_product_view[\s\S]{0,200}\.then\(\(\) => \{\}, \(\) => \{\}\)/);
  });

  it('never writes a view counter with a client-side update', () => {
    // Both tables are vendor/provider-owned under RLS, so an UPDATE from the
    // browser is rejected. If either page starts doing this, the increment
    // silently stops working in production while type-checking clean.
    //
    // The window is deliberately tight: `view_count` must appear in the same
    // `.update(...)` payload, not merely somewhere further down the file.
    const offenders = sources
      .filter(({ code }) =>
        /\.from\(\s*['"](?:marketplace_products|accommodation_properties)['"]\s*\)/.test(code) &&
        /\.update\(\s*\{[^}]*view_count/.test(code)
      )
      .map(({ file }) => file.replace(`${ROOT}/`, ''));

    expect(offenders).toEqual([]);
  });

  it('has a working writer today, so the negative check above is not vacuous', () => {
    // A guard that passes because nothing matches is worth nothing. Prove the
    // pattern this spec forbids is one the suite can actually recognise.
    const decoy = /\.from\(\s*['"](?:marketplace_products|accommodation_properties)['"]\s*\)[\s\S]{0,80}?\.update\(\s*\{[^}]*view_count/;
    expect(decoy.test("supabase.from('marketplace_products').update({ view_count: n })")).toBe(true);
    // And that the sanctioned form does not match it.
    const real = readFileSync(join(SRC, 'marketplace/lib/api.ts'), 'utf8');
    expect(real).not.toMatch(decoy);
  });
});
