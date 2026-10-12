#!/usr/bin/env tsx
// =====================================================================
// Seed the curated curriculum CBT banks into public.cbt_questions.
//
//   npx tsx scripts/seed-cbt-curated.ts --dry-run    # validate + report
//   npx tsx scripts/seed-cbt-curated.ts              # validate + upsert
//
// Every curated question is grounded in standard, examinable undergraduate
// science knowledge, carries a `curated` flag and a difficulty band, and is
// stored under a `CUR-<COURSE>-<NNN>` dedupe key so re-running is idempotent
// and it can never collide with material-derived (source_material_id) rows.
// =====================================================================
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import {
  CURATED_BANKS,
  dedupeKeyForQuestion,
} from '../src/data/cbt/curriculum';
import { validateAllCuratedBanks } from '../src/lib/cbtValidation';

const ROOT = resolve(import.meta.dirname, '..');
const LETTERS = ['A', 'B', 'C', 'D'] as const;

function loadEnv(): Record<string, string> {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) throw new Error('.env not found');
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

async function main() {
  console.log(`\nSeeding curated CBT banks ${DRY_RUN ? '(dry run — no DB writes)' : '(writing to database)'}\n`);

  const reports = validateAllCuratedBanks();
  const validBanks = reports.filter((r) => r.valid);
  for (const report of reports) {
    console.log(`  ${report.courseCode.padEnd(10)} ${String(report.count).padStart(3)} questions  ${report.valid ? 'OK' : `INVALID (${report.issues.length})`}`);
  }
  if (validBanks.length !== CURATED_BANKS.length) {
    console.error(`\n${CURATED_BANKS.length - validBanks.length} bank(s) failed validation — refusing to seed.`);
    process.exit(1);
  }
  if (validBanks.length === 0) {
    console.error('No curated banks found — refusing to seed.');
    process.exit(1);
  }

  const total = validBanks.reduce((sum, bank) => sum + bank.count, 0);
  console.log(`\nTotal curated questions: ${total}`);

  if (DRY_RUN) {
    console.log('Dry run complete. Re-run without --dry-run to write to public.cbt_questions.');
    return;
  }

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');

  const rows = validBanks.flatMap((bank) => {
    const curated = CURATED_BANKS.find((b) => b.courseCode === bank.courseCode);
    if (!curated) return [];
    return curated.questions.map((q) => {
      const options: Record<string, string> = {};
      q.o.forEach((value, index) => {
        options[LETTERS[index]] = value;
      });
      return {
        dedupe_key: dedupeKeyForQuestion(curated.courseCode, q.n),
        course_code: curated.courseCode,
        course_title: curated.courseTitle,
        question: q.q,
        options,
        correct_option: LETTERS[q.c],
        topic: q.t,
        explanation: q.e,
        question_kind: 'study_question',
        source_material_id: null,
        curated: true,
        difficulty: q.d,
        is_active: true,
      };
    });
  });

  const invalid = rows.filter(
    (row) => !row.options || typeof row.options !== 'object' || !LETTERS.includes(row.correct_option as (typeof LETTERS)[number])
  );
  if (invalid.length) throw new Error(`${invalid.length} rows have an answer not present in their options`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await fetch(`${supabaseUrl}/rest/v1/cbt_questions?on_conflict=dedupe_key`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`upsert failed -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    const written = (await res.json()) as unknown[];
    inserted += written.length;
  }
  console.log(`\nUpserted ${inserted} new curated questions (${rows.length - inserted} already existed — duplicates skipped).`);

  for (const report of reports) {
    const activeBank = reports.find((r) => r.courseCode === report.courseCode);
    if (activeBank) {
      console.log(`  ${report.courseCode.padEnd(10)} ${report.count} curated seeded`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});