import React from 'react';
import { useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { isIndexablePath } from '../lib/seo/routes';

/**
 * Crawl-policy backstop.
 *
 * Every page is expected to declare its own metadata, but a missing
 * `<SEO>` must never turn a private route into an indexable one. This
 * component evaluates the *route* and enforces the robots directive at the
 * router level, so authentication pages, the student dashboard, the admin
 * and super-admin portals, the maintenance screen and any future unknown
 * route are all explicitly `noindex, nofollow`.
 *
 * This is a crawler hint only. Access control itself is enforced by the
 * Supabase session, route guards and row-level security — never by robots.
 */
export function CrawlPolicyGuard() {
  const { pathname } = useLocation();

  if (isIndexablePath(pathname)) return null;

  return (
    <Helmet>
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <meta name="googlebot" content="noindex, nofollow, noarchive" />
      <meta name="bingbot" content="noindex, nofollow, noarchive" />
    </Helmet>
  );
}