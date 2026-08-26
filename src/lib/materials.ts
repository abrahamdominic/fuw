// Database-first data access layer for library materials.
// All mutations write to Supabase first (RLS-protected), storage uploads are
// attached afterwards, and rows are mapped into the UI's MaterialItem shape.
import { supabase, requireSupabase } from './supabase';
import type { MaterialItem } from './store';
import { normalizeMaterialType, courseTitleByCode, normalizeLevel } from '../data/catalogue';

const BUCKET = 'library-materials';

const allowed = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

export const validateMaterialFile = (file: File) => {
  if (file.size > 25 * 1024 * 1024) throw new Error('File must be 25 MB or smaller.');
  const validExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(file.type) && !validExtensions.includes(ext)) {
    throw new Error('Use a PDF, DOC, DOCX, PPT, PPTX, XLS, or XLSX file.');
  }
};

export function formatFileSize(bytes: number | null | undefined): string {
  const size = Number(bytes ?? 0);
  if (!size) return '—';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const TONES: MaterialItem['tone'][] = ['orange', 'blue', 'purple', 'green', 'teal'];

/** Map a `materials` row (optionally with an embedded uploader profile) to the UI shape. */
export function mapMaterialRow(row: any, index = 0): MaterialItem {
  const uploaderRole = row.uploader?.role === 'admin' || row.uploader?.role === 'super_admin' ? 'admin' : 'student';
  return {
    id: row.id,
    title: row.title,
    course: row.course_code || '',
    courseTitle: row.course_title || courseTitleByCode(row.course_code) || undefined,
    faculty: row.faculty || '',
    department: row.department || '',
    type: normalizeMaterialType(row.material_type),
    level: normalizeLevel(row.level),
    semester: row.semester || '',
    session: row.academic_session || '',
    date: row.created_at
      ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
      : '',
    createdAt: row.created_at || undefined,
    downloads: row.downloads ?? 0,
    views: row.views ?? 0,
    tone: TONES[index % TONES.length],
    status: row.status || 'approved',
    rejectionReason: row.rejection_reason || undefined,
    uploadedBy: {
      id: row.uploaded_by || '',
      name: row.uploader?.full_name || 'FUW Repository',
      role: uploaderRole
    },
    fileUrl: row.file_url || '',
    fileName: row.file_name || `${row.title}.pdf`,
    fileSize: formatFileSize(row.file_size),
    description: row.description || ''
  };
}

const BASE_SELECT = '*';

function applyFilters(query: any, filters: MaterialFilters): any {
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.faculty) query = query.eq('faculty', filters.faculty);
  if (filters.department) query = query.eq('department', filters.department);
  if (filters.level) query = query.eq('level', filters.level);
  if (filters.semester) query = query.eq('semester', filters.semester);
  if (filters.courseCode) query = query.ilike('course_code', `%${filters.courseCode}%`);
  if (filters.materialType) query = query.eq('material_type', filters.materialType);
  if (filters.uploadedBy) query = query.eq('uploaded_by', filters.uploadedBy);
  if (filters.search) {
    const term = filters.search.trim();
    if (term) {
      // Escape user input so it is treated literally inside ilike patterns.
      const escaped = term.replace(/[%_,()]/g, (ch) => `\\${ch}`);
      query = query.or(
        `title.ilike.%${escaped}%,course_code.ilike.%${escaped}%,course_title.ilike.%${escaped}%`
      );
    }
  }
  return query;
}

export interface MaterialFilters {
  status?: 'approved' | 'pending' | 'rejected' | 'all';
  faculty?: string;
  department?: string;
  level?: string;
  semester?: string;
  courseCode?: string;
  materialType?: string;
  search?: string;
  uploadedBy?: string;
}

export interface MaterialSort {
  field?: 'created_at' | 'downloads' | 'views' | 'title';
  ascending?: boolean;
}

export interface PaginatedResult {
  items: MaterialItem[];
  total: number;
  hasMore: boolean;
}

