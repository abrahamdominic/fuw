import { supabase } from './supabase';

export type SearchCategory =
  | 'all'
  | 'library'
  | 'materials'
  | 'courses'
  | 'academic'
  | 'marketplace'
  | 'products'
  | 'accommodation'
  | 'hostels'
  | 'roommates'
  | 'events'
  | 'announcements'
  | 'campus';

export interface GlobalSearchResultItem {
  id: string;
  category: 'material' | 'course' | 'marketplace' | 'accommodation' | 'roommate' | 'event' | 'announcement';
  title: string;
  subtitle: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface GlobalSearchResponse {
  query: string;
  category: string;
  limit: number;
  offset: number;
  results: GlobalSearchResultItem[];
}

const RECENT_SEARCHES_KEY = 'fuw_recent_campus_searches_v1';
const MAX_RECENT_SEARCHES = 8;

export function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): void {
  const clean = query.trim();
  if (!clean || clean.length < 2) return;
  try {
    const existing = getRecentSearches().filter((q) => q.toLowerCase() !== clean.toLowerCase());
    const updated = [clean, ...existing].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Searches across the entire FUW ecosystem using the database-level
 * search_campus_global RPC.
 */
export async function searchCampusGlobal(params: {
  query: string;
  category?: SearchCategory;
  limit?: number;
  offset?: number;
}): Promise<GlobalSearchResponse> {
  const q = params.query.trim();
  const cat = params.category || 'all';
  const limit = Math.min(Math.max(params.limit || 20, 1), 50);
  const offset = Math.max(params.offset || 0, 0);

  if (!q || q.length < 2) {
    return {
      query: q,
      category: cat,
      limit,
      offset,
      results: []
    };
  }

  if (!supabase) {
    return {
      query: q,
      category: cat,
      limit,
      offset,
      results: []
    };
  }

  const { data, error } = await supabase.rpc('search_campus_global', {
    p_query: q,
    p_category: cat,
    p_limit: limit,
    p_offset: offset
  });

  if (error) {
    console.error('Global campus search error:', error.message);
    throw new Error(error.message);
  }

  return (
    (data as GlobalSearchResponse) || {
      query: q,
      category: cat,
      limit,
      offset,
      results: []
    }
  );
}
