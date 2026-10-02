/**
 * SEO pre-flight validation.
 *
 * Checks the things that silently rot and are expensive to debug in production:
 * duplicate titles and descriptions, over-long descriptions, canonical or
 * robots mistakes, private routes leaking into the sitemap, and invalid
 * JSON-LD. Run after `npm run build`.
 *
 *   npx tsx scripts/validate-seo.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { absoluteUrl, SITE_URL } from '../src/lib/seo/site';
import {
  FALLBACK_META,
  NOINDEX_ROUTES,
  PORTAL_ROUTES,
  PRIVATE_ROUTES,
  PUBLIC_ROUTES,
  isIndexablePath
} from '../src/lib/seo/routes';
import { facultyEntries, departmentEntries, courseEntries } from '../src/lib/seo/directory';
import { facultyMeta, departmentMeta, courseMeta } from '../src/lib/seo/dynamic';
import { buildGraph } from '../src/lib/seo/schema';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

const problems: string[] = [];
const warnings: string[] = [];

function fail(message: string) {
  problems.push(message);
}

function warn(message: string) {
  warnings.push(message);
}

// ---------------------------------------------------------------------------
// 1. Every indexable URL has a unique title and description
// ---------------------------------------------------------------------------
interface Candidate {
  path: string;
  title: string;
  description: string;
  indexability: string;
  keywords: string[];
}

const candidates: Candidate[] = [
  ...Object.values(PUBLIC_ROUTES).map((m) => ({ ...m, indexability: m.indexability })),
  ...facultyEntries().map(({ faculty }) => ({ ...facultyMeta(faculty), indexability: 'index' })),
  ...departmentEntries().map((entry) => ({ ...departmentMeta(entry), indexability: 'index' })),
  ...courseEntries().map((entry) => ({ ...courseMeta(entry), indexability: 'index' }))
];

const titleSeen = new Map<string, string>();
const descriptionSeen = new Map<string, string>();

for (const candidate of candidates) {
  const path = candidate.path;

  if (!isIndexablePath(path)) {
    fail(`${path} is in the metadata set but is not considered indexable by the crawl policy`);
  }

  const title = candidate.title.trim();
  if (title.length < 20 || title.length > 70) {
    warn(`title length ${title.length} (aim 30-60): ${path} — "${title}"`);
  }
  const brandCount = title.split('FUW E-Library').length - 1;
  // Every indexable title must name the brand or the university — never neither.
  if (brandCount === 0 && !/\bFUW\b|Federal University Wukari/.test(title)) {
    warn(`title carries neither the brand nor the university name: ${path}`);
  }
  if (brandCount > 1) warn(`title repeats the brand ${brandCount} times: ${path}`);
  if (title.includes('Federal University Wukari') && brandCount >= 1) {
    warn(`title repeats both the brand and the university name: ${path}`);
  }

  const description = candidate.description.trim();
  if (description.length < 70 || description.length > 300) {
    warn(`description length ${description.length} (aim 110-165): ${path}`);
  }

  if (!candidate.keywords || candidate.keywords.length === 0) {
    warn(`no keywords declared: ${path}`);
  } else if (candidate.keywords.length > 12) {
    warn(`${candidate.keywords.length} keywords is keyword stuffing: ${path}`);
  }

  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    fail(`path is not a clean canonical path: "${path}"`);
  }

  const previousTitle = titleSeen.get(title);
  if (previousTitle) fail(`duplicate title on ${path} and ${previousTitle}: "${title}"`);
  else titleSeen.set(title, path);

  const previousDescription = descriptionSeen.get(description);
  if (previousDescription) {
    fail(`duplicate description on ${path} and ${previousDescription}`);
  } else descriptionSeen.set(description, path);
}

// ---------------------------------------------------------------------------
// 2. Private and noindex routes must never be indexable
// ---------------------------------------------------------------------------
for (const meta of [...Object.values(NOINDEX_ROUTES), ...Object.values(PRIVATE_ROUTES), ...Object.values(PORTAL_ROUTES)]) {
  if (meta.indexability !== 'noindex') {
    fail(`${meta.path} is in a noindex registry but declares indexability "${meta.indexability}"`);
  }
  if (isIndexablePath(meta.path)) {
    fail(`${meta.path} is noindex but the crawl policy would let it be crawled as indexable`);
  }
}

if (FALLBACK_META.indexability !== 'noindex') {
  fail('FALLBACK_META must default to noindex so an undeclared route is never indexed');
}

for (const path of ['/student', '/admin', '/super-admin', '/login', '/register', '/reset-password', '/repository/submit']) {
  if (isIndexablePath(path)) fail(`${path} must not be indexable`);
}

// ---------------------------------------------------------------------------
// 3. Build artifacts
// ---------------------------------------------------------------------------
const sitemapPath = resolve(DIST, 'sitemap.xml');
const robotsPath = resolve(DIST, 'robots.txt');
const notFoundPath = resolve(DIST, '404.html');

if (!existsSync(sitemapPath)) fail('dist/sitemap.xml is missing');
if (!existsSync(robotsPath)) fail('dist/robots.txt is missing');
if (!existsSync(notFoundPath)) fail('dist/404.html is missing (unknown paths would return HTTP 200)');

if (existsSync(sitemapPath)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  const seen = new Set<string>();
  for (const loc of locations) {
    if (seen.has(loc)) fail(`sitemap contains a duplicate URL: ${loc}`);
    seen.add(loc);

    if (!loc.startsWith(`${SITE_URL}/`)) fail(`sitemap URL is not on the production origin: ${loc}`);
    if (!loc.endsWith('/') && loc.split('?').length > 1) fail(`sitemap URL has a query string: ${loc}`);

    const path = loc.slice(`${SITE_URL}`.length) || '/';
    if (!isIndexablePath(path)) fail(`sitemap contains a non-indexable URL: ${loc}`);
    if (NOINDEX_ROUTES[path] || PRIVATE_ROUTES[path] || PORTAL_ROUTES[path]) {
      fail(`sitemap contains a private/noindex route: ${loc}`);
    }
  }

  for (const path of Object.keys(PUBLIC_ROUTES)) {
    if (!seen.has(absoluteUrl(path))) fail(`sitemap is missing the public route ${absoluteUrl(path)}`);
  }

  for (const { path } of facultyEntries()) {
    if (!seen.has(absoluteUrl(path))) fail(`sitemap is missing the faculty page ${path}`);
  }
  for (const { path } of departmentEntries()) {
    if (!seen.has(absoluteUrl(path))) fail(`sitemap is missing the department page ${path}`);
  }
  for (const { path } of courseEntries()) {
    if (!seen.has(absoluteUrl(path))) fail(`sitemap is missing the course page ${path}`);
  }

  if (locations.length > 50000) fail(`sitemap has ${locations.length} URLs (limit is 50000 per file)`);
}

if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf8');
  if (!robots.includes(`Sitemap: ${absoluteUrl('/sitemap.xml')}`)) {
    fail('robots.txt does not reference the production sitemap');
  }
  for (const path of ['/student', '/admin', '/super-admin', '/login', '/register']) {
    if (!robots.includes(`Disallow: ${path}`)) fail(`robots.txt does not disallow ${path}`);
  }
  if (/Crawl-delay/i.test(robots)) {
    warn('robots.txt sets a Crawl-delay; a static site does not need one');
  }
}

if (existsSync(notFoundPath)) {
  const shell = readFileSync(notFoundPath, 'utf8');
  if (!/<div id="root">/.test(shell)) fail('dist/404.html does not mount the React root');
  if (/rel="canonical"/.test(shell)) {
    fail('dist/404.html must not declare a canonical URL (it would point every missing page at one address)');
  }
  if (!/name="robots" content="noindex/.test(shell)) {
    fail('dist/404.html is missing a noindex robots directive');
  }
}

// ---------------------------------------------------------------------------
// 4. Structured data emitted by every builder must serialise
// ---------------------------------------------------------------------------

const sampleMetas: PageMeta[] = [
  PUBLIC_ROUTES['/'],
  PUBLIC_ROUTES['/library'],
  ...facultyEntries().slice(0, 1).map((e) => facultyMeta(e.faculty)),
  ...departmentEntries().slice(0, 1).map((e) => departmentMeta(e)),
  ...courseEntries().slice(0, 1).map((e) => courseMeta(e))
];

for (const meta of sampleMetas) {
  try {
    const serialised = JSON.stringify(buildGraph(meta, [{ name: 'Sample', path: '/library' }]));
    JSON.parse(serialised);
  } catch (error) {
    fail(`JSON-LD for ${meta.path} is invalid: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Routing: every real URL resolves with 200, everything else with 404
//
// This is the check that would have caught the production incident where a
// `/* -> /404.html  404  force = true` catch-all served HTML in place of
// robots.txt, sitemap.xml, favicon.ico and every hashed asset.
// ---------------------------------------------------------------------------
const redirectsPath = resolve(DIST, '_redirects');
const netlifyToml = resolve(ROOT, 'netlify.toml');

if (!existsSync(redirectsPath)) {
  fail('dist/_redirects is missing — client-side routes would answer HTTP 404');
} else {
  const rules = readFileSync(redirectsPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, to, status };
    });

  const rewritten = new Set<string>();
  const reserved = new Set(['/robots.txt', '/sitemap.xml', '/404.html', '/index.html', '/favicon.ico', '/site.webmanifest']);

  for (const rule of rules) {
    if (rule.status !== '200') fail(`dist/_redirects rule "${rule.from}" must rewrite with status 200, got ${rule.status}`);
    if (rule.to !== '/index.html') fail(`dist/_redirects rule "${rule.from}" must target /index.html, got "${rule.to}"`);
    if (rule.from === '/*' || rule.from === '/*/*') {
      fail('dist/_redirects contains a /* catch-all: it would answer HTTP 200 for nonexistent content (seo.md §54)');
    }
    if (reserved.has(rule.from)) fail(`dist/_redirects rewrites the static file ${rule.from}, which would shadow it`);
    if (/^\/(assets|images)\//.test(rule.from)) fail(`dist/_redirects rewrites build asset ${rule.from}, which would shadow it`);
    rewritten.add(rule.from);
  }

  // Everything the sitemap advertises must actually resolve with 200.
  if (existsSync(sitemapPath)) {
    const advertised = readFileSync(sitemapPath, 'utf8')
      .match(/<loc>[^<]+<\/loc>/g)
      ?.map((tag) => new URL(tag.replace(/<\/?loc>/g, '')).pathname) ?? [];

    for (const path of advertised) {
      if (!rewritten.has(path)) {
        fail(`sitemap advertises ${path} but dist/_redirects has no 200 rewrite for it — it would answer HTTP 404`);
      }
    }
  }

  // Real-but-noindex routes must resolve too, or signed-in users hit 404s.
  for (const path of [
    ...Object.keys(NOINDEX_ROUTES),
    ...Object.keys(PRIVATE_ROUTES),
    ...Object.keys(PORTAL_ROUTES)
  ]) {
    if (!rewritten.has(path)) fail(`route ${path} has no 200 rewrite in dist/_redirects`);
  }
}

