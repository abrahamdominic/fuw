import React from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, TrendingUp } from 'lucide-react';
import type { VisibleAdvert } from '../lib/types';
import { formatNaira } from '../lib/format';

/**
 * A paid placement. The server has already decided whether this viewer is
 * entitled to see it, so there is nothing to filter here and nothing that a
 * client could change to widen the audience.
 */
export const AdvertCard: React.FC<{ advert: VisibleAdvert }> = ({ advert }) => {
  const href = advert.product_slug
    ? `/product/${advert.product_slug}`
    : `/store/${advert.vendor_slug}`;

  return (
    <Link
      to={href}
      style={{
        display: 'flex',
        gap: 14,
        padding: 14,
        borderRadius: 14,
        border: '1px solid var(--border, #dcebe0)',
        background: 'var(--surface, #ffffff)',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {advert.product_image && (
        <img
          src={advert.product_image}
          alt={advert.product_title ?? advert.shop_name}
          loading="lazy"
          style={{
            width: 84,
            height: 84,
            objectFit: 'cover',
            borderRadius: 10,
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: advert.advert_type === 'sponsored' ? '#8a5a00' : 'var(--text-secondary, #55675b)',
          }}
        >
          {advert.advert_type === 'sponsored' ? <Megaphone size={11} /> : <TrendingUp size={11} />}
          {advert.advert_type === 'sponsored' ? 'Sponsored' : 'Featured'}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.35 }}>
          {advert.product_title ?? advert.shop_name}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
          {advert.product_title ? `by ${advert.shop_name}` : 'Storefront promotion'}
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>
          {formatNaira(advert.product_price_kobo ?? advert.price_kobo)}
        </span>
      </div>
    </Link>
  );
};

interface AdvertStripProps {
  title: string;
  adverts: VisibleAdvert[];
}

/** A labelled row of placements, or nothing at all when there are none. */
export const AdvertStrip: React.FC<AdvertStripProps> = ({ title, adverts }) => {
  if (adverts.length === 0) return null;

  return (
    <section style={{ margin: '28px 0' }}>
      <h2
        style={{
          margin: '0 0 12px',
          fontSize: 15,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Megaphone size={16} color="var(--green-800, #12603d)" />
        {title}
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
          gap: 12,
        }}
      >
        {adverts.map((advert) => (
          <AdvertCard key={advert.id} advert={advert} />
        ))}
      </div>
    </section>
  );
};