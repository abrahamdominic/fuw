// =====================================================================
// FUW E-Library — page metadata registry.
//
// Every public route declares its indexability, title, description,
// keyword focus, breadcrumb trail and structured-data type here. This
// module is the single source of truth consumed by:
//
//   * <SEO>            — runtime <head> for the client-rendered app
//   * scripts/seo/*    — build-time prerendered HTML shells, robots.txt
//                        and sitemap.xml
//
// Keeping both sides on one registry is what guarantees a page's
// canonical URL, sitemap entry and initial HTML never drift apart.
//
// Keyword policy: a small number of terms that the page genuinely serves.
// No term is repeated across every page and no page lists terms it does
// not answer — see seo.md §13 (no keyword stuffing).
// =====================================================================

import {
  DIRECTORY_TOTALS,
  findCourseByCode,
  findDepartmentBySlug,
  findFacultyBySlug
} from './directory';
import { normalizePath } from './site';

export type Indexability = 'index' | 'noindex';

export type SchemaKind =
  | 'home'
  | 'webPage'
  | 'collectionPage'
  | 'itemList'
  | 'course'
  | 'learningResource'
  | 'scholarlyArticle'
  | 'none';

export interface Crumb {
  /** Visible, human-readable label (also used as BreadcrumbList `name`). */
  name: string;
  /** Canonical, absolute-or-root-relative path for the crumb target. */
  path: string;
}

