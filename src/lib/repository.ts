// Data access layer for the FUW Institutional Repository.
// Handles theses, dissertations, final-year projects, research papers,
// journal articles, conference papers, and institutional publications.
import { requireSupabase } from './supabase';

export type ResearchItemType =
  | 'final_year_project'
  | 'thesis'
  | 'dissertation'
  | 'research_paper'
  | 'journal_article'
  | 'conference_paper'
  | 'technical_report'
  | 'institutional_publication'
  | 'dataset'
  | 'seminar_paper';

export type ResearchAccess = 'public' | 'registered' | 'restricted' | 'private';
export type ResearchStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'published' | 'archived';

export interface ResearchItemAuthor {
  research_item_id: string;
  profile_id: string | null;
  author_name: string;
  orcid: string | null;
  is_lead: boolean;
  position: number;
}

export interface ResearchItem {
  id: string;
  title: string;
  subtitle: string | null;
  abstract: string;
  keywords: string[];
  research_type: ResearchItemType;
  access_level: ResearchAccess;
  status: ResearchStatus;
  language: string;
  faculty: string | null;
  department: string | null;
  faculty_id: string | null;
  department_id: string | null;
  program: string | null;
  level: string | null;
  year: string | null;
  session: string | null;
  supervisor: string | null;
  institution: string;
  publication_venue: string | null;
  doi: string | null;
  isbn: string | null;
  issn: string | null;
  publisher: string | null;
  edition: string | null;
  citation_count: number;
  download_count: number;
  view_count: number;
  license: string;
  copyright_holder: string | null;
  source: string | null;
  restriction_reason: string | null;
  file_url: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  file_format: string | null;
  page_count: number | null;
  submitted_by: string | null;
  review_date: string | null;
  review_decision: string | null;
  rejection_reason: string | null;
  published_at: string | null;
  version: number;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
  authors?: ResearchItemAuthor[];
  author_names?: string[];
  uploader_name?: string | null;
}

export const RESEARCH_TYPE_LABELS: Record<string, string> = {
  final_year_project: 'Final Year Project',
  thesis: 'Thesis',
  dissertation: 'Dissertation',
  research_paper: 'Research Paper',
  journal_article: 'Journal Article',
  conference_paper: 'Conference Paper',
  technical_report: 'Technical Report',
  institutional_publication: 'Institutional Publication',
  dataset: 'Research Dataset',
  seminar_paper: 'Seminar Paper'
};

export const ACCESS_LABELS: Record<string, string> = {
  public: 'Public',
  registered: 'Registered Users',
  restricted: 'Restricted',
  private: 'Private'
};

const BUCKET = 'library-materials';

export interface ResearchSearchFilters {
  query?: string;
  type?: string;
  departmentId?: string;
  facultyId?: string;
  year?: string;
}

export interface ResearchSearchResult {
  items: ResearchItem[];
  authors: string[];
}

/** Search published repository items with author names baked in. */
export async function searchResearchItems(filters: ResearchSearchFilters = {}): Promise<ResearchSearchResult> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('search_research_items', {
    p_query: filters.query?.trim() ?? '',
    p_type: filters.type || null,
    p_department_id: filters.departmentId || null,
    p_faculty_id: filters.facultyId || null,
    p_year: filters.year || null,
    p_limit: 50,
    p_offset: 0
  });
  if (error) throw error;
  const items = (data || []) as any[];
  return {
    items: items.map(mapRepoRow),
    authors: []
  };
}

/** Fetch a single repository item with authors + uploader detail. */
export async function fetchResearchItem(itemId: string): Promise<{ item: ResearchItem; authors: ResearchItemAuthor[] } | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_research_item_detail', { p_item_id: itemId });
  if (error) throw error;
  if (!data) return null;
  const d = data as any;
  return {
    item: mapRepoRow(d.item),
    authors: (d.authors || []) as ResearchItemAuthor[]
  };
}

