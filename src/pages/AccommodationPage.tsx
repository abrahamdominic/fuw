import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Home,
  Search,
  MapPin,
  ShieldCheck,
  Clock,
  Building,
  Users
} from 'lucide-react';
import { SEO } from '../components/SEO';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Logo } from '../components/Logo';
import {
  fetchAccommodationProperties,
  AccommodationProperty,
  ACCOMMODATION_LOCATIONS,
  PROPERTY_TYPES,
  POPULAR_AMENITIES,
  formatNaira,
  getPropertyTypeLabel,
  getAvailabilityBadge,
  ACCOMMODATION_FALLBACK_IMAGE,
  getAccommodationFallbackImage,
  handleAccommodationImageError,
  resolveAccommodationImage
} from '../lib/accommodation';
import { fx } from '../lib/motion';

/**
 * The budget slider's ceiling. Living at the maximum would otherwise be
 * indistinguishable from "no limit", so the top of the range means "show
 * everything" rather than filtering to exactly this figure.
 */
const MAX_BUDGET = 1_000_000;
const BUDGET_MIN = 40_000;
const BUDGET_STEP = 10_000;

const AVAILABILITY_OPTIONS = [
  { value: 'all', label: 'Any availability' },
  { value: 'available', label: 'Available now' },
  { value: 'fast_filling', label: 'Filling fast' }
] as const;

/**
 * How long the search box rests before a query is issued.
 *
 * Without this every keystroke replaced the whole result set, which is both a
 * request storm and a flickering list while the user is still typing.
 */
const SEARCH_DEBOUNCE_MS = 300;

