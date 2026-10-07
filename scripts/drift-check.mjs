import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const TOKEN = readFileSync(resolve(homedir(), '.supabase/access-token'), 'utf8').trim();
const REF = readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim();

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

const defs = await q(`
  select p.proname,
         pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'guard_campus_media_upload','dispatch_academic_reminders',
      'stamp_assignment_submission','admin_record_grade',
      'notify_grade_published','queue_notification','my_gpa_summary'
    )
  order by 1;`);

if (typeof defs === 'string') {
  console.log(defs.slice(0, 1000));
  process.exit(1);
}

const checks = {
  'guard_campus_media_upload': {
    fixed: /metadata ->> 'size'/.test('') || false,
    tests: [
      ['reads size from metadata (fixed)', (d) => /metadata\s*->>\s*'size'/.test(d)],
      ['still references NEW.size (BUG)', (d) => /NEW\.size/.test(d)],
      ['last-segment extension (fixed)', (d) => /substring\(NEW\.name FROM/.test(d)],
      ['resolves uploader from owner_id (fixed)', (d) => /NEW\.owner_id/.test(d)],
      ['does NOT compare the path to auth.uid() (BUG)', (d) => !/DISTINCT FROM auth\.uid\(\)/.test(d)]
    ]
  },
  'dispatch_academic_reminders': {
    tests: [
      ['suppression-aware (fixed)', (d) => /v_notified IS NOT NULL/.test(d)]
    ]
  },
  'stamp_assignment_submission': {
    tests: [
      ['server-authoritative submitted_at (fixed)', (d) => /statement_timestamp\(\)|clock_timestamp\(\)|now\(\)/.test(d) && !/NEW\.submitted_at\s*IS DISTINCT FROM NULL/.test(d)]
    ]
  },
  'admin_record_grade': {
    tests: [
      ['selects band by letter (fixed)', (d) => /letter\s*=/.test(d)]
    ]
  }
};

for (const row of defs) {
  const spec = checks[row.proname];
  console.log(`\n${row.proname}`);
  if (!spec) {
    console.log('  (live, no drift check defined)');
    continue;
  }
  for (const [label, fn] of spec.tests) {
    console.log(`  ${fn(row.def) ? 'YES' : 'no '}  ${label}`);
  }
}