/**
 * Sanitize low-level auth / passkey / TOTP errors into safe, user-facing
 * messages. Raw error text (server URLs, SDK internals, exception frames)
 * is never shown to end users here — it is only logged for debugging.
 */

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const msg = (obj.message as string) || (obj.error_description as string) || '';
    return typeof msg === 'string' ? msg : String(err);
  }
  return '';
}

const isPasskeyContext = (lower: string) =>
  lower.includes('webauthn') ||
  lower.includes('passkey') ||
  lower.includes('authenticator') ||
  lower.includes('publickey') ||
  lower.includes('credential');

export function toUserFacingAuthError(err: unknown, fallback: string): Error {
  const msg = extractMessage(err);
  const lower = msg.toLowerCase();
  console.error('[auth] raw error:', err);

  if (!msg) return new Error(fallback);

  // ── Connection / transport level ────────────────────────────────────────
  if (lower.includes('network') || lower.includes('unknownhost') || lower.includes('resolve host') || lower.includes('failed to fetch')) {
    return new Error('Network connection error. Please check your internet connection and try again.');
  }

  // ── Passkey-specific flows ──────────────────────────────────────────────
  if (
    lower.includes('notallowederror') ||
    lower.includes('aborterror') ||
    lower.includes('cancel') ||
    lower.includes('user cancelled') ||
    lower.includes('user canceled')
  ) {
    return new Error('Passkey setup was cancelled or dismissed. You can try again now or set it up later.');
  }
  if (
    isPasskeyContext(lower) &&
    (lower.includes('already exists') || lower.includes('already registered') ||
     lower.includes('duplicate') || lower.includes('not registered'))
  ) {
    return new Error('This passkey has already been registered on this device for your account.');
  }
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('operation timed out')
  ) {
    return new Error('Passkey request timed out. Please try again when prompted.');
  }
  if (
    lower.includes('safari does not support' as never as string) ||
    lower.includes('unsupported') ||
    lower.includes('does not support webauthn') ||
    lower.includes('not supported on this browser')
  ) {
    return new Error('Passkeys are not supported on this browser or device. You can sign in using your password.');
  }
  if (lower.includes('no passkey') || lower.includes('passkey not found') || lower.includes('none found')) {
    return new Error('No passkey was found for this account on this device.');
  }

  // ── Domain & profile identity rules (custom triggers & checks) ───────────
  if (
    lower.includes('matriculation number is locked') ||
    lower.includes('profile is complete') ||
    lower.includes('allowed changes') ||
    lower.includes('change counters') ||
    lower.includes('profile change request') ||
    lower.includes('verification state') ||
    lower.includes('already in use by another')
  ) {
    return new Error(msg);
  }

  if (lower.includes('profiles_matric_number_key') || (lower.includes('unique constraint') && lower.includes('matric'))) {
    return new Error('This matriculation number is already in use by another student.');
  }

  // ── Account-level flows ─────────────────────────────────────────────────
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return new Error('An account with this email already exists. Please log in instead.');
  }
  if (
    lower.includes('database error') ||
    lower.includes('new row violates') ||
    lower.includes('unique constraint') ||
    lower.includes('duplicate key') ||
    lower.includes('could not extract result')
  ) {
    return new Error('Your registration could not be completed. The username or email may already be in use.');
  }
  if (lower.includes('weak password') || lower.includes('stronger password')) {
    return new Error(
      'Your password does not meet the requirements. It must be at least 8 characters long and include a lowercase letter, an uppercase letter, a number, and a special character.'
    );
  }
  if (lower.includes('at least') || lower.includes('must contain')) {
    return new Error('Your password does not meet the required strength rules. Please choose a stronger password.');
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return new Error('Invalid email or password. Please verify your credentials and try again.');
  }
  if (lower.includes('password')) {
    return new Error('Invalid email or password. Please verify your credentials and try again.');
  }
  if (lower.includes('not confirmed') || lower.includes('email_not_confirmed')) {
    return new Error('Your email address has not been confirmed yet. Please check your inbox for the confirmation link.');
  }
  if (lower.includes('rate') || lower.includes('too many')) {
    return new Error('Too many attempts. Please wait a few minutes and try again.');
  }
  if (lower.includes('unauthorized') || lower.includes('forbidden')) {
    return new Error('You are not authorized to perform this action.');
  }
  if (lower.includes('webauthn') || lower.includes('publickey') || lower.includes('authenticator')) {
    return new Error('Your device authenticator could not complete the passkey request. Please try again or use your password.');
  }
  if (lower.includes('enabled') || lower.includes('experimental')) {
    return new Error('Passkeys are not enabled on this server yet. Contact the library administrator to turn them on.');
  }

  return new Error(fallback);
}

export function passkeyErrorMessage(err: unknown): string {
  return toUserFacingAuthError(
    err,
    'The secure login could not be completed. Please try again or use your password instead.'
  ).message;
}