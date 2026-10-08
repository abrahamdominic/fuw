import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Star, CheckCircle, MapPin, ShoppingBag } from 'lucide-react';
import type { MarketplaceProduct } from '../lib/types';
import { formatNaira, formatCondition, resolveProductImageUrl } from '../lib/format';
import { useCart } from '../lib/cart';
import { useToast } from './Toast';
import { toggleFavourite } from '../lib/api';
import { useAuth } from '../lib/auth';
import { mpPath } from '../lib/routes';
import { VerifiedScholarBadge } from './VerifiedScholarBadge';

interface ProductCardProps {
  product: MarketplaceProduct;
  isFavouritedInitial?: boolean;
}

export function getProductFallbackImage(product: Partial<MarketplaceProduct> & { category_slug?: string }): string {
  const title = (product.title || '').toLowerCase();
  const cat = (product.category_slug || product.category_id || '').toLowerCase();

  if (product.is_service || cat.includes('service') || title.includes('barb') || title.includes('braid') || title.includes('tutor') || title.includes('print')) {
    return 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=600&q=80';
  }
  if (cat.includes('book') || cat.includes('academic') || title.includes('book') || title.includes('handout') || title.includes('material') || title.includes('past question')) {
    return 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80';
  }
  if (cat.includes('electronic') || cat.includes('gadget') || title.includes('calc') || title.includes('laptop') || title.includes('phone') || title.includes('charger')) {
    return 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80';
  }
  if (cat.includes('food') || cat.includes('snack') || title.includes('food') || title.includes('rice') || title.includes('cake') || title.includes('snack')) {
    return 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80';
  }
  if (cat.includes('fashion') || cat.includes('cloth') || title.includes('bag') || title.includes('shoe') || title.includes('shirt') || title.includes('wear')) {
    return 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80';
  }
  return 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=600&q=80';
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  isFavouritedInitial = false,
}) => {
  const { user } = useAuth();
  const { addItem } = useCart();
  const { toast } = useToast();
  const [isFav, setIsFav] = useState(isFavouritedInitial);
  const [favLoading, setFavLoading] = useState(false);

  const fallback = getProductFallbackImage(product);
  const resolved = resolveProductImageUrl(
    product.thumbnail_url || (product as any).thumbnail_path || product.images?.[0]?.url || (product.images?.[0] as any)?.storage_path
  );
  const initialThumbnail = resolved || fallback;
  const [imgSrc, setImgSrc] = useState(initialThumbnail);

  React.useEffect(() => {
    setImgSrc(initialThumbnail);
  }, [initialThumbnail]);

  const handleToggleFav = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast('Please sign in to save favourites', 'info');
      return;
    }
    setFavLoading(true);
    try {
      const res: any = await toggleFavourite(product.id);
      setIsFav(res?.favourited);
      toast(res?.favourited ? 'Saved to favourites' : 'Removed from favourites', 'success');
    } catch {
      toast('Unable to update favourites', 'error');
    } finally {
      setFavLoading(false);
    }
  };

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(product, undefined, 1);
    toast(`Added "${product.title}" to cart`, 'success');
  };

  return (
    <div
      className="product-card"
      style={{
        background: 'var(--surface, #ffffff)',
        borderRadius: 12,
        border: '1px solid var(--border, #dcebe0)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* Thumbnail area */}
      <Link
        to={mpPath(`/product/${product.slug || product.id}`)}
        style={{
          position: 'relative',
          display: 'block',
          width: '100%',
          paddingTop: '75%', // 4:3 aspect ratio
          background: 'var(--surface-alt, #f4f8f5)',
          overflow: 'hidden',
        }}
      >
        <img
          src={imgSrc}
          alt={product.title}
          loading="lazy"
          onError={() => {
            if (imgSrc !== fallback) {
              setImgSrc(fallback);
            }
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        {/* Condition / Service Badge */}
        <span
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            padding: '3px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.02em',
            background: product.is_service ? '#e0f2fe' : 'rgba(255, 255, 255, 0.94)',
            color: product.is_service ? '#0369a1' : 'var(--green-900, #0d4a2f)',
            backdropFilter: 'blur(4px)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}
        >
          {product.is_service ? 'CAMPUS SERVICE' : formatCondition(product.condition)}
        </span>

        {/* Favourite Button */}
        <button
          type="button"
          onClick={handleToggleFav}
          disabled={favLoading}
          aria-label="Save favourite"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.92)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            color: isFav ? '#dc2626' : '#55675b',
            transition: 'transform 0.15s ease',
          }}
        >
          <Heart size={18} fill={isFav ? '#dc2626' : 'none'} />
        </button>
      </Link>

      {/* Content area */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        {/* Vendor info line */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
          <Link
            to={mpPath(`/vendor/${product.vendor?.slug || product.vendor_id}`)}
            style={{
              color: 'var(--text-secondary, #55675b)',
              fontWeight: 500,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              maxWidth: '75%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{product.vendor?.store_name || 'Vendor'}</span>
            <VerifiedScholarBadge
              isVerified={Boolean(product.vendor?.is_verified || (product.vendor as any)?.verification === 'verified')}
              isPremium={Boolean((product.vendor as any)?.is_premium)}
              size="sm"
            />
          </Link>

          {/* Rating */}
          {Number(product.rating_avg) > 0 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600, color: '#b45309', fontSize: 12 }}>
              <Star size={12} fill="#b45309" color="#b45309" />
              {Number(product.rating_avg).toFixed(1)}
            </span>
          ) : (
            <span style={{ color: 'var(--muted, #55675b)', fontSize: 11 }}>New</span>
          )}
        </div>

        {/* Title */}
        <h4
          style={{
            margin: '0 0 8px',
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.35,
            color: 'var(--text-primary, #17231d)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.7em',
          }}
        >
          <Link
            to={mpPath(`/product/${product.slug || product.id}`)}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {product.title}
          </Link>
        </h4>

        {/* Campus Location / Meeting point */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary, #55675b)', marginBottom: 12 }}>
          <MapPin size={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {product.campus_area || product.meeting_point || 'FUW Campus'}
          </span>
        </div>

        {/* Price & Action Row */}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border, #dcebe0)' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--green-900, #0d4a2f)' }}>
              {formatNaira(product.price_kobo)}
            </div>
            {Boolean(product.compare_at_kobo && product.compare_at_kobo > product.price_kobo) && (
              <span style={{ fontSize: 12, textDecoration: 'line-through', color: 'var(--muted, #55675b)' }}>
                {formatNaira(product.compare_at_kobo!)}
              </span>
            )}
          </div>

          {!product.is_service ? (
            <button
              type="button"
              onClick={handleQuickAdd}
              style={{
                background: 'var(--green-100, #e8f5ec)',
                color: 'var(--green-800, #12603d)',
                border: '1px solid var(--green-600, #17854f)',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'background 0.15s ease',
              }}
            >
              <ShoppingBag size={14} />
              <span>Add</span>
            </button>
          ) : (
            <Link
              to={mpPath(`/product/${product.slug || product.id}`)}
              style={{
                background: 'var(--green-800, #12603d)',
                color: '#ffffff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>Book</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
