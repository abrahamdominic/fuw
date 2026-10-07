// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

/**
 * Unit tests for the pure helpers in
 * `supabase/functions/_shared/payments.ts`.
 *
 * These matter because the webhook's HMAC verification and the CORS allow-list
 * cannot be exercised against the live project without the Paystack secret.
 * Deno.env is stubbed so the same source runs under Node.
 */

const SECRET = 'sk_test_0123456789abcdef0123456789abcdef';

function envStub(values: Record<string, string | undefined>) {
  (globalThis as any).Deno = {
    env: {
      get: (key: string) => values[key],
    },
  };
}

/**
 * Transpiles the shared edge-function module to plain JS with the esbuild binary
 * and imports the result.
 *
 * The binary is used rather than esbuild's JS API because vitest's environment
 * replaces globals that esbuild's library build asserts on, so the in-process
 * API throws an "invariant violation" here.
 *
 * The artifact is produced in the OS temp dir and only then copied into the
 * project, for two independent reasons:
 *
 *   1. The native esbuild binary resolves every input path against the repo
 *      root in a way that breaks on this machine (an in-repo source path comes
 *      back as `<repo>/<repo-name>/...`), while paths under the OS temp dir
 *      transpile fine. Feeding it an in-repo path fails outright.
 *   2. Vitest resolves a dynamic `import()` through Vite, which will not serve
 *      a module from outside the project root (`server.fs.allow`), so the
 *      import target has to live inside the project.
 *
 * `node_modules/.tmp` satisfies (2): always inside the root, always gitignored.
 */
/** Scratch paths created by `loadShared`, removed in `afterAll`. */
const scratchDirs: string[] = [];
const scratchFiles: string[] = [];

async function loadShared() {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  // This file lives at <repo>/src/marketplace/test/, so the edge function is
  // three levels up. The Marketplace's functions were folded into the platform
  // repo during integration (must.md Phase 10), so they are read from the
  // platform's own supabase/functions and never from the standalone checkout.
  const source = path.resolve(
    import.meta.dirname,
    '../../../supabase/functions/_shared/payments.ts'
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-shared-'));
  scratchDirs.push(dir);

  // The module imports supabase-js from a Deno-only https URL, which Node's ESM
  // loader cannot resolve. None of the helpers under test touch createClient, so
  // that one import is dropped before transpiling and replaced with a stub.
  const stubbed = fs
    .readFileSync(source, 'utf8')
    .replace(/^import\s+\{[^}]*\}\s+from\s+'https:\/\/[^']+';?\s*$/m, 'const createClient: any = () => { throw new Error("not used in tests"); };');
  if (stubbed.includes('https://esm.sh')) {
    throw new Error('failed to strip the remote import from the shared module');
  }
  const entry = path.join(dir, 'payments.ts');
  fs.writeFileSync(entry, stubbed);

  const outfile = path.join(dir, 'payments.mjs');

  // The native binary is used directly: the node_modules/.bin/esbuild shim is a
  // node script that re-execs itself, which does not work when spawned from
  // inside the vitest worker.
  const nativeEsbuild = path.resolve(
    import.meta.dirname,
    `../../../node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`
  );
  execFileSync(
    nativeEsbuild,
    [
      entry,
      '--format=esm',
      '--platform=neutral',
      '--target=es2022',
      '--log-level=error',
      `--outfile=${outfile}`,
    ],
    { stdio: 'pipe' }
  );

  // Move the artifact into the project so Vitest is allowed to import it, then
  // import it via a file URL (a bare `/abs/path` is not a valid ESM specifier).
  const localDir = path.resolve(import.meta.dirname, '../../../node_modules/.tmp/mp-shared');
  fs.mkdirSync(localDir, { recursive: true });
  const localEntry = path.join(localDir, 'payments.mjs');
  fs.copyFileSync(outfile, localEntry);
  scratchFiles.push(localEntry);

  return import(pathToFileURL(localEntry).href);
}

