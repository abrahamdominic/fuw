/**
 * The Marketplace runs inside the FUW SPA and shares one Supabase client with
 * the E Library and Accommodation.
 *
 * There is exactly ONE `createClient` call for the whole platform
 * (`src/lib/supabase.ts`). A second client would start a second auth listener
 * competing for the same `fuw-auth-token` storage key, and the two contexts
 * would race to refresh the session — one of them would win with a stale token
 * and sign the user out mid-navigation.
 *
 * This module therefore re-exports the shared client instead of creating one.
 */
import { requireSupabase } from '../../lib/supabase';

/**
 * Raw credentials, read for the one thing they are still needed for: calling
 * the Marketplace edge functions directly with an `apikey` header.
 */
export const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string;
export const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string;

/**
 * The shared, non-null Supabase client.
 *
 * The E Library treats a missing client as a "not configured yet" state that it
 * renders as an error screen. The Marketplace has no such screen — it is only
 * ever mounted underneath the shared providers, which cannot function without
 * Supabase — so the contract here is a hard failure with an actionable message
 * instead of a `null` that every one of the ~90 call sites would have to guard.
 */
export const supabase = requireSupabase();
