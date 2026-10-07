import React, { useState, useMemo, useEffect } from 'react';
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
  X,
  Sparkles,
  SlidersHorizontal,
  AlertCircle,
  RefreshCw,
  EyeOff,
  ArrowLeft,
  Landmark,
  ShoppingBag,
  Home
} from 'lucide-react';
import { useStore } from '../lib/useStore';
import { supabase } from '../lib/supabase';
import { MaterialItem } from '../lib/store';
import { getSecureFileUrl } from '../lib/materials';
import { checkDocumentAccess, type BlockReason } from '../lib/premium';
import { PremiumGateModal } from '../components/PremiumGateModal';
import { logSearch } from '../lib/searchLog';
import { friendlyError } from '../lib/friendlyError';
import { catalogue, facultyByName, departmentByName, levelsFor, allDepartments, normalizeLevel, groupedFaculties, materialTypes } from '../data/catalogue';
import { facultySlug, departmentSlug, shortFacultyName, courseEntries } from '../lib/seo/directory';
import { materialMeta } from '../lib/seo/dynamic';
import { PUBLIC_ROUTES } from '../lib/seo/routes';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { useAuth, USERNAME_PATTERN, normalizeUsername, validatePasswordPolicy, PASSWORD_REQUIREMENTS_TEXT } from '../lib/AuthContext';
import { aiSearch, AiSearchResult } from '../lib/ai';
import { HeroSection } from '../components/HeroSection';
import { MaterialCard } from '../components/MaterialCard';
import { CatalogueFilters, FilterState, EMPTY_FILTERS } from '../components/CatalogueFilters';
import { Logo } from '../components/Logo';
import { useToast } from '../components/Toast';
import { SEO } from '../components/SEO';
import { CitationModal } from '../components/CitationModal';
import { ReadingListPicker } from '../components/ReadingListPicker';
import { mergeDbCourses } from '../lib/liveCatalogue';
import { analyticsTracker } from '../lib/analyticsTracker';
import { aal2LoginChallenge, signInWithPasskey } from '../lib/security';
import { MacPage, MacCard, MacBanner, PasswordControl } from './AuthScreens';
import { fx, staggerDelay } from '../lib/motion';


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
      <SEO
        path="/"
        title="FUW Campus Hub | E Library, Marketplace & Accommodation"
        description="Federal University Wukari official student platform: access the FUW E-Library, Student Marketplace, and verified campus Accommodation."
        keywords={[
          'FUW Campus Hub',
          'FUW E-Library',
          'FUW Marketplace',
          'FUW Accommodation',
          'Federal University Wukari',
          'FUW student portal',
          'FUW past questions',
          'FUW lodges'
        ]}
        image="/images/fuw-campushub-og.png"
        imageAlt="FUW Campus Hub: E-Library, Marketplace & Accommodation"
        schema="home"
      />
      <HeroSection />

      {/* University Stats Bar */}
      <section className="stats" aria-label="FUW Campus Hub at a glance">
        {stats.map(([Icon, num, label]: any, idx) => (
          <div key={idx} className={fx.fadeUp} style={staggerDelay(idx, 60)}>
            <Icon size={24} />
            <b>{num}</b>
            <span>{label}</span>
          </div>
        ))}
      </section>

      {/* Campus Hub Core Ecosystem Pillars */}
      <section className="public-container" aria-label="FUW Campus Hub Core Services" style={{ marginTop: '2.5rem', marginBottom: '2.5rem' }}>
        <div className="section-head" style={{ marginBottom: '1.25rem' }}>
          <div>
            <p className="kicker">FUW CAMPUS ECOSYSTEM</p>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Explore FUW Campus Hub Services</h2>
          </div>
          <Link to="/hub" className="view-all-link" style={{ fontWeight: 600 }}>
            Explore FUW Campus Hub <ChevronRight size={17} />
          </Link>
        </div>

        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          {/* E-Library Card */}
          <div className="card pillar-card" style={{ padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--border-color, #e2e8f0)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', marginBottom: '1rem' }}>
                <BookOpen size={24} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>FUW E-Library</h3>
              <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.925rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                Curated lecture notes, exam past questions, handouts, and research theses across all 14 faculties and accredited departments of Federal University Wukari.
              </p>
            </div>
            <Link to="/library" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#0B6B3A' }}>
              Explore FUW E-Library <ArrowRight size={16} />
            </Link>
          </div>

          {/* Marketplace Card */}
          <div className="card pillar-card" style={{ padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--border-color, #e2e8f0)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(56, 189, 248, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7', marginBottom: '1rem' }}>
                <ShoppingBag size={24} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>FUW Marketplace</h3>
              <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.925rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                Buy and sell student textbooks, gadgets, dorm items, and campus services like laundry, barbing, and device repairs with student escrow protection.
              </p>
            </div>
            <Link to="/marketplace" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#0B6B3A' }}>
              Browse FUW Marketplace <ArrowRight size={16} />
            </Link>
          </div>

          {/* Accommodation Card */}
          <div className="card pillar-card" style={{ padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--border-color, #e2e8f0)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706', marginBottom: '1rem' }}>
                <Home size={24} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>FUW Accommodation</h3>
              <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.925rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                Verified student lodges, self-contained rooms, and off-campus apartments in Wukari with caretaker checks and verified roommate matching.
              </p>
            </div>
            <Link to="/accommodation" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#0B6B3A' }}>
              Find FUW Accommodation <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Main Content Sections */}
      <main className="public-container">
        {/* Popular / Recent Materials Section */}
        <div className="section-head">
          <div>
            <p className="kicker">EXPLORE THE COLLECTION</p>
            <h2>Popular &amp; verified academic materials</h2>
          </div>
          <Link to="/library" className="view-all-link">
            Browse all materials <ChevronRight size={17} />
          </Link>
        </div>

        {approvedMaterials.length === 0 ? (
          <div className="empty-state library-empty">
            <BookOpen size={44} />
            <h3>The catalogue is being prepared</h3>
            <p>
              Approved lecture notes, handouts and past questions appear here as soon as the library publishes them.
              In the meantime, browse the full academic directory.
            </p>
            <Link to="/courses" className="primary">
              Open the FUW course directory
            </Link>
          </div>
        ) : (
          <div className="grid materials">
            {approvedMaterials.slice(0, 6).map((m) => (
              <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} />
            ))}
          </div>
        )}

        {/* What the FUW E-Library is */}
        <section className="info-grid" style={{ marginTop: '2.5rem' }}>
          <section>
            <BookOpen size={28} />
            <h2>What the FUW E-Library is</h2>
            <p>
              The FUW E-Library is Federal University Wukari&rsquo;s digital library: one place where every
              undergraduate and postgraduate student can find the academic material for the courses they are sitting.
              It replaces scattered WhatsApp folders and departmental drives with a single, searchable, librarian-vetted
              catalogue that works on a phone, a laptop or the university network.
            </p>
          </section>
          <section>
            <ShieldCheck size={28} />
            <h2>Who it is for</h2>
            <p>
              Students of {catalogue.length} faculties and {departmentsCount} accredited departments, the lecturers
              who teach them, and researchers looking for project and thesis material. Browse, search and read online are
              open to everyone; downloading a file needs a verified student account.
            </p>
          </section>
          <section>
            <GraduationCap size={28} />
            <h2>What you can find</h2>
            <p>
              Lecture notes and handouts for every level and semester, test and exam past questions, final-year
              project guides, plus the theses, dissertations and research papers archived in the{' '}
              <Link to="/repository">FUW institutional repository</Link>. Materials are organised by faculty,
              department, course code, level and semester, so the exact file you need is never more than a search away.
            </p>
          </section>
          <section>
            <Users size={28} />
            <h2>How to navigate</h2>
            <p>
              Start from the <Link to="/library">library catalogue</Link> to search by keyword or course code, browse{' '}
              <Link to="/faculties">faculties and departments</Link> if you know your department, look a course up in
              the <Link to="/courses">course directory</Link>, or open a{' '}
              <Link to="/collections">curated collection</Link> when a librarian has already grouped the material for
              a course or an exam. Every faculty, department and course code also has its own permanent page.
            </p>
          </section>
          <section>
            <HelpCircle size={28} />
            <h2>Finding the material for a course</h2>
            <p>
              Search the catalogue with your course code, for example the code printed on your course handout. Results
              narrow by faculty, department, level, semester and material type. If a material is missing, broken or
              wrong, <Link to="/help">tell the library</Link> and it will be corrected.
            </p>
          </section>
          <section>
            <Landmark size={28} />
            <h2>Beyond the catalogue</h2>
            <p>
              The <Link to="/repository">institutional repository</Link> holds final-year projects, theses,
              dissertations, journal articles and conference papers produced in the university, while{' '}
              <Link to="/about">about the FUW E-Library</Link> explains how material is verified before it is
              published.
            </p>
          </section>
        </section>

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
            <div key={f.name} className={fx.fadeUp} style={staggerDelay(i, 50)}>
              <Link className="faculty" to={`/faculties/${facultySlug(f)}`}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <h3>{f.name}</h3>
                <p>{f.departments.length} accredited departments</p>
                <ArrowRight size={18} />
              </Link>
            </div>
          ))}
        </div>

        {/* Academic resource categories */}
        <div className="section-head" style={{ padding: '0 1rem', marginTop: '2rem' }}>
          <div>
            <p className="kicker">RESOURCE CATEGORIES</p>
            <h2>Academic materials by type</h2>
          </div>
          <Link to="/library" className="view-all-link">
            Search every material <ChevronRight size={17} />
          </Link>
        </div>
        <div className="dept-links-grid">
          {materialTypes.map((type) => (
            <Link
              key={type}
              to={`/library?type=${encodeURIComponent(type)}`}
              className="dept-link-item"
            >
              <span>
                {type === 'Lecture Note'
                  ? 'Lecture notes'
                  : type === 'Test Past Questions'
                    ? 'Test past questions'
                    : type === 'Exam Past Questions'
                      ? 'Exam past questions'
                      : `${type} from FUW students and faculty`}
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </Link>
          ))}
          <Link to="/library?type=Handouts" className="dept-link-item">
            <span>Lecture handouts and course summaries</span>
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
          <Link to="/collections" className="dept-link-item">
            <span>Librarian-curated collections</span>
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        </div>

        {/* College of Health Sciences Banner */}
        <section className="health">
          <p>COLLEGE OF HEALTH SCIENCES</p>
          <h2>Medical &amp; Health Sciences Division</h2>
          <div>
            Basic Medical Sciences · Allied Health Sciences · Clinical Sciences · Human Anatomy · Physiology · Medical Laboratory Science · Physiotherapy · Medicine &amp; Surgery
          </div>
          <Link to="/faculties#college-of-health-sciences" className="health-link">
            Browse the FUW medical and health sciences collection →
          </Link>
        </section>
      </main>
    </>
  );
}

