// =====================================================================
// FUW Mock CBT — question generation engine.
//
// Every question produced here is derived from the text of materials that
// students/administrators actually uploaded to the E-Library. Nothing in
// this module invents "practice question N" fillers: a question only exists
// when a real source sentence, past-question paper, or study question with a
// published answer could be found in an approved material.
//
// The module is intentionally dependency-free and pure so it can run both in
// the browser (as a fallback) and inside the Node seed script
// (scripts/build-cbt-bank.ts) that populates public.cbt_questions.
// =====================================================================

export type CbtQuestionKind = 'past_question' | 'study_question' | 'material_cloze';

export interface CbtSourcePage {
  page: number;
  text: string;
}

export interface GeneratedQuestion {
  courseCode: string;
  courseTitle?: string;
  question: string;
  options: Record<string, string>;
  correctOption: string;
  topic?: string;
  explanation?: string;
  kind: CbtQuestionKind;
  sourceMaterialId?: string;
  sourceTitle?: string;
  sourcePage?: number;
  dedupeKey?: string;
}

const STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'there', 'their', 'them', 'they',
  'with', 'from', 'into', 'which', 'where', 'when', 'while', 'would', 'could',
  'should', 'shall', 'have', 'has', 'had', 'being', 'been', 'some', 'such',
  'also', 'than', 'then', 'only', 'very', 'more', 'most', 'other', 'others',
  'each', 'both', 'many', 'much', 'same', 'used', 'using', 'use', 'one', 'two',
  'three', 'first', 'second', 'third', 'because', 'however', 'therefore', 'thus',
  'general', 'following', 'above', 'below', 'figure', 'table', 'chapter', 'page',
  'example', 'examples', 'note', 'notes', 'part', 'type', 'types', 'form', 'forms',
]);

/** Sentence openers that can never be a meaningful cloze answer. */
const BANNED_TERM_OPENERS = new Set([
  'it', 'this', 'these', 'those', 'they', 'there', 'he', 'she', 'we', 'you', 'i',
  'that', 'such', 'some', 'many', 'most', 'however', 'therefore', 'thus', 'hence',
  'if', 'when', 'while', 'although', 'because', 'in', 'on', 'at', 'by', 'for',
  'from', 'with', 'as', 'and', 'or', 'but', 'so', 'also', 'what', 'which', 'who',
  'whose', 'these', 'here', 'then', 'now', 'all', 'any', 'one', 'two', 'there',
]);

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes a published answer such as "(d) Sepal", "(b) 62%" or "a) Cytoplasm"
 * into the bare answer text "Sepal" / "62%" / "Cytoplasm". A letter on its own
 * is left untouched so it can be resolved against parsed options.
 */
function cleanAnswer(value: string): string {
  const trimmed = collapse(value).replace(/^[:\-–—=\s]+/, '');
  const withLetter = trimmed.match(/^\(?\s*([a-dA-D])\s*\)?\s*[.)]?\s+(\S[\s\S]*)$/);
  if (withLetter) return collapse(withLetter[2]);
  return trimmed;
}

