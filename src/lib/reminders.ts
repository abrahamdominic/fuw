// reminders — dismissal state for the profile and verification banners.
//
// The rule is "remind me on the next login", which sessionStorage alone does not
// guarantee: it survives a sign-out and sign-in inside the same tab, so a
// student could dismiss the notice and never see it again until they closed the
// tab. Dismissals are therefore keyed by account and wiped when a session ends.
const PREFIX = 'fuw:reminderHidden:';

function key(scope: string, userId?: string | null): string {
  return `${PREFIX}${scope}:${userId || 'anon'}`;
}

export function reminderDismissed(scope: string, userId?: string | null): boolean {
  try {
    return sessionStorage.getItem(key(scope, userId)) === '1';
  } catch {
    return false;
  }
}

export function dismissReminder(scope: string, userId?: string | null): void {
  try {
    sessionStorage.setItem(key(scope, userId), '1');
  } catch {
    // Storage unavailable — non-critical, the banner just stays visible.
  }
}

export function clearReminderDismissals(): void {
  try {
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable — nothing persisted to clear.
  }
}