export interface PageMeta {
  /** Full <title> text. Do not repeat the brand twice. */
  title: string;
  /** 110–165 character summary that describes this page only. */
  description: string;
  /** Canonical path. Query strings and trailing slashes are stripped. */
  path: string;
  /** Terms this page legitimately serves. Short and specific. */
  keywords: string[];
  indexability: Indexability;
  breadcrumbs: Crumb[];
  schema: SchemaKind;
  /** Extra JSON-LD merged into the generated graph for this page. */
  schemaData?: Record<string, unknown> | null;
  /** Social preview artwork (root-relative or absolute). */
  image?: string;
  imageAlt?: string;
  ogType?: 'website' | 'article';
  /**
   * Sitemap hints. Optional — the build-time generator supplies a sensible
   * default per section when a route does not override them. `changefreq` and
   * `priority` are hints only; they are never a substitute for real
   * `lastmod` values.
   */
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

const HOME_CRUMB: Crumb = { name: 'Home', path: '/home' };

export const KEYWORDS = {
  brand: ['FUW E-Library', 'Federal University Wukari E-Library'],
  university: ['Federal University Wukari', 'FUW Nigeria', 'Federal University Wukari Taraba'],
  library: ['FUW digital library', 'Federal University Wukari library', 'university library Nigeria'],
  materials: ['FUW lecture notes', 'FUW past questions', 'FUW study materials'],
  faculties: ['FUW faculties', 'Federal University Wukari faculties', 'FUW departments'],
  courses: ['FUW courses', 'Federal University Wukari courses', 'FUW academic programs'],
  repository: ['FUW repository', 'Federal University Wukari academic repository'],
  collections: ['FUW study collections', 'FUW curated reading lists'],
  help: ['FUW library help', 'how to use the FUW E-Library']
} as const;

const F = DIRECTORY_TOTALS.faculties;
const D = DIRECTORY_TOTALS.departments;
const C = DIRECTORY_TOTALS.courses;

/**
 * Public, indexable routes. Every path here appears in sitemap.xml and is
 * rendered into a static HTML shell at build time.
 */
export const PUBLIC_ROUTES: Record<string, PageMeta> = {
  '/library': {
    title: 'FUW E-Library | Academic Materials & Digital Library',
    description:
      'Search and filter verified Federal University Wukari academic materials: lecture notes, test and exam past questions, handouts and projects by faculty, department, level and semester.',
    path: '/library',
    changefreq: 'daily',
    priority: 0.9,
    keywords: [...KEYWORDS.library, ...KEYWORDS.materials],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Library', path: '/library' }],
    schema: 'collectionPage'
  },

  '/faculties': {
    title: `FUW Faculties & Departments | Federal University Wukari`,
    description: `Browse the ${F} faculties and ${D} accredited departments of Federal University Wukari, Taraba State, and open the course materials published for each one.`,
    path: '/faculties',
    changefreq: 'weekly',
    priority: 0.9,
    keywords: [...KEYWORDS.faculties, 'Federal University Wukari department list'],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Faculties', path: '/faculties' }],
    schema: 'itemList'
  },

  '/courses': {
    title: 'FUW Courses & Academic Programs | Federal University Wukari',
    description: `Search the ${C} Federal University Wukari course codes with their levels, semesters and departments, then jump straight to the lecture notes and past questions for each course.`,
    path: '/courses',
    changefreq: 'weekly',
    priority: 0.9,
    keywords: [...KEYWORDS.courses, 'Federal University Wukari course list'],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Courses', path: '/courses' }],
    schema: 'itemList'
  },

  '/repository': {
    title: 'FUW Institutional Repository | Theses, Projects & Papers',
    description:
      'The Federal University Wukari institutional repository archive of final-year projects, theses, dissertations, journal articles and conference papers produced by the FUW academic community.',
    path: '/repository',
    changefreq: 'weekly',
    priority: 0.8,
    keywords: [...KEYWORDS.repository, 'Federal University Wukari research archive'],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Repository', path: '/repository' }],
    schema: 'collectionPage'
  },

  '/collections': {
    title: 'Curated Study Collections | FUW E-Library',
    description:
      'Curated reading collections assembled by FUW librarians: grouped lecture notes, past questions and research that map directly onto a course, a semester or an exam revision plan.',
    path: '/collections',
    changefreq: 'weekly',
    priority: 0.7,
    keywords: [...KEYWORDS.collections, 'FUW reading lists'],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Collections', path: '/collections' }],
    schema: 'collectionPage'
  },

  '/help': {
    title: 'Help & Library Services | FUW E-Library',
    description:
      'How to search, read, cite and download from the Federal University Wukari digital library: verification, access plans, repository submission, copyright reporting and answers to common questions.',
    path: '/help',
    changefreq: 'monthly',
    priority: 0.6,
    keywords: [...KEYWORDS.help, 'FUW library support'],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Help', path: '/help' }],
    schema: 'webPage'
  },

  '/about': {
    title: 'About the FUW E-Library | What It Is & How It Works',
    description:
      'What the FUW E-Library is, who it serves and how academic material is verified before publication: the digital library of Federal University Wukari, Wukari, Taraba State.',
    path: '/about',
    changefreq: 'monthly',
    priority: 0.5,
    keywords: [...KEYWORDS.brand, ...KEYWORDS.university],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'About', path: '/about' }],
    schema: 'webPage'
  },

  '/contact': {
    title: 'Contact the Library Helpdesk | FUW E-Library',
    description:
      'Reach the Federal University Wukari library helpdesk for account access, document requests, repository submissions and copyright or takedown reports.',
    path: '/contact',
    changefreq: 'monthly',
    priority: 0.5,
    keywords: ['FUW library contact', 'Federal University Wukari library helpdesk'],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Contact', path: '/contact' }],
    schema: 'webPage'
  },

  '/accommodation': {
    title: 'FUW Accommodation & Student Lodges | Federal University Wukari',
    description:
      'Search verified student hostels, self-contained rooms, flats and shared lodges around Federal University Wukari campus with anti-scam protection and caretaker verification.',
    path: '/accommodation',
    changefreq: 'daily',
    priority: 0.9,
    keywords: [
      'FUW accommodation',
      'FUW student hostels',
      'lodges near Federal University Wukari',
      'FUW off campus housing',
      'self contained rooms Wukari'
    ],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Accommodation', path: '/accommodation' }],
    schema: 'itemList'
  },

  '/accommodation/roommates': {
    title: 'Roommate Finder & Student Matching | FUW Accommodation',
    description:
      'Connect with verified Federal University Wukari students looking to share lodge rent and accommodation costs. Filter by gender preference, budget, and location.',
    path: '/accommodation/roommates',
    changefreq: 'daily',
    priority: 0.85,
    keywords: [
      'FUW roommate finder',
      'find roommate Federal University Wukari',
      'FUW student roommates',
      'shared student lodge Wukari',
      'FUW accommodation matching'
    ],
    indexability: 'index',
    breadcrumbs: [
      HOME_CRUMB,
      { name: 'Accommodation', path: '/accommodation' },
      { name: 'Roommate Finder', path: '/accommodation/roommates' }
    ],
    schema: 'itemList'
  },

  '/marketplace': {
    title: 'FUW Student Marketplace | Federal University Wukari Campus Commerce',
    description:
      'Buy and sell products and campus services safely within the Federal University Wukari community. Textbooks, gadgets, fashion, food, laundry and trusted student vendors.',
    path: '/marketplace',
    changefreq: 'daily',
    priority: 0.9,
    keywords: [
      'FUW student marketplace',
      'buy and sell FUW',
      'Federal University Wukari student vendors',
      'campus commerce Wukari',
      'student textbooks Wukari'
    ],
    indexability: 'index',
    breadcrumbs: [HOME_CRUMB, { name: 'Marketplace', path: '/marketplace' }],
    schema: 'itemList'
  },

  '/marketplace/browse': {
    title: 'Browse Campus Products & Services | FUW Marketplace',
    description:
      'Discover verified student products and services at Federal University Wukari. Search textbooks, gadgets, housing supplies, and services by category and price.',
    path: '/marketplace/browse',
    changefreq: 'daily',
    priority: 0.85,
    keywords: [
      'browse FUW marketplace',
      'FUW campus listings',
      'student items Wukari'
    ],
    indexability: 'index',
    breadcrumbs: [
      HOME_CRUMB,
      { name: 'Marketplace', path: '/marketplace' },
      { name: 'Browse', path: '/marketplace/browse' }
    ],
    schema: 'itemList'
  }
} as const;

