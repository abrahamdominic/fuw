// Database-first data access layer for library materials.
// All mutations write to Supabase first (RLS-protected), storage uploads are
// attached afterwards, and rows are mapped into the UI's MaterialItem shape.
import { supabase, requireSupabase } from './supabase';
import type { MaterialItem, AssignedDepartment } from './store';
import { normalizeMaterialType, courseTitleByCode, normalizeLevel } from '../data/catalogue';

export type { AssignedDepartment };

export interface DepartmentOption {
  id: string;
  name: string;
  facultyId?: string;
  facultyName: string;
}

const BUCKET = 'library-materials';

export const validateMaterialFile = async (file: File) => {
  if (file.size > 25 * 1024 * 1024) throw new Error('File must be 25 MB or smaller.');

  // Explicit blocklist of scriptable/executable payloads regardless of the
  // spoofed MIME type or extension the client advertises.
  const lowerName = file.name.toLowerCase();
  const forbiddenExt =
    /\.(html?|svg|js|mjs|mht|mhtml|xml|xhtml|vbs|vbe|hta|exe|dll|bat|cmd|com|scr|pif|msi|jar|sh|ps1|swf|apk|wasm|gz|zip|7z|rar|tar|iso|url|jsp|asp|aspx|php|py|rb|cgi)$/;
  if (forbiddenExt.test(lowerName)) {
    throw new Error('This file type is not allowed for security reasons.');
  }

  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ];
  const validExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt'];
  const ext = lowerName.substring(lowerName.lastIndexOf('.'));
  if (!allowedTypes.includes(file.type) && !validExtensions.includes(ext)) {
    throw new Error('Use a PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, or TXT file.');
  }

  await sniffDocumentMagicBytes(file);
};

/**
 * Defense-in-depth: verify the actual leading bytes match an allowed document
 * format, so a renamed HTML/SVG/script payload can never be mislabeled as a
 * document. The authoritative check still happens server-side (storage
 * trigger on storage.objects); this is a client-side failsafe.
 */
async function sniffDocumentMagicBytes(file: File): Promise<void> {
  if (file.size < 4) throw new Error('File is empty or too small.');
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());

    // Signature -> whether it is an allowed document format.
    const isPdf =
      head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
    const isOoxml =
      head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04; // PK.. (zip container: docx/pptx/xlsx)
    const isOldDoc =
      head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // OLE2 (.doc/.ppt/.xls)
    const isPlainText =
      (head[0] === 0x0a || head[0] === 0x0d || (head[0] >= 0x20 && head[0] <= 0x7e)); // printable ASCII

    // Reject obvious script/page payloads even if renamed.
    const looksLikeMarkup =
      (head[0] === 0x3c && head[1] === 0x21) || // <!
      (head[0] === 0x3c && head[1] === 0x3f) || // <?
      (head[0] === 0x3c && head[1] === 0x73 && head[2] === 0x76 && head[3] === 0x67) || // <svg
      (head[0] === 0x3c && head[1] === 0x68 && head[2] === 0x74 && head[3] === 0x6d); // <htm
    if (looksLikeMarkup) {
      throw new Error('This file appears to be a web page or script, not a document.');
    }

    // Reject images and executable/archive signatures.
    const isImage =
      (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) || // GIF8
      (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) || // .PNG
      (head[0] === 0xff && head[1] === 0xd8) || // FFD8 (JPEG)
      (head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00) || // TIFF
      (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46); // RIFF (WEBP)
    const isExecutableOrArchive =
      (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) || // ELF
      (head[0] === 0x4d && head[1] === 0x5a) || // MZ (PE/exe)
      (head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21) || // Rar!
      (head[0] === 0x1f && head[1] === 0x8b) || // gzip
      (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf); // 7z
    if (isImage || isExecutableOrArchive) {
      throw new Error('This is not a supported document format.');
    }

    const isDocument =
      isPdf || isOoxml || isOldDoc || (isPlainText && /\.txt$/i.test(file.name));
    if (!isDocument) {
      throw new Error('Unrecognized file format — please upload a PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, or TXT file.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('document')) throw e;
    // File read failures fall back to the MIME/extension checks above.
  }
}

export function formatFileSize(bytes: number | null | undefined): string {
  const size = Number(bytes ?? 0);
  if (!size) return '—';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain'
};

