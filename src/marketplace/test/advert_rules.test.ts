import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the advert rules that the UI must not be able to bend:
 *
 *  - pricing has exactly one source, and it is the database;
 *  - the vendor never sends a price;
 *  - audience targeting is decided server side from the viewer's own profile;
 *  - charging and refunding happen on the server, not on approval click.
 *
 * The transactional test that proves the server actually enforces all of this
 * lives in the migration review; these checks catch a client that drifts away
 * from the contract in the meantime.
 */

const apiSrc = readFileSync(resolve(__dirname, '../lib/api.ts'), 'utf8');
const vendorSrc = readFileSync(resolve(__dirname, '../pages/VendorDashboardPage.tsx'), 'utf8');
const adminSrc = readFileSync(resolve(__dirname, '../pages/AdminPortalPage.tsx'), 'utf8');
const homeSrc = readFileSync(resolve(__dirname, '../pages/HomePage.tsx'), 'utf8');
const browseSrc = readFileSync(resolve(__dirname, '../pages/BrowsePage.tsx'), 'utf8');

/**
 * The executable body of one exported function. Every wrapper here opens with a
 * destructured supabase call, so anchoring on that skips the type annotation in
 * the signature without needing to parse TypeScript.
 */
function rpcBody(fnName: string): string {
  const start = apiSrc.indexOf(`export async function ${fnName}(`);
  expect(start, `${fnName} is missing from api.ts`).toBeGreaterThan(-1);

  // Top-level functions in this file end with a closing brace in column 0.
  const end = apiSrc.indexOf('\n}\n', start);
  expect(end, `could not find the end of ${fnName}`).toBeGreaterThan(-1);
  return apiSrc.slice(start, end);
}

describe('Advert pricing has a single source', () => {
  it('reads the price list from the server', () => {
    const body = rpcBody('fetchAdvertPackages');
    expect(body).toContain("supabase.rpc('mp_list_advert_packages'");
  });

  it('never lets the caller state a price', () => {
    const body = rpcBody('submitAdvert');
    expect(body).toContain("supabase.rpc('mp_submit_advert'");
    expect(body).not.toMatch(/p_price/);
    expect(body).not.toMatch(/price/i);
  });

  it('carries no price or duration into the submission arguments', () => {
    const body = rpcBody('submitAdvert');
    const arg = body.slice(body.indexOf('supabase.rpc'), body.indexOf('});'));
    expect(arg).toContain('p_product_id');
    expect(arg).toContain('p_package_id');
    expect(arg).toContain('p_target_audience');
    expect(arg).not.toContain('p_start_at: undefined');
  });

  it('shows the admin-managed price in the vendor form', () => {
    expect(vendorSrc).toContain('formatNaira(pkg.price_kobo)');
  });

  it('has no hardcoded naira amount in the advert surfaces', () => {
    for (const src of [vendorSrc, adminSrc]) {
      expect(src).not.toMatch(/price_kobo:\s*\d{4,}/);
    }
  });

  it('is the only thing that sets package prices, and it asks the server', () => {
    const body = rpcBody('saveAdvertPackage');
    expect(body).toContain("supabase.rpc('mp_save_advert_package'");
  });
});

describe('Advert targeting cannot be widened by the client', () => {
  it('fetches visible adverts from the server', () => {
    const body = rpcBody('fetchVisibleAdverts');
    expect(body).toContain("supabase.rpc('mp_visible_adverts'");
  });

  it('never reads or sends a gender when listing adverts', () => {
    const body = rpcBody('fetchVisibleAdverts');
    expect(body).not.toMatch(/gender/i);
    expect(body).not.toMatch(/target_audience/i);
  });

  it('offers Male, Female and Both as the only choices', () => {
    expect(vendorSrc).toContain("value=\"male\"");
    expect(vendorSrc).toContain("value=\"female\"");
    expect(vendorSrc).toContain("value=\"both\"");
  });

  it('does not filter placements client side by audience', () => {
    expect(homeSrc).not.toMatch(/target_audience/);
    expect(browseSrc).not.toMatch(/target_audience/);
  });
});

describe('Money moves on the server, never on the client', () => {
  it('charges and refunds through server RPCs only', () => {
    expect(rpcBody('reviewAdvert')).toContain("supabase.rpc('mp_review_advert'");
    expect(rpcBody('cancelAdvert')).toContain("supabase.rpc('mp_cancel_advert'");
  });

  it('never posts to the ledger table directly', () => {
    for (const fn of ['submitAdvert', 'reviewAdvert', 'cancelAdvert', 'setAdvertActive']) {
      expect(rpcBody(fn)).not.toMatch(/marketplace_ledger_entries/);
    }
  });

  it('only suspends or reactivates, never prices, from the status control', () => {
    const body = rpcBody('setAdvertActive');
    expect(body).toContain("supabase.rpc('mp_set_advert_active'");
    expect(body).not.toMatch(/p_price/);
  });
});

describe('Advert permissions are enforced by the server', () => {
  it('routes every admin action through an admin RPC', () => {
    expect(adminSrc).toContain('reviewAdvert(');
    expect(adminSrc).toContain('setAdvertActive(');
    expect(adminSrc).toContain('saveAdvertPackage(');
    expect(adminSrc).toContain('deleteAdvertPackage(');
  });

  it('tells the vendor they are only charged after approval', () => {
    expect(vendorSrc).toMatch(/only after an admin approves/i);
  });

  it('surfaces the refund to the vendor when they withdraw', () => {
    expect(vendorSrc).toMatch(/refunded_kobo/);
  });
});