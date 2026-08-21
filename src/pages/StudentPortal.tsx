import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, Routes, Route } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Heart,
  Clock,
  Download,
  BookOpen,
  Users,
  Settings,
  LogOut,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Eye,
  ArrowRight,
  Sparkles,
  Menu,
  X,
  ShieldCheck,
  UserCheck,
  Lock,
  Bell,
  Key,
  Shield,
  Smartphone,
  Laptop,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Save,
  Info,
  Check
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem } from '../lib/store';
import { Logo } from '../components/Logo';
import { MaterialCard } from '../components/MaterialCard';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { useToast } from '../components/Toast';

interface StudentPortalProps {
  onReadOnline: (material: MaterialItem) => void;
}

const studentNavItems = [
  { label: 'Dashboard', path: '/student', icon: LayoutDashboard, exact: true },
  { label: 'Upload material', path: '/student/upload', icon: Upload },
  { label: 'My uploads', path: '/student/uploads', icon: FileText },
  { label: 'Saved materials', path: '/student/saved', icon: Heart },
  { label: 'Recently viewed', path: '/student/recent', icon: Clock },
  { label: 'Downloads', path: '/student/downloads', icon: Download },
  { label: 'Reading history', path: '/student/reading', icon: BookOpen },
  { label: 'My profile', path: '/student/profile', icon: Users },
  { label: 'Settings', path: '/student/settings', icon: Settings }
];

