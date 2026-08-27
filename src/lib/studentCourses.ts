// Data access layer for student course uploads.
import { requireSupabase } from './supabase';

export interface StudentCourse {
  id: string;
  student_id: string;
  faculty: string;
  department: string;
  level: string;
  semester: string;
  course_code: string;
  course_title: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  updated_at: string;
}

export interface StudentCourseInput {
  faculty: string;
  department: string;
  level: string;
  semester: string;
  course_code: string;
  course_title: string;
}

/** Fetch all courses for the current student. */
export async function fetchMyStudentCourses(): Promise<StudentCourse[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('student_courses')
    .select('*')
    .eq('student_id', user.id)
    .order('submitted_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Fetch all student courses (admin view). */
export async function fetchAllStudentCourses(filters?: {
  faculty?: string;
  department?: string;
  level?: string;
  semester?: string;
  status?: string;
  search?: string;
}): Promise<StudentCourse[]> {
  const client = requireSupabase();

  let query = client
    .from('student_courses')
    .select('*, profiles!student_courses_student_id_fkey(full_name, matric_number)')
    .order('submitted_at', { ascending: false });

  if (filters?.faculty) query = query.eq('faculty', filters.faculty);
  if (filters?.department) query = query.eq('department', filters.department);
  if (filters?.level) query = query.eq('level', filters.level);
  if (filters?.semester) query = query.eq('semester', filters.semester);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.search) {
    query = query.or(`course_code.ilike.%${filters.search}%,course_title.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as any) || [];
}

/** Submit a batch of courses for a student. Skips duplicates silently. */
export async function submitStudentCourses(
  courses: StudentCourseInput[]
): Promise<{ inserted: number; skipped: number }> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let inserted = 0;
  let skipped = 0;

  for (const course of courses) {
    const trimmed = {
      student_id: user.id,
      faculty: course.faculty.trim(),
      department: course.department.trim(),
      level: course.level.trim(),
      semester: course.semester.trim(),
      course_code: course.course_code.trim().toUpperCase(),
      course_title: course.course_title.trim(),
      status: 'pending' as const
    };

    const { error } = await client
      .from('student_courses')
      .insert(trimmed);

    if (error) {
      // Unique constraint violation = duplicate
      if (error.code === '23505') {
        skipped++;
      } else {
        throw error;
      }
    } else {
      inserted++;
    }
  }

  return { inserted, skipped };
}

/** Update a single student course (student editing their own). */
export async function updateStudentCourse(
  id: string,
  updates: Partial<Pick<StudentCourseInput, 'course_code' | 'course_title'>>
): Promise<void> {
  const client = requireSupabase();

  // Approved courses are locked: they form part of the verified library and
  // can only change through an admin-approved deletion request.
  const { data: existing } = await client
    .from('student_courses')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (existing?.status === 'approved') {
    throw new Error('Approved courses cannot be edited. Submit a deletion request and wait for admin approval.');
  }

  const { error } = await client
    .from('student_courses')
    .update({
      ...(updates.course_code !== undefined && { course_code: updates.course_code.trim().toUpperCase() }),
      ...(updates.course_title !== undefined && { course_title: updates.course_title.trim() }),
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('status', 'pending');

  if (error) throw error;
}

/** Delete a student course. */
export async function deleteStudentCourse(id: string): Promise<void> {
  const client = requireSupabase();

  // Approved courses are locked and cannot be removed by the student.
  const { data: existing } = await client
    .from('student_courses')
    .select('status')
    .eq('id', id)
    .maybeSingle();

  if (existing?.status === 'approved') {
    throw new Error('Approved courses cannot be deleted. Submit a deletion request and wait for admin approval.');
  }

  const { error } = await client
    .from('student_courses')
    .delete()
    .eq('id', id)
    .eq('status', 'pending');

  if (error) throw error;
}

/** Admin: update course status (approve/reject). */
export async function updateStudentCourseStatus(
  id: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('student_courses')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}
