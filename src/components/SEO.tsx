import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'FUW E-Library';
const DEFAULT_DESCRIPTION =
  'Federal University Wukari Digital E-Library — access verified lecture notes, test & exam past questions, handouts, and research materials across all faculties and departments.';
const DEFAULT_KEYWORDS =
  'FUW, Federal University Wukari, e-library, digital repository, lecture notes, past questions, test past questions, exam past questions, handouts, research materials, Nigerian university library, Taraba State';
const SITE_URL = 'https://fuwtest.netlify.app';
const OG_IMAGE = '/images/Fuw.png';

interface ArticleMetadata {
  datePublished?: string;
  author?: string;
}

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
  article?: ArticleMetadata;
}

export function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  keywords = DEFAULT_KEYWORDS,
  path = '/',
  image = OG_IMAGE,
  type = 'website',
  noindex = false,
  article
}: SEOProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const canonicalUrl = `${SITE_URL}${path}`;
  const imageUrl = image.startsWith('http') ? image : `${SITE_URL}${image}`;
  const robots = noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-image-preview:large, max-snippet:-1';

  // Warning: react-helmet-async escapes JSON-LD; keep the payload compact.
  let structuredData: string | null = null;

  if (type === 'article') {
    structuredData = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      headline: title || SITE_NAME,
      description,
      inLanguage: 'en',
      url: canonicalUrl,
      image: imageUrl,
      ...(article?.datePublished ? { datePublished: article.datePublished } : {}),
      ...(article?.author
        ? { author: { '@type': 'Organization', name: article.author } }
        : {}),
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        logo: { '@type': 'ImageObject', url: `${SITE_URL}${OG_IMAGE}` }
      },
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
      educationalUse: 'assignment',
      learningResourceType: 'study material'
    });
  } else if (path === '/') {
    // Home page: WebSite + EducationalOrganization structured data
    structuredData = JSON.stringify([
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        alternateName: 'Federal University Wukari Digital Library',
        url: SITE_URL,
        description,
        inLanguage: 'en',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/library?q={search_term_string}`
          },
          'query-input': 'required name=search_term_string'
        },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL }
      },
      {
        '@context': 'https://schema.org',
        '@type': 'EducationalOrganization',
        name: 'Federal University Wukari',
        alternateName: 'FUW',
        url: SITE_URL,
        description,
        inLanguage: 'en',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}${OG_IMAGE}` },
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Wukari',
          addressRegion: 'Taraba State',
          addressCountry: 'NG'
        },
        sameAs: ['https://www.fuwukari.edu.ng']
      }
    ]);
  }

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      <link rel="canonical" href={canonicalUrl} />
      <meta name="robots" content={robots} />

      {/* Authorship & language */}
      <meta name="author" content="Federal University Wukari ICT Unit" />
      <meta httpEquiv="content-language" content="en-NG" />

      {/* Mobile / theme */}
      <meta name="theme-color" content="#0B6B3A" />
      <meta name="color-scheme" content="light" />

      {/* Open Graph */}
      <meta property="og:type" content={type === 'article' ? 'article' : 'website'} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="en_NG" />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={fullTitle} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={fullTitle} />

      {structuredData && (
        <script type="application/ld+json">{structuredData}</script>
      )}
    </Helmet>
  );
}