export function StudentPortal({ onReadOnline }: StudentPortalProps) {
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentUser = store.getCurrentUser();
  const approvedMaterials = store.getApprovedMaterials();
  const studentUploads = store.getStudentUploads(currentUser.id);
  const savedMaterials = store.getSavedMaterials();
  const recentMaterials = store.getRecentMaterials();
  const downloadHistory = store.getDownloadHistory();
  const readingHistory = store.getReadingHistory();

  // Determine current active subpage
  const currentPath = location.pathname;

  return (
    <div className="portal">
      {/* Sidebar Navigation */}
      <aside className={`side ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="side-header">
          <Link className="brand" to="/" onClick={() => setMobileMenuOpen(false)}>
            <Logo size={32} />
            <b>FUW</b> E-Library
          </Link>
          <button
            className="side-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="side-user-card">
          <div className="user-avatar-circle">
            {currentUser.fullName.charAt(0)}
          </div>
          <div className="user-info-text">
            <b>{currentUser.displayName || currentUser.fullName}</b>
            <span>{currentUser.matricNumber}</span>
          </div>
        </div>

        <p className="side-nav-heading">STUDENT PORTAL</p>

        <nav className="side-nav-list">
          {studentNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? currentPath === item.path || currentPath === item.path + '/'
              : currentPath.startsWith(item.path);

            return (
              <NavLink
                key={item.label}
                to={item.path}
                className={`side-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.label === 'My uploads' && studentUploads.length > 0 && (
                  <span className="side-badge">{studentUploads.length}</span>
                )}
                {item.label === 'Saved materials' && savedMaterials.length > 0 && (
                  <span className="side-badge">{savedMaterials.length}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="side-footer-actions">
          <Link to="/" className="side-link logout-link">
            <LogOut size={17} />
            <span>Exit to Public Library</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <main className="portal-main">
        {/* Mobile Portal Top Bar */}
        <div className="portal-mobile-bar">
          <button
            className="portal-mobile-toggle"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open student navigation"
          >
            <Menu size={22} />
            <span>Menu</span>
          </button>
          <span className="portal-mobile-title">Student Dashboard</span>
          <Link to="/student/upload" className="portal-mobile-upload">
            <Upload size={16} />
          </Link>
        </div>

        {/* Dynamic Subpages based on Path */}
        {currentPath === '/student' || currentPath === '/student/' ? (
          <StudentOverviewTab
            currentUser={currentUser}
            savedCount={savedMaterials.length}
            recentCount={recentMaterials.length}
            downloadsCount={downloadHistory.length}
            readingCount={readingHistory.length}
            uploadsCount={studentUploads.length}
            recentMaterials={recentMaterials.slice(0, 4)}
            approvedMaterials={approvedMaterials.slice(0, 4)}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/student/upload') ? (
          <StudentUploadTab onUploaded={() => navigate('/student/uploads')} />
        ) : currentPath.startsWith('/student/uploads') ? (
          <StudentMyUploadsTab
            uploads={studentUploads}
            onDelete={(id) => {
              store.deleteMaterial(id, currentUser.fullName);
              toast('Material removed from uploads.', 'info');
            }}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/student/saved') ? (
          <StudentSavedTab
            savedMaterials={savedMaterials}
            onReadOnline={onReadOnline}
            onRemove={(id) => {
              store.toggleBookmark(id);
              toast('Removed from saved materials.', 'info');
            }}
          />
        ) : currentPath.startsWith('/student/recent') ? (
          <StudentRecentTab
            recentMaterials={recentMaterials}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/student/downloads') ? (
          <StudentDownloadsTab downloadHistory={downloadHistory} />
        ) : currentPath.startsWith('/student/reading') ? (
          <StudentReadingTab
            readingHistory={readingHistory}
            onReadOnline={onReadOnline}
          />
        ) : currentPath.startsWith('/student/profile') ? (
          <StudentProfileTab currentUser={currentUser} />
        ) : currentPath.startsWith('/student/settings') ? (
          <StudentSettingsTab currentUser={currentUser} />
        ) : (
          <StudentOverviewTab
            currentUser={currentUser}
            savedCount={savedMaterials.length}
            recentCount={recentMaterials.length}
            downloadsCount={downloadHistory.length}
            readingCount={readingHistory.length}
            uploadsCount={studentUploads.length}
            recentMaterials={recentMaterials.slice(0, 4)}
            approvedMaterials={approvedMaterials.slice(0, 4)}
            onReadOnline={onReadOnline}
          />
        )}
      </main>
    </div>
  );
}

// 1. Dashboard Overview Tab
function StudentOverviewTab({
  currentUser,
  savedCount,
  recentCount,
  downloadsCount,
  readingCount,
  uploadsCount,
  recentMaterials,
  approvedMaterials,
  onReadOnline
}: any) {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">WELCOME BACK, {currentUser.displayName?.toUpperCase() || currentUser.fullName?.toUpperCase()}</p>
          <h1>Good morning, {currentUser.displayName || currentUser.fullName}</h1>
          <p className="subtitle">
            {currentUser.department} · {currentUser.level} · Matric: {currentUser.matricNumber}
          </p>
        </div>
        <div className="portal-top-actions">
          <Link className="primary" to="/library">
            <Search size={16} />
            <span>Search Library</span>
          </Link>
          <Link className="secondary-btn" to="/student/upload">
            <Upload size={16} />
            <span>Submit Material</span>
          </Link>
        </div>
      </div>

      {/* Metrics Stats Grid */}
      <div className="portal-stats">
        <section>
          <Heart />
          <b>{savedCount}</b>
          <span>Saved materials</span>
        </section>
        <section>
          <Clock />
          <b>{recentCount}</b>
          <span>Recently viewed</span>
        </section>
        <section>
          <Download />
          <b>{downloadsCount}</b>
          <span>Downloads</span>
        </section>
        <section>
          <BookOpen />
          <b>{readingCount}</b>
          <span>Reading history</span>
        </section>
      </div>

      {/* Status Notice if student has uploads */}
      {uploadsCount > 0 && (
        <div className="portal-notice-card">
          <div className="notice-icon">
            <Sparkles size={20} />
          </div>
          <div className="notice-content">
            <h4>You have submitted {uploadsCount} material{uploadsCount > 1 ? 's' : ''} for faculty review</h4>
            <p>Admin librarians review submissions before publication to ensure curriculum quality.</p>
          </div>
          <Link to="/student/uploads" className="notice-action-link">
            View Upload Status →
          </Link>
        </div>
      )}

      {/* Recently Accessed Section */}
      <div className="section-head">
        <div>
          <p className="kicker">CONTINUE STUDYING</p>
          <h2>Recommended & recent resources</h2>
        </div>
        <Link to="/library">
          Explore all <ChevronRight size={16} />
        </Link>
      </div>

      <div className="grid materials">
        {(recentMaterials.length > 0 ? recentMaterials : approvedMaterials).map((m: MaterialItem) => (
          <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} />
        ))}
      </div>
    </div>
  );
}