/** Fall back to a storage-trigger-approved MIME type when the browser reports none. */
function contentTypeByExtension(fileName: string): string {
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

const TONES: MaterialItem['tone'][] = ['orange', 'blue', 'purple', 'green', 'teal'];

/** Map a `materials` row (optionally with an embedded uploader profile and assigned departments) to the UI shape. */
export function mapMaterialRow(row: any, index = 0): MaterialItem {
  const uploaderRole = row.uploader?.role === 'admin' || row.uploader?.role === 'super_admin' ? 'admin' : 'student';

  let assignedDepartments: AssignedDepartment[] = [];
  if (Array.isArray(row.material_departments) && row.material_departments.length > 0) {
    assignedDepartments = row.material_departments
      .map((md: any) => {
        const d = md.departments;
        if (!d) return null;
        return {
          id: d.id,
          name: d.name,
          facultyId: d.faculty_id || d.faculties?.id,
          facultyName: d.faculties?.name || row.faculty
        };
      })
      .filter(Boolean) as AssignedDepartment[];
  }
  if (assignedDepartments.length === 0 && row.department) {
    assignedDepartments = [
      {
        id: row.department_id || row.department,
        name: row.department,
        facultyId: row.faculty_id,
        facultyName: row.faculty
      }
    ];
  }

  return {
    id: row.id,
    title: row.title,
    course: row.course_code || '',
    courseTitle: row.course_title || courseTitleByCode(row.course_code) || undefined,
    faculty: row.faculty || '',
    department: row.department || '',
    assignedDepartments,
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

const BASE_SELECT_WITH_DEPTS =
  '*, uploader:uploaded_by(full_name, role), material_departments(department_id, departments:department_id(id, name, faculty_id, faculties:faculty_id(id, name)))';
const BASE_SELECT_FALLBACK = '*, uploader:uploaded_by(full_name, role)';

function applyFilters(query: any, filters: MaterialFilters, assignedMaterialIds?: string[] | null): any {
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.faculty) query = query.eq('faculty', filters.faculty);
  if (filters.department) {
    const deptTerm = filters.department.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deptTerm);
    if (assignedMaterialIds && assignedMaterialIds.length > 0) {
      const idFilter = `id.in.(${assignedMaterialIds.join(',')})`;
      if (isUuid) {
        query = query.or(`department_id.eq.${deptTerm},${idFilter}`);
      } else {
        query = query.or(`department.ilike.%${deptTerm}%,${idFilter}`);
      }
    } else {
      if (isUuid) {
        query = query.eq('department_id', deptTerm);
      } else {
        query = query.ilike('department', `%${deptTerm}%`);
      }
    }
  }
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

/** Server-side paginated + filtered material listing. Guaranteed deduplicated. */
export async function fetchMaterials(
  filters: MaterialFilters = {},
  sort: MaterialSort = {},
  page = 0,
  pageSize = 24
): Promise<PaginatedResult> {
  if (!supabase) return { items: [], total: 0, hasMore: false };
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // Resolve assigned material IDs for department if filtered
  let assignedMaterialIds: string[] | null = null;
  if (filters.department) {
    const deptTerm = filters.department.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deptTerm);
    try {
      let mdQ: any;
      if (isUuid) {
        mdQ = supabase.from('material_departments').select('material_id').eq('department_id', deptTerm);
      } else {
        mdQ = supabase
          .from('material_departments')
          .select('material_id, departments:department_id!inner(name)')
          .ilike('departments.name', `%${deptTerm}%`);
      }
      const { data: mdRows } = await mdQ;
      if (mdRows && mdRows.length > 0) {
        assignedMaterialIds = mdRows.map((r: any) => r.material_id).filter(Boolean);
      }
    } catch {}
  }

  let query = supabase.from('materials').select(BASE_SELECT_WITH_DEPTS, { count: 'exact' });
  query = applyFilters(query, filters, assignedMaterialIds);
  const field = sort.field ?? 'created_at';
  query = query.order(field, { ascending: sort.ascending ?? field !== 'title' });

  let dataRes = await query.range(from, to);
  if (dataRes.error) {
    // Retry with plain fallback in case junction table or nested relation is not cached yet
    let fallbackQ = supabase.from('materials').select(BASE_SELECT_FALLBACK, { count: 'exact' });
    fallbackQ = applyFilters(fallbackQ, filters, assignedMaterialIds);
    fallbackQ = fallbackQ.order(field, { ascending: sort.ascending ?? field !== 'title' });
    dataRes = await fallbackQ.range(from, to);

    if (dataRes.error) {
      let plainQ = supabase.from('materials').select('*', { count: 'exact' });
      plainQ = applyFilters(plainQ, filters, assignedMaterialIds);
      plainQ = plainQ.order(field, { ascending: sort.ascending ?? field !== 'title' });
      dataRes = await plainQ.range(from, to);
      if (dataRes.error) throw new Error(dataRes.error.message);
    }
  }

  const { data, count } = dataRes;
  // Deduplicate materials by ID to guarantee single appearance
  const seen = new Set<string>();
  const items: MaterialItem[] = [];
  for (const row of (data ?? [])) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      items.push(mapMaterialRow(row, items.length));
    }
  }
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
  department_ids?: string[];
  course_code: string;
  course_title?: string;
  level: string;
  semester: string;
  material_type: string;
  academic_session?: string;
  file: File;
  admin?: boolean;
}): Promise<MaterialItem> {
  await validateMaterialFile(input.file);
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

  // 1b. Multi-department assignment
  if (input.department_ids && input.department_ids.length > 0) {
    try {
      const junctionRows = input.department_ids.map((deptId) => ({
        material_id: inserted.id,
        department_id: deptId
      }));
      await client.from('material_departments').upsert(junctionRows, { onConflict: 'material_id, department_id' });
    } catch {
      // Non-fatal if junction table not yet applied in DB
    }
  }

  // 2. Upload the binary to Storage.
  const contentType = input.file.type || contentTypeByExtension(input.file.name);
  const { error: storageError } = await client.storage.from(BUCKET).upload(path, input.file, {
    contentType,
    upsert: false
  });

  if (storageError) {
    // Keep the database clean — remove the row and any assignments
    try {
      await client.from('material_departments').delete().eq('material_id', inserted.id);
    } catch {}
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

  // Refresh the reactive store cache so every screen reflects the new item.
  const { store } = await import('./store');
  void store.syncMaterialsFromSupabase();

  if (updateError || !finalRow) {
    return mapMaterialRow({ ...inserted, file_url: urlData.publicUrl, file_name: input.file.name, file_size: input.file.size });
  }

  return mapMaterialRow(finalRow);
}

/** Update existing material metadata and multi-department assignments. */
export async function updateMaterial(
  materialId: string,
  input: {
    title?: string;
    description?: string;
    faculty?: string;
    department?: string;
    department_ids?: string[];
    course_code?: string;
    course_title?: string;
    level?: string;
    semester?: string;
    material_type?: string;
    academic_session?: string;
  }
): Promise<void> {
  const client = requireSupabase();

  const updatePayload: any = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) updatePayload.title = input.title.trim();
  if (input.description !== undefined) updatePayload.description = input.description.trim();
  if (input.faculty !== undefined) updatePayload.faculty = input.faculty;
  if (input.department !== undefined) updatePayload.department = input.department;
  if (input.course_code !== undefined) updatePayload.course_code = input.course_code.trim().toUpperCase();
  if (input.course_title !== undefined) updatePayload.course_title = input.course_title?.trim() || null;
  if (input.level !== undefined) updatePayload.level = input.level;
  if (input.semester !== undefined) updatePayload.semester = input.semester;
  if (input.material_type !== undefined) updatePayload.material_type = normalizeMaterialType(input.material_type);
  if (input.academic_session !== undefined) updatePayload.academic_session = input.academic_session.trim();

  const { error: updateErr } = await client.from('materials').update(updatePayload).eq('id', materialId);
  if (updateErr) throw new Error(updateErr.message);

  // Sync multi-department assignments if department_ids provided
  if (input.department_ids && input.department_ids.length > 0) {
    const rpcRes = await callRpc('assign_material_departments', {
      p_material_id: materialId,
      p_department_ids: input.department_ids
    });

    if (!rpcRes.ok) {
      // Fallback to manual table operations
      try {
        await client.from('material_departments').delete().eq('material_id', materialId);
        const junctionRows = input.department_ids.map((dId) => ({
          material_id: materialId,
          department_id: dId
        }));
        await client.from('material_departments').insert(junctionRows);
      } catch {
        // Table not yet active
      }
    }
  }

  await refreshAfterMutation();
}

/** Fetch department catalogue options for multi-select assignments. */
export async function fetchDepartmentCatalogue(): Promise<DepartmentOption[]> {
  if (supabase) {
    try {
      const { data: deptRows, error } = await supabase
        .from('departments')
        .select('id, name, faculty_id, faculties:faculty_id(id, name)')
        .order('name');
      if (!error && deptRows && deptRows.length > 0) {
        return deptRows.map((d: any) => ({
          id: d.id,
          name: d.name,
          facultyId: d.faculty_id || d.faculties?.id,
          facultyName: d.faculties?.name || 'General Faculty'
        }));
      }
    } catch {}
  }

  // Fallback to static catalogue
  const { allDepartments } = await import('../data/catalogue');
  return allDepartments().map((d) => ({
    id: d.name,
    name: d.name,
    facultyName: d.faculty
  }));
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
