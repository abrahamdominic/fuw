// =============================================================================
// First-Visit Welcome Persistence for FUW Campus Hub
// =============================================================================
// Ensures the welcome presentation is displayed on a student's first visit,
// while never unnecessarily replaying for returning visitors.
// Gracefully handles private browsing mode or restricted localStorage.

const WELCOME_STORAGE_KEY = 'fuw_first_visit_welcomed_v1';

let memoryWelcomed = false;

/** Check whether the user has already seen the first-visit welcome animation. */
export function hasSeenWelcome(): boolean {
  if (memoryWelcomed) return true;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(WELCOME_STORAGE_KEY);
      return val === 'true';
    }
  } catch {
    // In restricted storage environments, fallback to memory
  }
  return false;
}

/** Record that the user has completed or dismissed the welcome animation. */
export function markWelcomeSeen(): void {
  memoryWelcomed = true;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
    }
  } catch {
    // Storage write failed
  }
}

/** Reset the welcome flag (useful for testing or manual user reset). */
export function resetWelcomeSeen(): void {
  memoryWelcomed = false;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(WELCOME_STORAGE_KEY);
    }
  } catch {
    // Storage access failed
  }
}
