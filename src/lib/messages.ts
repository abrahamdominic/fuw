// Data access layer for admin ↔ student messaging.
import { requireSupabase } from './supabase';

export interface Conversation {
  id: string;
  subject: string;
  material_id: string | null;
  student_id: string;
  created_by: string;
  last_message_at: string;
  last_message_body?: string;
  created_at: string;
  // Joined
  profiles?: { full_name: string; email: string; matric_number: string; faculty: string; department: string; level: string } | null;
  messages?: Message[];
  unread_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
  sender?: { full_name: string; role: string } | null;
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
    .select(`
      *,
      profiles!conversations_student_id_fkey(full_name, email, matric_number, faculty, department, level)
    `)
    .order('last_message_at', { ascending: false });

  if (!isAdmin) {
    query = query.eq('student_id', user.id);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Fetch unread counts and last message body
  const convs = (data || []) as Conversation[];
  for (const conv of convs) {
    const { count } = await client
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('is_read', false)
      .neq('sender_id', user.id);
    conv.unread_count = count || 0;

    // Fetch last message body for preview
    const { data: lastMsg } = await client
      .from('messages')
      .select('body')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastMsg) conv.last_message_body = lastMsg.body;
  }

  return convs;
}

/** Fetch messages for a conversation. */
export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/** Admin: start a new conversation with a student. */
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
    .insert({
      conversation_id: conv.id,
      sender_id: user.id,
      body: body.trim()
    });

  if (msgError) throw msgError;

  // Notify student
  await client.from('notifications').insert({
    user_id: studentId,
    title: 'New message from Admin',
    message: `An administrator has sent you a message: ${subject}`,
    type: 'info',
    link: '/student/messages'
  });

  return conv;
}

/** Send a message in an existing conversation. */
export async function sendMessage(conversationId: string, body: string): Promise<Message> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: body.trim()
    })
    .select('*')
    .single();

  if (error) throw error;

  // Update last_message_at
  await client
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  // Notify the other party
  const { data: conv } = await client
    .from('conversations')
    .select('student_id, created_by')
    .eq('id', conversationId)
    .single();

  if (conv) {
    const recipientId = conv.student_id === user.id ? conv.created_by : conv.student_id;
    const { data: senderProfile } = await client.from('profiles').select('full_name, role').eq('id', user.id).single();
    const senderName = senderProfile?.role === 'admin' || senderProfile?.role === 'super_admin' ? 'Admin' : senderProfile?.full_name || 'Student';

    await client.from('notifications').insert({
      user_id: recipientId,
      title: `New message from ${senderName}`,
      message: body.trim().substring(0, 100) + (body.trim().length > 100 ? '…' : ''),
      type: 'info',
      link: '/student/messages'
    });
  }

  return data;
}

/** Mark messages in a conversation as read. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  await client
    .from('messages')
    .update({ is_read: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', user.id)
    .eq('is_read', false);
}
