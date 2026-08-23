import { supabase } from './supabase';

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  updatedAt: string | null;
}

const DEFAULT_STATUS: MaintenanceStatus = { enabled: false, message: '', updatedAt: null };

/** Read the globally persisted maintenance state (works for anon visitors too). */
export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  if (!supabase) return DEFAULT_STATUS;

  try {
    const { data, error } = await supabase.rpc('get_maintenance_status');
    if (!error && Array.isArray(data) && data.length > 0) {
      const row = data[0];
      return {
        enabled: Boolean(row?.enabled),
        message: String(row?.message ?? ''),
        updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null
      };
    }
  } catch {
    // Fall through to a direct table read (RPC may not be deployed yet).
  }

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', 'maintenance')
      .maybeSingle();
    if (error || !data) return DEFAULT_STATUS;
    const value = (data.value ?? {}) as Record<string, unknown>;
    return {
      enabled: Boolean(value.enabled),
      message: String(value.message ?? ''),
      updatedAt: data.updated_at ? new Date(data.updated_at).toISOString() : null
    };
  } catch {
    return DEFAULT_STATUS;
  }
}

/** Enable/disable maintenance mode. Only callable by super admins (enforced by RPC + RLS). */
export async function setMaintenanceMode(enabled: boolean, message?: string): Promise<void> {
  const client = supabase;
  if (!client) throw new Error('Database connection is not configured.');

  try {
    const { error } = await client.rpc('set_maintenance_mode', {
      p_enabled: enabled,
      p_message: message ?? null
    });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    if (/function .* does not exist|Could not find the function/i.test(err?.message ?? '')) {
      throw new Error(
        'Maintenance functions are not deployed yet. Run supabase/migrations/20260824_system_settings_maintenance.sql.'
      );
    }
    throw err;
  }
}