// 2. Student Upload Tab
function StudentUploadTab({ onUploaded }: { onUploaded: () => void }) {
  const store = useStore();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    faculty: 'Faculty of Computing & Information System',
    department: 'Computer Science',
    course: 'CSC 201',
    level: '200 Level',
    semester: 'First Semester',
    type: 'Lecture Note'
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setMessage({ type: 'error', text: 'Please choose an academic document file to upload.' });
      return;
    }

    const form = new FormData(e.currentTarget);
    const title = String(form.get('title') || '').trim();
    const description = String(form.get('description') || '').trim();

    if (!title || !description) {
      setMessage({ type: 'error', text: 'Title and description are required.' });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      store.submitMaterialStudent({
        title,
        description,
        faculty: filters.faculty || 'Faculty of Computing & Information System',
        department: filters.department || 'Computer Science',
        course_code: filters.course || 'GEN 101',
        course_title: filters.course || title,
        level: filters.level || '200 Level',
        semester: filters.semester || 'First Semester',
        material_type: filters.type || 'Lecture Note',
        file
      });

      toast('Material submitted successfully! Awaiting administrator approval.', 'success');
      setMessage({
        type: 'success',
        text: 'Your material was uploaded and submitted for review. It will appear on the public library once approved by an administrator.'
      });

      setTimeout(() => {
        onUploaded();
      }, 1200);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Unable to upload material. Please check file format and size.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STUDENT REPOSITORY SUBMISSION</p>
          <h1>Upload material for approval</h1>
          <p className="subtitle">
            Share verified course notes, handouts, or past questions. All student submissions are vetted by library administrators before being published.
          </p>
        </div>
      </div>

      <div className="upload-container">
        <form className="upload-form full-upload-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <h3>1. Resource Details</h3>
            <label>
              Material Title *
              <input
                name="title"
                required
                placeholder="e.g. Introduction to Data Structures & Binary Trees Lecture Modules"
              />
            </label>

            <label>
              Academic Description *
              <textarea
                name="description"
                required
                placeholder="Detail what topics, chapters, or syllabus questions this material covers..."
              />
            </label>
          </div>

          <div className="form-section">
            <h3>2. Academic Categorization</h3>
            <CatalogueFilters filters={filters} onChange={setFilters} compact />
          </div>

          <div className="form-section">
            <h3>3. File Upload</h3>
            <div className="drop file-dropzone">
              <Upload size={32} />
              <b>{file ? file.name : 'Drag & drop your course document here, or browse'}</b>
              <span>Supported: PDF, Word (DOC/DOCX), PowerPoint (PPT/PPTX), Excel (XLS/XLSX) — Max 25 MB</span>
              {file && (
                <div className="file-ready-tag">
                  <CheckCircle2 size={14} /> Ready for upload ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
              )}
              <input
                type="file"
                required
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          {message && (
            <div className={`form-feedback-box ${message.type}`}>
              {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <p>{message.text}</p>
            </div>
          )}

          <div className="form-submit-row">
            <button className="primary submit-btn" disabled={busy}>
              <Upload size={16} />
              {busy ? 'Submitting for review…' : 'Submit for Admin Approval'}
            </button>
            <span className="submit-hint">Approval status will be tracked under "My Uploads".</span>
          </div>
        </form>
      </div>
    </div>
  );
}

