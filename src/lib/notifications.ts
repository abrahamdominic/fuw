// In-app notifications backed by the Supabase `notifications` table.
// Rows are created server-side by SQL triggers/RPCs (approval, rejection,
// deletion of materials) and read here through RLS-protected queries.
import { supabase } from './supabase';

export type NotificationType =
  | 'material_approved'
  | 'material_rejected'
  | 'material_deleted'
  | 'new_material'
  | 'new_submission'
  | 'admin_promoted'
  | 'admin_verified'
  | 'system'
  | 'welcome'
  | 'announcement'
  | 'maintenance'
  | 'important'
  | 'system_update'
  // Verification workflow and premium entitlement lifecycle.
  | 'verification_submitted'
  | 'verification_approved'
  | 'verification_rejected'
  | 'plan_activated'
  | 'plan_expired';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  link?: string;
  relatedMaterialId?: string;
  relatedCourseCode?: string;
  senderName?: string;
  createdAt: string;
}

// The database stores mobile-native deep links (e.g. /library/material/<id>).
// The web app uses /materials/<id>, so translate on read.
export function normalizeNotificationLink(link?: string | null): string | undefined {
  if (!link) return undefined;
  const materialMatch = link.match(/^\/library\/material\/([^/?#]+)/);
  if (materialMatch) return `/materials/${materialMatch[1]}`;
  return link;
}

function mapRow(row: any): NotificationItem {
  return {
    id: row.id,
    title: row.title,
    body: row.message || '',
    type: (row.type as NotificationType) || 'system',
    read: Boolean(row.is_read),
    link: normalizeNotificationLink(row.link),
    relatedMaterialId: row.related_material_id || undefined,
    relatedCourseCode: row.related_course_code || undefined,
    senderName: row.sender_name || undefined,
    createdAt: row.created_at
  };
}

export async function fetchNotifications(limit = 30): Promise<NotificationItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map(mapRow);
}

export async function fetchUnreadCount(): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);
  return error ? 0 : count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').update({ is_read: true }).eq('id', id);
}

export async function markAllNotificationsRead(): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
}

export async function deleteNotification(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('notifications').delete().eq('id', id);
}

/** Subscribe to live notification inserts for the signed-in user. */
export function subscribeToNotifications(
  userId: string,
  onInsert: (item: NotificationItem) => void
): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        if (payload.new) onInsert(mapRow(payload.new as any));
      }
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
