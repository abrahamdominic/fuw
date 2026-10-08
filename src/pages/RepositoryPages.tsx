import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BookOpen, Search, Filter, GraduationCap, FileText, Landmark, Award,
  ArrowLeft, Download, Eye, CheckCircle2, Clock, Building2, Bookmark,
  Quote, Loader2, Plus, Upload
} from 'lucide-react';
import {
  searchResearchItems,
  fetchResearchItem,
  submitResearchItem,
  incrementResearchView,
  incrementResearchDownload,
  getResearchFileUrl,
  RESEARCH_TYPE_LABELS,
  ACCESS_LABELS,
  ResearchItem,
  ResearchItemType
} from '../lib/repository';
import { getAllDepartmentsForRepository, repositoryFaculties } from '../lib/repositoryCatalogue';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/AuthContext';
import { checkDocumentAccess, type BlockReason } from '../lib/premium';
import { PremiumGateModal } from '../components/PremiumGateModal';
import { CitationModal } from '../components/CitationModal';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { PUBLIC_ROUTES } from '../lib/seo/routes';
import { repositoryMeta } from '../lib/seo/dynamic';

export const REPOSITORY_TYPES: { value: ResearchItemType; label: string }[] = [
  { value: 'final_year_project', label: 'Final Year Project' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'dissertation', label: 'Dissertation' },
  { value: 'research_paper', label: 'Research Paper' },
  { value: 'journal_article', label: 'Journal Article' },
  { value: 'conference_paper', label: 'Conference Paper' },
  { value: 'technical_report', label: 'Technical Report' },
  { value: 'institutional_publication', label: 'Institutional Publication' },
  { value: 'dataset', label: 'Research Dataset' },
  { value: 'seminar_paper', label: 'Seminar Paper' }
];

