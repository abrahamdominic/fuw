import { supabase, requireSupabase } from './supabase';

export type ActivityType =
  | 'material_viewed'
  | 'material_downloaded'
  | 'material_completed'
  | 'marketplace_viewed'
  | 'marketplace_ordered'
  | 'accommodation_viewed'
  | 'accommodation_inquired'
  | 'study_task_completed'
  | 'flashcard_reviewed'
  | 'study_guide_created'
  | 'ai_tutor_session'
  | 'item_saved';

export interface UserActivityItem {
  id: string;
  userId: string;
  activityType: ActivityType;
  entityType: string;
  entityId?: string | null;
  entityTitle: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface LogActivityInput {
  activityType: ActivityType;
  entityType: string;
  entityId?: string | null;
  entityTitle: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a user activity asynchronously. Non-blocking; errors are safely logged without failing UI flows.
 */
export async function logUserActivity(input: LogActivityInput): Promise<void> {
  if (!supabase) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Only log for authenticated users

    await supabase.from('user_activity_log').insert({
      user_id: user.id,
      activity_type: input.activityType,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_title: input.entityTitle,
      metadata: input.metadata ?? {}
    });
  } catch (err) {
    console.warn('Could not record activity:', err);
  }
}

/**
 * Fetch paginated activity log for the current user.
 */
export async function fetchUserActivity(params?: {
  activityType?: ActivityType;
  limit?: number;
  offset?: number;
}): Promise<UserActivityItem[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const limit = Math.min(Math.max(params?.limit || 20, 1), 100);
  const offset = Math.max(params?.offset || 0, 0);

  let query = supabase
    .from('user_activity_log')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (params?.activityType) {
    query = query.eq('activity_type', params.activityType);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch user activity:', error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    activityType: row.activity_type as ActivityType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityTitle: row.entity_title,
    metadata: row.metadata,
    createdAt: row.created_at
  }));
}

/**
 * Delete a single activity entry owned by the user.
 */
export async function deleteUserActivityItem(id: string): Promise<boolean> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return false;

  const { error } = await client
    .from('user_activity_log')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  return !error;
}
