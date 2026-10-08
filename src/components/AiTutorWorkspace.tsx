import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain,
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  BookOpen,
  Sparkles,
  HelpCircle,
  GraduationCap,
  List,
  Copy,
  AlertCircle,
  Send,
  Loader2,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Lock
} from 'lucide-react';
import {
  aiAsk,
  aiConfiguredHint,
  listAiConversations,
  loadConversationMessages,
  renameAiConversation,
  deleteAiConversation,
  AiConversationSummary,
  AiCitation
} from '../lib/ai';
import { fetchPremiumPublicConfiguration, type PremiumPublicConfiguration } from '../lib/payments';
import { useAuth } from '../lib/AuthContext';
import { logUserActivity } from '../lib/activity';
import { MaterialItem } from '../lib/store';
import { fx } from '../lib/motion';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: AiCitation[];
}

interface AiTutorWorkspaceProps {
  focusMaterial?: MaterialItem | null;
  onClearFocus?: () => void;
}

export function AiTutorWorkspace({ focusMaterial, onClearFocus }: AiTutorWorkspaceProps) {
  const { profile, hasPremium } = useAuth();
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [mode, setMode] = useState<'explainer' | 'exam' | 'summary' | 'quiz'>('summary');
  const [materialId, setMaterialId] = useState<string | null>(focusMaterial?.id ?? null);
  const [scopeCleared, setScopeCleared] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [premiumConfig, setPremiumConfig] = useState<PremiumPublicConfiguration | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const listEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const genRef = useRef(0);

  // Load premium configuration for study mode gating
  useEffect(() => {
    let cancelled = false;
    fetchPremiumPublicConfiguration()
      .then((cfg: PremiumPublicConfiguration) => {
        if (!cancelled) setPremiumConfig(cfg);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync focusMaterial
  useEffect(() => {
    if (focusMaterial) {
      setMaterialId(focusMaterial.id);
      setScopeCleared(false);
    }
  }, [focusMaterial]);

  // Load conversations list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingHistory(true);
        const list = await listAiConversations(40);
        if (cancelled) return;
        setConversations(list);
        if (list.length > 0) {
          const first = list[0];
          setActiveConvId(first.id);
          if (first.material_id) setMaterialId(first.material_id);
          const msgs = await loadConversationMessages(first.id);
          if (cancelled) return;
          setMessages(
            msgs.map((m) => ({
              role: m.role,
              content: m.content,
              citations: Array.isArray(m.citations) ? (m.citations as AiCitation[]) : []
            }))
          );
        }
      } catch (err: any) {
        console.warn('Error loading conversations:', err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const handleSelectConversation = async (conv: AiConversationSummary) => {
    if (conv.id === activeConvId || busy) return;
    setActiveConvId(conv.id);
    setMaterialId(conv.material_id);
    setScopeCleared(false);
    setError(null);
    setMessages([]);
    setBusy(true);
    try {
      const msgs = await loadConversationMessages(conv.id);
      setMessages(
        msgs.map((m) => ({
          role: m.role,
          content: m.content,
          citations: Array.isArray(m.citations) ? (m.citations as AiCitation[]) : []
        }))
      );
    } catch {
      setError('Could not load messages for this conversation.');
    } finally {
      setBusy(false);
    }
  };

  const handleNewConversation = () => {
    if (busy) return;
    genRef.current++;
    setActiveConvId(null);
    setMessages([]);
    setError(null);
    setInput('');
    inputRef.current?.focus();
  };

  const handleRename = async (convId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    const success = await renameAiConversation(convId, editingTitle);
    if (success) {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, title: editingTitle.trim() } : c))
      );
    }
    setEditingConvId(null);
  };

  const handleDelete = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation thread permanently?')) return;
    const success = await deleteAiConversation(convId);
    if (success) {
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        handleNewConversation();
      }
    }
  };

  const handleCopy = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1600);
    } catch {}
  };

  const handleSend = async (questionText: string) => {
    const question = questionText.trim();
    if (!question || busy) return;
    const gen = ++genRef.current;
    setError(null);
    setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: question },
      { role: 'assistant', content: '…' }
    ]);
    setBusy(true);

    try {
      const res = await aiAsk({
        message: question,
        conversationId: activeConvId,
        materialId,
        clearScope: scopeCleared,
        mode
      });

      if (genRef.current !== gen) return;

      setActiveConvId(res.conversationId);
      setMessages((prev) => {
        const copy = [...prev];
        if (copy.length === 0) return copy;
        copy[copy.length - 1] = {
          role: 'assistant',
          content: res.answer,
          citations: res.citations
        };
        return copy;
      });

      // Refresh conversations list to update title / order
      listAiConversations(30)
        .then((latest) => setConversations(latest))
        .catch(() => {});

      // Log student activity
      logUserActivity({
        activityType: 'ai_tutor_session',
        entityType: 'ai_conversation',
        entityId: res.conversationId,
        entityTitle: `AI Tutor: ${question.slice(0, 45)}...`,
        metadata: { mode, usedContext: res.usedContext, citationCount: res.citations?.length || 0 }
      }).catch(() => {});
    } catch (err: any) {
      if (genRef.current !== gen) return;
      setMessages((prev) => prev.slice(0, -1));
      if (aiConfiguredHint(err)) {
        setNotConfigured(true);
      }
      setError(err?.message || 'The AI assistant is temporarily unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className={`ai-tutor-container ${fx.fadeIn}`} style={{ display: 'flex', height: '760px', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)' }}>
      {/* Sidebar with Conversation Threads */}
      <div
        style={{
          width: sidebarOpen ? 280 : 0,
          minWidth: sidebarOpen ? 280 : 0,
          borderRight: sidebarOpen ? '1px solid var(--border)' : 'none',
          background: 'var(--surface-alt)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.2s var(--ease)',
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleNewConversation}
            disabled={busy}
            style={{ width: '100%', justifyContent: 'center', gap: 8, fontSize: 13, padding: '10px 14px' }}
          >
            <Plus size={16} />
            <span>New Chat Thread</span>
          </button>

          {conversations.length > 3 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search threads..."
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 30px',
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)'
                }}
              />
            </div>
          )}
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
          {loadingHistory ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
              Loading threads...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
              No chat history yet. Start asking!
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isActive = c.id === activeConvId;
              const isEditing = editingConvId === c.id;

              return (
                <div
                  key={c.id}
                  onClick={() => handleSelectConversation(c)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: 8,
                    marginBottom: 4,
                    cursor: 'pointer',
                    background: isActive ? 'var(--surface)' : 'transparent',
                    border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                    boxShadow: isActive ? 'var(--shadow-sm)' : 'none'
                  }}
                >
                  {isEditing ? (
                    <form onSubmit={(e) => handleRename(c.id, e)} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        autoFocus
                        style={{ fontSize: 12, padding: '3px 6px', flex: 1, borderRadius: 4, border: '1px solid var(--border)' }}
                      />
                      <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green-700)' }}>
                        <Check size={14} />
                      </button>
                      <button type="button" onClick={() => setEditingConvId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                        <X size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                        <MessageSquare size={14} color={isActive ? 'var(--green-700)' : 'var(--text-secondary)'} />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: isActive ? 700 : 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {c.title}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingConvId(c.id);
                            setEditingTitle(c.title);
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}
                          title="Rename thread"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(c.id, e)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}
                          title="Delete thread"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Workspace */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Workspace Header Strip */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="btn btn-secondary"
              style={{ padding: '6px 8px', fontSize: 12 }}
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>FUW AI Campus Tutor</span>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(22, 163, 74, 0.1)', color: 'var(--green-800)', fontWeight: 700 }}>
                  Grounded in Verified Materials
                </span>
              </div>
            </div>
          </div>

          {/* Scoped Material Pill */}
          {materialId && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#1d4ed8',
                fontSize: 12,
                fontWeight: 600
              }}
            >
              <BookOpen size={13} />
              <span>Target: {focusMaterial?.title || 'Focused Document'}</span>
              <button
                type="button"
                onClick={() => {
                  setMaterialId(null);
                  setScopeCleared(true);
                  onClearFocus?.();
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', padding: 2 }}
                title="Search whole library instead"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Chat Messages Log */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 440, padding: 24 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 16,
                  background: 'rgba(22, 163, 74, 0.12)',
                  color: 'var(--green-700)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 16px'
                }}
              >
                <Brain size={28} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>
                FUW Academic AI Tutor
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Ask complex questions, get simple explanations, exam-focus points, or generate practice quizzes directly from university materials.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Explain key concepts from CSC 201 data structures.',
                  'Give me 5 practice exam questions on macroeconomics.',
                  'Summarize the core laws of Nigerian legal system from my course notes.'
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleSend(prompt)}
                    disabled={busy}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-alt)',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'var(--text-primary)'
                    }}
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: isUser ? 'row-reverse' : 'row',
                    gap: 12,
                    alignItems: 'flex-start'
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: isUser ? 'var(--green-800)' : 'rgba(59, 130, 246, 0.12)',
                      color: isUser ? '#ffffff' : '#2563eb',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0
                    }}
                  >
                    {isUser ? (profile?.displayName || 'You').slice(0, 1).toUpperCase() : <Brain size={16} />}
                  </div>

                  <div
                    style={{
                      maxWidth: '80%',
                      background: isUser ? 'var(--green-900)' : 'var(--surface-alt)',
                      color: isUser ? '#ffffff' : 'var(--text-primary)',
                      padding: '12px 16px',
                      borderRadius: 14,
                      border: isUser ? 'none' : '1px solid var(--border)',
                      fontSize: 13,
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      position: 'relative'
                    }}
                  >
                    {!isUser && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                        <button
                          type="button"
                          onClick={() => handleCopy(i, m.content)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-secondary)',
                            padding: 2
                          }}
                          title="Copy response"
                        >
                          {copiedIndex === i ? <Check size={13} color="var(--green-600)" /> : <Copy size={13} />}
                        </button>
                      </div>
                    )}

                    <div>{m.content}</div>

                    {/* Citations */}
                    {m.citations && m.citations.length > 0 && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-800)', marginBottom: 6 }}>
                          Referenced Library Materials:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {m.citations.map((c, ci) => (
                            <Link
                              key={`${c.material_id}-${ci}`}
                              to={`/materials/${c.material_id}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                fontSize: 11,
                                color: 'var(--text-primary)',
                                textDecoration: 'none'
                              }}
                            >
                              <BookOpen size={11} color="var(--green-700)" />
                              <span>{c.title}{c.page ? ` (p. ${c.page})` : ''}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <Loader2 size={14} className="spin-icon" />
              <span>FUW AI Tutor is researching approved course materials...</span>
            </div>
          )}

          <div ref={listEndRef} />
        </div>

        {/* Error notification */}
        {error && (
          <div
            style={{
              padding: '10px 18px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderTop: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#dc2626',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* Study Mode Selector Bar */}
        <div
          style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-alt)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {[
              { id: 'summary' as const, label: 'Summary', icon: List, isPrem: false },
              { id: 'explainer' as const, label: 'Concept Explainer', icon: BookOpen, isPrem: true },
              { id: 'exam' as const, label: 'Exam Focus', icon: GraduationCap, isPrem: true },
              { id: 'quiz' as const, label: 'Quiz Mode', icon: HelpCircle, isPrem: true }
            ].map((item) => {
              const active = mode === item.id;
              const locked = item.isPrem && !hasPremium;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (locked) {
                      setError('This study mode requires an active FUW Premium subscription.');
                      return;
                    }
                    setMode(item.id);
                  }}
                  disabled={busy}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    background: active ? 'var(--green-800)' : 'var(--surface)',
                    color: active ? '#ffffff' : 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  <item.icon size={12} />
                  <span>{item.label}</span>
                  {locked && <Lock size={10} color="#eab308" />}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Mode: <strong>{mode.toUpperCase()}</strong>
          </div>
        </div>

        {/* Chat Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(input);
          }}
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 10,
            background: 'var(--surface)'
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your academic question or request..."
            disabled={busy}
            maxLength={2000}
            style={{
              flex: 1,
              padding: '11px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              fontSize: 13,
              background: 'var(--surface-alt)'
            }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !input.trim()}
            style={{ padding: '0 18px', borderRadius: 10, gap: 6 }}
          >
            {busy ? <Loader2 size={16} className="spin-icon" /> : <Send size={16} />}
            <span>Ask Tutor</span>
          </button>
        </form>
      </div>
    </div>
  );
}
