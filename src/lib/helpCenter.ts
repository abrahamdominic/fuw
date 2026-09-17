// Help center & library services: help topics, FAQs, and announcements.
import { requireSupabase } from './supabase';

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

export interface LibraryAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  published_at: string;
  is_published?: boolean;
  published_by?: string | null;
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
}): Promise<void> {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {
    title: input.title.trim(),
    body: input.body.trim(),
    audience: (input.audience || 'everyone').trim(),
    is_published: input.isPublished ?? true,
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