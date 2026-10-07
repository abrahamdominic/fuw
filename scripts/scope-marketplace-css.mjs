#!/usr/bin/env node
/**
 * Scope the Marketplace stylesheet under `.mp-root`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Marketplace stylesheets were written when it was a standalone SPA, so
 * every selector is global. Mounted inside the E Library shell they collide
 * with 46 identically named classes (`.card`, `.btn-primary`, `.form-input`,
 * `.grid`, `.skeleton`, `.toast-item`, `.drawer`, `.hero`, ...) and re-declare
 * `:root` design tokens the platform already owns. The result is silent visual
 * corruption in BOTH directions.
 *
 * `.mp-root` is the wrapper on the Marketplace shell (`src/marketplace/App.tsx`),
 * so rewriting each selector to `.mp-root <selector>` confines the whole design
 * system to that subtree and leaves `src/styles.css` untouched.
 *
 * USAGE
 *   node scripts/scope-marketplace-css.mjs            # dry run + collision report
 *   node scripts/scope-marketplace-css.mjs --write    # rewrite in place
 *
 * Idempotent: selectors that already start with `.mp-root` are left alone.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = '.mp-root';
const STYLES_DIR = join(ROOT, 'src/marketplace/styles');
const WRITE = process.argv.includes('--write');

/** At-rules whose bodies hold selectors that must NOT be scoped. */
const ATOMIC_AT_RULES = new Set([
  '@keyframes',
  '@-webkit-keyframes',
  '@-moz-keyframes',
  '@font-face',
  '@property',
  '@page',
  '@charset',
  '@import',
  '@namespace'
]);

/** Find the matching `}` for the `{` at `open`, or the end of input. */
function matchBrace(css, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < css.length; i += 1) {
    const c = css[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return css.length;
}

/** Find the `;` that terminates a bodyless at-rule, ignoring url(...) and strings. */
function findStatementEnd(css, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < css.length; i += 1) {
    const c = css[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') { depth += 1; continue; }
    if (c === ')') { depth -= 1; continue; }
    if (depth > 0) continue;
    if (c === ';') return i;
    if (c === '{') return -1;
  }
  return -1;
}

/** Split a selector list on top-level commas. */
function splitSelectors(prelude) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (const ch of prelude) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Selectors that anchor on an ANCESTOR of the Marketplace subtree rather than
 * on an element inside it.
 *
 * The theme lives on `<html data-theme="dark">`, which wraps `.mp-root`, so
 * `[data-theme='dark'] h1` has to become `[data-theme='dark'] .mp-root h1` —
 * prefixing naively would produce a descendant that never matches.
 */
const ANCESTOR_ANCHOR = /^(\[data-theme[^\]]*\]|html|body|:root)(\s|$)/i;

/** True when `.mp-root` already appears as its own compound in `sel`. */
function alreadyScoped(sel) {
  return /(^|[\s>+~])\.mp-root(?![\w-])/.test(sel);
}

function scopeSelector(selector) {
  const sel = selector.trim();
  if (!sel) return sel;
  if (alreadyScoped(sel)) return sel;

  // `html`, `body` and `:root` cannot be nested — `.mp-root` is their stand-in.
  if (/^(html|body|:root)$/i.test(sel)) return SCOPE;
  if (/^html\s+body$/i.test(sel)) return SCOPE;

  const anchor = ANCESTOR_ANCHOR.exec(sel);
  if (anchor) {
    const head = anchor[1];
    const tail = sel.slice(head.length).replace(/^\s+/, '');
    // Ancestor anchoring now: append the scope instead of prepending it.
    return tail ? `${head} ${SCOPE} ${tail}` : `${head} ${SCOPE}`;
  }

  return `${SCOPE} ${sel}`;
}

/**
 * From `from`, skip whitespace and CSS comments, returning the offset of the
 * first character that can actually belong to a selector.
 *
 * A rule is usually preceded by a banner comment; without this the comment
 * text would be parsed as a selector and rewritten.
 */
function skipTrivia(text, from) {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') { i += 1; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Rewrite `css`, prefixing each style-rule selector with `.mp-root`.
 * Comments, strings and atomic at-rules (@keyframes, @font-face) survive intact.
 */
export function scopeCss(css) {
  let out = '';
  let i = 0;
  // Offset in `out` where the current rule's prelude begins. Advanced past
  // every completed block or statement so a leading comment is never mistaken
  // for a selector.
  let ruleStart = 0;

  while (i < css.length) {
    const ch = css[i];

    // Comment.
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    // At-rule.
    if (ch === '@') {
      const semi = findStatementEnd(css, i);
      if (semi !== -1) {
        out += css.slice(i, semi + 1);
        i = semi + 1;
        ruleStart = out.length;
        continue;
      }

      const open = css.indexOf('{', i);
      if (open === -1) { out += css.slice(i); break; }

      const prelude = css.slice(i, open).trim();
      const close = matchBrace(css, open);
      const head = prelude.split(/[\s(]/)[0].toLowerCase();

      if (ATOMIC_AT_RULES.has(head)) {
        out += css.slice(i, close + 1);
        i = close + 1;
        ruleStart = out.length;
        continue;
      }

      const body = css.slice(open + 1, close);
      // The body is copied verbatim (only its selectors change) so re-running
      // this script can never re-indent a file an extra level.
      out += `${prelude} {${scopeCss(body)}}`;
      i = close + 1;
      ruleStart = out.length;
      continue;
    }

    // Style rule: rewrite the prelude already sitting in `out`.
    if (ch === '{') {
      const open = i;
      const close = matchBrace(css, open);
      const from = skipTrivia(out, ruleStart);
      const selText = out.slice(from).replace(/\s+$/, '');

      if (!selText.trim()) {
        // Should not happen, but never drop input: copy verbatim.
        out += css.slice(open, close + 1);
        i = close + 1;
        ruleStart = out.length;
        continue;
      }

      const body = css.slice(open + 1, close);
      const scoped = splitSelectors(selText).map(scopeSelector).join(',\n');

      // Trim the seam so re-running never accumulates blank lines.
      const head = out.slice(0, from).replace(/\s+$/, '');
      out = head + '\n' + scoped + ' {' + body + '}';
      i = close + 1;
      ruleStart = out.length;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Class names used by a stylesheet (for the collision report). */
function collectClasses(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set();
  for (const m of clean.matchAll(/([^{}@]+)\{/g)) {
    for (const c of m[1].matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(c[1]);
  }
  return classes;
}

function main() {
  const files = readdirSync(STYLES_DIR).filter((f) => f.endsWith('.css')).sort();
  const platformClasses = collectClasses(readFileSync(join(ROOT, 'src/styles.css'), 'utf8'));

  let changed = 0;
  const collisions = new Set();

  for (const file of files) {
    const path = join(STYLES_DIR, file);
    const before = readFileSync(path, 'utf8');

    for (const c of collectClasses(before)) {
      if (platformClasses.has(c)) collisions.add(c);
    }

    const after = scopeCss(before);
    if (after === before) continue;
    changed += 1;
    if (WRITE) writeFileSync(path, after, 'utf8');
  }

  console.log(
    `scoped ${files.length} stylesheet(s); ${changed} rewritten${WRITE ? '' : ' (dry run)'}`
  );
  console.log(`platform/Marketplace class-name collisions: ${collisions.size}`);
  if (collisions.size) console.log('  ' + [...collisions].sort().join(', '));
  if (!WRITE && changed > 0) console.log('\nre-run with --write to apply');
}

if (process.argv[1] && process.argv[1].endsWith('scope-marketplace-css.mjs')) {
  main();
}
