// Client wrappers for the FUW AI Edge Functions (ai-chat, ai-search, ai-process).
// The API key never reaches the browser — all provider calls happen server-side.
import { supabase } from './supabase';

export interface AiCitation {
  material_id: string;
  title: string;
  page: number | null;
  similarity: number;
}

export interface AiChatResponse {
  conversationId: string;
  answer: string;
  citations: AiCitation[];
  usedContext: boolean;
}

export interface AiSearchFilters {
  department?: string;
  level?: string;
  courseCode?: string;
}

export interface AiSearchResult {
  id: string;
  title: string;
  description: string;
  faculty: string;
  department: string;
  level: string;
  course_code: string;
  course_title: string | null;
  semester: string;
  material_type: string;
  file_url: string;
  file_name: string;
  relevance: number;
  matchedSnippet: string;
  matchedPage: number | null;
}

interface EdgeError {
  error?: string;
  message?: string;
}

async function invoke<T>(fnName: string, body: unknown): Promise<T> {
  if (!supabase) {
    throw Object.assign(new Error('Supabase is not configured.'), { code: 'NOT_CONFIGURED' });
  }
  const { data, error } = await supabase.functions.invoke(fnName, {
    body: body as Record<string, unknown>
  });
  if (error) {
    // supabase-js surfaces HTTP errors as FunctionsHttpError with context.
    const anyErr = error as any;
    let payload: EdgeError = {};
    const ctx = anyErr?.context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        payload = await ctx.clone().json();
      } catch {
        try {
          payload = await ctx.json();
        } catch {
          payload = {};
        }
      }
    }
    const code = payload.error ?? (typeof anyErr?.message === 'string' ? 'EDGE_ERROR' : 'UNKNOWN');
    throw Object.assign(new Error(payload.message || friendlyMessage(code)), { code });
  }
  return data as T;
}

function friendlyMessage(code: string): string {
  switch (code) {
    case 'AI_NOT_CONFIGURED':
      return 'Sorry, the AI Assistant is temporarily unavailable. Please try again later.';
    case 'RATE_LIMITED':
      return 'You have reached your hourly AI limit. Please try again later.';
    case 'Authentication required':
    case 'AUTH_REQUIRED':
      return 'Please sign in to use the AI assistant.';
    default:
      return 'The AI service is temporarily unavailable. Please try again shortly.';
  }
}

/** Ask the study assistant a question (RAG over approved materials). */
export function aiAsk(input: {
  message: string;
  conversationId?: string | null;
  materialId?: string | null;
  /** Explicitly detach the current conversation from its material scope. */
  clearScope?: boolean;
  /** Learning mode hint ('explainer' | 'exam' | 'summary' | 'quiz'). */
  mode?: 'explainer' | 'exam' | 'summary' | 'quiz';
  filters?: AiSearchFilters;
}): Promise<AiChatResponse> {
  return invoke<AiChatResponse>('ai-chat', input);
}

/** Semantic search across indexed library materials. */
export function aiSearch(
  query: string,
  filters?: AiSearchFilters,
  limit = 8
): Promise<{ results: AiSearchResult[] }> {
  return invoke<{ results: AiSearchResult[] }>('ai-search', { query, filters, limit });
}

/** Admin-only: run the embedding pipeline for one material. */
export function aiProcessMaterial(materialId: string): Promise<{ status: string; chunks?: number; error?: string }> {
  return invoke('ai-process', { materialId });
}

export function aiConfiguredHint(err: unknown): boolean {
  return (err as any)?.code === 'AI_NOT_CONFIGURED';
}