/** Server-side paginated + filtered material listing. */
export async function fetchMaterials(
  filters: MaterialFilters = {},
  sort: MaterialSort = {},
  page = 0,
  pageSize = 24
): Promise<PaginatedResult> {
  if (!supabase) return { items: [], total: 0, hasMore: false };
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('materials').select(BASE_SELECT, { count: 'exact' });
  query = applyFilters(query, filters);
  const field = sort.field ?? 'created_at';
  query = query.order(field, { ascending: sort.ascending ?? field !== 'title' });

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((row: any, i: number) => mapMaterialRow(row, i));
  const total = count ?? items.length;
  return { items, total, hasMore: to + 1 < total };
}

/** Convenience wrapper for "My Uploads" pages (optionally server-side searched). */
export function fetchMyMaterials(
  userId: string,
  page = 0,
  pageSize = 10,
  search?: string
): Promise<PaginatedResult> {
  return fetchMaterials({ uploadedBy: userId, search }, {}, page, pageSize);
}

export interface MaterialCounts {
  approved: number;
  pending: number;
  rejected: number;
  totalDownloads: number;
  totalViews: number;
}

/** Aggregate counts for dashboards (three cheap head-count queries). */
export async function fetchMaterialCounts(): Promise<MaterialCounts> {
  if (!supabase) return { approved: 0, pending: 0, rejected: 0, totalDownloads: 0, totalViews: 0 };
  const headCount = async (status?: string) => {
    let q = supabase!.from('materials').select('id', { count: 'exact', head: true });
    if (status) q = q.eq('status', status);
    const { count } = await q;
    return count ?? 0;
  };
  const [approved, pending, rejected] = await Promise.all([headCount('approved'), headCount('pending'), headCount('rejected')]);

  let totalDownloads = 0;
  let totalViews = 0;
  try {
    const { data } = await supabase.rpc('get_library_stats');
    if (data && typeof data[0]?.total_downloads !== 'undefined') {
      totalDownloads = Number(data[0].total_downloads) || 0;
      totalViews = Number(data[0].total_views) || 0;
    }
  } catch {
    // RPC missing — totals stay at zero rather than breaking the dashboard.
  }
  return { approved, pending, rejected, totalDownloads, totalViews };
}

export async function incrementDownload(materialId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_download_count', { material_id: materialId });
  } catch {
    // RPC may not exist yet — the count simply stays stale.
  }
}

export async function incrementView(materialId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('increment_view_count', { material_id: materialId });
  } catch {
    // RPC may not exist yet — the count simply stays stale.
  }
}

async function currentProfile(): Promise<{ id: string; role: string; permissions: string[] } | null> {
  if (!supabase) return null;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, permissions')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;
  return { id: profile.id, role: profile.role ?? 'student', permissions: profile.permissions ?? [] };
}

/**
 * Submit a new material. Database-first:
 *   1. insert the row (so a record exists even before storage finishes),
 *   2. upload the file to Storage,
 *   3. attach file_url / file_name / file_size back onto the row.
 * If storage fails the orphan row is removed again and the error surfaces.
 */
