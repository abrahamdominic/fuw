// Curated library collections: librarian-curated sets of materials
// (e.g. "GST 101 First Semester Kit", "Research Methodology Collection").
import { requireSupabase } from './supabase';

export interface CollectionGroup {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  icon: string;
  cover_color: string;
  is_published: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  item_count?: number;
  items?: CollectionItem[];
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  material_id: string | null;
  research_item_id: string | null;
  title_override: string | null;
  sort_order: number;
  added_at: string;
  material?: Record<string, unknown> | null;
  research_item?: Record<string, unknown> | null;
}

/** Fetch published collections with item counts. */
export async function fetchCollections(): Promise<CollectionGroup[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('collection_groups')
    .select('*, item_count:collection_items(id)')
    .eq('is_published', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r,
    item_count: Array.isArray(r.item_count) ? r.item_count.length : r.item_count || 0
  }));
}

/** Fetch a single collection with its items (resolved names). */
export async function fetchCollection(slug: string): Promise<CollectionGroup | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('collection_groups')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: items, error: itemsErr } = await client
    .from('collection_items')
    .select('*, material:material_id(id, title, course_code, course_title, department, faculty, material_type, level, file_url, file_size), research_item:research_item_id(id, title, research_type, department, year, abstract, keywords)')
    .eq('collection_id', (data as any).id)
    .order('sort_order', { ascending: true });
  if (itemsErr) throw itemsErr;

  return {
    ...(data as any),
    items: (items || []) as CollectionItem[]
  };
}

/** Admin: create a curated collection. */
export async function createCollection(input: {
  name: string;
  description?: string;
  slug: string;
  icon?: string;
  coverColor?: string;
}): Promise<CollectionGroup> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('collection_groups')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      slug: input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      icon: input.icon || 'library',
      cover_color: input.coverColor || '#0B6B3A',
      is_published: true
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CollectionGroup;
}

/** Admin: add a material to a collection. */
export async function addMaterialToCollection(collectionId: string, materialId: string): Promise<void> {
  const client = requireSupabase();
  const { data: existing } = await client
    .from('collection_items')
    .select('id')
    .eq('collection_id', collectionId)
    .eq('material_id', materialId)
    .maybeSingle();
  if (existing) return;

  const { data: maxRow } = await client
    .from('collection_items')
    .select('sort_order')
    .eq('collection_id', collectionId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await client.from('collection_items').insert({
    collection_id: collectionId,
    material_id: materialId,
    sort_order: (maxRow?.sort_order ?? 0) + 1
  });
  if (error) throw error;
}

/** Admin: remove an item from a collection. */
export async function removeCollectionItem(itemId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('collection_items').delete().eq('id', itemId);
  if (error) throw error;
}

/** Admin: publish/unpublish a collection. */
export async function toggleCollectionPublished(collectionId: string, published: boolean): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('collection_groups')
    .update({ is_published: published, updated_at: new Date().toISOString() })
    .eq('id', collectionId);
  if (error) throw error;
}