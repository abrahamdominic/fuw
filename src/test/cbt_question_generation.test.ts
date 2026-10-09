import { describe, it, expect } from 'vitest';
import {
  deriveCourseCode,
  parseAnsweredQuestions,
  parseInlineAnswerQuestions,
  generateClozeQuestions,
  dedupeQuestions,
} from '../lib/cbtGenerate';

const KNOWN = ['BIO102C', 'CHM102C', 'PHY102C', 'MTH102C', 'MCB102F'];

describe('deriveCourseCode', () => {
  it('reads the course code out of the material title first', () => {
    expect(deriveCourseCode('CHM 102 THE MAIN', 'BIO102C', KNOWN)).toBe('CHM102C');
    expect(deriveCourseCode('PHY_102_STUDY_QUESTIONS_2024_new', 'BIO102C', KNOWN)).toBe('PHY102C');
  });

  it('falls back to the stored code when the title has no code', () => {
    expect(deriveCourseCode('lecture note one', 'BIO102C', KNOWN)).toBe('BIO102C');
  });
});

describe('parseAnsweredQuestions', () => {
  const text = [
    '1. The Units of classification are called Taxa TRUE OR FALSE?',
    'Answer: *TRUE*',
    'Explanation: Taxa are the units of classification.',
    '',
    '2. Pitcher plant is an example of ........',
    '(a) Insectivorous plant (b) Parasite (c) Sundew (d) Saprophyte',
    'Answer: *(a) Insectivorous plant*',
  ].join('\n');

  it('parses a true/false question', () => {
    const qs = parseAnsweredQuestions(text, { courseCode: 'BIO102C' });
    const tf = qs.find((q) => /Taxa/i.test(q.question));
    expect(tf).toBeTruthy();
    expect(tf!.options).toEqual({ A: 'True', B: 'False' });
    expect(tf!.correctOption).toBe('A');
    expect(tf!.kind).toBe('past_question');
  });

  it('parses an MCQ and its published answer letter', () => {
    const qs = parseAnsweredQuestions(text, { courseCode: 'BIO102C' });
    const mcq = qs.find((q) => /Pitcher plant/i.test(q.question));
    expect(mcq).toBeTruthy();
    expect(mcq!.correctOption).toBe('A');
    expect(mcq!.options[mcq!.correctOption]).toBe('Insectivorous plant');
  });

  it('never answers a question that has no published answer', () => {
    const qs = parseAnsweredQuestions('1. An unanswered question?\n(a) One (b) Two', {
      courseCode: 'BIO102C',
    });
    expect(qs).toHaveLength(0);
  });
});

describe('parseInlineAnswerQuestions', () => {
  const text = [
    '12. What is the force on a charge of 4 C moving perpendicular to a magnetic flux density of 0.20T at 3m/s. [ans.: 2.4 N]',
    '13. The unit of magnetic flux density is [Ans.: Tesla]',
  ].join('\n');

  it('strips the leading punctuation from a published numeric answer', () => {
    const qs = parseInlineAnswerQuestions(text, {
      courseCode: 'PHY102C',
      termPool: ['Tesla', 'Weber', 'Henry', 'Farad'],
    });
    const force = qs.find((q) => /force on a charge/i.test(q.question));
    expect(force).toBeTruthy();
    expect(force!.options[force!.correctOption]).toBe('2.4 N');
    expect(Object.values(force!.options).some((v) => v.startsWith(':'))).toBe(false);
  });

  it('builds a question from a non-numeric published answer', () => {
    const qs = parseInlineAnswerQuestions(text, {
      courseCode: 'PHY102C',
      termPool: ['Weber', 'Henry', 'Farad'],
    });
    const unit = qs.find((q) => /unit of magnetic flux density/i.test(q.question));
    expect(unit).toBeTruthy();
    expect(unit!.kind).toBe('study_question');
  });
});

describe('generateClozeQuestions', () => {
  const pages = [
    {
      page: 1,
      text: 'Hybridization is a theoretical concept which enables realistic modelling of molecular structure.',
    },
    {
      page: 2,
      text: 'Tutor-Marked Assignment is the assessment exercise for this course unit.',
    },
  ];

  it('builds a cloze question from a real definitional sentence', () => {
    const qs = generateClozeQuestions(pages, {
      courseCode: 'CHM102C',
      sourceTitle: 'CHM 102 note',
      termPool: ['Hybridization', 'Isomerism', 'Covalent bond', 'Alkane'],
    });
    const q = qs.find((item) => item.correctOption && Object.values(item.options).includes('Hybridization'));
    expect(q).toBeTruthy();
    expect(q!.kind).toBe('material_cloze');
    expect(q!.question).toContain('________');
  });

  it('rejects course-administration boilerplate as a question source', () => {
    const qs = generateClozeQuestions(pages, {
      courseCode: 'CHM102C',
      termPool: ['Tutor-Marked Assignment', 'Isomerism', 'Covalent bond', 'Alkane'],
    });
    expect(qs.some((q) => Object.values(q.options).includes('Tutor-Marked Assignment'))).toBe(false);
  });
});

describe('dedupeQuestions', () => {
  it('keeps the highest-priority copy of a duplicate question', () => {
    const base = {
      courseCode: 'BIO102C',
      question: 'The Units of classification are called Taxa TRUE OR FALSE?',
      options: { A: 'True', B: 'False' },
      correctOption: 'A',
      kind: 'material_cloze' as const,
    };
    const better = { ...base, kind: 'past_question' as const };
    const result = dedupeQuestions([base, better]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('past_question');
  });
});
