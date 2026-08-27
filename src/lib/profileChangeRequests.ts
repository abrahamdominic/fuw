// Data access layer for profile change requests (admin override).
import { requireSupabase } from './supabase';

export interface ProfileChangeRequest {
  id: string;
  student_id: string;
  field_name: 'matric_number' | 'faculty' | 'department' | 'level';
  current_value: string;
  requested_value: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  // Joined
  profiles?: { full_name: string; email: string; matric_number: string; faculty?: string; department?: string; level?: string } | null;
}

/** Student: submit a profile change request. */
export async function submitProfileChangeRequest(input: {
  field_name: ProfileChangeRequest['field_name'];
  current_value: string;
  requested_value: string;
  reason: string;
}): Promise<ProfileChangeRequest> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('profile_change_requests')
    .insert({
      student_id: user.id,
      field_name: input.field_name,
      current_value: input.current_value.trim(),
      requested_value: input.requested_value.trim(),
      reason: input.reason.trim()
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/** Student: fetch own change requests. */
export async function fetchMyChangeRequests(): Promise<ProfileChangeRequest[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('profile_change_requests')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Admin: fetch all change requests with expanded search. */
export async function fetchAllChangeRequests(filters?: {
  status?: string;
  field_name?: string;
  search?: string;
  faculty?: string;
  department?: string;
  level?: string;
  date_from?: string;
  date_to?: string;
}): Promise<ProfileChangeRequest[]> {
  const client = requireSupabase();

  let query = client
    .from('profile_change_requests')
    .select('*, profiles!profile_change_requests_student_id_fkey(full_name, email, matric_number, faculty, department, level)')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.field_name) query = query.eq('field_name', filters.field_name);
  if (filters?.date_from) query = query.gte('created_at', filters.date_from);
  if (filters?.date_to) query = query.lte('created_at', filters.date_to + 'T23:59:59');
  if (filters?.search) {
    // Search across request fields AND profile fields
    query = query.or(
      `current_value.ilike.%${filters.search}%,` +
      `requested_value.ilike.%${filters.search}%,` +
      `reason.ilike.%${filters.search}%,` +
      `field_name.ilike.%${filters.search}%,` +
      `status.ilike.%${filters.search}%,` +
      `profiles.full_name.ilike.%${filters.search}%,` +
      `profiles.email.ilike.%${filters.search}%,` +
      `profiles.matric_number.ilike.%${filters.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  let results = (data as any) || [];

  // Client-side post-filter for profile fields (since they're joined, not filterable server-side)
  if (filters?.faculty) {
    results = results.filter((r: any) => r.profiles?.faculty === filters.faculty);
  }
  if (filters?.department) {
    results = results.filter((r: any) => r.profiles?.department === filters.department);
  }
  if (filters?.level) {
    results = results.filter((r: any) => r.profiles?.level === filters.level);
  }

  return results;
}

/** Admin: approve a change request and apply the change. */
export async function approveProfileChangeRequest(
  id: string,
  adminNote?: string
): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();

  const { data: req, error: fetchError } = await client
    .from('profile_change_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !req) throw new Error('Request not found');

  // Apply the change to the profile
  const updateField: Record<string, string> = {};
  updateField[req.field_name] = req.requested_value;

  const { error: updateError } = await client
    .from('profiles')
    .update(updateField)
    .eq('id', req.student_id);

  if (updateError) throw updateError;

  // Mark request as approved
  const { error } = await client
    .from('profile_change_requests')
    .update({
      status: 'approved',
      admin_note: adminNote || null,
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;

  // Notify student
  await client.from('notifications').insert({
    user_id: req.student_id,
    title: 'Profile Change Approved',
    message: `Your request to change ${req.field_name.replace('_', ' ')} from "${req.current_value}" to "${req.requested_value}" has been approved.`,
    type: 'success'
  });
}

/** Admin: reject a change request. */
export async function rejectProfileChangeRequest(
  id: string,
  adminNote?: string
): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();

  const { data: req } = await client
    .from('profile_change_requests')
    .select('student_id')
    .eq('id', id)
    .single();

  const { error } = await client
    .from('profile_change_requests')
    .update({
      status: 'rejected',
      admin_note: adminNote || null,
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;

  if (req) {
    await client.from('notifications').insert({
      user_id: req.student_id,
      title: 'Profile Change Rejected',
      message: `Your profile change request has been rejected. Please check the admin note for details.`,
      type: 'error'
    });
  }
}
