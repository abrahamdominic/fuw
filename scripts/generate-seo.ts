/**
 * Build-time SEO artifact generator.
 *
 * Runs after `vite build` and produces, from the same source of truth the
 * application itself uses:
 *
 *   dist/sitemap.xml  every public indexable URL, including the dynamic
 *                     faculty, department, course, material, repository and
 *                     collection pages that exist right now
 *   dist/robots.txt   allow public reading, explicitly keep private surfaces
 *                     out of the index, point at the sitemap
 *   dist/404.html     the SPA shell, so Netlify can answer unknown paths with
 *                     a real HTTP 404 instead of a 200
 *
 * Auth, dashboard, admin, super-admin, submission, account, login, register,
 * password-reset and maintenance routes are never written to the sitemap.
 *
 * The database is queried with the same anonymous key the browser uses and
 * only ever requests rows that are already public. If Supabase is unreachable
 * the build still succeeds — database-backed URLs are simply omitted and a
 * warning is printed, so a transient outage can never break a deploy.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_URL, OG_IMAGE_PATH } from '../src/lib/seo/site';
import {
  PUBLIC_ROUTES,
  NOINDEX_ROUTES,
  PRIVATE_ROUTES,
  PORTAL_ROUTES,
  indexableStaticPaths
} from '../src/lib/seo/routes';
import { facultyEntries, departmentEntries, courseEntries } from '../src/lib/seo/directory';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

// ---------------------------------------------------------------------------
// .env loading (tsx does not read .env automatically)
// ---------------------------------------------------------------------------
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(ROOT, '.env'));
loadEnvFile(resolve(ROOT, '.env.production'));

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------
function abs(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  return new URL(clean, `${SITE_URL}/`).href;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

type SitemapEntry = { loc: string; changefreq: string; priority: string; lastmod?: string };

// ---------------------------------------------------------------------------
// Static + catalogue URLs
// ---------------------------------------------------------------------------
const STATIC_META = PUBLIC_ROUTES;

function buildCatalogueEntries(): SitemapEntry[] {
  const entries: SitemapEntry[] = [];

  for (const { faculty, path } of facultyEntries()) {
    entries.push({ loc: abs(path), changefreq: 'weekly', priority: '0.8', lastmod: lastModFor('faculty', faculty.name) });
  }

  for (const { department, path } of departmentEntries()) {
    entries.push({ loc: abs(path), changefreq: 'weekly', priority: '0.7', lastmod: lastModFor('department', department.name) });
  }

  // 66 unique course codes — one page each, which is where most of the
  // long-tail academic search traffic actually lands.
  for (const { path } of courseEntries()) {
    entries.push({ loc: abs(path), changefreq: 'weekly', priority: '0.7', lastmod: lastModFor('course', path) });
  }

  return entries;
}

/**
 * `lastmod` is only written when it reflects real modification data. The
 * bundled catalogue is static source code, so it has no truthful modification
 * date and is therefore left without `lastmod`. Database-backed pages pass the
 * timestamp returned by Postgres.
 */
function lastModFor(_kind: string, _key: string): string | undefined {
  return undefined;
}

// ---------------------------------------------------------------------------
// Database-backed URLs (public rows only)
// ---------------------------------------------------------------------------
type DbUrl = { path: string; lastmod?: string };

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