export function mapRepoRow(row: any): ResearchItem {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    abstract: row.abstract || '',
    keywords: row.keywords || [],
    research_type: row.research_type || 'research_paper',
    access_level: row.access_level || 'public',
    status: row.status || 'draft',
    language: row.language || 'English',
    faculty: row.faculty,
    department: row.department,
    faculty_id: row.faculty_id,
    department_id: row.department_id,
    program: row.program,
    level: row.level,
    year: row.year,
    session: row.session,
    supervisor: row.supervisor,
    institution: row.institution || 'Federal University Wukari',
    publication_venue: row.publication_venue,
    doi: row.doi,
    isbn: row.isbn,
    issn: row.issn,
    publisher: row.publisher,
    edition: row.edition,
    citation_count: row.citation_count || 0,
    download_count: row.download_count || 0,
    view_count: row.view_count || 0,
    license: row.license || 'CC BY-NC-ND 4.0',
    copyright_holder: row.copyright_holder,
    source: row.source,
    restriction_reason: row.restriction_reason,
    file_url: row.file_url,
    file_path: row.file_path,
    file_name: row.file_name,
    file_size: row.file_size,
    file_format: row.file_format,
    page_count: row.page_count,
    submitted_by: row.submitted_by,
    review_date: row.review_date,
    review_decision: row.review_decision,
    rejection_reason: row.rejection_reason,
    published_at: row.published_at,
    version: row.version || 1,
    is_verified: !!row.is_verified,
    created_at: row.created_at,
    updated_at: row.updated_at,
    authors: row.authors,
    author_names: row.author_names || [],
    uploader_name: row.uploader_name
  };
}

/** Submit a new repository item (students submit drafts; admins may publish). */
export async function submitResearchItem(input: {
  title: string;
  subtitle?: string;
  abstract: string;
  keywords: string[];
  research_type: ResearchItemType;
  faculty_id?: string;
  department_id?: string;
  department?: string;
  faculty?: string;
  program?: string;
  level?: string;
  year?: string;
  session?: string;
  supervisor?: string;
  author_names?: string[];
  doi?: string;
  orcid?: string;
  license?: string;
  file?: File | null;
  admin?: boolean;
}): Promise<ResearchItem> {
  const client = requireSupabase();
  const {
    data: { user },
    error: userErr
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error('You must be signed in to submit to the repository.');

  const status: ResearchStatus = input.admin ? 'approved' : 'submitted';

  let filePath: string | null = null;
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let fileSize: number | null = null;
  let fileFormat: string | null = null;

  if (input.file) {
    const safeName = input.file.name.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
    filePath = `repository/${user.id}/${Date.now()}-${safeName}`;
    fileName = input.file.name;
    fileSize = input.file.size;
    fileFormat = input.file.type || safeName.split('.').pop() || '';
  }

  const { data: inserted, error } = await client
    .from('research_items')
    .insert({
      title: input.title.trim(),
      subtitle: input.subtitle?.trim() || null,
      abstract: input.abstract.trim(),
      keywords: input.keywords.filter(Boolean).map((k) => k.trim()),
      research_type: input.research_type,
      status,
      faculty_id: input.faculty_id || null,
      department_id: input.department_id || null,
      department: input.department || '',
      faculty: input.faculty || '',
      program: input.program?.trim() || null,
      level: input.level || null,
      year: input.year?.trim() || null,
      session: input.session?.trim() || null,
      supervisor: input.supervisor?.trim() || null,
      doi: input.doi?.trim() || null,
      license: input.license?.trim() || 'CC BY-NC-ND 4.0',
      submitted_by: user.id,
      file_path: filePath,
      file_name: fileName,
      file_size: fileSize,
      file_format: fileFormat
    })
    .select('*')
    .single();

  if (error) throw error;

  const item = mapRepoRow(inserted);

  // Insert authors
  const authorNames = input.author_names?.filter(Boolean).map((a) => a.trim()) ?? [];
  if (authorNames.length > 0) {
    try {
      const authorRows = authorNames.map((name, idx) => ({
        research_item_id: item.id,
        author_name: name,
        profile_id: input.orcid && idx === 0 ? user.id : null,
        orcid: idx === 0 ? input.orcid?.trim() || null : null,
        is_lead: idx === 0,
        position: idx
      }));
      await client.from('research_item_authors').insert(authorRows);
    } catch {
      // Non-fatal: an item without author rows still shows the submitter.
    }
  }

  // Upload file after database row exists.
  if (input.file && filePath) {
    const { error: uploadError } = await client.storage.from(BUCKET).upload(filePath, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      upsert: false
    });
    if (uploadError) {
      try {
        await client.from('research_item_authors').delete().eq('research_item_id', item.id);
        await client.from('research_items').delete().eq('id', item.id);
      } catch {
        // Best-effort cleanup; the original error surfaces below.
      }
      throw uploadError;
    }
    // Private bucket: repository documents are served through short-lived signed
    // URLs, so no public URL is persisted.
    const { data: updated } = await client
      .from('research_items')
      .update({ file_url: '' })
      .eq('id', item.id)
      .select('*')
      .single();
    if (updated) {
      return mapRepoRow(updated);
    }
  }

  return item;
}

