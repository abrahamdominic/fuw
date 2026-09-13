// Data access layer for admin ↔ student AND student ↔ student messaging.
//
// Architecture notes:
//   * A `conversations` row has exactly two participants: student_id and
//     created_by. RLS treats BOTH as participants (SELECT/INSERT/UPDATE), so
//     the same policies govern admin ↔ student and student ↔ student threads.
//   * Direct (student ↔ student) conversations use a deterministic pair_key
//     (LEAST/GREATEST of the two UUIDs), so Abraham↔John and John↔Abraham
//     always resolve to the SAME conversation.
//   * sender_id / receiver_id on messages are derived server-side (sender via
//     auth.uid() in RLS, receiver via a BEFORE INSERT trigger). Never trust a
//     client-supplied sender_id.
//   * Cross-user display info comes from the `safe_profiles` view, which never
//     exposes email, phone, permissions, or auth data.
import { requireSupabase } from './supabase';

export interface ProfilePreview {
  id: string;
  username: string | null;
  full_name: string | null;
  display_name: string | null;
  role: string | null;
  matric_number: string | null;
  faculty: string | null;
  department: string | null;
  level: string | null;
}

export interface Conversation {
  id: string;
  subject: string;
  material_id: string | null;
  student_id: string;
  created_by: string;
  last_message_at: string;
  created_at: string;
  is_direct: boolean;
  // Other participant's display info (resolved from safe_profiles).
  peer?: ProfilePreview | null;
  unread_count?: number;
  last_message_body?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string | null;
  body: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  sender?: ProfilePreview | null;
}

export interface StudentSearchResult {
  id: string;
  username: string | null;
  full_name: string | null;
  display_name: string | null;
  matric_number: string | null;
  faculty: string | null;
  department: string | null;
  level: string | null;
}

/** Resolve display fields for a set of profile ids from the safe view. */
async function fetchProfilePreviews(ids: string[]): Promise<Map<string, ProfilePreview>> {
  const client = requireSupabase();
  const uniq = Array.from(new Set(ids)).filter(Boolean);
  const map = new Map<string, ProfilePreview>();
  if (uniq.length === 0) return map;

  const { data, error } = await client
    .from('safe_profiles')
    .select('id, username, full_name, display_name, role, matric_number, faculty, department, level')
    .in('id', uniq);
  if (error) throw error;
  for (const row of data || []) map.set(row.id, row as ProfilePreview);
  return map;
}

/** Fetch conversations for the current user (student or admin). */
export async function fetchConversations(): Promise<Conversation[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await client
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  let query = client
    .from('conversations')
    .select('*')
    .order('last_message_at', { ascending: false });

  if (!isAdmin) {
    query = query.or(`student_id.eq.${user.id},created_by.eq.${user.id}`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const convs = (data || []) as Conversation[];

  // Resolve participant display info from safe_profiles (works for cross-user).
  const ids = convs.flatMap((c) => [c.student_id, c.created_by]);
  const previews = await fetchProfilePreviews(ids);

  for (const conv of convs) {
    // The "peer" is whichever participant is not the current user.
    const peerId = conv.student_id === user.id ? conv.created_by : conv.student_id;
    conv.peer = previews.get(peerId) || null;

    const { count } = await client
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('is_read', false)
      .neq('sender_id', user.id);
    conv.unread_count = count || 0;

    const { data: lastMsg } = await client
      .from('messages')
      .select('body')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastMsg) conv.last_message_body = (lastMsg as any).body;
  }

  return convs;
}

/** Fetch messages for a conversation, with sender display info attached. */
export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const msgs = (data || []) as Message[];
  const previews = await fetchProfilePreviews(msgs.map((m) => m.sender_id));
  for (const m of msgs) m.sender = previews.get(m.sender_id) || null;
  return msgs;
}

/** Admin/student: create a new help-desk conversation (any authenticated user). */
export async function startConversation(
  studentId: string,
  subject: string,
  body: string,
  materialId?: string
): Promise<Conversation> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: conv, error: convError } = await client
    .from('conversations')
    .insert({
      subject: subject.trim(),
      material_id: materialId || null,
      student_id: studentId,
      created_by: user.id
    })
    .select('*')
    .single();

  if (convError) throw convError;

  const { error: msgError } = await client
    .from('messages')
    .insert({ conversation_id: conv.id, sender_id: user.id, body: body.trim() });

  if (msgError) throw msgError;

  // Notifications are created server-side by the AFTER INSERT trigger.
  return conv as Conversation;
}

/**
 * Find-or-create a direct (student ↔ student) conversation with another
 * student. Uses the deterministic pair_key server-side so duplicate
 * conversations between the same two people are impossible.
 */
export async function getOrCreateDirectConversation(peerId: string): Promise<Conversation> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_or_create_direct_conversation', {
    p_other_id: peerId
  });
  if (error) throw error;
  return (data as unknown) as Conversation;
}

/** Search for students by username (safe fields only, server-side). */
export async function searchStudents(query: string): Promise<StudentSearchResult[]> {
  const client = requireSupabase();
  const q = (query || '').trim();
  if (!q) return [];
  const { data, error } = await client.rpc('search_students', { p_query: q });
  if (error) throw error;
  return ((data || []) as unknown) as StudentSearchResult[];
}

/** Send a message in an existing conversation. */
export async function sendMessage(conversationId: string, body: string): Promise<Message> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message cannot be empty.');

  const { data, error } = await client
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: user.id, body: trimmed })
    .select('*')
    .single();

  if (error) throw error;
  const msg = data as Message;

  // Bump last_message_at (now permitted by the participant UPDATE policy).
  await client
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  return msg;
}

/** Mark incoming messages in a conversation as read. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  await client
    .from('messages')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', user.id)
    .eq('is_read', false);
}