async function restGet(
  config: { url: string; key: string },
  tablePath: string,
  query: Record<string, string>
): Promise<any[] | null> {
  const params = new URLSearchParams(query);
  const endpoint = `${config.url}/rest/v1/${tablePath}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

async function collectDatabaseUrls(): Promise<{ urls: DbUrl[]; warnings: string[] }> {
  const warnings: string[] = [];
  const urls: DbUrl[] = [];
  const config = supabaseConfig();

  if (!config) {
    warnings.push(
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set: material, repository and collection URLs were omitted from the sitemap.'
    );
    return { urls, warnings };
  }

  const [materials, research, collections, accommodations] = await Promise.all([
    // Only approved material is listed — the same rule
    // store.getApprovedMaterials() applies in the browser.
    restGet(config, 'materials', {
      select: 'id,updated_at',
      status: 'eq.approved',
      order: 'updated_at.desc',
      limit: '5000'
    }),
    restGet(config, 'research_items', {
      select: 'id,published_at,updated_at',
      status: 'in.(approved,published)',
      access_level: 'in.(public,registered)',
      order: 'published_at.desc',
      limit: '5000'
    }),
    restGet(config, 'collection_groups', {
      select: 'slug,updated_at',
      is_published: 'eq.true',
      limit: '1000'
    }),
    restGet(config, 'accommodation_properties', {
      select: 'slug,updated_at',
      is_published: 'eq.true',
      limit: '1000'
    })
  ]);

  if (!materials) warnings.push('materials table unavailable: material URLs omitted from the sitemap.');
  else for (const row of materials) urls.push({ path: `/materials/${row.id}`, lastmod: isoDate(row.updated_at) });

  if (!research) warnings.push('research_items table unavailable: repository URLs omitted from the sitemap.');
  else for (const row of research) urls.push({ path: `/repository/${row.id}`, lastmod: isoDate(row.updated_at) || isoDate(row.published_at) });

  if (!collections) warnings.push('collection_groups table unavailable: collection URLs omitted from the sitemap.');
  else for (const row of collections) if (row.slug) urls.push({ path: `/collections/${row.slug}`, lastmod: isoDate(row.updated_at) });

  if (!accommodations) warnings.push('accommodation_properties table unavailable: accommodation URLs omitted from the sitemap.');
  else for (const row of accommodations) if (row.slug) urls.push({ path: `/accommodation/${row.slug}`, lastmod: isoDate(row.updated_at) });

  return { urls, warnings };
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------
function renderSitemap(entries: SitemapEntry[]): string {
  const body = entries
    .map((entry) => {
      const lines = [`    <loc>${esc(entry.loc)}</loc>`];
      if (entry.lastmod) lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
      lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      lines.push(`    <priority>${entry.priority}</priority>`);
      return `  <url>\n${lines.join('\n')}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * Private surfaces are disallowed so crawlers never spend budget on them, but
 * they are deliberately *not* relied on for protection — robots.txt only
 * governs indexing, not access.
 */
const PRIVATE_PREFIXES = [
  '/student',
  '/student/',
  '/admin',
  '/admin/',
  '/super',
  '/super/',
  '/super-admin',
  '/superadmin',
  '/campus-hub',
  '/campus',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/logout',
  '/profile',
  '/settings',
  '/messages',
  '/messages/',
  '/report-problem',
  '/report-copyright',
  '/repository/submit',
  '/verify-email',
  '/maintenance',
  '/checkout',
  '/cart',
  '/orders',
  '/orders/',
  '/payments',
  '/api/',
  '/api'
];

function renderRobots(): string {
  const lines: string[] = [
    '# robots.txt for Federal University Wukari Ecosystem',
    '# Public content and verified accommodations are open to search engines.',
    '# Dashboards, administrative tools, accounts and authenticated areas are strictly protected.',
    '',
    'User-agent: *',
    'Allow: /',
    'Allow: /hub',
    'Allow: /hub/',
    'Allow: /library',
    'Allow: /accommodation',
    'Allow: /accommodation/',
    'Allow: /marketplace',
    'Allow: /marketplace/',
    'Allow: /faculties/',
    'Allow: /departments/',
    'Allow: /courses/',
    'Allow: /materials/',
    'Allow: /repository',
    'Allow: /repository/',
    'Allow: /collections',
    'Allow: /collections/',
    'Allow: /about',
    'Allow: /help',
    'Allow: /contact',
    ''
  ];

  for (const prefix of PRIVATE_PREFIXES) lines.push(`Disallow: ${prefix}`);

  lines.push(
    '',
    '# Filtered and searched views of the catalogue are thin duplicates of',
    '# the canonical listing pages; they are noindex in the page head, so they',
    '# are disallowed here to keep crawl budget on the canonical URLs.',
    'Disallow: /*?*',
    '',
    '# This is a static site served from a CDN, so no crawl throttling is',
    '# required.',
    '',
    `Sitemap: ${abs('/sitemap.xml')}`,
    ''
  );

  return lines.join('\n');
}

/**
 * Netlify answers unknown paths with `dist/404.html` and a real HTTP 404, so
 * that shell must not claim to be the home page. Strip the shell canonical and
 * force a non-indexable robots directive before writing it out.
 *
 * The runtime <SEO> component omits canonical entirely on noindex pages, so a
 * rendered 404 ends up with `noindex, follow` and no canonical at all.
 */
/**
 * Routes that exist but are not part of the indexable surface. They still have
 * to answer with HTTP 200 — a signed-in user following `/student/upload` is on
 * a real page, and a 404 there is a bug, not a policy.
 *
 * Every entry must correspond to a `path=` declared in `src/main.tsx`.
 * `assertRouteCoverage()` fails the build if a declared static route has no
 * rewrite: `/wallet`, `/course-upload`, `/campus` and `/campus-hub` were all
 * real client routes that answered HTTP 404 in production for exactly that
 * reason, while looking perfectly healthy under `vite dev`.
 */
const PORTAL_ALIASES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/super-admin',
  '/superadmin',
  '/wallet',
  '/course-upload',
  '/campus',
  '/campus-hub',
  '/accommodation/roommates/post',
  '/accommodation/roommates/create'
];

