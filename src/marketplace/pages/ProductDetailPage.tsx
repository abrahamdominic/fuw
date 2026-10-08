import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  Star,
  Truck,
  MapPin,
  MessageSquare,
  Heart,
  Share2,
  AlertTriangle,
  ShoppingBag,
  Store,
  ChevronRight,
} from 'lucide-react';
import { fetchProductByIdOrSlug, fetchProductReviews, startConversation, toggleFavourite, createReport } from '../lib/api';
import type { MarketplaceProduct, MarketplaceReview, MarketplaceProductVariant } from '../lib/types';
import { formatNaira, formatCondition, formatDate, resolveProductImageUrl } from '../lib/format';
import { useCart } from '../lib/cart';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { Skeleton } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { getProductFallbackImage } from '../components/ProductCard';
import { VerifiedScholarBadge } from '../components/VerifiedScholarBadge';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';
import { scrollToTop } from '../lib/scroll';

export const ProductDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addItem } = useCart();
  const { toast } = useToast();

  const [product, setProduct] = useState<MarketplaceProduct | null>(null);
  const [reviews, setReviews] = useState<MarketplaceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<MarketplaceProductVariant | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isFav, setIsFav] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  // Report modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('suspicious_listing');
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const p = await fetchProductByIdOrSlug(id);
        setProduct(p);
        if (p?.variants && p.variants.length > 0) {
          setSelectedVariant(p.variants[0]);
        }
        if (p) {
          const revs = await fetchProductReviews(p.id);
          setReviews(revs);
        }
      } catch (err) {
        console.error('Error loading product details:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
    scrollToTop();
  }, [id]);

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 36, padding: '24px 0 60px' }}>
        <Skeleton height={420} borderRadius={16} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton height={32} width="80%" />
          <Skeleton height={24} width="40%" />
          <Skeleton height={120} />
          <Skeleton height={48} />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <h2>Listing Not Found</h2>
        <p style={{ color: 'var(--text-secondary, #55675b)' }}>
          This product or service may have been delisted, sold out or deleted by the vendor.
        </p>
        <Link to={mpPath("/browse")} className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
          Browse Marketplace
        </Link>
      </div>
    );
  }

  const rawImages = product.images && product.images.length > 0
    ? product.images
    : (product.thumbnail_url || (product as any).thumbnail_path)
    ? [{ id: 'thumb', url: product.thumbnail_url || '', is_primary: true, sort_order: 0, product_id: product.id, storage_path: (product as any).thumbnail_path || '' }]
    : [];

  const images = rawImages.map((img: any) => ({
    ...img,
    resolvedUrl: resolveProductImageUrl(img.url || img.storage_path)
  }));

  const currentPrice = selectedVariant?.price_kobo ?? product.price_kobo;
  const currentCompareAt = selectedVariant?.compare_at_kobo ?? product.compare_at_kobo;
  const availableStock = selectedVariant
    ? (selectedVariant.quantity_total || 0) - (selectedVariant.quantity_sold || 0) - (selectedVariant.quantity_reserved || 0)
    : product.quantity_total - product.quantity_sold - product.quantity_reserved;

  const handleAddToCart = () => {
    addItem(product, selectedVariant || undefined, quantity);
    toast(`Added ${quantity} × "${product.title}" to cart!`, 'success');
  };

  const handleBuyNow = () => {
    addItem(product, selectedVariant || undefined, quantity);
    navigate(mpPath('/checkout'));
  };

  const isVendorOwner = Boolean(user && product?.vendor && ((product.vendor as any).owner_id === user.id || (product.vendor as any).user_id === user.id));

  const handleStartChat = async () => {
    if (!user) {
      toast('Please sign in to chat with this vendor', 'info');
      navigate(PLATFORM_PATHS.login);
      return;
    }
    if (!product) return;
    if (isVendorOwner) {
      navigate(mpPath('/vendor/dashboard'));
      return;
    }
    setChatBusy(true);
    try {
      const conv: any = await startConversation(product.vendor_id, product.id);
      navigate(mpPath(`/messages?conversationId=${conv?.id || conv}`));
    } catch (err: any) {
      toast(err.message || 'Unable to open conversation', 'error');
    } finally {
      setChatBusy(false);
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: product.title,
        text: `Check out ${product.title} on FUW Student Marketplace`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast('Link copied to clipboard', 'info');
    }
  };

  const handleToggleFav = async () => {
    if (!user) {
      toast('Please sign in to save favourites', 'info');
      return;
    }
    try {
      const res: any = await toggleFavourite(product.id);
      setIsFav(res?.favourited);
      toast(res?.favourited ? 'Saved to favourites' : 'Removed from favourites', 'success');
    } catch {
      toast('Unable to update favourites', 'error');
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDetails.trim()) {
      toast('Please provide details for the report', 'error');
      return;
    }
    setReportBusy(true);
    try {
      await createReport('product', product.id, reportReason, reportDetails.trim());
      toast('Listing reported to administration. Thank you for keeping FUW safe.', 'success');
      setReportOpen(false);
    } catch (err: any) {
      toast(err.message || 'Failed to submit report', 'error');
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Breadcrumb Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary, #55675b)', marginBottom: 20, flexWrap: 'wrap' }}>
        <Link to={mpPath("/")} style={{ color: 'inherit', textDecoration: 'none' }}>Home</Link>
        <ChevronRight size={14} />
        <Link to={mpPath("/browse")} style={{ color: 'inherit', textDecoration: 'none' }}>Browse</Link>
        {product.category && (
          <>
            <ChevronRight size={14} />
            <Link to={mpPath(`/browse?category=${product.category.slug}`)} style={{ color: 'inherit', textDecoration: 'none' }}>
              {product.category.name}
            </Link>
          </>
        )}
        <ChevronRight size={14} />
        <span style={{ color: 'var(--text-primary, #17231d)', fontWeight: 600 }}>{product.title}</span>
      </div>

      {/* Main Product Showcase Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 40, marginBottom: 48 }}>
        {/* Left: Image Gallery */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              paddingTop: '80%',
              background: 'var(--surface-alt, #f4f8f5)',
              borderRadius: 16,
              overflow: 'hidden',
              border: '1px solid var(--border, #dcebe0)',
            }}
          >
            {(() => {
              const fallback = getProductFallbackImage(product);
              const src = images[activeImageIndex]?.resolvedUrl || images[activeImageIndex]?.url || fallback;
              return (
                <img
                  src={src}
                  alt={product.title}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (target.src !== fallback) {
                      target.src = fallback;
                    }
                  }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              );
            })()}
          </div>

          {/* Thumbnails row */}
          {images.length > 1 && (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
              {images.map((img, idx) => (
                <button
                  key={img.id || idx}
                  type="button"
                  onClick={() => setActiveImageIndex(idx)}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: activeImageIndex === idx ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                    padding: 0,
                    background: '#ffffff',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <img src={img.resolvedUrl || img.url || getProductFallbackImage(product)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Product Details & Purchase Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top category & share / fav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                padding: '4px 10px',
                borderRadius: 6,
                background: product.is_service ? '#e0f2fe' : 'var(--green-100, #e8f5ec)',
                color: product.is_service ? '#0369a1' : 'var(--green-800, #12603d)',
              }}
            >
              {product.is_service ? 'Campus Service' : formatCondition(product.condition)}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={handleShare}
                title="Share listing"
                style={{ background: 'none', border: '1px solid var(--border, #dcebe0)', borderRadius: 8, padding: 8, cursor: 'pointer', display: 'flex', color: 'var(--text-secondary, #55675b)' }}
              >
                <Share2 size={16} />
              </button>
              <button
                type="button"
                onClick={handleToggleFav}
                title="Save favourite"
                style={{ background: 'none', border: '1px solid var(--border, #dcebe0)', borderRadius: 8, padding: 8, cursor: 'pointer', display: 'flex', color: isFav ? '#dc2626' : 'var(--text-secondary, #55675b)' }}
              >
                <Heart size={16} fill={isFav ? '#dc2626' : 'none'} />
              </button>
            </div>
          </div>

          {/* Title */}
          <h1 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 800, lineHeight: 1.25, color: 'var(--text-primary, #17231d)' }}>
            {product.title}
          </h1>

          {/* Rating & completed orders line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
            {Number(product.rating_avg) > 0 ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: '#b45309' }}>
                <Star size={15} fill="#b45309" color="#b45309" />
                {Number(product.rating_avg).toFixed(1)} ({product.rating_count} reviews)
              </span>
            ) : (
              <span>No reviews yet</span>
            )}
            <span>·</span>
            <span>{product.views_count || 0} campus views</span>
          </div>

          {/* Pricing Box */}
          <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--surface-alt, #f4f8f5)', border: '1px solid var(--border, #dcebe0)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>
                {formatNaira(currentPrice)}
              </span>
              {Boolean(currentCompareAt && currentCompareAt > currentPrice) && (
                <span style={{ fontSize: 16, textDecoration: 'line-through', color: 'var(--muted, #55675b)' }}>
                  {formatNaira(currentCompareAt!)}
                </span>
              )}
            </div>

            {/* Fulfilment info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, fontSize: 13, color: 'var(--text-secondary, #55675b)', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Truck size={15} color="var(--green-800, #12603d)" />
                {product.fulfilment === 'delivery'
                  ? `Hostel delivery: ${product.delivery_fee_kobo ? formatNaira(product.delivery_fee_kobo) : 'Free'}`
                  : product.fulfilment === 'both'
                  ? 'Pickup or Hostel delivery available'
                  : 'Campus pickup'}
              </span>

              {product.meeting_point && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MapPin size={15} color="var(--green-800, #12603d)" />
                  Pickup point: {product.meeting_point}
                </span>
              )}
            </div>
          </div>

          {/* Variants Selector (if any) */}
          {product.variants && product.variants.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                Select Option:
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVariant(v)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: selectedVariant?.id === v.id ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                      background: selectedVariant?.id === v.id ? 'var(--green-100, #e8f5ec)' : 'var(--surface, #ffffff)',
                      color: selectedVariant?.id === v.id ? 'var(--green-900, #0d4a2f)' : 'var(--text-primary, #17231d)',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {v.name}: {v.value} {v.price_kobo ? `(${formatNaira(v.price_kobo)})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity Selector & Action Buttons */}
          {!product.is_service ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Quantity:</span>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border, #dcebe0)', borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    style={{ width: 36, height: 36, border: 'none', background: 'var(--surface-alt, #f4f8f5)', fontSize: 16, cursor: 'pointer' }}
                  >
                    -
                  </button>
                  <span style={{ width: 44, textAlign: 'center', fontWeight: 600, fontSize: 14 }}>{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(quantity + 1)}
                    style={{ width: 36, height: 36, border: 'none', background: 'var(--surface-alt, #f4f8f5)', fontSize: 16, cursor: 'pointer' }}
                  >
                    +
                  </button>
                </div>
                <span style={{ fontSize: 12, color: availableStock > 0 ? 'var(--green-700, #0f6b41)' : '#b91c1c', fontWeight: 600 }}>
                  {availableStock > 0 ? `${availableStock} units available` : 'Currently out of stock'}
                </span>
              </div>

              {isVendorOwner ? (
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <Link
                    to={mpPath("/vendor/dashboard")}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '12px 18px', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}
                  >
                    <Store size={18} />
                    <span>Manage Your Product</span>
                  </Link>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={availableStock <= 0}
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '12px 18px', fontSize: 15 }}
                  >
                    <ShoppingBag size={18} />
                    <span>Add to Cart</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleBuyNow}
                    disabled={availableStock <= 0}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '12px 18px', fontSize: 15 }}
                  >
                    <span>Buy Now</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12 }}>
              {isVendorOwner ? (
                <Link
                  to={mpPath("/vendor/dashboard")}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '14px 20px', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none' }}
                >
                  <Store size={18} />
                  <span>Manage Your Service</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleStartChat}
                  disabled={chatBusy}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '14px 20px', fontSize: 15 }}
                >
                  <MessageSquare size={18} />
                  <span>Contact / Book Service</span>
                </button>
              )}
            </div>
          )}

          {/* Vendor Trust Profile Card */}
          {product.vendor && (
            <div
              style={{
                borderRadius: 14,
                border: '1px solid var(--border, #dcebe0)',
                background: 'var(--surface, #ffffff)',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 14,
                marginTop: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: '50%',
                    background: 'var(--surface-alt, #f4f8f5)',
                    border: '1px solid var(--border, #dcebe0)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {product.vendor.logo_url ? (
                    <img src={product.vendor.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Store size={22} color="var(--green-800, #12603d)" />
                  )}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Link
                      to={mpPath(`/vendor/${product.vendor.slug || product.vendor.id}`)}
                      style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary, #17231d)', textDecoration: 'none' }}
                    >
                      {product.vendor.store_name}
                    </Link>
                    <VerifiedScholarBadge
                      isVerified={Boolean(product.vendor.is_verified || (product.vendor as any).verification === 'verified')}
                      isPremium={Boolean((product.vendor as any).is_premium)}
                      size="sm"
                    />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                    {product.vendor.campus_area || 'FUW Campus'} · {product.vendor.completed_orders_count || 0} completed orders
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isVendorOwner ? (
                  <Link
                    to={mpPath("/vendor/dashboard")}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'var(--surface-alt, #f4f8f5)',
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Store size={14} />
                    <span>Manage</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartChat}
                    disabled={chatBusy}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'var(--surface-alt, #f4f8f5)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <MessageSquare size={14} />
                    <span>Chat Vendor</span>
                  </button>
                )}
                <Link
                  to={mpPath(`/vendor/${product.vendor.slug || product.vendor.id}`)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #dcebe0)',
                    background: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  Storefront
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description & Details Tab Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: '24px 28px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>About this {product.is_service ? 'Service' : 'Product'}</h3>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-primary, #17231d)', whiteSpace: 'pre-line' }}>
            {product.description}
          </div>

          {product.tags && product.tags.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border, #dcebe0)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #55675b)' }}>Tags:</span>
              {product.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 12,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: 'var(--surface-alt, #f4f8f5)',
                    color: 'var(--text-secondary, #55675b)',
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {/* Report listing trigger */}
          <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid var(--border, #dcebe0)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#b91c1c',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <AlertTriangle size={14} />
              <span>Report this listing</span>
            </button>
          </div>
        </div>

        {/* Verified Reviews Section */}
        <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>
                Customer Reviews ({reviews.length})
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                Reviews are strictly restricted to students with completed purchases
              </p>
            </div>
          </div>

          {reviews.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--muted, #55675b)', margin: 0 }}>
              No reviews written yet. After purchasing and confirming delivery, you will be able to review this seller.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {reviews.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '16px',
                    borderRadius: 10,
                    background: 'var(--surface-alt, #f4f8f5)',
                    border: '1px solid var(--border, #dcebe0)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>
                        {r.reviewer?.full_name || 'Verified Student'}
                      </span>
                      {r.is_verified_purchase && (
                        <span style={{ fontSize: 11, background: '#d1fae5', color: '#065f46', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                          Verified Order
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                      {formatDate(r.created_at)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        size={14}
                        fill={i < r.rating ? '#b45309' : 'none'}
                        color={i < r.rating ? '#b45309' : '#d1d5db'}
                      />
                    ))}
                  </div>

                  {r.title && <h5 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{r.title}</h5>}
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary, #17231d)', lineHeight: 1.5 }}>
                    {r.body}
                  </p>

                  {r.vendor_reply && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        background: '#ffffff',
                        borderRadius: 6,
                        borderLeft: '3px solid var(--green-800, #12603d)',
                        fontSize: 13,
                      }}
                    >
                      <strong style={{ display: 'block', color: 'var(--green-900, #0d4a2f)', marginBottom: 2 }}>
                        Vendor Response:
                      </strong>
                      <span>{r.vendor_reply}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Report Modal */}
      <Modal isOpen={reportOpen} onClose={() => setReportOpen(false)} title="Report Listing" maxWidth="440px">
        <form onSubmit={handleReportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Reason for reporting
            </label>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            >
              <option value="suspicious_listing">Suspicious listing or fraudulent price</option>
              <option value="prohibited_item">Prohibited item or university violation</option>
              <option value="inappropriate_content">Inappropriate image or text</option>
              <option value="counterfeit">Fake or counterfeit product</option>
              <option value="spam">Spam or duplicate listing</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Additional details
            </label>
            <textarea
              rows={3}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Provide context for moderation staff..."
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              disabled={reportBusy}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={reportBusy}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
            >
              {reportBusy ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