// 2. LIBRARY PAGE (Search + Multi-level Filters + Sorting)
export function LibraryPage({ onReadOnline }: PublicPagesProps) {
  const store = useStore();
  const { isAuthenticated } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  // AI semantic search state (graceful: silently skipped when unavailable).
  const [aiResults, setAiResults] = useState<AiSearchResult[] | null>(null);
  const [aiSearching, setAiSearching] = useState(false);

  const queryQ = searchParams.get('q') || '';
  const queryFaculty = searchParams.get('faculty') || '';
  const queryDepartment = searchParams.get('department') || '';
  const queryLevel = searchParams.get('level') || '';
  const querySemester = searchParams.get('semester') || '';
  const queryType = searchParams.get('type') || '';
  const queryCourse = searchParams.get('course') || '';

  // Pull server-side bookmarks in for signed-in users browsing the catalogue.
  useEffect(() => {
    if (isAuthenticated) void store.pullBookmarksFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const [searchInput, setSearchInput] = useState(queryQ);

  // When a deep-link carries only a department, infer its faculty so the
  // cascading filter controls start unlocked at the right position.
  const inferredFaculty =
    queryFaculty ||
    (queryDepartment
      ? allDepartments().find((d) => d.name === queryDepartment)?.faculty || ''
      : '');

  const filters: FilterState = {
    faculty: inferredFaculty,
    department: queryDepartment,
    level: normalizeLevel(queryLevel),
    semester: querySemester,
    type: queryType,
    course: queryCourse
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
    analyticsTracker.trackMaterialSearch(searchInput.trim(), undefined, {
      faculty: queryFaculty || null,
      department: queryDepartment || null,
      level: queryLevel || null,
      course: queryCourse || null
    });
    logSearch(searchInput.trim(), undefined, {
      faculty: queryFaculty || undefined,
      department: queryDepartment || undefined,
      level: queryLevel || undefined,
      semester: querySemester || undefined,
      type: queryType || undefined
    });
  };

  // Run AI semantic search in the background whenever the keyword query
  // changes. Failures are silent — keyword results always remain visible.
  useEffect(() => {
    let cancelled = false;
    setAiResults(null);
    if (!queryQ || queryQ.trim().length < 3 || !isAuthenticated) return;
    setAiSearching(true);
    aiSearch(queryQ.trim(), {
      department: queryDepartment || undefined,
      level: queryLevel || undefined,
      courseCode: queryCourse || undefined
    })
      .then((res) => {
        if (!cancelled) setAiResults(res.results ?? []);
      })
      .catch(() => {
        if (!cancelled) setAiResults(null);
      })
      .finally(() => {
        if (!cancelled) setAiSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryQ, isAuthenticated, queryDepartment, queryLevel, queryCourse]);

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
          m.assignedDepartments?.some(
            (d) => d.name.toLowerCase().includes(q) || d.facultyName?.toLowerCase().includes(q)
          ) ||
          m.description.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Faculty filter - matches if primary faculty or any assigned department's faculty matches
      if (queryFaculty) {
        const facLower = queryFaculty.toLowerCase();
        const matchesFaculty =
          m.faculty.toLowerCase() === facLower ||
          m.assignedDepartments?.some((d) => d.facultyName && d.facultyName.toLowerCase() === facLower);
        if (!matchesFaculty) return false;
      }

      // Department filter - matches if primary department or any assigned department matches
      if (queryDepartment) {
        const deptLower = queryDepartment.toLowerCase();
        const matchesDept =
          m.department.toLowerCase() === deptLower ||
          m.assignedDepartments?.some(
            (d) => d.name.toLowerCase() === deptLower || (d.id && d.id.toLowerCase() === deptLower)
          );
        if (!matchesDept) return false;
      }

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

  // Re-key the results grid on every search/filter/sort change so the new
  // result set fades in cleanly (no flashing), with the sequence resetting.
  const resultsKey = `${queryQ}|${queryFaculty}|${queryDepartment}|${queryCourse}|${queryLevel}|${querySemester}|${queryType}|${sortBy}`;

  return (
    <main className="library public-container">
      <SEO
        path="/library"
        noindex={Boolean(queryQ) || activeFiltersCount > 0}
        title={queryQ ? `Search results for “${queryQ}”` : undefined}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Library', path: '/library' }
        ]}
      />
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Library', path: '/library' }
        ]}
      />

      <div className="library-header-row">
        <div>
          <h1>Explore the FUW digital library</h1>
          <p className="subtitle">
            Search verified lecture notes, test and exam past questions, handouts and final-year projects from every
            faculty and department of Federal University Wukari. Filter by faculty, department, course, level, semester
            or material type.
          </p>
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
        <div className={`active-filter-chips ${fx.fadeDown}`}>
          <span className="chips-label">Active Filters:</span>
          {queryQ && (
              <span
                key="chip-q"
                className={`filter-chip ${fx.fadeIn}`}
              >
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
              <span
                key="chip-faculty"
                className={`filter-chip ${fx.fadeIn}`}
              >
                Faculty: {queryFaculty}
                <button onClick={() => handleFilterChange({ ...filters, faculty: '' })}><X size={12} /></button>
              </span>
            )}
            {queryDepartment && (
              <span
                key="chip-dept"
                className={`filter-chip ${fx.fadeIn}`}
              >
                Dept: {queryDepartment}
                <button onClick={() => handleFilterChange({ ...filters, department: '' })}><X size={12} /></button>
              </span>
            )}
            {queryCourse && (
              <span
                key="chip-course"
                className={`filter-chip ${fx.fadeIn}`}
              >
                Course: {queryCourse}
                <button onClick={() => handleFilterChange({ ...filters, course: '' })}><X size={12} /></button>
              </span>
            )}
            {queryLevel && (
              <span
                key="chip-level"
                className={`filter-chip ${fx.fadeIn}`}
              >
                Level: {queryLevel}
                <button onClick={() => handleFilterChange({ ...filters, level: '' })}><X size={12} /></button>
              </span>
            )}
            {querySemester && (
              <span
                key="chip-semester"
                className={`filter-chip ${fx.fadeIn}`}
              >
                Semester: {querySemester}
                <button onClick={() => handleFilterChange({ ...filters, semester: '' })}><X size={12} /></button>
              </span>
            )}
            {queryType && (
              <span
                key="chip-type"
                className={`filter-chip ${fx.fadeIn}`}
              >
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

          {/* AI semantic matches (only for signed-in users with a text query) */}
          {queryQ && aiSearching && (
            <div className="ai-search-status">
              <Sparkles size={14} className="spin-icon" />
              Searching library materials semantically…
            </div>
          )}
          {queryQ && !aiSearching && aiResults && aiResults.length > 0 && (
            <div className="ai-search-section">
              <div className="ai-search-head">
                <Sparkles size={15} />
                <span>AI-powered semantic matches</span>
                <span className="ai-search-count">{aiResults.length} relevant file{aiResults.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="ai-search-list">
                {aiResults.map((r) => (
                  <Link key={r.id} to={`/materials/${r.id}`} className="ai-search-item">
                    <div className="ai-search-item-main">
                      <b>{r.title}</b>
                      <span className="ai-search-snippet">{r.matchedSnippet}…</span>
                    </div>
                    <div className="ai-search-item-side">
                      <span className="ai-relevance-pill">{Math.round(r.relevance * 100)}% match</span>
                      <span className="ai-search-course">{r.course_code}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

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
            <div
              key={resultsKey}
              className={`grid materials library-cards-grid ${fx.fadeUp}`}
            >
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
  const groups = groupedFaculties();
  const totalFaculty = catalogue.length;
  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);

  return (
    <main className="faculties public-container">
      <SEO
        path="/faculties"
        schemaItems={groups.flatMap((group) =>
          group.faculties.map((f) => ({ name: f.name, path: `/faculties/${facultySlug(f)}` }))
        )}
      />
      <Breadcrumbs trail={PUBLIC_ROUTES['/faculties'].breadcrumbs} />

      <h1>Faculties &amp; accredited departments</h1>
      <p className="subtitle">
        Federal University Wukari runs {totalFaculty} faculties and {departmentsCount} accredited departments, including
        the {groups.find((g) => g.college)?.faculties.length ?? 0} faculties of the College of Health Sciences. Every
        faculty and department has its own page listing its courses and the academic materials published for it.
      </p>

      <div className="info-grid">
        <section>
          <Building2 size={28} />
          <h2>How the directory works</h2>
          <p>
            Choose your faculty below to see its departments, or open a department to read its full curriculum by level
            and semester. Each page links straight to the lecture notes, handouts and past questions published for
            that department, filtered to exactly your course.
          </p>
        </section>
        <section>
          <GraduationCap size={28} />
          <h2>Not sure which faculty?</h2>
          <p>
            Look your course code up in the <Link to="/courses">FUW course directory</Link>. It shows the level,
            semester and the department that offers the course, then links to the published materials.
          </p>
        </section>
      </div>

      <div className="faculty-list">
        {groups.map((group) => (
          <div key={group.college ?? 'faculties'}>
            {group.college && (
              <h2 id="college-of-health-sciences" className="college-heading">
                <Building2 size={20} />
                {group.college}
                <small>Parent college · {group.faculties.length} faculties</small>
              </h2>
            )}
            {group.faculties.map((f) => (
              <section key={f.name} className={`faculty-section-card ${group.college ? 'in-college' : ''}`}>
                <h2>
                  <Link to={`/faculties/${facultySlug(f)}`}>{f.name}</Link>
                </h2>
                <p className="subtitle" style={{ margin: '0 0 10px' }}>
                  {f.departments.length} accredited department{f.departments.length === 1 ? '' : 's'} ·{' '}
                  <Link to={`/library?faculty=${encodeURIComponent(f.name)}`}>
                    Browse {shortFacultyName(f.name)} materials
                  </Link>
                </p>
                <div className="dept-links-grid">
                  {f.departments.map((d) => (
                    <Link
                      key={d.name}
                      to={`/departments/${departmentSlug(d)}`}
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
        ))}
      </div>
    </main>
  );
}

// 4. COURSES DIRECTORY PAGE
export function CoursesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [courseFilters, setCourseFilters] = useState<FilterState>({ ...EMPTY_FILTERS });
  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);
  // Courses published by administrators appear here too, merged into the
  // canonical (static) directory from the live database.
  const [liveRows, setLiveRows] = useState<any[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('../lib/liveCatalogue')
      .then((m) => m.getLiveCourseRows())
      .then((rows) => {
        if (!cancelled) setLiveRows(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const mergedCatalogue = useMemo(
    () => (liveRows ? mergeDbCourses(catalogue, liveRows) : catalogue),
    [liveRows]
  );

  // Build the full directory from the canonical catalogue. Level is already
  // stored as a plain number (100/200/300) — never multiply it again.
  const allCourses = useMemo(
    () =>
      mergedCatalogue.flatMap((f) =>
        f.departments.flatMap((d) => {
          // Respect the cascading faculty → department filters.
          if (courseFilters.faculty && f.name !== courseFilters.faculty) return [];
          if (courseFilters.department && d.name !== courseFilters.department) return [];
          return d.courses
            .map((c) => ({
              code: c.code,
              name: c.name,
              levelNumber: c.level,
              level: `${c.level} Level`,
              semester: c.semester,
              dept: d.name,
              faculty: f.name
            }))
            .filter((c) => !courseFilters.level || c.level === courseFilters.level)
            .filter((c) => !courseFilters.semester || c.semester === courseFilters.semester)
            // Course is always the final selection in the cascade.
            .filter((c) => !courseFilters.course || c.code === courseFilters.course);
        })
      ),
    [courseFilters, mergedCatalogue]
  );

  const filtered = allCourses.filter((c) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.dept.toLowerCase().includes(q)
    );
  });

  const hasCourseFilters = Boolean(
    courseFilters.faculty ||
      courseFilters.department ||
      courseFilters.level ||
      courseFilters.semester ||
      courseFilters.course
  );

  return (
    <main className="courses-page public-container">
      <SEO
        path="/courses"
        noindex={Boolean(searchTerm.trim()) || hasCourseFilters}
        title={searchTerm.trim() ? `Course search results for “${searchTerm.trim()}”` : undefined}
        breadcrumbs={PUBLIC_ROUTES['/courses'].breadcrumbs}
      />
      <Breadcrumbs trail={PUBLIC_ROUTES['/courses'].breadcrumbs} />

      <h1>Course curriculum directory</h1>
      <p className="subtitle">
        Search every FUW course code to see its title, department, level and semester, then open the course page for
        lecture notes, handouts and past questions. {allCourses.length} courses across{' '}
        {catalogue.length} faculties and {departmentsCount} departments.
      </p>

      {/* Modern course search bar */}
      <div className="course-search-bar">
        <Search size={18} className="course-search-icon" />
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search courses..."
          aria-label="Search courses"
        />
        {searchTerm && (
          <button
            type="button"
            className="course-search-clear"
            onClick={() => setSearchTerm('')}
            aria-label="Clear course search"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Cascading filters — Faculty → Department → Level → Semester → Course */}
      <CatalogueFilters
        filters={courseFilters}
        onChange={setCourseFilters}
        fields={['faculty', 'department', 'level', 'semester', 'course']}
      />
      {(courseFilters.faculty || courseFilters.department || courseFilters.level || courseFilters.semester || courseFilters.course) && (
        <button type="button" className="reset-link" style={{ margin: '10px 0 0' }} onClick={() => setCourseFilters({ ...EMPTY_FILTERS })}>
          Reset filters
        </button>
      )}

      <p className="courses-result-line">
        Showing <b>{filtered.length}</b> of {allCourses.length} course{allCourses.length !== 1 ? 's' : ''}
      </p>

      <div className="table">
        <div className="tr head courses-table-grid">
          <span>Course Code</span>
          <span>Course Name</span>
          <span>Department</span>
          <span>Level</span>
          <span>Semester</span>
          <span>Materials</span>
        </div>

        {filtered.length === 0 && (
          <div className="tr empty-state-row">
            <span className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem 1rem' }}>
              <b>No courses match "{searchTerm}".</b>
              <br />
              Try a different course code (e.g. BIO101C), a title keyword such as "General Biology",
              or adjust the filters above.
            </span>
          </div>
        )}

        {filtered.map((c, i) => (
          <div className="tr courses-table-grid" key={`${c.code}-${c.dept}-${i}`}>
            <span>
              <Link to={`/courses/${c.code.toLowerCase()}`} className="course-code-highlight">
                {c.code}
              </Link>
            </span>
            <span>
              <Link to={`/courses/${c.code.toLowerCase()}`}>{c.name}</Link>
            </span>
            <span>
              <Link to={`/departments/${departmentSlug({ name: c.dept })}`}>{c.dept}</Link>
            </span>
            <span>{c.level}</span>
            <span>{c.semester}</span>
            <span>
              <Link
                to={`/library?faculty=${encodeURIComponent(c.faculty)}&department=${encodeURIComponent(c.dept)}&level=${encodeURIComponent(c.level)}&semester=${encodeURIComponent(c.semester)}&q=${encodeURIComponent(c.code)}`}
                className="table-action-btn"
              >
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
  const { isAuthenticated, profile, isAdmin } = useAuth();
  // Resolve strictly by id. Falling back to "the first approved material"
  // would serve the wrong document under someone else's URL, which creates
  // duplicate content and a soft-404 for the crawlers.
  const material = id ? store.getMaterialById(id) : undefined;
  const [showCitation, setShowCitation] = useState(false);
  const [showReadingListPicker, setShowReadingListPicker] = useState(false);
  const [gate, setGate] = useState<{ reason: BlockReason; message: string } | null>(null);

  useEffect(() => {
    if (material) {
      analyticsTracker.trackMaterialView(material.id, material.title, material.type);
      analyticsTracker.trackSearchResultClick(material.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material?.id]);

  if (!material) {
    return (
      <main className="public-container">
        <SEO title="Material not found" path={`/materials/${id ?? ''}`} noindex />
        <div className="empty-state" style={{ padding: '4rem 1rem' }}>
          <BookOpen size={48} />
          <h1>Material not found</h1>
          <p>
            This material is not available in the FUW E-Library. It may have been replaced or removed by the library.
          </p>
          <Link to="/library" className="primary">
            Search the library catalogue
          </Link>
        </div>
      </main>
    );
  }

  const isSaved = store.isBookmarked(material.id);

  // Same rule as the portal reader: the server decides, then a short-lived
  // signed URL is minted. The stored public fileUrl is never used as a fallback.
  const handleDownload = async () => {
    const decision = await checkDocumentAccess({
      authenticated: isAuthenticated,
      verificationStatus: profile?.verificationStatus,
      isAdmin
    });
    if (!decision.allowed && decision.reason) {
      setGate({ reason: decision.reason, message: decision.message });
      return;
    }
    const url = await getSecureFileUrl(material);
    if (!url) {
      setGate({ reason: 'no-plan', message: 'This file could not be opened. Please try again.' });
      return;
    }
    store.recordDownload(material.id);
    analyticsTracker.trackMaterialDownload(material.id, material.title);
    toast(`Downloading ${material.fileName}`);
    const link = document.createElement('a');
    link.href = url;
    link.download = material.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleToggleSave = () => {
    const saved = store.toggleBookmark(material.id);
    analyticsTracker.trackBookmarkToggle(material.id, saved);
    toast(saved ? 'Saved to bookmarks' : 'Removed from bookmarks', 'info');
  };

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    toast('Direct link copied to clipboard!');
  };

  return (
    <main className="detail public-container">
      {gate && (
        <PremiumGateModal open reason={gate.reason} message={gate.message} onClose={() => setGate(null)} />
      )}
      <SEO
        {...materialMeta({
          id: material.id,
          title: material.title,
          type: material.type,
          course: material.course,
          department: material.department,
          faculty: material.faculty,
          description: material.description,
          level: material.level,
          semester: material.semester,
          createdAt: material.createdAt
        })}
      />
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/home' },
          { name: 'Library', path: '/library' },
          { name: material.course, path: `/library?q=${encodeURIComponent(material.course)}` },
          { name: material.title, path: `/materials/${material.id}` }
        ]}
      />

      <div className={`detail-grid ${fx.page}`} key={material?.id}>
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
            <button onClick={() => setShowReadingListPicker(true)}>
              <Bookmark size={16} /> Add to Reading List
            </button>
            <button onClick={() => setShowCitation(true)}>
              <CheckCircle2 size={16} /> Cite
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

            <dt>{material.assignedDepartments && material.assignedDepartments.length > 1 ? 'Assigned Departments' : 'Department'}</dt>
            <dd>
              {material.assignedDepartments && material.assignedDepartments.length > 1 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                  {material.assignedDepartments.map((d, idx) => (
                    <span key={d.id || idx} className="filter-chip" style={{ fontSize: '12px' }}>
                      {d.name} {d.facultyName && d.facultyName !== material.faculty ? `(${d.facultyName.replace(/^Faculty of\s+/i, '')})` : ''}
                    </span>
                  ))}
                </div>
              ) : (
                material.department
              )}
            </dd>

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

      {showCitation && <CitationModal material={material} onClose={() => setShowCitation(false)} />}
      {showReadingListPicker && (
        <ReadingListPicker
          materialId={material.id}
          resourceTitle={material.title}
          onClose={() => setShowReadingListPicker(false)}
        />
      )}
    </main>
  );
}

// 6. ABOUT & CONTACT PAGES
export function AboutPage({ contact = false }: { contact?: boolean }) {
  const departmentsCount = catalogue.reduce((acc, f) => acc + f.departments.length, 0);

  return (
    <main className="info public-container">
      <SEO
        path={contact ? '/contact' : '/about'}
        breadcrumbs={PUBLIC_ROUTES[contact ? '/contact' : '/about'].breadcrumbs}
      />
      <Breadcrumbs trail={PUBLIC_ROUTES[contact ? '/contact' : '/about'].breadcrumbs} />
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

// Shared password input with a show/hide visibility toggle.
function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'current-password',
  disabled
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="auth-field-label">
      <span>{label}</span>
      <div className="password-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required
        />
        <button
          type="button"
          className="password-toggle-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}

// 7. AUTH PAGES (Supabase username + password authentication)
export function LoginPage({
  register: initialRegister = false,
  forgot: initialForgot = false
}: {
  register?: boolean;
  forgot?: boolean;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    signInWithUsername,
    signUpWithPassword,
    completeProfile,
    sendPasswordReset,
    signOut,
    isAuthenticated,
    isProfileComplete,
    profile,
    mfaRequired,
    mfaVerifiedFactor,
    clearMfaRequired
  } = useAuth();

  const [isRegister, setIsRegister] = useState(initialRegister);
  const [showForgot, setShowForgot] = useState(initialForgot);
  const [step, setStep] = useState<'credentials' | 'otp' | 'profile'>('credentials');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Second-factor (Authenticator App code) challenge state
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // Credential fields
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Forgot-password recovery field (email or username)
  const [forgotEmail, setForgotEmail] = useState('');
  const [accountNotFound, setAccountNotFound] = useState(false);

  // Academic fields for the post-signup profile completion step
  const [profileData, setProfileData] = useState({
    fullName: '',
    matricNumber: '',
    faculty: catalogue[0]?.name || '',
    department: catalogue[0]?.departments[0]?.name || '',
    level: '100 Level',
    gender: '',
    phoneNumber: '',
    bio: ''
  });

  // Calculate available departments and levels dynamically
  const currentFaculty = facultyByName(profileData.faculty) || catalogue[0];
  const currentDepartment = departmentByName(profileData.faculty, profileData.department) || currentFaculty.departments[0];
  const availableLevels = levelsFor(currentDepartment?.duration || 4);

  // If already authenticated with a completed profile, redirect to the right
  // dashboard. Incomplete profiles stay here so the student finishes signup.
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      (window.location.hash.includes('type=recovery') ||
        new URLSearchParams(window.location.search).get('type') === 'recovery')
    ) {
      navigate('/reset-password', { replace: true });
      return;
    }
    if (isAuthenticated && isProfileComplete && step !== 'profile' && !mfaRequired) {
      if (profile?.role === 'super_admin') {
        navigate('/super', { replace: true });
      } else if (profile?.role === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/student', { replace: true });
      }
    }
  }, [isAuthenticated, isProfileComplete, profile, navigate, step, mfaRequired]);

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

  /** Client-side registration validation — clear, user-friendly messages. */
  const validateRegistration = (): string | null => {
    if (!fullName.trim()) return 'Full name is required.';
    const uname = normalizeUsername(username);
    if (!USERNAME_PATTERN.test(uname)) {
      return 'Username must be 3–20 characters using only lowercase letters, numbers, dots, dashes, or underscores.';
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return 'Please enter a valid email address.';
    }
    if (!profileData.matricNumber.trim()) {
      return 'Matriculation Number is required.';
    }
    const matric = profileData.matricNumber.trim();
    if (matric.length < 4 || !/[A-Z]/.test(matric) || !/[0-9]/.test(matric)) {
      return 'Please enter a valid matriculation number (e.g. CIS/CSC/20/001).';
    }
    if (!profileData.gender || (profileData.gender !== 'Male' && profileData.gender !== 'Female')) {
      return 'Please select your gender (Male or Female).';
    }
    if (!profileData.phoneNumber.trim()) {
      return 'Phone Number is required.';
    }
    const phone = profileData.phoneNumber.trim();
    const validPhone =
      /^\+?[0-9\s()-]{7,20}$/.test(phone) &&
      (phone.match(/\d/g) || []).length >= 8 &&
      (phone.match(/\d/g) || []).length <= 15;
    if (!validPhone) {
      return 'Please enter a valid phone number (8–15 digits).';
    }
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) return passwordError;
    if (password !== confirmPassword) return 'Passwords do not match.';
    return null;
  };

  // Login with username or email + password
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!username.trim() || !password) {
      setErrorMsg('Please enter your email or username and password.');
      return;
    }

    setBusy(true);
    const res = await signInWithUsername(username, password);
    setBusy(false);

    if (res.error) {
      setErrorMsg(friendlyError(res.error, 'Unable to complete the request. Please try again.'));
      return;
    }

    // If the account has a second factor (Authenticator App) enrolled, the
    // user must complete the code challenge before entering the portal.
    if (res.mfaRequired) {
      setOtp('');
      setOtpError(null);
      setStep('otp');
      return;
    }

    toast('Welcome back to FUW Campus Hub!', 'success');
    if (res.role === 'super_admin') {
      navigate('/super');
    } else if (res.role === 'admin') {
      navigate('/admin');
    } else {
      navigate('/student');
    }
  };

  // Complete the second-factor (Authenticator App) challenge for MFA-pending logins.
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setOtpError(null);
    if (!mfaVerifiedFactor) {
      setOtpError('No security factor is available. Please go back and try again.');
      return;
    }
    if (otp.trim().length !== 6) {
      setOtpError('Enter the 6-digit code from your Authenticator App.');
      return;
    }
    setOtpBusy(true);
    try {
      await aal2LoginChallenge(mfaVerifiedFactor.id, otp.trim());
      clearMfaRequired();
      setOtp('');
      toast('Identity verified. Welcome back!', 'success');
      if (profile?.role === 'super_admin') navigate('/super');
      else if (profile?.role === 'admin') navigate('/admin');
      else navigate('/student');
    } catch (err: any) {
      setOtpError(err?.message || 'That code was not accepted. Please check your Authenticator App and try again.');
    } finally {
      setOtpBusy(false);
    }
  };

  // Sign in with a registered passkey (passwordless, WebAuthn).
  const handlePasskeySignIn = async () => {
    setErrorMsg(null);
    setPasskeyBusy(true);
    try {
      await signInWithPasskey();
      toast('Signed in with your passkey!', 'success');
      const role = profile?.role;
      if (role === 'super_admin') navigate('/super');
      else if (role === 'admin') navigate('/admin');
      else navigate('/student');
    } catch (err: any) {
      setErrorMsg(err?.message || 'The secure login could not be completed. Please use your password instead.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  // Send a password reset email (username or registered email accepted).
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setAccountNotFound(false);

    if (!forgotEmail.trim()) {
      setErrorMsg('Please enter your registered email address or username.');
      return;
    }

    setBusy(true);
    const res = await sendPasswordReset(forgotEmail);
    setBusy(false);

    if (res.error) {
      if (res.notFound) {
        setAccountNotFound(true);
      }
      setErrorMsg(res.error.message);
      return;
    }

    setAccountNotFound(false);
    setForgotEmail('');
    setSuccessMsg(
      'A password reset link has been sent to your email address. Please check your inbox and spam folder.'
    );
  };

  // Register a new account with email + password (username is stored on the
  // profile and used for all future sign-ins).
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const validationError = validateRegistration();
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setBusy(true);
    const res = await signUpWithPassword({ fullName, username, email, password });
    setBusy(false);

    if (res.error) {
      setErrorMsg(friendlyError(res.error, 'Unable to complete the request. Please try again.'));
      return;
    }

    if (res.needsEmailConfirmation) {
      setIsRegister(false);
      setPassword('');
      setConfirmPassword('');
      setSuccessMsg(
        'Account created! Check your email inbox for the confirmation link, then log in with your username and password.'
      );
      toast('Account created. Confirm your email to log in.', 'success');
      return;
    }

    toast('Account created successfully! Welcome to FUW Campus Hub.', 'success');
    setProfileData((prev) => ({ ...prev, fullName: fullName.trim() }));
    setStep('profile');
  };

  // Final step: complete student academic profile
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
    if (!profileData.gender || (profileData.gender !== 'Male' && profileData.gender !== 'Female')) {
      setErrorMsg('Please select your gender (Male or Female).');
      return;
    }
    if (!profileData.phoneNumber.trim()) {
      setErrorMsg('Phone Number is required.');
      return;
    }
    const phone = profileData.phoneNumber.trim();
    const validPhone =
      /^\+?[0-9\s()-]{7,20}$/.test(phone) &&
      (phone.match(/\d/g) || []).length >= 8 &&
      (phone.match(/\d/g) || []).length <= 15;
    if (!validPhone) {
      setErrorMsg('Please enter a valid phone number (8-15 digits).');
      return;
    }

    setBusy(true);
    const res = await completeProfile({
      fullName: profileData.fullName,
      matricNumber: profileData.matricNumber,
      faculty: profileData.faculty,
      department: profileData.department,
      level: profileData.level,
      gender: profileData.gender,
      phoneNumber: profileData.phoneNumber.trim(),
      bio: profileData.bio
    });
    setBusy(false);

    if (res.error) {
      setErrorMsg(friendlyError(res.error, 'Unable to complete the request. Please try again.'));
    } else {
      toast('Student profile created successfully! Welcome to FUW Campus Hub.', 'success');
      navigate('/student');
    }
  };

  return (
    <main className="auth">
      <SEO
        title={isRegister ? 'Register' : showForgot ? 'Forgot Password' : 'Login'}
        description={isRegister ? 'Create a student account on the FUW Campus Hub to access university services, academic materials, and campus marketplace.' : showForgot ? 'Reset your FUW Campus Hub password and regain access to your account.' : 'Sign in to the FUW Campus Hub to access student services and materials.'}
        path={isRegister ? '/register' : showForgot ? '/forgot-password' : '/login'}
        noindex
      />
      <div className="auth-panel">
        <div className="brand">
          <Logo size={36} />
          <b>FUW</b> Campus Hub
        </div>

        {/* STEP 1: Credentials (login) */}
        {step === 'credentials' && !isRegister && !showForgot && (
          <>
            <p className="kicker">SECURE STUDENT ACCESS</p>
            <h1>Sign in to Campus Hub</h1>
            <p>Sign in with your email or username and password.</p>

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

            <form onSubmit={handleLogin} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Email or username</span>
                <input
                  required
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="Enter your email or username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="Your password"
                disabled={busy}
              />

              <div className="forgot-row">
                <button
                  type="button"
                  className="auth-link-btn forgot-link"
                  onClick={() => {
                    setShowForgot(true);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                >
                  Forgot password?
                </button>
              </div>

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Signing in…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Login
                  </>
                )}
              </button>
            </form>

            <div className="auth-divider"><span>or</span></div>
            <button
              type="button"
              className="passkey-signin-btn"
              onClick={handlePasskeySignIn}
              disabled={busy || passkeyBusy}
            >
              {passkeyBusy ? (
                <>
                  <RefreshCw size={16} className="spin-icon" /> Waiting for passkey…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z" />
                    <path d="M8 16v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3" />
                  </svg>
                  Sign in with Passkey
                </>
              )}
            </button>

            <div className="auth-toggle-row">
              <p>
                New student to FUW Campus Hub?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setIsRegister(true);
                    setShowForgot(false);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                >
                  Create an account
                </button>
              </p>
            </div>
          </>
        )}

        {/* STEP 1c: Two-Factor (Authenticator App) challenge */}
        {step === 'otp' && (
          <>
            <p className="kicker">TWO-FACTOR VERIFICATION</p>
            <h1>Enter your security code</h1>
            <p>Open your Authenticator App and enter the 6-digit code to verify it's really you.</p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Authenticator App code</span>
                <div className="mfa-login-input-wrap">
                  <input
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    className="mfa-login-input"
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setOtpError(null);
                    }}
                    disabled={otpBusy}
                    autoFocus
                  />
                </div>
              </label>

              {otpError && (
                <div className="form-feedback-box error">
                  <AlertCircle size={17} />
                  <p>{otpError}</p>
                </div>
              )}

              <button type="submit" className="primary auth-submit-btn" disabled={otpBusy || otp.trim().length !== 6}>
                {otpBusy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Verify & Continue
                  </>
                )}
              </button>
            </form>

            <div className="auth-toggle-row">
              <p>
                Not you?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={async () => {
                    await signOut().catch(() => {});
                    clearMfaRequired();
                    setOtp('');
                    setOtpError(null);
                    setStep('credentials');
                  }}
                >
                  Use a different account
                </button>
              </p>
            </div>
          </>
        )}

        {/* STEP 1b: Forgot Password */}
        {step === 'credentials' && !isRegister && showForgot && (
          <>
            <p className="kicker">ACCOUNT RECOVERY</p>
            <h1>Reset your password</h1>
            <p>Enter the email address or username tied to your account and we will send you a reset link.</p>

            {errorMsg && (
              <div className="form-feedback-box error" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={17} />
                  <p>{errorMsg}</p>
                </div>
                {accountNotFound && (
                  <button
                    type="button"
                    className="primary auth-submit-btn"
                    style={{ alignSelf: 'flex-start', marginTop: '4px', padding: '8px 16px', fontSize: '13px' }}
                    onClick={() => {
                      setShowForgot(false);
                      setIsRegister(true);
                      setAccountNotFound(false);
                      setErrorMsg(null);
                      if (forgotEmail.includes('@')) {
                        setEmail(forgotEmail);
                      } else {
                        setUsername(forgotEmail);
                      }
                    }}
                  >
                    Create Account
                  </button>
                )}
              </div>
            )}

            {successMsg && (
              <div className="form-feedback-box success">
                <CheckCircle2 size={17} />
                <p>{successMsg}</p>
              </div>
            )}

            <form onSubmit={handleForgotPassword} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Email or Username</span>
                <input
                  required
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="email"
                  placeholder="your.name@fuw.edu.ng or your.username"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Sending reset link…
                  </>
                ) : (
                  <>
                    <Mail size={16} /> Send Reset Link
                  </>
                )}
              </button>
            </form>

            <div className="auth-toggle-row">
              <p>
                Remembered your password?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setShowForgot(false);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                >
                  Back to sign in
                </button>
              </p>
            </div>
          </>
        )}

        {step === 'credentials' && isRegister && (
          <>
            <p className="kicker">STUDENT REGISTRATION</p>
            <h1>Create your account</h1>
            <p>Register with your details. You will sign in with your username and password.</p>

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

            <form onSubmit={handleRegister} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Full Name</span>
                <input
                  required
                  type="text"
                  placeholder="e.g. Aisha Bello"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <label className="auth-field-label">
                <span>Username</span>
                <input
                  required
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  minLength={3}
                  maxLength={20}
                  pattern="[a-z0-9._\-]+"
                  title="3–20 characters: lowercase letters, numbers, dots, dashes, or underscores"
                  placeholder="e.g. aisha.bello"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  disabled={busy}
                />
              </label>

              <label className="auth-field-label">
                <span>Email Address</span>
                <input
                  required
                  type="email"
                  placeholder="e.g. yourname@fuw.edu.ng or personal email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>

              <label className="auth-field-label">
                <span>Matriculation Number *</span>
                <input
                  required
                  type="text"
                  autoCapitalize="characters"
                  placeholder="e.g. CIS/CSC/20/001"
                  value={profileData.matricNumber}
                  onChange={(e) => setProfileData({ ...profileData, matricNumber: e.target.value.toUpperCase() })}
                  disabled={busy}
                />
              </label>

              <div className="auth-field-row">
                <label className="auth-field-label">
                  <span>Gender *</span>
                  <select
                    required
                    value={profileData.gender}
                    onChange={(e) => setProfileData({ ...profileData, gender: e.target.value })}
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Select gender…
                    </option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </label>

                <label className="auth-field-label">
                  <span>Phone Number *</span>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="e.g. 0803 123 4567"
                    value={profileData.phoneNumber}
                    onChange={(e) => setProfileData({ ...profileData, phoneNumber: e.target.value })}
                    disabled={busy}
                  />
                </label>
              </div>

              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="At least 8 characters (upper + lower + number + special)"
                autoComplete="new-password"
                disabled={busy}
              />
              {isRegister && <p className="mac-hint">{PASSWORD_REQUIREMENTS_TEXT}</p>}

              <PasswordField
                label="Confirm Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                disabled={busy}
              />

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Creating account…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> Create Account
                  </>
                )}
              </button>
            </form>

            <div className="auth-toggle-row">
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setIsRegister(false);
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                >
                  Log in
                </button>
              </p>
            </div>
          </>
        )}

        {/* STEP 2: Complete Student Profile */}
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
                <span>Registered Username & Email</span>
                <div className="input-with-badge">
                  <input
                    type="text"
                    value={`${normalizeUsername(username)} · ${email}`}
                    readOnly
                    className="input-readonly"
                    title="Verified during registration"
                  />
                  <span className="readonly-tag">
                    <ShieldCheck size={12} /> Verified
                  </span>
                </div>
              </label>

              <label className="auth-field-label">
                <span>Registration Details (Collected Earlier)</span>
                <div className="input-with-badge">
                  <input
                    type="text"
                    value={`${profileData.matricNumber.toUpperCase() || 'Not provided'} · ${profileData.gender || 'N/A'} · ${profileData.phoneNumber || 'N/A'}`}
                    readOnly
                    className="input-readonly"
                  />
                  <span className="readonly-tag">
                    <ShieldCheck size={12} /> Verified
                  </span>
                </div>
              </label>

              <label className="auth-field-label">
                <span>Faculty *</span>
                <select
                  value={profileData.faculty}
                  onChange={(e) => handleFacultySelect(e.target.value)}
                  disabled={busy}
                  required
                >
                  {groupedFaculties().map((group) =>
                    group.college ? (
                      <optgroup key={group.college} label={group.college}>
                        {group.faculties.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      group.faculties.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name}
                        </option>
                      ))
                    )
                  )}
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

// 8. PASSWORD RESET PAGE (landing page for the Supabase recovery email link).
// The recovery link carries a one-time token in the URL hash which supabase-js
// detects automatically (detectSessionInUrl). Once the session is live we let
// the student set a fresh password, then clear the session and return to login.
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isLoading, resetPassword, signOut } = useAuth();

  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Check URL parameters for explicit errors (e.g. otp_expired) or PKCE code,
  // or wait for recovery session hydration.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const searchParams = new URLSearchParams(window.location.search);
      const err =
        searchParams.get('error_description') ||
        hashParams.get('error_description') ||
        searchParams.get('error') ||
        hashParams.get('error');

      if (err) {
        setLinkError(decodeURIComponent(err.replace(/\+/g, ' ')));
        setChecked(true);
        return;
      }

      // If PKCE code is present, exchange it for session
      const code = searchParams.get('code');
      if (code && !user && supabase) {
        supabase.auth.exchangeCodeForSession(code).then(({ error }: { error: any }) => {
          if (error) {
            setLinkError(error.message);
          }
          setChecked(true);
        }).catch((e: any) => {
          setLinkError(e?.message || 'Failed to verify reset link.');
          setChecked(true);
        });
        return;
      }
    }

    if (user) {
      setChecked(true);
      return;
    }

    if (!isLoading) {
      const t = window.setTimeout(() => setChecked(true), 1200);
      return () => window.clearTimeout(t);
    }
  }, [user, isLoading]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      setErrorMsg(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setBusy(true);
    const res = await resetPassword(password);
    if (res.error) {
      setBusy(false);
      setErrorMsg(friendlyError(res.error, 'Unable to complete the request. Please try again.'));
      return;
    }

    // Clear the temporary recovery session so the next login uses the new password.
    await signOut();
    setBusy(false);
    setPassword('');
    setConfirmPassword('');
    toast('Password updated! Sign in with your new password.', 'success');
    navigate('/login');
  };

  const invalidLink = checked && (!user || !!linkError);

  return (
    <MacPage pill="ACCOUNT RECOVERY">
      <SEO
        title="Reset Password"
        description="Set a new password for your FUW Campus Hub account."
        path="/reset-password"
        noindex
      />

      {invalidLink ? (
        <MacCard>
          <div className="mac-view" key="reset-invalid">
            <div className="mac-card-header">
              <h2 className="mac-card-title">Link is invalid or expired</h2>
              <p className="mac-card-subtitle">
                {linkError || 'This password reset link is no longer valid. Request a fresh one to continue.'}
              </p>
            </div>
            <div className="mac-empty">
              <HelpCircle size={30} />
              <b>We could not verify this reset link.</b>
              <span>{linkError || 'Reset links expire shortly after being sent.'}</span>
            </div>
            <Link to="/forgot-password" className="mac-btn mac-btn-primary">
              Request a new reset link <ArrowRight size={17} aria-hidden />
            </Link>
          </div>
        </MacCard>
      ) : !checked ? (
        <MacCard>
          <div className="mac-view" key="reset-checking">
            <div className="mac-card-header">
              <h2 className="mac-card-title">Verifying your link</h2>
              <p className="mac-card-subtitle">
                Please wait a moment while we confirm your reset link.
              </p>
            </div>
            <div className="mac-empty">
              <RefreshCw size={30} className="spin-icon" />
              <b>Checking your reset link…</b>
            </div>
          </div>
        </MacCard>
      ) : (
        <MacCard>
          <div className="mac-view" key="reset-form">
            <div className="mac-card-header">
              <h2 className="mac-card-title">Choose a new password</h2>
              <p className="mac-card-subtitle">
                Set a strong new password for your FUW Campus Hub account.
              </p>
            </div>

            {errorMsg && <MacBanner type="error">{errorMsg}</MacBanner>}
            {successMsg && <MacBanner type="success">{successMsg}</MacBanner>}

            <form onSubmit={handleResetPassword} className="mac-form" noValidate>
              <PasswordControl
                label="New Password"
                value={password}
                onChange={setPassword}
                placeholder="At least 8 characters (upper + lower + number + special)"
                autoComplete="new-password"
                disabled={busy}
              />

              <PasswordControl
                label="Confirm New Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                disabled={busy}
              />

              <button type="submit" className="mac-btn mac-btn-primary" disabled={busy}>
                {busy ? (
                  <>
                    <RefreshCw size={17} className="spin-icon" /> Saving new password…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} aria-hidden /> Update Password
                  </>
                )}
              </button>
            </form>
          </div>
        </MacCard>
      )}

      <button type="button" className="mac-btn mac-btn-ghost" onClick={() => navigate('/login')}>
        <ArrowLeft size={16} aria-hidden /> Back to sign in
      </button>
    </MacPage>
  );
}

// 9. ADMIN LOGIN GATEWAY (Supabase username + password authentication + role authorization)
export function AdminLoginPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signInWithUsername, signOut, profile, mfaVerifiedFactor, clearMfaRequired } = useAuth();

  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [adminUsername, setAdminUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Second-factor (Authenticator App code) challenge state
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const handleAdminSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!adminUsername.trim() || !password) {
      setErrorMsg('Please enter your admin email or username and password.');
      return;
    }

    setBusy(true);
    const res = await signInWithUsername(adminUsername, password);
    setBusy(false);

    if (res.error) {
      setErrorMsg(friendlyError(res.error, 'Unable to complete the request. Please try again.'));
      return;
    }

    // MFA (Authenticator App) challenge first when the admin has one.
    if (res.mfaRequired) {
      setOtp('');
      setOtpError(null);
      setStep('otp');
      return;
    }

    if (res.role === 'super_admin') {
      toast('Super Administrator access granted', 'success');
      navigate('/super');
    } else if (res.role === 'admin') {
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
  };

  const handleAdminVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setOtpError(null);
    if (!mfaVerifiedFactor) {
      setOtpError('No security factor is available. Please go back and try again.');
      return;
    }
    if (otp.trim().length !== 6) {
      setOtpError('Enter the 6-digit code from your Authenticator App.');
      return;
    }
    setOtpBusy(true);
    try {
      await aal2LoginChallenge(mfaVerifiedFactor.id, otp.trim());
      clearMfaRequired();
      setOtp('');
      if (profile?.role === 'super_admin') {
        toast('Super Administrator access granted', 'success');
        navigate('/super');
      } else {
        toast('Authorized Administrator access granted', 'success');
        navigate('/admin');
      }
    } catch (err: any) {
      setOtpError(err?.message || 'That code was not accepted. Please check your Authenticator App and try again.');
    } finally {
      setOtpBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-panel admin-auth-panel">
        <div className="brand">
          <Logo size={36} />
          <b>FUW</b> Administration
        </div>

        {step === 'credentials' && (
          <>
            <p className="kicker">STAFF & LIBRARIAN GATEWAY</p>
            <h1>Admin sign in</h1>
            <p>Sign in with your administrator email or username and password to review submissions and manage library catalogues.</p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleAdminSignIn} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Admin email or username</span>
                <input
                  required
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="e.g. library.admin or admin@fuwukari.edu.ng"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value.toLowerCase())}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="Admin password"
                disabled={busy}
              />

              <button type="submit" className="primary auth-submit-btn" disabled={busy}>
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

              <p className="auth-back-link">
                <Link to="/home">← Return to Public Library</Link>
              </p>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="kicker">TWO-FACTOR VERIFICATION</p>
            <h1>Enter your security code</h1>
            <p>Open your Authenticator App and enter the 6-digit code to verify it's really you.</p>

            {errorMsg && (
              <div className="form-feedback-box error">
                <AlertCircle size={17} />
                <p>{errorMsg}</p>
              </div>
            )}

            <form onSubmit={handleAdminVerifyOtp} className="auth-flow-form">
              <label className="auth-field-label">
                <span>Authenticator App code</span>
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  className="mfa-login-input"
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setOtpError(null);
                  }}
                  disabled={otpBusy}
                  autoFocus
                />
              </label>

              {otpError && (
                <div className="form-feedback-box error">
                  <AlertCircle size={17} />
                  <p>{otpError}</p>
                </div>
              )}

              <button type="submit" className="primary auth-submit-btn" disabled={otpBusy || otp.trim().length !== 6}>
                {otpBusy ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Verify & Continue
                  </>
                )}
              </button>

              <p className="auth-back-link">
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={async () => {
                    await signOut().catch(() => {});
                    clearMfaRequired();
                    setOtp('');
                    setOtpError(null);
                    setStep('credentials');
                  }}
                >
                  ← Use a different account
                </button>
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
