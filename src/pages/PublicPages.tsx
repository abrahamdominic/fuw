import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  FileText,
  Building2,
  GraduationCap,
  Users,
  Search,
  ChevronRight,
  Download,
  Eye,
  Bookmark,
  Share2,
  CheckCircle2,
  Mail,
  HelpCircle,
  Clock,
  BookOpen,
  ShieldCheck,
  ArrowRight,
  Filter,
  X,
  Sparkles,
  SlidersHorizontal,
  Lock,
  UserCheck,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  KeyRound,
  ShieldAlert,
  Edit3
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem } from '../lib/store';
import { catalogue, facultyByName, departmentByName, levelsFor } from '../data/catalogue';
import { useAuth } from '../lib/AuthContext';
import { HeroSection } from '../components/HeroSection';
import { MaterialCard } from '../components/MaterialCard';
import { CatalogueFilters, FilterState } from '../components/CatalogueFilters';
import { Logo } from '../components/Logo';
import { useToast } from '../components/Toast';


interface PublicPagesProps {
  onReadOnline: (material: MaterialItem) => void;
}

// 1. HOME PAGE
export function HomePage({ onReadOnline }: PublicPagesProps) {
  const store = useStore();
  const approvedMaterials = store.getApprovedMaterials();
  const userStats = store.getUserStats();

  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);
  const stats = [
    [FileText, approvedMaterials.length.toLocaleString() + (approvedMaterials.length > 0 ? '+' : ''), 'Academic materials'],
    [Building2, String(catalogue.length), 'Faculties'],
    [GraduationCap, String(departmentsCount), 'Departments'],
    [Users, userStats.studentsCount.toLocaleString() + '+', 'Registered students']
  ];

  return (
    <>
      <HeroSection />

      {/* University Stats Bar */}
      <section className="stats" aria-label="FUW Statistics">
        {stats.map(([Icon, num, label]: any, idx) => (
          <div key={idx}>
            <Icon size={24} />
            <b>{num}</b>
            <span>{label}</span>
          </div>
        ))}
      </section>

      {/* Main Content Sections */}
      <main className="public-container">
        {/* Popular / Recent Materials Section */}
        <div className="section-head">
          <div>
            <p className="kicker">EXPLORE THE COLLECTION</p>
            <h2>Popular & verified materials</h2>
          </div>
          <Link to="/library" className="view-all-link">
            View all materials <ChevronRight size={17} />
          </Link>
        </div>

        <div className="grid materials">
          {approvedMaterials.slice(0, 6).map((m) => (
            <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} />
          ))}
        </div>

        {/* Faculties Exploration Section */}
        <div className="section-head faculty-head">
          <div>
            <p className="kicker">FIND YOUR SUBJECT</p>
            <h2>Browse by faculty</h2>
          </div>
          <Link to="/faculties" className="view-all-link">
            All {catalogue.length} faculties <ChevronRight size={17} />
          </Link>
        </div>

        <div className="grid faculty-grid">
          {catalogue.slice(0, 6).map((f, i) => (
            <Link className="faculty" to={`/library?faculty=${encodeURIComponent(f.name)}`} key={f.name}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <h3>{f.name}</h3>
              <p>{f.departments.length} accredited departments</p>
              <ArrowRight size={18} />
            </Link>
          ))}
        </div>

        {/* College of Health Sciences Banner */}
        <section className="health">
          <p>COLLEGE OF HEALTH SCIENCES</p>
          <h2>Medical & Health Sciences Division</h2>
          <div>
            Basic Medical Sciences · Allied Health Sciences · Clinical Sciences · Human Anatomy · Physiology · Medical Laboratory Science · Physiotherapy · Medicine & Surgery
          </div>
          <Link to="/library?faculty=College+of+Health+Sciences" className="health-link">
            Browse Medical Collection →
          </Link>
        </section>
      </main>
    </>
  );
}

