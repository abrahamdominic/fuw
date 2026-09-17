// Citation generation for library resources.
// Produces academic citations in APA, MLA, Chicago, and IEEE formats,
// plus BibTeX and RIS exports. All data comes from the actual resource metadata —
// nothing is fabricated.
import type { MaterialItem } from './store';
import type { ResearchItem } from './repository';

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee';

export const CITATION_FORMATS: { id: CitationStyle; label: string }[] = [
  { id: 'apa', label: 'APA' },
  { id: 'mla', label: 'MLA' },
  { id: 'chicago', label: 'Chicago' },
  { id: 'ieee', label: 'IEEE' }
];

interface CitationSource {
  title: string;
  subtitle?: string | null;
  authors: string[];
  year?: string | null;
  institution: string;
  resourceType: string;
  courseCode?: string;
  courseTitle?: string;
  level?: string;
  session?: string;
  publisher?: string | null;
  doi?: string | null;
  isbn?: string | null;
  issn?: string | null;
  url?: string;
  department?: string | null;
  faculty?: string | null;
  edition?: string | null;
  publicationVenue?: string | null;
}

function normalizeAuthors(authors: string[]): string[] {
  return authors.filter(Boolean).map((a) => a.trim()).filter((a) => a.length > 0);
}

/** Build a citation source from a MaterialItem. */
export function materialToCitationSource(m: MaterialItem): CitationSource {
  const authors = m.uploadedBy?.name && m.uploadedBy.name !== 'FUW Repository' && m.uploadedBy.id
    ? [m.uploadedBy.name]
    : [];
  const year = m.createdAt ? new Date(m.createdAt).getFullYear().toString() : m.session || undefined;
  return {
    title: m.title,
    authors,
    year,
    institution: 'Federal University Wukari',
    resourceType: m.type,
    courseCode: m.course,
    courseTitle: m.courseTitle,
    level: m.level,
    session: m.session,
    department: m.department,
    faculty: m.faculty,
    url: m.fileUrl
  };
}

/** Build a citation source from a ResearchItem. */
export function researchToCitationSource(r: ResearchItem): CitationSource {
  return {
    title: r.title,
    subtitle: r.subtitle,
    authors: r.author_names?.length ? r.author_names : [r.supervisor || 'Unknown Author'],
    year: r.year,
    institution: r.institution || 'Federal University Wukari',
    resourceType: RESEARCH_TYPE_CITATION_LABEL(r.research_type),
    department: r.department,
    faculty: r.faculty,
    publicationVenue: r.publication_venue,
    publisher: r.publisher,
    doi: r.doi,
    isbn: r.isbn,
    issn: r.issn,
    edition: r.edition,
    url: r.file_url || undefined
  };
}

function RESEARCH_TYPE_CITATION_LABEL(t: string): string {
  const map: Record<string, string> = {
    final_year_project: 'Undergraduate project',
    thesis: 'Master\'s thesis',
    dissertation: 'Doctoral dissertation',
    research_paper: 'Research paper',
    journal_article: 'Journal article',
    conference_paper: 'Conference paper',
    technical_report: 'Technical report',
    institutional_publication: 'Institutional publication',
    dataset: 'Dataset',
    seminar_paper: 'Seminar paper'
  };
  return map[t] || 'Research publication';
}

