import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchCategories, fetchProducts, fetchVisibleAdverts } from '../lib/api';
import type { MarketplaceCategory, MarketplaceProduct, ProductFilters, ListingType, ItemCondition, VisibleAdvert } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { AdvertStrip } from '../components/AdvertCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { scrollToTop } from '../lib/scroll';
import { SEO } from '../../components/SEO';

export const BrowsePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [adverts, setAdverts] = useState<VisibleAdvert[]>([]);

  // Parse filters from URL
  const search = searchParams.get('search') || '';
  const categorySlug = searchParams.get('category') || '';
  const listingType = (searchParams.get('listingType') as ListingType | 'all') || 'all';
  const condition = (searchParams.get('condition') as ItemCondition | 'all') || 'all';
  const sortBy = (searchParams.get('sortBy') as any) || 'newest';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = 18;

  // Local state for price inputs
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') || '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') || '');

  useEffect(() => {
    fetchCategories().then(setCategories).catch(console.error);
  }, []);

  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      setLoadError(false);
      try {
        const filters: ProductFilters = {
          search: search || undefined,
          category: categorySlug || undefined,
          listingType,
          condition,
          sortBy,
          minPriceKobo: minPrice ? parseInt(minPrice, 10) * 100 : undefined,
          maxPriceKobo: maxPrice ? parseInt(maxPrice, 10) * 100 : undefined,
        };

        const res = await fetchProducts(filters, page, limit);
        setProducts(res.products);
        setTotalCount(res.totalCount);
      } catch (err) {
        console.error('Error fetching products:', err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }

    loadProducts();
    // Placements are supplementary; failing to load them must not break search.
    fetchVisibleAdverts(undefined, 8)
      .then((r) => setAdverts(r.adverts ?? []))
      .catch((err) => {
        console.error('Failed to load adverts:', err);
        setAdverts([]);
      });
    scrollToTop();
  }, [search, categorySlug, listingType, condition, sortBy, page, searchParams, retryKey]);

  const updateParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!val || val === 'all') {
      next.delete(key);
    } else {
      next.set(key, val);
    }
    next.set('page', '1'); // reset page on filter change
    setSearchParams(next);
  };

  const handleApplyPrice = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (minPrice) next.set('minPrice', minPrice);
    else next.delete('minPrice');
    if (maxPrice) next.set('maxPrice', maxPrice);
    else next.delete('maxPrice');
    next.set('page', '1');
    setSearchParams(next);
  };

  const clearAllFilters = () => {
    setMinPrice('');
    setMaxPrice('');
    setSearchParams(new URLSearchParams());
  };

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div style={{ paddingBottom: 60 }}>
      <SEO
        title="Browse Campus Products & Services | FUW Marketplace"
        description="Discover verified student products and services at Federal University Wukari. Search textbooks, gadgets, housing supplies, and services by category and price."
        path="/marketplace/browse"
        keywords={[
          'browse FUW marketplace',
          'FUW campus listings',
          'student items Wukari',
          'student services FUW'
        ]}
        image="/images/fuw-marketplace-og.png"
      />
      {/* Top Header Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border, #dcebe0)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(20px, 4.6vw, 26px)', fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
            {categorySlug
              ? categories.find((c) => c.slug === categorySlug)?.name || 'Category'
              : search
              ? `Results for "${search}"`
              : 'All Marketplace Listings'}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
            Showing {totalCount} {totalCount === 1 ? 'result' : 'results'} across FUW campus
          </p>
        </div>

        {/* Sort & Mobile filter trigger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="mobile-only"
            onClick={() => setMobileFiltersOpen(true)}
            style={{
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border, #dcebe0)',
              background: 'var(--surface, #ffffff)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <SlidersHorizontal size={15} />
            <span>Filters</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary, #55675b)', fontWeight: 500 }}>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => updateParam('sortBy', e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--border, #dcebe0)',
                background: 'var(--surface, #ffffff)',
                color: 'var(--text-primary, #17231d)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <option value="newest">Newest First</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Top Rated</option>
              <option value="popular">Most Popular</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Layout: Sidebar Filters + Products Grid */}
      <div className="browse-grid-container">
        {/* Left Filter Sidebar — hidden below 769px, the drawer takes over */}
        <aside className="desktop-only mp-browse-filters">
          {/* Active Filter Pills / Clear */}
          {(categorySlug || search || listingType !== 'all' || condition !== 'all' || minPrice || maxPrice) && (
            <div style={{ padding: '12px 14px', background: 'var(--surface-alt, #f4f8f5)', borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary, #55675b)' }}>
                  Active Filters
                </span>
                <button
                  type="button"
                  onClick={clearAllFilters}
                  style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  Clear all
                </button>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {categorySlug && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: '#ffffff', border: '1px solid var(--border, #dcebe0)', fontSize: 12 }}>
                    {categories.find((c) => c.slug === categorySlug)?.name || categorySlug}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => updateParam('category', null)} />
                  </span>
                )}
                {search && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: '#ffffff', border: '1px solid var(--border, #dcebe0)', fontSize: 12 }}>
                    "{search}"
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => updateParam('search', null)} />
                  </span>
                )}
                {listingType !== 'all' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: '#ffffff', border: '1px solid var(--border, #dcebe0)', fontSize: 12 }}>
                    {listingType}
                    <X size={12} style={{ cursor: 'pointer' }} onClick={() => updateParam('listingType', null)} />
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Type Filter */}
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
              Listing Type
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: 'All Listings', value: 'all' },
                { label: 'Physical Products', value: 'product' },
                { label: 'Campus Services', value: 'service' },
              ].map((opt) => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="listingType"
                    checked={listingType === opt.value}
                    onChange={() => updateParam('listingType', opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Category Filter */}
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
              Categories
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
              <button
                type="button"
                onClick={() => updateParam('category', null)}
                style={{
                  textAlign: 'left',
                  background: !categorySlug ? 'var(--green-100, #e8f5ec)' : 'transparent',
                  color: !categorySlug ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
                  fontWeight: !categorySlug ? 700 : 500,
                  border: 'none',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => updateParam('category', cat.slug)}
                  style={{
                    textAlign: 'left',
                    background: categorySlug === cat.slug ? 'var(--green-100, #e8f5ec)' : 'transparent',
                    color: categorySlug === cat.slug ? 'var(--green-900, #0d4a2f)' : 'var(--text-primary, #17231d)',
                    fontWeight: categorySlug === cat.slug ? 700 : 500,
                    border: 'none',
                    padding: '6px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range Filter */}
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
              Price Range (₦)
            </h4>
            <form onSubmit={handleApplyPrice} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  placeholder="Min"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                  }}
                />
                <span style={{ color: 'var(--muted, #55675b)' }}>-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #dcebe0)',
                  background: 'var(--surface-alt, #f4f8f5)',
                  color: 'var(--green-800, #12603d)',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Apply Price
              </button>
            </form>
          </div>

          {/* Condition Filter */}
          <div>
            <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
              Condition
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: 'All Conditions', value: 'all' },
                { label: 'Brand New', value: 'new' },
                { label: 'Like New', value: 'like_new' },
                { label: 'Good Condition', value: 'good' },
                { label: 'Fair / Used', value: 'fair' },
              ].map((c) => (
                <label key={c.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="condition"
                    checked={condition === c.value}
                    onChange={() => updateParam('condition', c.value)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Product Grid */}
        <main>
          {/* Placements are pinned above the organic results the filters return. */}
          <AdvertStrip title="Sponsored placements" adverts={adverts} />
          {loadError && !loading ? (
            <EmptyState
              title="Couldn't load listings"
              description="Something went wrong while fetching listings. Check your connection and try again."
              action={
                <button
                  type="button"
                  onClick={() => setRetryKey((k) => k + 1)}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    background: 'var(--green-800, #12603d)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Try Again
                </button>
              }
            />
          ) : loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 16 }}>
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} height={320} borderRadius={12} />
              ))}
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              title="No products or services found"
              description="Try adjusting your filters, searching for a different keyword, or exploring another campus category."
              action={
                <button
                  type="button"
                  onClick={clearAllFilters}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 8,
                    background: 'var(--green-800, #12603d)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Reset All Filters
                </button>
              }
            />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 16 }}>
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    marginTop: 36,
                    paddingTop: 20,
                    borderTop: '1px solid var(--border, #dcebe0)',
                  }}
                >
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => updateParam('page', String(page - 1))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'var(--surface, #ffffff)',
                      cursor: page <= 1 ? 'not-allowed' : 'pointer',
                      opacity: page <= 1 ? 0.5 : 1,
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <ChevronLeft size={16} />
                    <span>Previous</span>
                  </button>

                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #55675b)' }}>
                    Page {page} of {totalPages}
                  </span>

                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => updateParam('page', String(page + 1))}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border, #dcebe0)',
                      background: 'var(--surface, #ffffff)',
                      cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                      opacity: page >= totalPages ? 0.5 : 1,
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile Filters Drawer */}
      {mobileFiltersOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={() => setMobileFiltersOpen(false)}
        >
          <div
            style={{
              width: '85%',
              maxWidth: 320,
              background: 'var(--surface, #ffffff)',
              height: '100%',
              padding: 24,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Filters</h3>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>
            <div>
              <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }}>Listing Type</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'All Listings', value: 'all' },
                  { label: 'Products', value: 'product' },
                  { label: 'Services', value: 'service' },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      updateParam('listingType', item.value === 'all' ? null : item.value);
                      setMobileFiltersOpen(false);
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: listingType === item.value ? 'var(--green-50, #ebf5ee)' : 'transparent',
                      color: listingType === item.value ? 'var(--green-900, #0d4a2f)' : 'inherit',
                      fontWeight: listingType === item.value ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={() => {
                  clearAllFilters();
                  setMobileFiltersOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #b91c1c',
                  background: '#fee2e2',
                  color: '#b91c1c',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reset All Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
