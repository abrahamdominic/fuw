import { catalogue, materialTypes } from '../data/catalogue';
import { supabase } from './supabase';

export interface MaterialItem {
  id: string;
  title: string;
  course: string;
  courseTitle?: string;
  faculty: string;
  department: string;
  type: string;
  level: string;
  semester: string;
  session: string;
  date: string;
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
  role: 'STUDENT' | 'ADMIN' | 'LIBRARIAN';
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

const INITIAL_MATERIALS: MaterialItem[] = [
  {
    id: 'mat-1',
    title: 'Principles of Microeconomics',
    course: 'ECN 201',
    courseTitle: 'Principles of Microeconomics',
    faculty: 'Faculty of Social Sciences',
    department: 'Economics',
    type: 'Lecture Note',
    level: '200 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'May 12, 2026',
    downloads: 1248,
    views: 3412,
    tone: 'orange',
    status: 'approved',
    uploadedBy: {
      id: 'admin-1',
      name: 'Dr. K. Danladi (HOD Economics)',
      role: 'admin'
    },
    fileUrl: '/docs/ECN201_Microeconomics.pdf',
    fileName: 'ECN201_Principles_of_Microeconomics_Full_Notes.pdf',
    fileSize: '3.4 MB',
    description: 'Comprehensive lecture modules on consumer choice, demand elasticity, production theory, perfect competition, and monopoly dynamics in the Nigerian economic context.'
  },
  {
    id: 'mat-2',
    title: 'Introduction to Programming & Algorithms',
    course: 'CSC 201',
    courseTitle: 'Introduction to Programming',
    faculty: 'Faculty of Computing & Information System',
    department: 'Computer Science',
    type: 'Textbook',
    level: '200 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'May 09, 2026',
    downloads: 982,
    views: 2890,
    tone: 'blue',
    status: 'approved',
    uploadedBy: {
      id: 'admin-1',
      name: 'Prof. E. Ibrahim',
      role: 'admin'
    },
    fileUrl: '/docs/CSC201_Programming.pdf',
    fileName: 'CSC201_Algorithm_and_Python_Foundations.pdf',
    fileSize: '4.8 MB',
    description: 'Core concepts of algorithmic problem solving, structured programming, control flow, memory allocation, and data manipulation in modern software design.'
  },
  {
    id: 'mat-3',
    title: 'Organic Chemistry Past Questions & Solutions (2020-2025)',
    course: 'CHM 302',
    courseTitle: 'Organic Chemistry II',
    faculty: 'Faculty of Physical Sciences',
    department: 'Chemistry',
    type: 'Exam Past Questions',
    level: '300 Level',
    semester: 'Second Semester',
    session: '2025/2026',
    date: 'May 02, 2026',
    downloads: 867,
    views: 2150,
    tone: 'purple',
    status: 'approved',
    uploadedBy: {
      id: 'admin-1',
      name: 'Department of Chemistry',
      role: 'admin'
    },
    fileUrl: '/docs/CHM302_PastQuestions.pdf',
    fileName: 'CHM302_Organic_Chemistry_Past_Questions_Solved.pdf',
    fileSize: '2.1 MB',
    description: 'Past semester examination questions covering reaction mechanisms, stereochemistry, electrophilic aromatic substitution, and spectroscopy with detailed step-by-step solutions.'
  },
  {
    id: 'mat-4',
    title: 'General Biology & Cell Physiology',
    course: 'BIO 201',
    courseTitle: 'General Biology',
    faculty: 'Faculty of Bio-Sciences',
    department: 'Biology/Biological Sciences',
    type: 'Handouts',
    level: '200 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'Apr 28, 2026',
    downloads: 745,
    views: 1980,
    tone: 'green',
    status: 'approved',
    uploadedBy: {
      id: 'admin-2',
      name: 'FUW Library Repository',
      role: 'admin'
    },
    fileUrl: '/docs/BIO201_Cell_Physiology.pdf',
    fileName: 'BIO201_Cell_Structure_and_Genetics.pdf',
    fileSize: '5.2 MB',
    description: 'Fundamental biological principles, ultrastructure of plant and animal cells, cellular respiration, enzyme kinetics, and Mendelian inheritance.'
  },
  {
    id: 'mat-5',
    title: 'Engineering Mathematics III & Differential Equations',
    course: 'ENG 201',
    courseTitle: 'Engineering Mathematics',
    faculty: 'Faculty of Engineering',
    department: 'Mechanical Engineering',
    type: 'Lecture Note',
    level: '200 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'Apr 20, 2026',
    downloads: 1120,
    views: 3105,
    tone: 'teal',
    status: 'approved',
    uploadedBy: {
      id: 'admin-1',
      name: 'Faculty of Engineering',
      role: 'admin'
    },
    fileUrl: '/docs/ENG201_Maths.pdf',
    fileName: 'ENG201_Engineering_Mathematics_Modules.pdf',
    fileSize: '3.9 MB',
    description: 'Differential equations, Laplace transforms, Fourier series, and vector calculus applications for engineering undergraduates at Federal University Wukari.'
  },
  {
    id: 'mat-6',
    title: 'Constitutional Law of Nigeria: Cases & Materials',
    course: 'LAW 201',
    courseTitle: 'Constitutional Law',
    faculty: 'Faculty of Law',
    department: 'Public & International Law',
    type: 'Textbook',
    level: '200 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'Apr 14, 2026',
    downloads: 654,
    views: 1840,
    tone: 'orange',
    status: 'approved',
    uploadedBy: {
      id: 'admin-2',
      name: 'Faculty of Law Library',
      role: 'admin'
    },
    fileUrl: '/docs/LAW201_Constitutional_Law.pdf',
    fileName: 'LAW201_Constitutional_Law_Compendium.pdf',
    fileSize: '6.7 MB',
    description: 'Detailed analysis of the 1999 Constitution of the Federal Republic of Nigeria, separation of powers, fundamental human rights, judicial review, and landmark Supreme Court decisions.'
  },
  {
    id: 'mat-7',
    title: 'Clinical Anatomy & Neuroanatomy Atlas',
    course: 'ANA 201',
    courseTitle: 'Human Anatomy',
    faculty: 'College of Health Sciences',
    department: 'Human Anatomy',
    type: 'Lecture Note',
    level: '200 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'Apr 08, 2026',
    downloads: 890,
    views: 2420,
    tone: 'purple',
    status: 'approved',
    uploadedBy: {
      id: 'admin-1',
      name: 'College of Health Sciences',
      role: 'admin'
    },
    fileUrl: '/docs/ANA201_Human_Anatomy.pdf',
    fileName: 'ANA201_Gross_Anatomy_and_Histology.pdf',
    fileSize: '8.4 MB',
    description: 'Comprehensive gross anatomy of the thorax, abdomen, pelvis, limbs, and central nervous system with clinical correlates for medical and allied health students.'
  },
  {
    id: 'mat-student-1',
    title: 'Data Structures and Algorithms Study Guide & Lab Solutions',
    course: 'CSC 301',
    courseTitle: 'Data Structures',
    faculty: 'Faculty of Computing & Information System',
    department: 'Computer Science',
    type: 'Handouts',
    level: '300 Level',
    semester: 'First Semester',
    session: '2025/2026',
    date: 'May 18, 2026',
    downloads: 0,
    views: 12,
    tone: 'blue',
    status: 'pending',
    uploadedBy: {
      id: 'student-1',
      name: 'Aisha Bello',
      role: 'student',
      matricNumber: 'FUW/2022/CSC/0142'
    },
    fileUrl: '/docs/CSC301_DataStructures_Guide.pdf',
    fileName: 'CSC301_Trees_Graphs_and_Sorting_Algorithms.pdf',
    fileSize: '2.8 MB',
    description: 'Comprehensive student review notes with visual binary tree diagrams, Dijkstra shortest path implementations, and hash table collision resolution techniques.'
  },
  {
    id: 'mat-student-2',
    title: 'Agricultural Economics Farm Management Project Report',
    course: 'AGR 402',
    courseTitle: 'Agricultural Economics',
    faculty: 'Faculty of Agriculture & Life Sciences',
    department: 'Agricultural Economics & Extension',
    type: 'Projects',
    level: '400 Level',
    semester: 'Second Semester',
    session: '2025/2026',
    date: 'May 16, 2026',
    downloads: 0,
    views: 6,
    tone: 'green',
    status: 'pending',
    uploadedBy: {
      id: 'student-2',
      name: 'Emmanuel Tarfa',
      role: 'student',
      matricNumber: 'FUW/2021/AGR/0088'
    },
    fileUrl: '/docs/AGR402_Farm_Management.pdf',
    fileName: 'AGR402_Taraba_Rice_Farming_Economic_Analysis.pdf',
    fileSize: '3.1 MB',
    description: 'Empirical research report on farm budgeting, input-output efficiency, and credit access for smallholder rice farmers in southern Taraba State.'
  }
];

const DEFAULT_USER: UserProfile = {
  id: 'student-1',
  fullName: 'Aisha Bello',
  displayName: 'Aisha',
  email: 'aisha.bello@fuw.edu.ng',
  matricNumber: 'FUW/2022/CSC/0142',
  role: 'STUDENT',
  faculty: 'Faculty of Computing & Information System',
  department: 'Computer Science',
  level: '300 Level',
  bio: 'Passionate 300 Level Computer Science student focusing on software engineering and algorithms. Active member of FUW Tech Club.',
  avatarUrl: '',
  isVerified: true,
  verificationStatus: 'VERIFIED',
  joinedDate: 'November 2022'
};

const DEFAULT_ADMIN: UserProfile = {
  id: 'admin-1',
  fullName: 'Dr. Yakubu G. Audu',
  displayName: 'Dr. Yakubu (Admin)',
  email: 'admin.library@fuw.edu.ng',
  matricNumber: 'ADMIN/LIB/001',
  role: 'ADMIN',
  faculty: 'Faculty of Computing & Information System',
  department: 'Computer Science',
  level: 'Faculty Staff',
  bio: 'Chief Librarian and Academic Repository Director at Federal University Wukari.',
  avatarUrl: '',
  isVerified: true,
  verificationStatus: 'VERIFIED',
  joinedDate: 'October 2018'
};

const INITIAL_AUDIT_LOGS: AuditLogItem[] = [
  {
    id: 'log-1',
    action: 'MATERIAL_PUBLISHED',
    performedBy: 'Dr. Yakubu G. Audu (Admin)',
    entity: 'Principles of Microeconomics (ECN 201)',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    details: 'Admin direct publication'
  },
  {
    id: 'log-2',
    action: 'STUDENT_MATERIAL_SUBMISSION',
    performedBy: 'Aisha Bello (FUW/2022/CSC/0142)',
    entity: 'Data Structures and Algorithms Study Guide',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    details: 'Submitted for administrator approval'
  },
  {
    id: 'log-3',
    action: 'USER_VERIFIED',
    performedBy: 'System Verification Desk',
    entity: 'Aisha Bello (FUW/2022/CSC/0142)',
    timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
    details: 'Student ID card matched university matriculation records'
  }
];

class MaterialsStore {
  private materials: MaterialItem[] = [];
  private currentUser: UserProfile = DEFAULT_USER;
  private isStudentAuthenticated: boolean = false;
  private isAdminAuthenticated: boolean = false;
  private bookmarks: string[] = ['mat-1', 'mat-2'];
  private downloadHistory: DownloadRecord[] = [
    {
      id: 'dl-1',
      materialId: 'mat-1',
      materialTitle: 'Principles of Microeconomics',
      course: 'ECN 201',
      fileSize: '3.4 MB',
      downloadedAt: 'Yesterday, 4:15 PM'
    },
    {
      id: 'dl-2',
      materialId: 'mat-2',
      materialTitle: 'Introduction to Programming & Algorithms',
      course: 'CSC 201',
      fileSize: '4.8 MB',
      downloadedAt: '3 days ago'
    }
  ];
  private recentViews: RecentViewRecord[] = [
    { id: 'view-1', materialId: 'mat-1', viewedAt: 'Today, 10:20 AM' },
    { id: 'view-2', materialId: 'mat-2', viewedAt: 'Yesterday, 3:45 PM' },
    { id: 'view-3', materialId: 'mat-3', viewedAt: 'May 14, 2026' }
  ];
  private readingHistory: ReadingProgressRecord[] = [
    {
      id: 'read-1',
      materialId: 'mat-1',
      materialTitle: 'Principles of Microeconomics',
      course: 'ECN 201',
      currentPage: 24,
      totalPages: 68,
      percentage: 35,
      lastReadAt: 'Today, 10:45 AM'
    },
    {
      id: 'read-2',
      materialId: 'mat-2',
      materialTitle: 'Introduction to Programming & Algorithms',
      course: 'CSC 201',
      currentPage: 52,
      totalPages: 110,
      percentage: 47,
      lastReadAt: 'Yesterday, 4:00 PM'
    }
  ];
  private auditLogs: AuditLogItem[] = INITIAL_AUDIT_LOGS;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const storedMaterials = localStorage.getItem('fuw_materials');
      if (storedMaterials) {
        this.materials = JSON.parse(storedMaterials);
      } else {
        this.materials = [...INITIAL_MATERIALS];
        this.saveMaterials();
      }

