import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  X,
  FileText,
  Users,
  ShieldCheck,
  Bell,
  MailPlus,
  Loader2,
  AlertCircle,
  SearchX,
  CornerDownLeft
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fx } from '../lib/motion';

type ResultGroup = 'Materials' | 'Students' | 'Administrators' | 'Invites' | 'Notifications';

interface SearchResult {
  id: string;
  group: ResultGroup;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  badgeTone?: 'approved' | 'pending' | 'rejected' | 'info';
  to?: string;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

const escapeIlike = (raw: string) =>
  raw.trim().replace(/[%_,()\\]/g, (ch) => `\\${ch}`);

const GROUP_ICONS: Record<ResultGroup, typeof FileText> = {
  Materials: FileText,
  Students: Users,
  Administrators: ShieldCheck,
  Invites: MailPlus,
  Notifications: Bell
};

/**
 * Unified dashboard search for the Admin and Super Admin portals.
 * Queries live Supabase data (respecting RLS) across materials, people,
 * invites and the current user's notifications.
 */
export function DashboardSearch({ scope }: { scope: 'admin' | 'super' }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const query = term.trim();
  const isOpen = (focused || mobileOpen) && query.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setMobileOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (!supabase || query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    const requestId = ++requestRef.current;
    setSearching(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      const esc = escapeIlike(query);
      const client = supabase!;

      const materialsQuery = client
        .from('materials')
        .select('id,title,course_code,course_title,department,status,material_type')
        .or(
          `title.ilike.%${esc}%,course_code.ilike.%${esc}%,course_title.ilike.%${esc}%,department.ilike.%${esc}%`
        )
        .order('created_at', { ascending: false })
        .limit(5);

      const studentsQuery = client
        .from('profiles')
        .select('id,full_name,email,matric_number,department')
        .eq('role', 'student')
        .or(
          `full_name.ilike.%${esc}%,email.ilike.%${esc}%,matric_number.ilike.%${esc}%,department.ilike.%${esc}%`
        )
        .order('created_at', { ascending: false })
        .limit(5);

      const staffQuery = scope === 'super'
        ? client
            .from('profiles')
            .select('id,full_name,email,role,is_active')
            .in('role', ['admin', 'super_admin'])
            .or(`full_name.ilike.%${esc}%,email.ilike.%${esc}%`)
            .limit(5)
        : null;

      const invitesQuery = scope === 'super'
        ? client
            .from('admin_invites')
            .select('id,email,full_name,accepted,created_at')
            .or(`email.ilike.%${esc}%,full_name.ilike.%${esc}%`)
            .order('created_at', { ascending: false })
            .limit(4)
        : null;

      const notificationsQuery = client
        .from('notifications')
        .select('id,title,message,is_read,created_at')
        .or(`title.ilike.%${esc}%,message.ilike.%${esc}%`)
        .order('created_at', { ascending: false })
        .limit(4);

      try {
        const settled = await Promise.allSettled([
          materialsQuery,
          studentsQuery,
          staffQuery ?? Promise.resolve({ data: [], error: null }),
          invitesQuery ?? Promise.resolve({ data: [], error: null }),
          notificationsQuery
        ]);

        if (requestId !== requestRef.current) return;

        const found: SearchResult[] = [];
        let hadError = false;

        const collect = (idx: number, map: (rows: any[]) => SearchResult[]) => {
          const res = settled[idx];
          if (res.status === 'rejected') {
            hadError = true;
            return;
          }
          const payload = res.value as any;
          if (payload?.error) {
            hadError = true;
            return;
          }
          found.push(...map((payload?.data ?? []) as any[]));
        };

        collect(0, (rows) =>
          rows.map((r) => ({
            id: `material-${r.id}`,
            group: 'Materials' as const,
            title: r.title,
            subtitle: [r.course_code, r.department].filter(Boolean).join(' · ') || r.course_title || '',
            badge: r.status,
            badgeTone:
              r.status === 'approved' ? ('approved' as const)
              : r.status === 'pending' ? ('pending' as const)
              : ('rejected' as const),
            to: `/materials/${r.id}`
          }))
        );

        collect(1, (rows) =>
          rows.map((r) => ({
            id: `student-${r.id}`,
            group: 'Students' as const,
            title: r.full_name || 'Unnamed account',
            subtitle: [r.email, r.matric_number].filter(Boolean).join(' · '),
            meta: r.department || undefined,
            to: `/admin/users?q=${encodeURIComponent(r.full_name || r.email || '')}`
          }))
        );

        collect(2, (rows) =>
          rows.map((r) => ({
            id: `staff-${r.id}`,
            group: 'Administrators' as const,
            title: r.full_name || 'Unnamed administrator',
            subtitle: r.email,
            badge: r.role === 'super_admin' ? 'Super admin' : 'Admin',
            badgeTone: 'info' as const,
            to: '/super/admins'
          }))
        );

        collect(3, (rows) =>
          rows.map((r) => ({
            id: `invite-${r.id}`,
            group: 'Invites' as const,
            title: r.email,
            subtitle: r.full_name || undefined,
            badge: r.accepted ? 'Accepted' : 'Waiting',
            badgeTone: r.accepted ? ('approved' as const) : ('pending' as const),
            to: '/super/invites'
          }))
        );

        collect(4, (rows) =>
          rows.map((r) => ({
            id: `notif-${r.id}`,
            group: 'Notifications' as const,
            title: r.title,
            subtitle: r.message,
            meta: new Date(r.created_at).toLocaleDateString(),
            badge: r.is_read ? undefined : 'Unread',
            badgeTone: 'info' as const
          }))
        );

        setResults(found);
        setError(hadError ? 'Some records could not be searched. Check your connection.' : null);
        setActiveIndex(-1);
      } finally {
        if (requestId === requestRef.current) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, scope]);

  const reset = useCallback((closeMobile = false) => {
    setTerm('');
    setResults([]);
    setActiveIndex(-1);
    setError(null);
    if (closeMobile) {
      setMobileOpen(false);
      inputRef.current?.blur();
    }
  }, []);

  const goToResult = useCallback(
    (result: SearchResult) => {
      if (!result.to) return;
      reset(true);
      setFocused(false);
      navigate(result.to);
    },
    [navigate, reset]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const target = results[activeIndex];
      if (target) goToResult(target);
    } else if (e.key === 'Escape') {
      if (term) {
        reset();
      } else {
        setFocused(false);
        setMobileOpen(false);
        inputRef.current?.blur();
      }
    }
  };

  const grouped = useMemo(() => {
    const groups = new Map<ResultGroup, SearchResult[]>();
    results.forEach((r) => {
      const list = groups.get(r.group) ?? [];
      list.push(r);
      groups.set(r.group, list);
    });
    return Array.from(groups.entries());
  }, [results]);

  let flatIndex = -1;

  return (
    <div className="dash-search-wrap" ref={wrapRef}>
      <button
        type="button"
        className="dash-search-trigger"
        onClick={() => {
          setMobileOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        aria-label="Search dashboard records"
      >
        <Search size={17} />
      </button>

      {mobileOpen && <div className="dash-search-backdrop" onClick={() => reset(true)} />}

      <div className={`dash-search ${mobileOpen ? 'mobile-open' : ''}`} role="search">
        <label className="sr-only" htmlFor={`dash-search-input-${scope}`}>
          Search dashboard records
        </label>
        <Search size={16} className="dash-search-icon" aria-hidden="true" />
        <input
          id={`dash-search-input-${scope}`}
          ref={inputRef}
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={
            scope === 'super'
              ? 'Search admins, students, materials, invites…'
              : 'Search materials, students, uploads…'
          }
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`dash-search-results-${scope}`}
          aria-label="Search dashboard records"
        />
        {searching && <Loader2 size={15} className="dash-search-spinner spin-icon" aria-hidden="true" />}
        {term && (
          <button
            type="button"
            className="dash-search-clear"
            onClick={() => reset()}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
        <span className="dash-search-kbd" aria-hidden="true">⌘K</span>

        {isOpen && (
          <div
            id={`dash-search-results-${scope}`}
            className={`dash-search-panel ${fx.fadeIn}`}
            role="listbox"
            aria-label="Search results"
          >
            {error && (
              <div className="dash-search-state error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {!error && searching && results.length === 0 && (
              <div className="dash-search-state muted-state">
                <Loader2 size={16} className="spin-icon" />
                <span>Searching records…</span>
              </div>
            )}

            {!error && !searching && results.length === 0 && (
              <div className="dash-search-state muted-state">
                <SearchX size={16} />
                <span>No records match “{query}”.</span>
              </div>
            )}

            {grouped.map(([group, items]) => {
              const Icon = GROUP_ICONS[group];
              return (
                <div key={group} className="dash-search-group">
                  <p className="dash-search-group-label">
                    <Icon size={13} /> {group}
                  </p>
                  {items.map((r) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const interactive = Boolean(r.to);
                    return (
                      <button
                        type="button"
                        key={r.id}
                        role="option"
                        aria-selected={idx === activeIndex}
                        className={`dash-search-item ${idx === activeIndex ? 'active' : ''}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => (interactive ? goToResult(r) : undefined)}
                        disabled={!interactive}
                      >
                        <span className="dash-search-item-main">
                          <b>{r.title}</b>
                          {r.subtitle && <small>{r.subtitle}</small>}
                        </span>
                        <span className="dash-search-item-side">
                          {r.badge && (
                            <span className={`status-badge ${r.badgeTone ?? 'info'}`}>{r.badge}</span>
                          )}
                          {r.meta && <small>{r.meta}</small>}
                          {interactive && <CornerDownLeft size={12} />}
                        </span>
                      </button>
                    );
                  })}
</div>
          );
        })}
          </div>
        )}
      </div>
    </div>
  );
}
