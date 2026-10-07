import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Search,
  Briefcase,
  ShoppingBag,
  Store,
  ChevronRight,
  TrendingUp,
  Utensils,
  BookOpen,
  Shirt,
  Smartphone,
  Scissors,
  Wrench,
  ArrowRight,
  CheckCircle2,
  X,
} from 'lucide-react';
import { fetchCategories, fetchProducts, fetchVisibleAdverts } from '../lib/api';
import type { MarketplaceCategory, MarketplaceProduct, VisibleAdvert } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { AdvertStrip } from '../components/AdvertCard';
import { Skeleton } from '../components/Skeleton';
import { mpPath } from '../lib/routes';
import { SEO } from '../../components/SEO';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<MarketplaceProduct[]>([]);
  const [featuredServices, setFeaturedServices] = useState<MarketplaceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchVal, setSearchVal] = useState('');
  const [sponsoredAdverts, setSponsoredAdverts] = useState<VisibleAdvert[]>([]);
  const [featuredAdverts, setFeaturedAdverts] = useState<VisibleAdvert[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [cats, prods, servs] = await Promise.all([
          fetchCategories(),
          fetchProducts({ listingType: 'product' }, 1, 8),
          fetchProducts({ listingType: 'service' }, 1, 8),
        ]);
        if (active) {
          setCategories(cats);
          setFeaturedProducts(prods.products);
          setFeaturedServices(servs.products);
        }

        // Placements are supplementary: a failure here must not empty the page.
        const placements = await fetchVisibleAdverts(undefined, 12).catch((err) => {
          console.error('Failed to load adverts:', err);
          return null;
        });
        if (placements && active) {
          setSponsoredAdverts(placements.adverts.filter((a) => a.advert_type === 'sponsored'));
          setFeaturedAdverts(placements.adverts.filter((a) => a.advert_type === 'featured'));
        }
      } catch (err) {
        if (active) {
          console.error('Failed to load home page data:', err);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();

    return () => {
      active = false;
    };
  }, []);

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchVal.trim()) {
      navigate(mpPath(`/browse?search=${encodeURIComponent(searchVal.trim())}`));
    }
  };

  const POPULAR_CHIPS = [
    { label: 'Food', icon: Utensils, query: 'Food' },
    { label: 'Textbooks', icon: BookOpen, query: 'Textbooks' },
    { label: 'Laundry', icon: Shirt, query: 'Laundry' },
    { label: 'Phones', icon: Smartphone, query: 'Phones' },
    { label: 'Barbing', icon: Scissors, query: 'Barbing' },
    { label: 'Repairs', icon: Wrench, query: 'Repairs' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingBottom: 60 }}>
      <SEO
        title="FUW Marketplace | Federal University Wukari Student Commerce"
        description="The official student marketplace for Federal University Wukari. Buy and sell textbooks, gadgets, food, laundry and campus services with escrow protection."
        path="/marketplace"
        keywords={[
          'FUW Marketplace',
          'Federal University Wukari Marketplace',
          'FUW student marketplace',
          'FUW campus marketplace',
          'buy and sell FUW',
          'student textbooks Wukari',
          'FUW campus commerce'
        ]}
        image="/images/fuw-marketplace-og.png"
        imageAlt="FUW Marketplace: Student Commerce, Textbooks, Gadgets & Campus Services"
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Marketplace', path: '/marketplace' }
        ]}
        schema="itemList"
      />
      {/* Hero Section */}
      <section className="mp-hero-card" aria-label="FUW Student Marketplace">
        <div className="mp-hero-content">
          {/* Trust badge */}
          <div className="mp-hero-trust-badge">
            <ShieldCheck size={16} color="#34d399" style={{ flexShrink: 0 }} />
            <span>FUW Protected Student Commerce</span>
            <span style={{ opacity: 0.7 }}>·</span>
            <span style={{ color: '#a7f3d0' }}>Escrow-Protected &amp; Student-Verified</span>
          </div>

          {/* Headline */}
          <h1 className="mp-hero-headline">
            Buy, Sell &amp; Offer Services across FUW Campus with Confidence.
          </h1>

          {/* Description */}
          <p className="mp-hero-description">
            From hot dorm meals and course textbooks to laundry, barbing and gadget repairs.
            Student payments are safely held in FUW escrow until you confirm delivery or service completion.
          </p>

          {/* Large Responsive Search Box */}
          <form
            onSubmit={handleHeroSearch}
            className="mp-hero-search-form"
            role="search"
            aria-label="Search campus products and services"
          >
            <div className="mp-hero-search-input-wrap">
              <Search size={19} color="#12603d" style={{ flexShrink: 0 }} aria-hidden="true" />
              <input
                type="text"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                placeholder="Search food, textbooks, laundry, phones, barbing, repairs..."
                className="mp-hero-search-input"
                aria-label="Search term"
              />
              {searchVal.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchVal('')}
                  className="mp-hero-search-clear"
                  aria-label="Clear search input"
                  title="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              type="submit"
              className="mp-hero-search-btn"
              aria-label="Submit search"
            >
              <span>Search</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </form>

          {/* Popular Category Chips */}
          <div className="mp-hero-chips-wrap">
            <span className="mp-hero-chips-label">Popular Categories:</span>
            {POPULAR_CHIPS.map((chip) => {
              const Icon = chip.icon;
              return (
                <Link
                  key={chip.label}
                  to={mpPath(`/browse?search=${encodeURIComponent(chip.query)}`)}
                  className="mp-hero-chip"
                >
                  <Icon size={14} color="#34d399" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span>{chip.label}</span>
                </Link>
              );
            })}
          </div>

          {/* Trust Guarantees Micro-Row */}
          <div className="mp-hero-trust-strip">
            <div className="mp-hero-trust-item">
              <ShieldCheck size={14} color="#34d399" />
              <span>Escrow Safe: Funds released on confirmation</span>
            </div>
            <div className="mp-hero-trust-item">
              <Store size={14} color="#34d399" />
              <span>Verified Student Vendors</span>
            </div>
            <div className="mp-hero-trust-item">
              <CheckCircle2 size={14} color="#34d399" />
              <span>100% On-Campus Handover</span>
            </div>
          </div>
        </div>
      </section>

      {/* Categories Grid */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary, #17231d)', margin: '0 0 4px' }}>
              Explore Campus Categories
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
              Physical products and student services available in Wukari
            </p>
          </div>
          <Link
            to={mpPath("/browse")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--green-800, #12603d)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            <span>View All</span>
            <ChevronRight size={16} />
          </Link>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(140px, 100%), 1fr))', gap: 12 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={80} borderRadius={12} />
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))',
              gap: 12,
            }}
          >
            {categories.slice(0, 12).map((cat) => (
              <Link
                key={cat.id}
                to={mpPath(`/browse?category=${cat.slug}`)}
                style={{
                  background: 'var(--surface, #ffffff)',
                  border: '1px solid var(--border, #dcebe0)',
                  borderRadius: 12,
                  padding: '16px 14px',
                  textDecoration: 'none',
                  color: 'inherit',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 10,
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: cat.listing_type === 'service' ? '#e0f2fe' : 'var(--green-100, #e8f5ec)',
                    color: cat.listing_type === 'service' ? '#0369a1' : 'var(--green-800, #12603d)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShoppingBag size={20} />
                </div>
                <div>
                  <h4 style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
                    {cat.name}
                  </h4>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: cat.listing_type === 'service' ? '#0369a1' : 'var(--green-700, #0f6b41)',
                    }}
                  >
                    {cat.listing_type}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Paid placements, ahead of the organic rows */}
      <AdvertStrip title="Sponsored on campus" adverts={sponsoredAdverts} />
      <AdvertStrip title="Featured this week" adverts={featuredAdverts} />

      {/* Featured Physical Products */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <TrendingUp size={18} color="var(--green-800, #12603d)" />
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary, #17231d)', margin: 0 }}>
                Featured Campus Products
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
              Handpicked products from verified student sellers
            </p>
          </div>
          <Link
            to={mpPath("/browse?listingType=product")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--green-800, #12603d)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            <span>Explore Products</span>
            <ChevronRight size={16} />
          </Link>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={320} borderRadius={12} />
            ))}
          </div>
        ) : featuredProducts.length === 0 ? (
          <div
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              background: 'var(--surface-alt, #f4f8f5)',
              borderRadius: 14,
              border: '1px dashed var(--border, #dcebe0)',
            }}
          >
            <ShoppingBag size={36} color="var(--muted, #55675b)" style={{ marginBottom: 10 }} />
            <h4 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>No products listed yet</h4>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
              Be the first student to open a storefront and sell products to FUW students!
            </p>
            <Link
              to={mpPath("/vendor/register")}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 18px',
                borderRadius: 8,
                background: 'var(--green-800, #12603d)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
              }}
            >
              <Store size={16} />
              <span>Start Selling Now</span>
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            {featuredProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* Featured Campus Services */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Briefcase size={18} color="#0369a1" />
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary, #17231d)', margin: 0 }}>
                Campus Services & Skills
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
              Laundry, barbing, braids, printing, design, photography and tutoring by fellow students
            </p>
          </div>
          <Link
            to={mpPath("/browse?listingType=service")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#0369a1',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            <span>Explore Services</span>
            <ChevronRight size={16} />
          </Link>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={320} borderRadius={12} />
            ))}
          </div>
        ) : featuredServices.length === 0 ? (
          <div
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              background: 'var(--surface-alt, #f4f8f5)',
              borderRadius: 14,
              border: '1px dashed var(--border, #dcebe0)',
            }}
          >
            <Briefcase size={36} color="var(--muted, #55675b)" style={{ marginBottom: 10 }} />
            <h4 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>No services listed yet</h4>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
              Offer your skills (barbing, styling, typing, tutoring, laundry) to students on campus!
            </p>
            <Link
              to={mpPath("/vendor/register")}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 18px',
                borderRadius: 8,
                background: 'var(--green-800, #12603d)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
              }}
            >
              <Store size={16} />
              <span>Offer a Service</span>
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 16 }}>
            {featuredServices.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* How It Works & Protection Banner */}
      <section
        style={{
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 16,
          padding: '36px 24px',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 600, margin: '0 auto 36px' }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--green-800, #12603d)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Trust & Security
          </span>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: '6px 0 10px', color: 'var(--text-primary, #17231d)' }}>
            How FUW Student Marketplace Protects You
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary, #55675b)', margin: 0, lineHeight: 1.5 }}>
            We act as the trusted campus intermediary so you never send money to someone who runs away with your cash.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
              1
            </div>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Place Order & Pay</h4>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)', lineHeight: 1.4 }}>
              Choose pickup or hostel delivery. Payment is recorded and held safely in platform escrow.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
              2
            </div>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Vendor Fulfils</h4>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)', lineHeight: 1.4 }}>
              The student vendor prepares your order and delivers to your hostel or agreed campus spot.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
              3
            </div>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Confirm Receipt</h4>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)', lineHeight: 1.4 }}>
              Inspect the item. Click "Confirm Receipt" to release funds to the seller, or open a dispute if issues exist.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'center', alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
              4
            </div>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Leave a Review</h4>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)', lineHeight: 1.4 }}>
              Rate your experience. Reviews are only allowed for verified completed orders, eliminating fake ratings.
            </p>
          </div>
        </div>
      </section>

      {/* Become a Vendor CTA Card */}
      <section
        style={{
          background: 'linear-gradient(135deg, #173f2b 0%, #0d4a2f 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '40px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 24,
        }}
      >
        <div style={{ maxWidth: 580 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Campus Entrepreneurs
          </span>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: '6px 0 10px', color: '#ffffff' }}>
            Reach Thousands of Federal University Wukari Students
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: '#d1fae5', lineHeight: 1.5 }}>
            Open your campus storefront in minutes. Manage inventory, receive orders with protected payments, and withdraw your earnings directly to your Nigerian bank account.
          </p>
        </div>

        <Link
          to={mpPath("/vendor/register")}
          style={{
            padding: '12px 24px',
            borderRadius: 10,
            background: '#ffffff',
            color: 'var(--green-900, #0d4a2f)',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            whiteSpace: 'nowrap',
          }}
        >
          <Store size={18} />
          <span>Open Campus Storefront</span>
        </Link>
      </section>
    </div>
  );
};
