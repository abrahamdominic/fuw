#!/usr/bin/env node
/**
 * Proves that the frontend state machine mirror
 * (fuw marketplace/src/lib/orderStateMachine.ts) still matches the live
 * PostgreSQL table `public.marketplace_order_transitions`, which is the
 * authority enforced by `mp_transition_order`.
 *
 * Read-only. Exits non-zero on drift.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR_PATH = path.join(
  REPO_ROOT,
  'fuw marketplace',
  'src',
  'lib',
  'orderStateMachine.ts'
);

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[key]) {
    console.error(`Missing env var ${key}`);
    process.exit(2);
  }
}

function parseMirror(source) {
  const blockMatch = source.match(
    /export const ORDER_TRANSITIONS[^=]*=\s*\[([\s\S]*?)\n\];/
  );
  if (!blockMatch) throw new Error('Could not locate ORDER_TRANSITIONS array');

  const entryRe =
    /\{\s*from:\s*'([a-z_]+)'\s*,\s*to:\s*'([a-z_]+)'\s*,\s*roles:\s*\[([^\]]*)\]\s*,?\s*\}/g;

  const entries = [];
  const seen = new Set();
  let match;
  while ((match = entryRe.exec(blockMatch[1])) !== null) {
    const [, from, to, rolesRaw] = match;
    const roles = rolesRaw
      .split(',')
      .map((r) => r.trim().replace(/'/g, ''))
      .filter(Boolean)
      .sort();
    const entry = { from, to, roles };
    const key = keyOf(entry);
    if (seen.has(key)) throw new Error(`Duplicate mirror entry: ${key}`);
    seen.add(key);
    entries.push(entry);
  }
  if (entries.length === 0) throw new Error('Parsed zero transitions from mirror');
  return entries;
}

function keyOf(entry) {
  return `${entry.from}->${entry.to}:${[...entry.roles].sort().join(',')}`;
}

const mirror = parseMirror(fs.readFileSync(MIRROR_PATH, 'utf8'));

const tableUrl =
  `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/marketplace_order_transitions` +
  `?select=from_status,to_status,actor_role`;

const res = await fetch(tableUrl, {
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
});

if (!res.ok) {
  console.error(`Failed to read transition table: ${res.status} ${await res.text()}`);
  process.exit(2);
}

const rows = await res.json();
const grouped = new Map();
for (const row of rows) {
  const key = `${row.from_status}->${row.to_status}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row.actor_role);
}

const dbEntries = [...grouped.entries()].map(([key, roles]) => {
  const [from, to] = key.split('->');
  return { from, to, roles: [...roles].sort() };
});

const mirrorKeys = new Set(mirror.map(keyOf));
const dbKeys = new Set(dbEntries.map(keyOf));

const missingFromMirror = dbEntries.filter((e) => !mirrorKeys.has(keyOf(e)));
const notInDatabase = mirror.filter((e) => !dbKeys.has(keyOf(e)));

console.log(`DB transitions:      ${dbEntries.length}`);
console.log(`Mirror transitions:  ${mirror.length}`);

if (missingFromMirror.length === 0 && notInDatabase.length === 0) {
  console.log('\nPASS: frontend state machine mirror matches the live database table.');
  process.exit(0);
}

console.error('\nFAIL: frontend state machine mirror has drifted from the database.\n');

if (missingFromMirror.length > 0) {
  console.error('In the database but missing from src/lib/orderStateMachine.ts:');
  for (const e of missingFromMirror) {
    console.error(`  ${e.from} -> ${e.to} [${e.roles.join(', ')}]`);
  }
  console.error('');
}

if (notInDatabase.length > 0) {
  console.error('In src/lib/orderStateMachine.ts but rejected by the database:');
  for (const e of notInDatabase) {
    console.error(`  ${e.from} -> ${e.to} [${e.roles.join(', ')}]`);
  }
  console.error('');
}

process.exit(1);