/** Lowercase, punctuation-free form used for comparison and dedupe keys. */
export function normalizeText(value: string): string {
  return collapse(
    (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
  );
}

/** Deterministic FNV-1a hash (browser + node safe, no crypto dependency). */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildDedupeKey(courseCode: string, question: string): string {
  return `${courseCode}::${hashString(normalizeText(question))}`;
}

/**
 * Deterministically places the correct option at a non-fixed position so the
 * answer is not always "A" while still being reproducible across seed runs.
 */
export function toOptionMap(
  correct: string,
  distractors: string[],
  seed: string
): { options: Record<string, string>; correctOption: string } {
  const cleaned: string[] = [];
  const seen = new Set<string>([normalizeText(correct)]);
  for (const d of distractors) {
    const key = normalizeText(d);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(collapse(d));
    if (cleaned.length === 3) break;
  }
  if (cleaned.length < 3) return { options: {}, correctOption: '' };

  const all = [collapse(correct), ...cleaned];
  const rotateBy = Number.parseInt(hashString(seed).slice(0, 4), 16) % all.length;
  const ordered = [...all.slice(rotateBy), ...all.slice(0, rotateBy)];
  const letters = ['A', 'B', 'C', 'D'];
  const options: Record<string, string> = {};
  let correctOption = 'A';
  ordered.forEach((value, index) => {
    options[letters[index]] = value;
    if (value === collapse(correct)) correctOption = letters[index];
  });
  return { options, correctOption };
}

const CODE_RE = /\b([A-Z]{2,4})\s?-?\s?(\d{3})([A-Za-z])?\b/g;

function prefixDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

/** Snaps a raw "CHEM102" style code onto the closest catalogue code (e.g. CHM102C). */
function snapToKnownCode(base: string, known: Set<string>): string | null {
  const parsed = base.match(/^([A-Z]{2,4})(\d{3})([A-Z])?$/);
  if (!parsed) return null;
  const [, prefix, digits, suffix] = parsed;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const code of known) {
    const knownParsed = code.match(/^([A-Z]{2,4})(\d{3})/);
    if (!knownParsed || knownParsed[2] !== digits) continue;
    if (suffix && code.endsWith(suffix) && knownParsed[1] === prefix) return code;
    const distance = prefixDistance(prefix, knownParsed[1]);
    if (distance <= 1 && distance < bestDistance) {
      best = code;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Derives the course code a material genuinely covers. Uploaded files are often
 * bulk-assigned to a single placeholder course code, so the catalogue (known
 * codes) and the title are preferred, with the stored code as the last resort.
 */
export function deriveCourseCode(
  title: string | undefined,
  storedCode: string | undefined,
  knownCodes: Iterable<string> = []
): string {
  const known = new Set<string>();
  for (const code of knownCodes) known.add(code.toUpperCase());

  const upperTitle = (title || '').toUpperCase().replace(/_/g, ' ');

  // 1. Prefer any catalogue course code whose subject+number appears in the title.
  for (const code of known) {
    const match = code.match(/^([A-Z]{2,4})(\d{3})/);
    if (!match) continue;
    const pattern = new RegExp(`\\b${match[1]}\\s?-?\\s?${match[2]}\\b`);
    if (pattern.test(upperTitle)) return code;
  }

  // 2. Fall back to the first subject/number token in the title.
  CODE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_RE.exec(upperTitle))) {
    const [, prefix, digits, suffix] = match;
    const base = `${prefix}${digits}`;
    const candidates = [suffix ? `${base}${suffix.toUpperCase()}` : '', `${base}C`, `${base}F`, base];
    for (const candidate of candidates) if (candidate && known.has(candidate)) return candidate;
    const snapped = snapToKnownCode(suffix ? `${base}${suffix.toUpperCase()}` : base, known);
    if (snapped) return snapped;
    if (suffix) return `${base}${suffix.toUpperCase()}`;
    return base;
  }

  const normalizedStored = (storedCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (known.has(normalizedStored)) return normalizedStored;
  return normalizedStored || 'GENERAL';
}

interface ParsedOption {
  letter: string;
  text: string;
}

function parseOptions(body: string): ParsedOption[] {
  const options: ParsedOption[] = [];
  const seen = new Set<string>();
  const paren = /\(([a-dA-D])\)\s*([^\n()]+?)(?=\s*\([a-dA-D]\)|\s*\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = paren.exec(body))) {
    const letter = m[1].toUpperCase();
    const text = collapse(m[2].replace(/[.;,]+$/, ''));
    if (text && !seen.has(letter)) {
      seen.add(letter);
      options.push({ letter, text });
    }
  }
  if (options.length >= 2) return options;

  const dotted = /\b([a-dA-D])[.)]\s+([^()\n]+?)(?=\s+[a-dA-D][.)]\s|\s*\n|$)/g;
  while ((m = dotted.exec(body))) {
    const letter = m[1].toUpperCase();
    const text = collapse(m[2].replace(/[.;,]+$/, ''));
    if (text && !seen.has(letter)) {
      seen.add(letter);
      options.push({ letter, text });
    }
  }
  return options;
}

function resolveOption(parsed: ParsedOption[], answer: string): string {
  const normalizedAnswer = normalizeText(answer);
  if (!normalizedAnswer) return '';

  const letterOnly = normalizedAnswer.match(/^(?:option\s*)?([a-d])$/);
  if (letterOnly) {
    const wanted = letterOnly[1].toUpperCase();
    if (parsed.some((o) => o.letter === wanted)) return wanted;
  }

  let best = '';
  let bestScore = 0;
  for (const option of parsed) {
    const optionKey = normalizeText(option.text);
    if (!optionKey) continue;
    if (optionKey === normalizedAnswer) return option.letter;
    if (normalizedAnswer.includes(optionKey) || optionKey.includes(normalizedAnswer)) {
      const score = Math.min(optionKey.length, normalizedAnswer.length);
      if (score > bestScore) {
        bestScore = score;
        best = option.letter;
      }
    }
  }
  return best;
}

