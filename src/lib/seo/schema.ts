// =====================================================================
// FUW E-Library — JSON-LD graph builders.
//
// Only schemas the page genuinely supports are emitted. Nothing here
// invents ratings, reviews, events, FAQs, offers or people (seo.md §22,
// §45): every field is copied from a record the app actually stores.
// =====================================================================

import {
  DEFAULT_OG_IMAGE,
  OG_IMAGE_ALT,
  SITE_LONG_NAME,
  SITE_NAME,
  SITE_URL,
  UNIVERSITY_COUNTRY,
  UNIVERSITY_LOCALITY,
  UNIVERSITY_NAME,
  UNIVERSITY_OFFICIAL_SITE,
  UNIVERSITY_POSTAL_ADDRESS,
  UNIVERSITY_REGION,
  absoluteUrl,
  normalizePath
} from './site';
import type { Crumb, PageMeta, SchemaKind } from './routes';

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const LIBRARY_ORG_ID = `${SITE_URL}/#elibrary`;

/** Stable @id for the university entity. */
export const UNIVERSITY_ID = `${SITE_URL}/#university`;

/** The publishing institution: Federal University Wukari itself. */
export function universityOrganization(): Record<string, unknown> {
  return {
    '@type': 'CollegeOrUniversity',
    '@id': UNIVERSITY_ID,
    name: UNIVERSITY_NAME,
    alternateName: 'FUW',
    url: UNIVERSITY_OFFICIAL_SITE,
    address: {
      '@type': 'PostalAddress',
      streetAddress: UNIVERSITY_POSTAL_ADDRESS,
      addressLocality: UNIVERSITY_LOCALITY,
      addressRegion: UNIVERSITY_REGION,
      addressCountry: UNIVERSITY_COUNTRY
    }
  };
}

/** The application operator: the FUW E-Library platform itself. */
export function libraryOrganization(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': LIBRARY_ORG_ID,
    name: SITE_LONG_NAME,
    alternateName: SITE_NAME,
    url: `${SITE_URL}/`,
    description: `The digital library of ${UNIVERSITY_NAME} — verified lecture notes, test and exam past questions, handouts, projects and research materials for the university community.`,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/images/fuw-logo.png'),
      caption: `${UNIVERSITY_NAME} logo`
    },
    image: absoluteUrl(DEFAULT_OG_IMAGE),
    parentOrganization: { '@id': UNIVERSITY_ID },
    areaServed: {
      '@type': 'Country',
      name: 'Nigeria'
    }
  };
}

/**
 * WebSite + SitelinksSearchbox. The search target is the real catalogue
 * search route, so the sitelinks box points at a working query.
 */
export function webSiteNode(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    alternateName: SITE_LONG_NAME,
    url: `${SITE_URL}/`,
    inLanguage: 'en-NG',
    publisher: { '@id': LIBRARY_ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/library?q={search_term_string}`
      },
      'query-input': 'required name=search_term_string'
    }
  };
}

/** BreadcrumbList built from a trail whose final entry is the page itself. */
export function breadcrumbNode(crumbs: Crumb[]): Record<string, unknown> | null {
  const trail = crumbs.filter(Boolean);
  if (trail.length < 2) return null;

  return {
    '@type': 'BreadcrumbList',
    '@id': `${absoluteUrl(trail[trail.length - 1].path)}#breadcrumb`,
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path)
    }))
  };
}

interface Data extends Record<string, unknown> {
  schemaData?: Record<string, unknown> | null;
}

/** Merge helper that drops undefined/null values before serialisation. */
function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined || v === null || v === '') continue;
    out[key] = v;
  }
  return out as T;
}

function articleNode(page: PageMeta): Record<string, unknown> {
  return compact({
    '@type': 'WebPage',
    '@id': `${absoluteUrl(page.path)}#webpage`,
    url: absoluteUrl(page.path),
    name: page.title,
    description: page.description,
    inLanguage: 'en-NG',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': LIBRARY_ORG_ID },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: absoluteUrl(page.image || DEFAULT_OG_IMAGE),
      width: 1200,
      height: 630
    },
    breadcrumb: { '@id': `${absoluteUrl(page.path)}#breadcrumb` }
  });
}

/** Digital document: a lecture note, handout, project or past-question paper. */
function learningResourceNode(page: PageMeta, data: Data): Record<string, unknown> {
  const merged = { ...data, ...(page.schemaData || {}) };
  return compact({
    '@type': 'LearningResource',
    '@id': `${absoluteUrl(page.path)}#resource`,
    name: page.title,
    description: page.description,
    url: absoluteUrl(page.path),
    inLanguage: 'en-NG',
    learningResourceType: merged.learningResourceType,
    educationalLevel: merged.educationalLevel,
    educationalUse: ['assignment', 'exam preparation', 'self study'],
    about: merged.about,
    isPartOf: { '@id': LIBRARY_ORG_ID },
    publisher: { '@id': LIBRARY_ORG_ID },
    datePublished: merged.datePublished
  });
}

