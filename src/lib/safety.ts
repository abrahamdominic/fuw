// Campus safety directory + issue tracker data access.
//
//   * campus_safety_contacts — admin-maintained, read by all signed-in students.
//   * campus_issues — students submit and track their own reports; moderators
//     triage and update status.
import { requireSupabase } from './supabase';

export type SafetyCategory =
  | 'emergency'
  | 'security'
  | 'health'
  | 'counselling'
  | 'academic'
  | 'admin'
  | 'general';

export interface SafetyContact {
  id: string;
  label: string;
  category: SafetyCategory;
  phone: string;
  email: string;
  address: string;
  description: string;
  isEmergency: boolean;
  isPublished: boolean;
  sortOrder: number;
}

export type IssueCategory =
  | 'water'
  | 'electricity'
  | 'internet'
  | 'classroom'
  | 'hostel'
  | 'sanitation'
  | 'accessibility'
  | 'safety'
  | 'other';

export type IssueStatus = 'open' | 'in_review' | 'in_progress' | 'resolved' | 'closed';
export type IssuePriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CampusIssue {
  id: string;
  reference: string;
  reporterId: string;
  category: IssueCategory;
  title: string;
  description: string;
  location: string;
  photoPath: string | null;
  isAnonymous: boolean;
  status: IssueStatus;
  priority: IssuePriority;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export const ISSUE_CATEGORIES: { key: IssueCategory; label: string }[] = [
  { key: 'water', label: 'Water supply' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'internet', label: 'Internet & network' },
  { key: 'classroom', label: 'Classroom & lecture facilities' },
  { key: 'hostel', label: 'Hostel maintenance' },
  { key: 'sanitation', label: 'Sanitation & waste' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'safety', label: 'Safety hazard' },
  { key: 'other', label: 'Other' }
];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Submitted',
  in_review: 'In review',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed'
};

export function issueCategoryLabel(category: IssueCategory): string {
  return ISSUE_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

function mapContact(row: any): SafetyContact {
  return {
    id: row.id,
    label: row.label,
    category: (row.category as SafetyCategory) || 'general',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    description: row.description || '',
    isEmergency: row.is_emergency === true,
    isPublished: row.is_published === true,
    sortOrder: Number(row.sort_order) || 100
  };
}

function mapIssue(row: any): CampusIssue {
  return {
    id: row.id,
    reference: row.reference,
    reporterId: row.reporter_id,
    category: (row.category as IssueCategory) || 'other',
    title: row.title,
    description: row.description || '',
    location: row.location || '',
    photoPath: row.photo_path ?? null,
    isAnonymous: row.is_anonymous === true,
    status: (row.status as IssueStatus) || 'open',
    priority: (row.priority as IssuePriority) || 'normal',
    adminNotes: row.admin_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null
  };
}

// ── Safety contacts ──────────────────────────────────────────────────────────

export async function fetchSafetyContacts(includeUnpublished = false): Promise<SafetyContact[]> {
  const client = requireSupabase();
  let query = client.from('campus_safety_contacts').select('*');
  if (!includeUnpublished) query = query.eq('is_published', true);
  const { data, error } = await query.order('is_emergency', { ascending: false }).order('sort_order');
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapContact);
}

export async function upsertSafetyContact(input: {
  id?: string;
  label: string;
  category: SafetyCategory;
  phone: string;
  email: string;
  address: string;
  description: string;
  isEmergency: boolean;
  isPublished: boolean;
  sortOrder: number;
}): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  const payload = {
    label: input.label.trim(),
    category: input.category,
    phone: input.phone.trim(),
    email: input.email.trim(),
    address: input.address.trim(),
    description: input.description.trim(),
    is_emergency: input.isEmergency,
    is_published: input.isPublished,
    sort_order: input.sortOrder,
    updated_by: user?.id ?? null
  };
  const { error } = input.id
    ? await client.from('campus_safety_contacts').update(payload).eq('id', input.id)
    : await client.from('campus_safety_contacts').insert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteSafetyContact(id: string): Promise<void> {
  const { error } = await requireSupabase().from('campus_safety_contacts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Issues ───────────────────────────────────────────────────────────────────

export interface IssueInput {
  category: IssueCategory;
  title: string;
  description: string;
  location: string;
  photoPath?: string | null;
  isAnonymous?: boolean;
}

export async function submitIssue(input: IssueInput): Promise<CampusIssue> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to report a campus issue.');
  const { data, error } = await client
    .from('campus_issues')
    .insert({
      reporter_id: user.id,
      category: input.category,
      title: input.title.trim(),
      description: input.description.trim(),
      location: input.location.trim(),
      photo_path: input.photoPath || null,
      is_anonymous: input.isAnonymous === true
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapIssue(data);
}

export async function fetchMyIssues(): Promise<CampusIssue[]> {
  const { data, error } = await requireSupabase()
    .from('campus_issues')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapIssue);
}

export async function deleteMyIssue(id: string): Promise<void> {
  const { error } = await requireSupabase().from('campus_issues').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Moderator actions ────────────────────────────────────────────────────────

export async function fetchAllIssues(): Promise<CampusIssue[]> {
  const { data, error } = await requireSupabase()
    .from('campus_issues')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapIssue);
}

export async function updateIssueStatus(
  id: string,
  status: IssueStatus,
  patch: { priority?: IssuePriority; adminNotes?: string } = {}
): Promise<void> {
  const row: Record<string, unknown> = { status };
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.adminNotes !== undefined) row.admin_notes = patch.adminNotes;
  const { error } = await requireSupabase().from('campus_issues').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteIssue(id: string): Promise<void> {
  const { error } = await requireSupabase().from('campus_issues').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
