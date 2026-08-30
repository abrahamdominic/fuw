// Data access layer for admin-published catalogue courses.
// Courses published here go straight into the canonical `courses` table —
// they are live immediately, with no pending/approval stage.
import { requireSupabase } from './supabase';

export interface AdminCourseInput {
  faculty: string;
  department: string;
  level: string;
  semester: string;
  course_code: string;
  course_title: string;
}

export interface AdminPublishedCourse {
  id: string;
  code: string;
  title: string;
  level: string;
  semester: string;
  department: string;
  faculty: string;
  created_by: string;
  created_at: string;
}

/** Publish admin-entered courses into the official catalogue. Skips duplicates. */
export async function publishAdminCourses(
  input: AdminCourseInput[]
): Promise<{ inserted: number; skipped: number }> {
  const client = requireSupabase();
  let inserted = 0;
  let skipped = 0;

  for (const course of input) {
    const { data, error } = await client.rpc('admin_publish_course', {
      p_faculty: course.faculty.trim(),
      p_department: course.department.trim(),
      p_course_code: course.course_code.trim().toUpperCase(),
      p_course_title: course.course_title.trim(),
      p_level: course.level.trim(),
      p_semester: course.semester.trim()
    });
    if (error) throw new Error(error.message);
    if (data === true) inserted += 1;
    else skipped += 1;
  }

  return { inserted, skipped };
}

/** List courses that administrators have published (the editable catalogue additions). */
export async function fetchAdminPublishedCourses(): Promise<AdminPublishedCourse[]> {
  const client = requireSupabase();

  const [{ data: courseRows }, { data: deptRows }, { data: levelRows }] = await Promise.all([
    client
      .from('courses')
      .select('id, department_id, course_code, course_title, level_id, semester, created_by, created_at')
      .not('created_by', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500),
    client.from('departments').select('id, name, faculty_id'),
    client.from('levels').select('id, name')
  ]);

  const deptById = new Map<string, { name: string; faculty_id: string }>();
  (deptRows || []).forEach((d: any) => deptById.set(d.id, d));

  const facultyById = new Map<string, string>();
  const { data: facultyRows } = await client.from('faculties').select('id, name');
  (facultyRows || []).forEach((f: any) => facultyById.set(f.id, f.name));

  const levelById = new Map<string, string>();
  (levelRows || []).forEach((l: any) => levelById.set(l.id, l.name));

  return (courseRows || []).map((c: any) => {
    const dept = deptById.get(c.department_id);
    return {
      id: c.id,
      code: c.course_code,
      title: c.course_title,
      level: c.level_id ? levelById.get(c.level_id) || '' : '',
      semester: c.semester || '',
      department: dept?.name || '',
      faculty: dept ? facultyById.get(dept.faculty_id) || '' : '',
      created_by: c.created_by,
      created_at: c.created_at
    };
  });
}

/** Delete a course the current admin published (super admins may delete any). */
export async function deleteAdminPublishedCourse(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_delete_course', { p_id: id });
  if (error) throw new Error(error.message);
}