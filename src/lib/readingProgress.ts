// Server-side reading progress (cross-device) via the save_reading_progress RPC.
//
// The local store remains the source of truth for the current UI session; this
// module mirrors progress to Supabase on a best-effort basis so a signed-in
// user can resume on another device. Failures never break reading.
import { supabase } from './supabase';

export interface RemoteReadingProgress {
  id: string;
  user_id: string;
  material_id: string | null;
  research_item_id: string | null;
  current_page: number;
  total_pages: number;
  progress_percent: number;
  last_read_at: string;
  created_at: string;
}

/** Persist progress for a library material. Best-effort; resolves false on failure. */
export async function syncMaterialProgress(
  materialId: string,
  page: number,
  totalPages: number
): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  const { error } = await supabase.rpc('save_reading_progress', {
    p_material_id: materialId,
    p_research_item_id: null,
    p_page: page,
    p_total: totalPages
  });
  if (error) {
    console.warn('Failed to sync reading progress:', error.message);
    return false;
  }
  return true;
}

/** Persist progress for a repository research item. Best-effort. */
export async function syncResearchProgress(
  researchItemId: string,
  page: number,
  totalPages: number
): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  const { error } = await supabase.rpc('save_reading_progress', {
    p_material_id: null,
    p_research_item_id: researchItemId,
    p_page: page,
    p_total: totalPages
  });
  if (error) {
    console.warn('Failed to sync research progress:', error.message);
    return false;
  }
  return true;
}

/** Fetch all reading progress rows for the signed-in user. */
export async function fetchMyReadingProgress(): Promise<RemoteReadingProgress[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('reading_progress')
    .select('*')
    .order('last_read_at', { ascending: false });
  if (error) throw error;
  return (data || []) as RemoteReadingProgress[];
}
