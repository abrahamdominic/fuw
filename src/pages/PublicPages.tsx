import React, { useState, useMemo } from 'react';
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
  UserCheck
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { MaterialItem } from '../lib/store';
import { catalogue, facultyByName } from '../data/catalogue';
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

  return (
    <>
      <HeroSection />

      {/* University Stats Bar */}
      <section className="stats" aria-label="FUW Statistics">
        {[
          [FileText, '4,800+', 'Academic materials'],
          [Building2, '11', 'Faculties'],
          [GraduationCap, '52', 'Departments'],
          [Users, '8,200+', 'Registered students']
        ].map(([Icon, num, label]: any, idx) => (
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
            All 11 faculties <ChevronRight size={17} />
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
        Explore academic materials organized systematically across Federal University Wukari's 11 faculties.
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
              [Users, 'Inclusive Academic Access', 'Organized across 11 faculties, 52 departments, and 4,800+ resources.']
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

// 7. AUTH PAGES (Login, Register, Admin Gateway with Demo Quick Jumps)
export function LoginPage({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const store = useStore();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('FUW/2022/CSC/0142');
  const [fullName, setFullName] = useState('Aisha Bello');
  const [displayName, setDisplayName] = useState('Aisha');
  const [email, setEmail] = useState('aisha.bello@fuw.edu.ng');

  const handleStudentDemoLogin = () => {
    store.loginStudent('FUW/2022/CSC/0142', 'Aisha Bello');
    toast('Logged in as Aisha Bello (Student)', 'success');
    navigate('/student');
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (register) {
      store.loginStudent(email, fullName);
      store.updateUserProfile({ displayName, email, matricNumber: identifier });
      toast('Student account created and signed in!', 'success');
    } else {
      store.loginStudent(identifier);
      toast('Signed in to Student Portal', 'success');
    }
    navigate('/student');
  };

  return (
    <main className="auth">
      <div className="auth-panel">
        <div className="brand">
          <Logo size={36} />
          <b>FUW</b> E-Library
        </div>
        <p className="kicker">{register ? 'CREATE STUDENT ACCOUNT' : 'STUDENT ACCESS'}</p>
        <h1>{register ? 'Create your account' : 'Sign in to library'}</h1>
        <p>Access verified learning resources and track your academic progress.</p>

        {/* Quick Student Demo Button */}
        <div className="demo-login-strip">
          <span className="demo-label">Quick student login:</span>
          <div className="demo-btns-row">
            <button type="button" className="demo-login-btn student" style={{ gridColumn: 'span 2' }} onClick={handleStudentDemoLogin}>
              <UserCheck size={14} /> Student Demo Access (Aisha Bello)
            </button>
          </div>
        </div>

        <form onSubmit={handleFormSubmit}>
          {register ? (
            <>
              <input required placeholder="Full name *" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <input required placeholder="Display name *" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <input required type="email" placeholder="Email address *" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input required placeholder="Matric number *" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              <input required type="password" placeholder="Password *" defaultValue="password123" />
            </>
          ) : (
            <>
              <input required placeholder="Matriculation number or email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              <input required type="password" placeholder="Password" defaultValue="password123" />
            </>
          )}
          <button type="submit">{register ? 'Create Account & Open Portal' : 'Sign In to Student Portal'}</button>
        </form>

        <p>
          {register ? 'Already have an account?' : 'New to FUW E-Library?'}{' '}
          <Link to={register ? '/login' : '/register'}>
            {register ? 'Log in' : 'Create an account'}
          </Link>
        </p>
      </div>
    </main>
  );
}

// 8. ADMIN LOGIN GATEWAY (Private Access)
export function AdminLoginPage() {
  const navigate = useNavigate();
  const store = useStore();
  const { toast } = useToast();
  const [adminEmail, setAdminEmail] = useState('admin.library@fuw.edu.ng');
  const [adminPassword, setAdminPassword] = useState('adminPass2026');

  const handleAdminSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    store.loginAdmin(adminEmail);
    toast('Authorized Administrator access granted', 'success');
    navigate('/admin');
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

        <form onSubmit={handleAdminSignIn}>
          <input
            required
            placeholder="Admin staff email or username"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
          <input
            required
            type="password"
            placeholder="Password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button type="submit">Sign in as Administrator</button>
        </form>

        <p>
          <Link to="/">← Return to Public Library</Link>
        </p>
      </div>
    </main>
  );
}
