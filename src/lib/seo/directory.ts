// =====================================================================
// FUW E-Library — public directory helpers.
//
// The static catalogue (src/data/catalogue.ts) is the authoritative source
// for faculties, departments and courses. These helpers derive stable,
// human-readable URL slugs from it and expose lookups used by both the
// runtime router and the build-time sitemap generator, so a page and its
// sitemap entry can never disagree about what a URL means.
// =====================================================================

import {
  catalogue,
  COLLEGE_OF_HEALTH_SCIENCES,
  type Course,
  type Department,
  type Faculty,
  type SemesterKey
} from '../../data/catalogue';

/** URL-safe slug. Ampersands collapse to a single separator, never dropped. */
export function slugify(value: string): string {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Faculty of Bio-Sciences" -> "Bio-Sciences" (used in page titles). */
export function shortFacultyName(name: string): string {
  return name.replace(/^Faculty of\s+/i, '').trim() || name;
}

export function facultySlug(faculty: Pick<Faculty, 'name'>): string {
  return slugify(faculty.name);
}

export function departmentSlug(department: Pick<Department, 'name'>): string {
  return slugify(department.name);
}

export function courseSlug(code: string): string {
  return slugify(code);
}

export interface DepartmentEntry {
  faculty: Faculty;
  department: Department;
  slug: string;
  path: string;
  courseCount: number;
}

export interface CourseOccurrence {
  course: Course;
  level: number;
  semester: SemesterKey;
  faculty: Faculty;
  department: Department;
}

export interface CourseEntry {
  code: string;
  slug: string;
  path: string;
  /** The course title as it appears in the catalogue (canonical spelling). */
  title: string;
  /** Every faculty/department offering that lists this course code. */
  occurrences: CourseOccurrence[];
  levels: number[];
  semesters: SemesterKey[];
}

export const FACULTY_PATH_PREFIX = '/faculties';
export const DEPARTMENT_PATH_PREFIX = '/departments';
export const COURSE_PATH_PREFIX = '/courses';

/** All faculties, in catalogue order, with their canonical public URL. */
export function facultyEntries(): Array<{ faculty: Faculty; slug: string; path: string }> {
  return catalogue.map((faculty) => ({
    faculty,
    slug: facultySlug(faculty),
    path: `${FACULTY_PATH_PREFIX}/${facultySlug(faculty)}`
  }));
}

/** All departments, in catalogue order, with their canonical public URL. */
export function departmentEntries(): DepartmentEntry[] {
  const out: DepartmentEntry[] = [];
  for (const faculty of catalogue) {
    for (const department of faculty.departments) {
      out.push({
        faculty,
        department,
        slug: departmentSlug(department),
        path: `${DEPARTMENT_PATH_PREFIX}/${departmentSlug(department)}`,
        courseCount: countCourses(department)
      });
    }
  }
  return out;
}

/** Count distinct curriculum rows for a department. */
export function countCourses(department: Department): number {
  const codes = new Set<string>();
  for (const [, sems] of Object.entries(department.curriculum || {})) {
    for (const [, list] of Object.entries(sems || {})) {
      for (const course of list || []) codes.add(course.code.trim().toUpperCase());
    }
  }
  return codes.size;
}

/** Every course code in the catalogue, de-duplicated, with all offerings. */
export function courseEntries(): CourseEntry[] {
  const byCode = new Map<string, CourseOccurrence[]>();
  const titles = new Map<string, string>();

  for (const faculty of catalogue) {
    for (const department of faculty.departments) {
      for (const [levelKey, sems] of Object.entries(department.curriculum || {})) {
        const level = Number(levelKey);
        for (const [semester, list] of Object.entries(sems || {})) {
          for (const course of list || []) {
            const code = course.code.trim().toUpperCase();
            const occurrence: CourseOccurrence = {
              course,
              level,
              semester: semester as SemesterKey,
              faculty,
              department
            };
            const existing = byCode.get(code);
            if (existing) existing.push(occurrence);
            else byCode.set(code, [occurrence]);
            if (!titles.has(code)) titles.set(code, course.name.trim());
          }
        }
      }
    }
  }

  const entries: CourseEntry[] = [];
  for (const [code, occurrences] of byCode) {
    const title = titles.get(code) || code;
    entries.push({
      code,
      title,
      slug: courseSlug(code),
      path: `${COURSE_PATH_PREFIX}/${courseSlug(code)}`,
      occurrences,
      levels: Array.from(new Set(occurrences.map((o) => o.level))).sort((a, b) => a - b),
      semesters: Array.from(new Set(occurrences.map((o) => o.semester)))
    });
  }
  return entries.sort((a, b) => a.code.localeCompare(b.code));
}

export function findFacultyBySlug(slug: string): Faculty | null {
  const target = String(slug || '').toLowerCase();
  return catalogue.find((f) => facultySlug(f) === target) || null;
}

export function findDepartmentBySlug(slug: string): DepartmentEntry | null {
  const target = String(slug || '').toLowerCase();
  for (const entry of departmentEntries()) {
    if (entry.slug === target) return entry;
  }
  return null;
}

export function findCourseBySlug(slug: string): CourseEntry | null {
  const target = String(slug || '').toLowerCase();
  return courseEntries().find((c) => c.slug === target) || null;
}

/**
 * Accepts either a slug or a raw course code so deep links from older
 * material records (which stored codes) keep resolving.
 */
export function findCourseByCode(codeOrSlug: string): CourseEntry | null {
  const raw = String(codeOrSlug || '').trim();
  if (!raw) return null;
  const normalised = raw.replace(/\s+/g, '');
  return (
    courseEntries().find(
      (c) => c.slug === slugify(raw) || c.code.replace(/\s+/g, '').toLowerCase() === normalised.toLowerCase()
    ) || null
  );
}

export function facultyOfDepartment(departmentName: string): Faculty | null {
  for (const faculty of catalogue) {
    if (faculty.departments.some((d) => d.name === departmentName)) return faculty;
  }
  return null;
}

export const DIRECTORY_TOTALS = {
  faculties: catalogue.length,
  departments: catalogue.reduce((acc, f) => acc + f.departments.length, 0),
  courses: courseEntries().length,
  courseRows: catalogue.reduce(
    (acc, f) => acc + f.departments.reduce((a, d) => a + countCourses(d), 0),
    0
  ),
  healthSciencesFaculties: catalogue.filter((f) => f.college === COLLEGE_OF_HEALTH_SCIENCES).length
};

/** Grouped faculties (colleges first) for the directory landing page. */
export function directoryGroups(): Array<{ college: string | null; faculties: Faculty[] }> {
  const groups: Array<{ college: string | null; faculties: Faculty[] }> = [];
  const seen = new Set<string | null>();

  for (const faculty of catalogue) {
    const key = faculty.college || null;
    if (!seen.has(key)) {
      seen.add(key);
      groups.push({ college: key, faculties: [] });
    }
    groups.find((g) => g.college === key)!.faculties.push(faculty);
  }
  return groups;
}