/** Questions a material explicitly answers (past papers / solved assignments). */
export function parseAnsweredQuestions(
  rawText: string,
  opts: {
    courseCode: string;
    courseTitle?: string;
    sourceMaterialId?: string;
    sourceTitle?: string;
    termPool?: string[];
  }
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const text = (rawText || '').replace(/\r/g, '');
  const blockRe = /(?:^|\n)\s*(\d{1,3})[.)]\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}[.)]\s)|\s*$)/g;
  let match: RegExpExecArray | null;
  let lastPage = 1;

  const documentAnswers: string[] = [];
  for (const answerHit of text.matchAll(/Answer\s*:\s*\*?\s*([^\n*]+?)\s*\*?\s*(?:\n|$)/gi)) {
    const value = cleanAnswer(answerHit[1]);
    if (value && value.length <= 60) documentAnswers.push(value);
  }
  const fallbackPool = () => [...(opts.termPool || []), ...documentAnswers];

  while ((match = blockRe.exec(text))) {
    const body = match[2];
    const pageMarker = body.match(/--\s*(\d+)\s+of\s+\d+\s*--/i);
    if (pageMarker) lastPage = Number(pageMarker[1]);

    const answerMatch = body.match(/Answer\s*:\s*\*?\s*([^\n*]+?)\s*\*?\s*(?:\n|$)/i);
    if (!answerMatch) continue;
    const answer = cleanAnswer(answerMatch[1]);

    const explanationMatch = body.match(/Explanation\s*:\s*([\s\S]*)/i);
    const withoutAnswer = body
      .replace(/Answer\s*:\s*[\s\S]*$/i, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ');

    const parsed = parseOptions(withoutAnswer);
    let options: Record<string, string> = {};
    let correctOption = '';

    if (parsed.length >= 2) {
      correctOption = resolveOption(parsed, answer);
      if (!correctOption) continue;
      parsed.forEach((o) => {
        options[o.letter] = o.text;
      });
    } else if (/^(true|false)$/i.test(answer)) {
      options = { A: 'True', B: 'False' };
      correctOption = /^true$/i.test(answer) ? 'A' : 'B';
    } else {
      // Open-ended question with a published answer: convert to an MCQ using
      // the document's own answers / course glossary for distractors.
      let distractors = numericDistractors(answer);
      if (distractors.length < 3) {
        distractors = fallbackPool().filter((term) => normalizeText(term) !== normalizeText(answer));
      }
      const built = toOptionMap(answer, distractors, `${opts.courseCode}:${withoutAnswer}`);
      if (!built.correctOption) continue;
      options = built.options;
      correctOption = built.correctOption;
    }

    const question = collapse(
      withoutAnswer
        .replace(/\(([a-dA-D])\)\s*[^\n()]+/g, ' ')
        .replace(/\b([a-dA-D])[.)]\s+[^()\n]+/g, ' ')
        .replace(/[_]{2,}/g, '________')
    );
    if (question.length < 12) continue;

    const item: GeneratedQuestion = {
      courseCode: opts.courseCode,
      courseTitle: opts.courseTitle,
      question,
      options,
      correctOption,
      topic: 'Past/Test Question',
      explanation:
        (explanationMatch ? collapse(explanationMatch[1]) : '') ||
        `Answer key published in "${opts.sourceTitle || 'the source material'}".`,
      kind: 'past_question',
      sourceMaterialId: opts.sourceMaterialId,
      sourceTitle: opts.sourceTitle,
      sourcePage: lastPage,
    };
    item.dedupeKey = buildDedupeKey(opts.courseCode, question);
    out.push(item);
  }
  return out;
}

function numericDistractors(value: string): string[] {
  const numberMatch = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!numberMatch) return [];
  const numeric = Number(numberMatch[0]);
  if (!Number.isFinite(numeric) || numeric === 0) return [];
  return [2, 0.5, 1.5, 0.25].map((factor) => {
    const raw = numeric * factor;
    const rounded = Math.abs(raw) >= 10 ? Math.round(raw) : Number(raw.toFixed(2));
    return value.replace(numberMatch[0], String(rounded));
  });
}

