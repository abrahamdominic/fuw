// Shared sanitizer for user-facing errors. Network/transport noise and generic
// server noise is swapped for a friendly fallback; meaningful application
// messages (which are already human-readable) pass through untouched.
const TECHNICAL_PATTERNS: RegExp[] = [
  /failed to fetch/i,
  /networkerror/i,
  /load failed/i,
  /request failed/i,
  /timeout/i,
  /aborted/i,
  /unexpected end of json/i,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /pgrest/i,
  /supabase.*error/i,
  /invalid input syntax/i
];

export function friendlyError(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string'
        ? (err as any).message
        : typeof err === 'string'
          ? err
          : '';
  if (!raw) return fallback;
  if (TECHNICAL_PATTERNS.some((re) => re.test(raw))) return fallback;
  return raw;
}