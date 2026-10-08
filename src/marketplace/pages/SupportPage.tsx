import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send,
  MessageSquare,
  Headset,
  Store,
  Clock,
  CheckCheck,
  Lock,
} from 'lucide-react';
import {
  fetchMySupportThreads,
  fetchSupportQueue,
  fetchSupportThread,
  sendSupportMessage,
  markSupportRead,
  claimSupportThread,
  setSupportStatus,
  startSupportThread,
} from '../lib/api';
import type { SupportConversation, SupportMessage, SupportStatus } from '../lib/types';
import { formatTimeAgo } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { MessageText } from '../../components/MessageText';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

type Viewer = 'vendor' | 'admin';

/**
 * A row in either list. The admin queue carries vendor identity and a derived
 * "needs a reply" flag; the vendor list carries neither, so the shared fields
 * are all the row renderer is allowed to assume.
 */
type Row = {
  id: string;
  subject: string;
  status: SupportStatus;
  last_message_at: string | null;
  last_message_preview?: string | null;
  created_at: string;
  closed_at?: string | null;
  admin_unread?: number;
  vendor_unread?: number;
  shop_name?: string | null;
  vendor_display_name?: string | null;
  awaiting_admin?: boolean;
};

const FILTERS = ['all', 'awaiting_admin', 'awaiting_vendor', 'closed'] as const;

/**
 * PHASE 16: vendor ↔ admin support.
 *
 * One component serves both sides because the two views are the same
 * conversation seen from opposite ends. Every decision about who may read,
 * write or close a thread belongs to the database; this only decides what to
 * render and what to ask for.
 */
/**
 * `embedded` drops the page heading, for when the inbox lives inside another
 * page's tab rather than standing on its own route.
 */
