// FUW E-Library — server-side username resolution for login & password reset.
// POST { op: 'login', username, password }        -> { session } | generic 401
// POST { op: 'reset_username', username, redirectTo } -> { neutral: true } always
//
// WHY THIS EXISTS (AUTH-01 remediation):
//   The previous flow called the anon-granted `lookup_login_email` RPC before
//   authentication, which let any unauthenticated caller enumerate usernames
//   and their bound email addresses. This function resolves username->email
//   with the service client (server-side only) and:
//     * login  — returns a session ONLY when the password is correct; any
//                failure (unknown username, inactive user, wrong password)
//                returns the identical generic 401, so the endpoint cannot be
//                used as an existence oracle.
//     * reset  — always returns a neutral success, mirroring the behaviour of
//                supabase.auth.resetPasswordForEmail for unknown addresses.
//   The email address itself is never returned to the caller.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/ai.ts';

const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server misconfigured' }, 500);

  // Require the anon key as the caller credential (matching how the browser
  // invokes every other Supabase API) — the edge function itself never runs
  // unauthenticated at the platform level, but we still require a key.
  const presentedKey = req.headers.get('Authorization') ?? '';
  if (!presentedKey) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const op = String(body?.op ?? '');
  const username = String(body?.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    if (op === 'login') return json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }, 401);
    return json({ neutral: true });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('email, is_active')
    .eq('username', username)
    .maybeSingle();

  const email = profile && profile.is_active && typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (!email) {
    if (op === 'reset_username') return json({ neutral: true });
    return json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }, 401);
  }

  if (op === 'reset_username') {
    const redirectTo =
      typeof body?.redirectTo === 'string' && body.redirectTo.startsWith('http')
        ? body.redirectTo
        : `${req.headers.get('origin') ?? 'http://localhost:5173'}/reset-password`;
    const resetClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await resetClient.auth.resetPasswordForEmail(email, { redirectTo }).catch(() => undefined);
    return json({ neutral: true });
  }

  // op === 'login'
  const password = String(body?.password ?? '');
  if (!password || password.length < 8) {
    return json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await userClient.auth.signInWithPassword({ email, password });

  // Distinguish only the error classes that do NOT double as existence
  // oracles: "email not confirmed" and "rate limited" are returned for the
  // credential's OWN account, so mapping them separately leaks nothing.
  // Everything else (unknown username, wrong password, disabled user) maps to
  // the same generic invalid-credentials response.
  const msg = (error?.message ?? '').toLowerCase();
  if (error) {
    if (msg.includes('not confirmed')) {
      return json({ error: 'EMAIL_NOT_CONFIRMED', message: 'Your email address has not been confirmed yet.' }, 401);
    }
    if (msg.includes('rate')) {
      return json({ error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a few moments and try again.' }, 429);
    }
    return json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }, 401);
  }
  if (!data.session) {
    return json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }, 401);
  }
  // Return the session object (never the email). The browser adopts the
  // session via supabase.auth.setSession().
  return json({ session: data.session, uid: data.user?.id ?? null });
});