/** Update a repository item's metadata. */
export async function updateResearchItem(
  itemId: string,
  input: Partial<Pick<ResearchItem, 'title' | 'abstract' | 'keywords' | 'supervisor' | 'year' | 'doi' | 'license' | 'department' | 'faculty'>>
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('research_items')
    .update({
      ...input,
      updated_at: new Date().toISOString()
    })
    .eq('id', itemId);
  if (error) throw error;
}

/** Admin: approve a repository submission. */
export async function approveResearchItem(itemId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('research_items')
    .update({
      status: 'published',
      review_decision: 'approved',
      reviewed_by: (await client.auth.getUser()).data.user?.id,
      review_date: new Date().toISOString(),
      published_at: new Date().toISOString(),
      rejection_reason: null
    })
    .eq('id', itemId);
  if (error) throw error;
}

/** Admin: reject a repository submission with a reason. */
export async function rejectResearchItem(itemId: string, reason: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('research_items')
    .update({
      status: 'rejected',
      review_decision: 'rejected',
      reviewed_by: (await client.auth.getUser()).data.user?.id,
      review_date: new Date().toISOString(),
      rejection_reason: reason.trim()
    })
    .eq('id', itemId);
  if (error) throw error;
}

/** Admin: verify a repository item (server-side verified badge). */
export async function verifyResearchItem(itemId: string, verified: boolean): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('research_items')
    .update({
      is_verified: verified,
      verified_by: verified ? (await client.auth.getUser()).data.user?.id : null,
      verified_at: verified ? new Date().toISOString() : null
    })
    .eq('id', itemId);
  if (error) throw error;
}

/** Admin: archive an item (non-destructive preservation). */
export async function archiveResearchItem(itemId: string, reason?: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('research_items')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      restriction_reason: reason || null
    })
    .eq('id', itemId);
  if (error) throw error;
}

/** Fetch my own repository submissions (any role). */
export async function fetchMyResearchItems(): Promise<ResearchItem[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];
  const { data, error } = await client
    .from('research_items')
    .select('*')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRepoRow);
}

/** Admin: fetch items for the review queue. */
export async function fetchResearchReviewQueue(status = 'under_review'): Promise<ResearchItem[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('research_items')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRepoRow);
}

/** Increment download counter (server-side). */
export async function incrementResearchDownload(itemId: string): Promise<void> {
  const client = requireSupabase();
  try {
    await client.rpc('increment_research_downloads', { p_item_id: itemId });
  } catch {
    // RPC may not exist yet — count remains stale.
  }
}

/** Increment view counter (server-side). */
export async function incrementResearchView(itemId: string): Promise<void> {
  const client = requireSupabase();
  try {
    await client.rpc('increment_research_views', { p_item_id: itemId });
  } catch {
    // RPC may not exist yet — count remains stale.
  }
}

/**
 * Secure download link for a repository item.
 *
 * Storage gates the bytes behind `has_premium_access()`, so there is no fallback
 * to the stored public URL — an empty string means "no access, show the paywall".
 */
const SIGNED_URL_TTL_SECONDS = 300;

export async function getResearchFileUrl(item: ResearchItem): Promise<string> {
  // Deliberately no fallback to the stored public URL: repository documents
  // share the premium gate, so an empty string means "no access".
  if (!item.file_path) return '';
  try {
    const client = requireSupabase();
    const { data, error } = await client.storage
      .from(BUCKET)
      // Short-lived on purpose: a signed URL cannot be revoked once issued, so a
      // long lifetime would keep working after an entitlement was withdrawn.
      .createSignedUrl(item.file_path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return '';
    return data.signedUrl;
  } catch {
    return '';
  }
}

/** Admin: aggregate repository statistics. */
export async function getRepositoryStats(): Promise<Record<string, unknown>> {
  const client = requireSupabase();
  try {
    const { data } = await client.rpc('get_repository_stats');
    return (data as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

/** Delete a repository item (admin only). */
export async function deleteResearchItem(itemId: string): Promise<void> {
  const client = requireSupabase();
  const { data: row } = await client
    .from('research_items')
    .select('file_path')
    .eq('id', itemId)
    .maybeSingle();
  const { error } = await client.from('research_items').delete().eq('id', itemId);
  if (error) throw error;
  if (row?.file_path) {
    await client.storage.from(BUCKET).remove([row.file_path]).catch(() => {});
  }
}