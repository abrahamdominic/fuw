import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Send,
  MessageSquare,
  Store,
  ShoppingBag,
} from 'lucide-react';
import { fetchConversations, fetchMessages, sendMessage, markConversationRead } from '../lib/api';
import type { MarketplaceConversation, MarketplaceMessage } from '../lib/types';
import { formatTimeAgo, formatNaira } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';
import { MessageText } from '../../components/MessageText';

export const MessagesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConvId = searchParams.get('conversationId') || '';

  const { user } = useAuth();
  const { toast } = useToast();

  const [conversations, setConversations] = useState<MarketplaceConversation[]>([]);
  const [messages, setMessages] = useState<MarketplaceMessage[]>([]);
  const [activeConv, setActiveConv] = useState<MarketplaceConversation | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!user) return;
    setLoadingConvs(true);
    fetchConversations().then((list) => {
      setConversations(list);
      if (selectedConvId) {
        const found = list.find((c) => c.id === selectedConvId);
        if (found) setActiveConv(found);
      } else if (list.length > 0) {
        setActiveConv(list[0]);
        setSearchParams({ conversationId: list[0].id });
      }
    }).catch(console.error).finally(() => setLoadingConvs(false));
  }, [user]);

  useEffect(() => {
    if (!selectedConvId || !user) return;
    const found = conversations.find((c) => c.id === selectedConvId);
    if (found) {
      if (activeConv?.id !== found.id) {
        setActiveConv(found);
      }
    } else {
      fetchConversations().then((list) => {
        setConversations(list);
        const refetched = list.find((c) => c.id === selectedConvId);
        if (refetched) setActiveConv(refetched);
      }).catch(console.error);
    }
  }, [selectedConvId, user]);

  useEffect(() => {
    if (!activeConv) return;
    setLoadingMsgs(true);
    fetchMessages(activeConv.id)
      .then((msgs) => {
        setMessages(msgs);
        markConversationRead(activeConv.id).catch(() => {});
        setTimeout(scrollToBottom, 100);
      })
      .catch(console.error)
      .finally(() => setLoadingMsgs(false));
  }, [activeConv?.id]);

  const handleSelectConv = (conv: MarketplaceConversation) => {
    setActiveConv(conv);
    setSearchParams({ conversationId: conv.id });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConv) return;

    const text = newMessage.trim();
    setNewMessage('');
    setSending(true);

    try {
      await sendMessage(activeConv.id, text);
      const updatedMsgs = await fetchMessages(activeConv.id);
      setMessages(updatedMsgs);
      setTimeout(scrollToBottom, 100);
    } catch (err: any) {
      toast(err.message || 'Failed to send message', 'error');
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '60px 0' }}>
        <EmptyState
          icon={<MessageSquare size={32} />}
          title="Sign in to View Messages"
          description="Access your conversations with student vendors and buyers."
          action={
            <Link to={PLATFORM_PATHS.login} className="btn btn-primary" style={{ padding: '10px 22px' }}>
              Sign In
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Title */}
      <div style={{ marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
          Messages & Campus Chats
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
          Direct communication with sellers and buyers before and after orders
        </p>
      </div>

      {/* Two-Pane Chat Container — columns and height are CSS-owned so the
          panes can stack on phones instead of a fixed 320px rail. */}
      <div
        style={{
          display: 'grid',
          background: 'var(--surface, #ffffff)',
          borderRadius: 14,
          border: '1px solid var(--border, #dcebe0)',
          overflow: 'hidden',
        }}
        className="messages-container"
      >
        {/* Left Pane: Conversations List */}
        <div className="mp-msg-list" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border, #dcebe0)', background: 'var(--surface-alt, #f4f8f5)' }}>
            <strong style={{ fontSize: 14 }}>Conversations ({conversations.length})</strong>
          </div>

          <div className="mp-msg-list-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            {loadingConvs ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} height={60} borderRadius={8} />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted, #55675b)', fontSize: 13 }}>
                No messages yet. Chat with a seller from any listing!
              </div>
            ) : (
              conversations.map((c) => {
                const isSelected = activeConv?.id === c.id;
                const otherName = c.vendor?.owner_id === user.id ? (c.buyer?.full_name || 'Buyer') : (c.vendor?.store_name || 'Vendor');

                return (
                  <div
                    key={c.id}
                    onClick={() => handleSelectConv(c)}
                    style={{
                      padding: '14px 16px',
                      borderBottom: '1px solid var(--border, #dcebe0)',
                      background: isSelected ? 'var(--green-100, #e8f5ec)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--surface-alt, #f4f8f5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Store size={18} color="var(--green-800, #12603d)" />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary, #17231d)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {otherName}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>
                          {formatTimeAgo(c.last_message_at)}
                        </span>
                      </div>

                      {c.product && (
                        <span style={{ fontSize: 12, color: 'var(--green-800, #12603d)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Regarding: {c.product.title}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Active Chat Window */}
        {activeConv ? (
          <div className="mp-msg-thread" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border, #dcebe0)',
                background: 'var(--surface-alt, #f4f8f5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div>
                <strong style={{ fontSize: 15, display: 'block', color: 'var(--text-primary, #17231d)' }}>
                  {activeConv.vendor?.owner_id === user.id ? (activeConv.buyer?.full_name || 'Buyer') : (activeConv.vendor?.store_name || 'Vendor')}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                  Protected Conversation
                </span>
              </div>

              {activeConv.product && (
                <Link
                  to={mpPath(`/product/${activeConv.product.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: '#ffffff',
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--green-900, #0d4a2f)',
                    textDecoration: 'none',
                  }}
                >
                  <ShoppingBag size={13} />
                  <span>View Listing ({formatNaira(activeConv.product.price_kobo)})</span>
                </Link>
              )}
            </div>

            {/* Messages Stream */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loadingMsgs ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Skeleton height={40} width="60%" />
                  <Skeleton height={40} width="50%" style={{ alignSelf: 'flex-end' }} />
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted, #55675b)', margin: 'auto' }}>
                  No messages yet. Say hello to begin!
                </div>
              ) : (
                messages.map((m) => {
                  const isMine = m.sender_id === user.id;

                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: isMine ? 'flex-end' : 'flex-start',
                        maxWidth: '75%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMine ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: isMine ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                          background: isMine ? 'var(--green-800, #12603d)' : 'var(--surface-alt, #f4f8f5)',
                          color: isMine ? '#ffffff' : 'var(--text-primary, #17231d)',
                          fontSize: 14,
                          lineHeight: 1.45,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                        }}
                      >
                        <MessageText body={m.body} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary, #55675b)', marginTop: 3 }}>
                        {formatTimeAgo(m.created_at)}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input Box */}
            <form onSubmit={handleSend} style={{ padding: '12px 16px', borderTop: '1px solid var(--border, #dcebe0)', display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your message..."
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #dcebe0)',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim()}
                className="btn btn-primary"
                style={{ padding: '10px 18px' }}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted, #55675b)' }}>
            Select a conversation to start chatting
          </div>
        )}
      </div>
    </div>
  );
};
