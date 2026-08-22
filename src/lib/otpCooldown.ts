// Client-side OTP resend cooldown.
// Persists the request timestamp in localStorage (keyed per email) so a page
// refresh cannot be used to bypass the 60-second wait between OTP requests.

const KEY_PREFIX = 'fuw_otp_cooldown_';
export const OTP_COOLDOWN_SECONDS = 60;

function storageKey(email: string): string {
  return `${KEY_PREFIX}${email.trim().toLowerCase()}`;
}

/** Seconds remaining before another OTP can be requested (0 when allowed). */
export function getRemainingCooldown(email: string): number {
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return 0;
    const sentAt = Number(raw);
    if (!Number.isFinite(sentAt)) return 0;
    const elapsed = (Date.now() - sentAt) / 1000;
    const remaining = Math.ceil(OTP_COOLDOWN_SECONDS - elapsed);
    if (remaining <= 0) {
      localStorage.removeItem(storageKey(email));
      return 0;
    }
    return remaining;
  } catch {
    return 0;
  }
}

/** Record that an OTP was just requested for this email. */
export function startCooldown(email: string): void {
  try {
    localStorage.setItem(storageKey(email), String(Date.now()));
  } catch {
    // Storage unavailable — cooldown simply will not persist.
  }
}

export function clearCooldown(email: string): void {
  try {
    localStorage.removeItem(storageKey(email));
  } catch {
    // ignore
  }
}
