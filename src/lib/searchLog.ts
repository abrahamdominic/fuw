// Fire-and-forget search logging into the `search_logs` table (Phase: search
// analytics). Deliberately best-effort: a missing table (migration not yet
// applied) or a transient network error must never break the search UI.
import { supabase } from './supabase';

export interface SearchLogFilter {
  faculty?: string;
  department?: string;
  level?: string;
  semester?: string;
  type?: string;
}

export function logSearch(
  query: string,
  resultCount: number | undefined,
  filters: SearchLogFilter = {}
): void {
  const q = (query || '').trim();
  if (!supabase || q.length === 0 || q.length > 200) return;

  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const sessionId = window.localStorage.getItem('fuw_analytics_session_id_v1') ?? null;
      await supabase.from('search_logs').insert({
        user_id: user?.id ?? null,
        anonymous_id: window.localStorage.getItem('fuw_anonymous_id_v1') ?? null,
        session_id: sessionId,
        query: q,
        normalized_query: q.toLowerCase().replace(/\s+/g, ' ').trim(),
        result_count: resultCount ?? 0,
        filters: JSON.parse(JSON.stringify(filters))
      });
    } catch {
      // Best-effort only.
    }
  })();
}