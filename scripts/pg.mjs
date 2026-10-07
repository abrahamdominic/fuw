#!/usr/bin/env node
// Runs SQL against the linked Supabase project through the Management API.
//
//   node scripts/pg.mjs --file <path> [--dry-run] [--yes]
//
// --dry-run wraps the script in a transaction and rolls it back, so the whole
// migration is parsed, planned and executed against the real schema (catching
// syntax errors, bad FK targets, failing policies) without persisting anything.
// A real apply needs --yes, and is still a single transaction.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const PROJECT_REF = readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim();
const TOKEN = readFileSync(resolve(homedir(), '.supabase/access-token'), 'utf8').trim();
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const argv = process.argv.slice(2);
const fileIndex = argv.indexOf('--file');
if (fileIndex === -1) {
  console.error('usage: node scripts/pg.mjs --file <path> [--dry-run]');
  process.exit(1);
}

const dryRun = argv.includes('--dry-run');
const assumeYes = argv.includes('--yes');
const file = argv[fileIndex + 1];
const sql = readFileSync(file, 'utf8');

// Migration files carry their own BEGIN/COMMIT so that `supabase db push` and
// the SQL editor both get an all-or-nothing unit. That inner COMMIT would end
// the transaction this script opens, which silently turns --dry-run into a real
// apply: the trailing ROLLBACK then finds no transaction and does nothing.
// Strip the file's own transaction control before wrapping it.
const body = sql
  .replace(/^\s*BEGIN\s*;\s*$/gim, '')
  .replace(/^\s*(COMMIT|ROLLBACK)\s*;\s*$/gim, '');

if (!dryRun && !assumeYes) {
  console.error(`refusing to apply ${file} to ${PROJECT_REF} without --yes`);
  console.error('run with --dry-run first, then re-run with --yes to apply');
  process.exit(1);
}

// The Management API returns only the last statement's result set, which is
// enough for a go/no-go signal on the transaction wrapper.
//
// marketplace.allow_commit is 'off' only for --dry-run, so behavioural suites
// can assert they are running rolled back and refuse to be committed.
const allowCommit = dryRun ? 'off' : 'on';
const wrapped =
  `BEGIN;\nSET LOCAL marketplace.allow_commit = '${allowCommit}';\n${body}\n` +
  (dryRun ? 'ROLLBACK;' : 'COMMIT;');

const response = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: wrapped })
});

const result = await response.text();
const mode = dryRun ? 'DRY RUN (rolled back)' : 'APPLIED';

if (!response.ok) {
  console.error(`\n${mode} FAILED — HTTP ${response.status}`);
  console.error(result);
  process.exit(1);
}

console.log(`${mode} OK — ${file}`);
// Verification scripts return a transcript that is longer than a migration's
// single result row, so print it in full.
const CAP = argv.includes('--full') ? 200000 : 20000;
if (result && result !== '[]') {
  // Verification scripts return [{"line": "..."}]; render those as plain text so
  // the results are readable without the JSON scaffolding.
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object' && 'line' in parsed[0]) {
      console.log(parsed.map((r) => r.line).join('\n'));
    } else {
      console.log(result.slice(0, CAP));
    }
  } catch {
    console.log(result.slice(0, CAP));
  }
}