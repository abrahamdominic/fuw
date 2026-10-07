// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every browser-reachable edge function must resolve its CORS policy from the
 * origin allow-list. Reflecting the caller's own Origin header (or falling back
 * to `*`) makes CORS a no-op: any site on the internet can drive the endpoint
 * from a signed-in victim's browser and read the response.
 *
 * The defect this was written for was measured, not hypothetical. Probing the
 * live project with an arbitrary origin returned
 * `Access-Control-Allow-Origin: https://fuwtest.netlify.app` from
 * `wallet-paystack-initialize` and `wallet-paystack-verify` -- echoed straight
 * back for an origin that was on no allow-list. Both now import `corsFor` and
 * `json` from `_shared/payments.ts` like every other payment function.
 *
 * The allow-lists themselves (`APP_ORIGIN`, `MARKETPLACE_ORIGINS`) are Supabase
 * secrets and cannot be read back -- the management API returns a SHA-256 digest
 * in place of the value. They were therefore recovered behaviourally, by sending
 * an `Origin` header and checking whether `Access-Control-Allow-Origin` came
 * back matching it. `scripts/verify-edge-function-origins.ts` does that against
 * whichever origins the site actually declares.
 *
 * Webhooks are excluded deliberately: they are called server-to-server by
 * Paystack, never by a browser, and they authenticate on a provider signature
 * rather than an Authorization header.
 */

const ROOT = join(__dirname, '..', '..');
const FUNCTIONS = join(ROOT, 'supabase/functions');

/** Browsers never call these; Paystack POSTs server-to-server. */
const SERVER_ONLY = new Set([
  'marketplace-paystack-webhook',
  'paystack-webhook',
  '_shared',
]);

const functionDirs = readdirSync(FUNCTIONS).filter((d) => {
  if (SERVER_ONLY.has(d)) return false;
  try {
    readFileSync(join(FUNCTIONS, d, 'index.ts'), 'utf8');
    return true;
  } catch {
    return false;
  }
});

describe('Edge function CORS policy', () => {
  it('found the browser-reachable functions to check', () => {
    // If this ever drops to a handful, the directory walk has broken and the
    // assertions below would pass vacuously.
    expect(functionDirs.length).toBeGreaterThanOrEqual(8);
  });

  it('never reflects the caller Origin or falls back to a wildcard', () => {
    const offenders: string[] = [];
    for (const dir of functionDirs) {
      const src = readFileSync(join(FUNCTIONS, dir, 'index.ts'), 'utf8');
      // Comment-stripped so prose about the old behaviour cannot trip the check.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1 ');
      if (/['"]Access-Control-Allow-Origin['"]\s*:\s*(origin|'\*'|"\*")/.test(code)) {
        offenders.push(dir);
      }
    }
    expect(offenders, 'these reflect any origin').toEqual([]);
  });

  it('resolves CORS from a shared allow-list, not a local copy', () => {
    // Duplicated allow-list logic drifts. Every browser-reachable function must
    // take its policy from a shared helper rather than an inline copy; the two
    // helpers are the only sanctioned sources.
    for (const dir of functionDirs) {
      const src = readFileSync(join(FUNCTIONS, dir, 'index.ts'), 'utf8');
      const importsShared =
        /import \{[^}]*\bcorsFor\b[^}]*\} from '\.\.\/_shared\/(payments|ai)\.ts'/.test(src);
      if (!importsShared) {
        // Not importing it is only acceptable if the function defines no CORS
        // policy of its own, which would mean it never sets the header at all.
        expect(
          src,
          `${dir} must import the shared corsFor or define no CORS policy`
        ).not.toMatch(/Access-Control-Allow-Origin/);
      }
    }

    // The two wallet payment functions must use the shared implementation.
    for (const dir of ['wallet-paystack-initialize', 'wallet-paystack-verify']) {
      const src = readFileSync(join(FUNCTIONS, dir, 'index.ts'), 'utf8');
      expect(src, `${dir} must import the shared corsFor`).toMatch(
        /import \{[^}]*\bcorsFor\b[^}]*\} from '\.\.\/_shared\/payments\.ts'/
      );
      expect(src, `${dir} must import the shared json helper`).toMatch(
        /import \{[^}]*\bjson as jsonResponse\b[^}]*\} from '\.\.\/_shared\/payments\.ts'/
      );
    }
  });

  it('keeps the shared allow-list fail-closed', () => {
    const shared = readFileSync(join(FUNCTIONS, '_shared/payments.ts'), 'utf8');
    // No match -> no header at all, so the browser blocks it. Emitting `*` or an
    // empty string instead would still be a permissive policy.
    expect(shared).toMatch(
      /if \(origin && allowedOrigins\(\)\.includes\(origin\)\)/
    );
    expect(shared).not.toMatch(/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/);
    // Lowercased and trimmed on both sides, or a trailing slash in the secret
    // silently stops matching and takes the whole site offline.
    expect(shared).toMatch(/\.map\(\(origin\) => origin\.trim\(\)\.toLowerCase\(\)\)/);
  });

  it('falls back from MARKETPLACE_ORIGINS to APP_ORIGIN rather than to open', () => {
    // If the marketplace-specific list is unset, an empty allow-list is the safe
    // result: no origin matches, no CORS header is emitted, the browser blocks.
    const shared = readFileSync(join(FUNCTIONS, '_shared/payments.ts'), 'utf8');
    expect(shared).toMatch(
      /MARKETPLACE_ORIGINS['"]\)\s*\?\?\s*Deno\.env\.get\('APP_ORIGIN'\)/
    );
    const aiShared = readFileSync(join(FUNCTIONS, '_shared/ai.ts'), 'utf8');
    expect(aiShared).toMatch(/Deno\.env\.get\('APP_ORIGIN'\)/);
    // Neither shared helper may supply a permissive default.
    expect(shared).not.toMatch(/allowedOrigins[\s\S]{0,200}?\|\|\s*['"]\*['"]/);
    expect(aiShared).not.toMatch(/allowedOrigins[\s\S]{0,200}?\|\|\s*['"]\*['"]/);
  });
});