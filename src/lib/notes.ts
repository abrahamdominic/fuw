// Student notes data-access layer (table: student_notes).
// Per-user notes, optionally attached to a material. RLS-protected.
import { supabase } from './supabase';

export interface StudentNote {
  id: string;
  title: string;
  content: string;
  materialId?: string | null;
  color?: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentNoteInput {
  title: string;
  content: string;
  materialId?: string | null;
  color?: string | null;
  isPinned?: boolean;
}

function mapRow(row: any): StudentNote {
  return {
    id: row.id,
    title: row.title || '',
    content: row.content || '',
    materialId: row.material_id ?? null,
    color: row.color ?? null,
    isPinned: Boolean(row.is_pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function fetchStudentNotes(): Promise<StudentNote[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('student_notes')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map(mapRow);
}

export async function createStudentNote(input: StudentNoteInput): Promise<StudentNote | null> {
  if (!supabase) return null;
  // student_notes.user_id is NOT NULL (RLS scopes rows to the owner), so the
  // owning auth user must be attached explicitly or the insert is rejected.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('student_notes')
    .insert({
      user_id: user.id,
      title: input.title,
      content: input.content,
      material_id: input.materialId ?? null,
      color: input.color ?? null,
      is_pinned: input.isPinned ?? false
    })
    .select()
    .single();
  if (error) return null;
  return mapRow(data);
}

export async function updateStudentNote(
  id: string,
  patch: Partial<StudentNoteInput>
): Promise<boolean> {
  if (!supabase) return false;
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.materialId !== undefined) row.material_id = patch.materialId;
  if (patch.color !== undefined) row.color = patch.color;
  if (patch.isPinned !== undefined) row.is_pinned = patch.isPinned;
  const { error } = await supabase.from('student_notes').update(row).eq('id', id);
  return !error;
}

export async function deleteStudentNote(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('student_notes').delete().eq('id', id);
  return !error;
}