import type { CuratedQuestion } from '../data/cbt/curriculum/types';
import { CURATED_BANKS, dedupeKeyForQuestion } from '../data/cbt/curriculum';

export interface BankValidationIssue {
  course: string;
  n: number;
  code: string;
  message: string;
}

/** Lower-cases, strips punctuation/whitespace so near-identical stems collide. */
export function normalizeQuestionText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '');
}

export function validateCuratedBank(
  courseCode: string,
  questions: CuratedQuestion[],
  minCount = 120
): BankValidationIssue[] {
  const issues: BankValidationIssue[] = [];
  if (questions.length !== minCount) {
    issues.push({ course: courseCode, n: 0, code: 'count', message: `expected ${minCount}, got ${questions.length}` });
  }

  const seenN = new Set<number>();
  const seenStem = new Map<string, number>();
  const check = (q: CuratedQuestion, cond: boolean, code: string, message: string) => {
    if (!cond) issues.push({ course: courseCode, n: q.n, code, message });
  };

  for (const q of questions) {
    check(q, Number.isInteger(q.n) && q.n >= 1 && q.n <= 100000, 'n', `n out of range: ${q.n}`);
    if (seenN.has(q.n)) issues.push({ course: courseCode, n: q.n, code: 'dup_n', message: 'duplicate n' });
    seenN.add(q.n);

    check(q, typeof q.q === 'string' && q.q.trim().length > 0 && q.q.trim().endsWith('?'), 'stem', 'question must be non-empty and end with ?');
    const stem = normalizeQuestionText(q.q);
    const prev = seenStem.get(stem);
    if (prev && prev !== q.n) issues.push({ course: courseCode, n: q.n, code: 'dup_stem', message: `identical to n:${prev}` });
    seenStem.set(stem, q.n);

    check(q, Array.isArray(q.o) && q.o.length === 4, 'options', 'must have exactly 4 options');
    if (Array.isArray(q.o)) {
      check(q, q.o.every((o) => typeof o === 'string' && o.trim().length > 0), 'options', 'every option must be a non-empty string');
      check(q, new Set(q.o.map((o) => o.trim())).size === q.o.length, 'options', 'options must be distinct');
      check(q, Number.isInteger(q.c) && q.c >= 0 && q.c < q.o.length, 'correct', `correct index out of range: ${q.c}`);
      if (Number.isInteger(q.c) && q.c >= 0 && q.c < q.o.length) {
        check(q, q.o.some((o) => o.trim().length > 0), 'correct', 'correct option cannot be blank');
      }
    }

    check(q, typeof q.t === 'string' && q.t.trim().length > 0, 'topic', 'topic required');
    check(q, typeof q.e === 'string' && q.e.trim().length > 0, 'explanation', 'explanation required');
    check(q, q.d === 'easy' || q.d === 'medium' || q.d === 'hard', 'difficulty', `invalid difficulty: ${q.d}`);
  }

  return issues;
}

export interface CuratedBankReport {
  courseCode: string;
  courseTitle: string;
  count: number;
  issues: BankValidationIssue[];
  valid: boolean;
}

export function validateAllCuratedBanks(minCount = 120): CuratedBankReport[] {
  return CURATED_BANKS.map((bank) => {
    const issues = validateCuratedBank(bank.courseCode, bank.questions, minCount);
    const valid = issues.length === 0;
    if (!valid) {
      const difficulty = bank.questions.reduce<Record<string, number>>((acc, q) => {
        acc[q.d] = (acc[q.d] ?? 0) + 1;
        return acc;
      }, {});
      // eslint-disable-next-line no-console
      console.error(
        `[cbt] ${bank.courseCode} invalid (${issues.length}) count=${bank.questions.length} difficulty=${JSON.stringify(difficulty)}`
      );
    }
    return { courseCode: bank.courseCode, courseTitle: bank.courseTitle, count: bank.questions.length, issues, valid };
  });
}

export { dedupeKeyForQuestion };