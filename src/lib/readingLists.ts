// Reading lists: personal collections of materials for study, research,
// coursework and exam preparation.
import { requireSupabase } from './supabase';

export interface ReadingList {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  category: string;
  is_public: boolean;
  cover_material_id: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

export interface ReadingListItem {
  id: string;
  list_id: string;
  material_id: string | null;
  research_item_id: string | null;
  note: string | null;
  sort_order: number;
  added_at: string;
}

const READING_LIST_CATEGORIES = ['personal', 'course', 'research', 'exam-prep'];

/** Fetch all reading lists for the current user, with item counts. */
export async function fetchMyReadingLists(): Promise<ReadingList[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];
  const { data, error } = await client
    .from('reading_lists')
    .select('*, item_count:reading_list_items(id)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r,
    item_count: Array.isArray(r.item_count) ? r.item_count.length : r.item_count || 0
  }));
}

/** Fetch a single reading list with its items. */
export async function fetchReadingList(listId: string): Promise<{ list: ReadingList; items: ReadingListItem[] }> {
  const client = requireSupabase();
  const { data: list, error: listErr } = await client
    .from('reading_lists')
    .select('*')
    .eq('id', listId)
    .maybeSingle();
  if (listErr) throw listErr;
  if (!list) throw new Error('Reading list not found.');

  const { data: items, error: itemsErr } = await client
    .from('reading_list_items')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true });
  if (itemsErr) throw itemsErr;

  return { list: list as ReadingList, items: (items || []) as ReadingListItem[] };
}

/** Create a new reading list. */
export async function createReadingList(input: {
  name: string;
  description?: string;
  category?: string;
  isPublic?: boolean;
}): Promise<ReadingList> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Please sign in to create a reading list.');

  const name = input.name.trim();
  if (!name) throw new Error('A reading list name is required.');

  const category = input.category && READING_LIST_CATEGORIES.includes(input.category)
    ? input.category
    : 'personal';

  const { data, error } = await client
    .from('reading_lists')
    .insert({
      user_id: user.id,
      name,
      description: input.description?.trim() || null,
      category,
      is_public: !!input.isPublic
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ReadingList;
}

/** Rename / update a reading list. */
export async function updateReadingList(
  listId: string,
  input: { name?: string; description?: string; category?: string; isPublic?: boolean }
): Promise<void> {
  const client = requireSupabase();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.category !== undefined && READING_LIST_CATEGORIES.includes(input.category)) {
    patch.category = input.category;
  }
  if (input.isPublic !== undefined) patch.is_public = input.isPublic;
  const { error } = await client.from('reading_lists').update(patch).eq('id', listId);
  if (error) throw error;
}

/** Delete a reading list (and its items). */
export async function deleteReadingList(listId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('reading_lists').delete().eq('id', listId);
  if (error) throw error;
}

/** Add a material to a reading list. Returns true when added, false when already present. */
export async function addMaterialToReadingList(listId: string, materialId: string): Promise<boolean> {
  const client = requireSupabase();
  const { data: existing } = await client
    .from('reading_list_items')
    .select('id')
    .eq('list_id', listId)
    .eq('material_id', materialId)
    .maybeSingle();
  if (existing) return false;

  const { data: maxRow } = await client
    .from('reading_list_items')
    .select('sort_order')
    .eq('list_id', listId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await client.from('reading_list_items').insert({
    list_id: listId,
    material_id: materialId,
    sort_order: (maxRow?.sort_order ?? 0) + 1
  });
  if (error) throw error;
  return true;
}

/** Add a repository item to a reading list. */
export async function addResearchToReadingList(listId: string, researchItemId: string): Promise<boolean> {
  const client = requireSupabase();
  const { data: existing } = await client
    .from('reading_list_items')
    .select('id')
    .eq('list_id', listId)
    .eq('research_item_id', researchItemId)
    .maybeSingle();
  if (existing) return false;

  const { data: maxRow } = await client
    .from('reading_list_items')
    .select('sort_order')
    .eq('list_id', listId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await client.from('reading_list_items').insert({
    list_id: listId,
    research_item_id: researchItemId,
    sort_order: (maxRow?.sort_order ?? 0) + 1
  });
  if (error) throw error;
  return true;
}

/** Remove an item from a reading list. */
export async function removeReadingListItem(itemId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('reading_list_items').delete().eq('id', itemId);
  if (error) throw error;
}

/** Update an item's note (user annotation). */
export async function updateReadingListItemNote(itemId: string, note: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('reading_list_items')
    .update({ note: note.trim() || null })
    .eq('id', itemId);
  if (error) throw error;
}

export { READING_LIST_CATEGORIES };