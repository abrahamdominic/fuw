// Live (database-backed) course catalogue.
//
// The static `catalogue` in data/catalogue.ts is the deterministic structure
// used for forms and lookups, but it cannot reflect courses that admins publish
// straight into the `courses` table. This module merges those database courses
// into the static structure at runtime so that newly published courses appear
// everywhere immediately (public course directory, upload-form course
// dropdowns, admin management tables) without an approval step.
import { supabase } from './supabase';
import {
  catalogue as staticCatalogue,
  getCoursesForSelection,
  parseLevelNumber,
  type Course,
  type Faculty,
  type FlatCourse,
  type SemesterKey
} from '../data/catalogue';

export interface LiveCourseRow {
  id: string;
  code: string;
  title: string;
  level: number; // 100, 200, 300…
  semester: SemesterKey;
  department: string;
  faculty: string;
  created_by: string | null;
  created_at: string;
}

/** Single-flight cache so repeated consumers share one fetch. */
let cachePromise: Promise<LiveCourseRow[]> | null = null;

async function fetchLiveCoursesRaw(): Promise<LiveCourseRow[]> {
  const client = supabase;
  if (!client) return [];

  const [coursesRes, deptRes, levelRes, facRes] = await Promise.all([
    client.from('courses').select('id, department_id, level_id, semester, course_code, course_title, created_by, created_at'),
    client.from('departments').select('id, name, faculty_id'),
    client.from('levels').select('id, name'),
    client.from('faculties').select('id, name')
  ]);
  if (coursesRes.error || deptRes.error || levelRes.error || facRes.error) return [];

  const deptById = new Map((deptRes.data ?? []).map((d: any) => [d.id, d]));
  const levelById = new Map((levelRes.data ?? []).map((l: any) => [l.id, l]));
  const facById = new Map((facRes.data ?? []).map((f: any) => [f.id, f]));

  const rows: LiveCourseRow[] = [];
  for (const c of coursesRes.data ?? []) {
    const dept = deptById.get(c.department_id);
    const fac = dept ? facById.get(dept.faculty_id) : undefined;
    if (!dept || !fac) continue;
    const levelName = c.level_id ? levelById.get(c.level_id)?.name ?? '' : '';
    const level = parseLevelNumber(levelName);
    if (level == null) continue;
    const semester: SemesterKey | '' = c.semester;
    if (semester !== 'First Semester' && semester !== 'Second Semester') continue;
    rows.push({
      id: c.id,
      code: c.course_code,
      title: c.course_title,
      level,
      semester,
      department: dept.name,
      faculty: fac.name,
      created_by: c.created_by ?? null,
      created_at: c.created_at
    });
  }
  return rows;
}

export function getLiveCourseRows(): Promise<LiveCourseRow[]> {
  if (!cachePromise) {
    cachePromise = fetchLiveCoursesRaw().catch(() => {
      cachePromise = null;
      return [] as LiveCourseRow[];
    });
  }
  return cachePromise;
}

/** Drop the shared cache so the next call re-fetches from the database. */
export function invalidateLiveCourseCache(): void {
  cachePromise = null;
}

export function toFlatCourse(row: LiveCourseRow): FlatCourse {
  return {
    code: row.code,
    name: row.title,
    level: row.level,
    semester: row.semester,
    department: row.department,
    faculty: row.faculty
  };
}

/**
 * Merge database courses into the static catalogue tree. The static structure
 * stays authoritative (departments, durations, existing courses win); DB
 * courses only add novel (faculty/department/level/semester/code) entries.
 * The input tree is not mutated — a fresh copy is returned.
 */
export function mergeDbCourses(staticCat: Faculty[], db: LiveCourseRow[]): Faculty[] {
  const key = (f: string, d: string, l: number, s: string, c: string) =>
    `${f}\u0001${d}\u0001${l}\u0001${s}\u0001${c.toUpperCase()}`;

  const out: Faculty[] = staticCat.map((f) => ({
    ...f,
    departments: f.departments.map((dep) => ({
      name: dep.name,
      duration: dep.duration,
      courses: [...dep.courses],
      curriculum: Object.fromEntries(
        Object.entries(dep.curriculum).map(([lv, sems]) => [
          lv,
          Object.fromEntries(Object.entries(sems || {}).map(([s, cs]) => [s, [...cs]]))
        ])
      )
    }))
  }));

  const existing = new Set<string>();
  for (const f of out) {
    for (const dep of f.departments) {
      for (const c of dep.courses) {
        existing.add(key(f.name, dep.name, c.level, c.semester, c.code));
      }
    }
  }

  for (const row of db) {
    const k = key(row.faculty, row.department, row.level, row.semester, row.code);
    if (existing.has(k)) continue;
    const f = out.find((x) => x.name === row.faculty);
    if (!f) continue;
    const dep = f.departments.find((x) => x.name === row.department);
    if (!dep) continue;

    const flat = toFlatCourse(row);
    dep.courses.push(flat);
    const bucket = (dep.curriculum[row.level] ??= {});
    (bucket[row.semester] ??= []).push({ code: flat.code, name: flat.name });
    existing.add(k);
  }
  return out;
}

/** Merged catalogue with database-published courses included. */
export async function getMergedCatalogue(): Promise<Faculty[]> {
  const db = await getLiveCourseRows();
  return mergeDbCourses(staticCatalogue, db);
}

/**
 * Merged course options for a faculty/department/level/semester selection,
 * used by upload/selection forms so admin-published courses are selectable
 * immediately.
 */
export async function getMergedCoursesForSelection(
  faculty?: string | null,
  department?: string | null,
  level?: string | null,
  semester?: string | null
): Promise<Course[]> {
  const list = getCoursesForSelection(faculty, department, level, semester);
  const lvlNum = parseLevelNumber(level);
  if (!department || lvlNum == null) return list;

  const db = await getLiveCourseRows();
  const seen = new Set(list.map((c) => c.code.trim().toUpperCase()));
  for (const r of db) {
    if (r.faculty !== faculty || r.department !== department || r.level !== lvlNum) continue;
    if (semester && r.semester !== semester) continue;
    const code = r.code.trim().toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    list.push({ code: r.code, name: r.title });
  }
  return list;
}