/**
 * Study/exercise sheets that publish answers inline, e.g.
 * "3. The force per unit charge is called ____ [ans.: electric field intensity]".
 */
export function parseInlineAnswerQuestions(
  rawText: string,
  opts: {
    courseCode: string;
    courseTitle?: string;
    sourceMaterialId?: string;
    sourceTitle?: string;
    termPool?: string[];
  }
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const text = (rawText || '').replace(/\r/g, '');
  const blockRe = /(?:^|\n)\s*(\d{1,3})[.)]\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}[.)]\s)|\s*$)/g;
  let match: RegExpExecArray | null;
  let lastPage = 1;

  const documentAnswers: string[] = [];
  for (const answerHit of text.matchAll(/\[(?:ans|answer)[.:]?\s*([^\]]+)\]/gi)) {
    const value = cleanAnswer(answerHit[1]);
    if (value && value.length <= 60) documentAnswers.push(value);
  }

  while ((match = blockRe.exec(text))) {
    const body = match[2];
    const pageMarker = body.match(/--\s*(\d+)\s+of\s+\d+\s*--/i);
    if (pageMarker) lastPage = Number(pageMarker[1]);

    const answerMatch = body.match(/\[(?:ans|answer)[.:]?\s*([^\]]+)\]/i);
    if (!answerMatch) continue;
    const answer = cleanAnswer(answerMatch[1]);
    if (!answer || answer.length > 60) continue;

    const withoutAnswer = body
      .replace(/\[(?:ans|answer)[.:]?\s*[^\]]+\]/gi, ' ')
      .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ');

    const parsed = parseOptions(withoutAnswer);
    let options: Record<string, string> = {};
    let correctOption = '';

    if (parsed.length >= 2) {
      const letter = resolveOption(parsed, answer);
      if (!letter) continue;
      parsed.forEach((o) => {
        options[o.letter] = o.text;
      });
      correctOption = letter;
    } else {
      let distractors = numericDistractors(answer);
      if (distractors.length < 3) {
        distractors = [...(opts.termPool || []), ...documentAnswers].filter(
          (term) => normalizeText(term) !== normalizeText(answer)
        );
      }
      const built = toOptionMap(answer, distractors, `${opts.courseCode}:${withoutAnswer}`);
      if (!built.correctOption) continue;
      options = built.options;
      correctOption = built.correctOption;
    }

    const question = collapse(
      withoutAnswer
        .replace(/\(([a-dA-D])\)\s*[^\n()]+/g, ' ')
        .replace(/\b([a-dA-D])[.)]\s+[^()\n]+/g, ' ')
    );
    if (question.length < 12) continue;

    const item: GeneratedQuestion = {
      courseCode: opts.courseCode,
      courseTitle: opts.courseTitle,
      question: /[_]{2,}/.test(question) ? question : `${question} ________`,
      options,
      correctOption,
      topic: 'Study Question',
      explanation: `Answer published in "${opts.sourceTitle || 'the source material'}".`,
      kind: 'study_question',
      sourceMaterialId: opts.sourceMaterialId,
      sourceTitle: opts.sourceTitle,
      sourcePage: lastPage,
    };
    item.dedupeKey = buildDedupeKey(opts.courseCode, item.question);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------
// Definitional cloze generation from lecture-note prose.
// ---------------------------------------------------------------------

/** <Term> is/are [defined as|known as|called|the|a|an] <clause> */
const DEFINITION_RE =
  /\b([A-Z][A-Za-z0-9()\-'’]{1,44}(?:\s+[A-Za-z0-9()\-'’]{1,20}){0,4})\s+(is|are)\s+(defined as|known as|called|referred to as|the|a|an)\s+([^.;!?\n]{20,240})/g;

/** <Term> refers to / means <clause> */
const REFER_RE =
  /\b([A-Z][A-Za-z0-9()\-'’]{1,44}(?:\s+[A-Za-z0-9()\-'’]{1,20}){0,4})\s+(refers to|means)\s+([^.;!?\n]{20,240})/g;

