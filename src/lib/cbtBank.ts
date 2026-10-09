import { supabase, requireSupabase } from './supabase';
import { courseTitleByCode } from '../data/catalogue';

export interface CbtBankQuestion {
  id: string;
  courseCode: string;
  courseTitle: string;
  question: string;
  options: Record<string, string>;
  correctOption: string;
  topic: string;
  explanation: string;
  kind: string;
  sourceTitle: string | null;
  sourcePage: number | null;
}

export interface CbtBankCourse {
  courseCode: string;
  courseTitle: string;
  count: number;
}

const MAX_QUESTIONS = 120;

function mapRow(row: any): CbtBankQuestion {
  return {
    id: String(row.id),
    courseCode: row.course_code,
    courseTitle: row.course_title || courseTitleByCode(row.course_code) || row.course_code,
    question: row.question,
    options: (row.options || {}) as Record<string, string>,
    correctOption: row.correct_option,
    topic: row.topic || 'Core Concepts',
    explanation: row.explanation || '',
    kind: row.question_kind || 'material_cloze',
    sourceTitle: row.source_title || null,
    sourcePage: typeof row.source_page === 'number' ? row.source_page : null,
  };
}

/**
 * Lists the courses that actually have active CBT questions, together with the
 * number of questions each one has. Courses with no extracted questions are
 * deliberately omitted rather than shown as empty shells.
 */
export async function fetchCbtCourses(): Promise<CbtBankCourse[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('cbt_questions')
    .select('course_code, course_title')
    .eq('is_active', true)
    .limit(5000);
  if (error) throw new Error(error.message);

  const counts = new Map<string, CbtBankCourse>();
  for (const row of data || []) {
    const code = (row as any).course_code as string;
    if (!code) continue;
    const existing = counts.get(code);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(code, {
        courseCode: code,
        courseTitle:
          (row as any).course_title || courseTitleByCode(code) || code,
        count: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

/**
 * Loads practice questions for a course (or every course when `courseCode` is
 * null/`ALL`). The RLS policy on `cbt_questions` only exposes rows whose source
 * material is approved, so a student only ever sees bank-sourced questions.
 */
export async function fetchCbtQuestions(
  courseCode?: string | null
): Promise<CbtBankQuestion[]> {
  const client = requireSupabase();
  let query = client
    .from('cbt_questions')
    .select(
      'id, course_code, course_title, question, options, correct_option, topic, explanation, question_kind, source_title, source_page'
    )
    .eq('is_active', true)
    .order('course_code', { ascending: true })
    .limit(MAX_QUESTIONS);

  if (courseCode && courseCode !== 'ALL') {
    query = query.eq('course_code', courseCode);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(mapRow).filter((q) => q.question && q.correctOption);
}
