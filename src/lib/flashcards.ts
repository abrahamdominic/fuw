import { supabase, requireSupabase } from './supabase';
import { aiAsk } from './ai';
import { logUserActivity } from './activity';

export interface FlashcardDeck {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  course_code?: string | null;
  topic?: string | null;
  is_favorite: boolean;
  card_count: number;
  created_at: string;
  updated_at: string;
}

export interface Flashcard {
  id: string;
  deck_id: string;
  user_id: string;
  front: string;
  back: string;
  hint?: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  repetitions: number;
  interval_days: number;
  ease_factor: number;
  next_review_at: string;
  last_reviewed_at?: string | null;
  created_at: string;
}

export async function fetchFlashcardDecks(): Promise<FlashcardDeck[]> {
  if (!supabase) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from('flashcard_decks')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Failed to load flashcard decks:', error);
    return [];
  }
  return (data || []) as FlashcardDeck[];
}

export async function createFlashcardDeck(input: {
  title: string;
  courseCode?: string;
  topic?: string;
  description?: string;
}): Promise<FlashcardDeck> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Authentication required');

  const { data, error } = await client
    .from('flashcard_decks')
    .insert({
      user_id: user.id,
      title: input.title.trim(),
      course_code: input.courseCode ? input.courseCode.trim().toUpperCase() : null,
      topic: input.topic ? input.topic.trim() : null,
      description: input.description ? input.description.trim() : null
    })
    .select()
    .single();

  if (error) throw error;
  return data as FlashcardDeck;
}

export async function deleteFlashcardDeck(deckId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('flashcard_decks')
    .delete()
    .eq('id', deckId);
  if (error) throw error;
}

export async function fetchCardsForDeck(deckId: string): Promise<Flashcard[]> {
  if (!supabase) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from('flashcards')
    .select('*')
    .eq('deck_id', deckId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Failed to load flashcards:', error);
    return [];
  }
  return (data || []) as Flashcard[];
}

export async function createFlashcard(input: {
  deckId: string;
  front: string;
  back: string;
  hint?: string;
}): Promise<Flashcard> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Authentication required');

  const { data, error } = await client
    .from('flashcards')
    .insert({
      deck_id: input.deckId,
      user_id: user.id,
      front: input.front.trim(),
      back: input.back.trim(),
      hint: input.hint ? input.hint.trim() : null,
      interval_days: 1,
      ease_factor: 2.5,
      repetitions: 0
    })
    .select()
    .single();

  if (error) throw error;

  // Increment deck card count
  const { count } = await client
    .from('flashcards')
    .select('id', { count: 'exact', head: true })
    .eq('deck_id', input.deckId);

  if (count !== null) {
    await client
      .from('flashcard_decks')
      .update({ card_count: count, updated_at: new Date().toISOString() })
      .eq('id', input.deckId);
  }

  return data as Flashcard;
}

export async function deleteFlashcard(cardId: string, deckId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('flashcards')
    .delete()
    .eq('id', cardId);
  if (error) throw error;

  // Update deck count
  const { count } = await client
    .from('flashcards')
    .select('id', { count: 'exact', head: true })
    .eq('deck_id', deckId);

  if (count !== null) {
    await client
      .from('flashcard_decks')
      .update({ card_count: count, updated_at: new Date().toISOString() })
      .eq('id', deckId);
  }
}

/**
 * SM-2 Spaced Repetition Algorithm review step.
 * Rating:
 * - 'again' (Score 1): Fail/Reset
 * - 'hard'  (Score 3): Hard review (1 day interval)
 * - 'good'  (Score 4): Standard spacing
 * - 'easy'  (Score 5): Bonus interval
 */
export async function reviewFlashcard(
  card: Flashcard,
  rating: 'again' | 'hard' | 'good' | 'easy'
): Promise<Flashcard> {
  const client = requireSupabase();

  let rep = card.repetitions;
  let interval = card.interval_days;
  let ef = Number(card.ease_factor) || 2.5;

  if (rating === 'again') {
    rep = 0;
    interval = 1;
    ef = Math.max(1.3, ef - 0.2);
  } else if (rating === 'hard') {
    rep += 1;
    interval = Math.max(1, Math.round(interval * 1.2));
    ef = Math.max(1.3, ef - 0.15);
  } else if (rating === 'good') {
    if (rep === 0) interval = 1;
    else if (rep === 1) interval = 3;
    else interval = Math.round(interval * ef);
    rep += 1;
  } else if (rating === 'easy') {
    if (rep === 0) interval = 2;
    else if (rep === 1) interval = 6;
    else interval = Math.round(interval * ef * 1.3);
    rep += 1;
    ef = ef + 0.15;
  }

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  const { data, error } = await client
    .from('flashcards')
    .update({
      repetitions: rep,
      interval_days: interval,
      ease_factor: Number(ef.toFixed(2)),
      next_review_at: nextReview.toISOString(),
      last_reviewed_at: new Date().toISOString(),
      difficulty: rating === 'again' || rating === 'hard' ? 'hard' : rating === 'easy' ? 'easy' : 'medium'
    })
    .eq('id', card.id)
    .select()
    .single();

  if (error) throw error;

  // Log activity
  logUserActivity({
    activityType: 'flashcard_reviewed',
    entityType: 'flashcard',
    entityId: card.id,
    entityTitle: `Flashcard reviewed (${rating.toUpperCase()}): ${card.front.slice(0, 30)}...`,
    metadata: { deckId: card.deck_id, repetitions: rep, intervalDays: interval }
  }).catch(() => {});

  return data as Flashcard;
}

/**
 * AI-generated flashcards from course topic or lecture note text.
 */
export async function generateAiFlashcards(input: {
  courseCode: string;
  topic: string;
  notesText?: string;
  count?: number;
}): Promise<{ front: string; back: string; hint: string }[]> {
  const cardCount = input.count || 8;
  const prompt = `Generate exactly ${cardCount} high-yield university flashcards for course "${input.courseCode}" on the topic "${input.topic}".
${input.notesText ? `Reference lecture notes:\n${input.notesText}` : ''}

Format each flashcard strictly as follows:
---
FRONT: [Clear, specific question, formula, or concept test]
BACK: [Concise, accurate answer or definition]
HINT: [Brief mnemonic or clue]
---`;

  const res = await aiAsk({
    message: prompt,
    mode: 'exam'
  });

  const cards: { front: string; back: string; hint: string }[] = [];
  const rawCards = res.answer.split('---');

  for (const block of rawCards) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const frontMatch = trimmed.match(/FRONT:\s*(.+?)(?=(BACK:|$))/is);
    const backMatch = trimmed.match(/BACK:\s*(.+?)(?=(HINT:|$))/is);
    const hintMatch = trimmed.match(/HINT:\s*(.+)/is);

    if (frontMatch && backMatch) {
      cards.push({
        front: frontMatch[1].trim(),
        back: backMatch[1].trim(),
        hint: hintMatch ? hintMatch[1].trim() : ''
      });
    }
  }

  return cards;
}
