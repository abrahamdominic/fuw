#!/usr/bin/env tsx
// =====================================================================
// Build the Mock CBT question bank from REAL uploaded E-Library materials.
//
//   npx tsx scripts/build-cbt-bank.ts --dry-run   # generate + report only
//   npx tsx scripts/build-cbt-bank.ts             # generate + upsert to DB
//   ... --limit 5                                  # process only 5 materials
//   ... --refresh                                  # ignore text cache
//
// The script downloads every approved material from the `library-materials`
// storage bucket, extracts its text, derives written questions (answered past
// papers, solved study sheets, and definitional cloze items from lecture
// notes) exactly as scripts/build-cbt-bank does at runtime, and upserts them
// into public.cbt_questions with ON CONFLICT DO NOTHING.
//
// There is no generated filler text anywhere: a question only exists when a
// real source sentence / past question with a published answer was found in an
// uploaded material. Re-running is idempotent.
// =====================================================================
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFParse } from 'pdf-parse';
import {
  collectTerms,
  dedupeQuestions,
  deriveCourseCode,
  generateClozeQuestions,
  parseAnsweredQuestions,
  parseInlineAnswerQuestions,
  type CbtSourcePage,
  type GeneratedQuestion,
} from '../src/lib/cbtGenerate';
import { allCoursesFlat, courseTitleByCode } from '../src/data/catalogue';

const ROOT = resolve(import.meta.dirname, '..');
const BUCKET = 'library-materials';
const CACHE_DIR = '/tmp/opencode/cbt-cache';

interface MaterialRow {
  id: string;
  title: string;
  course_code: string | null;
  course_title: string | null;
  material_type: string | null;
  status: string;
  file_path: string | null;
}

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
const REFRESH = args.includes('--refresh');
const limitIndex = args.indexOf('--limit');
const LIMIT = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;

const env = loadEnv();
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');

const rest = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
};

async function fetchApprovedMaterials(): Promise<MaterialRow[]> {
  const res = await rest(
    'materials?select=id,title,course_code,course_title,material_type,status,file_path&status=eq.approved&limit=2000'
  );
  return res.json();
}