/** Scholarly output archived in the institutional repository. */
function scholarlyArticleNode(page: PageMeta, data: Data): Record<string, unknown> {
  const merged = { ...data, ...(page.schemaData || {}) };
  const authors = Array.isArray(merged.authors) ? (merged.authors as string[]) : [];
  return compact({
    '@type': 'ScholarlyArticle',
    '@id': `${absoluteUrl(page.path)}#publication`,
    headline: merged.headline || page.title,
    name: page.title,
    description: page.description,
    url: absoluteUrl(page.path),
    inLanguage: 'en-NG',
    datePublished: merged.datePublished,
    keywords: Array.isArray(merged.keywords) ? (merged.keywords as string[]).join(', ') : undefined,
    // Only credited authors are claimed. A record with no author on file gets
    // no author property rather than an invented one.
    author:
      authors.length > 0
        ? authors.map((name) => ({ '@type': 'Person', name }))
        : undefined,
    publisher: { '@id': LIBRARY_ORG_ID },
    isPartOf: { '@id': `${SITE_URL}/repository` },
    mainEntityOfPage: { '@id': `${absoluteUrl(page.path)}#webpage` }
  });
}

/**
 * Course. Only facts the catalogue actually records are emitted: the course
 * code, the level(s) it is taken at and the university that awards it. No
 * provider rating, no invented delivery mode, no workload estimate and no
 * `offers` block — a fabricated price or course mode is worse than no
 * structured data at all (seo.md §22, §45).
 */
function courseNode(page: PageMeta, data: Data): Record<string, unknown> {
  const merged = { ...data, ...(page.schemaData || {}) };
  const levels = Array.isArray(merged.levels) ? (merged.levels as number[]) : [];
  return compact({
    '@type': 'Course',
    '@id': `${absoluteUrl(page.path)}#course`,
    name: page.title,
    description: page.description,
    url: absoluteUrl(page.path),
    inLanguage: 'en-NG',
    courseCode: merged.courseCode,
    educationalLevel: levels.length ? levels.map((l) => `${l} Level`).join(', ') : undefined,
    provider: { '@id': UNIVERSITY_ID },
    isPartOf: { '@id': LIBRARY_ORG_ID },
    mainEntityOfPage: { '@id': `${absoluteUrl(page.path)}#webpage` }
  });
}

/** A directory page that enumerates other pages (faculties, courses). */
function itemListNode(page: PageMeta, items?: Array<{ name: string; path: string }>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    '@type': 'ItemList',
    '@id': `${absoluteUrl(page.path)}#itemlist`,
    name: page.title,
    numberOfItems: items?.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: (items || []).map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: absoluteUrl(item.path)
    }))
  };
  return compact(base);
}

function collectionPageNode(page: PageMeta): Record<string, unknown> {
  return compact({
    ...articleNode(page),
    '@type': 'CollectionPage'
  });
}

function webPageNode(page: PageMeta): Record<string, unknown> {
  return articleNode(page);
}

/** The full `@graph` for a page, always rooted in the shared entities. */
export function buildGraph(page: PageMeta, items?: Array<{ name: string; path: string }>): unknown[] {
  const schema: SchemaKind = page.schema;

  // Always include the site + publisher entities so every page references
  // one consistent description of the site and the university.
  const graph: unknown[] = [
    { '@context': 'https://schema.org', '@graph': [] as unknown[] }
  ];
  const inner = graph[0] as { '@graph': unknown[] };

  inner['@graph'].push(libraryOrganization(), universityOrganization(), webSiteNode());

  const canonical = absoluteUrl(normalizePath(page.path));
  const crumbs = page.breadcrumbs || [];
  if (crumbs.length >= 2) inner['@graph'].push(breadcrumbNode(crumbs)!);

  switch (schema) {
    case 'home':
      inner['@graph'].push({
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: page.title,
        description: page.description,
        inLanguage: 'en-NG',
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': UNIVERSITY_ID },
        primaryImageOfPage: { '@type': 'ImageObject', url: absoluteUrl(DEFAULT_OG_IMAGE), width: 1200, height: 630 }
      });
      break;
    case 'collectionPage':
      inner['@graph'].push(collectionPageNode(page));
      break;
    case 'itemList':
      inner['@graph'].push(articleNode(page), itemListNode(page, items));
      break;
    case 'course':
      inner['@graph'].push(articleNode(page), courseNode(page, page.schemaData || {}));
      break;
    case 'learningResource':
      inner['@graph'].push(articleNode(page), learningResourceNode(page, page.schemaData || {}));
      break;
    case 'scholarlyArticle':
      inner['@graph'].push(articleNode(page), scholarlyArticleNode(page, page.schemaData || {}));
      break;
    case 'webPage':
      inner['@graph'].push(webPageNode(page));
      break;
    case 'none':
    default:
      break;
  }

  return graph;
}

export { OG_IMAGE_ALT, SITE_URL };