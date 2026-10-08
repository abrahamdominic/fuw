import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers,
  Plus,
  Play,
  RotateCw,
  Sparkles,
  Trash2,
  Check,
  ChevronLeft,
  BookOpen,
  ArrowRight,
  Brain,
  HelpCircle,
  Loader2,
  Lock,
  X
} from 'lucide-react';
import {
  fetchFlashcardDecks,
  createFlashcardDeck,
  deleteFlashcardDeck,
  fetchCardsForDeck,
  createFlashcard,
  deleteFlashcard,
  reviewFlashcard,
  generateAiFlashcards,
  FlashcardDeck,
  Flashcard
} from '../lib/flashcards';
import { useAuth } from '../lib/AuthContext';
import { fx } from '../lib/motion';

export function FlashcardsWorkspace() {
  const { hasPremium } = useAuth();
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDeck, setActiveDeck] = useState<FlashcardDeck | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [studyMode, setStudyMode] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // New deck modal state
  const [showNewDeckModal, setShowNewDeckModal] = useState(false);
  const [deckTitle, setDeckTitle] = useState('');
  const [deckCourse, setDeckCourse] = useState('');
  const [deckTopic, setDeckTopic] = useState('');
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);

  // New card modal state
  const [showNewCardModal, setShowNewCardModal] = useState(false);
  const [cardFront, setCardFront] = useState('');
  const [cardBack, setCardBack] = useState('');
  const [cardHint, setCardHint] = useState('');
  const [isCreatingCard, setIsCreatingCard] = useState(false);

  // AI generator modal state
  const [showAiGenModal, setShowAiGenModal] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiCourse, setAiCourse] = useState('');
  const [aiCount, setAiCount] = useState(8);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadDecks = async () => {
    try {
      setLoading(true);
      const data = await fetchFlashcardDecks();
      setDecks(data);
    } catch (err) {
      console.warn('Could not load decks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDecks();
  }, []);

  const handleSelectDeck = async (deck: FlashcardDeck) => {
    setActiveDeck(deck);
    setStudyMode(false);
    try {
      const deckCards = await fetchCardsForDeck(deck.id);
      setCards(deckCards);
    } catch (err) {
      console.warn('Could not load cards:', err);
    }
  };

  const handleStartStudy = () => {
    if (cards.length === 0) return;
    setStudyMode(true);
    setCurrentCardIndex(0);
    setIsFlipped(false);
    setShowHint(false);
  };

  const handleReviewStep = async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    const card = cards[currentCardIndex];
    if (!card) return;

    try {
      const updated = await reviewFlashcard(card, rating);
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {}

    if (currentCardIndex + 1 < cards.length) {
      setCurrentCardIndex((i) => i + 1);
      setIsFlipped(false);
      setShowHint(false);
    } else {
      // Completed all cards in deck
      setStudyMode(false);
      alert('🎉 Deck review complete! Great job strengthening your academic recall.');
    }
  };

  const handleCreateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deckTitle.trim()) return;
    setIsCreatingDeck(true);
    try {
      const created = await createFlashcardDeck({
        title: deckTitle,
        courseCode: deckCourse,
        topic: deckTopic
      });
      setDecks((prev) => [created, ...prev]);
      setShowNewDeckModal(false);
      setDeckTitle('');
      setDeckCourse('');
      setDeckTopic('');
      await handleSelectDeck(created);
    } catch (err: any) {
      alert(err?.message || 'Could not create deck.');
    } finally {
      setIsCreatingDeck(false);
    }
  };

  const handleDeleteDeck = async (deckId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this flashcard deck permanently?')) return;
    try {
      await deleteFlashcardDeck(deckId);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
      if (activeDeck?.id === deckId) {
        setActiveDeck(null);
        setCards([]);
        setStudyMode(false);
      }
    } catch (err: any) {
      alert(err?.message || 'Could not delete deck.');
    }
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeck || !cardFront.trim() || !cardBack.trim()) return;
    setIsCreatingCard(true);
    try {
      const created = await createFlashcard({
        deckId: activeDeck.id,
        front: cardFront,
        back: cardBack,
        hint: cardHint
      });
      setCards((prev) => [...prev, created]);
      setActiveDeck((d) => (d ? { ...d, card_count: d.card_count + 1 } : null));
      setShowNewCardModal(false);
      setCardFront('');
      setCardBack('');
      setCardHint('');
    } catch (err: any) {
      alert(err?.message || 'Could not add card.');
    } finally {
      setIsCreatingCard(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!activeDeck) return;
    try {
      await deleteFlashcard(cardId, activeDeck.id);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
      setActiveDeck((d) => (d ? { ...d, card_count: Math.max(0, d.card_count - 1) } : null));
    } catch (err: any) {
      alert(err?.message || 'Could not delete card.');
    }
  };

  const handleGenerateAiDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiCourse.trim() || !aiTopic.trim()) return;

    if (!hasPremium) {
      setAiError('AI Flashcard generation requires an active FUW Premium subscription.');
      return;
    }

    setIsGeneratingAi(true);
    setAiError(null);

    try {
      const generatedCards = await generateAiFlashcards({
        courseCode: aiCourse,
        topic: aiTopic,
        count: aiCount
      });

      if (generatedCards.length === 0) {
        throw new Error('No flashcards were generated. Please refine topic.');
      }

      // Create new deck for these cards
      const newDeck = await createFlashcardDeck({
        title: `${aiCourse}: ${aiTopic}`,
        courseCode: aiCourse,
        topic: aiTopic
      });

      // Insert cards into deck
      for (const gc of generatedCards) {
        await createFlashcard({
          deckId: newDeck.id,
          front: gc.front,
          back: gc.back,
          hint: gc.hint
        });
      }

      setDecks((prev) => [newDeck, ...prev]);
      setShowAiGenModal(false);
      setAiTopic('');
      setAiCourse('');
      await handleSelectDeck(newDeck);
    } catch (err: any) {
      setAiError(err?.message || 'Failed to generate flashcards.');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  return (
    <div className={`flashcards-workspace ${fx.fadeIn}`} style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: 'rgba(22, 163, 74, 0.12)', color: 'var(--green-800)', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
            <Layers size={13} />
            <span>SM-2 SPACED REPETITION &middot; ACTIVE RECALL</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Smart Flashcards &amp; Decks
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            Retain formulas, key definitions, and exam concepts with scientifically-proven spaced repetition.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowAiGenModal(true)}
            style={{ fontSize: 13, padding: '9px 14px', gap: 6 }}
          >
            <Sparkles size={14} color="#9333ea" />
            <span>AI Flashcards</span>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowNewDeckModal(true)}
            style={{ fontSize: 13, padding: '9px 16px', gap: 6 }}
          >
            <Plus size={15} />
            <span>New Deck</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      {!activeDeck ? (
        /* Decks Grid */
        <div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading your flashcard decks...
            </div>
          ) : decks.length === 0 ? (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px dashed var(--border)',
                borderRadius: 16,
                padding: '48px 24px',
                textAlign: 'center'
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'rgba(22, 163, 74, 0.12)',
                  color: 'var(--green-700)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 16px'
                }}
              >
                <Layers size={28} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>
                No flashcard decks yet
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
                Create a custom deck or let FUW AI generate one instantly from your course syllabus.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowNewDeckModal(true)}
                  style={{ fontSize: 13 }}
                >
                  Create Manual Deck
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAiGenModal(true)}
                  style={{ fontSize: 13 }}
                >
                  Generate with AI
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
              {decks.map((deck) => (
                <div
                  key={deck.id}
                  onClick={() => handleSelectDeck(deck)}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 16,
                    padding: '20px',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    transition: 'all 0.15s var(--ease)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      {deck.course_code ? (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: 'rgba(22, 163, 74, 0.12)', color: 'var(--green-800)' }}>
                          {deck.course_code}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>General</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteDeck(deck.id, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
                        title="Delete deck"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px', lineHeight: 1.3 }}>
                      {deck.title}
                    </h3>
                    {deck.topic && (
                      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-secondary)' }}>
                        Topic: {deck.topic}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px solid var(--border)', marginTop: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {deck.card_count} {deck.card_count === 1 ? 'card' : 'cards'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>Study</span>
                      <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : studyMode ? (
        /* Study Mode (Active Flip Card) */
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStudyMode(false)}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <ChevronLeft size={14} />
              <span>Exit Study Mode</span>
            </button>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              Card {currentCardIndex + 1} of {cards.length}
            </span>
          </div>

          {/* Flashcard Component */}
          {cards[currentCardIndex] && (
            <div style={{ perspective: 1000, marginBottom: 24 }}>
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                style={{
                  minHeight: 280,
                  borderRadius: 18,
                  padding: '32px 28px',
                  background: isFlipped ? 'var(--surface-alt)' : 'var(--surface)',
                  border: isFlipped ? '2px solid var(--green-600)' : '1px solid var(--border)',
                  boxShadow: 'var(--shadow-md)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  textAlign: 'center',
                  transition: 'background 0.2s, border 0.2s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ textTransform: 'uppercase', fontWeight: 800, color: isFlipped ? 'var(--green-800)' : 'var(--text-secondary)' }}>
                    {isFlipped ? 'Answer / Solution' : 'Question / Prompt'}
                  </span>
                  <span style={{ fontSize: 11, fontStyle: 'italic' }}>
                    Click card to flip
                  </span>
                </div>

                <div style={{ margin: 'auto 0', padding: '20px 0' }}>
                  <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {isFlipped ? cards[currentCardIndex].back : cards[currentCardIndex].front}
                  </p>
                </div>

                {/* Hint toggle */}
                {cards[currentCardIndex].hint && (
                  <div>
                    {showHint ? (
                      <div style={{ fontSize: 12, color: '#eab308', background: 'rgba(234, 179, 8, 0.1)', padding: '6px 12px', borderRadius: 8, display: 'inline-block' }}>
                        💡 Hint: {cards[currentCardIndex].hint}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowHint(true);
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-secondary)', textDecoration: 'underline' }}
                      >
                        Show Hint
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SM-2 Spaced Repetition Rating Buttons */}
          {isFlipped ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <button
                type="button"
                onClick={() => handleReviewStep('again')}
                style={{
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: '1px solid #ef4444',
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#dc2626',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Again (&lt;1d)
              </button>
              <button
                type="button"
                onClick={() => handleReviewStep('hard')}
                style={{
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: '1px solid #f97316',
                  background: 'rgba(249, 115, 22, 0.1)',
                  color: '#ea580c',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Hard (1d)
              </button>
              <button
                type="button"
                onClick={() => handleReviewStep('good')}
                style={{
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: '1px solid #3b82f6',
                  background: 'rgba(59, 130, 246, 0.1)',
                  color: '#2563eb',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Good (3d)
              </button>
              <button
                type="button"
                onClick={() => handleReviewStep('easy')}
                style={{
                  padding: '12px 8px',
                  borderRadius: 10,
                  border: '1px solid #16a34a',
                  background: 'rgba(22, 163, 74, 0.1)',
                  color: '#15803d',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Easy (6d)
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsFlipped(true)}
                style={{ padding: '12px 32px', fontSize: 14, fontWeight: 800, borderRadius: 10 }}
              >
                Reveal Answer (Space / Click)
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Deck Details & Card List */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveDeck(null)}
                style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
              >
                <ChevronLeft size={14} />
                <span>All Decks</span>
              </button>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>
                  {activeDeck.title}
                </h2>
                {activeDeck.topic && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Topic: {activeDeck.topic}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowNewCardModal(true)}
                style={{ fontSize: 12, padding: '8px 14px', gap: 6 }}
              >
                <Plus size={14} />
                <span>Add Card</span>
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartStudy}
                disabled={cards.length === 0}
                style={{ fontSize: 12, padding: '8px 18px', gap: 6 }}
              >
                <Play size={14} />
                <span>Study Deck ({cards.length})</span>
              </button>
            </div>
          </div>

          {/* Cards Table */}
          {cards.length === 0 ? (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px dashed var(--border)',
                borderRadius: 16,
                padding: '40px 24px',
                textAlign: 'center'
              }}
            >
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                This deck doesn't have any cards yet. Add cards manually or generate them with AI!
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowNewCardModal(true)}
                style={{ fontSize: 12 }}
              >
                Add First Card
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cards.map((card, idx) => (
                <div
                  key={card.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16
                  }}
                >
                  <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', width: 24 }}>
                      #{idx + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                        {card.front}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {card.back}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--surface-alt)', color: 'var(--text-secondary)' }}>
                      Int: {card.interval_days}d
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCard(card.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
                      title="Delete card"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: New Deck */}
      {showNewDeckModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 440, width: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create Flashcard Deck</h3>
              <button type="button" onClick={() => setShowNewDeckModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateDeck} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Deck Title:</label>
                <input
                  type="text"
                  required
                  value={deckTitle}
                  onChange={(e) => setDeckTitle(e.target.value)}
                  placeholder="e.g. CSC 201 - Data Structures Formulas"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Course Code (Optional):</label>
                <input
                  type="text"
                  value={deckCourse}
                  onChange={(e) => setDeckCourse(e.target.value.toUpperCase())}
                  placeholder="e.g. CSC 201"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Topic / Unit (Optional):</label>
                <input
                  type="text"
                  value={deckTopic}
                  onChange={(e) => setDeckTopic(e.target.value)}
                  placeholder="e.g. Stacks & Queues"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewDeckModal(false)} style={{ fontSize: 13 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isCreatingDeck} style={{ fontSize: 13 }}>
                  {isCreatingDeck ? 'Creating...' : 'Create Deck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Card */}
      {showNewCardModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 440, width: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Add Card to Deck</h3>
              <button type="button" onClick={() => setShowNewCardModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateCard} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Front (Question or Term):</label>
                <textarea
                  rows={3}
                  required
                  value={cardFront}
                  onChange={(e) => setCardFront(e.target.value)}
                  placeholder="e.g. What is the time complexity of binary search?"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)', resize: 'vertical' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Back (Answer or Definition):</label>
                <textarea
                  rows={3}
                  required
                  value={cardBack}
                  onChange={(e) => setCardBack(e.target.value)}
                  placeholder="e.g. O(log n)"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)', resize: 'vertical' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Hint (Optional):</label>
                <input
                  type="text"
                  value={cardHint}
                  onChange={(e) => setCardHint(e.target.value)}
                  placeholder="e.g. Divides the search space in half each iteration"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewCardModal(false)} style={{ fontSize: 13 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isCreatingCard} style={{ fontSize: 13 }}>
                  {isCreatingCard ? 'Adding...' : 'Add Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: AI Flashcard Generator */}
      {showAiGenModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 460, width: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#9333ea" />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>AI Flashcard Generator</h3>
              </div>
              <button type="button" onClick={() => setShowAiGenModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {aiError && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: 12, marginBottom: 14 }}>
                {aiError}
              </div>
            )}

            <form onSubmit={handleGenerateAiDeck} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Course Code:</label>
                <input
                  type="text"
                  required
                  value={aiCourse}
                  onChange={(e) => setAiCourse(e.target.value.toUpperCase())}
                  placeholder="e.g. CSC 301, CHM 101, GST 111"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Topic / Exam Focus:</label>
                <input
                  type="text"
                  required
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="e.g. Sorting Algorithms, Thermodynamics, Nigerian Federalism"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Number of Cards:</label>
                <select
                  value={aiCount}
                  onChange={(e) => setAiCount(Number(e.target.value))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                >
                  <option value={5}>5 Flashcards</option>
                  <option value={8}>8 Flashcards (Recommended)</option>
                  <option value={12}>12 Flashcards</option>
                  <option value={15}>15 Flashcards</option>
                </select>
              </div>

              {!hasPremium && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(234, 179, 8, 0.1)', color: '#b45309', fontSize: 12 }}>
                  <Lock size={14} />
                  <span>Premium feature &middot; <Link to="/student/subscription" style={{ fontWeight: 700, textDecoration: 'underline' }}>Upgrade</Link></span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAiGenModal(false)} style={{ fontSize: 13 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isGeneratingAi} style={{ fontSize: 13 }}>
                  {isGeneratingAi ? <><Loader2 size={14} className="spin-icon" /> Generating Deck...</> : 'Generate Deck'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