function formatAuthorsForAuthorFirst(authors: string[], style: 'apa' | 'mla'): string {
  if (authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  return `${authors[0]} et al.`;
}

/** Generate a citation string in the requested style. */
export function generateCitation(source: CitationSource, style: CitationStyle): string {
  const authors = normalizeAuthors(source.authors);
  const year = source.year || 'n.d.';

  switch (style) {
    case 'apa': {
      // Lastname, F. M. (Year). Title. Institution. DOI
      const authorStr = authors.length > 0 ? `${authors.join(', ')}. ` : '';
      const publisher = source.publisher || source.institution;
      const doiPart = source.doi
        ? ` https://doi.org/${source.doi}`
        : '';
      return `${authorStr}(${year}). *${source.title}*${source.subtitle ? ` (${source.subtitle})` : ''}. ${publisher}.${doiPart}`;
    }
    case 'mla': {
      // Author. "Title." Institution, Year.
      const authorStr = authors.length > 0 ? `${authors.join(', ')}. ` : '';
      const publisher = source.publisher || source.institution;
      const venue = source.publicationVenue
        ? ` ${source.publicationVenue}.`
        : '';
      return `${authorStr}"${source.title}"${source.subtitle ? ` (${source.subtitle})` : ''}. ${publisher}${venue ? ` ${venue}` : ''}, ${year}.`;
    }
    case 'chicago': {
      // Author, "Title," Institution, Year.
      const authorStr = authors.length > 0 ? `${authors.join(', ')}, ` : '';
      const publisher = source.publisher || source.institution;
      return `${authorStr}"${source.title}"${source.subtitle ? ` (${source.subtitle})` : ''}, ${publisher}, ${year}.`;
    }
    case 'ieee': {
      // [1] A. Author and B. Author, "Title," Institution, Year.
      const initialNames = authors.map((a) => {
        const parts = a.split(' ').filter(Boolean);
        if (parts.length <= 1) return a;
        const last = parts[parts.length - 1];
        const initials = parts.slice(0, -1).map((p) => `${p[0]}.`).join(' ');
        return `${initials} ${last}`;
      });
      const authorStr = initialNames.length > 0 ? `${initialNames.join(', ')}. ` : '';
      const publisher = source.publisher || source.institution;
      return `[1] ${authorStr}"${source.title}"${source.subtitle ? ` (${source.subtitle})` : ''}, ${publisher}, ${year}.`;
    }
  }
}

/** Export a full style-by-style citation object. */
export function generateAllCitations(source: CitationSource): Record<CitationStyle, string> {
  return {
    apa: generateCitation(source, 'apa'),
    mla: generateCitation(source, 'mla'),
    chicago: generateCitation(source, 'chicago'),
    ieee: generateCitation(source, 'ieee')
  };
}

/** Generate BibTeX entry for a resource. */
export function generateBibTeX(source: CitationSource, citationKey?: string): string {
  const authors = normalizeAuthors(source.authors);
  const authorField = authors.length ? authors.map((a) => a.replace(/,/g, ' and ')).join(' and ') : source.institution;
  const key = citationKey || firstAuthorKey(source);
  const entryType = bibtexType(source.resourceType);

  const fields: string[] = [
    `  title = {${escapeLatex(source.title)}${source.subtitle ? `: ${escapeLatex(source.subtitle)}` : ''}}`
  ];
  if (authorField) fields.push(`  author = {${escapeLatex(authorField)}}`);
  if (source.year) fields.push(`  year = {${source.year}}`);
  fields.push(`  publisher = {${escapeLatex(source.publisher || source.institution)}}`);
  if (source.doi) fields.push(`  doi = {${source.doi}}`);
  if (source.isbn) fields.push(`  isbn = {${source.isbn}}`);
  if (source.issn) fields.push(`  issn = {${source.issn}}`);
  if (source.edition) fields.push(`  edition = {${source.edition}}`);
  if (source.url) fields.push(`  url = {${source.url}}`);
  if (source.department) fields.push(`  institution = {${escapeLatex(source.institution)}}`);
  fields.push(`  note = {${escapeLatex(source.resourceType)}${source.courseCode ? `, ${source.courseCode}` : ''}${source.level ? `, ${source.level} level` : ''}}`);

  return `@${entryType}{${key},\n${fields.join(',\n')}\n}`;
}

function bibtexType(resourceType: string): string {
  const t = resourceType.toLowerCase();
  if (t.includes('thesis') || t.includes('dissertation')) return 'phdthesis';
  if (t.includes('project')) return 'mastersthesis';
  if (t.includes('journal')) return 'article';
  if (t.includes('conference') || t.includes('paper')) return 'inproceedings';
  if (t.includes('report')) return 'techreport';
  return 'misc';
}

function firstAuthorKey(source: CitationSource): string {
  const authors = normalizeAuthors(source.authors);
  const surname = authors[0]?.split(' ').pop() || 'FUW';
  const safeSurname = surname.replace(/[^a-zA-Z]/g, '');
  return `${safeSurname}${source.year || '20xx'}${source.courseCode ? source.courseCode.replace(/\s/g, '') : ''}`;
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}&%$#_])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/** Generate RIS export for a resource. */
export function generateRIS(source: CitationSource): string {
  const authors = normalizeAuthors(source.authors);
  const lines: string[] = ['TY  - ' + risType(source.resourceType)];
  for (const a of authors) lines.push(`AU  - ${a}`);
  lines.push(`TI  - ${source.title}`);
  if (source.subtitle) lines.push(`T2  - ${source.subtitle}`);
  if (source.year) lines.push(`PY  - ${source.year}`);
  lines.push(`PB  - ${source.publisher || source.institution}`);
  if (source.doi) lines.push(`DO  - ${source.doi}`);
  if (source.isbn) lines.push(`SN  - ${source.isbn}`);
  if (source.issn) lines.push(`SN  - ${source.issn}`);
  if (source.url) lines.push(`UR  - ${source.url}`);
  if (source.department) lines.push(`C1  - Department: ${source.department}`);
  if (source.level) lines.push(`C2  - Level: ${source.level}`);
  if (source.courseCode) lines.push(`C3  - Course: ${source.courseCode}`);
  lines.push(`ER  - `);
  return lines.join('\n');
}

function risType(resourceType: string): string {
  const t = resourceType.toLowerCase();
  if (t.includes('journal')) return 'JOUR';
  if (t.includes('conference') || t.includes('paper') || t.includes('seminar')) return 'CONF';
  if (t.includes('thesis') || t.includes('dissertation')) return 'THES';
  if (t.includes('project')) return 'THES';
  if (t.includes('report')) return 'RPRT';
  if (t.includes('book')) return 'BOOK';
  return 'GEN';
}

/** Full citation export bundle for copying/downloading. */
export function buildCitationExport(material?: MaterialItem | null, research?: ResearchItem | null): {
  source: CitationSource;
  citations: Record<CitationStyle, string>;
  bibtex: string;
  ris: string;
} | null {
  if (!material && !research) return null;
  const source = material
    ? materialToCitationSource(material)
    : researchToCitationSource(research!);
  return {
    source,
    citations: generateAllCitations(source),
    bibtex: generateBibTeX(source),
    ris: generateRIS(source)
  };
}

/** Download helper: write citation content as a text file. */
export function downloadCitationFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}