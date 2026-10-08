// Personalized "Suggested Materials" ranking for the student dashboard.
//
// Everything is computed from server-filtered queries (fetchMaterials applies
// the filters in Postgres), so we never download the whole library to rank it
// on the client. Ranking follows the product spec:
//
//   1. Exact course the student offers  +  student's own department    (highest)
//   2. Exact course the student offers  →  incl. shared/multi-dept courses
//   3. Any material assigned to the student's department (primary or via
//      material_departments)
//   4. Same faculty
//   5. Same level
//
// Materials that match nothing relevant are dropped (no popularity fallback).
import { fetchMaterials } from './materials';
import type { MaterialItem, AssignedDepartment } from './store';
import { normalizeLevel, getCoursesForSelection } from '../data/catalogue';
import { supabase } from './supabase';

export interface SuggestionReason {
  priority: number;
  label: string;
}

export interface SuggestedMaterial {
  material: MaterialItem;
  reason: SuggestionReason;
  score: number;
}

export interface SuggestionProfile {
  department: string;
  faculty: string;
  level: string;
  /** Course codes the student is offering (approved student_courses rows). */
  courseCodes: string[];
}

// Cap on per-course lookups so a student with a large course list never
// triggers an unbounded number of queries.
const MAX_COURSE_LOOKUPS = 8;

/** Official course codes for a department/level from the static curriculum
 *  catalogue — used when the student has not registered courses yet. */
function curriculumCourseCodes(profile: SuggestionProfile): string[] {
  const { faculty, department, level } = profile;
  if (!faculty || !department || !level) return [];
  const first = getCoursesForSelection(faculty, department, level, 'First Semester');
  const second = getCoursesForSelection(faculty, department, level, 'Second Semester');
  const codes = [...first, ...second].map((c) => c.code.trim().toUpperCase()).filter(Boolean);
  return Array.from(new Set(codes));
}

export async function fetchSuggestedMaterials(
  profile: SuggestionProfile,
  limit = 8
): Promise<SuggestedMaterial[]> {
  if (!supabase) return [];

  const department = profile.department?.trim();
  const faculty = profile.faculty?.trim();
  const level = profile.level?.trim();

  const registeredCodes = Array.from(new Set((profile.courseCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean)));
  // Fall back to the official curriculum when the student hasn't registered courses.
  let codes = registeredCodes;
  if (codes.length === 0) codes = curriculumCourseCodes(profile);
  codes = Array.from(new Set(codes.map((c) => c.toUpperCase())));

  // ── Server-filtered queries (parallel, capped) ─────────────────────────
  const jobs: Array<Promise<{ items: MaterialItem[] }>> = [];
  if (department) {
    // Restrict department queries to student's level when available to avoid cross-level leakage (e.g. 100L appearing for 400L)
    jobs.push(fetchMaterials({ status: 'approved', department, level: level || undefined }, {}, 0, 40));
  } else if (faculty) {
    // No department known: fall back to the whole faculty.
    jobs.push(fetchMaterials({ status: 'approved', faculty, level: level || undefined }, {}, 0, 40));
  }
  if (faculty) {
    // Same faculty but other departments (ranking tier 4).
    jobs.push(fetchMaterials({ status: 'approved', faculty, level: level || undefined }, {}, 0, 40));
  }
  for (const code of codes.slice(0, MAX_COURSE_LOOKUPS)) {
    jobs.push(fetchMaterials({ status: 'approved', courseCode: code }, {}, 0, 10));
  }

  // ── Rank locally ───────────────────────────────────────────────────────
  const deptKey = department.toLowerCase();
  const codeSet = new Set(codes.map((c) => c.toLowerCase()));
  const seen = new Set<string>();
  const scored: SuggestedMaterial[] = [];

  const consider = (material: MaterialItem) => {
    if (material.status !== 'approved') return;
    if (seen.has(material.id)) return;
    seen.add(material.id);

    const matDept = (material.department || '').trim();
    const assignedDepts = (material.assignedDepartments ?? []).map(
      (d: AssignedDepartment) => (d.name || '').trim().toLowerCase()
    );
    const deptHit =
      !!department && (matDept.toLowerCase() === deptKey || assignedDepts.includes(deptKey));
    const course = (material.course || '').trim().toUpperCase();
    const courseHit = codeSet.has(course.toLowerCase());
    const facHit = !!faculty && (material.faculty || '').trim().toLowerCase() === faculty.toLowerCase();
    const levelHit = !!level && normalizeLevel(material.level) === normalizeLevel(level);

    // Level guard: Never recommend material from a different level unless the student explicitly offers/registered that course
    const matLevel = normalizeLevel(material.level);
    const userLevel = normalizeLevel(level);
    if (userLevel && matLevel && matLevel !== userLevel && !courseHit) {
      return;
    }

    let score: number;
    let label: string;
    if (courseHit && deptHit) {
      score = 100;
      label = `Recommended because you offer ${course}`;
    } else if (courseHit) {
      score = 90;
      label = `Recommended because you offer ${course}`;
    } else if (deptHit) {
      score = 80;
      label = matDept ? `Recommended for ${matDept}` : 'Recommended for your department';
    } else if (facHit) {
      score = 40;
      label = `Recommended for ${faculty}`;
    } else if (levelHit) {
      score = 20;
      label = `Recommended for ${level}`;
    } else {
      return; // Not relevant — never surface unrelated popular material.
    }

    scored.push({ material, reason: { priority: score, label }, score });
  };

  for (const r of await Promise.allSettled(jobs)) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value.items) consider(item);
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.material.createdAt || '').localeCompare(a.material.createdAt || '')
  );

  return scored.slice(0, limit);
}

/** Approved course codes for the current student (from student_courses). */
export async function fetchStudentCourseCodes(): Promise<string[]> {
  if (!supabase) return [];
  try {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('student_courses')
      .select('course_code')
      .eq('student_id', user.id)
      .eq('status', 'approved');
    if (error || !data) return [];
    return Array.from(new Set(data.map((r: any) => r.course_code).filter(Boolean))) as string[];
  } catch {
    return [];
  }
}