/**
 * Reachable by humans but not part of the indexable surface: they are
 * thin, transactional or private. These are rendered with
 * `noindex, follow` and never appear in sitemap.xml.
 */
export const NOINDEX_ROUTES: Record<string, PageMeta> = {
  '/marketplace/cart': {
    title: 'Shopping Cart | FUW Marketplace',
    description: 'Review your selected items before checkout.',
    path: '/marketplace/cart',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Marketplace', path: '/marketplace' }, { name: 'Cart', path: '/marketplace/cart' }],
    schema: 'none'
  },
  '/marketplace/checkout': {
    title: 'Secure Checkout | FUW Marketplace',
    description: 'Complete your purchase with student escrow protection.',
    path: '/marketplace/checkout',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Marketplace', path: '/marketplace' }, { name: 'Checkout', path: '/marketplace/checkout' }],
    schema: 'none'
  },
  '/marketplace/orders': {
    title: 'Orders | FUW Marketplace',
    description: 'Track your campus orders and deliveries.',
    path: '/marketplace/orders',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Marketplace', path: '/marketplace' }, { name: 'Orders', path: '/marketplace/orders' }],
    schema: 'none'
  },
  '/marketplace/wallet': {
    title: 'Student Wallet | FUW Platform',
    description: 'Manage your platform balance, bank withdrawals, and payments.',
    path: '/marketplace/wallet',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Wallet', path: '/marketplace/wallet' }],
    schema: 'none'
  },
  '/repository/submit': {
    title: 'Submit to the Repository | FUW E-Library',
    description: 'Submit a final-year project, thesis or publication to the Federal University Wukari institutional repository.',
    path: '/repository/submit',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Repository', path: '/repository' }, { name: 'Submit', path: '/repository/submit' }],
    schema: 'none'
  },
  '/report-problem': {
    title: 'Report a Problem | FUW E-Library',
    description: 'Report a missing, broken or incorrect academic resource in the FUW E-Library.',
    path: '/report-problem',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Report a problem', path: '/report-problem' }],
    schema: 'none'
  },
  '/report-copyright': {
    title: 'Report a Copyright Issue | FUW E-Library',
    description: 'Submit a copyright or takedown request for material hosted in the FUW E-Library.',
    path: '/report-copyright',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Report copyright', path: '/report-copyright' }],
    schema: 'none'
  },
  '/404': {
    title: 'Page Not Found | FUW E-Library',
    description: 'That page does not exist in the FUW E-Library. Use the directory below to reach the library, faculties, courses or the repository.',
    path: '/404',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Not found', path: '/404' }],
    schema: 'none'
  }
} as const;

/**
 * Authentication and account routes. These must never be indexed: they
 * are thin, transactional and account-specific. `noindex, nofollow` plus
 * the route gate is what keeps them out of results; the Supabase session
 * and RLS are what actually protect the data behind them.
 */
export const PRIVATE_ROUTES: Record<string, PageMeta> = {
  '/hub': {
    title: 'FUW Campus Hub | Your gateway to everything in FUW',
    description: 'Central authenticated gateway to Federal University Wukari digital services: E-Library, Marketplace, and Accommodation.',
    path: '/hub',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB, { name: 'Campus Hub', path: '/hub' }],
    schema: 'none'
  },
  '/': {
    title: 'Sign In | FUW E-Library',
    description: 'Sign in to continue to your Federal University Wukari E-Library dashboard.',
    path: '/',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [],
    schema: 'none'
  },
  '/home': {
    title: 'Home | FUW E-Library',
    description: 'Your authenticated FUW E-Library homepage.',
    path: '/home',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/login': {
    title: 'Sign In | FUW Campus Hub',
    description: 'Sign in to your Federal University Wukari Campus Hub account.',
    path: '/login',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/register': {
    title: 'Create an Account | FUW Campus Hub',
    description: 'Register for a Federal University Wukari Campus Hub student account.',
    path: '/register',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/forgot-password': {
    title: 'Reset Your Password | FUW Campus Hub',
    description: 'Request a password reset link for your FUW Campus Hub account.',
    path: '/forgot-password',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/reset-password': {
    title: 'Choose a New Password | FUW Campus Hub',
    description: 'Choose a new password for your FUW Campus Hub account.',
    path: '/reset-password',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/admin/login': {
    title: 'Administrator Sign In | FUW Campus Hub',
    description: 'Administrator sign-in for the FUW Campus Hub management portal.',
    path: '/admin/login',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/super/login': {
    title: 'Super Admin Sign In | FUW Campus Hub',
    description: 'Super administrator sign-in for the FUW Campus Hub management portal.',
    path: '/super/login',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  }
} as const;

