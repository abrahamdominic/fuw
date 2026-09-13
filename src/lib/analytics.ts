import { requireSupabase } from './supabase';
import type {
  AnalyticsDashboard,
  RecentAnalyticsEventRow,
  TopMaterialRow
} from './analyticsTypes';

export interface GenderCountRow {
  gender: string;
  count: number;
}

export interface NameCountRow {
  name: string;
  count: number;
}

export async function fetchGenderCounts(): Promise<GenderCountRow[]> {
  const { data, error } = await requireSupabase().rpc('count_students_by_gender');
  if (error) throw new Error(error.message);
  return (data || []) as GenderCountRow[];
}

export async function fetchMaterialsByFaculty(): Promise<NameCountRow[]> {
  const { data, error } = await requireSupabase().rpc('count_materials_by_faculty');
  if (error) throw new Error(error.message);
  return (data || []) as NameCountRow[];
}

export async function fetchMaterialsByDepartment(): Promise<NameCountRow[]> {
  const { data, error } = await requireSupabase().rpc('count_materials_by_department');
  if (error) throw new Error(error.message);
  return (data || []) as NameCountRow[];
}

// ── Platform analytics (20260913_platform_analytics migration) ──────────────

export async function fetchAnalyticsDashboard(): Promise<AnalyticsDashboard | null> {
  const { data, error } = await requireSupabase().rpc('get_analytics_dashboard');
  if (error) return null;
  return (data as unknown as AnalyticsDashboard) || null;
}

export async function fetchTopMaterials(
  limit = 10,
  days = 30
): Promise<TopMaterialRow[]> {
  const { data, error } = await requireSupabase().rpc('get_top_materials', {
    p_limit: limit,
    p_days: days
  });
  if (error) return [];
  return (data as unknown as TopMaterialRow[]) || [];
}

export async function fetchRecentAnalyticsEvents(
  limit = 50
): Promise<RecentAnalyticsEventRow[]> {
  const { data, error } = await requireSupabase().rpc('get_recent_analytics_events', {
    p_limit: limit
  });
  if (error) return [];
  return (data as unknown as RecentAnalyticsEventRow[]) || [];
}

export async function purgeAnalyticsData(olderThanDays = 180): Promise<number> {
  const { data, error } = await requireSupabase().rpc('purge_analytics_data', {
    p_older_than_days: olderThanDays
  });
  if (error || typeof data !== 'number') return 0;
  return data;
}