// 3. Student My Uploads Tab (With Approval Statuses)
function StudentMyUploadsTab({
  uploads,
  onDelete,
  onReadOnline
}: {
  uploads: MaterialItem[];
  onDelete: (id: string) => void;
  onReadOnline: (m: MaterialItem) => void;
}) {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">SUBMISSION TRACKER</p>
          <h1>My uploaded materials</h1>
          <p className="subtitle">
            Track approval status and feedback for your contributed academic materials.
          </p>
        </div>
        <Link className="primary" to="/student/upload">
          <Plus size={16} />
          <span>Upload new material</span>
        </Link>
      </div>

      {uploads.length === 0 ? (
        <div className="empty-state card-empty">
          <FileText size={40} />
          <b>No uploaded materials yet.</b>
          <span>Upload your lecture notes, handouts, or past questions to earn academic repository contribution credits.</span>
          <Link to="/student/upload" className="primary empty-btn">
            <Upload size={15} /> Upload Your First Material
          </Link>
        </div>
      ) : (
        <div className="uploads-table-wrapper">
          <div className="table">
            <div className="tr head uploads-header-grid">
              <span>Material / Title</span>
              <span>Faculty & Dept</span>
              <span>Level / Type</span>
              <span>Submission Date</span>
              <span>Approval Status</span>
              <span>Actions</span>
            </div>

            {uploads.map((m) => (
              <div className="tr uploads-row-grid" key={m.id}>
                <span>
                  <b>{m.title}</b>
                  <small>{m.course} · {m.fileName} ({m.fileSize})</small>
                </span>
                <span>{m.department}</span>
                <span>{m.level} · {m.type}</span>
                <span>{m.date}</span>
                <span>
                  {m.status === 'approved' && (
                    <span className="status-badge approved">
                      <CheckCircle2 size={12} /> Approved & Live
                    </span>
                  )}
                  {m.status === 'pending' && (
                    <span className="status-badge pending">
                      <Clock size={12} /> Pending Approval
                    </span>
                  )}
                  {m.status === 'rejected' && (
                    <span className="status-badge rejected" title={m.rejectionReason}>
                      <AlertCircle size={12} /> Rejected
                    </span>
                  )}
                </span>
                <span className="row-action-btns">
                  <button
                    className="action-icon-btn"
                    onClick={() => onReadOnline(m)}
                    title="Preview material"
                  >
                    <Eye size={15} />
                  </button>
                  <button
                    className="action-icon-btn delete"
                    onClick={() => onDelete(m.id)}
                    title="Delete upload"
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 4. Saved Materials Tab
function StudentSavedTab({
  savedMaterials,
  onReadOnline,
  onRemove
}: {
  savedMaterials: MaterialItem[];
  onReadOnline: (m: MaterialItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">BOOKMARKED RESOURCES</p>
          <h1>Saved materials ({savedMaterials.length})</h1>
          <p className="subtitle">Quick access to books, notes, and past questions you have bookmarked for fast revision.</p>
        </div>
      </div>

      {savedMaterials.length === 0 ? (
        <div className="empty-state card-empty">
          <Heart size={40} />
          <b>No saved materials yet.</b>
          <span>Click the bookmark icon on any material in the library to save it here for offline revision.</span>
          <Link to="/library" className="primary empty-btn">
            <Search size={15} /> Browse Library Collection
          </Link>
        </div>
      ) : (
        <div className="grid materials">
          {savedMaterials.map((m) => (
            <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} />
          ))}
        </div>
      )}
    </div>
  );
}

// 5. Recently Viewed Tab
function StudentRecentTab({
  recentMaterials,
  onReadOnline
}: {
  recentMaterials: MaterialItem[];
  onReadOnline: (m: MaterialItem) => void;
}) {
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACTIVITY HISTORY</p>
          <h1>Recently viewed ({recentMaterials.length})</h1>
          <p className="subtitle">Materials and course documents you have recently explored or read.</p>
        </div>
      </div>

      {recentMaterials.length === 0 ? (
        <div className="empty-state card-empty">
          <Clock size={40} />
          <b>No recently viewed materials.</b>
          <span>Materials you open or read will automatically appear here for seamless continuity.</span>
          <Link to="/library" className="primary empty-btn">
            <Search size={15} /> Open a Library Resource
          </Link>
        </div>
      ) : (
        <div className="grid materials">
          {recentMaterials.map((m) => (
            <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} />
          ))}
        </div>
      )}
    </div>
  );
}

// 6. Downloads History Tab
function StudentDownloadsTab({ downloadHistory }: { downloadHistory: any[] }) {
  const { toast } = useToast();
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">OFFLINE FILES</p>
          <h1>My downloads ({downloadHistory.length})</h1>
          <p className="subtitle">Record of academic documents downloaded to your device.</p>
        </div>
      </div>

      {downloadHistory.length === 0 ? (
        <div className="empty-state card-empty">
          <Download size={40} />
          <b>No downloads recorded yet.</b>
          <span>Downloaded lecture notes and past question PDFs will be logged here for convenient re-downloading.</span>
        </div>
      ) : (
        <div className="table">
          <div className="tr head downloads-grid">
            <span>Material Title</span>
            <span>Course</span>
            <span>File Size</span>
            <span>Downloaded Time</span>
            <span>Action</span>
          </div>
          {downloadHistory.map((item) => (
            <div className="tr downloads-grid" key={item.id}>
              <span>
                <b>{item.materialTitle}</b>
              </span>
              <span>{item.course}</span>
              <span>{item.fileSize}</span>
              <span>{item.downloadedAt}</span>
              <span>
                <button
                  className="table-action-btn"
                  onClick={() => toast(`Re-downloading ${item.materialTitle}`)}
                >
                  <Download size={14} /> Re-download
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 7. Reading History Tab
function StudentReadingTab({
  readingHistory,
  onReadOnline
}: {
  readingHistory: any[];
  onReadOnline: (m: MaterialItem) => void;
}) {
  const store = useStore();
  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">PROGRESS TRACKER</p>
          <h1>Reading history & progress</h1>
          <p className="subtitle">Resume reading where you left off in your courses.</p>
        </div>
      </div>

      {readingHistory.length === 0 ? (
        <div className="empty-state card-empty">
          <BookOpen size={40} />
          <b>No reading sessions logged yet.</b>
          <span>Use the "Read Online" feature to read documents in your browser and automatically track your reading progress.</span>
        </div>
      ) : (
        <div className="reading-cards-list">
          {readingHistory.map((item) => {
            const material = store.getMaterialById(item.materialId);
            return (
              <div className="reading-session-card" key={item.id}>
                <div className="reading-card-info">
                  <span className="reading-course-tag">{item.course}</span>
                  <h3>{item.materialTitle}</h3>
                  <p>
                    Page {item.currentPage} of {item.totalPages} · Last accessed: {item.lastReadAt}
                  </p>
                  <div className="reading-bar-track">
                    <div className="reading-bar-fill" style={{ width: `${item.percentage}%` }} />
                  </div>
                  <span className="reading-percent-label">{item.percentage}% complete</span>
                </div>

                <div className="reading-card-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      if (material) onReadOnline(material);
                    }}
                  >
                    <BookOpen size={16} /> Resume Reading
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 8. Student Profile Tab
function StudentProfileTab({ currentUser }: { currentUser: any }) {
  const store = useStore();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    fullName: currentUser.fullName || '',
    displayName: currentUser.displayName || '',
    matricNumber: currentUser.matricNumber || '',
    email: currentUser.email || '',
    faculty: currentUser.faculty || '',
    department: currentUser.department || '',
    level: currentUser.level || '300 Level',
    bio: currentUser.bio || ''
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    store.updateUserProfile(formData);
    toast('Profile updated successfully!', 'success');
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">ACCOUNT & ACADEMIC INFO</p>
          <h1>My student profile</h1>
          <p className="subtitle">Manage your verified university registration and academic credentials.</p>
        </div>
      </div>

      <div className="profile-layout">
        <div className="profile-card">
          <div className="profile-badge-row">
            <div className="profile-large-avatar">
              {formData.fullName.charAt(0) || 'A'}
            </div>
            <div>
              <h2>{formData.fullName}</h2>
              <p className="profile-sub">{formData.department} · {formData.level}</p>
              <div className="verification-pill verified">
                <ShieldCheck size={14} />
                <span>Verified FUW Student</span>
              </div>
            </div>
          </div>

          <form className="profile-form" onSubmit={handleSave}>
            <div className="form-grid-2">
              <label>
                Full Name
                <input
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  required
                />
              </label>

              <label>
                Display Name
                <input
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  required
                />
              </label>
            </div>

            <div className="form-grid-2">
              <label>
                University Email Address
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </label>

              <label>
                Matriculation Number
                <input
                  value={formData.matricNumber}
                  onChange={(e) => setFormData({ ...formData, matricNumber: e.target.value })}
                  required
                />
              </label>
            </div>

            <div className="form-grid-2">
              <label>
                Faculty
                <input
                  value={formData.faculty}
                  onChange={(e) => setFormData({ ...formData, faculty: e.target.value })}
                />
              </label>

              <label>
                Department
                <input
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                />
              </label>
            </div>

            <label>
              Level of Study
              <select
                value={formData.level}
                onChange={(e) => setFormData({ ...formData, level: e.target.value })}
              >
                <option value="100 Level">100 Level</option>
                <option value="200 Level">200 Level</option>
                <option value="300 Level">300 Level</option>
                <option value="400 Level">400 Level</option>
                <option value="500 Level">500 Level</option>
                <option value="600 Level">600 Level</option>
              </select>
            </label>

            <label>
              Academic Bio & Research Interests
              <textarea
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder="Share your academic interests, focus areas, and tech clubs..."
              />
            </label>

            <button type="submit" className="primary save-profile-btn">
              Save Profile Changes
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// 9. Student Settings Tab
function StudentSettingsTab({ currentUser }: { currentUser: any }) {
  const store = useStore();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeSection, setActiveSection] = useState<'account' | 'security' | 'notifications' | 'reading' | 'sessions' | 'danger'>('account');
  const [settings, setSettings] = useState(store.getStudentSettings());
  const [profileData, setProfileData] = useState({
    fullName: currentUser.fullName || '',
    displayName: currentUser.displayName || '',
    email: currentUser.email || '',
    matricNumber: currentUser.matricNumber || '',
    faculty: currentUser.faculty || '',
    department: currentUser.department || '',
    level: currentUser.level || '300 Level'
  });

  const [passwordState, setPasswordState] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    store.updateUserProfile(profileData);
    toast('Account details updated successfully!', 'success');
  };

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    store.updateStudentSettings(settings);
    toast('Library & notification preferences saved!', 'success');
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordState.newPassword.length < 6) {
      toast('New password must be at least 6 characters.', 'error');
      return;
    }
    if (passwordState.newPassword !== passwordState.confirmPassword) {
      toast('New passwords do not match.', 'error');
      return;
    }
    setPasswordState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    toast('Password updated successfully! Your next login will use your new password.', 'success');
  };

  const handleSignOutOtherSessions = () => {
    toast('All other active browser sessions have been logged out.', 'info');
  };

  const handleSignOut = () => {
    store.logoutStudent();
    toast('Logged out of Student Portal', 'info');
    navigate('/login');
  };

  const handleConfirmDeactivate = () => {
    setDeactivateModalOpen(false);
    store.logoutStudent();
    toast('Account deactivation requested. Your session has ended.', 'info');
    navigate('/');
  };

  return (
    <div className="portal-view-fade">
      <div className="portal-top">
        <div>
          <p className="kicker">STUDENT PREFERENCES & SECURITY</p>
          <h1>Account settings</h1>
          <p className="subtitle">
            Manage your university account credentials, notification alerts, reading display preferences, and active sessions.
          </p>
        </div>
      </div>

      <div className="settings-layout">
        {/* Settings Navigation Sidebar */}
        <aside className="settings-sidebar">
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'account' ? 'active' : ''}`}
            onClick={() => setActiveSection('account')}
          >
            <Users size={16} />
            <span>Account Profile</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'security' ? 'active' : ''}`}
            onClick={() => setActiveSection('security')}
          >
            <Lock size={16} />
            <span>Security & Password</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveSection('notifications')}
          >
            <Bell size={16} />
            <span>Notification Alerts</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'reading' ? 'active' : ''}`}
            onClick={() => setActiveSection('reading')}
          >
            <SlidersHorizontal size={16} />
            <span>Reading & Display</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeSection === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveSection('sessions')}
          >
            <Laptop size={16} />
            <span>Active Sessions</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item danger ${activeSection === 'danger' ? 'active' : ''}`}
            onClick={() => setActiveSection('danger')}
          >
            <AlertTriangle size={16} />
            <span>Account Actions</span>
          </button>
        </aside>

        {/* Settings Content Area */}
        <div className="settings-content-panel">
          {/* 1. Account Profile */}
          {activeSection === 'account' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Account & Academic Credentials</h2>
                  <p>Keep your contact details up to date for official library notices.</p>
                </div>
              </div>

              <form onSubmit={handleSaveProfile}>
                <div className="form-grid-2">
                  <label>
                    Full Legal Name
                    <input
                      value={profileData.fullName}
                      onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Preferred Display Name
                    <input
                      value={profileData.displayName}
                      onChange={(e) => setProfileData({ ...profileData, displayName: e.target.value })}
                      required
                    />
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Institutional Email Address
                    <input
                      type="email"
                      value={profileData.email}
                      onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Matriculation Number
                    <div className="input-with-badge">
                      <input
                        value={profileData.matricNumber}
                        readOnly
                        className="input-readonly"
                        title="Matriculation numbers are permanently linked to your FUW admission record"
                      />
                      <span className="readonly-tag" title="Protected Institutional Identifier">
                        <ShieldCheck size={12} /> Verified
                      </span>
                    </div>
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    Faculty
                    <input
                      value={profileData.faculty}
                      onChange={(e) => setProfileData({ ...profileData, faculty: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Department
                    <input
                      value={profileData.department}
                      onChange={(e) => setProfileData({ ...profileData, department: e.target.value })}
                      required
                    />
                  </label>
                </div>

                <label>
                  Level of Study
                  <select
                    value={profileData.level}
                    onChange={(e) => setProfileData({ ...profileData, level: e.target.value })}
                  >
                    <option value="100 Level">100 Level (Undergraduate)</option>
                    <option value="200 Level">200 Level (Undergraduate)</option>
                    <option value="300 Level">300 Level (Undergraduate)</option>
                    <option value="400 Level">400 Level (Undergraduate)</option>
                    <option value="500 Level">500 Level (Undergraduate)</option>
                    <option value="Postgraduate">Postgraduate / Masters</option>
                  </select>
                </label>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Account Changes
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 2. Security & Password */}
          {activeSection === 'security' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Security & Password</h2>
                  <p>Protect your student portal access with a strong password.</p>
                </div>
              </div>

              <form onSubmit={handleChangePassword}>
                <label>
                  Current Password
                  <input
                    type="password"
                    placeholder="Enter current password"
                    value={passwordState.currentPassword}
                    onChange={(e) => setPasswordState({ ...passwordState, currentPassword: e.target.value })}
                    required
                  />
                </label>

                <div className="form-grid-2">
                  <label>
                    New Password
                    <input
                      type="password"
                      placeholder="At least 6 characters"
                      value={passwordState.newPassword}
                      onChange={(e) => setPasswordState({ ...passwordState, newPassword: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Confirm New Password
                    <input
                      type="password"
                      placeholder="Repeat new password"
                      value={passwordState.confirmPassword}
                      onChange={(e) => setPasswordState({ ...passwordState, confirmPassword: e.target.value })}
                      required
                    />
                  </label>
                </div>

                <div className="password-tips-card">
                  <Shield size={16} />
                  <div>
                    <b>Password Security Advice</b>
                    <span>Use a combination of uppercase letters, numbers, and symbols. Never share your student portal password with anyone.</span>
                  </div>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Key size={15} /> Update Password
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 3. Notification Preferences */}
          {activeSection === 'notifications' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Notification Preferences</h2>
                  <p>Choose the automated alerts and emails you wish to receive from FUW E-Library.</p>
                </div>
              </div>

              <form onSubmit={handleSavePreferences}>
                <div className="switch-group">
                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Material Approval Notifications</b>
                      <span>Receive an instant alert when your submitted academic materials are reviewed and approved by administrators.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.approvalAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, approvalAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Material Rejection & Feedback Alerts</b>
                      <span>Get informed if a submission requires adjustments or is rejected by faculty librarians with specific reasons.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.rejectionAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, rejectionAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>New Department Course Materials</b>
                      <span>Notify me when new verified lecture notes, textbooks, or past questions are added to {currentUser.department}.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.newCourseMaterials}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, newCourseMaterials: e.target.checked }
                        })
                      }
                    />
                  </label>

                  <label className="switch-row">
                    <div className="switch-info">
                      <b>Account & Security Announcements</b>
                      <span>Important institutional bulletins regarding semester catalog updates, examination periods, and scheduled maintenance.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.notifications.securityAlerts}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, securityAlerts: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Notification Preferences
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 4. Reading & Display */}
          {activeSection === 'reading' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Reading & Display Preferences</h2>
                  <p>Customize your online document reader defaults and catalog browsing view.</p>
                </div>
              </div>

              <form onSubmit={handleSavePreferences}>
                <div className="form-grid-2">
                  <label>
                    Default Library Layout
                    <select
                      value={settings.reading.defaultView}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, defaultView: e.target.value as any }
                        })
                      }
                    >
                      <option value="grid">Grid Cards (Visual Preview)</option>
                      <option value="list">Compact List Table</option>
                    </select>
                  </label>

                  <label>
                    Preferred Material Sorting
                    <select
                      value={settings.reading.defaultSort}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, defaultSort: e.target.value as any }
                        })
                      }
                    >
                      <option value="newest">Newest First</option>
                      <option value="downloads">Most Downloaded</option>
                      <option value="az">Alphabetical (A–Z)</option>
                    </select>
                  </label>
                </div>

                <div className="form-grid-2">
                  <label>
                    PDF Document Reader Default Zoom
                    <select
                      value={settings.reading.defaultZoom}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, defaultZoom: Number(e.target.value) }
                        })
                      }
                    >
                      <option value="75">75% (Compact Fit)</option>
                      <option value="100">100% (Standard View)</option>
                      <option value="125">125% (Comfortable Large)</option>
                    </select>
                  </label>

                  <label className="switch-row inline-switch" style={{ marginTop: '22px' }}>
                    <div className="switch-info">
                      <b>Remember Last Filter Choices</b>
                      <span>Auto-apply your last selected faculty and level when opening the library.</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.reading.rememberFilters}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          reading: { ...settings.reading, rememberFilters: e.target.checked }
                        })
                      }
                    />
                  </label>
                </div>

                <div className="settings-actions-bar">
                  <button type="submit" className="primary save-btn">
                    <Save size={15} /> Save Display Settings
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 5. Active Sessions */}
          {activeSection === 'sessions' && (
            <div className="settings-section-card">
              <div className="settings-card-header">
                <div>
                  <h2>Active Login Sessions</h2>
                  <p>Devices and browsers currently authenticated to your student account.</p>
                </div>
                <button type="button" className="outline-btn" onClick={handleSignOutOtherSessions}>
                  Sign out other devices
                </button>
              </div>

              <div className="sessions-list">
                <div className="session-item current">
                  <div className="session-icon">
                    <Laptop size={20} />
                  </div>
                  <div className="session-details">
                    <div className="session-title-row">
                      <b>Current Web Browser</b>
                      <span className="current-session-badge">Active Now</span>
                    </div>
                    <p>Chrome on Desktop · Wukari, Taraba State, Nigeria (FUW Campus Wi-Fi)</p>
                    <span className="session-time">Started today at 10:15 AM</span>
                  </div>
                </div>

                <div className="session-item">
                  <div className="session-icon">
                    <Smartphone size={20} />
                  </div>
                  <div className="session-details">
                    <div className="session-title-row">
                      <b>Mobile Safari / Android Web</b>
                      <span className="session-status-text">Idle</span>
                    </div>
                    <p>Mobile Device · Taraba State, Nigeria</p>
                    <span className="session-time">Last active 2 days ago</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. Danger Zone / Actions */}
          {activeSection === 'danger' && (
            <div className="settings-section-card danger-card">
              <div className="settings-card-header">
                <div>
                  <h2>Account Actions</h2>
                  <p>Sign out of your active student session or request account removal.</p>
                </div>
              </div>

              <div className="danger-action-row">
                <div>
                  <b>Sign Out Current Session</b>
                  <p>End your current session on this device. Your saved materials and reading progress will remain intact.</p>
                </div>
                <button type="button" className="danger-btn-outline" onClick={handleSignOut}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>

              <div className="danger-action-row">
                <div>
                  <b>Deactivate Student Account</b>
                  <p>Temporarily deactivate your access or remove your local personal profile from this browser.</p>
                </div>
                <button
                  type="button"
                  className="danger-btn-solid"
                  onClick={() => setDeactivateModalOpen(true)}
                >
                  <Trash2 size={15} /> Deactivate Account
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Account Deactivation Confirmation Modal */}
      {deactivateModalOpen && (
        <div className="modal-backdrop" onClick={() => setDeactivateModalOpen(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-icon warning">
              <AlertTriangle size={28} />
            </div>
            <h3>Deactivate Student Account?</h3>
            <p>
              Are you sure you want to deactivate your student portal session? Your local reading history, saved bookmarks, and uploaded submissions will be archived.
            </p>
            <div className="confirm-modal-actions">
              <button className="cancel-btn" onClick={() => setDeactivateModalOpen(false)}>
                Cancel
              </button>
              <button className="danger-confirm-btn" onClick={handleConfirmDeactivate}>
                Yes, Deactivate & Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
