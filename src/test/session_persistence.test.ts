import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Strip comments from source, leaving code and string literals intact.
 *
 * Needed because both documents must *name* the claim they are retracting in
 * order to retract it. Scanning raw text would flag the retraction as if it
 * were still an assertion.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ');
}

/**
 * The auth session is persisted to `localStorage`. That is deliberate, and it
 * is load-bearing.
 *
 * The defect this guards against was a documentation lie, not a code bug. The
 * client has always been configured with `storage: window.localStorage`, but
 * both `src/lib/supabase.ts` and `RUNBOOK_DEPLOYMENTS.md` described the session
 * as held "in memory only (FL-1 hardening)" and "never persisted to
 * localStorage/sessionStorage", so that "a script-injection bug cannot
 * exfiltrate a stored refresh token". Anyone reasoning about an XSS incident
 * from those documents would have concluded there was no persisted refresh token
 * to revoke.
 *
 * The behaviour cannot change to match the old prose, because `must.md` requires
 * the opposite: under "Session requirements", "Refreshing the page does not
 * unnecessarily log the user out", exercised as
 * "Create account -> Login -> Refresh -> Navigate -> E Library -> Marketplace ->
 * Accommodation -> Logout -> Login again". An in-memory-only store signs the user
 * out on every refresh, failing that requirement by construction. A static
 * Netlify SPA calling edge functions has no server to set an httpOnly cookie, so
 * the session has to be readable by the page.
 *
 * These assertions keep three things in agreement: the client configuration, the
 * code comment, and the operator-facing runbook. The compensating control for a
 * JS-readable token -- a strict CSP that stops injected script from executing --
 * is asserted here too, because it is the reason this trade-off is acceptable.
 */

const SRC = join(__dirname, '..');
const REPO = join(__dirname, '..', '..');
const CLIENT = readFileSync(join(SRC, 'lib/supabase.ts'), 'utf8');
const RUNBOOK = readFileSync(join(REPO, 'RUNBOOK_DEPLOYMENTS.md'), 'utf8');
const NETLIFY = readFileSync(join(REPO, 'netlify.toml'), 'utf8');
const BOOTSTRAP = readFileSync(join(SRC, 'main.tsx'), 'utf8');

describe('Auth session persistence is configured and honestly documented', () => {
  it('persists the session to localStorage', () => {
    expect(CLIENT).toMatch(/persistSession:\s*true/);
    expect(CLIENT).toMatch(/storage:\s*typeof window !== 'undefined' \? window\.localStorage : memoryStorage/);
    // If this stops being true, the refresh requirement fails and the docs
    // above need to change with it.
    expect(CLIENT).toMatch(/storageKey:\s*'fuw-auth-token'/);
  });

  it('keeps a no-window fallback for server render and prerender', () => {
    expect(CLIENT).toMatch(/export const memoryStorage = \{/);
    expect(CLIENT).toMatch(/isServer:\s*false/);
  });

  it('shares one storage key with the splash bootstrap', () => {
    // `hasStoredSupabaseSession` decides between the welcome screen and the
    // splash by looking for this key in localStorage. A divergence here shows
    // the splash on every reload, which is the visible symptom of a storage
    // change going unnoticed.
    expect(BOOTSTRAP).toMatch(/localStorage\.getItem\('fuw-auth-token'\)/);
    // Still tolerant of sessions written before the key was customised.
    expect(BOOTSTRAP).toMatch(/\^sb-\.\*-auth-token\$/);
  });

  it('creates exactly one client for the whole platform', () => {
    // A second client on the same storage key races the first one to refresh
    // the token and can sign the user out mid-navigation. The Marketplace
    // module *documents* `createClient` in prose to explain why it must not call
    // it, so the assertion is that it never actually invokes the factory.
    const marketplace = readFileSync(join(SRC, 'marketplace/lib/supabase.ts'), 'utf8');
    expect(marketplace).toMatch(/import \{ requireSupabase \} from '\.\.\/\.\.\/lib\/supabase'/);
    const code = stripComments(marketplace);
    expect(code, 'Marketplace must not construct a second client').not.toMatch(/createClient/);
    expect(code).toMatch(/requireSupabase\(\)/);
  });

  it('does not assert an in-memory-only guarantee anywhere', () => {
    // The exact assertions that were false before. Only claims of *present
    // behaviour* are forbidden: the corrected docs have to name the old claim in
    // order to retract it, so the scan is for unretracted assertions -- prose
    // that states or implies the guarantee still holds.
    const UNRETRACTED = [
      // "we hold the session ONLY in JS memory", "tokens are never written to"
      /\bhold the session\b[\s\S]{0,80}?\bonly\b[\s\S]{0,40}?memor/i,
      /\bnever (?:written to|persisted to|stored in)\s+(?:localStorage|sessionStorage)/i,
      /\bthe session does not survive\b/i,
      /\bmust sign back in after a full page reload\b/i,
      // A bare "in memory only" is fine when retracted, wrong when asserted.
      /(?<!described here and in RUNBOOK_DEPLOYMENTS\.md as an\n?\/\/ ")in memory only/i,
    ];

    for (const [label, text] of [
      ['supabase.ts', CLIENT],
      ['RUNBOOK_DEPLOYMENTS.md', RUNBOOK],
    ] as const) {
      // Only uncommented prose asserts anything. Code comments are stripped so
      // the retraction itself cannot trip the check.
      const asserted = stripComments(text);
      for (const re of UNRETRACTED) {
        expect(asserted, `${label} must not claim: ${re}`).not.toMatch(re);
      }
      // The retraction must quote the old claim in order to disown it, so the
      // quoted form is allowed. An *unquoted* affirmative is not: that is the
      // runbook still telling an incident responder there is no token to steal.
      const unquoted = text.replace(/["“][^"”]*cannot exfiltrate[^"”]*["”]/g, ' ');
      expect(unquoted, `${label} must not claim XSS cannot reach the token`).not.toMatch(
        /script-injection bug cannot exfiltrate/i
      );
    }
  });

  it('tells an incident responder where the token actually lives', () => {
    // The runbook is read during an incident. It has to be actionable.
    expect(RUNBOOK).toMatch(/fuw-auth-token/);
    expect(RUNBOOK).toMatch(/refreshing the page does not\s+sign the\s+user out/i);
    expect(RUNBOOK).toMatch(/must be treated as\s+exfiltrated if script execution is in any doubt/i);
  });

  it('keeps the compensating control that makes this acceptable', () => {
    // An injected string must not be able to execute, or the persisted token is
    // reachable and this trade-off stops being defensible.
    const csp = NETLIFY.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? '';
    expect(csp, 'a CSP header must be configured').not.toBe('');
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
  });
});
