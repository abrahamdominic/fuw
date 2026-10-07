import React from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  ShoppingBag,
  Home,
  ShieldCheck,
  ArrowRight,
  GraduationCap,
  ExternalLink,
  Users,
  Compass,
  CheckCircle,
  Clock,
  Layers,
  Search,
  Building
} from 'lucide-react';
import { SEO } from '../components/SEO';
import { HubMotifLayer, hubBandStyle } from '../components/HubCardArt';
import { useAuth } from '../lib/AuthContext';
import { fx } from '../lib/motion';
import { getLastActiveSection, setLastActiveSection, getMarketplaceUrl, HubSection } from '../lib/hub';

export function CampusHubPage() {
  const { user, profile, isAuthenticated } = useAuth();
  const [lastSection, setLastSectionState] = React.useState<HubSection | null>(() => getLastActiveSection());

  // The Marketplace is mounted at /marketplace/* inside this SPA, so the bridge
  // is an ordinary in-app path: no second origin, no token handoff. The path is
  // passed to getMarketplaceUrl rather than appended to a finished URL, so
  // `/browse` lands on `/marketplace/browse`.
  const marketplaceUrl = (path = '') => getMarketplaceUrl(path);

  const handleSelectSection = (section: HubSection) => {
    setLastActiveSection(section);
    setLastSectionState(section);
  };

  const firstName =
    profile?.displayName ||
    profile?.fullName?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'Student';

  return (
    <>
      <SEO
        title="FUW Campus Hub | Official Gateway to University Services"
        description="The central gateway to Federal University Wukari digital services: explore the E-Library, browse the Student Marketplace, and find verified Accommodation."
        path="/hub"
        image="/images/fuw-campushub-og.png"
        imageAlt="FUW Campus Hub: E-Library, Marketplace & Accommodation"
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Campus Hub', path: '/hub' }
        ]}
        schema="webPage"
      />

      <div className="campus-hub-wrapper page-pad" style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 20px 80px' }}>
        {/* Welcome & Campus Banner */}
        <section
          className={`hub-welcome-banner ${fx.fadeIn}`}
          style={{
            borderRadius: 20,
            background: 'linear-gradient(135deg, var(--green-900) 0%, var(--green-800) 65%, #187d50 100%)',
            color: '#ffffff',
            padding: 'clamp(28px, 5vw, 44px)',
            marginBottom: 36,
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-md)'
          }}
        >
          {/* Subtle background watermarks */}
          <div
            style={{
              position: 'absolute',
              right: -30,
              bottom: -40,
              opacity: 0.08,
              pointerEvents: 'none'
            }}
          >
            <Compass size={280} color="#ffffff" />
          </div>

          <div style={{ position: 'relative', zIndex: 1, maxWidth: 760 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.16)',
                backdropFilter: 'blur(8px)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.04em',
                marginBottom: 16
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
              <span>OFFICIAL DIGITAL GATEWAY · FEDERAL UNIVERSITY WUKARI</span>
            </div>

            <h1
              style={{
                fontSize: 'clamp(28px, 4.5vw, 46px)',
                fontWeight: 900,
                letterSpacing: '-0.025em',
                margin: '0 0 10px',
                lineHeight: 1.15
              }}
            >
              FUW Campus Hub
            </h1>

            <p
              style={{
                fontSize: 'clamp(16px, 2.5vw, 20px)',
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.92)',
                margin: '0 0 16px',
                letterSpacing: '-0.01em'
              }}
            >
              Your gateway to everything in FUW
            </p>

            {isAuthenticated ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  fontSize: 13,
                  color: 'rgba(255, 255, 255, 0.88)'
                }}
              >
                <span>
                  Welcome back, <strong>{firstName}</strong>
                </span>
                {profile?.department && (
                  <>
                    <span>·</span>
                    <span>{profile.department}</span>
                  </>
                )}
                {profile?.matricNumber && (
                  <>
                    <span>·</span>
                    <span style={{ background: 'rgba(255, 255, 255, 0.2)', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
                      {profile.matricNumber}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: 'rgba(255, 255, 255, 0.8)' }}>
                Access verified course materials, safe campus commerce, and verified student accommodation in one unified ecosystem.
              </p>
            )}
          </div>
        </section>

        {/* Section Title */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
              Core University Services
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
              Choose a service to launch seamlessly into its dedicated workspace.
            </p>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--green-800)', fontWeight: 600 }}>
            <ShieldCheck size={16} /> Verified FUW Infrastructure
          </div>
        </div>

        {/* Remembered Active Section Banner */}
        {lastSection && (
          <div
            style={{
              marginBottom: 24,
              padding: '12px 18px',
              borderRadius: 12,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Your remembered workspace: <strong style={{ color: 'var(--text-primary)' }}>{lastSection === 'library' ? 'FUW E Library' : lastSection === 'marketplace' ? 'FUW Marketplace' : 'FUW Accommodation'}</strong>. Switch to any service below instantly.
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--green-900)', fontWeight: 700, background: 'var(--surface-alt)', padding: '4px 10px', borderRadius: 20 }}>
              Active Workspace
            </span>
          </div>
        )}

        {/* Main 3 High-Quality Interactive Service Cards */}
        <div
          className="hub-services-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
            gap: 24,
            marginBottom: 44
          }}
        >
          {/* Card 1: FUW E-Library */}
          <div
            className={`service-card card ${fx.fadeUp}`}
            style={{
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 18,
              border: lastSection === 'library' ? '2px solid var(--green-600, #16a34a)' : '1px solid var(--border)',
              boxShadow: lastSection === 'library' ? '0 0 0 1px var(--green-600, #16a34a), var(--shadow-md)' : undefined,
              overflow: 'hidden',
              transition: 'transform 0.22s var(--ease), box-shadow 0.22s var(--ease)'
            }}
          >
            {/* Card Header Media Band */}
            <div
              style={{
                height: 140,
                ...hubBandStyle('library'),
                padding: '24px 24px 0',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <HubMotifLayer motif="library" />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.18)',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      padding: '4px 10px',
                      borderRadius: 999,
                      textTransform: 'uppercase'
                    }}
                  >
                    Academics &amp; Study
                  </span>
                  {lastSection === 'library' && (
                    <span
                      style={{
                        background: '#22c55e',
                        color: '#ffffff',
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                        padding: '3px 8px',
                        borderRadius: 999,
                        textTransform: 'uppercase'
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.2)',
                    backdropFilter: 'blur(4px)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#ffffff'
                  }}
                >
                  <BookOpen size={24} />
                </div>
              </div>

              <div style={{ position: 'relative', zIndex: 1, bottom: -18 }}>
                <span
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--green-800)',
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--border)'
                  }}
                >
                  FUW Official E-Library
                </span>
              </div>
            </div>

            {/* Card Content */}
            <div style={{ padding: '30px 24px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 800 }}>
                FUW E Library
              </h3>
              <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Learn, study and access everything you need academically. Verified lecture notes, test &amp; exam past questions, handouts, and institutional research repository.
              </p>

              {/* Service Feature Highlights */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  fontSize: 13,
                  color: 'var(--text-primary)'
                }}
              >
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Verified course materials &amp; past question banks</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Institutional Repository for theses &amp; project papers</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Interactive document reader &amp; offline study sync</span>
                </li>
              </ul>

              {/* Action Button */}
              <div style={{ marginTop: 'auto' }}>
                <Link
                  to="/library"
                  onClick={() => handleSelectSection('library')}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    padding: '13px 20px',
                    fontSize: 14,
                    fontWeight: 700,
                    borderRadius: 10,
                    gap: 8
                  }}
                >
                  <span>Open E Library</span>
                  <ArrowRight size={16} />
                </Link>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 12, fontSize: 12 }}>
                  <Link to="/courses" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                    Browse Courses
                  </Link>
                  <span>·</span>
                  <Link to="/faculties" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                    Faculty Directory
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: FUW Marketplace */}
          <div
            className={`service-card card ${fx.fadeUp}`}
            style={{
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 18,
              border: lastSection === 'marketplace' ? '2px solid var(--green-600, #16a34a)' : '1px solid var(--border)',
              boxShadow: lastSection === 'marketplace' ? '0 0 0 1px var(--green-600, #16a34a), var(--shadow-md)' : undefined,
              overflow: 'hidden',
              transition: 'transform 0.22s var(--ease), box-shadow 0.22s var(--ease)'
            }}
          >
            {/* Card Header Media Band */}
            <div
              style={{
                height: 140,
                ...hubBandStyle('marketplace'),
                padding: '24px 24px 0',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <HubMotifLayer motif="marketplace" />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.18)',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      padding: '4px 10px',
                      borderRadius: 999,
                      textTransform: 'uppercase'
                    }}
                  >
                    Campus Commerce
                  </span>
                  {lastSection === 'marketplace' && (
                    <span
                      style={{
                        background: '#22c55e',
                        color: '#ffffff',
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                        padding: '3px 8px',
                        borderRadius: 999,
                        textTransform: 'uppercase'
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.2)',
                    backdropFilter: 'blur(4px)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#ffffff'
                  }}
                >
                  <ShoppingBag size={24} />
                </div>
              </div>

              <div style={{ position: 'relative', zIndex: 1, bottom: -18 }}>
                <span
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--green-800)',
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--border)'
                  }}
                >
                  FUW Student Marketplace
                </span>
              </div>
            </div>

            {/* Card Content */}
            <div style={{ padding: '30px 24px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 800 }}>
                FUW Marketplace
              </h3>
              <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Buy, sell and discover products and services around campus. Safe campus escrow, verified student identities, hostel delivery, and trusted peer commerce.
              </p>

              {/* Service Feature Highlights */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  fontSize: 13,
                  color: 'var(--text-primary)'
                }}
              >
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Textbooks, laptops, gadgets &amp; student appliances</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Campus services: laundry, barbing, hair styling, printing</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Protected escrow payments &amp; hostel deliveries</span>
                </li>
              </ul>

              {/* Action Button */}
              <div style={{ marginTop: 'auto' }}>
                <Link
                  to="/marketplace"
                  onClick={() => handleSelectSection('marketplace')}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    padding: '13px 20px',
                    fontSize: 14,
                    fontWeight: 700,
                    borderRadius: 10,
                    gap: 8
                  }}
                >
                  <span>Open Marketplace</span>
                  <ArrowRight size={15} />
                </Link>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 12, fontSize: 12 }}>
                  <Link to="/marketplace/browse" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                    Browse Products
                  </Link>
                  <span>·</span>
                  <Link to="/marketplace/vendor/register" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                    Open Storefront
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: FUW Accommodation */}
          <div
            className={`service-card card ${fx.fadeUp}`}
            style={{
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 18,
              border: lastSection === 'accommodation' ? '2px solid var(--green-600, #16a34a)' : '1px solid var(--border)',
              boxShadow: lastSection === 'accommodation' ? '0 0 0 1px var(--green-600, #16a34a), var(--shadow-md)' : undefined,
              overflow: 'hidden',
              transition: 'transform 0.22s var(--ease), box-shadow 0.22s var(--ease)'
            }}
          >
            {/* Card Header Media Band */}
            <div
              style={{
                height: 140,
                ...hubBandStyle('accommodation'),
                padding: '24px 24px 0',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <HubMotifLayer motif="accommodation" />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      background: 'rgba(255, 255, 255, 0.18)',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      padding: '4px 10px',
                      borderRadius: 999,
                      textTransform: 'uppercase'
                    }}
                  >
                    Campus Housing
                  </span>
                  {lastSection === 'accommodation' && (
                    <span
                      style={{
                        background: '#22c55e',
                        color: '#ffffff',
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                        padding: '3px 8px',
                        borderRadius: 999,
                        textTransform: 'uppercase'
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.2)',
                    backdropFilter: 'blur(4px)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#ffffff'
                  }}
                >
                  <Home size={24} />
                </div>
              </div>

              <div style={{ position: 'relative', zIndex: 1, bottom: -18 }}>
                <span
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--green-800)',
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    boxShadow: 'var(--shadow-sm)',
                    border: '1px solid var(--border)'
                  }}
                >
                  FUW Verified Lodges
                </span>
              </div>
            </div>

            {/* Card Content */}
            <div style={{ padding: '30px 24px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 800 }}>
                FUW Accommodation
              </h3>
              <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                Find accommodation that fits your location, budget and needs. Verified self-contained rooms, student lodges, and flats across New Site, Old Site, and Hospital Road.
              </p>

              {/* Service Feature Highlights */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  fontSize: 13,
                  color: 'var(--text-primary)'
                }}
              >
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Filtered by budget, room type, light &amp; water amenities</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Verified caretakers, direct WhatsApp &amp; phone contacts</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={15} color="var(--green-800)" />
                  <span>Student safety rules &amp; anti-scam report protection</span>
                </li>
              </ul>

              {/* Action Button */}
              <div style={{ marginTop: 'auto' }}>
                <Link
                  to="/accommodation"
                  onClick={() => handleSelectSection('accommodation')}
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    justifyContent: 'center',
                    padding: '13px 20px',
                    fontSize: 14,
                    fontWeight: 700,
                    borderRadius: 10,
                    gap: 8
                  }}
                >
                  <span>Find Accommodation</span>
                  <ArrowRight size={16} />
                </Link>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 12, fontSize: 12 }}>
                  <Link to="/accommodation" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                    New Site Lodges
                  </Link>
                  <span>·</span>
                  <Link to="/accommodation" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                    Female &amp; Male Hostels
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Portal Switcher & Academic Utilities */}
        <section
          className="hub-quick-strip card"
          style={{
            padding: '24px 28px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>
                Looking for your Student Portal Tools?
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Access course registration, GPA calculations, study planner, verified badges, and direct messaging.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link
                to="/student"
                className="btn btn-secondary"
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700 }}
              >
                Go to Student Portal
              </Link>
              <Link
                to="/student/academics"
                className="btn btn-secondary"
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700 }}
              >
                Academics Workspace
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