/** Reverse definition: <clause> is called / known as <Term>. */
const REVERSE_RE =
  /\b([^.;!?\n]{25,240}?)\s+(is|are)\s+(called|known as|termed|referred to as)\s+([A-Z][A-Za-z0-9()\-'’]{2,44}(?:\s+[A-Za-z0-9()\-'’]{1,20}){0,3})/g;

function termWords(term: string): string[] {
  return normalizeText(term).split(' ').filter(Boolean);
}

/** Course-administration boilerplate is never a valid question or answer. */
const BOILERPLATE =
  /(your course|this course|the course|tutor-marked|\btma\b|study guide|assessment exercise|self-assessment|\bassessment\b|\bexercise\b|\bmodule\b|\bunit\s+\d|open university|table of contents|learning outcomes|worked example|\bactivity\s+\d|given below|\bnext\b|answer the following|read the|in this unit|\bintroduction\b|\bsource of\b|\bpreface\b|\bcontents\b|\boverview\b|\bsummary\b|\bconclusion\b|\bobjectives?\b|\breferences\b|\bbibliography\b|\bfurther reading\b)/i;

function hasBoilerplate(value: string): boolean {
  return BOILERPLATE.test(value);
}

function looksLikeTerm(value: string): boolean {
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  if (!/[aeiouAEIOU]/.test(value)) return false;
  if (letters.length / value.length < 0.6) return false;
  return true;
}

function isUsableTerm(term: string): boolean {
  const cleaned = collapse(term);
  if (cleaned.length < 3 || cleaned.length > 55) return false;
  const words = termWords(cleaned);
  if (words.length === 0 || words.length > 5) return false;
  if (BANNED_TERM_OPENERS.has(words[0])) return false;
  if (words.every((word) => STOPWORDS.has(word))) return false;
  if (/^\d+$/.test(words[0])) return false;
  if (!looksLikeTerm(cleaned)) return false;
  if (hasBoilerplate(cleaned)) return false;
  return true;
}

function isUsableClause(clause: string): boolean {
  const cleaned = collapse(clause).replace(/[;,]+$/, '');
  if (cleaned.length < 20 || cleaned.length > 260) return false;
  if (/https?:|www\./i.test(cleaned)) return false;
  if (/\b(?:figure|table|equation|fig)\b\.?\s*\d/i.test(cleaned)) return false;
  if (hasBoilerplate(cleaned)) return false;
  const words = cleaned.split(' ').filter((word) => /[A-Za-z]/.test(word));
  if (words.length < 4) return false;
  return true;
}

/** Joins hard-wrapped PDF lines that continue the same sentence. */
function unwrapLines(value: string): string {
  return value.replace(/([a-z0-9,;:)\]%])\n(?=[a-z0-9(])/g, '$1 ');
}