/**
 * Client-routed subtrees of the authenticated portals. Wildcards are safe here
 * because every one of them sits behind `RequireAuth` and `noindex`.
 */
const PORTAL_WILDCARDS = ['/student/*', '/admin/*', '/super/*'];

/**
 * The FUW Student Marketplace, mounted at /marketplace/* in this SPA
 * (must.md Phase 10).
 *
 * `/marketplace` is an exact route and belongs in the indexable set with the
 * rest of the entry points. Everything under it is covered by a wildcard for
 * one reason: the Marketplace's URLs are keyed on ids from the Marketplace
 * tables (products, storefronts, orders, conversations), which this build does
 * not read, so they cannot be enumerated here the way `/accommodation/<slug>`
 * can.
 *
 * The wildcard is therefore the documented exception to the rule above. It is
 * bounded to this one subtree, and an unknown path inside it still renders a
 * real not-found page — it just answers HTTP 200 rather than 404. The subtree
 * is deliberately left out of sitemap.xml; the Marketplace ships its own
 * document titles and descriptions, and duplicating it into the platform's
 * sitemap would put two canonical surfaces on the same origin.
 */
const MARKETPLACE_ROUTES = ['/marketplace'];
const MARKETPLACE_WILDCARDS = ['/marketplace/*'];

/**
 * Netlify rewrite rules for every route that actually exists.
 *
 * Netlify serves real files first and falls back to `404.html` with HTTP 404
 * for anything unmatched. `/library` is not a file, so without a rewrite the
 * whole application would 404.
 *
 * The usual fix is a `/*  ->  /index.html  200` catch-all, but that answers
 * HTTP 200 for content that does not exist, which seo.md §31 and §54 forbid:
 * unknown paths and unknown record ids must be genuine 404s, not soft ones.
 *
 * So the build enumerates the routes instead of guessing them, from the same
 * source of truth as the sitemap and the metadata registry. Everything not
 * listed here — typos, retired records, `/materials/<unknown-id>` — falls
 * through to Netlify's own 404 handling and gets a real HTTP 404 while React
 * still renders the not-found UI.
 *
 * Trade-off, accepted on purpose: a record inserted into Supabase needs a
 * rebuild before its URL resolves with 200. A status code that claims a page
 * exists when it does not is worse than a URL that needs a redeploy.
 */
