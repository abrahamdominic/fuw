import { supabase, requireSupabase } from './supabase';
import { store } from './store';

export type SavedItemType =
  | 'material'
  | 'product'
  | 'vendor'
  | 'accommodation'
  | 'roommate'
  | 'event'
  | 'announcement'
  | 'academic_course';

export interface UnifiedSavedItem {
  id: string;
  userId: string;
  itemType: SavedItemType;
  itemId: string;
  title: string;
  subtitle?: string | null;
  url: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface SaveItemInput {
  itemType: SavedItemType;
  itemId: string;
  title: string;
  subtitle?: string | null;
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fetch all unified saved items for the authenticated user.
 */
export async function fetchUnifiedSavedItems(
  itemTypeFilter?: SavedItemType
): Promise<UnifiedSavedItem[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('user_saved_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (itemTypeFilter) {
    query = query.eq('item_type', itemTypeFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch saved items:', error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    itemType: row.item_type as SavedItemType,
    itemId: row.item_id,
    title: row.title,
    subtitle: row.subtitle,
    url: row.url,
    metadata: row.metadata,
    createdAt: row.created_at
  }));
}

/**
 * Save an item to the unified saved items table. Also syncs with legacy
 * bookmarks/favourites when applicable.
 */
export async function saveUnifiedItem(input: SaveItemInput): Promise<UnifiedSavedItem | null> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Please sign in to save items.');

  const { data, error } = await client
    .from('user_saved_items')
    .upsert(
      {
        user_id: user.id,
        item_type: input.itemType,
        item_id: input.itemId,
        title: input.title,
        subtitle: input.subtitle ?? null,
        url: input.url,
        metadata: input.metadata ?? {}
      },
      { onConflict: 'user_id, item_type, item_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error saving item:', error.message);
    throw new Error(error.message);
  }

  // Legacy compatibility: mirror to legacy bookmarks if material
  if (input.itemType === 'material') {
    if (!store.isBookmarked(input.itemId)) {
      store.toggleBookmark(input.itemId);
    }
  }

  return {
    id: data.id,
    userId: data.user_id,
    itemType: data.item_type as SavedItemType,
    itemId: data.item_id,
    title: data.title,
    subtitle: data.subtitle,
    url: data.url,
    metadata: data.metadata,
    createdAt: data.created_at
  };
}

/**
 * Remove an item from the unified saved items table.
 */
export async function removeUnifiedItem(itemType: SavedItemType, itemId: string): Promise<boolean> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return false;

  const { error } = await client
    .from('user_saved_items')
    .delete()
    .eq('user_id', user.id)
    .eq('item_type', itemType)
    .eq('item_id', itemId);

  if (error) {
    console.error('Error removing saved item:', error.message);
    return false;
  }

  // Legacy sync
  if (itemType === 'material' && store.isBookmarked(itemId)) {
    store.toggleBookmark(itemId);
  }

  return true;
}

/**
 * Check if a specific item is saved.
 */
export async function checkIsItemSaved(itemType: SavedItemType, itemId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { count, error } = await supabase
    .from('user_saved_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('item_type', itemType)
    .eq('item_id', itemId);

  if (error) return false;
  return (count || 0) > 0;
}
