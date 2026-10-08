import { catalogue, materialTypes, normalizeLevel } from '../data/catalogue';
import { supabase } from './supabase';
import { logUserActivity } from './activity';

// Timezone-aware helpers: the browser always reports the visitor's local
// timezone, so formatting through Intl gives each student their real local time.
export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Time';
  } catch {
    return 'Local Time';
  }
}

export function formatUserTime(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function getTimeGreeting(name?: string, date: Date = new Date()): string {
  const hour = date.getHours();
  let greeting = 'Good morning';
  if (hour >= 12 && hour < 17) {
    greeting = 'Good afternoon';
  } else if (hour >= 17) {
    greeting = 'Good evening';
  }
  return name ? `${greeting}, ${name}` : greeting;
}

function safeSync(promiseLike: any) {
  if (!promiseLike) return;
  Promise.resolve(promiseLike).catch(() => {});
}


export interface StudentSettings {
  notifications: {
    approvalAlerts: boolean;
    rejectionAlerts: boolean;
    newCourseMaterials: boolean;
    securityAlerts: boolean;
  };
  reading: {
    defaultSort: 'newest' | 'downloads' | 'az';
    defaultView: 'grid' | 'list';
    defaultZoom: number;
    rememberFilters: boolean;
  };
}

export interface AdminSettings {
  general: {
    libraryName: string;
    libraryDescription: string;
    contactEmail: string;
    supportPhone: string;
    academicSession: string;
    campusLocation: string;
    announcementText: string;
  };
  materials: {
    maxUploadSizeMb: number;
    allowedFileTypes: string[];
    requireApprovalForStudentUploads: boolean;
    keepRejectedVisibleToStudents: boolean;
    defaultMaterialStatus: 'approved' | 'pending';
    enablePublicDownloads: boolean;
  };
  users: {
    allowStudentRegistration: boolean;
    requireAccountVerification: boolean;
    allowStudentUploads: boolean;
    allowStudentComments: boolean;
    maxUploadsPerStudentPerDay: number;
  };
  notifications: {
    notifyOnNewSubmissions: boolean;
    notifyStudentOnApproval: boolean;
    notifyStudentOnRejection: boolean;
    notifyAdminOnRegistrations: boolean;
    securityAuditAlerts: boolean;
    adminNotificationEmail: string;
  };
  security: {
    sessionTimeoutMinutes: number;
    enforce2FA: boolean;
    rateLimitPer15Min: number;
    allowGuestBrowsing: boolean;
  };
}

export const DEFAULT_STUDENT_SETTINGS: StudentSettings = {
  notifications: {
    approvalAlerts: true,
    rejectionAlerts: true,
    newCourseMaterials: true,
    securityAlerts: true
  },
  reading: {
    defaultSort: 'newest',
    defaultView: 'grid',
    defaultZoom: 100,
    rememberFilters: true
  }
};

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  general: {
    libraryName: 'Federal University Wukari Digital Library',
    libraryDescription: 'The central digital repository and open educational resource hub for FUW faculty and students.',
    contactEmail: 'library@fuw.edu.ng',
    supportPhone: '+234 800 FUW LIBS',
    academicSession: '2025/2026',
    campusLocation: 'Kastina-Ala Road, PMB 1020, Wukari, Taraba State',
    announcementText: 'Welcome to the updated FUW E-Library platform. First Semester 2025/2026 course notes are now online!'
  },
  materials: {
    maxUploadSizeMb: 25,
    allowedFileTypes: ['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'XLS', 'XLSX'],
    requireApprovalForStudentUploads: true,
    keepRejectedVisibleToStudents: true,
    defaultMaterialStatus: 'pending',
    enablePublicDownloads: true
  },
  users: {
    allowStudentRegistration: true,
    requireAccountVerification: true,
    allowStudentUploads: true,
    allowStudentComments: false,
    maxUploadsPerStudentPerDay: 5
  },
  notifications: {
    notifyOnNewSubmissions: true,
    notifyStudentOnApproval: true,
    notifyStudentOnRejection: true,
    notifyAdminOnRegistrations: true,
    securityAuditAlerts: true,
    adminNotificationEmail: 'admin.library@fuw.edu.ng'
  },
  security: {
    sessionTimeoutMinutes: 60,
    enforce2FA: false,
    rateLimitPer15Min: 300,
    allowGuestBrowsing: true
  }
};

export interface AssignedDepartment {
  id: string;
  name: string;
  facultyId?: string;
  facultyName?: string;
}

export interface MaterialItem {
  id: string;
  title: string;
  course: string;
  courseTitle?: string;
  faculty: string;
  department: string;
  assignedDepartments?: AssignedDepartment[];
  type: string;
  level: string;
  semester: string;
  session: string;
  date: string;
  createdAt?: string;
  downloads: number;
  views: number;
  tone: 'orange' | 'blue' | 'purple' | 'green' | 'teal';
  status: 'approved' | 'pending' | 'rejected';
  rejectionReason?: string;
  uploadedBy: {
    id: string;
    name: string;
    role: 'student' | 'admin';
    matricNumber?: string;
  };
  fileUrl: string;
  fileName: string;
  filePath?: string;
  fileSize: string;
  description: string;
  contentSnippet?: string;
}

export interface UserProfile {
  id: string;
  fullName: string;
  displayName: string;
  email: string;
  matricNumber: string;
  role: 'STUDENT' | 'ADMIN' | 'LIBRARIAN' | 'LECTURER';
  faculty: string;
  department: string;
  level: string;
  bio?: string;
  avatarUrl?: string;
  isVerified: boolean;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  joinedDate: string;
}

export interface AuditLogItem {
  id: string;
  action: string;
  performedBy: string;
  performedById?: string;
  entity: string;
  entityId?: string;
  timestamp: string;
  details?: string;
}

export interface DownloadRecord {
  id: string;
  materialId: string;
  materialTitle: string;
  course: string;
  fileSize: string;
  downloadedAt: string;
}

export interface RecentViewRecord {
  id: string;
  materialId: string;
  viewedAt: string;
}

export interface ReadingProgressRecord {
  id: string;
  materialId: string;
  materialTitle: string;
  course: string;
  currentPage: number;
  totalPages: number;
  percentage: number;
  lastReadAt: string;
}

// Materials are loaded live from the Supabase `materials` table.
// No mock/seed materials: the library only ever shows real database records.
const INITIAL_MATERIALS: MaterialItem[] = [];

// Guest placeholder used only while nobody is signed in. All identity fields
// are empty; real profile data always comes from the Supabase `profiles` table.
export const GUEST_USER: UserProfile = {
  id: '',
  fullName: '',
  displayName: '',
  email: '',
  matricNumber: '',
  role: 'STUDENT',
  faculty: '',
  department: '',
  level: '',
  bio: '',
  avatarUrl: '',
  isVerified: false,
  verificationStatus: 'PENDING',
  joinedDate: ''
};

// Audit logs are recorded from real actions and start empty.
const INITIAL_AUDIT_LOGS: AuditLogItem[] = [];

class MaterialsStore {
  private materials: MaterialItem[] = [];
  private currentUser: UserProfile = GUEST_USER;
  private isStudentAuthenticated: boolean = false;
  private isAdminAuthenticated: boolean = false;
  // Personal activity (bookmarks, downloads, views, reading progress) starts
  // empty per student and grows from real interactions only.
  private bookmarks: string[] = [];
  private downloadHistory: DownloadRecord[] = [];
  private recentViews: RecentViewRecord[] = [];
  private readingHistory: ReadingProgressRecord[] = [];
  private auditLogs: AuditLogItem[] = INITIAL_AUDIT_LOGS;
  private userStats: { studentsCount: number; verifiedStudents: number } = {
    studentsCount: 0,
    verifiedStudents: 0
  };
  private studentSettings: StudentSettings = { ...DEFAULT_STUDENT_SETTINGS };
  private adminSettings: AdminSettings = { ...DEFAULT_ADMIN_SETTINGS };
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
    this.syncMaterialsFromSupabase();
    this.fetchUserStats();
  }

  public async syncMaterialsFromSupabase() {
    if (!supabase) return;
    try {
      let data: any[] | null = null;
      const res = await supabase
        .from('materials')
        .select('*, uploader:uploaded_by(full_name, role), material_departments(department_id, departments:department_id(id, name, faculty_id, faculties:faculty_id(id, name)))')
        .order('created_at', { ascending: false });

      if (!res.error && res.data) {
        data = res.data;
      } else {
        const fb = await supabase.from('materials').select('*').order('created_at', { ascending: false });
        if (!fb.error && fb.data) {
          data = fb.data;
        }
      }

      if (data) {
        const toneList: MaterialItem['tone'][] = ['orange', 'blue', 'purple', 'green', 'teal'];
        const mapped: MaterialItem[] = data.map((row: any, i: number) => {
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
            assignedDepartments = [{
              id: row.department_id || row.department,
              name: row.department,
              facultyId: row.faculty_id,
              facultyName: row.faculty
            }];
          }

          const uploaderRole = row.uploader?.role === 'admin' || row.uploader?.role === 'super_admin' ? 'admin' : 'student';

          return {
            id: row.id,
            title: row.title,
            course: row.course_code || 'GEN 101',
            courseTitle: row.course_title || row.title,
            faculty: row.faculty,
            department: row.department,
            assignedDepartments,
            type: row.material_type || 'Lecture Note',
            level: normalizeLevel(row.level) || '100 Level',
            semester: row.semester || 'First Semester',
            session: row.academic_session || row.session || '2025/2026',
            date: row.created_at ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '',
            createdAt: row.created_at || undefined,
            downloads: row.downloads || 0,
            views: row.views || 0,
            tone: toneList[i % toneList.length],
            status: row.status || 'approved',
            rejectionReason: row.rejection_reason,
            uploadedBy: {
              id: row.uploaded_by || 'system',
              name: row.uploader?.full_name || row.uploaded_by_name || 'FUW Repository',
              role: uploaderRole
            },
            // Materials are opened through `getSecureFileUrl`, which mints a
            // signed URL from `file_path`. There is no public document to fall
            // back to, and the reader treats an empty URL as "no file" (the same
            // convention `lib/materials.ts` uses) instead of requesting a path
            // that does not exist.
            fileUrl: row.file_url || '',
            fileName: row.file_name || `${row.title}.pdf`,
            fileSize: row.file_size || '3.5 MB',
            description: row.description || ''
          };
        });

        // Deduplicate materials by ID to guarantee single appearance
        const dedupedMap = new Map<string, MaterialItem>();
        for (const item of mapped) {
          if (!dedupedMap.has(item.id)) {
            dedupedMap.set(item.id, item);
          }
        }
        this.materials = Array.from(dedupedMap.values());
        this.saveMaterials();
        this.notify();
      }
    } catch {
      // Keep local cached materials
    }
  }

  /**
   * Live aggregate user counts from the Supabase `profiles` table through the
   * SECURITY DEFINER RPC `get_public_stats()` so anonymous visitors can see
   * real registration numbers without exposing any personal profile rows.
   */
  public async fetchUserStats() {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc('get_public_stats');
      if (!error && data && data.length > 0) {
        this.userStats = {
          studentsCount: Number(data[0].students) || 0,
          verifiedStudents: Number(data[0].verified_students) || 0
        };
        this.notify();
      }
    } catch {
      // Stats remain at zero until the database responds
    }
  }

  public getUserStats() {
    return { ...this.userStats };
  }

  public setAuthenticatedStudent(user: UserProfile) {
    this.isStudentAuthenticated = true;
    this.isAdminAuthenticated = false;
    this.currentUser = user;
    localStorage.setItem('fuw_student_session', 'true');
    this.saveUser();
    this.notify();
  }

  public setAuthenticatedAdmin(user: UserProfile) {
    this.isAdminAuthenticated = true;
    this.isStudentAuthenticated = true;
    this.currentUser = user;
    localStorage.setItem('fuw_student_session', 'true');
    this.saveUser();
    this.notify();
  }

  public setAuthenticatedLecturer(user: UserProfile) {
    this.isAdminAuthenticated = false;
    this.isStudentAuthenticated = false;
    this.currentUser = user;
    localStorage.setItem('fuw_lecturer_session', 'true');
    this.saveUser();
    this.notify();
  }

  public clearAuthentication() {
    this.isStudentAuthenticated = false;
    this.isAdminAuthenticated = false;
    this.currentUser = GUEST_USER;
    localStorage.removeItem('fuw_student_session');
    localStorage.removeItem('fuw_lecturer_session');
    localStorage.removeItem('fuw_user_profile');
    this.notify();
  }

  public isLoggedInStudent(): boolean {
    return this.isStudentAuthenticated;
  }

  public isLoggedInAdmin(): boolean {
    return this.isAdminAuthenticated;
  }

  public isLoggedInLecturer(): boolean {
    return this.currentUser?.role === 'LECTURER';
  }

  // NOTE: All sign-in / sign-out flows are handled exclusively through
  // Supabase username + password authentication (see src/lib/AuthContext.tsx).
  // The former mock loginStudent()/loginAdmin() helpers have been removed.

  public logoutStudent(): void {
    this.isStudentAuthenticated = false;
    localStorage.removeItem('fuw_student_session');
    this.notify();
  }

  public logoutAdmin(): void {
    this.isAdminAuthenticated = false;
    this.notify();
  }

  // --- Material Accessors ---

  public getApprovedMaterials(): MaterialItem[] {
    return this.materials.filter((m) => m.status === 'approved');
  }

  /**
   * Return approved materials assigned to a specific department.
   * Matches both the primary department and any assigned departments in material_departments.
   * Deduplicates by material ID so materials never appear twice.
   */
  public getApprovedMaterialsForDepartment(departmentName?: string): MaterialItem[] {
    const approved = this.getApprovedMaterials();
    if (!departmentName || !departmentName.trim()) return approved;

    const deptLower = departmentName.trim().toLowerCase();
    const seen = new Set<string>();
    const matched: MaterialItem[] = [];

    for (const m of approved) {
      const matches =
        (m.department && m.department.trim().toLowerCase() === deptLower) ||
        m.assignedDepartments?.some(
          (d) =>
            (d.name && d.name.trim().toLowerCase() === deptLower) ||
            (d.id && d.id.trim().toLowerCase() === deptLower)
        );

      if (matches && !seen.has(m.id)) {
        seen.add(m.id);
        matched.push(m);
      }
    }

    // If the student's department has materials, return them; otherwise fall back to all approved materials
    return matched.length > 0 ? matched : approved;
  }

  public getAllMaterials(): MaterialItem[] {
    return [...this.materials];
  }

  public getPendingMaterials(): MaterialItem[] {
    return this.materials.filter((m) => m.status === 'pending');
  }

  public getRejectedMaterials(): MaterialItem[] {
    return this.materials.filter((m) => m.status === 'rejected');
  }

  public getStudentUploads(studentId: string): MaterialItem[] {
    return this.materials.filter((m) => m.uploadedBy.id === studentId);
  }

  public getMaterialById(id: string): MaterialItem | undefined {
    return this.materials.find((m) => m.id === id);
  }

  // --- Material Actions (Database Update, Insert, Edit, Delete) ---

  /**
   * Admin direct upload & publish: Immediately approved and live on frontend
   */
  public publishMaterialAdmin(input: {
    title: string;
    description: string;
    faculty: string;
    department: string;
    course_code: string;
    course_title?: string;
    level: string;
    semester: string;
    material_type: string;
    file: File | { name: string; size: number };
  }): MaterialItem {
    const toneList: MaterialItem['tone'][] = ['orange', 'blue', 'purple', 'green', 'teal'];
    const tone = toneList[Math.floor(Math.random() * toneList.length)];
    const sizeMb = (input.file.size / (1024 * 1024)).toFixed(1);

    const newMaterial: MaterialItem = {
      id: 'mat-' + Date.now(),
      title: input.title.trim(),
      course: input.course_code.trim() || 'GEN 101',
      courseTitle: input.course_title?.trim() || input.title.trim(),
      faculty: input.faculty,
      department: input.department,
      type: input.material_type || 'Lecture Note',
      level: input.level || '100 Level',
      semester: input.semester || 'First Semester',
      session: '2025/2026',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      createdAt: new Date().toISOString(),
      downloads: 0,
      views: 1,
      tone,
      status: 'approved',
      uploadedBy: {
        id: this.currentUser.id,
        name: this.currentUser.fullName + ' (Admin)',
        role: 'admin'
      },
      fileUrl: URL.createObjectURL(input.file instanceof File ? input.file : new Blob([])),
      fileName: input.file.name,
      fileSize: `${sizeMb} MB`,
      description: input.description.trim()
    };

    this.materials.unshift(newMaterial);
    this.saveMaterials();

    // Async sync with Supabase / API backend if configured
    if (supabase) {
      safeSync(
        supabase.from('materials').insert({
          id: newMaterial.id,
          title: newMaterial.title,
          description: newMaterial.description,
          faculty: newMaterial.faculty,
          department: newMaterial.department,
          level: newMaterial.level,
          course_code: newMaterial.course,
          course_title: newMaterial.courseTitle,
          semester: newMaterial.semester,
          material_type: newMaterial.type,
          // Never persist the local blob: URL. A blob: URL dies with this tab,
          // and file_url must not be used as a document link now that the bucket
          // is private. file_path (not file_url) is what signed access uses.
          file_url: '',
          file_name: newMaterial.fileName,
          status: 'approved'
        })
      );
    }

    this.addAuditLog(
      'MATERIAL_PUBLISHED',
      `${this.currentUser.fullName} (Admin)`,
      `${newMaterial.title} (${newMaterial.course})`,
      newMaterial.id,
      'Directly published to library database'
    );

    this.notify();
    return newMaterial;
  }

  /**
   * Student material submission: Status is PENDING and requires Admin approval
   */
  public submitMaterialStudent(input: {
    title: string;
    description: string;
    faculty: string;
    department: string;
    course_code: string;
    course_title?: string;
    level: string;
    semester: string;
    material_type: string;
    file: File | { name: string; size: number };
  }): MaterialItem {
    const toneList: MaterialItem['tone'][] = ['orange', 'blue', 'purple', 'green', 'teal'];
    const tone = toneList[Math.floor(Math.random() * toneList.length)];
    const sizeMb = (input.file.size / (1024 * 1024)).toFixed(1);

    const newMaterial: MaterialItem = {
      id: 'mat-' + Date.now(),
      title: input.title.trim(),
      course: input.course_code.trim() || 'GEN 101',
      courseTitle: input.course_title?.trim() || input.title.trim(),
      faculty: input.faculty,
      department: input.department,
      type: input.material_type || 'Lecture Note',
      level: input.level || '100 Level',
      semester: input.semester || 'First Semester',
      session: '2025/2026',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      createdAt: new Date().toISOString(),
      downloads: 0,
      views: 0,
      tone,
      status: 'pending',
      uploadedBy: {
        id: this.currentUser.id,
        name: this.currentUser.fullName,
        role: 'student',
        matricNumber: this.currentUser.matricNumber
      },
      fileUrl: URL.createObjectURL(input.file instanceof File ? input.file : new Blob([])),
      fileName: input.file.name,
      fileSize: `${sizeMb} MB`,
      description: input.description.trim()
    };

    this.materials.unshift(newMaterial);
    this.saveMaterials();

    // Async sync with Supabase / backend if available
    if (supabase) {
      safeSync(
        supabase.from('materials').insert({
          id: newMaterial.id,
          title: newMaterial.title,
          description: newMaterial.description,
          faculty: newMaterial.faculty,
          department: newMaterial.department,
          level: newMaterial.level,
          course_code: newMaterial.course,
          course_title: newMaterial.courseTitle,
          semester: newMaterial.semester,
          material_type: newMaterial.type,
          // Never persist the local blob: URL. A blob: URL dies with this tab,
          // and file_url must not be used as a document link now that the bucket
          // is private. file_path (not file_url) is what signed access uses.
          file_url: '',
          file_name: newMaterial.fileName,
          status: 'pending'
        })
      );
    }

    this.addAuditLog(
      'STUDENT_MATERIAL_SUBMISSION',
      `${this.currentUser.fullName} (${this.currentUser.matricNumber})`,
      `${newMaterial.title} (${newMaterial.course})`,
      newMaterial.id,
      'Submitted to database awaiting administrator approval'
    );

    this.notify();
    return newMaterial;
  }

  /**
   * Admin approves a pending material -> instantly live on the frontend & updated in DB
   */
  public approveMaterial(materialId: string, adminName: string = 'Administrator'): boolean {
    const material = this.materials.find((m) => m.id === materialId);
    if (!material) return false;

    material.status = 'approved';
    material.rejectionReason = undefined;
    this.saveMaterials();

    if (supabase) {
      safeSync(
        supabase.from('materials').update({ status: 'approved', rejection_reason: null }).eq('id', materialId)
      );
    }

    this.addAuditLog(
      'MATERIAL_APPROVED',
      adminName,
      `${material.title} (${material.course})`,
      material.id,
      'Approved and published in database to public library'
    );

    this.notify();
    return true;
  }

  /**
   * Admin rejects a material -> updated in database
   */
  public rejectMaterial(materialId: string, reason: string, adminName: string = 'Administrator'): boolean {
    const material = this.materials.find((m) => m.id === materialId);
    if (!material) return false;

    material.status = 'rejected';
    material.rejectionReason = reason || 'Does not meet academic submission standards.';
    this.saveMaterials();

    if (supabase) {
      safeSync(
        supabase.from('materials').update({ status: 'rejected', rejection_reason: material.rejectionReason }).eq('id', materialId)
      );
    }

    this.addAuditLog(
      'MATERIAL_REJECTED',
      adminName,
      `${material.title} (${material.course})`,
      material.id,
      `Reason: ${material.rejectionReason}`
    );

    this.notify();
    return true;
  }

  /**
   * Edit material metadata -> updated in database and state
   */
  public editMaterial(materialId: string, updates: Partial<MaterialItem>, performerName: string = 'Administrator'): boolean {
    const material = this.materials.find((m) => m.id === materialId);
    if (!material) return false;

    Object.assign(material, updates);
    this.saveMaterials();

    if (supabase) {
      const dbPayload: any = {};
      if (updates.title !== undefined) dbPayload.title = updates.title;
      if (updates.description !== undefined) dbPayload.description = updates.description;
      if (updates.faculty !== undefined) dbPayload.faculty = updates.faculty;
      if (updates.department !== undefined) dbPayload.department = updates.department;
      if (updates.course !== undefined) dbPayload.course_code = updates.course;
      if (updates.courseTitle !== undefined) dbPayload.course_title = updates.courseTitle;
      if (updates.level !== undefined) dbPayload.level = updates.level;
      if (updates.semester !== undefined) dbPayload.semester = updates.semester;
      if (updates.type !== undefined) dbPayload.material_type = updates.type;
      if (updates.session !== undefined) dbPayload.academic_session = updates.session;
      if (Object.keys(dbPayload).length > 0) {
        safeSync(
          supabase.from('materials').update(dbPayload).eq('id', materialId)
        );
      }
    }

    this.addAuditLog(
      'MATERIAL_UPDATED',
      performerName,
      `${material.title} (${material.course})`,
      material.id,
      'Updated material metadata in database'
    );

    this.notify();
    return true;
  }

  /**
   * Delete a material -> removed from database and storage
   */
  public deleteMaterial(materialId: string, performerName: string = 'Admin'): boolean {
    const index = this.materials.findIndex((m) => m.id === materialId);
    if (index === -1) return false;

    const removed = this.materials.splice(index, 1)[0];
    this.saveMaterials();

    if (supabase) {
      safeSync(
        supabase.from('materials').delete().eq('id', materialId)
      );
    }

    this.addAuditLog(
      'MATERIAL_DELETED',
      performerName,
      `${removed.title} (${removed.course})`,
      removed.id,
      'Deleted from library database'
    );

    this.notify();
    return true;
  }

  // --- Interaction Records ---

  public isBookmarked(materialId: string): boolean {
    return this.bookmarks.includes(materialId);
  }

  public toggleBookmark(materialId: string): boolean {
    const exists = this.bookmarks.includes(materialId);
    if (exists) {
      this.bookmarks = this.bookmarks.filter((id) => id !== materialId);
    } else {
      this.bookmarks.unshift(materialId);
    }
    this.saveBookmarks();
    this.notify();
    // Mirrors the change to the server-backed bookmarks table (cross-device sync).
    // Best-effort: anonymous/local users simply keep their device bookmarks.
    void this.mirrorBookmarkToDb(materialId, !exists);
    return !exists;
  }

  /** Merge server bookmarks in (union with local); used after sign-in/sync. */
  public mergeBookmarks(ids: string[]): void {
    const existing = new Set(this.bookmarks);
    let changed = false;
    for (const id of ids) {
      if (id && !existing.has(id)) {
        this.bookmarks.push(id);
        changed = true;
      }
    }
    if (changed) {
      this.saveBookmarks();
      this.notify();
    }
  }

  /** Pull this user's server bookmarks and merge them into local state. */
  public async pullBookmarksFromDb(): Promise<void> {
    if (!supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.id) return;
      const ids: string[] = [];
      const { data: rpcIds, error: rpcErr } = await supabase.rpc('get_my_bookmark_ids');
      if (!rpcErr && Array.isArray(rpcIds)) {
        ids.push(...rpcIds.filter((x): x is string => typeof x === 'string'));
      } else {
        const { data: rows, error } = await supabase
          .from('material_bookmarks')
          .select('material_id')
          .eq('user_id', user.id);
        if (!error && rows) {
          ids.push(...rows.map((r: any) => r.material_id).filter((x: unknown): x is string => typeof x === 'string'));
        }
      }
      if (ids.length > 0) this.mergeBookmarks(ids);
    } catch {
      // Best-effort only.
    }
  }

  private async mirrorBookmarkToDb(materialId: string, added: boolean): Promise<void> {
    if (!supabase) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !user.id) return;
      if (added) {
        await supabase.from('material_bookmarks').insert({ user_id: user.id, material_id: materialId }).select().maybeSingle();
      } else {
        await supabase.from('material_bookmarks').delete().eq('user_id', user.id).eq('material_id', materialId);
      }
    } catch {
      // Best-effort only.
    }
  }

  public getSavedMaterials(): MaterialItem[] {
    return this.materials.filter((m) => this.bookmarks.includes(m.id));
  }

  public recordDownload(materialId: string): void {
    const material = this.materials.find((m) => m.id === materialId);
    if (!material) return;

    material.downloads += 1;
    this.saveMaterials();

    const record: DownloadRecord = {
      id: 'dl-' + Date.now(),
      materialId,
      materialTitle: material.title,
      course: material.course,
      fileSize: material.fileSize,
      downloadedAt: 'Just now'
    };

    this.downloadHistory.unshift(record);
    this.saveDownloads();
    this.notify();

    logUserActivity({
      activityType: 'material_downloaded',
      entityType: 'elibrary_material',
      entityId: materialId,
      entityTitle: material.title,
      metadata: { course: material.course, fileSize: material.fileSize }
    }).catch(() => {});
  }

  public getDownloadHistory(): DownloadRecord[] {
    return [...this.downloadHistory];
  }

  public recordView(materialId: string): void {
    const material = this.materials.find((m) => m.id === materialId);
    if (material) {
      material.views += 1;
      this.saveMaterials();

      logUserActivity({
        activityType: 'material_viewed',
        entityType: 'elibrary_material',
        entityId: materialId,
        entityTitle: material.title,
        metadata: { course: material.course }
      }).catch(() => {});
    }

    // Add to recent views (prevent duplicate immediate repeats)
    const existingIndex = this.recentViews.findIndex((r) => r.materialId === materialId);
    if (existingIndex !== -1) {
      this.recentViews.splice(existingIndex, 1);
    }

    this.recentViews.unshift({
      id: 'view-' + Date.now(),
      materialId,
      viewedAt: 'Just now'
    });

    if (this.recentViews.length > 20) {
      this.recentViews.pop();
    }

    this.saveRecent();
    this.notify();
  }

  public getRecentMaterials(): MaterialItem[] {
    const ids = this.recentViews.map((r) => r.materialId);
    return ids.map((id) => this.materials.find((m) => m.id === id)).filter(Boolean) as MaterialItem[];
  }

  public saveReadingProgress(materialId: string, page: number, totalPages: number): void {
    const material = this.materials.find((m) => m.id === materialId);
    if (!material) return;

    const percentage = Math.round((page / totalPages) * 100);
    const existingIndex = this.readingHistory.findIndex((r) => r.materialId === materialId);

    const record: ReadingProgressRecord = {
      id: 'read-' + Date.now(),
      materialId,
      materialTitle: material.title,
      course: material.course,
      currentPage: page,
      totalPages,
      percentage,
      lastReadAt: 'Just now'
    };

    if (existingIndex !== -1) {
      this.readingHistory.splice(existingIndex, 1);
    }
    this.readingHistory.unshift(record);
    this.saveReading();
    this.notify();

    if (percentage >= 100) {
      logUserActivity({
        activityType: 'material_completed',
        entityType: 'elibrary_material',
        entityId: materialId,
        entityTitle: material.title,
        metadata: { course: material.course, totalPages }
      }).catch(() => {});
    }
  }

  public getReadingHistory(): ReadingProgressRecord[] {
    return [...this.readingHistory];
  }

  // --- User Profile & Auth State ---

  public getCurrentUser(): UserProfile {
    return { ...this.currentUser };
  }

  public updateUserProfile(data: Partial<UserProfile>): UserProfile {
    this.currentUser = { ...this.currentUser, ...data };
    this.saveUser();

    if (supabase) {
      safeSync(
        supabase.from('profiles').update(data).eq('id', this.currentUser.id)
      );
    }

    this.notify();
    return this.currentUser;
  }

  // --- Student Settings & Preferences ---

  public getStudentSettings(): StudentSettings {
    return JSON.parse(JSON.stringify(this.studentSettings));
  }

  public updateStudentSettings(updates: Partial<StudentSettings>): StudentSettings {
    this.studentSettings = {
      ...this.studentSettings,
      ...updates,
      notifications: {
        ...this.studentSettings.notifications,
        ...(updates.notifications || {})
      },
      reading: {
        ...this.studentSettings.reading,
        ...(updates.reading || {})
      }
    };
    this.saveStudentSettings();
    this.notify();
    return this.getStudentSettings();
  }

  // --- Admin Settings & System Configuration ---

  public getAdminSettings(): AdminSettings {
    return JSON.parse(JSON.stringify(this.adminSettings));
  }

  public updateAdminSettings(updates: Partial<AdminSettings>): AdminSettings {
    this.adminSettings = {
      ...this.adminSettings,
      ...updates,
      general: {
        ...this.adminSettings.general,
        ...(updates.general || {})
      },
      materials: {
        ...this.adminSettings.materials,
        ...(updates.materials || {})
      },
      users: {
        ...this.adminSettings.users,
        ...(updates.users || {})
      },
      notifications: {
        ...this.adminSettings.notifications,
        ...(updates.notifications || {})
      },
      security: {
        ...this.adminSettings.security,
        ...(updates.security || {})
      }
    };
    this.saveAdminSettings();
    this.notify();
    return this.getAdminSettings();
  }

  public resetAdminSettings(): AdminSettings {
    this.adminSettings = JSON.parse(JSON.stringify(DEFAULT_ADMIN_SETTINGS));
    this.saveAdminSettings();
    this.notify();
    return this.getAdminSettings();
  }

  // --- Audit Logs ---

  public addAuditLog(action: string, performedBy: string, entity: string, entityId?: string, details?: string): void {
    const log: AuditLogItem = {
      id: 'log-' + Date.now(),
      action,
      performedBy,
      performedById: this.currentUser.id || undefined,
      entity,
      entityId,
      timestamp: new Date().toISOString(),
      details
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 50) this.auditLogs.pop();
    this.saveAudit();
  }

  public getAuditLogs(): AuditLogItem[] {
    return [...this.auditLogs];
  }

  // --- System Summary Stats ---

  public getSystemStats() {
    const approved = this.getApprovedMaterials();
    const pending = this.getPendingMaterials();
    return {
      totalMaterials: this.materials.length,
      approvedMaterials: approved.length,
      pendingApprovals: pending.length,
      facultiesCount: catalogue.length,
      departmentsCount: catalogue.reduce((acc, f) => acc + f.departments.length, 0),
      studentsCount: this.userStats.studentsCount,
      verifiedStudents: this.userStats.verifiedStudents,
      totalDownloads: this.materials.reduce((acc, m) => acc + m.downloads, 0),
      totalViews: this.materials.reduce((acc, m) => acc + m.views, 0)
    };
  }

  // --- Reactive Subscriptions & Persistence ---

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        // Ignore subscriber listener errors
      }
    });
  }

  private saveMaterials(): void {
    try {
      localStorage.setItem('fuw_materials_v2', JSON.stringify(this.materials));
    } catch {}
  }

  private saveBookmarks(): void {
    try {
      localStorage.setItem('fuw_bookmarks_v2', JSON.stringify(this.bookmarks));
    } catch {}
  }

  private saveDownloads(): void {
    try {
      localStorage.setItem('fuw_downloads_v2', JSON.stringify(this.downloadHistory));
    } catch {}
  }

  private saveRecent(): void {
    try {
      localStorage.setItem('fuw_recent_v2', JSON.stringify(this.recentViews));
    } catch {}
  }

  private saveReading(): void {
    try {
      localStorage.setItem('fuw_reading_v2', JSON.stringify(this.readingHistory));
    } catch {}
  }

  private saveUser(): void {
    try {
      localStorage.setItem('fuw_user_profile_v2', JSON.stringify(this.currentUser));
    } catch {}
  }

  private saveStudentSettings(): void {
    try {
      localStorage.setItem('fuw_student_settings_v2', JSON.stringify(this.studentSettings));
    } catch {}
  }

  private saveAdminSettings(): void {
    try {
      localStorage.setItem('fuw_admin_settings_v2', JSON.stringify(this.adminSettings));
    } catch {}
  }

  private saveAudit(): void {
    try {
      localStorage.setItem('fuw_audit_logs_v2', JSON.stringify(this.auditLogs));
    } catch {}
  }

  private loadFromStorage(): void {
    // Purge any legacy cached mock records from previous versions
    const legacyKeys = [
      'fuw_materials',
      'fuw_bookmarks',
      'fuw_downloads',
      'fuw_recent',
      'fuw_reading',
      'fuw_user_profile',
      'fuw_student_settings',
      'fuw_admin_settings',
      'fuw_audit_logs'
    ];
    legacyKeys.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });

    try {
      const mats = localStorage.getItem('fuw_materials_v2');
      if (mats) {
        this.materials = JSON.parse(mats);
      } else {
        this.materials = [...INITIAL_MATERIALS];
      }
      const bmarks = localStorage.getItem('fuw_bookmarks_v2');
      if (bmarks) this.bookmarks = JSON.parse(bmarks);
      const dls = localStorage.getItem('fuw_downloads_v2');
      if (dls) this.downloadHistory = JSON.parse(dls);
      const recs = localStorage.getItem('fuw_recent_v2');
      if (recs) this.recentViews = JSON.parse(recs);
      const reads = localStorage.getItem('fuw_reading_v2');
      if (reads) this.readingHistory = JSON.parse(reads);
      const u = localStorage.getItem('fuw_user_profile_v2');
      if (u) {
        this.currentUser = JSON.parse(u);
      } else {
        this.currentUser = GUEST_USER;
      }
      const sSets = localStorage.getItem('fuw_student_settings_v2');
      if (sSets) this.studentSettings = JSON.parse(sSets);
      const aSets = localStorage.getItem('fuw_admin_settings_v2');
      if (aSets) this.adminSettings = JSON.parse(aSets);
      const aLogs = localStorage.getItem('fuw_audit_logs_v2');
      if (aLogs) this.auditLogs = JSON.parse(aLogs);
      this.isStudentAuthenticated = localStorage.getItem('fuw_student_session') === 'true';
      // Admin status is NEVER rehydrated from a session flag; it is derived
      // from the DB profile by AuthContext after authentication resolves.
      this.isAdminAuthenticated = false;
      if (!this.isStudentAuthenticated && !this.isAdminAuthenticated && !u) {
        this.currentUser = GUEST_USER;
      }
    } catch {
      this.materials = [...INITIAL_MATERIALS];
      this.currentUser = GUEST_USER;
    }
  }
}

export const store = new MaterialsStore();
