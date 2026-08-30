// Data access layer for admin-managed academic sessions.
// Sessions are created/published directly by admins — no approval workflow.
import { requireSupabase } from './supabase';

export interface AcademicSession {
  id: string;
  name: string;
  label: string;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcademicSessionInput {
  name: string;
  label?: string;
  is_active?: boolean;
  starts_on?: string | null;
  ends_on?: string | null;
}

export async function fetchAcademicSessions(): Promise<AcademicSession[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('academic_sessions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as AcademicSession[]) || [];
}

/** Create (or update) a session. Returns true when a brand-new session was created. */
export async function createAcademicSession(input: AcademicSessionInput): Promise<{ created: boolean }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('admin_upsert_academic_session', {
    p_name: input.name.trim(),
    p_label: input.label?.trim() ?? '',
    p_is_active: input.is_active ?? false,
    p_starts_on: input.starts_on || null,
    p_ends_on: input.ends_on || null
  });
  if (error) throw new Error(error.message);
  return { created: !!data };
}

export async function setActiveAcademicSession(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_set_active_academic_session', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function deleteAcademicSession(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_delete_academic_session', { p_id: id });
  if (error) throw new Error(error.message);
}