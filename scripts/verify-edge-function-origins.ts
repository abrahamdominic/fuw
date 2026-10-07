#!/usr/bin/env tsx
/**
 * Verify that every browser-reachable edge function echoes
 * `Access-Control-Allow-Origin` for the origins this site actually serves, and
 * for nothing else.
 *
 * Why this is a script and not a unit test: `APP_ORIGIN` and
 * `MARKETPLACE_ORIGINS` are write-only Supabase secrets. The management API
 * returns a SHA-256 digest of each value instead of the value, so no test can
 * assert what they contain. What *is* observable is behaviour: send an `Origin`
 * header and see whether the matching `Access-Control-Allow-Origin` comes back.
 *
 * That is how the production misconfiguration was found. Measured against the
 * live project with the canonical origin from `src/lib/seo/site.ts`:
 *
 *     function                            ACAO for https://fuwtest.netlify.app
 *     ----------------------------------- ----------------------------------
 *     marketplace-paystack-initialize     (none)  -> payments broken in prod
 *     marketplace-paystack-verify         (none)  -> payments broken in prod
 *     wallet-paystack-initialize          (echoed) -> reflected any origin
 *     wallet-paystack-verify              (echoed) -> reflected any origin
 *     ai-search / ai-chat / ai-process    (none)
 *     resolve-login                       (none)
 *
 * The allow-lists were left holding `http://localhost:5173` and an older
 * Netlify domain, so every production payment call was blocked by the browser
 * and the wallet functions answered any origin at all. A unit test can assert
 * the *code* fail-closed; only this script can assert the *deployment* allows
 * the real site.
 *
 * Usage:
 *   npm run verify:origins                 # checks SITE_URL against every function
 *   npm run verify:origins -- <origin> ... # check specific origins instead
 *
 * Exits non-zero if any function rejects a served origin or accepts one that is
 * not served, so it is usable as a deploy gate.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_URL } from '../src/lib/seo/site';

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = join(HERE, '..', 'supabase/functions');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

/** Paystack POSTs these server-to-server; no browser ever calls them. */
const SERVER_ONLY = new Set(['marketplace-paystack-webhook', 'paystack-webhook', '_shared']);

/** Origins that must never be trusted, to prove the allow-list is a real list. */
const MUST_REJECT = [
  'https://evil.example.com',
  'https://fuwtest.netlify.app.evil.example.com',
];

type Verdict = 'allowed' | 'blocked' | 'unreachable';

interface Result {
  fn: string;
  origin: string;
  verdict: Verdict;
  detail: string;
}

/**
 * One POST with the given Origin and read back the ACAO header.
 *
 * The body is deliberately empty: these functions validate before doing any
 * work, so the response is a 4xx either way. What matters is the header, which is
 * attached by the CORS layer before any handler logic runs. Nothing is created
 * or charged.
 */
async function probe(fn: string, origin: string): Promise<Result> {
  const url = `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/${fn}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY!,
        Authorization: `Bearer ${ANON_KEY!}`,
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: '{}',
    });
    const acao = res.headers.get('access-control-allow-origin');
    const verdict: Verdict = acao === origin ? 'allowed' : 'blocked';
    return { fn, origin, verdict, detail: acao ? `ACAO=${acao}` : 'no ACAO header' };
  } catch (err) {
    return {
      fn,
      origin,
      verdict: 'unreachable',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<number> {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
    console.error('Load them first, e.g. `set -a && . ./.env && set +a`.');
    return 2;
  }

  const servedOrigins = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const origins = servedOrigins.length ? servedOrigins : [SITE_URL];

  const fns = readdirSync(FUNCTIONS_DIR).filter((dir) => {
    if (SERVER_ONLY.has(dir)) return false;
    try {
      readdirSync(join(FUNCTIONS_DIR, dir));
      return true;
    } catch {
      return false;
    }
  });

  console.log(`Supabase project : ${new URL(SUPABASE_URL).host}`);
  console.log(`Functions        : ${fns.length}`);
  console.log(`Served origins   : ${origins.join(', ')}\n`);

  const results: Result[] = [];
  for (const fn of fns) {
    for (const origin of [...origins, ...MUST_REJECT]) {
      results.push(await probe(fn, origin));
    }
  }

  const pad = Math.max(...fns.map((f) => f.length));
  let failures = 0;
  for (const fn of fns) {
    const rows = results.filter((r) => r.fn === fn);
    console.log(fn.padEnd(pad));
    for (const r of rows) {
      const isServed = origins.includes(r.origin);
      // A served origin must be allowed; an unserved origin must be refused.
      const ok = isServed ? r.verdict === 'allowed' : r.verdict === 'blocked';
      if (!ok) failures += 1;
      const flag = r.verdict === 'unreachable' ? '??' : ok ? 'ok' : 'FAIL';
      const why = isServed
        ? r.verdict === 'blocked'
          ? 'BLOCKED -- this origin cannot call the function'
          : ''
        : r.verdict === 'allowed'
          ? 'ACCEPTED -- origin is not allow-listed'
          : '';
      console.log(
        `  ${flag.padEnd(5)} ${r.origin.padEnd(48)} ${r.detail}${why ? `  <- ${why}` : ''}`
      );
    }
  }

  console.log();
  if (failures > 0) {
    console.error(`${failures} CORS failure(s).`);
    console.error('');
    console.error("The allow-lists are write-only Supabase secrets, so fix them with:");
    console.error(
      `  supabase secrets set APP_ORIGIN="${origins.join(',')}" --project <ref>`
    );
    console.error(
      `  supabase secrets set MARKETPLACE_ORIGINS="${origins.join(',')}" --project <ref>`
    );
    console.error('');
    console.error(
      'Then redeploy the functions, since Deno env is captured at deploy time:'
    );
    console.error('  supabase functions deploy <name> --project <ref>');
    return 1;
  }

  console.log('All served origins allowed; all unlisted origins refused.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });