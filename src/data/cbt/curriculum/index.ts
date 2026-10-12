import type { CuratedQuestion } from './types';
import { COURSE_CODE as BIO_CODE, COURSE_TITLE as BIO_TITLE, QUESTIONS as BIO_QUESTIONS } from './bio102c';
import { COURSE_CODE as CHM_CODE, COURSE_TITLE as CHM_TITLE, QUESTIONS as CHM_QUESTIONS } from './chm102c';
import { COURSE_CODE as PHY_CODE, COURSE_TITLE as PHY_TITLE, QUESTIONS as PHY_QUESTIONS } from './phy102c';
import { COURSE_CODE as MTH_CODE, COURSE_TITLE as MTH_TITLE, QUESTIONS as MTH_QUESTIONS } from './mth102c';
import { COURSE_CODE as MCB_CODE, COURSE_TITLE as MCB_TITLE, QUESTIONS as MCB_QUESTIONS } from './mcb102f';

export interface CuratedBank {
  courseCode: string;
  courseTitle: string;
  questions: CuratedQuestion[];
}

export const CURATED_BANKS: CuratedBank[] = [
  { courseCode: BIO_CODE, courseTitle: BIO_TITLE, questions: BIO_QUESTIONS },
  { courseCode: CHM_CODE, courseTitle: CHM_TITLE, questions: CHM_QUESTIONS },
  { courseCode: PHY_CODE, courseTitle: PHY_TITLE, questions: PHY_QUESTIONS },
  { courseCode: MTH_CODE, courseTitle: MTH_TITLE, questions: MTH_QUESTIONS },
  { courseCode: MCB_CODE, courseTitle: MCB_TITLE, questions: MCB_QUESTIONS },
];

const BY_COURSE = new Map<string, CuratedBank>(CURATED_BANKS.map((b) => [b.courseCode, b]));

export const CURATED_COURSE_CODES = CURATED_BANKS.map((b) => b.courseCode);

export function curatedBankForCourse(courseCode: string): CuratedBank | undefined {
  return BY_COURSE.get(courseCode);
}

export function dedupeKeyForQuestion(courseCode: string, n: number): string {
  return `CUR-${courseCode}-${String(n).padStart(3, '0')}`;
}