// 2. LIBRARY PAGE (Search + Multi-level Filters + Sorting)
export function LibraryPage({ onReadOnline }: PublicPagesProps) {
  const store = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState('newest');

  const queryQ = searchParams.get('q') || '';
  const queryFaculty = searchParams.get('faculty') || '';
  const queryDepartment = searchParams.get('department') || '';
  const queryLevel = searchParams.get('level') || '';
  const querySemester = searchParams.get('semester') || '';
  const queryType = searchParams.get('type') || '';
  const queryCourse = searchParams.get('course') || '';

  const [searchInput, setSearchInput] = useState(queryQ);

  const filters: FilterState = {
    faculty: queryFaculty,
    department: queryDepartment,
    course: queryCourse,
    level: queryLevel,
    semester: querySemester,
    type: queryType
  };

  const handleFilterChange = (newFilters: FilterState) => {
    const params: Record<string, string> = {};
    if (queryQ) params.q = queryQ;
    if (newFilters.faculty) params.faculty = newFilters.faculty;
    if (newFilters.department) params.department = newFilters.department;
    if (newFilters.course) params.course = newFilters.course;
    if (newFilters.level) params.level = newFilters.level;
    if (newFilters.semester) params.semester = newFilters.semester;
    if (newFilters.type) params.type = newFilters.type;
    setSearchParams(params);
  };

  const clearAllFilters = () => {
    setSearchInput('');
    setSearchParams({});
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (searchInput.trim()) {
      params.set('q', searchInput.trim());
    } else {
      params.delete('q');
    }
    setSearchParams(params);
  };

  // Filter approved materials
  const approved = store.getApprovedMaterials();

  const filteredMaterials = useMemo(() => {
    return approved.filter((m) => {
      // Text search
      if (queryQ) {
        const q = queryQ.toLowerCase();
        const matches =
          m.title.toLowerCase().includes(q) ||
          m.course.toLowerCase().includes(q) ||
          m.department.toLowerCase().includes(q) ||
          m.faculty.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Faculty filter
      if (queryFaculty && m.faculty !== queryFaculty) return false;

      // Department filter
      if (queryDepartment && m.department !== queryDepartment) return false;

      // Course filter
      if (queryCourse && m.course !== queryCourse) return false;

      // Level filter
      if (queryLevel && m.level !== queryLevel) return false;

      // Semester filter
      if (querySemester && m.semester !== querySemester) return false;

      // Type filter
      if (queryType && m.type !== queryType) return false;

      return true;
    }).sort((a, b) => {
      if (sortBy === 'downloads') return b.downloads - a.downloads;
      if (sortBy === 'views') return b.views - a.views;
      if (sortBy === 'az') return a.title.localeCompare(b.title);
      return 0; // default newest
    });
  }, [approved, queryQ, queryFaculty, queryDepartment, queryCourse, queryLevel, querySemester, queryType, sortBy]);

  const activeFiltersCount = [
    queryFaculty,
    queryDepartment,
    queryCourse,
    queryLevel,
    querySemester,
    queryType
  ].filter(Boolean).length;

  return (
    <main className="library public-container">
      <div className="crumb">
        <Link to="/">Home</Link> <ChevronRight size={14} /> <span>Library Collection</span>
      </div>

      <div className="library-header-row">
        <div>
          <h1>Explore the digital library</h1>
          <p className="subtitle">Discover verified course notes, past questions, textbooks, and theses across FUW.</p>
        </div>

        <button
          className="mobile-filter-btn"
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
        >
          <SlidersHorizontal size={16} />
          <span>Filters {activeFiltersCount > 0 && `(${activeFiltersCount})`}</span>
        </button>
      </div>

      {/* Library Search Bar */}
      <form className="search library-search-bar" onSubmit={handleSearchSubmit}>
        <Search size={20} className="search-icon" />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by book title, course code (e.g. CSC 201, ECN 201), topic, or lecturer..."
          aria-label="Search resources"
        />
        {searchInput && (
          <button
            type="button"
            className="clear-btn"
            onClick={() => {
              setSearchInput('');
              const p = new URLSearchParams(searchParams);
              p.delete('q');
              setSearchParams(p);
            }}
          >
            <X size={16} />
          </button>
        )}
        <button type="submit">Search</button>
      </form>

      {/* Active Filter Chips */}
      {(activeFiltersCount > 0 || queryQ) && (
        <div className="active-filter-chips">
          <span className="chips-label">Active Filters:</span>
          {queryQ && (
            <span className="filter-chip">
              Search: "{queryQ}"
              <button onClick={() => {
                setSearchInput('');
                const p = new URLSearchParams(searchParams);
                p.delete('q');
                setSearchParams(p);
              }}><X size={12} /></button>
            </span>
          )}
          {queryFaculty && (
            <span className="filter-chip">
              Faculty: {queryFaculty}
              <button onClick={() => handleFilterChange({ ...filters, faculty: '' })}><X size={12} /></button>
            </span>
          )}
          {queryDepartment && (
            <span className="filter-chip">
              Dept: {queryDepartment}
              <button onClick={() => handleFilterChange({ ...filters, department: '' })}><X size={12} /></button>
            </span>
          )}
          {queryCourse && (
            <span className="filter-chip">
              Course: {queryCourse}
              <button onClick={() => handleFilterChange({ ...filters, course: '' })}><X size={12} /></button>
            </span>
          )}
          {queryLevel && (
            <span className="filter-chip">
              Level: {queryLevel}
              <button onClick={() => handleFilterChange({ ...filters, level: '' })}><X size={12} /></button>
            </span>
          )}
          {queryType && (
            <span className="filter-chip">
              Type: {queryType}
              <button onClick={() => handleFilterChange({ ...filters, type: '' })}><X size={12} /></button>
            </span>
          )}
          <button className="clear-all-chips" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      )}

      {/* Library Body Layout */}
      <div className="library-body">
        {/* Sidebar Filters */}
        <aside className={`library-sidebar ${mobileFiltersOpen ? 'mobile-show' : ''}`}>
          <div className="sidebar-filter-head">
            <b>FILTER MATERIALS</b>
            {activeFiltersCount > 0 && (
              <button className="reset-link" onClick={clearAllFilters}>
                Reset all
              </button>
            )}
          </div>
          <CatalogueFilters filters={filters} onChange={handleFilterChange} />
        </aside>

        {/* Results Stream */}
        <section className="library-results-stream">
          <div className="results-top-bar">
            <b>{filteredMaterials.length} academic resource{filteredMaterials.length !== 1 ? 's' : ''} found</b>
            <div className="sort-controls">
              <label htmlFor="sort-select">Sort by:</label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="newest">Newest First</option>
                <option value="downloads">Most Downloaded</option>
                <option value="views">Most Viewed</option>
                <option value="az">A–Z Alphabetical</option>
              </select>
            </div>
          </div>

          {filteredMaterials.length === 0 ? (
            <div className="empty-state library-empty">
              <BookOpen size={48} />
              <h3>No matching materials found</h3>
              <p>Try clearing some filters or searching for broader terms like "Economics", "CSC", or "Past questions".</p>
              <button className="primary" onClick={clearAllFilters}>
                Show All Available Materials
              </button>
            </div>
          ) : (
            <div className="grid materials library-cards-grid">
              {filteredMaterials.map((m) => (
                <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// 3. FACULTIES PAGE
export function FacultiesPage() {
  return (
    <main className="faculties public-container">
      <div className="crumb">
        <Link to="/">Home</Link> <ChevronRight size={14} /> <span>Faculties & Departments</span>
      </div>

      <h1>Faculties & accredited departments</h1>
      <p className="subtitle">
        Explore academic materials organized systematically across Federal University Wukari's {catalogue.length} faculties.
      </p>

      <div className="faculty-list">
        {catalogue.map((f) => (
          <section key={f.name} className="faculty-section-card">
            <h2>{f.name}</h2>
            <div className="dept-links-grid">
              {f.departments.map((d) => (
                <Link
                  key={d.name}
                  to={`/library?department=${encodeURIComponent(d.name)}`}
                  className="dept-link-item"
                >
                  <span>{d.name}</span>
                  <span className="duration-pill">{d.duration} yrs</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

// 4. COURSES DIRECTORY PAGE
export function CoursesPage() {
  const [searchTerm, setSearchTerm] = useState('');

  const allCourses = catalogue.flatMap((f) =>
    f.departments.flatMap((d) =>
      d.courses.map((c) => ({
        code: c.code,
        name: c.name,
        level: c.level * 100 + ' Level',
        semester: c.semester,
        dept: d.name,
        faculty: f.name
      }))
    )
  );

  const filtered = allCourses.filter(
    (c) =>
      c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.dept.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <main className="courses-page public-container">
      <div className="crumb">
        <Link to="/">Home</Link> <ChevronRight size={14} /> <span>Course Directory</span>
      </div>

      <h1>Course curriculum directory</h1>
      <p className="subtitle">Find learning resources, past questions, and notes for your specific course code.</p>

      <div className="manage-tools search-courses-bar">
        <Search size={18} />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter by course code (e.g. CSC 201, ECN 201) or course title..."
        />
        {searchTerm && (
          <button className="clear-btn" onClick={() => setSearchTerm('')}>
            Clear
          </button>
        )}
      </div>

      <div className="table">
        <div className="tr head courses-table-grid">
          <span>Course Code</span>
          <span>Course Name</span>
          <span>Department</span>
          <span>Level</span>
          <span>Semester</span>
          <span>Materials</span>
        </div>

        {filtered.map((c) => (
          <div className="tr courses-table-grid" key={c.code}>
            <span>
              <b className="course-code-highlight">{c.code}</b>
            </span>
            <span>{c.name}</span>
            <span>{c.dept}</span>
            <span>{c.level}</span>
            <span>{c.semester}</span>
            <span>
              <Link to={`/library?q=${encodeURIComponent(c.code)}`} className="table-action-btn">
                Browse Files
              </Link>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}

// 5. MATERIAL DETAIL PAGE
export function MaterialDetailPage({ onReadOnline }: PublicPagesProps) {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { toast } = useToast();
  const material = store.getMaterialById(id || '') || store.getApprovedMaterials()[0];

  if (!material) {
    return (
      <main className="public-container empty-state">
        <BookOpen size={48} />
        <h2>Material not found</h2>
        <Link to="/library" className="primary">
          Back to Library
        </Link>
      </main>
    );
  }

  const isSaved = store.isBookmarked(material.id);

  const handleDownload = () => {
    store.recordDownload(material.id);
    toast(`Downloading ${material.fileName}`);
    const link = document.createElement('a');
    link.href = material.fileUrl;
    link.download = material.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleToggleSave = () => {
    const saved = store.toggleBookmark(material.id);
    toast(saved ? 'Saved to bookmarks' : 'Removed from bookmarks', 'info');
  };

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    toast('Direct link copied to clipboard!');
  };

  return (
    <main className="detail public-container">
      <div className="crumb">
        <Link to="/library">Library</Link> <ChevronRight size={14} /> <span>{material.course}</span> <ChevronRight size={14} /> <span>{material.title}</span>
      </div>

      <div className="detail-grid">
        <div className="detail-preview-panel">
          <div className="pdf-preview">
            <FileText size={64} />
            <b>{material.fileName}</b>
            <span>{material.fileSize} · PDF Academic Document</span>
            <button className="primary open-reader-btn" onClick={() => onReadOnline(material)}>
              <Eye size={16} /> Read Document Online
            </button>
          </div>

          <div className="detail-actions">
            <button onClick={() => onReadOnline(material)}>
              <Eye size={16} /> Read online
            </button>
            <button onClick={handleDownload}>
              <Download size={16} /> Download ({material.fileSize})
            </button>
            <button onClick={handleToggleSave} className={isSaved ? 'active' : ''}>
              <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} /> {isSaved ? 'Saved' : 'Save'}
            </button>
            <button onClick={handleShare}>
              <Share2 size={16} /> Share
            </button>
          </div>
        </div>

        <section className="detail-info-panel">
          <span className={`pill-badge ${material.tone}`}>{material.type}</span>
          <h1>{material.title}</h1>
          <p className="detail-desc">{material.description}</p>

          <dl className="detail-meta-list">
            <dt>Course Code & Title</dt>
            <dd>{material.course} · {material.courseTitle || material.title}</dd>

            <dt>Faculty</dt>
            <dd>{material.faculty}</dd>

            <dt>Department</dt>
            <dd>{material.department}</dd>

            <dt>Level & Semester</dt>
            <dd>{material.level} · {material.semester}</dd>

            <dt>Academic Session</dt>
            <dd>{material.session}</dd>

            <dt>Uploaded By</dt>
            <dd>{material.uploadedBy.name}</dd>

            <dt>Repository Stats</dt>
            <dd>{material.views.toLocaleString()} views · {material.downloads.toLocaleString()} downloads</dd>
          </dl>
        </section>
      </div>
    </main>
  );
}

// 6. ABOUT & CONTACT PAGES
export function AboutPage({ contact = false }: { contact?: boolean }) {
  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);

  return (
    <main className="info public-container">
      <p className="kicker">FEDERAL UNIVERSITY WUKARI</p>
      <h1>{contact ? 'Library Helpdesk & Support' : 'Academic Knowledge Within Reach.'}</h1>
      <p className="subtitle">
        {contact
          ? 'Our e-library team is available to assist students, lecturers, and researchers with digital resource access.'
          : 'The Federal University Wukari Digital E-Library serves as the primary academic digital repository for all enrolled undergraduate and postgraduate students.'}
      </p>

      <div className="info-grid">
        {(contact
          ? [
              [Mail, 'Email Support', 'library@fuw.edu.ng'],
              [HelpCircle, 'Physical Help Desk', 'Central University Library Complex, FUW Campus'],
              [Clock, 'Operating Hours', '24/7 Digital Access · Help Desk: Mon–Fri 8am–4pm']
            ]
          : [
              [BookOpen, 'Curated Curriculum Notes', 'Verified lecture summaries, textbook references, and exam past questions.'],
              [ShieldCheck, 'Quality & Faculty Review', 'All student contributed materials are vetted by librarians before publication.'],
              [Users, 'Inclusive Academic Access', `Organized across ${catalogue.length} faculties, ${departmentsCount} departments, and a growing verified collection.`]
            ]
        ).map(([Icon, heading, text]: any, idx) => (
          <section key={idx}>
            <Icon size={28} />
            <h2>{heading}</h2>
            <p>{text}</p>
          </section>
        ))}
      </div>
    </main>
  );
}

// Helper for 6-digit OTP input boxes with auto-advance and paste support
function OtpDigitInput({
  otp,
  setOtp,
  disabled
}: {
  otp: string[];
  setOtp: (otp: string[]) => void;
  disabled?: boolean;
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, val: string) => {
    const digitsOnly = val.replace(/\D/g, '');
    if (!digitsOnly) {
      const next = [...otp];
      next[index] = '';
      setOtp(next);
      return;
    }
    const char = digitsOnly.slice(-1);
    const next = [...otp];
    next[index] = char;
    setOtp(next);

    // Auto-focus next input
    if (index < 5 && char) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData) {
      const next = ['', '', '', '', '', ''];
      for (let i = 0; i < pastedData.length; i++) {
        next[i] = pastedData[i];
      }
      setOtp(next);
      const focusIndex = Math.min(pastedData.length, 5);
      inputRefs.current[focusIndex]?.focus();
    }
  };

  return (
    <div className="otp-inputs-row" onPaste={handlePaste}>
      {otp.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => {
            inputRefs.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          className={`otp-digit-box ${digit ? 'filled' : ''}`}
          aria-label={`Digit ${idx + 1}`}
          autoFocus={idx === 0}
        />
      ))}
    </div>
  );
}

// 7. AUTH PAGES (Supabase Email OTP Authentication: Signup & Login)
export function LoginPage({ register: initialRegister = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { sendOtp, verifyOtp, completeProfile, isAuthenticated, isProfileComplete, user, profile } = useAuth();

  const [isRegister, setIsRegister] = useState(initialRegister);
  const [step, setStep] = useState<'email' | 'otp' | 'profile'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Profile fields for Step 3
  const [profileData, setProfileData] = useState({
    fullName: '',
    matricNumber: '',
    faculty: catalogue[0]?.name || '',
    department: catalogue[0]?.departments[0]?.name || '',
    level: '100 Level',
    bio: ''
  });

  // Calculate available departments and levels dynamically
  const currentFaculty = facultyByName(profileData.faculty) || catalogue[0];
  const currentDepartment = departmentByName(profileData.faculty, profileData.department) || currentFaculty.departments[0];
  const availableLevels = levelsFor(currentDepartment?.duration || 4);

  // Countdown timer effect
  useEffect(() => {
    let timer: any;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((c) => c - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  // If already authenticated with a completed profile, redirect to the right
  // dashboard. Incomplete profiles stay here so the student finishes signup.
  useEffect(() => {
    if (isAuthenticated && isProfileComplete && step !== 'profile') {
      if (profile?.role === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/student', { replace: true });
      }
    }
  }, [isAuthenticated, isProfileComplete, profile, navigate, step]);

  // Faculty change handler -> updates departments and validates level
  const handleFacultySelect = (facName: string) => {
    const fac = facultyByName(facName) || catalogue[0];
    const firstDept = fac.departments[0];
    const deptLevels = levelsFor(firstDept.duration);
    setProfileData((prev) => ({
      ...prev,
      faculty: facName,
      department: firstDept.name,
      level: deptLevels.includes(prev.level) ? prev.level : deptLevels[0]
    }));
  };

  // Department change handler -> dynamically restricts levels to department duration (4, 5, or 6 years)
  const handleDepartmentSelect = (deptName: string) => {
    const dept = departmentByName(profileData.faculty, deptName);
    const deptLevels = levelsFor(dept?.duration || 4);
    setProfileData((prev) => ({
      ...prev,
      department: deptName,
      level: deptLevels.includes(prev.level) ? prev.level : deptLevels[0]
    }));
  };

  // Step 1: Send OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid university or personal email address.');
      return;
    }

    setBusy(true);
    const res = await sendOtp(cleanEmail, isRegister);
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
    } else {
      setSuccessMsg(res.message || `A 6-digit verification code was sent to ${cleanEmail}`);
      toast('Verification code sent to your email', 'info');
      setStep('otp');
      setCountdown(60);
      setOtp(['', '', '', '', '', '']);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const code = otp.join('').trim();
    if (code.length !== 6) {
      setErrorMsg('Please enter all 6 digits of the verification code.');
      return;
    }

    setBusy(true);
    const res = await verifyOtp(email, code);
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
    } else {
      toast('Email verified successfully!', 'success');
      if (res.isNewUser || isRegister) {
        // Move to Step 3: Complete Profile
        setStep('profile');
      } else {
        // Existing user -> redirect to dashboard
        if (res.role === 'admin') {
          navigate('/admin');
        } else {
          navigate('/student');
        }
      }
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (countdown > 0 || busy) return;
    setErrorMsg(null);
    setBusy(true);
    const res = await sendOtp(email, isRegister);
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
    } else {
      setSuccessMsg(`A new 6-digit code has been sent to ${email}`);
      toast('New verification code sent', 'info');
      setCountdown(60);
      setOtp(['', '', '', '', '', '']);
    }
  };

  // Step 3: Complete Profile
  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!profileData.fullName.trim()) {
      setErrorMsg('Full Name is required.');
      return;
    }
    if (!profileData.matricNumber.trim()) {
      setErrorMsg('Matriculation Number is required.');
      return;
    }

    setBusy(true);
    const res = await completeProfile({
      fullName: profileData.fullName,
      matricNumber: profileData.matricNumber,
      faculty: profileData.faculty,
      department: profileData.department,
      level: profileData.level,
      bio: profileData.bio
    });
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
    } else {
      toast('Student profile created successfully! Welcome to FUW E-Library.', 'success');
      navigate('/student');
    }
  };

  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="brand">
          <Logo size={36} />
          <b>FUW</b> E-Library
        </div>

        {/* STEP 1: Enter Email */}
        {step === 'email' && (
          <>
            <p className="kicker">{isRegister ? 'STUDENT REGISTRATION' : 'SECURE STUDENT ACCESS'}</p>
            <h1>{isRegister ? 'Create your account' : 'Sign in to library'}</h1>
            <p>
              {isRegister
                ? 'Enter your email to receive a 6-digit Supabase authentication code.'
                : 'Enter your registered email to receive a 6-digit one-time login code.'}
            </p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            {successMsg && (
              <div className="form-feedback-box success">
                <CheckCircle2 size={17} />
                <p>{successMsg}</p>
              </div>
            )}

            <form onSubmit={handleSendOtp} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Email Address</span>
                <input
                  required
                  type="email"
                  placeholder="e.g. yourname@fuw.edu.ng or personal email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Sending OTP…
                  </>
                ) : (
                  <>
                    <KeyRound size={16} /> Send 6-Digit OTP
                  </>
                )}
              </button>
            </form>

            <div className="auth-toggle-row">
              <p>
                {isRegister ? 'Already have an account?' : 'New student to FUW E-Library?'}{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                >
                  {isRegister ? 'Log in with OTP' : 'Create an account'}
                </button>
              </p>
            </div>
          </>
        )}

        {/* STEP 2: Verify 6-digit OTP */}
        {step === 'otp' && (
          <>
            <p className="kicker">TWO-FACTOR VERIFICATION</p>
            <h1>Enter verification code</h1>
            <div className="otp-email-badge">
              <span>Code sent to: <b>{email}</b></span>
              <button
                type="button"
                className="edit-email-btn"
                onClick={() => {
                  setStep('email');
                  setErrorMsg(null);
                }}
              >
                <Edit3 size={13} /> Change
              </button>
            </div>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            {successMsg && (
              <div className="form-feedback-box success">
                <CheckCircle2 size={17} />
                <p>{successMsg}</p>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Enter 6-digit OTP Code</span>
                <OtpDigitInput otp={otp} setOtp={setOtp} disabled={busy} />
              </label>

              <button
                type="submit"
                className="primary auth-submit-btn"
                disabled={busy || otp.join('').length !== 6}
              >
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Verifying…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> {isRegister ? 'Verify Email & Continue' : 'Verify & Sign In'}
                  </>
                )}
              </button>

              <div className="otp-resend-container">
                {countdown > 0 ? (
                  <span className="otp-countdown-text">
                    <Clock size={14} /> Resend OTP in <b>{countdown}s</b>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="resend-otp-btn"
                    onClick={handleResendOtp}
                    disabled={busy}
                  >
                    <RefreshCw size={14} /> Didn't receive code? Resend OTP
                  </button>
                )}
              </div>

              <button
                type="button"
                className="back-step-btn"
                onClick={() => {
                  setStep('email');
                  setErrorMsg(null);
                }}
              >
                <ArrowLeft size={14} /> Back to email entry
              </button>
            </form>
          </>
        )}

        {/* STEP 3: Complete Student Profile */}
        {step === 'profile' && (
          <>
            <p className="kicker">FINAL STEP: PROFILE DETAILS</p>
            <h1>Complete student profile</h1>
            <p>Select your accredited FUW faculty, department, and academic level.</p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleCompleteProfile} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Full Legal Name *</span>
                <input
                  required
                  placeholder="e.g. Aisha Bello"
                  value={profileData.fullName}
                  onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                  disabled={busy}
                />
              </label>

              <label className="auth-field-label">
                <span>Verified Email Address</span>
                <div className="input-with-badge">
                  <input
                    type="email"
                    value={email || user?.email || ''}
                    readOnly
                    className="input-readonly"
                    title="Email verified via Supabase Auth"
                  />
                  <span className="readonly-tag">
                    <ShieldCheck size={12} /> Verified
                  </span>
                </div>
              </label>

              <label className="auth-field-label">
                <span>Matriculation Number *</span>
                <input
                  required
                  placeholder="e.g. FUW/2023/CSC/0142"
                  value={profileData.matricNumber}
                  onChange={(e) => setProfileData({ ...profileData, matricNumber: e.target.value.toUpperCase() })}
                  disabled={busy}
                />
              </label>

              <label className="auth-field-label">
                <span>Faculty *</span>
                <select
                  value={profileData.faculty}
                  onChange={(e) => handleFacultySelect(e.target.value)}
                  disabled={busy}
                  required
                >
                  {catalogue.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="auth-field-label">
                <span>Department *</span>
                <select
                  value={profileData.department}
                  onChange={(e) => handleDepartmentSelect(e.target.value)}
                  disabled={busy}
                  required
                >
                  {currentFaculty.departments.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} ({d.duration} Years)
                    </option>
                  ))}
                </select>
              </label>

              <label className="auth-field-label">
                <span>Level of Study * (Restricted to {currentDepartment?.duration || 4}-Year Curriculum)</span>
                <select
                  value={profileData.level}
                  onChange={(e) => setProfileData({ ...profileData, level: e.target.value })}
                  disabled={busy}
                  required
                >
                  {availableLevels.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Saving Profile…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> Complete & Open Student Dashboard
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

// 8. ADMIN LOGIN GATEWAY (Supabase Email OTP Authentication + Role Authorization)
export function AdminLoginPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { sendOtp, verifyOtp, profile, isAdmin } = useAuth();

  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [adminEmail, setAdminEmail] = useState('');
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: any;
    if (countdown > 0) {
      timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  const handleSendAdminOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanEmail = adminEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid administrator email address.');
      return;
    }

    setBusy(true);
    const res = await sendOtp(cleanEmail, false);
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
    } else {
      setSuccessMsg(`A 6-digit administrator verification code has been sent to ${cleanEmail}`);
      toast('Admin OTP code sent to your email', 'info');
      setStep('otp');
      setCountdown(60);
      setOtp(['', '', '', '', '', '']);
    }
  };

  const handleVerifyAdminOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const code = otp.join('').trim();
    if (code.length !== 6) {
      setErrorMsg('Please enter the 6-digit admin code.');
      return;
    }

    setBusy(true);
    const res = await verifyOtp(adminEmail, code);
    setBusy(false);

    if (res.error) {
      setErrorMsg(res.error.message);
    } else {
      if (res.role === 'admin') {
        toast('Authorized Administrator access granted', 'success');
        navigate('/admin');
      } else {
        // Account exists but is not an admin
        setErrorMsg('Access Denied: Your account does not have administrator privileges. Redirecting to student portal...');
        toast('Access Denied: Student account redirected to student portal', 'error');
        setTimeout(() => {
          navigate('/student');
        }, 2000);
      }
    }
  };

  return (
    <main className="auth">
      <div className="auth-panel admin-auth-panel">
        <div className="brand">
          <Logo size={36} />
          <b>FUW</b> Administration
        </div>
        <p className="kicker">STAFF & LIBRARIAN GATEWAY</p>
        <h1>Admin sign in</h1>
        <p>Sign in to review student material submissions and manage library catalogues.</p>

        {errorMsg && (
          <div className="form-feedback-box error">
            <AlertCircle size={17} />
            <p>{errorMsg}</p>
          </div>
        )}

        {successMsg && (
          <div className="form-feedback-box success">
            <CheckCircle2 size={17} />
            <p>{successMsg}</p>
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendAdminOtp} className="auth-flow-form">
            <label className="auth-field-label">
              <span>Admin Staff Email</span>
              <input
                required
                type="email"
                placeholder="e.g. admin.library@fuw.edu.ng"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>

            <button type="submit" className="primary auth-submit-btn" disabled={busy}>
              {busy ? (
                <>
                  <RefreshCw size={16} className="spin-icon" /> Sending OTP…
                </>
              ) : (
                <>
                  <KeyRound size={16} /> Send Admin Access Code
                </>
              )}
            </button>

            <p className="auth-back-link">
              <Link to="/">← Return to Public Library</Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyAdminOtp} className="auth-flow-form">
            <div className="otp-email-badge">
              <span>Admin Code sent to: <b>{adminEmail}</b></span>
              <button
                type="button"
                className="edit-email-btn"
                onClick={() => {
                  setStep('email');
                  setErrorMsg(null);
                }}
              >
                <Edit3 size={13} /> Change
              </button>
            </div>

            <label className="auth-field-label">
              <span>Enter 6-digit Administrator OTP</span>
              <OtpDigitInput otp={otp} setOtp={setOtp} disabled={busy} />
            </label>

            <button
              type="submit"
              className="primary auth-submit-btn"
              disabled={busy || otp.join('').length !== 6}
            >
              {busy ? (
                <>
                  <RefreshCw size={16} className="spin-icon" /> Authorizing…
                </>
              ) : (
                <>
                  <ShieldCheck size={16} /> Verify & Access Admin Dashboard
                </>
              )}
            </button>

            <div className="otp-resend-container">
              {countdown > 0 ? (
                <span className="otp-countdown-text">
                  <Clock size={14} /> Resend OTP in <b>{countdown}s</b>
                </span>
              ) : (
                <button
                  type="button"
                  className="resend-otp-btn"
                  onClick={handleSendAdminOtp}
                  disabled={busy}
                >
                  <RefreshCw size={14} /> Resend Admin OTP
                </button>
              )}
            </div>

            <p className="auth-back-link">
              <button
                type="button"
                className="back-step-btn"
                onClick={() => {
                  setStep('email');
                  setErrorMsg(null);
                }}
              >
                <ArrowLeft size={14} /> Back to email
              </button>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

