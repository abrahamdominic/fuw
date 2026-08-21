import { createClient } from '@supabase/supabase-js';

// Credentials are supplied exclusively through Vite environment variables
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Never hardcode keys here.
const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const requireSupabase = () => {
  if (!supabase) throw new Error('Authentication is not configured yet.');
  return supabase;
};
