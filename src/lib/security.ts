// security.ts — Authenticator App (TOTP) and Passkey (WebAuthn) data-access layer.
//
// Exports thin, purpose-built helpers around Supabase's `auth.mfa.*` and
// `auth.passkey.*` APIs. Components call these helpers rather than talking to
// the Supabase client directly, so error handling, retry logic and cache
// invalidation live in a single place.
//
// Prerequisites:
//   * GoTrue MFA enabled in the Supabase dashboard (Auth → MFA → Enable).
//   * Passkey experimental feature enabled in the Supabase dashboard
//     (Auth → Settings → Experimental Features → Passkeys) AND in the client
//     createClient options (`experimental.passkey = true` — see supabase.ts).
import { requireSupabase } from './supabase';
import { toUserFacingAuthError } from './authErrors';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TOTPFactor {
  id: string;
  factor_type: 'totp';
  friendly_name?: string | null;
  status: 'verified' | 'unverified';
  created_at: string;
  updated_at: string;
  last_challenged_at?: string;
}

export interface AALState {
  current: 'aal1' | 'aal2';
  next: 'aal1' | 'aal2';
  /** Factors that have been verified at the current AAL level. */
  verified: TOTPFactor[];
  /** All enrolled factors (may exceed the verified list). */
  all: TOTPFactor[];
}

// ─── MFA (Authenticator App — TOTP) ────────────────────────────────────────

/** Current AAL level after a login. */
export async function getAAL(): Promise<AALState> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');

  const { currentLevel, nextLevel } = data;

  // List all enrolled factors.
  const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) throw toUserFacingAuthError(listErr, 'Could not load your security settings.');

  const totpFactors: TOTPFactor[] = (factors?.totp ?? []) as TOTPFactor[];
  const verified = totpFactors.filter((f) => f.status === 'verified');

  return {
    current: currentLevel as 'aal1' | 'aal2',
    next: nextLevel as 'aal1' | 'aal2',
    verified,
    all: totpFactors
  };
}

/**
 * Begin a new TOTP enrollment — returns a factor id, base-32 secret and a
 * URI suitable for rendering as a QR code (to scan with an Authenticator App).
 */
export async function enrollTOTP(friendlyName = 'FUW E-Library'): Promise<{
  factor_id: string;
  secret: string;
  /** Full `otpauth://` URI for the QR code. */
  uri: string;
}> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName
  });
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');

  return {
    factor_id: data.id,
    secret: data.totp.secret,
    uri: data.totp.uri
  };
}

/**
 * Challenge a factor and return the challenge id — the caller then prompts
 * the user for a 6-digit TOTP code and calls `verifyTOTP`.
 */
export async function challengeTOTP(
  factorId: string
): Promise<{ challenge_id: string }> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
  return { challenge_id: data.id };
}

/**
 * Verify a 6-digit TOTP code against a factor + challenge pair.
 * On success the factor transitions from `unverified` to `verified`.
 */
export async function verifyTOTP(opts: {
  factor_id: string;
  challenge_id: string;
  code: string;
}): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.mfa.verify({
    factorId: opts.factor_id,
    challengeId: opts.challenge_id,
    code: opts.code
  });
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
}

/** Full enrollment flow: enroll → prompt → verify → done. */
export async function completeEnrollment(
  code: string,
  factorId: string,
  challengeId: string
): Promise<void> {
  await verifyTOTP({ factor_id: factorId, challenge_id: challengeId, code });
}

/** Remove an enrolled factor (deletes it server-side). */
export async function unenrollFactor(factorId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
}

/**
 * Perform an AAL2 challenge during login: the Supabase session is at AAL1;
 * challenge the given verified factor, prompt user for TOTP code, verify.
 * On success the session moves to AAL2 and `getAAL()` will reflect that.
 */
export async function aal2LoginChallenge(
  factorId: string,
  code: string
): Promise<void> {
  const { challenge_id } = await challengeTOTP(factorId);
  await verifyTOTP({ factor_id: factorId, challenge_id, code });
}

// ─── Passkeys (WebAuthn) ───────────────────────────────────────────────────

export interface PasskeyRegistration {
  id: string;
  friendly_name?: string;
  created_at?: string;
  last_used_at?: string;
}

/** True when the current platform and browser support WebAuthn passkeys. */
export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.isSecureContext &&
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential === 'function'
  );
}

/** Check if device biometric authenticator (fingerprint, Face ID, Windows Hello) is available. */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Register a passkey for the current user — the full WebAuthn ceremony
 * (challenge → browser `navigator.credentials.create()` prompt → server verify).
 */
export async function registerPasskey(friendlyName?: string): Promise<{ id: string }> {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys are not supported on this browser or connection.');
  }
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.registerPasskey();
  if (error) throw toUserFacingAuthError(error, 'Could not register a passkey on this device.');
  const id = data?.id ?? '';
  if (friendlyName && id) {
    try {
      await renamePasskey({ passkeyId: id, friendlyName });
    } catch {
      // Friendly name update is non-critical.
    }
  }
  return { id };
}

/** List all passkeys registered for the current user. */
export async function listPasskeys(): Promise<PasskeyRegistration[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
  return (data as PasskeyRegistration[]) ?? [];
}

/** Delete a passkey by its id (uuid as returned by list()). */
export async function deletePasskey(passkeyId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.passkey.delete({ passkeyId });
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
}

/**
 * Sign in with a passkey (passwordless) — full WebAuthn ceremony:
 * challenge → browser `navigator.credentials.get()` prompt → server verify.
 * Returns the new session for the verified user.
 */
export async function signInWithPasskey(): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.signInWithPasskey();
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
}

/** Rename a passkey's friendly name after registration. */
export async function renamePasskey(opts: {
  passkeyId: string;
  friendlyName: string;
}): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.passkey.update({
    passkeyId: opts.passkeyId,
    friendlyName: opts.friendlyName
  });
  if (error) throw toUserFacingAuthError(error, 'Something went wrong. Please try again.');
}
