import { createClient } from '@supabase/supabase-js';

const url = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://lgxtiilvpnqgzuarzogb.supabase.co';
const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_h3EJz1E3rZDeZuDHDr1O3w_u9nJfYIe';

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const requireSupabase = () => {
  if (!supabase) throw new Error('Authentication is not configured yet.');
  return supabase;
};
