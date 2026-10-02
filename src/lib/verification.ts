// Academic identity verification + premium entitlement.
//
// Server owns every state transition here: the client only ever calls the
// guarded RPCs in supabase/migrations/20260924_academic_verification_and_plans.sql.
// Nothing in this file can grant verification or a plan on its own.
import { requireSupabase } from './supabase';

export const EVIDENCE_BUCKET = 'verification-evidence';

export type VerificationStatus = 'unsubmitted' | 'pending' | 'verified' | 'rejected';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface VerificationRequest {
  id: string;
  user_id: string;
  status: RequestStatus;
  matric_number: string;
  faculty: string;
  department: string;
  level: string | null;
  student_note: string | null;
  evidence_path: string | null;
  evidence_name: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface VerificationState {
  status: VerificationStatus;
  reason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface PlanSummary {
  slug: string;
  name: string;
  status: string;
  expires_at: string;
  is_premium: boolean;
}

export interface CatalogPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_kobo: number;
  duration_days: number;
  is_premium: boolean;
  features: string[];
  currency?: string;
}

export const naira = (kobo: number, currency = 'NGN'): string =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(kobo / 100);

/** Turn a Postgres error into something a student can act on. */
function friendly(message: string, fallback: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('already under review')) return 'Your request is already with the library for review.';
  if (m.includes('already verified')) return 'Your account has already been verified.';
  if (m.includes('missing your matriculation number') || m.includes('add your matriculation number'))
    return 'Add your matriculation number, faculty and department in Settings before requesting verification.';
  if (m.includes('complete their profile first'))
    return 'Your profile is missing identity details. Complete your profile and resubmit.';
  if (m.includes('staff accounts')) return 'Staff accounts do not need academic verification.';
  if (m.includes('suspended')) return 'This account is suspended. Please contact the library.';
  if (m.includes('give a reason')) return 'Please give the student a reason for the decision.';
  if (m.includes('already been decided')) return 'That request has already been decided.';
  if (m.includes('administrator privileges')) return 'You do not have permission to do that.';
  return message || fallback;
}

// ─── Student: current verification state ─────────────────────────────────────

/**
 * Read the authoritative state from the server rather than trusting the cached
 * profile row, so a decision made while the app was open is picked up.
 */
export async function fetchVerificationState(): Promise<VerificationState> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('my_verification_status');
  if (error) throw new Error(friendly(error.message, 'Could not read your verification status.'));

  const [reason, profile] = await Promise.all([
    client.rpc('my_verification_reason'),
    // Scoped to the signed-in account: an unscoped maybeSingle() would fail if
    // any other row is ever visible to this user.
    client
      .from('profiles')
      .select('verification_submitted_at, verification_reviewed_at')
      .eq('id', (await client.auth.getUser()).data.user?.id || '')
      .maybeSingle(),
  ]);

  return {
    status: (data as VerificationStatus) || 'unsubmitted',
    reason: (reason.data as string | null) ?? null,
    submittedAt: profile.data?.verification_submitted_at ?? null,
    reviewedAt: profile.data?.verification_reviewed_at ?? null,
  };
}