afterAll(async () => {
  const fs = await import('node:fs');
  for (const file of scratchFiles) fs.rmSync(file, { force: true });
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function hmacHex(body: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let shared: Awaited<ReturnType<typeof loadShared>>;

beforeEach(async () => {
  envStub({
    MARKETPLACE_ORIGINS: 'https://shop.example.com, https://campus.example.com',
    APP_ORIGIN: 'https://app.example.com',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    PAYSTACK_SECRET_KEY: SECRET,
  });
  shared = await loadShared();
});

describe('corsFor', () => {
  it('echoes an allow-listed origin', () => {
    const headers = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://shop.example.com' } }));
    expect(headers['Access-Control-Allow-Origin']).toBe('https://shop.example.com');
  });

  it('matches origins case-insensitively and allows several', () => {
    const lower = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://SHOP.example.com' } }));
    expect(lower['Access-Control-Allow-Origin']).toBe('https://shop.example.com');

    const second = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://campus.example.com' } }));
    expect(second['Access-Control-Allow-Origin']).toBe('https://campus.example.com');
  });

  it('emits no allow-origin header for an unknown origin', () => {
    const headers = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://evil.example.com' } }));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('emits no allow-origin header when the request has no origin', () => {
    const headers = shared.corsFor(new Request('https://fn'));
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('still advertises the methods and headers so preflight is well formed', () => {
    const headers = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://shop.example.com' } }));
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Headers']).toContain('authorization');
  });

  it('falls back to APP_ORIGIN when MARKETPLACE_ORIGINS is unset', () => {
    envStub({ APP_ORIGIN: 'https://app.example.com', PAYSTACK_SECRET_KEY: SECRET });
    const headers = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://app.example.com' } }));
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');

    const denied = shared.corsFor(new Request('https://fn', { headers: { origin: 'https://other.example.com' } }));
    expect(denied['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('verifyPaystackSignature', () => {
  it('accepts a correct HMAC-SHA512 of the raw body', async () => {
    const body = '{"event":"charge.success"}';
    const sig = await hmacHex(body, SECRET);
    expect(await shared.verifyPaystackSignature(SECRET, new TextEncoder().encode(body), sig)).toBe(true);
  });

  it('rejects a signature made with a different secret', async () => {
    const body = '{"event":"charge.success"}';
    const sig = await hmacHex(body, 'sk_live_someone_elses_key_000000');
    expect(await shared.verifyPaystackSignature(SECRET, new TextEncoder().encode(body), sig)).toBe(false);
  });

  it('rejects a tampered body', async () => {
    const original = '{"event":"charge.success"}';
    const sig = await hmacHex(original, SECRET);
    const tampered = '{"event":"charge.success","amount":999999}';
    expect(await shared.verifyPaystackSignature(SECRET, new TextEncoder().encode(tampered), sig)).toBe(false);
  });

  it('rejects a missing, short, or non-hex signature', async () => {
    const bytes = new TextEncoder().encode('{}');
    expect(await shared.verifyPaystackSignature(SECRET, bytes, null)).toBe(false);
    expect(await shared.verifyPaystackSignature(SECRET, bytes, '')).toBe(false);
    expect(await shared.verifyPaystackSignature(SECRET, bytes, 'abc123')).toBe(false);
    expect(await shared.verifyPaystackSignature(SECRET, bytes, 'z'.repeat(128))).toBe(false);
  });
});

describe('mapPaystackChannel', () => {
  it('maps provider channel names onto the marketplace enum', () => {
    expect(shared.mapPaystackChannel('card')).toBe('card');
    expect(shared.mapPaystackChannel('bank')).toBe('bank_transfer');
    expect(shared.mapPaystackChannel('transfer')).toBe('bank_transfer');
    expect(shared.mapPaystackChannel('account')).toBe('bank_transfer');
    expect(shared.mapPaystackChannel('ussd')).toBe('ussd');
    expect(shared.mapPaystackChannel('mobile_money')).toBe('mobile_money');
  });

  it('is case and whitespace tolerant', () => {
    expect(shared.mapPaystackChannel('  Card ')).toBe('card');
    expect(shared.mapPaystackChannel('BANK')).toBe('bank_transfer');
  });

  it('falls back to none instead of guessing', () => {
    expect(shared.mapPaystackChannel('crypto')).toBe('none');
    expect(shared.mapPaystackChannel(null)).toBe('none');
    expect(shared.mapPaystackChannel(undefined)).toBe('none');
  });
});

describe('returnUrl', () => {
  it('appends the per-order path to the base rather than replacing it', () => {
    envStub({ APP_ORIGIN: 'https://app.example.com', PAYSTACK_SECRET_KEY: SECRET });
    expect(shared.returnUrl('/order/abc?payment=returned')).toBe(
      'https://app.example.com/order/abc?payment=returned'
    );
  });

  it('keeps a sub-path deployment base', () => {
    envStub({ APP_ORIGIN: 'https://example.com/marketplace', PAYSTACK_SECRET_KEY: SECRET });
    expect(shared.returnUrl('/order/abc')).toBe('https://example.com/marketplace/order/abc');
  });

  it('prefers MARKETPLACE_RETURN_URL and still appends the path', () => {
    envStub({
      APP_ORIGIN: 'https://app.example.com',
      MARKETPLACE_RETURN_URL: 'https://shop.example.com',
      PAYSTACK_SECRET_KEY: SECRET,
    });
    expect(shared.returnUrl('/order/xyz?payment=returned')).toBe(
      'https://shop.example.com/order/xyz?payment=returned'
    );
  });

  it('returns undefined when no base is configured, so no callback is sent', () => {
    envStub({ PAYSTACK_SECRET_KEY: SECRET });
    expect(shared.returnUrl('/order/abc')).toBeUndefined();
  });
});

describe('config', () => {
  it('reports unconfigured payments as a 503, never as success', () => {
    envStub({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      PAYSTACK_SECRET_KEY: '',
    });
    const cfg = shared.config();
    expect(cfg.ok).toBe(false);
    if (!cfg.ok) {
      expect(cfg.status).toBe(503);
      expect(cfg.error).toMatch(/not configured/i);
    }
  });

  it('refuses to run without the anon key, which would break caller auth', () => {
    envStub({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      PAYSTACK_SECRET_KEY: SECRET,
    });
    const cfg = shared.config();
    expect(cfg.ok).toBe(false);
    if (!cfg.ok) expect(cfg.status).toBe(500);
  });

  it('is ready when everything is present', () => {
    const cfg = shared.config();
    expect(cfg.ok).toBe(true);
    if (cfg.ok) {
      expect(cfg.secretKey).toBe(SECRET);
      expect(cfg.anonKey).toBe('anon');
      expect(cfg.serviceKey).toBe('service');
    }
  });
});

describe('json', () => {
  it('marks responses no-store so a payment result is never cached', async () => {
    const res = shared.json({ ok: true }, 200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('applies CORS when a request is supplied', async () => {
    const res = shared.json({ ok: true }, 200, new Request('https://fn', { headers: { origin: 'https://shop.example.com' } }));
    expect(res.headers.get('access-control-allow-origin')).toBe('https://shop.example.com');
  });
});