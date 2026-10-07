// =====================================================================
// FUW E-Library — dynamic page metadata.
//
// Each builder derives title / description / canonical / breadcrumb trail
// and structured data from the live record being rendered, so newly
// published faculties, departments, courses, collections, materials and
// repository items are indexable the moment they exist — no developer
// has to touch a metadata file (seo.md §52).
//
// Rules enforced here:
//   * descriptions are composed from real record fields only;
//   * a record that does not resolve returns `null`, and the caller then
//     renders a real 404 instead of emitting metadata for nothing
//     (seo.md §54).
// =====================================================================

import type { PageMeta, Crumb } from './routes';
import { COLLEGE_OF_HEALTH_SCIENCES, type Department, type Faculty } from '../../data/catalogue';
import {
  countCourses,
  departmentSlug,
  facultySlug,
  shortFacultyName,
  type CourseEntry,
  type DepartmentEntry
} from './directory';
import { SITE_LONG_NAME, UNIVERSITY_NAME } from './site';

const HOME: Crumb = { name: 'Home', path: '/' };
const FACULTIES: Crumb = { name: 'Faculties', path: '/faculties' };
const COURSES: Crumb = { name: 'Courses', path: '/courses' };

/** Sentence-case a list into "A, B and C". */
function listSentence(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function meta(partial: Omit<PageMeta, 'image' | 'imageAlt' | 'ogType'> & Partial<Pick<PageMeta, 'image' | 'imageAlt' | 'ogType'>>): PageMeta {
  return {
    image: undefined,
    imageAlt: undefined,
    ogType: 'website',
    ...partial
  } as PageMeta;
}

// ---------------------------------------------------------------------
// Faculties
// ---------------------------------------------------------------------

export function facultyMeta(faculty: Faculty): PageMeta {
  const slug = facultySlug(faculty);
  const path = `/faculties/${slug}`;
  const short = shortFacultyName(faculty.name);
  const departments = faculty.departments;
  const courseCount = departments.reduce((acc, d) => acc + countCourses(d), 0);
  const inHealthSciences = faculty.college === COLLEGE_OF_HEALTH_SCIENCES;

  const description =
    `${short} at ${UNIVERSITY_NAME}: ${departments.length} accredited ` +
    `department${departments.length === 1 ? '' : 's'} and ${courseCount} courses, ` +
    `with lecture notes, past questions and study materials for every level and semester.`;

  return meta({
    title: directoryTitle(short, 'Faculty Resources'),
    description,
    path,
    keywords: [
      `${short} FUW`,
      `${short} faculty ${UNIVERSITY_NAME}`,
      `${short} departments`,
      inHealthSciences ? `FUW College of Health Sciences ${short}` : `FUW ${short} lecture notes`
    ].filter(Boolean),
    indexability: 'index',
    breadcrumbs: [HOME, FACULTIES, { name: short, path }],
    schema: 'webPage',
    schemaData: {
      about: { '@type': 'CollegeOrUniversity', name: faculty.name, subOrganization: { '@id': `${SITE_LONG_NAME}` } }
    }
  });
}

// ---------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------

export function departmentMeta(entry: DepartmentEntry): PageMeta {
  const { faculty, department, path } = entry;
  const courseCount = entry.courseCount || countCourses(department);
  const levels = Array.from(
    new Set(
      Object.keys(department.curriculum || {})
        .map((l) => Number(l))
        .filter((l) => !Number.isNaN(l))
        .sort((a, b) => a - b)
    )
  );
  const levelWord = levels.map((l) => `${l} level`).join(', ');

  const description =
    `${department.name}, ${faculty.name} at ${UNIVERSITY_NAME}: ` +
    `${courseCount} courses across ${levelWord || 'each level'}, with lecture notes, ` +
    `handouts and past questions available in the FUW E-Library.`;

  return meta({
    title: directoryTitle(department.name, 'Department Materials & Courses'),
    description,
    path,
    keywords: [
      `${department.name} ${UNIVERSITY_NAME}`,
      `${department.name} department`,
      `${department.name} courses`,
      `FUW ${department.name} past questions`
    ],
    indexability: 'index',
    breadcrumbs: [
      HOME,
      FACULTIES,
      { name: shortFacultyName(faculty.name), path: `/faculties/${facultySlug(faculty)}` },
      { name: department.name, path }
    ],
    schema: 'webPage',
    schemaData: {
      about: {
        '@type': 'EducationalOrganization',
        name: faculty.name,
        department: { '@type': 'Organization', name: department.name }
      }
    }
  });
}

// ---------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------

/**
 * Keep the <title> inside the ~60 character window every engine renders.
 * The course code is the searchable term, so it always survives; the full
 * title is dropped when the pair would not fit, and it stays in the
 * description and on the page itself.
 */
function courseTitle(code: string, title: string): string {
  const full = `${code} ${title} | FUW E-Library`;
  if (full.length <= 65) return full;
  const trimmed = `${code} ${truncate(title, 65 - code.length - 1 - ' | FUW E-Library'.length)} | FUW E-Library`;
  if (trimmed.length <= 65) return trimmed;
  return `${code} Course Notes & Past Questions | FUW`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Keep a directory page <title> inside the window search engines actually
 * render. Department names are fixed by the university, so when the full
 * name will not fit alongside the qualifier the qualifier is dropped rather
 * than truncating the name students search for.
 */
function directoryTitle(name: string, qualifier: string): string {
  const full = `${name} ${qualifier} | FUW E-Library`;
  if (full.length <= 65) return full;
  const withoutQualifier = `${name} | FUW E-Library`;
  if (withoutQualifier.length <= 65) return withoutQualifier;
  return truncate(name, 65 - ' | FUW E-Library'.length) + ' | FUW E-Library';
}

export function courseMeta(entry: CourseEntry): PageMeta {
  const { code, title, path, occurrences } = entry;
  const departmentNames = Array.from(
    new Set(occurrences.map((o) => o.department.name))
  );
  const facultyNames = Array.from(new Set(occurrences.map((o) => o.faculty.name)));
  const levels = Array.from(new Set(entry.occurrences.map((o) => o.level))).sort((a, b) => a - b);

  const where =
    departmentNames.length > 3
      ? `${departmentNames.length} ${UNIVERSITY_NAME} departments`
      : `offered by ${listSentence(departmentNames)}`;

  const description =
    `${code} ${title}: ${where}. Find lecture notes, handouts, ` +
    `test and exam past questions and project guides for ${code} in the FUW E-Library.`;

  return meta({
    title: courseTitle(code, title),
    description,
    path,
    keywords: [
      `${code} ${UNIVERSITY_NAME}`,
      `${code} lecture notes`,
      `${code} past questions`,
      `${title} FUW`
    ],
    indexability: 'index',
    breadcrumbs: [HOME, COURSES, { name: `${code} ${title}`, path }],
    schema: 'course',
    schemaData: {
      courseCode: code,
      courseName: title,
      levels,
      facultyNames
    }
  });
}

// ---------------------------------------------------------------------
// Library materials (/materials/:id)
// ---------------------------------------------------------------------

export interface MaterialSeoInput {
  id: string;
  title: string;
  description: string;
  type: string;
  course: string;
  courseTitle?: string;
  faculty: string;
  department: string;
  level: string;
  semester: string;
  session?: string;
  createdAt?: string;
}

export function materialMeta(material: MaterialSeoInput): PageMeta {
  const path = `/materials/${material.id}`;
  const base =
    `${material.title}: ${material.type.toLowerCase()} for ${material.course}` +
    (material.courseTitle && material.courseTitle !== material.title ? ` (${material.courseTitle})` : '') +
    ` in ${material.department}, ${material.faculty}, ${UNIVERSITY_NAME}.`;

  const extra = material.description.trim();
  const description = extra ? `${base} ${extra}` : base;

  const crumbs: Crumb[] = [
    HOME,
    { name: 'Library', path: '/library' },
    { name: shortFacultyName(material.faculty), path: `/library?faculty=${encodeURIComponent(material.faculty)}` },
    { name: material.course, path }
  ];

  return meta({
    title: `${material.title} | FUW E-Library`,
    description,
    path,
    keywords: [
      `${material.title}`,
      `${material.course} ${material.type.toLowerCase()}`,
      `${material.course} ${UNIVERSITY_NAME}`,
      `${material.department} past questions`
    ],
    indexability: 'index',
    breadcrumbs: crumbs,
    schema: 'learningResource',
    ogType: 'article',
    schemaData: {
      learningResourceType: material.type,
      educationalLevel: material.level,
      timeRequired: undefined,
      about: {
        '@type': 'Thing',
        name: `${material.course}`,
        description: material.courseTitle || material.title
      }
    }
  });
}

// ---------------------------------------------------------------------
// Institutional repository (/repository/:id)
// ---------------------------------------------------------------------

export interface RepositorySeoInput {
  id: string;
  title: string;
  subtitle?: string | null;
  researchTypeLabel: string;
  year?: string | number | null;
  department?: string | null;
  faculty?: string | null;
  abstract?: string | null;
  keywords?: string[] | null;
  authors?: string[];
  datePublished?: string | null;
}

export function repositoryMeta(item: RepositorySeoInput): PageMeta {
  const path = `/repository/${item.id}`;
  const facts = [item.researchTypeLabel, item.year ? String(item.year) : '', item.department || '']
    .filter(Boolean)
    .join(' · ');

  const summary = (item.abstract || item.subtitle || '').trim();
  const description = summary
    ? `${item.title}: ${facts}. ${summary}`
    : `${item.title}: ${facts} archived in the ${UNIVERSITY_NAME} institutional repository.`;

  return meta({
    title: `${item.title} | FUW Institutional Repository`,
    description,
    path,
    keywords: [
      item.title,
      `${UNIVERSITY_NAME} ${item.researchTypeLabel.toLowerCase()}`,
      item.department ? `${item.department} research` : 'FUW research output',
      'FUW academic repository'
    ],
    indexability: 'index',
    breadcrumbs: [HOME, { name: 'Repository', path: '/repository' }, { name: item.title, path }],
    schema: 'scholarlyArticle',
    ogType: 'article',
    schemaData: {
      headline: item.title,
      datePublished: item.datePublished || undefined,
      authors: item.authors && item.authors.length > 0 ? item.authors : undefined,
      keywords: item.keywords && item.keywords.length > 0 ? item.keywords : undefined
    }
  });
}

// ---------------------------------------------------------------------
// Curated collections (/collections/:slug)
// ---------------------------------------------------------------------

export interface CollectionSeoInput {
  slug: string;
  name: string;
  description?: string | null;
  itemCount?: number | null;
}

export function collectionMeta(collection: CollectionSeoInput): PageMeta {
  const path = `/collections/${collection.slug}`;
  const own = (collection.description || '').trim();
  const count = Number(collection.itemCount || 0);
  const resources = count > 0 ? `${count} grouped academic resource${count === 1 ? '' : 's'}` : 'grouped academic resources';

  const description = own
    ? `${collection.name}: a curated FUW E-Library collection of ${resources}. ${own}`
    : `${collection.name}: a curated collection of ${resources} assembled by Federal University Wukari librarians in the FUW E-Library.`;

  return meta({
    title: `${collection.name} | FUW E-Library Collections`,
    description,
    path,
    keywords: [collection.name, 'FUW curated collection', `${UNIVERSITY_NAME} reading list`],
    indexability: 'index',
    breadcrumbs: [HOME, { name: 'Collections', path: '/collections' }, { name: collection.name, path }],
    schema: 'collectionPage'
  });
}

export { departmentSlug };