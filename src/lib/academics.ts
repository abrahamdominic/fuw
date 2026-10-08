// Data layer for the academic companion: grading, lecturers, timetables,
// assignments, examinations and the institution-wide calendar.
//
// Every write goes through a SECURITY DEFINER RPC rather than a direct table
// insert. That is deliberate: the RPCs re-check has_permission() server-side and
// set ownership columns from auth.uid(), so the browser can never claim to be an
// admin or assign a grade to somebody else even if the UI is bypassed.
import { requireSupabase } from './supabase';

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const;

export type AssignmentStatus = 'not_started' | 'in_progress' | 'submitted' | 'completed';
/** Mirrors the priority CHECK constraint on assignments. */
export const ASSIGNMENT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type AssignmentPriority = (typeof ASSIGNMENT_PRIORITIES)[number];
/** Mirrors the event_type CHECK constraint on academic_events. */
export const ACADEMIC_EVENT_TYPES = ['test', 'examination'] as const;
export type AcademicEventType = (typeof ACADEMIC_EVENT_TYPES)[number];
/** Mirrors the category CHECK constraint on academic_calendar_entries. */
export const CALENDAR_CATEGORIES = [
  'Orientation',
  'Registration',
  'Lectures',
  'Mid-semester break',
  'Examination',
  'Holiday',
  'Convocation',
  'Other'
] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

export interface GradingBand {
  id: string;
  letter: string;
  gradePoint: number;
  minScore: number;
  maxScore: number;
  isPassing: boolean;
  sortOrder: number;
}

export interface GradingScale {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  bands: GradingBand[];
}

export interface Lecturer {
  id: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
  staffEmail: string | null;
  phone: string | null;
  officeLocation: string;
  academicRank: string;
  bio: string;
  isActive: boolean;
}

export interface CourseLecturer {
  id: string;
  courseId: string;
  lecturerId: string;
  lecturerName: string | null;
  isPrimary: boolean;
  sessionName: string | null;
}

export interface CourseSchedule {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  lecturerId: string | null;
  lecturerName: string | null;
  sessionName: string | null;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  venue: string;
}

export interface Assignment {
  id: string;
  courseId: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  title: string;
  description: string;
  dueDate: string | null;
  priority: AssignmentPriority;
  status: AssignmentStatus;
  attachmentPath: string | null;
  submittedAt: string | null;
  grade: string;
  feedback: string;
  reminderAt: string | null;
}

export interface AcademicEvent {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  eventType: AcademicEventType;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  notes: string;
  durationMinutes: number | null;
}

export interface CalendarEntry {
  id: string;
  title: string;
  description: string;
  category: CalendarCategory;
  startsOn: string;
  endsOn: string;
  isPublished: boolean;
}

export interface StudentGrade {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  units: number | null;
  gradeLetter: string;
  gradePoint: number;
  sessionName: string | null;
  isPublished: boolean;
}

export interface GpaSummary {
  /** null when no published grade carries credit units yet. */
  cumulativeCgpa: number | null;
  currentSessionGpa: number | null;
  totalUnits: number;
  currentUnits: number;
  coursesCounted: number;
  academicSessionId: string | null;
}