/**
 * Authenticated portals. The canonical is intentionally left blank
 * (indexability `noindex`) — these URLs must never appear in a sitemap,
 * and any accidental discovery is discarded via the robots meta tag.
 */
export const PORTAL_ROUTES: Record<string, PageMeta> = {
  '/student': {
    title: 'Student Portal | FUW E-Library',
    description: 'Private student dashboard.',
    path: '/student',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/admin': {
    title: 'Administration Portal | FUW E-Library',
    description: 'Private library administration portal.',
    path: '/admin',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/super': {
    title: 'Platform Governance | FUW E-Library',
    description: 'Private platform governance portal.',
    path: '/super',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  },
  '/maintenance': {
    title: 'Maintenance | FUW E-Library',
    description: 'The FUW E-Library is temporarily unavailable.',
    path: '/maintenance',
    keywords: [],
    indexability: 'noindex',
    breadcrumbs: [HOME_CRUMB],
    schema: 'none'
  }
} as const;

/** Look up any static route's metadata (public, noindex, private, portal). */
export function staticMetaFor(path: string): PageMeta | null {
  const key = path.replace(/\/+$/, '') || '/';
  return (
    PUBLIC_ROUTES[key] ||
    NOINDEX_ROUTES[key] ||
    PRIVATE_ROUTES[key] ||
    PORTAL_ROUTES[key] ||
    null
  );
}

/** Ordered list of indexable static paths (sitemap order). */
export function indexableStaticPaths(): string[] {
  return Object.values(PUBLIC_ROUTES).map((meta) => meta.path);
}

/**
 * Crawl policy for any pathname the app can render.
 *
 * Anything not explicitly recognised as a public, content-bearing page is
 * treated as non-indexable. That default matters: a route added later
 * without SEO metadata is excluded from the index rather than accidentally
 * published (seo.md §3, §36).
 */
export function isIndexablePath(pathname: string): boolean {
  const path = normalizePath(pathname);

  if (PUBLIC_ROUTES[path]) return true;

  // Dynamic public detail pages — only indexable when the record resolves.
  const faculty = /^\/faculties\/([^/]+)$/.exec(path);
  if (faculty) return Boolean(findFacultyBySlug(faculty[1]));

  const department = /^\/departments\/([^/]+)$/.exec(path);
  if (department) return Boolean(findDepartmentBySlug(department[1]));

  const course = /^\/courses\/([^/]+)$/.exec(path);
  if (course) return Boolean(findCourseByCode(course[1]));

  // Database-backed public records. The page itself resolves the record and
  // renders the not-found view (which noindexes) when it does not exist.
  if (/^\/materials\/[^/]+$/.test(path)) return true;

  // `/repository/submit` is an authenticated submission form, not a record.
  const repositoryRecord = /^\/repository\/([^/]+)$/.exec(path);
  if (repositoryRecord) return repositoryRecord[1] !== 'submit';

  const collectionRecord = /^\/collections\/([^/]+)$/.exec(path);
  if (collectionRecord) return collectionRecord[1] !== 'submit';

  // Dynamic accommodation property detail pages (exclude static /accommodation/roommates)
  const accommodationRecord = /^\/accommodation\/([^/]+)$/.exec(path);
  if (accommodationRecord) return accommodationRecord[1] !== 'roommates';

  return false;
}

/**
 * Robustness default for any route that has not declared metadata.
 * Unknown routes must never be indexable by accident.
 */
export const FALLBACK_META: PageMeta = {
  title: 'FUW E-Library',
  description:
    'The digital library of Federal University Wukari: verified lecture notes, past questions, handouts and research materials for students of the university.',
  path: '/',
  keywords: [...KEYWORDS.brand],
  indexability: 'noindex',
  breadcrumbs: [HOME_CRUMB],
  schema: 'none'
};