function buildRedirectRules(indexablePaths: string[]): string[] {
  const paths = new Set<string>(indexablePaths);

  for (const key of [
    ...Object.keys(NOINDEX_ROUTES),
    ...Object.keys(PRIVATE_ROUTES),
    ...Object.keys(PORTAL_ROUTES),
    ...PORTAL_ALIASES,
    ...MARKETPLACE_ROUTES
  ]) {
    paths.add(key);
  }

  const exact = [...paths].filter((path) => !path.includes('*')).sort();
  const rules = [...exact, ...PORTAL_WILDCARDS, ...MARKETPLACE_WILDCARDS];

  // A rewrite aimed at a real file would shadow it, and a catch-all would
  // undo the 404 behaviour this file exists to preserve.
  const reserved = ['/robots.txt', '/sitemap.xml', '/404.html', '/index.html', '/favicon.ico', '/site.webmanifest'];
  for (const path of rules) {
    if (path === '/*') throw new Error('[seo] refusing to emit a /* catch-all: it would hide every 404');
    if (reserved.includes(path)) throw new Error(`[seo] refusing to rewrite the static file ${path}`);
  }
  if (rules.some((path) => path.startsWith('/assets/') || path.startsWith('/images/'))) {
    throw new Error('[seo] refusing to rewrite a build asset');
  }

  return rules;
}

/**
 * Fails the build when a statically-declared client route has no rewrite.
 *
 * This is the guard for a whole class of production-only bug: the route exists
 * in `src/main.tsx`, the app renders it fine under `vite dev`/`vite preview`
 * (both fall back to `index.html` for unknown paths), but Netlify has no rule
 * for it and answers HTTP 404. Nothing else notices until a user clicks the
 * link on the live site.
 *
 * Scope: routes with no `:param` segment. Parameterised record routes
 * (`/materials/:id`, `/collections/:slug`, …) are enumerated from the database
 * into the rules instead, and a table that is legitimately empty must not fail
 * the build, so those are checked by enumeration, not by pattern.
 */
function assertRouteCoverage(rules: string[]): void {
  const routerFiles = ['src/main.tsx', 'src/App.tsx']
    .map((rel) => resolve(ROOT, rel))
    .filter((file) => existsSync(file));

  if (routerFiles.length === 0) return;

  const declared = new Set<string>();
  for (const file of routerFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bpath\s*=\s*["']([^"']+)["']/g)) {
      declared.add(match[1]);
    }
  }

  // Redirects declared in netlify.toml resolve these before _redirects is ever
  // consulted, so they need no rewrite of their own.
  const tomlPath = resolve(ROOT, 'netlify.toml');
  const tomlRedirects = existsSync(tomlPath)
    ? new Set([...readFileSync(tomlPath, 'utf8').matchAll(/^\s*from\s*=\s*"([^"]+)"/gm)].map((m) => m[1]))
    : new Set<string>();

  const ruleSet = new Set(rules);
  const wildcardParents = rules.filter((rule) => rule.endsWith('/*')).map((rule) => rule.slice(0, -2));

  const missing = [...declared]
    .filter((route) => route !== '*' && !route.includes(':'))
    .filter((route) => !ruleSet.has(route))
    .filter((route) => !wildcardParents.some((parent) => route === parent || route.startsWith(`${parent}/`)))
    .filter((route) => !tomlRedirects.has(route))
    .sort();

  if (missing.length > 0) {
    throw new Error(
      `[seo] ${missing.length} client route(s) have no rewrite and would 404 in production:\n` +
        missing.map((route) => `      ${route}`).join('\n') +
        `\n  Add them to PORTAL_ALIASES/PORTAL_WILDCARDS/MARKETPLACE_WILDCARDS in ` +
        `scripts/generate-seo.ts, or declare a redirect for them in netlify.toml.`
    );
  }
}

