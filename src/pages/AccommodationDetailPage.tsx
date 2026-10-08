import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  MapPin,
  Clock,
  ShieldCheck,
  Phone,
  MessageCircle,
  AlertTriangle,
  Star,
  Check,
  Flag,
  Share2,
  Calendar,
  DollarSign,
  ArrowLeft,
  Info,
  Send,
  Home,
  Eye,
  Bookmark
} from 'lucide-react';
import { saveUnifiedItem, removeUnifiedItem, checkIsItemSaved } from '../lib/savedItems';
import { logUserActivity } from '../lib/activity';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Logo } from '../components/Logo';
import {
  fetchAccommodationPropertyBySlug,
  fetchAccommodationReviews,
  recordAccommodationView,
  submitAccommodationReview,
  submitAccommodationReport,
  submitAccommodationInquiry,
  AccommodationProperty,
  AccommodationReview,
  formatNaira,
  getPropertyTypeLabel,
  getAvailabilityBadge,
  ACCOMMODATION_FALLBACK_IMAGE,
  getAccommodationFallbackImage,
  handleAccommodationImageError,
  resolveAccommodationImage
} from '../lib/accommodation';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../components/Toast';
import { fx } from '../lib/motion';

export function AccommodationDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [property, setProperty] = useState<AccommodationProperty | null>(null);
  const [reviews, setReviews] = useState<AccommodationReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  // Live total from the increment RPC; null until it answers, so the figure
  // falls back to the stored value rather than flashing 0.
  const [viewCount, setViewCount] = useState<number | null>(null);

  // Inquiry modal state
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [inquiryName, setInquiryName] = useState('');
  const [inquiryPhone, setInquiryPhone] = useState('');
  const [inquiryMessage, setInquiryMessage] = useState('Hello, I am an FUW student interested in inspecting this accommodation. Is it still available?');
  const [inquiryMoveIn, setInquiryMoveIn] = useState('');
  const [submittingInquiry, setSubmittingInquiry] = useState(false);

  // Review state
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<'scam_suspected' | 'fake_photos' | 'fake_caretaker' | 'already_booked' | 'price_gouging' | 'unreachable' | 'harassment' | 'other'>('scam_suspected');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const { isAuthenticated, user, profile } = useAuth();
  const { toast } = useToast();
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setViewCount(null);
    fetchAccommodationPropertyBySlug(slug).then((data) => {
      setProperty(data);
      if (data) {
        fetchAccommodationReviews(data.id).then(setReviews);
        // Fire-and-forget: a failed counter must not affect the page.
        recordAccommodationView(data.id).then((total) => {
          if (total !== null) setViewCount(total);
        });
        checkIsItemSaved('accommodation', data.id).then(setIsSaved);
        void logUserActivity({
          activityType: 'accommodation_viewed',
          entityType: 'accommodation',
          entityId: data.id,
          entityTitle: data.title,
          metadata: { location: data.location_area, price: data.price_annual }
        });
      }
      setLoading(false);
    });
  }, [slug]);

  const handleToggleSave = async () => {
    if (!property) return;
    if (!isAuthenticated) {
      toast('Please sign in to save accommodations.', 'info');
      return;
    }
    if (isSaved) {
      const ok = await removeUnifiedItem('accommodation', property.id);
      if (ok) {
        setIsSaved(false);
        toast('Removed from saved items.', 'info');
      }
    } else {
      const saved = await saveUnifiedItem({
        itemType: 'accommodation',
        itemId: property.id,
        title: property.title,
        subtitle: `${property.location_area} · ₦${formatNaira(property.price_annual)}/yr`,
        url: `/accommodation/${property.slug}`,
        metadata: { location: property.location_area, price: property.price_annual }
      });
      if (saved) {
        setIsSaved(true);
        toast('Saved to your unified saved items!', 'success');
        void logUserActivity({
          activityType: 'item_saved',
          entityType: 'accommodation',
          entityId: property.id,
          entityTitle: property.title
        });
      }
    }
  };

  useEffect(() => {
    if (profile) {
      setInquiryName(profile.displayName || profile.fullName || '');
      // `Profile.phoneNumber`, not `phone`: the untyped read always came back
      // undefined and left the inquiry form's phone field blank.
      setInquiryPhone(profile.phoneNumber || '');
    }
  }, [profile]);

  if (loading) {
    return (
      <div className="public-container page-pad" style={{ minHeight: 400, display: 'grid', placeItems: 'center' }}>
        <span className="route-fallback-spinner" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="public-container page-pad">
        <div className="empty-state card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <AlertTriangle size={48} color="var(--amber-700)" style={{ marginBottom: 16 }} />
          <h2>Accommodation Listing Not Found</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
            The requested property listing does not exist or may have been unlisted by the caretaker.
          </p>
          <Link to="/accommodation" className="btn btn-primary">
            Back to Accommodations
          </Link>
        </div>
      </div>
    );
  }

  const breadcrumbs = [
    { name: 'Home', path: '/home' },
    { name: 'Campus Hub', path: '/hub' },
    { name: 'Accommodation', path: '/accommodation' },
    { name: property.title, path: `/accommodation/${property.slug}` }
  ];

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryName.trim() || !inquiryPhone.trim() || !inquiryMessage.trim()) {
      toast('Please fill in your name, contact phone and inquiry message', 'error');
      return;
    }

    setSubmittingInquiry(true);
    const res = await submitAccommodationInquiry({
      property_id: property.id,
      student_name: inquiryName,
      student_phone: inquiryPhone,
      message: inquiryMessage,
      preferred_move_in: inquiryMoveIn || undefined
    });
    setSubmittingInquiry(false);

    if (res.success) {
      toast('Inquiry sent successfully to verified caretaker!', 'success');
      setShowInquiryModal(false);
    } else {
      toast(res.error || 'Failed to send inquiry', 'error');
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewText.trim()) {
      toast('Please enter your review feedback', 'error');
      return;
    }

    setSubmittingReview(true);
    const res = await submitAccommodationReview(property.id, rating, reviewText);
    setSubmittingReview(false);

    if (res.success) {
      toast('Thank you! Your review has been submitted.', 'success');
      setReviewText('');
      fetchAccommodationReviews(property.id).then(setReviews);
    } else {
      toast(res.error || 'Failed to submit review', 'error');
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDetails.trim()) {
      toast('Please provide details for your report', 'error');
      return;
    }

    setSubmittingReport(true);
    const res = await submitAccommodationReport({
      property_id: property.id,
      reporter_id: user?.id || null,
      reason: reportReason,
      details: reportDetails
    });
    setSubmittingReport(false);

    if (res.success) {
      toast('Listing report submitted. Our safety team will investigate immediately.', 'success');
      setShowReportModal(false);
      setReportDetails('');
    } else {
      toast(res.error || 'Failed to submit report', 'error');
    }
  };

  const averageRating =
    reviews.length > 0
      ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
      : null;

  // The listing grid badges availability; the detail page did not, so the most
  // decision-relevant fact about a lodge was missing from the page a student
  // is actually reading before contacting a caretaker.
  const availability = getAvailabilityBadge(property.availability_status);

  // Resolve the gallery photograph up front. `images[activeImageIdx] || images[0]`
  // evaluated to `undefined` for a listing with no photographs, which left an
  // empty frame; an `<img>` must always be given a resolvable source.
  const galleryImage = resolveAccommodationImage(property.images, activeImageIdx);
  const galleryAlt = galleryImage ? property.title : 'Photo coming soon';

  return (
    <>
      <SEO
        title={`${property.title} | FUW Student Accommodation`}
        description={`${property.title}: ${getPropertyTypeLabel(property.property_type)} located in ${property.location_area}, Wukari. Rent: ${formatNaira(property.price_annual)}/yr. Verified FUW student accommodation.`}
        path={`/accommodation/${property.slug}`}
        image={galleryImage ?? undefined}
        keywords={[
          property.title,
          `${property.location_area} FUW accommodation`,
          'FUW student lodge',
          'Wukari student hostel'
        ]}
      />

      <div className="public-container page-pad">
        <Breadcrumbs trail={breadcrumbs} />

        <div style={{ marginBottom: 16 }}>
          <Link
            to="/accommodation"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 600
            }}
          >
            <ArrowLeft size={16} /> Back to Accommodations
          </Link>
        </div>

        {/* Header Block */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="pill-badge">{property.location_area}</span>
              <span className="pill-badge" style={{ background: 'var(--surface-alt)' }}>
                {getPropertyTypeLabel(property.property_type)}
              </span>
              <span
                className="pill-badge"
                style={{ background: availability.background, color: availability.color }}
              >
                {availability.label}
              </span>
              {property.is_verified && (
                <span
                  style={{
                    background: 'var(--green-100)',
                    color: 'var(--green-800)',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <ShieldCheck size={14} color="var(--green-800)" /> Verified Lodge
                </span>
              )}
            </div>
            <h1 style={{ fontSize: 'clamp(22px, 3.5vw, 32px)', fontWeight: 800, margin: '0 0 8px' }}>
              {property.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
              <MapPin size={15} color="var(--green-800)" />
              <span>{property.address_landmark}</span>
              {property.distance_to_campus && (
                <>
                  <span>·</span>
                  <Clock size={14} />
                  <span>{property.distance_to_campus}</span>
                </>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-800)' }}>
              {formatNaira(property.price_annual)}
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}> / year</span>
            </div>
            {property.price_semester && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                or {formatNaira(property.price_semester)} / semester
              </div>
            )}
          </div>
        </div>

        {/* Gallery */}
        <div className="property-gallery" style={{ marginBottom: 32 }}>
          <div
            style={{
              position: 'relative',
              borderRadius: 14,
              overflow: 'hidden',
              height: 'clamp(280px, 45vw, 440px)',
              // Neutral surface rather than a black void: while a photograph
              // loads, or if every photograph has failed, the frame reads as
              // part of the page instead of a hole in it.
              background: 'var(--surface-alt)',
              marginBottom: 12
            }}
          >
            <img
              src={galleryImage ?? getAccommodationFallbackImage(property.property_type)}
              alt={galleryAlt}
              onError={(event) => handleAccommodationImageError(event, property.images, activeImageIdx, property.property_type)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>

          {property.images.length > 1 && (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
              {property.images.map((_img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImageIdx(idx)}
                  aria-label={`Show photo ${idx + 1} of ${property.images.length}`}
                  aria-current={activeImageIdx === idx}
                  style={{
                    border: activeImageIdx === idx ? '2px solid var(--green-800)' : '2px solid transparent',
                    borderRadius: 8,
                    overflow: 'hidden',
                    padding: 0,
                    width: 72,
                    height: 54,
                    flexShrink: 0,
                    cursor: 'pointer',
                    background: 'var(--surface-alt)'
                  }}
                >
                  <img
                    src={resolveAccommodationImage(property.images, idx) ?? getAccommodationFallbackImage(property.property_type)}
                    alt=""
                    onError={(event) => handleAccommodationImageError(event, property.images, idx, property.property_type)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main Content & Sidebar Grid */}
        <div className="accommodation-detail-grid">
          {/* Details Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            {/* Description */}
            <div className="card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 12px' }}>Overview &amp; Description</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-line' }}>
                {property.description}
              </p>
            </div>

            {/* Amenities Grid */}
            <div className="card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 16px' }}>Facilities &amp; Amenities</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
                {property.amenities.map((am) => (
                  <div
                    key={am}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: 'var(--surface-alt)',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600
                    }}
                  >
                    <Check size={16} color="var(--green-800)" />
                    <span>{am}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Pricing Breakdown */}
            <div className="card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 16px' }}>Rent &amp; Fees Breakdown</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Annual Rent:</span>
                  <strong style={{ fontSize: 15 }}>{formatNaira(property.price_annual)}</strong>
                </div>
                {property.price_semester && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Per Semester Option:</span>
                    <strong style={{ fontSize: 15 }}>{formatNaira(property.price_semester)}</strong>
                  </div>
                )}
                {property.caution_deposit > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Refundable Caution Deposit:</span>
                    <span style={{ fontSize: 14 }}>{formatNaira(property.caution_deposit)}</span>
                  </div>
                )}
                {property.service_charge > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Maintenance / Sanitation:</span>
                    <span style={{ fontSize: 14 }}>{formatNaira(property.service_charge)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Available Room Units:</span>
                  <span style={{ fontWeight: 700, color: property.available_units > 0 ? 'var(--green-800)' : 'var(--error)' }}>
                    {property.available_units} unit{property.available_units === 1 ? '' : 's'} available
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Student Interest:</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>
                    <Eye size={14} color="var(--text-secondary)" />
                    {viewCount ?? property.view_count ?? 0} view{(viewCount ?? property.view_count ?? 0) === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </div>

            {/* Lodge Rules */}
            {property.rules_notes && (
              <div className="card" style={{ padding: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 12px' }}>Lodge Guidelines &amp; Tenancy Notes</h2>
                <div style={{ background: 'var(--surface-alt)', borderLeft: '3px solid var(--green-800)', padding: '12px 16px', borderRadius: '0 8px 8px 0', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {property.rules_notes}
                </div>
              </div>
            )}

            {/* Reviews Section */}
            <div className="card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>
                    Student Ratings &amp; Reviews ({reviews.length})
                  </h2>
                  {averageRating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-secondary)' }}>
                      <Star size={16} fill="#f59e0b" color="#f59e0b" />
                      <strong>{averageRating} out of 5</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Review Input */}
              {isAuthenticated ? (
                <form onSubmit={handleReviewSubmit} style={{ background: 'var(--surface-alt)', padding: 16, borderRadius: 10, marginBottom: 24 }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Leave a Review as a Student</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Your Rating:</span>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        type="button"
                        key={star}
                        onClick={() => setRating(star)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
                      >
                        <Star size={18} fill={rating >= star ? '#f59e0b' : 'none'} color={rating >= star ? '#f59e0b' : 'var(--muted)'} />
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Share your experience regarding water, electricity, security or lodge environment..."
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', marginBottom: 12 }}
                  />
                  <button type="submit" disabled={submittingReview} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
                    {submittingReview ? 'Submitting...' : 'Post Student Review'}
                  </button>
                </form>
              ) : (
                <div style={{ background: 'var(--surface-alt)', padding: 12, borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  <Link to="/login" style={{ color: 'var(--green-800)', fontWeight: 700, textDecoration: 'underline' }}>
                    Sign in with your FUW student account
                  </Link>{' '}
                  to leave a review for this accommodation.
                </div>
              )}

              {/* Reviews List */}
              {reviews.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, fontStyle: 'italic' }}>
                  No reviews posted for this lodge yet. Be the first to share your experience!
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {reviews.map((rev) => (
                    <div key={rev.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                        {[...Array(rev.rating)].map((_, i) => (
                          <Star key={i} size={14} fill="#f59e0b" color="#f59e0b" />
                        ))}
                      </div>
                      <p style={{ margin: '0 0 6px', fontSize: 14, lineHeight: 1.5 }}>{rev.review_text}</p>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Verified Student · {new Date(rev.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Contact & Safety Sidebar */}
          <div className="accommodation-sidebar">
            {/* Caretaker Card */}
            <div className="card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--green-100)', color: 'var(--green-800)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Logo size={28} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Caretaker / Agent Contact</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--green-800)', fontWeight: 600 }}>
                    <ShieldCheck size={13} /> Verified Property Manager
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                <a
                  href={`tel:${property.contact_phone}`}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '12px 16px', gap: 8, fontSize: 14 }}
                >
                  <Phone size={16} /> Call Caretaker ({property.contact_phone})
                </a>

                {property.contact_whatsapp && (
                  <a
                    href={`https://wa.me/${property.contact_whatsapp}?text=${encodeURIComponent(
                      `Hello, I am interested in inspecting ${property.title} listed on the FUW Campus Platform.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn"
                    style={{
                      width: '100%',
                      justifyContent: 'center',
                      padding: '12px 16px',
                      background: '#25D366',
                      color: '#ffffff',
                      border: 'none',
                      gap: 8,
                      fontSize: 14,
                      fontWeight: 700
                    }}
                  >
                    <MessageCircle size={16} /> Chat on WhatsApp
                  </a>
                )}

                {isAuthenticated ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowInquiryModal(true)}
                      className="btn btn-secondary"
                      style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', gap: 8, fontSize: 14 }}
                    >
                      <Send size={15} /> Send Move-in Inquiry
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleSave}
                      className="btn btn-secondary"
                      style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', gap: 8, fontSize: 14 }}
                    >
                      <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} color={isSaved ? "var(--green-800)" : "currentColor"} />
                      <span>{isSaved ? 'Saved to Bookmarks' : 'Save Lodge'}</span>
                    </button>
                  </>
                ) : (
                  <Link
                    to="/login"
                    className="btn btn-secondary"
                    style={{ width: '100%', justifyContent: 'center', padding: '11px 16px', gap: 8, fontSize: 14 }}
                  >
                    <Send size={15} /> Sign in to send an inquiry
                  </Link>
                )}
              </div>

              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.4 }}>
                Inspections are arranged directly with the caretaker.
              </p>
            </div>

            {/* Anti-Scam Advisory */}
            <div className="card" style={{ padding: 20, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <AlertTriangle size={20} color="var(--amber-700)" style={{ flexShrink: 0, marginTop: 2 }} />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Student Safety Rules</h4>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.5 }}>
                <li>Never pay for a lodge without physical in-person inspection.</li>
                <li>Verify caretaker identity at the lodge premises.</li>
                <li>Obtain an authentic written receipt upon payment.</li>
                <li>Go for room inspections during daylight hours.</li>
              </ul>

              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {/* A report is tied to the signed-in reporter by row-level
                    security, so an anonymous visitor could only ever reach a
                    rejected insert. Ask them to sign in first, exactly as the
                    review form already does. */}
                {isAuthenticated ? (
                  <button
                    type="button"
                    onClick={() => setShowReportModal(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--red-700)',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    <Flag size={13} /> Report Suspicious Listing
                  </button>
                ) : (
                  <Link
                    to="/login"
                    style={{
                      color: 'var(--red-700)',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <Flag size={13} /> Sign in to report this listing
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inquiry Modal */}
      {showInquiryModal && (
        <div className="drawer-overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="card" style={{ maxWidth: 460, width: '100%', padding: 24, borderRadius: 14, boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>
              Send Move-In Inquiry
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
              Inquire directly about {property.title}. The verified caretaker will receive your details.
            </p>
            <form onSubmit={handleInquirySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Full Name</label>
                <input
                  type="text"
                  required
                  value={inquiryName}
                  onChange={(e) => setInquiryName(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Phone Number</label>
                <input
                  type="tel"
                  required
                  value={inquiryPhone}
                  onChange={(e) => setInquiryPhone(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Expected Move-in Date (Optional)</label>
                <input
                  type="date"
                  value={inquiryMoveIn}
                  onChange={(e) => setInquiryMoveIn(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Inquiry Message</label>
                <textarea
                  rows={3}
                  required
                  value={inquiryMessage}
                  onChange={(e) => setInquiryMessage(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowInquiryModal(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingInquiry}
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {submittingInquiry ? 'Sending...' : 'Send Inquiry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Listing Modal */}
      {showReportModal && (
        <div className="drawer-overlay" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="card" style={{ maxWidth: 460, width: '100%', padding: 24, borderRadius: 14, boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: 'var(--red-700)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Flag size={20} /> Report Listing to FUW Housing Security
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
              Help protect fellow FUW students. If you suspect fraud, fake caretaker representation, or unsafe conditions, let us know immediately.
            </p>
            <form onSubmit={handleReportSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Reason for Report</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value as any)}
                  className="form-select"
                  style={{ width: '100%' }}
                >
                  <option value="scam_suspected">Suspected Scam / Demanded money before inspection</option>
                  <option value="fake_photos">Misleading or fake property photos</option>
                  <option value="fake_caretaker">Person is not the real caretaker/landlord</option>
                  <option value="already_booked">Listing is already occupied / unavailable</option>
                  <option value="price_gouging">Price differs from advertised amount</option>
                  <option value="unreachable">Phone number not reachable / inactive</option>
                  <option value="harassment">Unprofessional conduct or harassment</option>
                  <option value="other">Other issue</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Explanation / Evidence</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Describe what occurred, any phone numbers involved, or discrepancies noticed..."
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center', background: 'var(--red-700)', borderColor: 'var(--red-700)' }}
                >
                  {submittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
