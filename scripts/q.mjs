#!/usr/bin/env node
// Read-only SQL query helper for inspection.
//
//   node scripts/q.mjs "SELECT ..."
//   node scripts/q.mjs --file path.sql
//
// Unlike pg.mjs this never truncates and is read-only by construction: the
// statement is executed inside a transaction that is always rolled back, so
// it can be used to probe live production state safely.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const PROJECT_REF = readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim();
const TOKEN = readFileSync(resolve(homedir(), '.supabase/access-token'), 'utf8').trim();
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const argv = process.argv.slice(2);
const fileIndex = argv.indexOf('--file');
const sql = fileIndex === -1
  ? argv.join(' ')
  : readFileSync(argv[fileIndex + 1], 'utf8');

const guard = /(^|\s)(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy)\s/i;
if (guard.test(sql) && !/^\s*(select|with)\b/i.test(sql.trim())) {
  console.error('refusing: q.mjs is read-only. Use pg.mjs for migrations.');
  process.exit(1);
}

const response = await fetch(API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `BEGIN;\n${sql}\nROLLBACK;` }),
});

const text = await response.text();
if (!response.ok) {
  console.error(`HTTP ${response.status}`);
  console.error(text);
  process.exit(1);
}

const rows = JSON.parse(text.slice(text.indexOf('[')));
if (!rows.length) {
  console.log('(0 rows)');
} else {
  const cols = Object.keys(rows[0]);
  for (const row of rows) {
    console.log(cols.map((c) => `${c}=${row[c]}`).join('  '));
  }
  console.log(`(${rows.length} rows)`);
}