async function downloadFileFromUrl(url: string, filename: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to download file from server.');
  const blob = await resp.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename.trim().replace(/[/\\?%*:|"<>]/g, '_') || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(blobUrl);
}

export function RepositoryPage() {
  const navigate = useNavigate();
  const { isAuthenticated, profile, isAdmin } = useAuth();
  const [gate, setGate] = useState<{ reason: BlockReason; message: string } | null>(null);
  const { toast } = useToast();
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [stats, setStats] = useState<{ total: number; projectCount: number; thesisCount: number; paperCount: number }>({ total: 0, projectCount: 0, thesisCount: 0, paperCount: 0 });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { loadItems(); }, [debouncedQuery, typeFilter, deptFilter, yearFilter]);

  const loadItems = async () => {
    setLoading(true);
    try {
      const { items } = await searchResearchItems({
        query: debouncedQuery,
        type: typeFilter || undefined,
        departmentId: deptFilter || undefined,
        year: yearFilter || undefined
      });
      setItems(items);
      setStats({
        total: items.length,
        projectCount: items.filter((i) => i.research_type === 'final_year_project').length,
        thesisCount: items.filter((i) => i.research_type === 'thesis' || i.research_type === 'dissertation').length,
        paperCount: items.filter((i) => i.research_type === 'research_paper' || i.research_type === 'journal_article').length
      });
    } catch (err: any) {
      toast(err.message || 'Could not load the repository.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (item: ResearchItem) => {
    if (item.access_level === 'restricted' || item.access_level === 'private') {
      toast('This publication has restricted access. Contact the library for a copy.', 'error');
      return;
    }
    void incrementResearchView(item.id);
    navigate(`/repository/${item.id}`);
  };

  // Opening the file is the gated action, so the server decides first and the
  // paywall explains the refusal. No public-URL fallback: an empty URL means
  // "no access", never "open the legacy link".
  const handleDownload = async (item: ResearchItem) => {
    const decision = await checkDocumentAccess({
      authenticated: isAuthenticated,
      verificationStatus: profile?.verificationStatus,
      isAdmin
    });
    if (!decision.allowed) {
      setGate({ reason: decision.reason as BlockReason, message: decision.message });
      return;
    }
    try {
      const url = await getResearchFileUrl(item);
      if (!url) { toast('This document could not be opened. Please try again.', 'error'); return; }
      void incrementResearchDownload(item.id);
      const fileName = item.file_name || `${item.title || 'research'}.pdf`;
      toast(`Downloading ${fileName}...`, 'info');
      await downloadFileFromUrl(url, fileName);
      toast(`Downloaded ${fileName}`, 'success');
    } catch (err: any) {
      toast(err.message || 'Download failed.', 'error');
    }
  };

  const years = useMemo(() => {
    const ys = items.map((i) => i.year).filter(Boolean) as string[];
    return Array.from(new Set(ys)).sort().reverse();
  }, [items]);

  const departments = getAllDepartmentsForRepository();

  return (
    <>
      {gate && (
        <PremiumGateModal
          open
          reason={gate.reason}
          message={gate.message}
          onClose={() => setGate(null)}
        />
      )}
      <SEO
        path="/repository"
        noindex={Boolean(debouncedQuery.trim()) || Boolean(typeFilter) || Boolean(deptFilter) || Boolean(yearFilter)}
        breadcrumbs={PUBLIC_ROUTES['/repository'].breadcrumbs}
      />
      <Breadcrumbs trail={PUBLIC_ROUTES['/repository'].breadcrumbs} />
      <div className="repo-hero">
        <h1><Landmark size={26} style={{ verticalAlign: -4 }} /> FUW Institutional Repository</h1>
        <p>The university's permanent archive of theses, dissertations, final-year projects, research papers, and scholarly publications produced by the FUW community.</p>
        <div className="repo-hero-actions">
          <Link to="/repository/submit" className="primary"><Plus size={16} /> Submit to Repository</Link>
          <Link to="/help" className="secondary-btn"><BookOpen size={16} /> Repository Guidelines</Link>
        </div>
      </div>

      <div className="repo-stats-bar">
        <div className="repo-stat-card"><b>{stats.total}</b><span>Publications</span></div>
        <div className="repo-stat-card"><b>{stats.projectCount}</b><span>Final Year Projects</span></div>
        <div className="repo-stat-card"><b>{stats.thesisCount}</b><span>Theses & Dissertations</span></div>
        <div className="repo-stat-card"><b>{stats.paperCount}</b><span>Research & Journal Papers</span></div>
      </div>

      <div className="repo-search-row">
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
          <input
            className="form-input"
            placeholder="Search the repository by title, author, abstract or keyword…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search repository"
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      <div className="repo-filters-row">
        <select className="form-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
          <option value="">All publication types</option>
          {REPOSITORY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="form-input" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="form-input" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="Filter by year">
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <Filter size={15} style={{ color: 'var(--muted)' }} />
      </div>

      {loading ? (
        <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading repository…</div>
      ) : items.length === 0 ? (
        <div className="repo-empty">
          <BookOpen size={40} style={{ margin: '0 auto', color: 'var(--muted)', display: 'block', marginBottom: 8 }} />
          <b>No publications found</b>
          <span>Try adjusting your search or filters. If you can't find a project or thesis, contact the library.</span>
        </div>
      ) : (
        <div className="repo-grid">
          {items.map((item) => (
            <PublicationCard
              key={item.id}
              item={item}
              onOpen={() => handleOpen(item)}
              onDownload={() => handleDownload(item)}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function PublicationCard({ item, onOpen, onDownload }: { item: ResearchItem; onOpen: () => void; onDownload: () => void }) {
  return (
    <article className="repo-card">
      <span className="repo-card-type">{RESEARCH_TYPE_LABELS[item.research_type] || 'Publication'}</span>
      <h3 className="repo-card-title">
        <Link to={`/repository/${item.id}`}>{item.title}</Link>
      </h3>
      {item.subtitle && <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{item.subtitle}</div>}
      {item.author_names && item.author_names.length > 0 && (
        <div className="repo-card-authors">by {item.author_names.join(', ')}</div>
      )}
      <div className="repo-card-meta">
        {item.year && <span><Clock size={12} /> {item.year}</span>}
        {item.department && <span><GraduationCap size={12} /> {item.department}</span>}
        {item.citation_count > 0 && <span><Quote size={12} /> {item.citation_count} citations</span>}
        {item.download_count > 0 && <span><Download size={12} /> {item.download_count}</span>}
        {item.is_verified && <span className="repo-verified-badge"><CheckCircle2 size={12} /> Verified</span>}
      </div>
      <div className="repo-card-actions">
        <button className="link-btn" onClick={onOpen}><Eye size={13} /> View</button>
        {item.file_path && item.access_level !== 'restricted' && item.access_level !== 'private' && (
          <button className="link-btn" onClick={onDownload}><Download size={13} /> Download</button>
        )}
        <Link to={`/repository/${item.id}?cite=1`} className="link-btn"><Quote size={13} /> Cite</Link>
      </div>
    </article>
  );
}

export function RepositoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated, profile, isAdmin } = useAuth();
  const [item, setItem] = useState<ResearchItem | null>(null);
  const [authors, setAuthors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCitation, setShowCitation] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [gate, setGate] = useState<{ reason: BlockReason; message: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    loadItem(id);
    void incrementResearchView(id);
  }, [id]);

  const loadItem = async (itemId: string) => {
    setLoading(true);
    try {
      const result = await fetchResearchItem(itemId);
      if (!result) { toast('Publication not found.', 'error'); navigate('/repository'); return; }
      setItem(result.item);
      setAuthors(result.authors);
      const params = new URLSearchParams(window.location.search);
      if (params.get('cite') === '1') setShowCitation(true);
    } catch (err: any) {
      toast(err.message || 'Could not load the publication.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!item) return;
    setDownloading(true);
    try {
      const decision = await checkDocumentAccess({
        authenticated: isAuthenticated,
        verificationStatus: profile?.verificationStatus,
        isAdmin
      });
      if (!decision.allowed) {
        setGate({ reason: decision.reason as BlockReason, message: decision.message });
        return;
      }
      const url = await getResearchFileUrl(item);
      if (!url) { toast('This document could not be opened. Please try again.', 'error'); return; }
      void incrementResearchDownload(item.id);
      const fileName = item.file_name || `${item.title || 'research'}.pdf`;
      toast(`Downloading ${fileName}...`, 'info');
      await downloadFileFromUrl(url, fileName);
      toast(`Downloaded ${fileName}`, 'success');
    } catch (err: any) {
      toast(err.message || 'Download failed.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <div className="loading-spinner-row"><Loader2 size={18} className="animate-spin" /> Loading publication…</div>;
  }

  // An unknown publication must answer as a real not-found page rather than
  // rendering an empty document (which would look like a soft 404).
  if (!item) {
    return (
      <main className="public-container">
        <SEO title="Publication not found" path={`/repository/${id ?? ''}`} noindex />
        <div className="empty-state" style={{ padding: '4rem 1rem' }}>
          <Landmark size={48} />
          <h1>Publication not found</h1>
          <p>
            This record is not available in the FUW institutional repository. It may still be under review, or it may
            have been withdrawn.
          </p>
          <Link to="/repository" className="primary">
            Browse the repository
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      {gate && (
        <PremiumGateModal
          open
          reason={gate.reason}
          message={gate.message}
          onClose={() => setGate(null)}
        />
      )}
      <SEO
        {...repositoryMeta({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          researchTypeLabel: RESEARCH_TYPE_LABELS[item.research_type] || 'Publication',
          year: item.year,
          department: item.department,
          faculty: item.faculty,
          abstract: item.abstract,
          keywords: item.keywords,
          authors: item.author_names,
          datePublished: item.published_at
        })}
      />
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/home' },
          { name: 'Repository', path: '/repository' },
          { name: item.title, path: `/repository/${item.id}` }
        ]}
      />
      <div className="repo-detail-hero">
        <span className="repo-type-chip">{RESEARCH_TYPE_LABELS[item.research_type] || 'Publication'}</span>
        <h1>{item.title}</h1>
        {item.subtitle && <div style={{ fontSize: '0.95rem', opacity: 0.9, marginBottom: 8 }}>{item.subtitle}</div>}
        {authors.length > 0 && <div style={{ fontSize: '0.88rem', marginBottom: 8 }}>by {authors.map((a) => a.author_name).join(', ')}</div>}
        <div className="repo-detail-meta">
          {item.year && <span><Clock size={13} /> {item.year}</span>}
          {item.department && <span><GraduationCap size={13} /> {item.department}</span>}
          {item.faculty && <span><Building2 size={13} /> {item.faculty}</span>}
          <span><Award size={13} /> {ACCESS_LABELS[item.access_level] || item.access_level}</span>
          {item.view_count > 0 && <span><Eye size={13} /> {item.view_count} views</span>}
          {item.download_count > 0 && <span><Download size={13} /> {item.download_count} downloads</span>}
        </div>
        <div style={{ marginTop: 12 }}>
          <Link to="/repository" className="secondary-btn" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>
            <ArrowLeft size={14} /> Back to Repository
          </Link>
        </div>
      </div>

      <div className="repo-detail-layout">
        <div>
          <div className="repo-detail-abstract">
            <h3>Abstract</h3>
            <p>{item.abstract || 'No abstract provided for this publication.'}</p>
            {item.keywords && item.keywords.length > 0 && (
              <div className="repo-detail-keywords">
                {item.keywords.map((k) => <span key={k}>{k}</span>)}
              </div>
            )}
          </div>
        </div>

        <aside className="repo-sidebar">
          <div className="repo-info-card">
            <h4>Publication Details</h4>
            <div className="repo-info-grid">
              <div><div className="di-label">Type</div><div className="di-value">{RESEARCH_TYPE_LABELS[item.research_type] || item.research_type}</div></div>
              {item.year && <div><div className="di-label">Year</div><div className="di-value">{item.year}</div></div>}
              {item.level && <div><div className="di-label">Level</div><div className="di-value">{item.level}</div></div>}
              {item.program && <div><div className="di-label">Program</div><div className="di-value">{item.program}</div></div>}
              {item.supervisor && <div><div className="di-label">Supervisor</div><div className="di-value">{item.supervisor}</div></div>}
              {item.institution && <div><div className="di-label">Institution</div><div className="di-value">{item.institution}</div></div>}
              {item.doi && <div><div className="di-label">DOI</div><div className="di-value"><a href={`https://doi.org/${item.doi}`} target="_blank" rel="noopener noreferrer">{item.doi}</a></div></div>}
              {item.isbn && <div><div className="di-label">ISBN</div><div className="di-value">{item.isbn}</div></div>}
              {item.issn && <div><div className="di-label">ISSN</div><div className="di-value">{item.issn}</div></div>}
              {item.license && <div><div className="di-label">License</div><div className="di-value">{item.license}</div></div>}
              {item.published_at && <div><div className="di-label">Published</div><div className="di-value">{new Date(item.published_at).toLocaleDateString()}</div></div>}
            </div>
          </div>

          <div className="repo-info-card">
            <h4>Actions</h4>
            <div className="repo-action-buttons">
              {item.file_path && item.access_level !== 'restricted' && item.access_level !== 'private' && (
                <button className="primary" onClick={handleDownload} disabled={downloading}>
                  {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
                </button>
              )}
              <button className="secondary-btn" onClick={() => setShowCitation(true)}>
                <Quote size={14} /> Cite this Publication
              </button>
              <Link to={`/report-copyright?research=${item.id}`} className="secondary-btn">
                <FileText size={14} /> Report a Concern
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {showCitation && (
        <CitationModal researchItem={item} onClose={() => setShowCitation(false)} />
      )}
    </>
  );
}

const LEVEL_OPTIONS = ['100', '200', '300', '400', '500', '600', 'Postgraduate'];

export function RepositorySubmitPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [researchType, setResearchType] = useState<ResearchItemType>('final_year_project');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [level, setLevel] = useState('');
  const [year, setYear] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const [authorsText, setAuthorsText] = useState('');

  const faculties = repositoryFaculties();
  const departments = useMemo(() => {
    if (!faculty) return [];
    const fac = faculties.find((f) => f.name === faculty);
    return fac ? fac.departments : [];
  }, [faculty, faculties]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !abstract.trim()) {
      toast('A title and abstract are required.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const authorNames = authorsText.split(',').map((a) => a.trim()).filter(Boolean);
      const dept = departments.find((d) => d.name === department);
      await submitResearchItem({
        title,
        subtitle,
        abstract,
        keywords: [],
        research_type: researchType,
        department_id: dept?.id || undefined,
        department,
        faculty,
        level,
        year,
        supervisor,
        author_names: authorNames.length ? authorNames : undefined
      });
      toast('Your submission has been received. The library will review it.', 'success');
      navigate('/repository');
    } catch (err: any) {
      toast(err.message || 'Could not submit the publication. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 1rem 2.5rem' }}>
      <SEO
        title="Submit to the FUW institutional repository"
        description="Submit a thesis, final-year project or research paper to the Federal University Wukari institutional repository."
        path="/repository/submit"
        noindex
      />
      <div className="request-page-header">
        <div>
          <h2 className="page-title"><Upload size={22} />Submit to the Repository</h2>
          <p className="page-subtitle">
            Share your thesis, project, or research with the FUW academic community. Submissions are reviewed by the library before publication.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ padding: '1.4rem', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div className="form-row-2col">
          <div className="form-field">
            <label className="form-label">Publication Title *</label>
            <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. An IoT-Based Smart Farming System for Wukari" />
          </div>
          <div className="form-field">
            <label className="form-label">Publication Type *</label>
            <select className="form-input" value={researchType} onChange={(e) => setResearchType(e.target.value as ResearchItemType)}>
              {REPOSITORY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Subtitle (optional)</label>
          <input className="form-input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="A short subtitle if applicable" />
        </div>

        <div className="form-field">
          <label className="form-label">Abstract *</label>
          <textarea
            className="form-input form-textarea"
            value={abstract}
            onChange={(e) => setAbstract(e.target.value)}
            required
            rows={5}
            maxLength={3000}
            placeholder="Summarize the purpose, methods, key findings and significance of your work."
          />
          <div className="field-hint char-count">{abstract.length}/3000</div>
        </div>

        <div className="form-field">
          <label className="form-label">Author(s) (comma-separated)</label>
          <input className="form-input" value={authorsText} onChange={(e) => setAuthorsText(e.target.value)} placeholder="e.g. Amina Mohammed, Ibrahim Musa" />
        </div>

        <div className="form-row-2col">
          <div className="form-field">
            <label className="form-label">Faculty</label>
            <select className="form-input" value={faculty} onChange={(e) => { setFaculty(e.target.value); setDepartment(''); }}>
              <option value="">Select a faculty…</option>
              {faculties.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Department</label>
            <select className="form-input" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Select a department…</option>
              {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row-2col">
          <div className="form-field">
            <label className="form-label">Level</label>
            <select className="form-input" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Select level…</option>
              {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Year *</label>
            <input
              className="form-input"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2026"
              pattern="[0-9]{4}"
              required
            />
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">Supervisor (optional)</label>
          <input className="form-input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="e.g. Dr. John Adeyemi" />
        </div>

        <div className="request-info-banner" style={{ marginTop: 4 }}>
          <Bookmark size={14} /> By submitting, you confirm this work is yours and you authorize the FUW library to preserve and provide access to it. The library will contact you if any information needs correction.
        </div>

        <button type="submit" className="primary submit-btn form-submit-btn" disabled={submitting || !title.trim() || !abstract.trim()}>
          {submitting ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : <><Upload size={15} /> Submit to Repository</>}
        </button>
      </form>
    </div>
  );
}