export async function submitMaterial(input: {
  title: string;
  description: string;
  faculty: string;
  department: string;
  course_code: string;
  course_title?: string;
  level: string;
  semester: string;
  material_type: string;
  academic_session?: string;
  file: File;
  admin?: boolean;
}): Promise<MaterialItem> {
  validateMaterialFile(input.file);
  const client = supabase;
  if (!client) throw new Error('Authentication is not configured yet.');

  const {
    data: { user },
    error: userErr
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error('You must be signed in to upload materials.');

  const profile = await currentProfile();
  const isAdminUser =
    !!profile && (profile.role === 'admin' || profile.role === 'super_admin') &&
    (profile.role === 'super_admin' || profile.permissions.includes('upload_as_approved'));

  const status = isAdminUser ? 'approved' : 'pending';
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${user.id}/${Date.now()}-${safeName}`;

  // 1. Insert the database row first.
  const { data: inserted, error: insertError } = await client
    .from('materials')
    .insert({
      title: input.title.trim(),
      description: input.description.trim(),
      faculty: input.faculty,
      department: input.department,
      course_code: input.course_code.trim().toUpperCase(),
      course_title: input.course_title?.trim() || null,
      level: input.level,
      semester: input.semester,
      material_type: normalizeMaterialType(input.material_type),
      academic_session: input.academic_session?.trim() || '',
      status,
      uploaded_by: user.id
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'Could not save your submission. Please try again.');
  }

  // 2. Upload the binary to Storage.
  const { error: storageError } = await client.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false
  });

  if (storageError) {
    // Keep the database clean — remove the row we just created.
    await client.from('materials').delete().eq('id', inserted.id);
    if (storageError.message?.toLowerCase().includes('row-level security')) {
      throw new Error(
        'Upload blocked by storage permissions. Ask an administrator to verify the library-materials bucket policies.'
      );
    }
    throw new Error(storageError.message || 'File upload failed. Please try again.');
  }

  // 3. Attach file metadata to the row.
  const { data: urlData } = client.storage.from(BUCKET).getPublicUrl(path);
  const { data: finalRow, error: updateError } = await client
    .from('materials')
    .update({
      file_url: urlData.publicUrl,
      file_path: path,
      file_name: input.file.name,
      file_size: input.file.size
    })
    .eq('id', inserted.id)
    .select('*')
    .single();

  if (updateError || !finalRow) {
    return mapMaterialRow({ ...inserted, file_url: urlData.publicUrl, file_name: input.file.name, file_size: input.file.size });
  }

  // Refresh the reactive store cache so every screen reflects the new item.
  const { store } = await import('./store');
  void store.syncMaterialsFromSupabase();
  return mapMaterialRow(finalRow);
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  if (!supabase) return { ok: false, message: 'Not configured.' };
  const { error } = await supabase.rpc(fn, args);
  if (!error) return { ok: true };
  // Fall back when the RPC does not exist yet (migration not applied).
  if ((error as any).code === 'PGRST202' || /Could not find the function/i.test(error.message)) {
    return { ok: false, message: 'NO_RPC' };
  }
  return { ok: false, message: error.message };
}

export async function approveMaterial(materialId: string): Promise<void> {
  const res = await callRpc('approve_material_rpc', { p_material_id: materialId });
  if (res.ok) return void (await refreshAfterMutation());
  const client = requireSupabase();
  const { error } = await client
    .from('materials')
    .update({ status: 'approved', rejection_reason: null })
    .eq('id', materialId);
  if (error) throw new Error(error.message);
  await refreshAfterMutation();
}

export async function rejectMaterial(materialId: string, reason: string): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('A rejection reason is required.');
  const res = await callRpc('reject_material_rpc', { p_material_id: materialId, p_reason: trimmed });
  if (res.ok) return void (await refreshAfterMutation());
  const client = requireSupabase();
  const { error } = await client
    .from('materials')
    .update({ status: 'rejected', rejection_reason: trimmed })
    .eq('id', materialId);
  if (error) throw new Error(error.message);
  await refreshAfterMutation();
}

export async function deleteMaterial(materialId: string): Promise<void> {
  const client = requireSupabase();
  // Fetch the storage path first so the binary can be cleaned up too.
  const { data: row } = await client
    .from('materials')
    .select('file_path, title')
    .eq('id', materialId)
    .maybeSingle();

  const { error } = await client.from('materials').delete().eq('id', materialId);
  if (error) throw new Error(error.message);

  if (row?.file_path) {
    await client.storage.from(BUCKET).remove([row.file_path]).catch(() => {});
  }
  await refreshAfterMutation();
}

async function refreshAfterMutation(): Promise<void> {
  const { store } = await import('./store');
  await store.syncMaterialsFromSupabase();
}
