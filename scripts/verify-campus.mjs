#!/usr/bin/env node
// Verifies the 20261005 campus/academics migrations against the real production
// schema without persisting anything.
//
//   node scripts/verify-campus.mjs
//
// Concatenates both migrations plus supabase/verify_campus_academics.sql into a
// single transaction that is always rolled back. Any failed assertion raises,
// which aborts the transaction, so a green run proves every RLS policy, storage
// guard and notification invariant actually holds on the live schema.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const PROJECT_REF = readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim();
const TOKEN = readFileSync(resolve(homedir(), '.supabase/access-token'), 'utf8').trim();

const parts = [
  'supabase/migrations/20261005_campus_media_and_notifications.sql',
  'supabase/migrations/20261005_academic_companion.sql',
  'supabase/verify_campus_academics.sql'
];

// The migrations carry their own BEGIN/COMMIT; strip them so the harness owns
// the single enclosing transaction. Line-exact anchors matter here — a loose
// /\s*BEGIN;/ would also eat the plpgsql block openers inside the bodies.
const body = parts
  .map((p) =>
    readFileSync(p, 'utf8')
      .replace(/^BEGIN;$/gm, '')
      .replace(/^COMMIT;$/gm, '')
  )
  .join('\n');

const response = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `BEGIN;\n${body}\nROLLBACK;` })
  }
);

const text = await response.text();

if (!response.ok) {
  console.error('\nVERIFICATION FAILED');
  const failed = text.match(/ASSERTION FAILED: [^"\\]+/);
  console.error(failed ? failed[0] : text.slice(0, 3000));
  process.exit(1);
}

console.log('\nVERIFICATION PASSED (all changes rolled back)');
console.log(text.slice(0, 1500));