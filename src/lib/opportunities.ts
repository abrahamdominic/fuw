// Student Opportunities Hub data access (table: student_opportunities).
//
// Reads/writes go through RLS. A student may submit an opportunity (always
// inserted as `pending`) and track/delete their own submission. Moderators
// publish, feature and expire listings.
import { requireSupabase } from './supabase';

export type OpportunityCategory =
  | 'scholarship'
  | 'bursary'
  | 'internship'
  | 'graduate_trainee'
  | 'job'
  | 'hackathon'
  | 'competition'
  | 'fellowship'
  | 'research'
  | 'entrepreneurship'
  | 'course'
  | 'certification'
  | 'other';

export type OpportunityStatus = 'pending' | 'published' | 'rejected' | 'expired' | 'closed';

export interface Opportunity {
  id: string;
  title: string;
  organization: string;
  category: OpportunityCategory;
  description: string;
  eligibility: string;
  qualification: string;
  discipline: string;
  location: string;
  isRemote: boolean;
  deadline: string | null;
  benefits: string;
  applicationInstructions: string;
  applicationUrl: string | null;
  status: OpportunityStatus;
  isFeatured: boolean;
  lastVerifiedAt: string | null;
  submittedBy: string | null;
  moderationNote: string;
  createdAt: string;
}

export interface OpportunityInput {
  title: string;
  organization: string;
  category: OpportunityCategory;
  description: string;
  eligibility: string;
  qualification: string;
  discipline: string;
  location: string;
  isRemote: boolean;
  deadline: string | null;
  benefits: string;
  applicationInstructions: string;
  applicationUrl: string | null;
}

export const OPPORTUNITY_CATEGORIES: { key: OpportunityCategory; label: string }[] = [
  { key: 'scholarship', label: 'Scholarship' },
  { key: 'bursary', label: 'Bursary' },
  { key: 'internship', label: 'Internship' },
  { key: 'graduate_trainee', label: 'Graduate trainee' },
  { key: 'job', label: 'Job' },
  { key: 'hackathon', label: 'Hackathon' },
  { key: 'competition', label: 'Competition' },
  { key: 'fellowship', label: 'Fellowship' },
  { key: 'research', label: 'Research' },
  { key: 'entrepreneurship', label: 'Entrepreneurship' },
  { key: 'course', label: 'Course' },
  { key: 'certification', label: 'Certification' },
  { key: 'other', label: 'Other' }
];

export function opportunityCategoryLabel(category: OpportunityCategory): string {
  return OPPORTUNITY_CATEGORIES.find((item) => item.key === category)?.label ?? category;
}

function mapRow(row: any): Opportunity {
  return {
    id: row.id,
    title: row.title,
    organization: row.organization || '',
    category: (row.category as OpportunityCategory) || 'other',
    description: row.description || '',
    eligibility: row.eligibility || '',
    qualification: row.qualification || '',
    discipline: row.discipline || '',
    location: row.location || '',
    isRemote: row.is_remote === true,
    deadline: row.deadline ?? null,
    benefits: row.benefits || '',
    applicationInstructions: row.application_instructions || '',
    applicationUrl: row.application_url ?? null,
    status: (row.status as OpportunityStatus) || 'pending',
    isFeatured: row.is_featured === true,
    lastVerifiedAt: row.last_verified_at ?? null,
    submittedBy: row.submitted_by ?? null,
    moderationNote: row.moderation_note || '',
    createdAt: row.created_at
  };
}

/** Published, unexpired opportunities for all students. */
export async function fetchPublishedOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await requireSupabase()
    .from('student_opportunities')
    .select('*')
    .eq('status', 'published')
    .order('is_featured', { ascending: false })
    .order('deadline', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** A student's own submissions, in any status. */
export async function fetchMyOpportunitySubmissions(): Promise<Opportunity[]> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) return [];
  const { data, error } = await client
    .from('student_opportunities')
    .select('*')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function submitOpportunity(input: OpportunityInput): Promise<Opportunity> {
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to submit an opportunity.');
  const { data, error } = await client
    .from('student_opportunities')
    .insert({
      title: input.title.trim(),
      organization: input.organization.trim(),
      category: input.category,
      description: input.description.trim(),
      eligibility: input.eligibility.trim(),
      qualification: input.qualification.trim(),
      discipline: input.discipline.trim(),
      location: input.location.trim(),
      is_remote: input.isRemote,
      deadline: input.deadline || null,
      benefits: input.benefits.trim(),
      application_instructions: input.applicationInstructions.trim(),
      application_url: input.applicationUrl?.trim() || null,
      submitted_by: user.id
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function deleteMyOpportunity(id: string): Promise<void> {
  const { error } = await requireSupabase().from('student_opportunities').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Moderator actions ────────────────────────────────────────────────────────

export async function fetchAllOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await requireSupabase()
    .from('student_opportunities')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function setOpportunityStatus(
  id: string,
  status: OpportunityStatus,
  note = ''
): Promise<void> {
  const { error } = await requireSupabase()
    .from('student_opportunities')
    .update({ status, moderation_note: note || '' })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setOpportunityFeatured(id: string, featured: boolean): Promise<void> {
  const { error } = await requireSupabase()
    .from('student_opportunities')
    .update({ is_featured: featured })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function verifyOpportunity(id: string, verified: boolean): Promise<void> {
  const { error } = await requireSupabase()
    .from('student_opportunities')
    .update({ last_verified_at: verified ? new Date().toISOString().slice(0, 10) : null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteOpportunity(id: string): Promise<void> {
  const { error } = await requireSupabase().from('student_opportunities').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Ask the server to mark past-deadline published listings as expired. */
export async function expireOpportunities(): Promise<number> {
  const { data, error } = await requireSupabase().rpc('expire_student_opportunities');
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}

export function daysUntil(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso}T23:59:59`);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}
