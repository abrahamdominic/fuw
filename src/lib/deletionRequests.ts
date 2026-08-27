// Data access layer for deletion requests.
import { requireSupabase } from './supabase';

export interface DeletionRequest {
  id: string;
  student_id: string;
  request_type: 'course' | 'material';
  item_name: string;
  item_code: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (admin view)
  profiles?: { full_name: string; email: string; matric_number: string; faculty: string; department: string; level: string } | null;
}

export interface DeletionRequestInput {
  request_type: 'course' | 'material';
  item_name: string;
  item_code?: string;
  reason: string;
}

/** Student: submit a deletion request. */
export async function submitDeletionRequest(input: DeletionRequestInput): Promise<DeletionRequest> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('deletion_requests')
    .insert({
      student_id: user.id,
      request_type: input.request_type,
      item_name: input.item_name.trim(),
      item_code: input.item_code?.trim() || null,
      reason: input.reason.trim()
    })
    .select('*')
    .single();

  if (error) throw error;

  // Notify admins
  await client.from('notifications').insert({
    user_id: user.id, // will be overridden by trigger or we insert for each admin
    title: 'New Deletion Request',
    message: `A student has submitted a deletion request for ${input.request_type}: ${input.item_name}`,
    type: 'warning'
  });

  return data;
}

/** Student: fetch own deletion requests. */
export async function fetchMyDeletionRequests(): Promise<DeletionRequest[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('deletion_requests')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Admin: fetch all deletion requests with filters. */
export async function fetchAllDeletionRequests(filters?: {
  status?: string;
  request_type?: string;
  search?: string;
  faculty?: string;
  department?: string;
  level?: string;
  date_from?: string;
  date_to?: string;
}): Promise<DeletionRequest[]> {
  const client = requireSupabase();

  let query = client
    .from('deletion_requests')
    .select('*, profiles!deletion_requests_student_id_fkey(full_name, email, matric_number, faculty, department, level)')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.request_type) query = query.eq('request_type', filters.request_type);
  if (filters?.date_from) query = query.gte('created_at', filters.date_from);
  if (filters?.date_to) query = query.lte('created_at', filters.date_to + 'T23:59:59');
  if (filters?.search) {
    query = query.or(
      `item_name.ilike.%${filters.search}%,` +
      `item_code.ilike.%${filters.search}%,` +
      `reason.ilike.%${filters.search}%,` +
      `profiles.full_name.ilike.%${filters.search}%,` +
      `profiles.email.ilike.%${filters.search}%,` +
      `profiles.matric_number.ilike.%${filters.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  let results = (data as any) || [];

  // Client-side post-filter for profile fields
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

/** Admin: update request status. */
export async function updateDeletionRequestStatus(
  id: string,
  status: 'approved' | 'rejected' | 'completed',
  adminNote?: string
): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();

  const { error } = await client
    .from('deletion_requests')
    .update({
      status,
      admin_note: adminNote || null,
      reviewed_by: user?.id || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) throw error;

  // Notify student
  const { data: req } = await client.from('deletion_requests').select('student_id, item_name, request_type').eq('id', id).single();
  if (req) {
    const statusMsg = status === 'approved'
      ? `Your deletion request for ${req.item_name} has been approved and the ${req.request_type} has been removed.`
      : status === 'rejected'
        ? `Your deletion request for ${req.item_name} has been rejected. Please check the admin note for details.`
        : `Your deletion request for ${req.item_name} has been completed.`;

    await client.from('notifications').insert({
      user_id: req.student_id,
      title: `Deletion Request ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: statusMsg,
      type: status === 'approved' ? 'success' : status === 'rejected' ? 'error' : 'info'
    });
  }
}