export function AccommodationPage() {
  const [properties, setProperties] = useState<AccommodationProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // What the input holds, debounced. Filters apply to this, not to the raw value.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('All Locations');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedAmenity, setSelectedAmenity] = useState<string>('');
  const [maxBudget, setMaxBudget] = useState<number>(MAX_BUDGET);
  const [availability, setAvailability] = useState<string>('all');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedLocation !== 'All Locations' ||
    selectedType !== 'all' ||
    selectedAmenity !== '' ||
    maxBudget < MAX_BUDGET ||
    availability !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedLocation('All Locations');
    setSelectedType('all');
    setSelectedAmenity('');
    setMaxBudget(MAX_BUDGET);
    setAvailability('all');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAccommodationProperties({
      query: debouncedQuery,
      location: selectedLocation,
      propertyType: selectedType,
      amenity: selectedAmenity,
      // "Any budget" is the top of the slider, not a ceiling. Sending it as a
      // price filter silently hid every lodge priced above it.
      maxPrice: maxBudget >= MAX_BUDGET ? undefined : maxBudget,
      availabilityStatus: availability
    }).then((data) => {
      if (active) {
        setProperties(data);
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [
    debouncedQuery,
    selectedLocation,
    selectedType,
    selectedAmenity,
    maxBudget,
    availability
  ]);

  const breadcrumbs = [
    { name: 'Home', path: '/home' },
    { name: 'Campus Hub', path: '/hub' },
    { name: 'Accommodation', path: '/accommodation' }
  ];

  return (
    <>
      <SEO
        title="FUW Accommodation | Student Hostels, Lodges & Off-Campus Apartments"
        description="Search verified student hostels, self-contained rooms, flats and shared lodges around Federal University Wukari campus environs with protected listings and anti-scam verification."
        path="/accommodation"
        keywords={[
          'FUW accommodation',
          'FUW hostels',
          'student lodges Wukari',
          'self contained rooms near FUW',
          'Federal University Wukari housing',
          'FUW off campus accommodation'
        ]}
        image="/images/fuw-accommodation-og.png"
        schema="itemList"
      />

      <div className="public-container page-pad">
        <Breadcrumbs trail={breadcrumbs} />

        {/* Hero Section */}
        <section className={`accommodation-hero ${fx.fadeIn}`} style={{ margin: '20px 0 32px' }}>
          <div className="accommodation-hero-content">
            <div className="pill-badge" style={{ marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px' }}>
              <Logo size={20} />
              <span>VERIFIED OFF-CAMPUS STUDENT LODGES &amp; APARTMENTS</span>
            </div>
            <h1 className="hero-title" style={{ fontSize: 'clamp(26px, 4vw, 38px)', margin: '0 0 12px' }}>
              Off-Campus Student Accommodation Directory
            </h1>
            <p className="hero-sub" style={{ maxWidth: 720, margin: '0 0 20px', fontSize: 16, lineHeight: 1.6 }}>
              Browse verified off-campus student lodges, self-contained apartments, and private rooms in Wukari environs (Marmara, Hospital Road, New Site, Old Campus, Mission). These are private, off-campus housing facilities with verified landlords and caretakers — not university-owned on-campus hostels.
            </p>
          </div>

          {/* Scam Prevention Advisory Banner */}
          <div className="accommodation-scam-alert" role="alert" style={{ marginBottom: 16 }}>
            <div className="scam-alert-icon">
              <ShieldCheck size={24} color="#12603d" />
            </div>
            <div className="scam-alert-text">
              <strong>Off-Campus Housing Safety Notice:</strong> These listings represent private, off-campus student accommodation. Always visit and inspect the lodge compound physically with our campus ambassadors before making any rental payments to caretakers or landlords. Never pay unverified third parties.
            </div>
          </div>

          {/* Roommate Finder Banner */}
          <div
            style={{
              background: 'linear-gradient(135deg, var(--primary-bg, #e8f5ec) 0%, #f0fdf4 100%)',
              border: '1.5px solid var(--primary, #12603d)',
              borderRadius: 14,
              padding: '18px 22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(18, 96, 61, 0.08))',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 260, flex: 1 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'var(--primary, #12603d)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 4px 10px rgba(18, 96, 61, 0.25)',
                }}
              >
                <Users size={24} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <strong style={{ fontSize: 16, color: 'var(--text-primary, #17231d)' }}>
                    Looking for a Roommate?
                  </strong>
                  <span
                    style={{
                      background: 'var(--primary, #12603d)',
                      color: '#ffffff',
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    New
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)', lineHeight: 1.4 }}>
                  Connect with verified FUW students sharing lodge costs, compare budgets, and find male/female roommates safely.
                </p>
              </div>
            </div>

            <Link
              to="/accommodation/roommates"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--primary, #12603d)',
                color: '#ffffff',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: 13.5,
                padding: '10px 18px',
                borderRadius: 10,
                boxShadow: '0 3px 10px rgba(18, 96, 61, 0.2)',
                whiteSpace: 'nowrap',
              }}
            >
              <Users size={16} />
              <span>Explore Roommate Finder</span>
            </Link>
          </div>
        </section>

        {/* Filter Controls Bar */}
        <div className="accommodation-filter-panel card" style={{ padding: '20px 24px', marginBottom: 32 }}>
          <div className="accommodation-filter-grid">
            {/* Search Input */}
            <div>
              <label htmlFor="search-accommodation" style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                Search Lodges
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                <input
                  id="search-accommodation"
                  type="text"
                  placeholder="Lodge name, landmark, gate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', paddingLeft: 36 }}
                />
              </div>
            </div>

            {/* Location Area */}
            <div>
              <label htmlFor="location-area" style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                Preferred Location
              </label>
              <select
                id="location-area"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="form-select"
                style={{ width: '100%' }}
              >
                {ACCOMMODATION_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>

            {/* Room Type */}
            <div>
              <label htmlFor="property-type" style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                Room Type
              </label>
              <select
                id="property-type"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="form-select"
                style={{ width: '100%' }}
              >
                {PROPERTY_TYPES.map((pt) => (
                  <option key={pt.value} value={pt.value}>
                    {pt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Availability */}
            <div>
              <label htmlFor="availability-status" style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 6 }}>
                Availability
              </label>
              <select
                id="availability-status"
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
                className="form-select"
                style={{ width: '100%' }}
              >
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Max Budget Slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label htmlFor="budget-slider" style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
                  Max Annual Budget
                </label>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-800)' }}>
                  {maxBudget >= MAX_BUDGET ? 'Any budget' : formatNaira(maxBudget)}
                </span>
              </div>
              <input
                id="budget-slider"
                type="range"
                min={BUDGET_MIN}
                max={MAX_BUDGET}
                step={BUDGET_STEP}
                value={maxBudget}
                onChange={(e) => setMaxBudget(Number(e.target.value))}
                aria-valuetext={
                  maxBudget >= MAX_BUDGET ? 'Any budget' : formatNaira(maxBudget)
                }
                style={{ width: '100%', accentColor: 'var(--green-800)' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  marginTop: 4,
                }}
              >
                <span>{formatNaira(BUDGET_MIN)}</span>
                <span>{formatNaira(MAX_BUDGET)}</span>
              </div>
            </div>
          </div>

          {/* Quick Amenity Chips */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Filter by Amenity:</span>
            <button
              type="button"
              onClick={() => setSelectedAmenity('')}
              className={`pill-btn ${selectedAmenity === '' ? 'is-active' : ''}`}
            >
              Any
            </button>
            {POPULAR_AMENITIES.slice(0, 6).map((amenity) => (
              <button
                key={amenity}
                type="button"
                onClick={() => setSelectedAmenity(selectedAmenity === amenity ? '' : amenity)}
                className={`pill-btn ${selectedAmenity === amenity ? 'is-active' : ''}`}
              >
                {amenity}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'flex-end'
              }}
            >
              <button
                type="button"
                onClick={resetFilters}
                className="btn btn-secondary"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Results Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>
            Available Accommodations ({properties.length})
          </h2>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Showing verified FUW campus lodges
          </span>
        </div>

        {/* Properties Grid */}
        {loading ? (
          <div className="empty-state" style={{ minHeight: 280 }}>
            <span className="route-fallback-spinner" />
            <p>Loading available student accommodations...</p>
          </div>
        ) : properties.length === 0 ? (
          <div className="empty-state card" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <Home size={42} color="var(--muted)" style={{ marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 8px' }}>No Accommodations Found</h3>
            <p style={{ maxWidth: 440, margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 14 }}>
              No lodges matched your specific filters. Try expanding your budget range or selecting a different location.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="btn btn-primary"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="properties-grid">
            {properties.map((prop, idx) => {
              const badge = getAvailabilityBadge(prop.availability_status);
              // Resolve once for both the src and the alt text: when the
              // listing has no photograph at all the element must still render
              // (branded placeholder, alt says so) instead of an empty src.
              const thumbnail = resolveAccommodationImage(prop.images);
              return (
              <article
                key={prop.id}
                className={`property-card card ${fx.fadeUp}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  border: '1px solid var(--border)'
                }}
              >
                {/* Thumbnail Header */}
                <div style={{ position: 'relative', height: 190, background: 'var(--surface-alt)' }}>
                  <img
                    src={thumbnail ?? getAccommodationFallbackImage(prop.property_type)}
                    alt={prop.title}
                    loading="lazy"
                    onError={(event) => handleAccommodationImageError(event, prop.images, 0, prop.property_type)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      display: 'flex',
                      gap: 6
                    }}
                  >
                    <span
                      className="badge"
                      style={{
                        background: badge.background,
                        color: badge.color,
                        fontWeight: 700,
                        fontSize: 11,
                        padding: '4px 8px',
                        borderRadius: 6
                      }}
                    >
                      {badge.label}
                    </span>
                    {prop.is_verified && (
                      <span
                        className="badge"
                        style={{
                          background: 'rgba(18, 96, 61, 0.9)',
                          color: '#ffffff',
                          fontWeight: 700,
                          fontSize: 11,
                          padding: '4px 8px',
                          borderRadius: 6,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <ShieldCheck size={12} color="#4ade80" /> Verified Lodge
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      position: 'absolute',
                      bottom: 10,
                      right: 12,
                      background: 'rgba(0, 0, 0, 0.75)',
                      backdropFilter: 'blur(4px)',
                      color: '#ffffff',
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 800
                    }}
                  >
                    {formatNaira(prop.price_annual)} <span style={{ fontSize: 10, fontWeight: 500 }}>/yr</span>
                  </div>
                </div>

                {/* Body Content */}
                <div style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 12, marginBottom: 6 }}>
                    <MapPin size={13} color="var(--green-800)" />
                    <span>{prop.location_area}</span>
                    <span>·</span>
                    <span>{getPropertyTypeLabel(prop.property_type)}</span>
                  </div>

                  <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 8px', lineHeight: 1.3 }}>
                    <Link to={`/accommodation/${prop.slug}`} style={{ color: 'inherit' }}>
                      {prop.title}
                    </Link>
                  </h3>

                  <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {prop.description}
                  </p>

                  {/* Proximity Pill */}
                  {prop.distance_to_campus && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--green-800)', background: 'var(--green-100)', padding: '4px 10px', borderRadius: 6, width: 'fit-content', marginBottom: 14 }}>
                      <Clock size={12} />
                      <span>{prop.distance_to_campus}</span>
                    </div>
                  )}

                  {/* Amenities Tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18, marginTop: 'auto' }}>
                    {prop.amenities.slice(0, 3).map((am) => (
                      <span
                        key={am}
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          background: 'var(--surface-alt)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          color: 'var(--text-secondary)'
                        }}
                      >
                        {am}
                      </span>
                    ))}
                    {prop.amenities.length > 3 && (
                      <span style={{ fontSize: 11, color: 'var(--text-soft)', alignSelf: 'center' }}>
                        +{prop.amenities.length - 3} more
                      </span>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <Link
                      to={`/accommodation/${prop.slug}`}
                      className="btn btn-primary"
                      style={{ flex: 1, padding: '9px 14px', fontSize: 13, justifyContent: 'center' }}
                    >
                      View Details &amp; Contact
                    </Link>
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        )}

        {/* Accommodation Provider CTA */}
        <section className="card" style={{ marginTop: 48, padding: '32px 28px', background: 'var(--surface-alt)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ maxWidth: 640 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--green-800)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', marginBottom: 8 }}>
              <Building size={16} />
              <span>Are You an FUW Hostel Owner, Landlord or Caretaker?</span>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>
              List Your Student Lodge on the Official FUW Campus Platform
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Connect directly with thousands of verified FUW students looking for off-campus rooms, self-contained apartments and bedspaces. All listings undergo physical and identity verification to safeguard students and legitimate property owners.
            </p>
          </div>
          <a
            href="mailto:housing@fuwukari.edu.ng?subject=FUW%20Lodge%20Listing%20Verification"
            className="btn btn-primary"
            style={{ padding: '12px 24px', fontWeight: 700, fontSize: 14 }}
          >
            Request Property Verification
          </a>
        </section>
      </div>
    </>
  );
}
