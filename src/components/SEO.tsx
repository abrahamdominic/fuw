import { Helmet } from 'react-helmet-async';
import {
  DEFAULT_OG_IMAGE,
  OG_IMAGE_ALT,
  SITE_NAME,
  SITE_URL,
  THEME_COLOR,
  UNIVERSITY_NAME,
  absoluteUrl,
  normalizePath
} from '../lib/seo/site';
import {
  FALLBACK_META,
  NOINDEX_ROUTES,
  PORTAL_ROUTES,
  PRIVATE_ROUTES,
  PUBLIC_ROUTES,
  type Crumb,
  type PageMeta,
  type SchemaKind
} from '../lib/seo/routes';
import { buildGraph } from '../lib/seo/schema';

/** One meta description cap — anything longer is truncated by every engine. */
const MAX_DESCRIPTION = 300;

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
/** Default for private/auth/404 pages: keep it out of the index, but still let
 *  crawlers follow the internal links so the public pages stay discoverable. */
const ROBOTS_NOINDEX_FOLLOW = 'noindex, follow';
const ROBOTS_NOINDEX_NOFOLLOW = 'noindex, nofollow, noarchive';

/**
 * Build a full page-metadata object from a `PageMeta` shape. Detail pages
 * pass their own title/description/canonical; static pages resolve from
 * the shared registry so there is exactly one source of truth.
 */
export interface SEOProps {
  title?: string;
  description?: string;
  /** Root-relative or absolute path used for the canonical + og:url. */
  path?: string;
  /** Terms this page serves. Keep short and page-specific. */
  keywords?: string[];
  noindex?: boolean;
  /** Force `noindex, follow` (auth, transactional and portal pages). */
  follow?: boolean;
  breadcrumbs?: Crumb[];
  schema?: SchemaKind;
  schemaData?: Record<string, unknown> | null;
  /** ItemList entries when `schema` is `itemList`. */
  schemaItems?: Array<{ name: string; path: string }>;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  /** Escape hatch: replace the whole metadata object. */
  meta?: PageMeta;
}

function resolveMeta(props: SEOProps): PageMeta {
  if (props.meta) return props.meta;

  const path = normalizePath(props.path ?? '/');
  const registry =
    PUBLIC_ROUTES[path] || NOINDEX_ROUTES[path] || PRIVATE_ROUTES[path] || PORTAL_ROUTES[path] || null;

  if (!props.title && registry) {
    // Static route: registry metadata verbatim (unless overridden).
    const merged: PageMeta = { ...registry };
    if (props.description) merged.description = props.description;
    if (props.keywords) merged.keywords = props.keywords;
    if (props.noindex === true) merged.indexability = 'noindex';
    if (props.breadcrumbs) merged.breadcrumbs = props.breadcrumbs;
    if (props.image) merged.image = props.image;
    if (props.imageAlt) merged.imageAlt = props.imageAlt;
    return merged;
  }

  const base: PageMeta = registry || FALLBACK_META;
  return {
    ...base,
    title: props.title || base.title,
    description: props.description || base.description,
    keywords: props.keywords || base.keywords,
    path,
    breadcrumbs: props.breadcrumbs || [base.breadcrumbs[0], { name: props.title || base.title, path }],
    schema: props.schema ?? base.schema,
    schemaData: props.schemaData ?? null,
    image: props.image || base.image,
    imageAlt: props.imageAlt || base.imageAlt,
    ogType: props.type || base.ogType,
    indexability: props.noindex === true ? 'noindex' : base.indexability
  };
}

/**
 * Page-level <head> for the client-rendered app.
 *
 * Every indexable page gets a unique title, description and canonical
 * URL; every private, authentication or transactional route is explicitly
 * `noindex`. Static route shells written at build time carry the same
 * values, so crawlers that do not execute JavaScript still see the
 * correct metadata (seo.md §28).
 */
export function SEO(props: SEOProps) {
  const meta = resolveMeta(props);
  const canonicalUrl = absoluteUrl(normalizePath(meta.path));
  const description =
    meta.description.length > MAX_DESCRIPTION
      ? `${meta.description.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
      : meta.description;

  const noindex = meta.indexability === 'noindex';
  const robots = noindex
    ? props.follow === false
      ? ROBOTS_NOINDEX_NOFOLLOW
      : ROBOTS_NOINDEX_FOLLOW
    : ROBOTS_INDEX;

  const ogType = meta.ogType || props.type || 'website';
  const imagePath = meta.image || DEFAULT_OG_IMAGE;
  const imageUrl = absoluteUrl(imagePath);
  const imageAlt = meta.imageAlt || OG_IMAGE_ALT;

  const graph = buildGraph(meta, props.schemaItems);

  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="title" content={meta.title} />
      <meta name="description" content={description} />
      {meta.keywords.length > 0 && <meta name="keywords" content={meta.keywords.join(', ')} />}
      {/* A canonical on a noindex page would point every missing, private and
          filtered URL at one arbitrary address. Only indexable pages declare
          a canonical. */}
      {!noindex && <link rel="canonical" href={canonicalUrl} />}
      <meta name="robots" content={robots} />
      <meta name="googlebot" content={robots} />

      {/* Authorship, language and site identity */}
      <meta name="author" content={`${UNIVERSITY_NAME} Library`} />
      <meta httpEquiv="content-language" content="en-NG" />
      <meta name="theme-color" content={THEME_COLOR} />
      <meta name="color-scheme" content="light" />
      {!noindex && <link rel="alternate" hrefLang="en-NG" href={canonicalUrl} />}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:locale" content="en_NG" />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:secure_url" content={imageUrl} />
      <meta
        property="og:image:type"
        content={imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png'}
      />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={imageAlt} />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={imageAlt} />

      {/* Structured data */}
      <script type="application/ld+json">{JSON.stringify(graph)}</script>
    </Helmet>
  );
}

export { SITE_URL };