export async function fetchMyVerificationRequests(): Promise<VerificationRequest[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('verification_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(friendly(error.message, 'Could not load your verification history.'));
  return (data as VerificationRequest[]) ?? [];
}

export async function submitVerification(input: {
  note?: string;
  file?: File | null;
}): Promise<VerificationRequest> {
  const client = requireSupabase();
  let evidencePath: string | null = null;
  let evidenceName: string | null = null;

  if (input.file) {
    const safeName = input.file.name.replace(/[^A-Za-z0-9._-]/g, '-').slice(-60);
    evidencePath = `${(await client.auth.getUser()).data.user?.id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await client.storage
      .from(EVIDENCE_BUCKET)
      .upload(evidencePath, input.file, { upsert: false });
    if (upErr) {
      throw new Error(
        /row-level security|not exist/i.test(upErr.message)
          ? 'Evidence uploads are unavailable. Submit without a file, or ask the library to enable the upload bucket.'
          : `Evidence upload failed: ${upErr.message}`
      );
    }
    evidenceName = input.file.name;
  }

  const { data, error } = await client.rpc('submit_verification', {
    p_student_note: input.note?.trim() || null,
    p_evidence_path: evidencePath,
    p_evidence_name: evidenceName,
  });
  if (error) {
    // The RPC is the transaction, so a refusal here means no request was
    // created. Remove the uploaded file so a rejected attempt cannot leave an
    // orphaned private document behind.
    if (evidencePath) {
      await client.storage.from(EVIDENCE_BUCKET).remove([evidencePath]).catch(() => {});
    }
    throw new Error(friendly(error.message, 'Could not submit your verification request.'));
  }

  const request = Array.isArray(data) ? data[0] : data;
  return request as VerificationRequest;
}

/** Signed, short-lived link to the student's own evidence file. */
export async function getEvidenceUrl(request: VerificationRequest): Promise<string | null> {
  if (!request.evidence_path) return null;
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(request.evidence_path, 600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ─── Premium entitlement ─────────────────────────────────────────────────────

export async function fetchMyPlan(): Promise<PlanSummary | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('my_plan');
  if (error) throw new Error(error.message);
  const rows = (data as PlanSummary[]) ?? [];
  return rows[0] ?? null;
}

export async function fetchHasPremium(): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('has_premium_access');
  if (error) return false;
  return data === true;
}

export async function fetchCatalogPlans(): Promise<CatalogPlan[]> {
  const client = requireSupabase();
  const [plansResult, configResult] = await Promise.all([
    client
      .from('plans')
      .select('id, slug, name, description, price_kobo, duration_days, is_premium, features')
      .eq('is_active', true)
      .order('price_kobo', { ascending: true }),
    client.rpc('get_payment_configuration')
  ]);
  if (plansResult.error) throw new Error(plansResult.error.message);
  if (configResult.error) throw new Error(configResult.error.message);
  const currency = (configResult.data as { currency?: string } | null)?.currency || 'NGN';
  return ((plansResult.data ?? []) as CatalogPlan[]).map((p) => ({
    ...p,
    currency,
    features: Array.isArray(p.features) ? (p.features as string[]) : [],
  }));
}

// ─── Admin: review queue ─────────────────────────────────────────────────────

export interface VerificationQueueRow extends VerificationRequest {
  full_name: string | null;
  email: string | null;
  username: string | null;
  is_active: boolean;
}

/** Queue of submissions awaiting a decision. Uses the RPC when available and
 *  falls back to a direct read of the ledger joined through profiles. */
export async function fetchVerificationQueue(
  status: RequestStatus | 'all' = 'pending'
): Promise<VerificationQueueRow[]> {
  const client = requireSupabase();
  let query = client
    .from('verification_requests')
    .select(
      // The FK hint names the constraint explicitly: user_id has two foreign
      // keys (auth.users and public.profiles), and pinning the profiles one keeps
      // the embed deterministic on every deployment.
      'id, user_id, status, matric_number, faculty, department, level, student_note, evidence_path, evidence_name, reviewer_note, reviewed_at, created_at, profiles!verification_requests_user_id_fkey_profiles!inner(full_name, email, username, is_active)'
    )
    .order('created_at', { ascending: true })
    .limit(100);
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(friendly(error.message, 'Could not load the verification queue.'));

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const p = (row.profiles ?? {}) as Record<string, unknown>;
    const { profiles: _omit, ...rest } = row;
    return {
      ...(rest as unknown as VerificationRequest),
      full_name: (p.full_name as string) ?? null,
      email: (p.email as string) ?? null,
      username: (p.username as string) ?? null,
      is_active: p.is_active !== false,
    };
  });
}

export async function reviewVerification(
  requestId: string,
  approve: boolean,
  note: string
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_review_verification', {
    p_request_id: requestId,
    p_approve: approve,
    p_reviewer_note: note.trim() || null,
  });
  if (error) throw new Error(friendly(error.message, 'Could not record that decision.'));
}

export interface ManagedSubscription {
  id: string;
  user_id: string;
  status: string;
  starts_at: string;
  expires_at: string;
  plan_name: string;
  is_premium: boolean;
}

export async function grantPlan(userId: string, planSlug: string, days?: number, note?: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_grant_plan', {
    p_user_id: userId,
    p_plan_slug: planSlug,
    p_days: days ?? null,
    p_admin_note: note?.trim() || null,
  });
  if (error) throw new Error(friendly(error.message, 'Could not grant that plan.'));
}

export async function revokePlan(userId: string, note?: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('admin_revoke_plan', {
    p_user_id: userId,
    p_admin_note: note?.trim() || null,
  });
  if (error) throw new Error(friendly(error.message, 'Could not revoke that plan.'));
}

export async function fetchUserEntitlement(userId: string): Promise<ManagedSubscription[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('subscriptions')
    .select('id, user_id, status, starts_at, expires_at, plans(name, is_premium)')
    .eq('user_id', userId)
    .order('expires_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(friendly(error.message, 'Could not load entitlements.'));

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const p = (row.plans ?? {}) as Record<string, unknown>;
    const { plans: _omit, ...rest } = row;
    return {
      ...(rest as unknown as Omit<ManagedSubscription, 'plan_name' | 'is_premium'>),
      plan_name: (p.name as string) ?? 'Plan',
      is_premium: p.is_premium === true,
    };
  });
}