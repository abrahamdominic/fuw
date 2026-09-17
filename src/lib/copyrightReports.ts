// Copyright / takedown reporting workflow.
// Users report concerns; librarians review, add notes, and decide.
import { requireSupabase } from './supabase';

export type CopyrightComplaintType =
  | 'copyright'
  | 'incorrect_attribution'
  | 'unauthorized_upload'
  | 'sensitive_material'
  | 'incorrect_metadata'
  | 'other';

export interface CopyrightReport {
  id: string;
  reported_by: string | null;
  material_id: string | null;
  research_item_id: string | null;
  complaint_type: string;
  description: string;
  claimant_name: string | null;
  claimant_email: string | null;
  status: string;
  reviewed_by: string | null;
  review_decision: string | null;
  staff_notes: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export const COMPLAINT_TYPES: { value: CopyrightComplaintType; label: string }[] = [
  { value: 'copyright', label: 'Copyright concern' },
  { value: 'incorrect_attribution', label: 'Incorrect attribution' },
  { value: 'unauthorized_upload', label: 'Unauthorized upload' },
  { value: 'sensitive_material', label: 'Sensitive material' },
  { value: 'incorrect_metadata', label: 'Incorrect metadata' },
  { value: 'other', label: 'Other concern' }
];

/** Submit a copyright/takedown report. */
export async function submitCopyrightReport(input: {
  materialId?: string | null;
  researchItemId?: string | null;
  complaintType: string;
  description: string;
  claimantName?: string;
  claimantEmail?: string;
}): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  const description = input.description.trim();
  if (!description) throw new Error('Please describe the issue so we can review it.');

  // No representation is requested: the SELECT policy only exposes reports to
  // admins and their reporters, so `.select().single()` would fail for a
  // student even though the row was inserted.
  const { error } = await client
    .from('copyright_reports')
    .insert({
      reported_by: user?.id || null,
      material_id: input.materialId || null,
      research_item_id: input.researchItemId || null,
      complaint_type: input.complaintType,
      description,
      claimant_name: input.claimantName?.trim() || null,
      claimant_email: input.claimantEmail?.trim() || null,
      status: 'open'
    });
  if (error) throw error;
}

/** Admin: fetch all copyright reports (optionally by status). */
export async function fetchCopyrightReports(status = 'all'): Promise<CopyrightReport[]> {
  const client = requireSupabase();
  let query = client
    .from('copyright_reports')
    .select('*')
    .order('created_at', { ascending: false });
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as CopyrightReport[];
}

/** Admin: update report status with optional staff notes. */
export async function updateCopyrightReport(
  reportId: string,
  input: { status?: string; reviewDecision?: string; staffNotes?: string }
): Promise<void> {
  const client = requireSupabase();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status) patch.status = input.status;
  if (input.reviewDecision !== undefined) patch.review_decision = input.reviewDecision?.trim() || null;
  if (input.staffNotes !== undefined) patch.staff_notes = input.staffNotes?.trim() || null;
  patch.decided_at = input.status && input.status !== 'open' ? new Date().toISOString() : null;
  const { error } = await client.from('copyright_reports').update(patch).eq('id', reportId);
  if (error) throw error;
}