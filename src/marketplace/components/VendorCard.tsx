import React from 'react';
import { Link } from 'react-router-dom';
import { Store, CheckCircle, Star, Package, MapPin } from 'lucide-react';
import type { MarketplaceVendor } from '../lib/types';
import { mpPath } from '../lib/routes';

interface VendorCardProps {
  vendor: MarketplaceVendor;
}

export const VendorCard: React.FC<VendorCardProps> = ({ vendor }) => {
  return (
    <Link
      to={mpPath(`/vendor/${vendor.slug || vendor.id}`)}
      style={{
        background: 'var(--surface, #ffffff)',
        borderRadius: 14,
        border: '1px solid var(--border, #dcebe0)',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'var(--surface-alt, #f4f8f5)',
            border: '2px solid var(--border, #dcebe0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {vendor.logo_url ? (
            <img src={vendor.logo_url} alt={vendor.store_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Store size={26} color="var(--green-800, #12603d)" />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #17231d)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {vendor.store_name}
            </h4>
            {vendor.is_verified && <CheckCircle size={15} color="#12603d" fill="#e8f5ec" />}
          </div>
          {vendor.tagline && (
            <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {vendor.tagline}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text-secondary, #55675b)', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border, #dcebe0)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#b45309' }}>
          <Star size={13} fill="#b45309" />
          {Number(vendor.rating_avg) > 0 ? Number(vendor.rating_avg).toFixed(1) : 'New'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Package size={13} />
          {vendor.completed_orders_count || 0} completed
        </span>
        {vendor.campus_area && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <MapPin size={13} />
            {vendor.campus_area}
          </span>
        )}
      </div>
    </Link>
  );
};