async function download(path: string): Promise<Buffer> {
  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) throw new Error(`storage ${path} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface Extracted {
  pages: CbtSourcePage[];
  text: string;
  contentHash: string;
}

async function extractText(material: MaterialRow): Promise<Extracted | null> {
  if (!material.file_path) return null;
  const cacheKey = createHash('sha1').update(material.file_path).digest('hex');
  const cacheFile = `${CACHE_DIR}/${cacheKey}.json`;
  if (!REFRESH && existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as Extracted;
    return cached.pages.length ? cached : null;
  }

  const buffer = await download(material.file_path);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages: CbtSourcePage[] = (result.pages || []).map((page: { num?: number; text?: string }, index: number) => ({
      page: page.num ?? index + 1,
      text: page.text || '',
    }));
    const text = (result.text || '').replace(/\r/g, '');
    const extracted: Extracted = {
      pages,
      text,
      contentHash: createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex'),
    };
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(extracted));
    return text.replace(/\s+/g, ' ').trim().length >= 400 ? extracted : null;
  } finally {
    await parser.destroy?.();
  }
}

function isLikelyPastPaper(material: MaterialRow, text: string): boolean {
  if (/past\s*question|test\s*pq|exam|solution|study\s*question/i.test(material.title || '')) return true;
  const answered = (text.match(/Answer\s*:/gi) || []).length;
  const inline = (text.match(/\[(?:ans|answer)[.:]/gi) || []).length;
  return answered + inline >= 3;
}

async function main() {
  console.log(`\nBuilding CBT question bank ${DRY_RUN ? '(dry run — no DB writes)' : '(writing to database)'}\n`);
  const knownCodes = new Set(allCoursesFlat().map((course) => course.code.toUpperCase()));
  const materials = (await fetchApprovedMaterials()).slice(0, LIMIT);
  console.log(`Approved materials scanned: ${materials.length}`);

  // Phase 1 — extract text, deduplicate identical uploads by content hash.
  const sources: Array<{ material: MaterialRow; extracted: Extracted; courseCode: string }> = [];
  const seenHashes = new Set<string>();
  let skippedNoText = 0;

  for (const material of materials) {
    try {
      const extracted = await extractText(material);
      if (!extracted) {
        skippedNoText += 1;
        continue;
      }
      if (seenHashes.has(extracted.contentHash)) continue;
      seenHashes.add(extracted.contentHash);
      const courseCode = deriveCourseCode(material.title, material.course_code || undefined, knownCodes);
      sources.push({ material, extracted, courseCode });
    } catch (error) {
      console.warn(`  ! failed to extract "${material.title}": ${(error as Error).message}`);
    }
  }
  console.log(`Text-rich unique materials: ${sources.length} (skipped ${skippedNoText} image-only/scanned)`);

  // Phase 2 — build a per-course glossary used as cloze distractors.
  const termsByCourse = new Map<string, string[]>();
  for (const source of sources) {
    const pool = termsByCourse.get(source.courseCode) || [];
    for (const term of collectTerms(source.extracted.pages)) pool.push(term);
    termsByCourse.set(source.courseCode, pool);
  }

  // Phase 3 — generate questions, grouped per course.
  const byCourse = new Map<string, GeneratedQuestion[]>();
  for (const source of sources) {
    const { material, extracted, courseCode } = source;
    const common = {
      courseCode,
      courseTitle: material.course_title || courseTitleByCode(courseCode),
      sourceMaterialId: material.id,
      sourceTitle: material.title,
    };
    const pool = [...new Set(termsByCourse.get(courseCode) || [])];
    const questions: GeneratedQuestion[] = [];

    if (isLikelyPastPaper(material, extracted.text)) {
      questions.push(...parseAnsweredQuestions(extracted.text, { ...common, termPool: pool }));
      questions.push(...parseInlineAnswerQuestions(extracted.text, { ...common, termPool: pool }));
    }
    questions.push(
      ...generateClozeQuestions(extracted.pages, { ...common, termPool: pool, maxPerMaterial: 40 })
    );

    const existing = byCourse.get(courseCode) || [];
    byCourse.set(courseCode, existing.concat(questions));
  }

  let total = 0;
  const report: Array<{ course: string; title: string; count: number; kinds: Record<string, number> }> = [];
  for (const [courseCode, list] of byCourse) {
    const deduped = dedupeQuestions(list);
    byCourse.set(courseCode, deduped);
    const kinds = deduped.reduce<Record<string, number>>((acc, question) => {
      acc[question.kind] = (acc[question.kind] || 0) + 1;
      return acc;
    }, {});
    total += deduped.length;
    report.push({
      course: courseCode,
      title: courseTitleByCode(courseCode) || '',
      count: deduped.length,
      kinds,
    });
  }

  report.sort((a, b) => a.course.localeCompare(b.course));
  console.log('\nQuestions generated per course:');
  for (const row of report) {
    console.log(
      `  ${row.course.padEnd(10)} ${String(row.count).padStart(4)}  ` +
        `(past:${row.kinds.past_question || 0} study:${row.kinds.study_question || 0} cloze:${row.kinds.material_cloze || 0})  ${row.title}`
    );
  }
  console.log(`\nTotal distinct questions: ${total}`);

  // Show a sample so a human can confirm they are real, material-derived items.
  const sample = [...byCourse.values()].flat().find((question) => question.kind === 'past_question')
    || [...byCourse.values()].flat()[0];
  if (sample) {
    console.log('\nSample question:');
    console.log(`  [${sample.courseCode}] ${sample.question}`);
    for (const [letter, value] of Object.entries(sample.options)) {
      console.log(`    ${letter}) ${value}${letter === sample.correctOption ? '  <-- correct' : ''}`);
    }
    console.log(`  Source: ${sample.sourceTitle} (p.${sample.sourcePage})`);
  }

  if (args.includes('--samples')) {
    for (const [courseCode, list] of byCourse) {
      if (!list.length) continue;
      console.log(`\n----- ${courseCode} samples -----`);
      const seenKinds = new Set<string>();
      const picks = list.filter((question) => {
        if (seenKinds.has(question.kind)) return false;
        seenKinds.add(question.kind);
        return true;
      }).slice(0, 3);
      for (const question of [...picks, ...list.slice(0, 3)].slice(0, 4)) {
        console.log(`  Q: ${question.question}`);
        console.log(`     ${Object.entries(question.options).map(([k, v]) => `${k}) ${v}`).join('  |  ')}`);
        console.log(`     correct: ${question.correctOption}  [${question.kind}] ${question.sourceTitle} p.${question.sourcePage}`);
      }
    }
  }

  if (total === 0) {
    console.error('\nNo questions generated — refusing to write.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. Re-run without --dry-run to write to public.cbt_questions.');
    return;
  }

  const rows = [...byCourse.values()].flat().map((question) => ({
    dedupe_key: question.dedupeKey,
    course_code: question.courseCode,
    course_title: question.courseTitle || null,
    question: question.question,
    options: question.options,
    correct_option: question.correctOption,
    topic: question.topic || null,
    explanation: question.explanation || null,
    question_kind: question.kind,
    source_material_id: question.sourceMaterialId || null,
    source_title: question.sourceTitle || null,
    source_page: question.sourcePage ?? null,
  }));

  const invalid = rows.filter(
    (row) => !row.options || typeof row.options !== 'object' || !Object.keys(row.options).includes(row.correct_option)
  );
  if (invalid.length) throw new Error(`${invalid.length} questions have an answer not present in their options`);

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
    const written = await res.json();
    inserted += written.length;
  }
  console.log(`\nUpserted ${inserted} new questions (${rows.length - inserted} already existed — duplicates skipped).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
