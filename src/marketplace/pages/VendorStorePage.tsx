import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Store,
  CheckCircle,
  Star,
  MapPin,
  Phone,
  MessageSquare,
  Package,
  Clock,
} from 'lucide-react';
import { fetchVendorByIdOrSlug, fetchProducts, fetchVendorReviews, startConversation } from '../lib/api';
import type { MarketplaceVendor, MarketplaceProduct, MarketplaceReview } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';
import { scrollToTop } from '../lib/scroll';

export const VendorStorePage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [vendor, setVendor] = useState<MarketplaceVendor | null>(null);
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [reviews, setReviews] = useState<MarketplaceReview[]>([]);
  const [activeTab, setActiveTab] = useState<'products' | 'services' | 'reviews'>('products');
  const [loading, setLoading] = useState(true);
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    async function load() {
      if (!slug) return;
      setLoading(true);
      try {
        const v = await fetchVendorByIdOrSlug(slug);
        setVendor(v);
        if (v) {
          const [prodsRes, revs] = await Promise.all([
            fetchProducts({ vendorId: v.id }, 1, 30),
            fetchVendorReviews(v.id),
          ]);
          setProducts(prodsRes.products);
          setReviews(revs);
        }
      } catch (err) {
        console.error('Error loading vendor store:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
    scrollToTop();
  }, [slug]);

  const isOwner = Boolean(user && vendor && vendor.owner_id === user.id);

  const handleStartChat = async () => {
    if (!user) {
      toast('Please sign in to message this vendor', 'info');
      navigate(PLATFORM_PATHS.login);
      return;
    }
    if (!vendor) return;
    if (isOwner) {
      navigate(mpPath('/vendor/dashboard'));
      return;
    }
    setChatBusy(true);
    try {
      const conv: any = await startConversation(vendor.id);
      navigate(mpPath(`/messages?conversationId=${conv?.id || conv}`));
    } catch (err: any) {
      toast(err.message || 'Unable to open conversation', 'error');
    } finally {
      setChatBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px 0 60px' }}>
        <Skeleton height={200} borderRadius={16} style={{ marginBottom: 24 }} />
        <Skeleton height={40} width="60%" style={{ marginBottom: 12 }} />
        <Skeleton height={20} width="40%" style={{ marginBottom: 24 }} />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <h2>Vendor Storefront Not Found</h2>
        <p style={{ color: 'var(--text-secondary, #55675b)' }}>
          This vendor may have closed or does not exist.
        </p>
        <Link to={mpPath("/browse")} className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
          Explore Marketplace
        </Link>
      </div>
    );
  }

  const physicalProducts = products.filter((p) => !p.is_service);
  const campusServices = products.filter((p) => p.is_service);

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Vendor Header Banner */}
      <div
        style={{
          borderRadius: 16,
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          overflow: 'hidden',
          marginBottom: 32,
        }}
      >
        {/* Banner Image or Graphic Header */}
        <div
          style={{
            height: 160,
            background: vendor.banner_url
              ? `url(${vendor.banner_url}) center/cover no-repeat`
              : 'linear-gradient(135deg, var(--green-900, #0d4a2f) 0%, var(--green-700, #0f6b41) 100%)',
            position: 'relative',
          }}
        />

        {/* Store Profile Info */}
        <div style={{ padding: '0 28px 24px', position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              marginTop: -44,
              marginBottom: 16,
            }}
          >
            {/* Logo */}
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                background: '#ffffff',
                border: '4px solid #ffffff',
                boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {vendor.logo_url ? (
                <img src={vendor.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Store size={44} color="var(--green-800, #12603d)" />
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              {isOwner ? (
                <Link
                  to={mpPath("/vendor/dashboard")}
                  className="btn btn-primary"
                  style={{ padding: '9px 18px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                >
                  <Store size={16} />
                  <span>Manage Store</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleStartChat}
                  disabled={chatBusy}
                  className="btn btn-primary"
                  style={{ padding: '9px 18px', fontSize: 14 }}
                >
                  <MessageSquare size={16} />
                  <span>Contact Store</span>
                </button>
              )}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
                {vendor.store_name}
              </h1>
              {vendor.is_verified && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#d1fae5', color: '#065f46', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                  <CheckCircle size={14} color="#12603d" /> Verified Vendor
                </span>
              )}
            </div>

            {vendor.tagline && (
              <p style={{ margin: '0 0 10px', fontSize: 15, color: 'var(--text-secondary, #55675b)' }}>
                {vendor.tagline}
              </p>
            )}

            {/* Metrics Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 13, color: 'var(--text-secondary, #55675b)', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, color: '#b45309' }}>
                <Star size={15} fill="#b45309" color="#b45309" />
                {Number(vendor.rating_avg) > 0 ? Number(vendor.rating_avg).toFixed(1) : 'New'} ({reviews.length} reviews)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Package size={15} />
                {vendor.completed_orders_count || 0} completed orders
              </span>
              {vendor.campus_area && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <MapPin size={15} />
                  {vendor.campus_area}
                </span>
              )}
              {vendor.phone && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Phone size={15} />
                  {vendor.phone}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border, #dcebe0)', marginBottom: 28 }}>
        <button
          type="button"
          onClick={() => setActiveTab('products')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'products' ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
            color: activeTab === 'products' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Products ({physicalProducts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('services')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'services' ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
            color: activeTab === 'services' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Services ({campusServices.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reviews')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'reviews' ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
            color: activeTab === 'reviews' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Reviews ({reviews.length})
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'products' && (
        <div>
          {physicalProducts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--surface, #ffffff)', borderRadius: 12, border: '1px dashed var(--border, #dcebe0)' }}>
              <Package size={36} color="var(--muted, #55675b)" style={{ marginBottom: 10 }} />
              <p style={{ margin: 0, color: 'var(--text-secondary, #55675b)' }}>This vendor has no active physical products.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 16 }}>
              {physicalProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'services' && (
        <div>
          {campusServices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--surface, #ffffff)', borderRadius: 12, border: '1px dashed var(--border, #dcebe0)' }}>
              <Clock size={36} color="var(--muted, #55675b)" style={{ marginBottom: 10 }} />
              <p style={{ margin: 0, color: 'var(--text-secondary, #55675b)' }}>This vendor has no active service listings.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 16 }}>
              {campusServices.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'reviews' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {reviews.length === 0 ? (
            <p style={{ color: 'var(--muted, #55675b)' }}>No reviews yet for this storefront.</p>
          ) : (
            reviews.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: '16px',
                  borderRadius: 12,
                  background: 'var(--surface, #ffffff)',
                  border: '1px solid var(--border, #dcebe0)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{r.reviewer?.full_name || 'Student'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} size={14} fill={i < r.rating ? '#b45309' : 'none'} color={i < r.rating ? '#b45309' : '#d1d5db'} />
                    ))}
                  </div>
                </div>
                {r.title && <h5 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{r.title}</h5>}
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary, #17231d)', lineHeight: 1.5 }}>{r.body}</p>
                {r.vendor_reply && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--surface-alt, #f4f8f5)', borderRadius: 6, fontSize: 13, borderLeft: '3px solid var(--green-800, #12603d)' }}>
                    <strong>Store Response:</strong> {r.vendor_reply}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
