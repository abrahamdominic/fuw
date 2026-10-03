// premium.ts — the client-side half of the premium gate.
//
// The authoritative check is the server function `has_premium_access()`
// (verified academic identity AND an active entitlement). This module only
// asks the server and caches the answer briefly, so the UI never has to
// re-derive the rule and never disagrees with storage RLS.
import { fetchHasPremium } from './verification';
import { requireSupabase } from './supabase';

export type BlockReason =
  | 'unverified'
  | 'unsubmitted'
  | 'pending'
  | 'rejected'
  | 'no-plan'
  | 'signed-out'
  | 'feature-disabled';

export interface AccessDecision {
  allowed: boolean;
  reason: BlockReason | null;
  message: string;
}

const CACHE_MS = 30_000;
let cached: { at: number; allowed: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

export function invalidatePremiumCache(): void {
  cached = null;
  inflight = null;
}

async function allowedNow(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.allowed;
  inflight ??= fetchHasPremium()
    .then((ok) => {
      cached = { at: Date.now(), allowed: ok };
      return ok;
    })
    .catch(() => false)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const MESSAGES: Record<BlockReason, string> = {
  'signed-out': 'Sign in to read this material.',
  unsubmitted: 'Verify your student identity to unlock downloads.',
  pending: 'Your verification is still being reviewed by the library.',
  rejected: 'Your verification was not approved. Submit it again to continue.',
  unverified: 'Only verified students can download this material.',
  'no-plan': 'Downloading needs an active premium plan. Ask the library to activate one.',
  'feature-disabled': 'This Premium feature is temporarily unavailable.'
};

/**
 * Resolve whether the current user may fetch a document, and why not when they
 * may not.
 *
 * `verificationStatus` is the profile's server-owned verification state so the
 * message can name the exact next step instead of a generic refusal.
 *
 * Staff are handled here rather than at each call site: storage RLS lets
 * `is_admin()` read document bytes regardless of entitlement, so a paywall shown
 * to an admin would contradict the server. Keeping the exception in one place
 * also stops it drifting between screens.
 */
export async function checkDocumentAccess(input: {
  authenticated: boolean;
  verificationStatus?: string;
  isAdmin?: boolean;
}): Promise<AccessDecision> {
  if (input.isAdmin) {
    return { allowed: true, reason: null, message: '' };
  }

  if (!input.authenticated) {
    return { allowed: false, reason: 'signed-out', message: MESSAGES['signed-out'] };
  }

  if (await allowedNow()) {
    const { data, error } = await requireSupabase().rpc('has_premium_feature', {
      p_feature_key: 'premium_academic_tools'
    });
    if (error || data !== true) {
      return { allowed: false, reason: 'feature-disabled', message: MESSAGES['feature-disabled'] };
    }
    return { allowed: true, reason: null, message: '' };
  }

  const key: BlockReason =
    input.verificationStatus === 'pending'
      ? 'pending'
      : input.verificationStatus === 'rejected'
        ? 'rejected'
        : input.verificationStatus === 'verified'
          ? 'no-plan'
          : input.verificationStatus === 'unsubmitted'
            ? 'unsubmitted'
            : 'unverified';

  return { allowed: false, reason: key, message: MESSAGES[key] };
}