      const storedUser = localStorage.getItem('fuw_current_user');
      if (storedUser) {
        this.currentUser = JSON.parse(storedUser);
      }

      const studentSession = localStorage.getItem('fuw_student_session');
      this.isStudentAuthenticated = studentSession === 'true';

      const adminSession = sessionStorage.getItem('fuw-admin');
      this.isAdminAuthenticated = adminSession === 'true';

      const storedBookmarks = localStorage.getItem('fuw_bookmarks');
      if (storedBookmarks) {
        this.bookmarks = JSON.parse(storedBookmarks);
      }

      const storedDownloads = localStorage.getItem('fuw_downloads');
      if (storedDownloads) {
        this.downloadHistory = JSON.parse(storedDownloads);
      }

      const storedRecent = localStorage.getItem('fuw_recent_views');
      if (storedRecent) {
        this.recentViews = JSON.parse(storedRecent);
      }

      const storedReading = localStorage.getItem('fuw_reading_history');
      if (storedReading) {
        this.readingHistory = JSON.parse(storedReading);
      }

      const storedAudit = localStorage.getItem('fuw_audit_logs');
      if (storedAudit) {
        this.auditLogs = JSON.parse(storedAudit);
      }
    } catch {
      this.materials = [...INITIAL_MATERIALS];
    }
  }

  private saveMaterials() {
    try {
      localStorage.setItem('fuw_materials', JSON.stringify(this.materials));
    } catch {}
  }

  private saveBookmarks() {
    try {
      localStorage.setItem('fuw_bookmarks', JSON.stringify(this.bookmarks));
    } catch {}
  }

  private saveDownloads() {
    try {
      localStorage.setItem('fuw_downloads', JSON.stringify(this.downloadHistory));
    } catch {}
  }

  private saveRecent() {
    try {
      localStorage.setItem('fuw_recent_views', JSON.stringify(this.recentViews));
    } catch {}
  }

  private saveReading() {
    try {
      localStorage.setItem('fuw_reading_history', JSON.stringify(this.readingHistory));
    } catch {}
  }

  private saveUser() {
    try {
      localStorage.setItem('fuw_current_user', JSON.stringify(this.currentUser));
    } catch {}
  }

  private saveAudit() {
    try {
      localStorage.setItem('fuw_audit_logs', JSON.stringify(this.auditLogs));
    } catch {}
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // --- Auth Guards & Login / Logout Methods ---

  public isLoggedInStudent(): boolean {
    return this.isStudentAuthenticated;
  }

  public isLoggedInAdmin(): boolean {
    return this.isAdminAuthenticated || sessionStorage.getItem('fuw-admin') === 'true';
  }

  public loginStudent(emailOrMatric: string, customName?: string): UserProfile {
    this.isStudentAuthenticated = true;
    localStorage.setItem('fuw_student_session', 'true');
    this.currentUser = {
      ...DEFAULT_USER,
      matricNumber: emailOrMatric.includes('/') ? emailOrMatric : DEFAULT_USER.matricNumber,
      email: emailOrMatric.includes('@') ? emailOrMatric : DEFAULT_USER.email,
      fullName: customName || DEFAULT_USER.fullName,
      displayName: customName?.split(' ')[0] || DEFAULT_USER.displayName,
      role: 'STUDENT'
    };
    this.saveUser();
    this.notify();
    return this.currentUser;
  }

  public loginAdmin(email: string = 'admin.library@fuw.edu.ng'): UserProfile {
    this.isAdminAuthenticated = true;
    sessionStorage.setItem('fuw-admin', 'true');
    this.currentUser = {
      ...DEFAULT_ADMIN,
      email,
      role: 'ADMIN'
    };
    this.saveUser();
    this.notify();
    return this.currentUser;
  }

  public logoutStudent(): void {
    this.isStudentAuthenticated = false;
    localStorage.removeItem('fuw_student_session');
    this.notify();
  }

  public logoutAdmin(): void {
    this.isAdminAuthenticated = false;
    sessionStorage.removeItem('fuw-admin');
    this.notify();
  }

  // --- Material Accessors ---

  public getApprovedMaterials(): MaterialItem[] {
    return this.materials.filter((m) => m.status === 'approved');
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
        file_url: newMaterial.fileUrl,
        file_name: newMaterial.fileName,
        status: 'approved'
      }).then(() => {}).catch(() => {});
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
        file_url: newMaterial.fileUrl,
        file_name: newMaterial.fileName,
        status: 'pending'
      }).then(() => {}).catch(() => {});
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
      supabase.from('materials').update({ status: 'approved', rejection_reason: null }).eq('id', materialId).then(() => {}).catch(() => {});
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
      supabase.from('materials').update({ status: 'rejected', rejection_reason: material.rejectionReason }).eq('id', materialId).then(() => {}).catch(() => {});
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
      supabase.from('materials').update(updates).eq('id', materialId).then(() => {}).catch(() => {});
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
      supabase.from('materials').delete().eq('id', materialId).then(() => {}).catch(() => {});
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
    return !exists;
  }

  public getSavedMaterials(): MaterialItem[] {
    return this.materials.filter((m) => this.bookmarks.includes(m.id));
  }

  public recordDownload(materialId: string): void {
    const material = this.materials.find((m) => m.id === materialId);
    if (material) {
      material.downloads += 1;
      this.saveMaterials();

      const existingIndex = this.downloadHistory.findIndex((d) => d.materialId === materialId);
      const record: DownloadRecord = {
        id: 'dl-' + Date.now(),
        materialId,
        materialTitle: material.title,
        course: material.course,
        fileSize: material.fileSize,
        downloadedAt: 'Just now'
      };

      if (existingIndex !== -1) {
        this.downloadHistory.splice(existingIndex, 1);
      }
      this.downloadHistory.unshift(record);
      this.saveDownloads();

      this.notify();
    }
  }

  public getDownloadHistory(): DownloadRecord[] {
    return [...this.downloadHistory];
  }

  public recordView(materialId: string): void {
    const material = this.materials.find((m) => m.id === materialId);
    if (material) {
      material.views += 1;
      this.saveMaterials();

      const existingIndex = this.recentViews.findIndex((r) => r.materialId === materialId);
      const record: RecentViewRecord = {
        id: 'view-' + Date.now(),
        materialId,
        viewedAt: 'Just now'
      };

      if (existingIndex !== -1) {
        this.recentViews.splice(existingIndex, 1);
      }
      this.recentViews.unshift(record);
      if (this.recentViews.length > 20) this.recentViews.pop();
      this.saveRecent();

      this.notify();
    }
  }

  public getRecentMaterials(): MaterialItem[] {
    const ids = this.recentViews.map((r) => r.materialId);
    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds
      .map((id) => this.materials.find((m) => m.id === id))
      .filter((m): m is MaterialItem => m !== undefined);
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
      supabase.from('profiles').update(data).eq('id', this.currentUser.id).then(() => {}).catch(() => {});
    }

    this.notify();
    return this.currentUser;
  }

  // --- Audit Logs ---

  public addAuditLog(action: string, performedBy: string, entity: string, entityId?: string, details?: string): void {
    const log: AuditLogItem = {
      id: 'log-' + Date.now(),
      action,
      performedBy,
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
      studentsCount: 8240,
      verifiedStudents: 7890,
      totalDownloads: this.materials.reduce((acc, m) => acc + m.downloads, 0),
      totalViews: this.materials.reduce((acc, m) => acc + m.views, 0)
    };
  }
}

export const store = new MaterialsStore();
