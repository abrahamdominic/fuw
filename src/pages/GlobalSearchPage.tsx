import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search,
  BookOpen,
  ShoppingBag,
  Home,
  Users,
  Calendar,
  Bell,
  GraduationCap,
  ArrowRight,
  Clock,
  Loader2,
  Trash2,
  Filter,
  Layers
} from 'lucide-react';
import {
  searchCampusGlobal,
  getRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  SearchCategory,
  GlobalSearchResultItem
} from '../lib/search';
import { SEO } from '../components/SEO';
import { fx } from '../lib/motion';

const CATEGORIES: { id: SearchCategory; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'all', label: 'All Services', icon: Search },
  { id: 'library', label: 'E-Library', icon: BookOpen },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
  { id: 'accommodation', label: 'Accommodation', icon: Home },
  { id: 'roommates', label: 'Roommates', icon: Users },
  { id: 'events', label: 'Events', icon: Calendar },
  { id: 'announcements', label: 'Announcements', icon: Bell }
];

export function GlobalSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const urlCategory = (searchParams.get('category') as SearchCategory) || 'all';

  const [inputVal, setInputVal] = useState(urlQuery);
  const [category, setCategory] = useState<SearchCategory>(urlCategory);
  const [results, setResults] = useState<GlobalSearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  useEffect(() => {
    setInputVal(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    setCategory(urlCategory);
  }, [urlCategory]);

  useEffect(() => {
    const q = urlQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    searchCampusGlobal({
      query: q,
      category,
      limit: 40
    })
      .then((res) => {
        setResults(res.results);
        saveRecentSearch(q);
        setRecentSearches(getRecentSearches());
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not perform search.');
        setResults([]);
      })
      .finally(() => setLoading(false));
  }, [urlQuery, category]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputVal.trim();
    if (clean) {
      setSearchParams({ q: clean, category });
    } else {
      setSearchParams({});
    }
  };

  const handleCategoryChange = (newCat: SearchCategory) => {
    setCategory(newCat);
    if (urlQuery) {
      setSearchParams({ q: urlQuery, category: newCat });
    }
  };

  const handleRecentClick = (q: string) => {
    setInputVal(q);
    setSearchParams({ q, category });
  };

  const getCategoryIcon = (cat: GlobalSearchResultItem['category']) => {
    switch (cat) {
      case 'material':
        return <BookOpen size={18} color="var(--brand-green, #12603d)" />;
      case 'course':
        return <GraduationCap size={18} color="#0284c7" />;
      case 'marketplace':
        return <ShoppingBag size={18} color="#ea580c" />;
      case 'accommodation':
        return <Home size={18} color="#16a34a" />;
      case 'roommate':
        return <Users size={18} color="#8b5cf6" />;
      case 'event':
        return <Calendar size={18} color="#059669" />;
      case 'announcement':
        return <Bell size={18} color="#d97706" />;
      default:
        return <Search size={18} color="var(--text-secondary)" />;
    }
  };

  return (
    <>
      <SEO
        title={urlQuery ? `Search: "${urlQuery}" | FUW Campus Hub` : 'Global Campus Search | FUW Ecosystem'}
        description="Search across Federal University Wukari digital ecosystem: E-Library materials, marketplace products, verified lodges, and university events."
        path="/search"
      />

      <div className="page-pad" style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 80px' }}>
        {/* Search Header Banner */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            FUW Global Campus Search
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            Search across library materials, courses, marketplace listings, hostels, roommates and campus events.
          </p>
        </div>

        {/* Search Input Form */}
        <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 14,
              padding: '6px 14px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <Search size={22} color="var(--brand-green, #12603d)" style={{ marginRight: 10 }} />
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Search by course code, keyword, hostel name, product, or event..."
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--text-primary)',
                padding: '8px 0'
              }}
            />
            {inputVal && (
              <button
                type="button"
                onClick={() => setInputVal('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: 6
                }}
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              style={{
                padding: '8px 20px',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                marginLeft: 8
              }}
            >
              Search
            </button>
          </div>
        </form>

        {/* Category Filter Pills */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 24
          }}
        >
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryChange(cat.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 16px',
                  borderRadius: 999,
                  border: active ? '1px solid var(--brand-green, #12603d)' : '1px solid var(--border)',
                  background: active ? 'var(--brand-green, #12603d)' : 'var(--surface)',
                  color: active ? '#ffffff' : 'var(--text-primary)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                <Icon size={14} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content Area */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Loader2 size={36} className="spin" color="var(--brand-green, #12603d)" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Searching the FUW ecosystem...</div>
          </div>
        ) : error ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: '#dc2626' }}>
            {error}
          </div>
        ) : urlQuery.trim().length >= 2 ? (
          <div>
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
              Found <strong>{results.length}</strong> results for "<strong>{urlQuery}</strong>"
            </div>

            {results.length === 0 ? (
              <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
                <Search size={40} style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>No results found</h3>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', maxWidth: 460, marginInline: 'auto' }}>
                  No materials, courses, products, or lodges matched your search. Try broadening your keywords or switching to "All Services".
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {results.map((item, idx) => (
                  <Link
                    key={`${item.category}-${item.id}-${idx}`}
                    to={item.url}
                    className="card"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: '16px 20px',
                      textDecoration: 'none',
                      color: 'inherit',
                      borderRadius: 12,
                      transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'var(--surface-alt)',
                        border: '1px solid var(--border)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0
                      }}
                    >
                      {getCategoryIcon(item.category)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {item.subtitle}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: 'var(--surface-alt)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        {item.category}
                      </span>
                      <ArrowRight size={16} color="var(--text-secondary)" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Recent Searches Panel */}
            {recentSearches.length > 0 && (
              <div className="card" style={{ padding: 20, marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
                    Recent Searches
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentSearches();
                      setRecentSearches([]);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <Trash2 size={12} /> Clear history
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {recentSearches.map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleRecentClick(q)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        borderRadius: 8,
                        background: 'var(--surface-alt)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: 13,
                        cursor: 'pointer'
                      }}
                    >
                      <Clock size={12} color="var(--text-secondary)" />
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Popular Topics / Suggestions */}
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Suggested Categories</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <Link
                  to="/library"
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}
                >
                  <BookOpen size={20} color="var(--brand-green, #12603d)" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>E-Library</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Handouts, past questions</div>
                  </div>
                </Link>

                <Link
                  to="/marketplace"
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}
                >
                  <ShoppingBag size={20} color="#ea580c" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Marketplace</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Gadgets, campus services</div>
                  </div>
                </Link>

                <Link
                  to="/accommodation"
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}
                >
                  <Home size={20} color="#16a34a" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Accommodation</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Verified student lodges</div>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default GlobalSearchPage;