function headingBefore(text: string, index: number, fallback: string): string {
  const prefix = text.slice(0, index);
  const lines = prefix.split('\n');
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 12; i -= 1) {
    const line = lines[i].trim();
    if (line.length < 4 || line.length > 48) continue;
    if (!/^[A-Z0-9][A-Z0-9 &,():'-]+$/.test(line)) continue;
    if (line.replace(/[^A-Za-z]/g, '').length < 4) continue;
    return collapse(line);
  }
  return fallback;
}

function matchToQuestion(
  match: RegExpMatchArray,
  mode: 'definition' | 'refer' | 'reverse'
): { term: string; question: string } | null {
  let term: string;
  let clause: string;

  if (mode === 'definition') {
    const [, foundTerm, verb, article, foundClause] = match;
    term = foundTerm;
    clause = foundClause;
    const middle = [verb, article].filter(Boolean).join(' ');
    term = collapse(term);
    clause = collapse(clause);
    if (!isUsableTerm(term) || !isUsableClause(clause)) return null;
    if (normalizeText(clause).split(' ').includes(normalizeText(term))) return null;
    return { term, question: `________ ${middle} ${clause}`.replace(/\s+/g, ' ').trim() };
  }

  if (mode === 'refer') {
    const [, foundTerm, verb, foundClause] = match;
    term = collapse(foundTerm);
    clause = collapse(foundClause);
    if (!isUsableTerm(term) || !isUsableClause(clause)) return null;
    if (normalizeText(clause).split(' ').includes(normalizeText(term))) return null;
    return { term, question: `________ ${verb} ${clause}`.replace(/\s+/g, ' ').trim() };
  }

  const [, foundClause, isAre, verb, foundTerm] = match;
  term = collapse(foundTerm);
  clause = collapse(foundClause);
  if (!isUsableTerm(term) || !isUsableClause(clause)) return null;
  if (normalizeText(clause).split(' ').includes(normalizeText(term))) return null;
  return { term, question: `${clause} ${isAre} ${verb} ________`.replace(/\s+/g, ' ').trim() };
}

function pickDistractors(answer: string, pool: string[], seed: string): string[] {
  const answerKey = normalizeText(answer);
  const candidates = pool.filter((term) => {
    const key = normalizeText(term);
    if (!key || key === answerKey) return false;
    if (key.includes(answerKey) || answerKey.includes(key)) return false;
    if (hasBoilerplate(term) || !looksLikeTerm(term)) return false;
    return true;
  });
  if (candidates.length < 3) return [];
  const offset = Number.parseInt(hashString(seed).slice(0, 4), 16) % candidates.length;
  const picked: string[] = [];
  for (let i = 0; i < candidates.length && picked.length < 3; i += 1) {
    const candidate = candidates[(offset + i) % candidates.length];
    if (!picked.includes(candidate)) picked.push(candidate);
  }
  return picked;
}

/** Definition/cloze questions built from real sentences in lecture notes. */
export function generateClozeQuestions(
  pages: CbtSourcePage[],
  opts: {
    courseCode: string;
    courseTitle?: string;
    sourceMaterialId?: string;
    sourceTitle?: string;
    termPool?: string[];
    maxPerMaterial?: number;
  }
): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const seen = new Set<string>();
  const pool = opts.termPool || [];
  const max = opts.maxPerMaterial ?? 30;

  for (const page of pages) {
    if (out.length >= max) break;
    const text = unwrapLines((page.text || '').replace(/\r/g, ''));
    for (const [mode, regex] of [
      ['definition', DEFINITION_RE],
      ['refer', REFER_RE],
      ['reverse', REVERSE_RE],
    ] as const) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        if (out.length >= max) break;
        const built = matchToQuestion(match as unknown as RegExpMatchArray, mode);
        if (!built) continue;
        const key = normalizeText(built.question);
        if (seen.has(key)) continue;
        seen.add(key);

        const distractors = pickDistractors(built.term, pool, built.question);
        if (distractors.length < 3) continue;

        const optionMap = toOptionMap(built.term, distractors, `${opts.courseCode}:${built.question}`);
        if (!optionMap.correctOption) continue;

        const item: GeneratedQuestion = {
          courseCode: opts.courseCode,
          courseTitle: opts.courseTitle,
          question: built.question,
          options: optionMap.options,
          correctOption: optionMap.correctOption,
          topic: headingBefore(text, match.index ?? 0, opts.courseTitle || 'Core Concepts'),
          explanation: `From "${opts.sourceTitle || 'uploaded material'}" (page ${page.page}): ${collapse(
            match[0]
          )}`,
          kind: 'material_cloze',
          sourceMaterialId: opts.sourceMaterialId,
          sourceTitle: opts.sourceTitle,
          sourcePage: page.page,
        };
        item.dedupeKey = buildDedupeKey(opts.courseCode, built.question);
        out.push(item);
      }
    }
  }
  return out;
}

/** Collects candidate definition terms used as cloze distractors. */
export function collectTerms(pages: CbtSourcePage[]): string[] {
  const terms = new Set<string>();
  for (const page of pages) {
    const text = unwrapLines((page.text || '').replace(/\r/g, ''));
    for (const regex of [DEFINITION_RE, REFER_RE, REVERSE_RE]) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        const term = collapse(regex === REVERSE_RE ? match[4] : match[1]);
        if (isUsableTerm(term)) terms.add(term);
      }
    }
  }
  return [...terms];
}

/** Removes duplicates within a course, preferring explicitly answered questions. */
export function dedupeQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  const priority: Record<CbtQuestionKind, number> = {
    past_question: 0,
    study_question: 1,
    material_cloze: 2,
  };
  const best = new Map<string, GeneratedQuestion>();
  for (const question of questions) {
    const key = question.dedupeKey || buildDedupeKey(question.courseCode, question.question);
    const existing = best.get(key);
    if (!existing || priority[question.kind] < priority[existing.kind]) {
      best.set(key, question);
    }
  }
  return [...best.values()].sort((a, b) => priority[a.kind] - priority[b.kind]);
}