function relation(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? {};
  return (value as Record<string, unknown>) ?? {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function throwOn(error: { message: string; code?: string } | null): void {
  if (error) throw new Error(error.message);
}

/** PostgREST returns `time` columns as "HH:MM:SS"; trim for display. */
export function formatClock(value: string): string {
  return value.slice(0, 5);
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatRange(startsAt: string, endsAt: string): string {
  return `${formatClock(startsAt)}–${formatClock(endsAt)}`;
}

/* -------------------------------------------------------------------------- */
/* Grading scales                                                             */
/* -------------------------------------------------------------------------- */

const SCALE_SELECT = `
  id,name,description,is_default,is_active,
  grading_scale_bands(id,letter,grade_point,min_score,max_score,is_passing,sort_order)
`;

function mapScale(row: Record<string, unknown>): GradingScale {
  const raw = Array.isArray(row.grading_scale_bands) ? row.grading_scale_bands : [];
  const bands = (raw as Record<string, unknown>[])
    .map((band) => ({
      id: text(band.id),
      letter: text(band.letter),
      gradePoint: num(band.grade_point),
      minScore: num(band.min_score),
      maxScore: num(band.max_score),
      isPassing: Boolean(band.is_passing),
      sortOrder: num(band.sort_order)
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    bands
  };
}

export async function fetchGradingScales(includeInactive = false): Promise<GradingScale[]> {
  let query = requireSupabase()
    .from('grading_scales')
    .select(SCALE_SELECT)
    .order('is_default', { ascending: false })
    .order('name');
  // RLS only exposes active scales to ordinary users, so the filter is a
  // convenience rather than the security boundary.
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  throwOn(error);
  return (data ?? []).map((row) => mapScale(row as Record<string, unknown>));
}

export async function fetchDefaultGradingScale(): Promise<GradingScale | null> {
  const { data, error } = await requireSupabase()
    .from('grading_scales')
    .select(SCALE_SELECT)
    .eq('is_default', true)
    .maybeSingle();
  throwOn(error);
  return data ? mapScale(data as Record<string, unknown>) : null;
}

/* -------------------------------------------------------------------------- */
/* Lecturers, allocations and timetables                                     */
/* -------------------------------------------------------------------------- */

export async function fetchLecturers(includeInactive = false): Promise<Lecturer[]> {
  let query = requireSupabase()
    .from('lecturers')
    .select('id,full_name,department_id,staff_email,phone,office_location,academic_rank,bio,is_active,departments(name)')
    .order('full_name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  throwOn(error);
  return (data ?? []).map((row) => {
    const department = relation(row.departments);
    return {
      id: text(row.id),
      fullName: text(row.full_name),
      departmentId: row.department_id ? text(row.department_id) : null,
      departmentName: text(department.name) || null,
      staffEmail: row.staff_email ? text(row.staff_email) : null,
      phone: row.phone ? text(row.phone) : null,
      officeLocation: text(row.office_location),
      academicRank: text(row.academic_rank),
      bio: text(row.bio),
      isActive: Boolean(row.is_active)
    };
  });
}

export async function fetchCourseLecturers(courseId: string): Promise<CourseLecturer[]> {
  const { data, error } = await requireSupabase()
    .from('course_lecturers')
    .select('id,course_id,lecturer_id,is_primary,lecturers(full_name),academic_sessions(name)')
    .eq('course_id', courseId)
    .order('is_primary', { ascending: false });
  throwOn(error);
  return (data ?? []).map((row) => {
    const lecturer = relation(row.lecturers);
    const session = relation(row.academic_sessions);
    return {
      id: text(row.id),
      courseId: text(row.course_id),
      lecturerId: text(row.lecturer_id),
      lecturerName: text(lecturer.full_name) || null,
      isPrimary: Boolean(row.is_primary),
      sessionName: text(session.name) || null
    };
  });
}

/**
 * Timetable rows for the given courses. Pass the student's tracked course ids;
 * an empty list would return the whole institution's timetable, so callers
 * should resolve courses first and handle the empty case themselves.
 */
export async function fetchSchedules(courseIds: string[]): Promise<CourseSchedule[]> {
  if (!courseIds.length) return [];
  const { data, error } = await requireSupabase()
    .from('course_schedules')
    .select('id,course_id,day_of_week,starts_at,ends_at,venue,lecturer_id,courses(course_code,course_title),lecturers(full_name),academic_sessions(name)')
    .in('course_id', courseIds)
    .order('day_of_week')
    .order('starts_at');
  throwOn(error);
  return (data ?? []).map((row) => {
    const course = relation(row.courses);
    const lecturer = relation(row.lecturers);
    const session = relation(row.academic_sessions);
    return {
      id: text(row.id),
      courseId: text(row.course_id),
      courseCode: text(course.course_code),
      courseTitle: text(course.course_title),
      lecturerId: row.lecturer_id ? text(row.lecturer_id) : null,
      lecturerName: text(lecturer.full_name) || null,
      sessionName: text(session.name) || null,
      dayOfWeek: num(row.day_of_week),
      startsAt: text(row.starts_at),
      endsAt: text(row.ends_at),
      venue: text(row.venue)
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Assignments (student-owned)                                                */
/* -------------------------------------------------------------------------- */

const ASSIGNMENT_SELECT = `
  id,course_id,title,description,due_date,priority,status,attachment_path,
  submitted_at,grade,feedback,reminder_at,courses(course_code,course_title)
`;

function mapAssignment(row: Record<string, unknown>): Assignment {
  const course = relation(row.courses);
  return {
    id: text(row.id),
    courseId: row.course_id ? text(row.course_id) : null,
    courseCode: text(course.course_code) || null,
    courseTitle: text(course.course_title) || null,
    title: text(row.title),
    description: text(row.description),
    dueDate: row.due_date ? text(row.due_date) : null,
    priority: text(row.priority, 'normal') as AssignmentPriority,
    status: text(row.status, 'not_started') as AssignmentStatus,
    attachmentPath: row.attachment_path ? text(row.attachment_path) : null,
    submittedAt: row.submitted_at ? text(row.submitted_at) : null,
    grade: text(row.grade),
    feedback: text(row.feedback),
    reminderAt: row.reminder_at ? text(row.reminder_at) : null
  };
}

export async function fetchMyAssignments(): Promise<Assignment[]> {
  const { data, error } = await requireSupabase()
    .from('assignments')
    .select(ASSIGNMENT_SELECT)
    .order('due_date', { ascending: true, nullsFirst: false });
  throwOn(error);
  return (data ?? []).map((row) => mapAssignment(row as Record<string, unknown>));
}

export interface AssignmentInput {
  courseId?: string | null;
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: AssignmentPriority;
  reminderAt?: string | null;
  attachmentPath?: string | null;
}

export async function createAssignment(input: AssignmentInput): Promise<void> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to create an assignment.');

  const { error } = await client.from('assignments').insert({
    // student_id is pinned to the caller. RLS would reject a mismatch anyway,
    // but sending it explicitly keeps the intent obvious.
    student_id: user.id,
    course_id: input.courseId ?? null,
    title: input.title,
    description: input.description ?? '',
    due_date: input.dueDate ?? null,
    priority: input.priority ?? 'normal',
    reminder_at: input.reminderAt ?? null,
    attachment_path: input.attachmentPath ?? null
  });
  throwOn(error);
}

export async function updateAssignment(
  id: string,
  patch: Partial<Pick<AssignmentInput, 'title' | 'description' | 'courseId'>> & {
    dueDate?: string | null;
    priority?: AssignmentPriority;
    reminderAt?: string | null;
    status?: AssignmentStatus;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.courseId !== undefined) payload.course_id = patch.courseId;
  if (patch.dueDate !== undefined) payload.due_date = patch.dueDate;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.reminderAt !== undefined) payload.reminder_at = patch.reminderAt;
  if (patch.status !== undefined) payload.status = patch.status;

  // submitted_at is intentionally absent: a BEFORE UPDATE trigger stamps it on
  // the transition into 'submitted' and clears it when the task is reopened.
  const { error } = await requireSupabase().from('assignments').update(payload).eq('id', id);
  throwOn(error);
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await requireSupabase().from('assignments').delete().eq('id', id);
  throwOn(error);
}

/* -------------------------------------------------------------------------- */
/* Examinations, tests and the academic calendar                              */
/* -------------------------------------------------------------------------- */

export async function fetchAcademicEvents(courseIds: string[]): Promise<AcademicEvent[]> {
  if (!courseIds.length) return [];
  const { data, error } = await requireSupabase()
    .from('academic_events')
    .select('id,course_id,title,event_type,starts_at,ends_at,venue,notes,duration_minutes,courses(course_code,course_title)')
    .in('course_id', courseIds)
    .order('starts_at');
  throwOn(error);
  return (data ?? []).map((row) => {
    const course = relation(row.courses);
    return {
      id: text(row.id),
      courseId: text(row.course_id),
      courseCode: text(course.course_code),
      courseTitle: text(course.course_title),
      title: text(row.title),
      eventType: text(row.event_type, 'test') as AcademicEventType,
      startsAt: text(row.starts_at),
      endsAt: row.ends_at ? text(row.ends_at) : null,
      venue: text(row.venue),
      notes: text(row.notes),
      durationMinutes: row.duration_minutes === null ? null : num(row.duration_minutes)
    };
  });
}

export async function fetchCalendarEntries(): Promise<CalendarEntry[]> {
  const { data, error } = await requireSupabase()
    .from('academic_calendar_entries')
    .select('id,title,description,category,starts_on,ends_on,is_published')
    .order('starts_on');
  throwOn(error);
  return (data ?? []).map((row) => ({
    id: text(row.id),
    title: text(row.title),
    description: text(row.description),
    category: text(row.category, 'Other') as CalendarCategory,
    startsOn: text(row.starts_on),
    endsOn: text(row.ends_on),
    // RLS hides unpublished rows from students, so a visible row is published.
    isPublished: Boolean(row.is_published)
  }));
}

/* -------------------------------------------------------------------------- */
/* Grades and GPA                                                             */
/* -------------------------------------------------------------------------- */

const GRADE_SELECT = `
  id,course_id,units,grade_letter,grade_point,is_published,
  courses(course_code,course_title),academic_sessions(name)
`;

function mapGrade(row: Record<string, unknown>): StudentGrade {
  const course = relation(row.courses);
  const session = relation(row.academic_sessions);
  return {
    id: text(row.id),
    courseId: text(row.course_id),
    courseCode: text(course.course_code),
    courseTitle: text(course.course_title),
    units: row.units === null ? null : num(row.units),
    gradeLetter: text(row.grade_letter),
    gradePoint: num(row.grade_point),
    sessionName: text(session.name) || null,
    isPublished: Boolean(row.is_published)
  };
}

export async function fetchMyGrades(): Promise<StudentGrade[]> {
  const { data, error } = await requireSupabase()
    .from('student_grades')
    .select(GRADE_SELECT)
    .order('recorded_at', { ascending: false });
  throwOn(error);
  return (data ?? []).map((row) => mapGrade(row as Record<string, unknown>));
}

/**
 * GPA comes from the server so the weighting rules live in one place. The RPC
 * returns a jsonb summary rather than rows; pair it with fetchMyGrades() for
 * the per-course breakdown.
 */
export async function fetchMyGpa(): Promise<GpaSummary> {
  const { data, error } = await requireSupabase().rpc('my_gpa_summary');
  throwOn(error);
  const payload = (data ?? {}) as Record<string, unknown>;
  const round = (value: unknown): number | null =>
    value === null || value === undefined ? null : num(value);

  return {
    cumulativeCgpa: round(payload.cumulative_cgpa),
    currentSessionGpa: round(payload.current_session_gpa),
    totalUnits: num(payload.total_units),
    currentUnits: num(payload.current_units),
    coursesCounted: num(payload.courses_counted),
    academicSessionId: payload.academic_session_id ? text(payload.academic_session_id) : null
  };
}

/* -------------------------------------------------------------------------- */
/* Grade calculator                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Weighted CGPA across a set of (units, grade point) pairs. Returns null when
 * no units carry weight, so callers can distinguish "0.00" from "not computable".
 */
export function calculateCgpa(rows: { units: number | null; gradePoint: number }[]): number | null {
  let weighted = 0;
  let units = 0;
  for (const row of rows) {
    const u = row.units ?? 0;
    if (u <= 0) continue;
    weighted += u * row.gradePoint;
    units += u;
  }
  return units > 0 ? weighted / units : null;
}

/** Map a percentage onto a grading scale, or null when the scale has no band. */
export function scoreToLetter(scale: GradingScale | null, score: number): GradingBand | null {
  if (!scale) return null;
  return (
    scale.bands.find((band) => score >= band.minScore && score <= band.maxScore) ?? null
  );
}

/**
 * The CGPA calculator's input rules.
 *
 * They live beside `calculateCgpa` so the sum and the validation that feeds it
 * can never drift apart: a value that would corrupt the weighted average is
 * rejected before it reaches the arithmetic.
 */

/** Sanity ceiling on one course's credit units. Keying 300 instead of 3 is a
 *  mistake, not a semester load, and it would swallow the whole CGPA. */
export const MAX_CREDIT_UNITS = 100;

/** The grade-point domain enforced by `grading_scale_bands.grade_point`
 *  (CHECK (grade_point BETWEEN 0 AND 10)). */
export const MIN_GRADE_POINT = 0;
export const MAX_GRADE_POINT = 10;

/**
 * Parse what a student typed into a credit-units field.
 *
 * Returns null for blank, non-numeric, negative, zero and absurd entries —
 * every value that must not be silently coerced to 0 (which would drop the
 * course from the average) or allowed through as a negative weight.
 */
export function parseCreditUnits(raw: string): number | null {
  const text = raw.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const units = Number(text);
  if (!Number.isFinite(units) || units <= 0 || units > MAX_CREDIT_UNITS) return null;
  return units;
}

/** A grade point is only usable if it is a real number inside the stored domain. */
export function isValidGradePoint(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_GRADE_POINT && value <= MAX_GRADE_POINT;
}

/** One line of the what-if calculator, held as the raw text of each field. */
export interface CalculatorCourseInput {
  course: string;
  units: string;
  grade: string;
}

export type CalculatorRowState =
  | { status: 'empty' }
  | { status: 'ready'; units: number; gradePoint: number; qualityPoints: number }
  | { status: 'invalid'; field: 'units' | 'grade'; message: string };

/**
 * Validate a single calculator row against the active grading scale.
 *
 * Three outcomes keep invalid input out of the sum: `empty` rows are simply
 * not there yet, `ready` rows carry parsed numbers the CGPA may use, and
 * `invalid` rows say which field to fix. Nothing is ever coerced — an
 * unparsable unit is an error, not a zero.
 */
export function evaluateCalculatorRow(
  row: CalculatorCourseInput,
  scale: GradingScale | null
): CalculatorRowState {
  const rawUnits = row.units.trim();
  const rawGrade = row.grade.trim();

  if (!rawUnits && !rawGrade) return { status: 'empty' };
  if (!rawUnits) {
    return { status: 'invalid', field: 'units', message: 'Enter the credit units for this course.' };
  }

  const units = parseCreditUnits(rawUnits);
  if (units === null) {
    return {
      status: 'invalid',
      field: 'units',
      message: `Credit units must be a number greater than 0 and no more than ${MAX_CREDIT_UNITS}.`
    };
  }

  if (!rawGrade) {
    return { status: 'invalid', field: 'grade', message: 'Select the grade awarded for this course.' };
  }

  const band = scale?.bands.find((entry) => entry.letter === rawGrade) ?? null;
  if (!band) {
    return {
      status: 'invalid',
      field: 'grade',
      message: 'That grade is not offered on the active grading scale.'
    };
  }
  if (!isValidGradePoint(band.gradePoint)) {
    return {
      status: 'invalid',
      field: 'grade',
      message: `Grade point ${band.gradePoint} is outside the allowed ${MIN_GRADE_POINT}–${MAX_GRADE_POINT} range.`
    };
  }

  return { status: 'ready', units, gradePoint: band.gradePoint, qualityPoints: units * band.gradePoint };
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ask the server to deliver any due assignment reminders and exam warnings.
 * Returns the number of reminders actually sent; muted categories are skipped
 * and stay pending, so the count can legitimately be 0.
 */
export async function dispatchReminders(): Promise<number> {
  const { data, error } = await requireSupabase().rpc('dispatch_academic_reminders');
  throwOn(error);
  return num(data);
}

/* -------------------------------------------------------------------------- */
/* Reference options for admin forms                                          */
/* -------------------------------------------------------------------------- */

export interface CourseOption {
  id: string;
  code: string;
  title: string;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

/** All catalogue courses, for admin pickers. Codes are unique enough to sort on. */
export async function fetchCourseOptions(): Promise<CourseOption[]> {
  const { data, error } = await requireSupabase()
    .from('courses')
    .select('id,course_code,course_title')
    .order('course_code')
    .limit(1000);
  throwOn(error);
  return (data ?? []).map((row) => ({
    id: text(row.id),
    code: text(row.course_code),
    title: text(row.course_title)
  }));
}

export async function fetchDepartmentOptions(): Promise<DepartmentOption[]> {
  const { data, error } = await requireSupabase()
    .from('departments')
    .select('id,name')
    .order('name');
  throwOn(error);
  return (data ?? []).map((row) => ({ id: text(row.id), name: text(row.name) }));
}

export async function fetchAcademicSessionOptions(): Promise<{ id: string; name: string; isActive: boolean }[]> {
  const { data, error } = await requireSupabase()
    .from('academic_sessions')
    .select('id,name,is_active')
    .order('starts_on', { ascending: false });
  throwOn(error);
  return (data ?? []).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    isActive: Boolean(row.is_active)
  }));
}

/* -------------------------------------------------------------------------- */
/* Admin writes (all permission-checked server side)                          */
/* -------------------------------------------------------------------------- */

export async function adminUpsertLecturer(input: {
  id?: string | null;
  fullName: string;
  departmentId?: string | null;
  staffEmail?: string | null;
  phone?: string | null;
  officeLocation?: string;
  academicRank?: string;
  bio?: string;
  isActive?: boolean;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_upsert_lecturer', {
    p_id: input.id ?? null,
    p_full_name: input.fullName,
    p_department_id: input.departmentId ?? null,
    p_staff_email: input.staffEmail ?? null,
    p_phone: input.phone ?? null,
    p_office_location: input.officeLocation ?? '',
    p_academic_rank: input.academicRank ?? '',
    p_bio: input.bio ?? '',
    p_is_active: input.isActive ?? true
  });
  throwOn(error);
}

export async function adminOnboardLecturer(input: {
  fullName: string;
  staffEmail: string;
  phone?: string | null;
  staffId?: string | null;
  academicRank?: string | null;
  officeLocation?: string | null;
  bio?: string | null;
  facultyId?: string | null;
  departmentId?: string | null;
  departmentIds?: string[] | null;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('admin_onboard_lecturer', {
    p_full_name: input.fullName,
    p_staff_email: input.staffEmail,
    p_phone: input.phone ?? null,
    p_staff_id: input.staffId ?? null,
    p_academic_rank: input.academicRank ?? null,
    p_office_location: input.officeLocation ?? null,
    p_bio: input.bio ?? null,
    p_faculty_id: input.facultyId ?? null,
    p_department_id: input.departmentId ?? null,
    p_department_ids: input.departmentIds ?? null
  });
  throwOn(error);
  return data;
}

export async function adminConvertUserToLecturer(input: {
  userId: string;
  staffId?: string | null;
  academicRank?: string | null;
  officeLocation?: string | null;
  facultyId?: string | null;
  departmentId?: string | null;
  departmentIds?: string[] | null;
  fullName?: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('admin_convert_user_to_lecturer', {
    p_user_id: input.userId,
    p_staff_id: input.staffId ?? null,
    p_academic_rank: input.academicRank ?? null,
    p_office_location: input.officeLocation ?? null,
    p_faculty_id: input.facultyId ?? null,
    p_department_id: input.departmentId ?? null,
    p_department_ids: input.departmentIds ?? null,
    p_full_name: input.fullName ?? null
  });
  throwOn(error);
  return data;
}

export async function lecturerBroadcastAnnouncement(input: {
  title: string;
  body: string;
  facultyId?: string | null;
  departmentIds?: string[] | null;
  announcementType?: 'general' | 'important' | 'assignment' | 'exam';
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('lecturer_broadcast_announcement', {
    p_title: input.title,
    p_body: input.body,
    p_target_faculty_id: input.facultyId ?? null,
    p_target_department_ids: input.departmentIds ?? null,
    p_announcement_type: input.announcementType ?? 'general'
  });
  throwOn(error);
  return data;
}

export async function completeUserOnboarding(
  step: number = 1,
  completed: boolean = false
): Promise<{
  onboarding_started: boolean;
  onboarding_step: number;
  onboarding_completed: boolean;
  onboarding_completed_at: string | null;
}> {
  const { data, error } = await requireSupabase().rpc('complete_user_onboarding', {
    p_step: step,
    p_completed: completed
  });
  throwOn(error);
  return data;
}

export async function lecturerUpdateOwnProfile(input: {
  bio: string;
  phone: string;
  officeLocation: string;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('lecturer_update_own_profile', {
    p_bio: input.bio,
    p_phone: input.phone,
    p_office_location: input.officeLocation
  });
  throwOn(error);
}

export async function adminDeleteLecturer(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_delete_lecturer', { p_id: id });
  throwOn(error);
}

export async function adminUpsertCourseLecturer(input: {
  id?: string | null;
  courseId: string;
  lecturerId: string;
  academicSessionId?: string | null;
  isPrimary?: boolean;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_upsert_course_lecturer', {
    p_id: input.id ?? null,
    p_course_id: input.courseId,
    p_lecturer_id: input.lecturerId,
    p_academic_session_id: input.academicSessionId ?? null,
    p_is_primary: input.isPrimary ?? true
  });
  throwOn(error);
}

export async function adminUpsertCourseSchedule(input: {
  id?: string | null;
  courseId: string;
  lecturerId?: string | null;
  academicSessionId?: string | null;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  venue?: string;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_upsert_course_schedule', {
    p_id: input.id ?? null,
    p_course_id: input.courseId,
    p_lecturer_id: input.lecturerId ?? null,
    p_academic_session_id: input.academicSessionId ?? null,
    p_day_of_week: input.dayOfWeek,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_venue: input.venue ?? ''
  });
  throwOn(error);
}

export async function adminDeleteCourseSchedule(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_delete_course_schedule', { p_id: id });
  throwOn(error);
}

export async function adminUpsertAcademicEvent(input: {
  id?: string | null;
  courseId: string;
  title: string;
  eventType: AcademicEventType;
  startsAt: string;
  endsAt?: string | null;
  venue?: string;
  notes?: string;
  durationMinutes?: number | null;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_upsert_academic_event', {
    p_id: input.id ?? null,
    p_course_id: input.courseId,
    p_title: input.title,
    p_event_type: input.eventType,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt ?? null,
    p_venue: input.venue ?? '',
    p_notes: input.notes ?? '',
    p_duration_minutes: input.durationMinutes ?? null
  });
  throwOn(error);
}

export async function adminDeleteAcademicEvent(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_delete_academic_event', { p_id: id });
  throwOn(error);
}

export async function adminUpsertCalendarEntry(input: {
  id?: string | null;
  title: string;
  description?: string;
  category: CalendarCategory;
  startsOn: string;
  endsOn: string;
  isPublished?: boolean;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_upsert_calendar_entry', {
    p_id: input.id ?? null,
    p_title: input.title,
    p_description: input.description ?? '',
    p_category: input.category,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_is_published: input.isPublished ?? true
  });
  throwOn(error);
}

export async function adminDeleteCalendarEntry(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_delete_calendar_entry', { p_id: id });
  throwOn(error);
}

export interface GradeScaleBandInput {
  letter: string;
  gradePoint: number;
  minScore: number;
  maxScore: number;
  isPassing: boolean;
}

/**
 * Replace a grading scale and its bands. p_grade_point is omitted on purpose:
 * admin_record_grade derives it from the band matching the letter, so the
 * letter is the single source of truth.
 */
export async function adminSetGradingScale(input: {
  scaleId: string;
  name: string;
  description?: string;
  bands: GradeScaleBandInput[];
}): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_set_grading_scale', {
    p_scale_id: input.scaleId,
    p_name: input.name,
    p_description: input.description ?? '',
    p_bands: input.bands.map((band, index) => ({
      letter: band.letter,
      grade_point: band.gradePoint,
      min_score: band.minScore,
      max_score: band.maxScore,
      is_passing: band.isPassing,
      sort_order: index + 1
    }))
  });
  throwOn(error);
}

export async function adminSetDefaultGradingScale(scaleId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_set_default_grading_scale', {
    p_scale_id: scaleId
  });
  throwOn(error);
}

export async function adminRecordGrade(input: {
  studentId: string;
  courseId: string;
  academicSessionId?: string | null;
  gradeLetter: string;
  units?: number | null;
  isPublished?: boolean;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('admin_record_grade', {
    p_student_id: input.studentId,
    p_course_id: input.courseId,
    p_academic_session_id: input.academicSessionId ?? null,
    p_grade_letter: input.gradeLetter,
    p_units: input.units ?? null,
    p_is_published: input.isPublished ?? false,
    p_grade_point: null
  });
  throwOn(error);
  return text(data);
}

export async function adminDeleteGrade(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('admin_delete_grade', { p_id: id });
  throwOn(error);
}

/** Grades across all students. RLS limits this to manage_academics holders. */
export async function fetchAllGrades(): Promise<
  (StudentGrade & { studentId: string; studentName: string })[]
> {
  const { data, error } = await requireSupabase()
    .from('student_grades')
    .select(`
      id,student_id,course_id,units,grade_letter,grade_point,is_published,
      courses(course_code,course_title),academic_sessions(name),
      profiles!student_grades_student_id_fkey(full_name)
    `)
    .order('recorded_at', { ascending: false });
  throwOn(error);
  return (data ?? []).map((row) => {
    const profile = relation(row.profiles);
    return {
      ...mapGrade(row as Record<string, unknown>),
      studentId: text(row.student_id),
      studentName: text(profile.full_name) || 'Unknown student'
    };
  });
}