export const SupportInbox: React.FC<{ viewer: Viewer; embedded?: boolean }> = ({
  viewer,
  embedded,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('conversationId') || '';

  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<SupportConversation | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [filter, setFilter] = useState<SupportStatus | 'all'>('all');
  const [closeNote, setCloseNote] = useState('');
  const [showClose, setShowClose] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const scrollDown = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      setRows(
        viewer === 'admin'
          ? await fetchSupportQueue(filter === 'all' ? undefined : filter)
          : await fetchMySupportThreads(),
      );
    } catch (e: any) {
      toast(e?.message || 'Could not load support threads', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [viewer, filter, toast]);

  useEffect(() => {
    if (!user) return;
    loadList();
  }, [user, loadList]);

  const openThread = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoadingThread(true);
      setShowClose(false);
      setCloseNote('');
      try {
        const thread = await fetchSupportThread(id);
        setActive(thread);
        // Marking read is fire-and-forget: a failed receipt must not stop the
        // transcript from rendering.
        markSupportRead(id).catch(() => {});
        setRows(prev =>
          prev.map(r =>
            r.id === id
              ? { ...r, ...thread, admin_unread: 0, vendor_unread: 0 }
              : r,
          ),
        );
      } catch (e: any) {
        toast(e?.message || 'Could not open that thread', 'error');
        setActive(null);
      } finally {
        setLoadingThread(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (selectedId) {
      openThread(selectedId);
    } else {
      setActive(null);
    }
  }, [selectedId, openThread]);

  useEffect(() => {
    if (active) setTimeout(scrollDown, 60);
  }, [active?.messages.length, scrollDown]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !active || sending) return;

    setSending(true);
    const optimistic: SupportMessage = {
      id: `pending-${Date.now()}`,
      conversation_id: active.id,
      sender_id: user?.id ?? null,
      sender_role: viewer,
      body,
      is_system: false,
      created_at: new Date().toISOString(),
      sender_name: 'You',
    };
    setActive(prev => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev));
    setDraft('');
    scrollDown();

    try {
      await sendSupportMessage(active.id, body);
      // Re-read rather than trusting the optimistic row: the server decides
      // the sender role, the read receipts and the resulting status.
      setActive(await fetchSupportThread(active.id));
      loadList();
    } catch (err: any) {
      // Give the text back rather than losing what was typed.
      setActive(prev =>
        prev ? { ...prev, messages: prev.messages.filter(m => m.id !== optimistic.id) } : prev,
      );
      setDraft(body);
      toast(err?.message || 'Message not sent', 'error');
    } finally {
      setSending(false);
      scrollDown();
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (!active) return;
    try {
      await fn();
      toast(ok, 'success');
      loadList();
      openThread(active.id);
    } catch (e: any) {
      toast(e?.message || 'That did not work', 'error');
    }
  };

  const counts = useMemo(
    () => ({
      open: rows.filter(r => r.status !== 'closed').length,
      waiting: rows.filter(r => r.status === 'awaiting_admin').length,
    }),
    [rows],
  );

  if (!user) {
    return <EmptyState icon={<MessageSquare size={28} />} title="Sign in to use support" />;
  }
  if (viewer === 'admin' && !isAdmin) {
    return <EmptyState icon={<Lock size={28} />} title="Staff only" />;
  }

  return (
    <div className="page-pad">
      {!embedded && (
        <div className="page-head">
          <h1>{viewer === 'admin' ? 'Support queue' : 'Marketplace support'}</h1>
          <p>
            {viewer === 'admin'
              ? `${counts.waiting} waiting on a reply, ${counts.open} open in total.`
              : 'Questions, disputes and payout problems are answered here by the marketplace team.'}
          </p>
        </div>
      )}

      <div className={`chat-layout ${active ? 'has-thread' : ''}`}>
        <div className="chat-list">
          <div className="chat-thread-head" style={{ flexWrap: 'wrap' }}>
            <strong>
              {viewer === 'admin' ? `Threads (${rows.length})` : `My threads (${rows.length})`}
            </strong>
            {viewer === 'admin' && (
              <div className="chip-row" style={{ marginLeft: 'auto' }} role="tablist">
                {FILTERS.map(f => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    className={`chip ${filter === f ? 'is-active' : ''}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All' : f.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="chat-list-items">
            {loadingList ? (
              <div style={{ padding: 14, display: 'grid', gap: 10 }}>
                {[0, 1, 2].map(i => (
                  <Skeleton key={i} height={62} borderRadius={8} />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Headset size={26} />}
                title={viewer === 'admin' ? 'No threads match' : 'No support threads yet'}
                description={
                  viewer === 'admin'
                    ? 'Vendor questions land here as soon as they are sent.'
                    : 'Start a thread below and the reply will appear here.'
                }
              />
            ) : (
              rows.map(r => {
                const unread = viewer === 'admin' ? r.admin_unread ?? 0 : r.vendor_unread ?? 0;
                return (
                  <button
                    key={r.id}
                    className={`chat-convo-item ${r.id === active?.id ? 'is-active' : ''} ${
                      unread > 0 ? 'is-unread' : ''
                    }`}
                    onClick={() => setSearchParams({ conversationId: r.id })}
                  >
                    <span className="support-row__icon">
                      {viewer === 'admin' ? <Store size={17} /> : <StatusPill status={r.status} />}
                    </span>

                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="support-row__top">
                        <strong>
                          {viewer === 'admin' ? r.shop_name || 'Storefront' : r.subject}
                        </strong>
                        <span className="support-row__time">
                          {r.last_message_at ? formatTimeAgo(r.last_message_at) : 'new'}
                        </span>
                      </span>

                      {viewer === 'admin' ? (
                        <span className="support-row__sub">{r.subject}</span>
                      ) : (
                        <span className="support-row__sub">
                          <StatusPill status={r.status} />
                        </span>
                      )}

                      <span className="support-row__preview">
                        {r.last_message_preview || 'No messages yet'}
                      </span>

                      <span className="support-row__meta">
                        <Clock size={11} /> {r.last_message_at ? formatTimeAgo(r.last_message_at) : 'new'}
                        {viewer === 'admin' && r.vendor_display_name && (
                          <span> · {r.vendor_display_name}</span>
                        )}
                        {unread > 0 && <span className="badge">{unread}</span>}
                        {viewer === 'admin' && r.awaiting_admin && (
                          <span className="badge badge-warning">Needs a reply</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="chat-thread">
          {loadingThread ? (
            <div className="chat-msgs">
              <Skeleton height={44} borderRadius={12} />
              <Skeleton height={44} borderRadius={12} />
              <Skeleton height={44} borderRadius={12} />
            </div>
          ) : !active ? (
            <EmptyState
              icon={<MessageSquare size={28} />}
              title="Choose a thread"
              description="Everything stays on the record, so nothing has to be repeated."
            />
          ) : (
            <>
              <div className="chat-thread-head" style={{ flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{active.subject}</strong>
                  <span className="support-row__sub">
                    {viewer === 'admin' && active.shop_name ? `${active.shop_name} · ` : ''}
                    <StatusPill status={active.status} />
                  </span>
                </div>

                {viewer === 'admin' && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {active.admin_unread ? (
                      <span className="badge badge-warning">{active.admin_unread} unread</span>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        act(
                          () => claimSupportThread(active.id, 'Claimed from the support queue'),
                          'Thread assigned to you',
                        )
                      }
                    >
                      <CheckCheck size={14} /> Assign to me
                    </button>
                    {active.status === 'closed' ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          act(
                            () => setSupportStatus(active.id, 'open', 'Reopened for a follow-up'),
                            'Thread reopened',
                          )
                        }
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-expanded={showClose}
                        onClick={() => setShowClose(v => !v)}
                      >
                        Close
                      </button>
                    )}
                  </div>
                )}
              </div>

              {showClose && (
                <div className="support-close">
                  <label htmlFor="support-close-note" className="form-label">
                    Why is this closing? The vendor reads this.
                  </label>
                  <textarea
                    id="support-close-note"
                    className="form-input"
                    rows={2}
                    value={closeNote}
                    onChange={e => setCloseNote(e.target.value)}
                    placeholder="e.g. The settlement released on the next cycle; nothing further needed."
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={closeNote.trim().length < 3}
                    onClick={() =>
                      act(
                        () => setSupportStatus(active.id, 'closed', closeNote.trim()),
                        'Thread closed',
                      )
                    }
                  >
                    Close thread
                  </button>
                </div>
              )}

              <div className="chat-msgs">
                {active.messages.map(m => {
                  const mine = m.sender_role === viewer;
                  const isAdmin = m.sender_role === 'admin';
                  return (
                    <div
                      key={m.id}
                      className={`chat-bubble ${mine ? 'me' : 'them'} ${
                        isAdmin ? 'chat-bubble--admin' : ''
                      }`}
                    >
                      {!mine && (
                        <span className="chat-bubble__who">
                          {m.sender_name || (isAdmin ? 'Marketplace admin' : 'Vendor')}
                          {isAdmin && <span className="chat-bubble__tag">Admin</span>}
                        </span>
                      )}
                      <MessageText body={m.body} />
                      <span className="chat-bubble-time">{formatTimeAgo(m.created_at)}</span>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              {active.status === 'closed' ? (
                <div className="chat-composer support-composer--closed">
                  <Lock size={15} />
                  This thread is closed. Start a new one with the same subject to
                  continue.
                </div>
              ) : (
                <form className="chat-composer" onSubmit={send}>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={draft}
                    maxLength={2000}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e);
                    }}
                    placeholder="Write a message…  ⌘/Ctrl + Enter to send"
                    aria-label="Message"
                  />
                  <button className="btn btn-primary" disabled={!draft.trim() || sending}>
                    <Send size={15} /> {sending ? 'Sending…' : 'Send'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {viewer === 'vendor' && <NewSupportThread onCreated={id => {
        loadList();
        setSearchParams({ conversationId: id });
      }} />}
    </div>
  );
};

/** The vendor side of starting a thread. An admin never needs this form. */
export const NewSupportThread: React.FC<{ onCreated: (conversationId: string) => void }> = ({
  onCreated,
}) => {
  const { toast } = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startSupportThread(subject.trim(), body.trim());
      setSubject('');
      setBody('');
      if (res?.conversation_id) onCreated(res.conversation_id);
    } catch (err: any) {
      const msg = err?.message || 'Could not start the thread';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card support-new">
      <h2>Contact the marketplace team</h2>
      <p className="muted">
        Keep the subject short and specific. Reusing a subject continues your
        existing thread instead of starting a second one. Never include a
        password, a full card number or an OTP.
      </p>
      <form onSubmit={submit} className="form-grid">
        <div>
          <label className="form-label" htmlFor="support-subject">Subject</label>
          <input
            id="support-subject"
            className="form-input"
            value={subject}
            maxLength={160}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Payout stuck after refund"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="support-body">What do you need help with?</label>
          <textarea
            id="support-body"
            className="form-input"
            rows={4}
            value={body}
            maxLength={2000}
            onChange={e => setBody(e.target.value)}
            placeholder="Include order numbers and dates where you can."
          />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div>
          <button
            className="btn btn-primary"
            disabled={!subject.trim() || !body.trim() || busy}
          >
            {busy ? 'Sending…' : 'Send to support'}
          </button>
        </div>
      </form>
    </section>
  );
};

const StatusPill: React.FC<{ status: SupportStatus }> = ({ status }) => {
  const label =
    status === 'awaiting_admin'
      ? 'Waiting on us'
      : status === 'awaiting_vendor'
        ? 'Waiting on you'
        : status === 'closed'
          ? 'Closed'
          : 'Open';
  return <span className={`pill pill--${status}`}>{label}</span>;
};
