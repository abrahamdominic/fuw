import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  X,
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
  ExternalLink
} from 'lucide-react';
import {
  searchCampusGlobal,
  getRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  SearchCategory,
  GlobalSearchResultItem
} from '../lib/search';
import { fx } from '../lib/motion';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  initialCategory?: SearchCategory;
}

const CATEGORIES: { id: SearchCategory; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'all', label: 'All Services', icon: Search },
  { id: 'library', label: 'E-Library', icon: BookOpen },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
  { id: 'accommodation', label: 'Accommodation', icon: Home },
  { id: 'roommates', label: 'Roommates', icon: Users },
  { id: 'events', label: 'Events', icon: Calendar },
  { id: 'announcements', label: 'Announcements', icon: Bell }
];

export function GlobalSearchModal({
  isOpen,
  onClose,
  initialQuery = '',
  initialCategory = 'all'
}: GlobalSearchModalProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<SearchCategory>(initialCategory);
  const [results, setResults] = useState<GlobalSearchResultItem[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Sync initial query when modal opens
  useEffect(() => {
    if (isOpen) {
      setRecentSearches(getRecentSearches());
      setQuery(initialQuery);
      setCategory(initialCategory);
      setSelectedIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialQuery, initialCategory]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    const clean = query.trim();
    if (clean.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const res = await searchCampusGlobal({
          query: clean,
          category,
          limit: 30
        });
        setResults(res.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not perform search.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [query, category, isOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (results.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < results.length) {
        e.preventDefault();
        handleSelectResult(results[selectedIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  const handleSelectResult = (item: GlobalSearchResultItem) => {
    saveRecentSearch(query.trim() || item.title);
    onClose();
    navigate(item.url);
  };

  const handleRecentClick = (q: string) => {
    setQuery(q);
    inputRef.current?.focus();
  };

  const handleClearRecents = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  if (!isOpen) return null;

  const getCategoryIcon = (cat: GlobalSearchResultItem['category']) => {
    switch (cat) {
      case 'material':
        return <BookOpen size={16} color="var(--brand-green, #12603d)" />;
      case 'course':
        return <GraduationCap size={16} color="#0284c7" />;
      case 'marketplace':
        return <ShoppingBag size={16} color="#ea580c" />;
      case 'accommodation':
        return <Home size={16} color="#16a34a" />;
      case 'roommate':
        return <Users size={16} color="#8b5cf6" />;
      case 'event':
        return <Calendar size={16} color="#059669" />;
      case 'announcement':
        return <Bell size={16} color="#d97706" />;
      default:
        return <Search size={16} color="var(--text-secondary)" />;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(10, 20, 15, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'clamp(16px, 5vw, 64px) 16px 24px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`card ${fx.fadeUp}`}
        style={{
          width: '100%',
          maxWidth: 680,
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 16,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh'
        }}
      >
        {/* Search Header Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border, #e2e8f0)',
            gap: 12
          }}
        >
          <Search size={20} color="var(--brand-green, #12603d)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library materials, marketplace, lodges, events, courses..."
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 16,
              fontWeight: 500,
              color: 'var(--text-primary, #1e293b)'
            }}
          />
          {loading && <Loader2 size={18} className="spin" color="var(--brand-green, #12603d)" />}
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: 4
              }}
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8 }}
          >
            Esc
          </button>
        </div>

        {/* Category Filters Bar */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 18px',
            background: 'var(--surface-alt, #f8fafc)',
            borderBottom: '1px solid var(--border, #e2e8f0)',
            overflowX: 'auto',
            whiteSpace: 'nowrap'
          }}
        >
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: active ? '1px solid var(--brand-green, #12603d)' : '1px solid var(--border, #e2e8f0)',
                  background: active ? 'var(--brand-green, #12603d)' : 'var(--surface, #ffffff)',
                  color: active ? '#ffffff' : 'var(--text-secondary, #64748b)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={13} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Content Body */}
        <div
          ref={resultsRef}
          style={{
            overflowY: 'auto',
            flex: 1,
            padding: 12
          }}
        >
          {/* Recent Searches (when query is empty) */}
          {!query.trim() && (
            <div style={{ padding: '12px 14px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Recent Searches
                </span>
                {recentSearches.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearRecents}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                )}
              </div>

              {recentSearches.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                  No recent searches. Try searching for "CSC 201", "Calculator", "Unity Lodge", or "Seminar".
                </p>
              ) : (
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
                        padding: '6px 12px',
                        borderRadius: 8,
                        background: 'var(--surface-alt, #f1f5f9)',
                        border: '1px solid var(--border, #e2e8f0)',
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
              )}

              {/* Quick Navigation Prompts */}
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border, #e2e8f0)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Popular Pillars
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate('/library');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <BookOpen size={18} color="var(--brand-green, #12603d)" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>E-Library</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Handouts &amp; past questions</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate('/marketplace');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <ShoppingBag size={18} color="#ea580c" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Marketplace</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Campus gadgets &amp; services</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate('/accommodation');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 10,
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <Home size={18} color="#16a34a" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Accommodation</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Verified student lodges</div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Results List */}
          {query.trim().length >= 2 && (
            <div>
              {error && (
                <div style={{ padding: '16px', color: '#dc2626', fontSize: 13, textAlign: 'center' }}>
                  {error}
                </div>
              )}

              {!loading && !error && results.length === 0 && (
                <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <Search size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    No results found for "{query}"
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Check your spelling or try searching across all categories.
                  </div>
                </div>
              )}

              {results.map((item, idx) => {
                const isSelected = selectedIndex === idx;
                return (
                  <div
                    key={`${item.category}-${item.id}-${idx}`}
                    onClick={() => handleSelectResult(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: isSelected ? 'var(--surface-alt, #f1f5f9)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.1s ease',
                      border: isSelected ? '1px solid var(--border, #cbd5e1)' : '1px solid transparent'
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        background: 'var(--surface-alt, #f8fafc)',
                        border: '1px solid var(--border, #e2e8f0)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0
                      }}
                    >
                      {getCategoryIcon(item.category)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {item.subtitle}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: 'var(--surface-alt, #f1f5f9)',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        {item.category}
                      </span>
                      <ArrowRight size={14} color="var(--text-secondary)" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div
          style={{
            padding: '10px 18px',
            background: 'var(--surface-alt, #f8fafc)',
            borderTop: '1px solid var(--border, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--text-secondary)'
          }}
        >
          <div style={{ display: 'flex', gap: 14 }}>
            <span><kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)' }}>↑</kbd> <kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)' }}>↓</kbd> Navigate</span>
            <span><kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)' }}>↵</kbd> Select</span>
            <span><kbd style={{ padding: '2px 5px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)' }}>Esc</kbd> Close</span>
          </div>
          <div>
            Powered by FUW Campus Global Index
          </div>
        </div>
      </div>
    </div>
  );
}
