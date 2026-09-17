// Help center & library services: help topics, FAQs, and announcements.
import { requireSupabase } from './supabase';
import { normalizeMessageBody } from './messageFormat';

export interface HelpTopic {
  id: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  sort_order: number;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  sort_order: number;
}

export type AnnouncementType = 'general' | 'maintenance' | 'important' | 'system_update';

export interface LibraryAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  published_at: string;
  is_published?: boolean;
  published_by?: string | null;
  announcement_type?: AnnouncementType | string;
  sender_name?: string | null;
}

export interface HelpCatalog {
  topics: HelpTopic[];
  faqs: FaqItem[];
  announcements: LibraryAnnouncement[];
}

/** Fetch help topics, FAQs and announcements in one call. */
export async function fetchHelpCatalog(): Promise<HelpCatalog> {
  const client = requireSupabase();
  try {
    const { data, error } = await client.rpc('get_help_catalog');
    if (!error && data) {
      return {
        topics: data.topics || [],
        faqs: data.faqs || [],
        announcements: data.announcements || []
      };
    }
  } catch {
    // Fall through to direct reads below.
  }

  const [topicsRes, faqsRes, annsRes] = await Promise.all([
    client.from('help_topics').select('*').eq('is_published', true).order('sort_order'),
    client.from('faq_items').select('*').eq('is_published', true).order('sort_order'),
    client.from('library_announcements').select('*').eq('is_published', true).order('published_at', { ascending: false }).limit(10)
  ]);

  return {
    topics: (topicsRes.data || []) as HelpTopic[],
    faqs: (faqsRes.data || []) as FaqItem[],
    announcements: (annsRes.data || []) as LibraryAnnouncement[]
  };
}

/** Admin: fetch all help topics including unpublished. */
export async function fetchAllHelpTopics(): Promise<HelpTopic[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('help_topics')
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return (data || []) as HelpTopic[];
}

/** Admin: upsert a help topic. */
export async function saveHelpTopic(topic: {
  id?: string | null;
  slug: string;
  title: string;
  category: string;
  body: string;
  sortOrder?: number;
}): Promise<void> {
  const client = requireSupabase();
  const payload = {
    slug: topic.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    title: topic.title.trim(),
    category: topic.category.trim(),
    body: topic.body,
    sort_order: topic.sortOrder || 0
  };
  if (topic.id) {
    const { error } = await client
      .from('help_topics')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', topic.id);
    if (error) throw error;
  } else {
    const { error } = await client.from('help_topics').insert(payload);
    if (error) throw error;
  }
}

/** Admin: delete a help topic. */
export async function deleteHelpTopic(topicId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('help_topics').delete().eq('id', topicId);
  if (error) throw error;
}

/** Admin: fetch all FAQ items. */
export async function fetchAllFaqItems(): Promise<FaqItem[]> {
  const client = requireSupabase();
  const { data, error } = await client.from('faq_items').select('*').order('sort_order');
  if (error) throw error;
  return (data || []) as FaqItem[];
}

/** Admin: upsert an FAQ item. */
export async function saveFaqItem(item: {
  id?: string | null;
  question: string;
  answer: string;
  category?: string;
  sortOrder?: number;
}): Promise<void> {
  const client = requireSupabase();
  const payload = {
    question: item.question.trim(),
    answer: item.answer.trim(),
    category: (item.category || 'general').trim(),
    sort_order: item.sortOrder || 0
  };
  if (item.id) {
    const { error } = await client
      .from('faq_items')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) throw error;
  } else {
    const { error } = await client.from('faq_items').insert(payload);
    if (error) throw error;
  }
}

/** Admin: delete an FAQ item. */
export async function deleteFaqItem(itemId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('faq_items').delete().eq('id', itemId);
  if (error) throw error;
}

/** Admin: fetch all announcements including unpublished. */
export async function fetchAllAnnouncements(): Promise<LibraryAnnouncement[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('library_announcements')
    .select('*')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data || []) as LibraryAnnouncement[];
}

/** Admin: create or update an announcement. */
export async function saveAnnouncement(input: {
  id?: string | null;
  title: string;
  body: string;
  audience?: string;
  isPublished?: boolean;
  publishedBy?: string | null;
  announcementType?: AnnouncementType;
}): Promise<void> {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {
    title: input.title.trim(),
    body: normalizeMessageBody(input.body),
    audience: (input.audience || 'everyone').trim(),
    is_published: input.isPublished ?? true,
    announcement_type: input.announcementType || 'general',
    published_at: new Date().toISOString()
  };
  if (input.publishedBy !== undefined) payload.published_by = input.publishedBy;
  if (input.id) {
    const { error } = await client
      .from('library_announcements')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    if (error) throw error;
  } else {
    const { error } = await client.from('library_announcements').insert(payload);
    if (error) throw error;
  }
}

/** Admin: delete an announcement. */
export async function deleteAnnouncement(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('library_announcements').delete().eq('id', id);
  if (error) throw error;
}

/** Admin: sent-announcement metadata (audience + type) display labels. */
export const ANNOUNCEMENT_TYPES: { value: AnnouncementType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'important', label: 'Important' },
  { value: 'system_update', label: 'System Update' }
];

export const AUDIENCE_OPTIONS = [
  { value: 'everyone', label: 'Everyone (students & staff)' },
  { value: 'students', label: 'Students only' },
  { value: 'staff', label: 'Staff only' }
];

/**
 * Send an announcement to every eligible user in one server-side step.
 * The RPC inserts the announcement row and fans out per-user notifications
 * (deduplicated). Only admin / super_admin can invoke it — the database
 * enforces this on top of the UI hiding the controls.
 */
export async function sendAnnouncement(input: {
  title: string;
  body: string;
  type: AnnouncementType;
  audience?: string;
}): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('send_announcement', {
    p_title: input.title.trim(),
    p_body: normalizeMessageBody(input.body),
    p_announcement_type: input.type,
    p_audience: input.audience || 'everyone'
  });
  if (error) throw friendlyAnnouncementError(error);
  return data as string;
}

/** Admin: toggle published/deactivated without deleting history. */
export async function setAnnouncementPublished(id: string, published: boolean): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('library_announcements')
    .update({ is_published: published, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw friendlyAnnouncementError(error);
}

function friendlyAnnouncementError(error: unknown): Error {
  const msg =
    error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string'
      ? (error as any).message
      : '';
  if (/Only authorized administrators|permission denied|row-level security|rlspolicy/i.test(msg)) {
    return new Error('You do not have permission to send announcements.');
  }
  return error instanceof Error ? error : new Error('Could not send the announcement. Please try again.');
}