// The catch-all can also be reintroduced in netlify.toml instead of _redirects.
if (existsSync(netlifyToml)) {
  const toml = readFileSync(netlifyToml, 'utf8');
  if (/from\s*=\s*"\/\*"\s*\n\s*to\s*=\s*"\/index\.html"\s*\n\s*status\s*=\s*200/.test(toml)) {
    fail('netlify.toml has a /* -> /index.html 200 catch-all: nonexistent content would answer HTTP 200 (seo.md §54)');
  }
  if (/from\s*=\s*"\/\*"\s*\n\s*to\s*=\s*"\/404\.html"/.test(toml)) {
    fail('netlify.toml has a /* -> /404.html catch-all: it also hijacks robots.txt, sitemap.xml and every hashed asset');
  }
}

// ---------------------------------------------------------------------------
// 6. Social image and icons exist in the build output
// ---------------------------------------------------------------------------
for (const asset of [
  '/images/fuw-elibrary-og.png',
  '/images/fuw-logo.png',
  '/images/animation-poster.jpg',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/site.webmanifest'
]) {
  if (!existsSync(resolve(DIST, asset.replace(/^\//, '')))) {
    fail(`referenced asset is missing from the build: ${asset}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`checked ${candidates.length} indexable pages, ${Object.keys(NOINDEX_ROUTES).length} noindex, ${Object.keys(PRIVATE_ROUTES).length} private, ${Object.keys(PORTAL_ROUTES).length} portal routes`);

for (const warning of warnings) console.log(`  warning: ${warning}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} SEO problem(s):`);
  for (const problem of problems) console.error(`  error: ${problem}`);
  process.exit(1);
}

console.log(`\nSEO pre-flight passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`);