function writeRedirects(indexablePaths: string[]): string {
  const rules = buildRedirectRules(indexablePaths);

  assertRouteCoverage(rules);

  const header = [
    '# Generated by scripts/generate-seo.ts — do not edit by hand.',
    '#',
    '# One 200 rewrite per route that really exists. Anything not listed falls',
    '# through to Netlify, which answers with dist/404.html and HTTP 404, which',
    '# is what seo.md §31/§54 require for nonexistent pages and records.',
    ''
  ].join('\n');

  const body = rules.map((path) => `${path}  /index.html  200`).join('\n');
  const file = `${header}${body}\n`;

  writeFileSync(resolve(DIST, '_redirects'), file);
  return rules.length;
}

function copy404Shell(): boolean {
  const indexPath = resolve(DIST, 'index.html');
  if (!existsSync(indexPath)) return false;

  const shell = readFileSync(indexPath, 'utf8')
    // The SPA sets the real title, description and social tags at runtime; the
    // static values only matter for the crawlers that do not execute JS, and
    // for this document they must describe "not found", not "home page".
    .replace(/<link rel="canonical"[^>]*>\s*/g, '')
    .replace(/<link rel="alternate" hreflang="[^"]*"[^>]*>\s*/g, '')
    .replace(
      /<meta name="robots" content="[^"]*"\s*\/?>/g,
      '<meta name="robots" content="noindex, follow" />'
    )
    .replace(
      /<meta name="googlebot" content="[^"]*"\s*\/?>/g,
      '<meta name="googlebot" content="noindex, follow" />'
    )
    .replace(/<title>[\s\S]*?<\/title>/, '<title>Page not found | FUW Campus Hub</title>');

  writeFileSync(resolve(DIST, '404.html'), shell);
  return true;
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!existsSync(DIST)) {
    console.error('[seo] dist/ not found. Run this after "vite build".');
    process.exit(1);
  }

  // Stale hand-written copies in public/ would shadow the generated files,
  // so make sure they can never come back.
  for (const stale of ['robots.txt', 'sitemap.xml']) {
    const path = resolve(ROOT, 'public', stale);
    if (existsSync(path)) {
      writeFileSync(path, '');
      console.log(`[seo] emptied stale public/${stale} (generated into dist/)`);
    }
  }

  const { urls, warnings } = await collectDatabaseUrls();

  const entries: SitemapEntry[] = [];

  for (const path of indexableStaticPaths()) {
    const meta = STATIC_META[path];
    entries.push({
      loc: abs(path),
      changefreq: meta?.changefreq ?? 'weekly',
      priority: (meta?.priority ?? 0.7).toFixed(1)
    });
  }

  entries.push(...buildCatalogueEntries());

  for (const url of urls) {
    entries.push({ loc: abs(url.path), changefreq: 'monthly', priority: '0.6', lastmod: url.lastmod });
  }

  // One canonical URL per location: never emit a redirect, a filtered view or
  // a duplicate.
  const seen = new Set<string>();
  const deduped = entries.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });

  writeFileSync(resolve(DIST, 'sitemap.xml'), renderSitemap(deduped));
  writeFileSync(resolve(DIST, 'robots.txt'), renderRobots());

  // Same source of truth as the sitemap, so a URL is indexable and resolvable
  // or it is neither.
  const indexablePaths = deduped.map((entry) => new URL(entry.loc).pathname);
  const ruleCount = writeRedirects(indexablePaths);

  const shell = copy404Shell();

  for (const warning of warnings) console.warn(`[seo] warning: ${warning}`);

  console.log(
    `[seo] sitemap.xml: ${deduped.length} indexable URLs (${indexableStaticPaths().length} static, ` +
      `${deduped.length - indexableStaticPaths().length} dynamic) -> ${SITE_URL}/sitemap.xml`
  );
  console.log(`[seo] robots.txt written -> ${SITE_URL}/robots.txt`);
  console.log(`[seo] _redirects: ${ruleCount} routes served with HTTP 200`);
  console.log(shell ? '[seo] 404.html written (unlisted paths get HTTP 404)' : '[seo] 404.html not written (index.html missing)');
  console.log(`[seo] social image referenced by every page: ${abs(OG_IMAGE_PATH)}`);
}

main().catch((error) => {
  console.error('[seo] generation failed:', error);
  process.exit(1);
});