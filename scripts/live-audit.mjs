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
    throw new Error(t.slice(0, 600));
  }
}

const NEW_TABLES = [
  'grading_scales', 'grading_scale_bands', 'lecturers', 'course_lecturers',
  'course_schedules', 'assignments', 'academic_events',
  'academic_calendar_entries', 'student_grades'
];

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// 1. Every new table exists and has RLS actually enabled (not just declared).
const rls = await q(`
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (${literal(NEW_TABLES)})
  order by 1;`.replace('$L', ''));

const map = Object.fromEntries(rls.map((r) => [r.relname, r.relrowsecurity]));
for (const t of NEW_TABLES) {
  check(`table ${t} exists with RLS on`, map[t] === true, map[t] === undefined ? 'missing' : String(map[t]));
}

// 2. The private bucket exists and is not public.
const buckets = await q(`select id, public from storage.buckets where id = 'campus-media';`);
check('campus-media bucket exists and is private',
  buckets.length === 1 && buckets[0].public === false,
  JSON.stringify(buckets[0] ?? null));

// 3. E-Library buckets and tables untouched.
const lib = await q(`
  select
    (select count(*) from storage.buckets
      where id in ('Files','Lib','library-materials','materials',
                   'payment-receipts','verification-evidence')) as buckets,
    (select count(*) from pg_policies where tablename = 'materials') as material_policies,
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name = 'materials') as materials_table;`);
check('all 6 original buckets still present', Number(lib[0].buckets) === 6, lib[0].buckets);
check('materials RLS policies intact', Number(lib[0].material_policies) > 0, lib[0].material_policies);
check('materials table intact', Number(lib[0].materials_table) === 1);

// 4. queue_notification is not callable by end users.
const grants = await q(`
  select has_function_privilege('anon', 'public.queue_notification(uuid,text,text,text,text,text,text)', 'EXECUTE')   as anon_exec,
         has_function_privilege('authenticated', 'public.queue_notification(uuid,text,text,text,text,text,text)', 'EXECUTE') as auth_exec,
         has_function_privilege('service_role', 'public.queue_notification(uuid,text,text,text,text,text,text)', 'EXECUTE') as svc_exec;`);
check('anon cannot execute queue_notification', grants[0].anon_exec === false);
check('authenticated cannot execute queue_notification', grants[0].auth_exec === false);
check('service_role can execute queue_notification', grants[0].svc_exec === true);

// 5. Default grading scale seeded and marked default.
const scales = await q(`select count(*) filter (where is_default) as def, count(*) filter (where is_active) as act, count(*) as total from grading_scales;`);
check('exactly one default grading scale', Number(scales[0].def) === 1, JSON.stringify(scales[0]));

// 6. Nothing leaked into the new tables.
const counts = await q(`
  select
    (select count(*) from assignments)          as assignments,
    (select count(*) from student_grades)       as grades,
    (select count(*) from lecturers)            as lecturers,
    (select count(*) from course_schedules)     as schedules,
    (select count(*) from academic_events)      as events;`);
check('no stray rows written by the migration',
  Object.values(counts[0]).every((v) => Number(v) === 0), JSON.stringify(counts[0]));

function literal(arr) {
  return `ARRAY[${arr.map((s) => `'${s}'`).join(',')}]`;
}

console.log(failures === 0 ? '\nLIVE CATALOG AUDIT PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);