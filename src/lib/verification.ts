// Academic identity verification + premium entitlement.
//
// Server owns every state transition here: the client only ever calls the
// guarded RPCs in supabase/migrations/20260924_academic_verification_and_plans.sql.
// Nothing in this file can grant verification or a plan on its own.
import { requireSupabase } from './supabase';

export const EVIDENCE_BUCKET = 'verification-evidence';
export const VERIFY_FUNCTION = 'verify-document';

export type VerificationStatus =
  | 'unsubmitted'
  | 'processing'
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'action_required'
  | 'verification_unavailable';
export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'processing'
  | 'action_required'
  | 'verification_unavailable';

/** The student chooses exactly one document to verify with. */
export type DocumentType = 'student_id' | 'admission_letter';

export interface VerificationCheck {
  id: string;
  outcome: 'pass' | 'fail' | 'soft_fail' | 'info';
  detail?: string;
}

export interface VerificationRequest {
  id: string;
  user_id: string;
  status: RequestStatus;
  matric_number: string;
  faculty: string;
  department: string;
  level: string | null;
  student_note: string | null;
  /** Document the student chose to verify with (new pipeline). */
  document_type: DocumentType | null;
  /** Machine-readable reason for the latest automated decision. */
  decision_code: string | null;
  /** Auditable check outcomes — no document text. */
  checks: VerificationCheck[] | null;
  /** Private storage object name for the student ID card. */
  student_id_path: string | null;
  student_id_name: string | null;
  /** Private storage object name for the admission letter. */
  admission_letter_path: string | null;
  admission_letter_name: string | null;
  /** Legacy single-document slot, kept for requests made before registration capture. */
  evidence_path: string | null;
  evidence_name: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/** Result of uploading one private verification document. */
export interface VerificationDocument {
  path: string;
  name: string;
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
  expires_at: string | null;
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
  if (m.includes('choose either your student id'))
    return 'Choose either your student ID card or your admission letter.';
  if (m.includes('upload your document')) return 'Upload your document before submitting.';
  if (m.includes('could not find your uploaded document'))
    return 'We could not find your uploaded document. Please re-upload and try again.';
  if (m.includes('files in your own upload folder'))
    return 'That document could not be attached to your account. Please re-upload it.';
  if (m.includes('attempt limit'))
    return 'You have reached today’s verification attempt limit. Please try again tomorrow.';
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

/** Upload one identity document into the caller's private storage folder. */
export async function uploadVerificationDocument(file: File): Promise<VerificationDocument> {
  const client = requireSupabase();
  const uid = (await client.auth.getUser()).data.user?.id;
  if (!uid) throw new Error('You must be signed in to upload documents.');

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '-').slice(-60);
  const path = `${uid}/${Date.now()}-${safeName}`;
  const { error } = await client.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { upsert: false });
  if (error) {
    throw new Error(
      /row-level security|not exist/i.test(error.message)
        ? 'Document uploads are unavailable right now. Please try again in a moment.'
        : `Document upload failed: ${error.message}`
    );
  }
  return { path, name: file.name };
}

/**
 * Submit a student's identity document for automated verification.
 *
 * The student picks ONE document (student ID card or admission letter). The
 * file is uploaded to the private bucket, the `submit_verification` RPC parks
 * the request in `processing`, and the `verify-document` edge function runs the
 * authenticity checks. The RPC alone can never grant verification.
 */
export async function submitVerification(input: {
  documentType: DocumentType;
  file: File;
  note?: string;
}): Promise<VerificationRequest> {
  const client = requireSupabase();
  let uploaded: VerificationDocument | null = null;

  try {
    uploaded = await uploadVerificationDocument(input.file);

    const { data, error } = await client.rpc('submit_verification', {
      p_document_type: input.documentType,
      p_document_path: uploaded.path,
      p_document_name: uploaded.name,
      p_student_note: input.note?.trim() || null,
    });
    if (error) {
      throw new Error(friendly(error.message, 'Could not submit your verification request.'));
    }

    const request = (Array.isArray(data) ? data[0] : data) as VerificationRequest;
    // Kick off the automated pipeline. A failure here does not lose the
    // submission: it stays in `processing`, and the student can retry from the
    // portal (or it is re-triggered on status refresh).
    void runDocumentVerification(request?.id).catch(() => {});
    return request;
  } catch (err) {
    // The RPC is the transaction; a refusal means no request was created, so
    // remove the upload rather than leave an orphaned private document behind.
    if (uploaded?.path) {
      await client.storage.from(EVIDENCE_BUCKET).remove([uploaded.path]).catch(() => {});
    }
    throw err;
  }
}

/**
 * Trigger the server-side verification pipeline for a request. Safe to call
 * repeatedly — the backend is idempotent and never re-decides a decided
 * request. Returns the pipeline's safe summary (no document text).
 */
export async function runDocumentVerification(
  requestId: string | null | undefined
): Promise<{ decision?: string; decisionCode?: string; status?: string }> {
  if (!requestId) return {};
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(VERIFY_FUNCTION, {
    body: { request_id: requestId },
  });
  if (error) {
    // A transient failure (or an unconfigured OCR provider) leaves the request
    // in `processing`; surface it so the UI can offer a retry.
    throw new Error('Verification is temporarily unavailable. Please retry in a moment.');
  }
  const result = (data ?? {}) as Record<string, unknown>;
  return {
    decision: result.decision as string | undefined,
    decisionCode: (result.decision_code as string | undefined) ?? undefined,
    status: result.status as string | undefined,
  };
}

/** Signed, short-lived link to a private verification document. */
export async function getDocumentUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Backwards-compatible helper for the legacy single-evidence slot. */
export async function getEvidenceUrl(request: VerificationRequest): Promise<string | null> {
  return getDocumentUrl(request.evidence_path);
}

// ─── Premium entitlement ─────────────────────────────────────────────────────

export async function fetchMyPlan(): Promise<PlanSummary | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('my_plan');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    plan_slug: string;
    plan_name: string;
    status: string;
    expires_at: string | null;
    is_premium: boolean;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    slug: row.plan_slug,
    name: row.plan_name,
    status: row.status,
    expires_at: row.expires_at,
    is_premium: row.is_premium
  };
}

export async function fetchHasPremium(): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('has_premium_access');
  if (error) return false;
  return data === true;
}

export async function fetchMyPremiumSource(): Promise<'PAYMENT' | 'ADMIN_GRANT' | 'GLOBAL_PREMIUM' | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('my_premium_source');
  if (error) throw new Error(error.message);
  if (data === 'PAYMENT' || data === 'ADMIN_GRANT' || data === 'GLOBAL_PREMIUM') return data;
  return null;
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
      'id, user_id, status, matric_number, faculty, department, level, student_note, document_type, decision_code, checks, student_id_path, student_id_name, admission_letter_path, admission_letter_name, evidence_path, evidence_name, reviewer_note, reviewed_at, created_at, profiles!verification_requests_user_id_fkey_profiles!inner(full_name, email, username, is_active)'
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