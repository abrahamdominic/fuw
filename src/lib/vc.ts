// =============================================================================
// Vice-Chancellor executive dashboard — data layer.
//
// The VC front-end is read-only and talks exclusively to the narrowly-scoped
// vc_* aggregate RPCs (supabase/migrations/20261014131000_vc_dashboard_and_
// security.sql). Those functions check `is_vc()` server-side and return only
// aggregates / institutional content — no profile rows, admin details,
// permissions, wallets, accommodation or marketplace data are ever surfaced.
// =============================================================================

import { requireSupabase } from './supabase';

export interface VcOverviewStats {
  students: number;
  active_students: number;
  verified_students: number;
  pending_verifications: number;
  lecturers: number;
  faculties: number;
  departments: number;
  courses: number;
  approved_materials: number;
  pending_materials: number;
  rejected_materials: number;
  total_downloads: number;
  total_views: number;
  announcements: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface MonthCount {
  label: string;
  count: number;
}

export interface VcStudentInsights {
  by_faculty: NameCount[];
  by_department: NameCount[];
  by_level: NameCount[];
  by_gender: NameCount[];
  verification_breakdown: NameCount[];
  registrations_by_month: MonthCount[];
}

export interface TopMaterialRow {
  id: string;
  title: string;
  faculty: string;
  department: string;
  level: string;
  course_code: string;
  downloads: number;
  views: number;
}

export interface VcAcademicResources {
  totals: {
    approved_materials: number;
    pending_materials: number;
    total_downloads: number;
    total_views: number;
  };
  by_type: NameCount[];
  by_faculty: NameCount[];
  by_department: NameCount[];
  top_materials: TopMaterialRow[];
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: string;
  published_at: string;
}

export interface RecentMaterialRow {
  id: string;
  title: string;
  faculty: string;
  department: string;
  level: string;
  course_code: string;
  created_at: string;
}

export interface VcReportsOverview {
  announcements: AnnouncementRow[];
  recent_materials: RecentMaterialRow[];
  published_this_month: number;
}

async function rpcVc<T>(rpc: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = args
      ? await requireSupabase().rpc(rpc, args)
      : await requireSupabase().rpc(rpc);
    if (error) return null;
    return (data as unknown as T) ?? null;
  } catch {
    return null;
  }
}

export async function fetchVcOverview(): Promise<VcOverviewStats | null> {
  return rpcVc<VcOverviewStats>('vc_overview_stats');
}

export async function fetchVcStudentInsights(): Promise<VcStudentInsights | null> {
  return rpcVc<VcStudentInsights>('vc_student_insights');
}

export async function fetchVcAcademicResources(): Promise<VcAcademicResources | null> {
  return rpcVc<VcAcademicResources>('vc_academic_resources');
}

export async function fetchVcReportsOverview(): Promise<VcReportsOverview | null> {
  return rpcVc<VcReportsOverview>('vc_reports_overview');
}

// Super-Admin provisioning helpers (integration surface for /super). A VC can
// never call these — the RPCs themselves reject any caller that is not the
// platform Super Admin.
export interface VcAccountRow {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function provisionViceChancellor(targetUserId: string): Promise<{ error?: string }> {
  const { error } = await requireSupabase().rpc('provision_vice_chancellor', {
    target_user_id: targetUserId
  });
  return { error: error?.message };
}

export async function revokeViceChancellor(targetUserId: string): Promise<{ error?: string }> {
  const { error } = await requireSupabase().rpc('revoke_vice_chancellor', {
    target_user_id: targetUserId
  });
  return { error: error?.message };
}

export async function listViceChancellors(): Promise<VcAccountRow[]> {
  const { data, error } = await requireSupabase().rpc('list_vice_chancellors');
  if (error) return [];
  return (data as unknown as VcAccountRow[]) ?? [];
}