import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Crumb } from '../lib/seo/routes';

/**
 * Visible breadcrumb trail. The `BreadcrumbList` JSON-LD that mirrors it
 * is emitted by the page's <SEO> call, so both stay in sync because they
 * read the same `Crumb[]`.
 *
 * The last crumb is the current page: it is rendered as plain text (not a
 * link) so the trail never contains a self-referential anchor.
 */
export function Breadcrumbs({ trail, className = 'crumb' }: { trail: Crumb[]; className?: string }) {
  if (!trail || trail.length < 2) return null;

  return (
    <nav className={className} aria-label="Breadcrumb">
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        return (
          <React.Fragment key={`${crumb.path}-${i}`}>
            {i > 0 && (
              <ChevronRight size={14} aria-hidden="true" className="crumb-sep" />
            )}
            {isLast ? (
              <span className="crumb-current" aria-current="page">
                {crumb.name}
              </span>
            ) : (
              <Link to={crumb.path}>{crumb.name}</Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}