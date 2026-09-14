import { supabase } from './supabase';
import type {
  AnalyticsEvent,
  AnalyticsSession,
  EventMetadata,
  PerformanceMetric
} from './analyticsTypes';

const STORAGE_KEY = 'fuw_analytics_queue_v1';

export const QUEUE_SIZE_LIMIT = 200;
export const BATCH_SIZE = 25;
export const MAX_ATTEMPTS = 10;
export const MIN_FLUSH_INTERVAL_MS = 10_000;

export type QueuedOperation =
  | { kind: 'event'; event: AnalyticsEvent }
  | { kind: 'performance'; metric: PerformanceMetric }
  | { kind: 'session_upsert'; session: AnalyticsSession }
  | { kind: 'session_end'; sessionKey: string; endedAt: string };

interface StoredOperation {
  op: QueuedOperation;
  attempts: number;
}

const NETWORK_FAILURE_PATTERNS = [
  'network',
  'fetch',
  'failed to fetch',
  'load failed',
  'timeout',
  'aborted',
  'enotfound',
  'econnreset',
  'econnrefused',
  'etimedout',
  'network error',
];

function isNetworkFailure(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return NETWORK_FAILURE_PATTERNS.some((p) => lower.includes(p));
}

function readQueue(): StoredOperation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredOperation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: StoredOperation[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Private mode/quota — the queue simply won't persist across reloads.
  }
}

function toErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export class AnalyticsQueue {
  private pending: StoredOperation[] = [];
  private flushing = false;
  private lastFlushAttempt = 0;

  constructor() {
    this.pending = readQueue();
  }

  enqueue(op: QueuedOperation): void {
    if (this.pending.length >= QUEUE_SIZE_LIMIT) {
      // Never let the buffer grow unbounded — drop the oldest op.
      this.pending.shift();
    }
    this.pending.push({ op, attempts: 0 });
    writeQueue(this.pending);
    void this.flush();
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending = [];
    writeQueue(this.pending);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.length === 0) return;
    const now = Date.now();
    if (now - this.lastFlushAttempt < MIN_FLUSH_INTERVAL_MS) return;
    this.lastFlushAttempt = now;
    this.flushing = true;

    const batch = this.pending.slice(0, BATCH_SIZE);
    const remaining: StoredOperation[] = this.pending.slice(BATCH_SIZE);

    try {
      for (const item of batch) {
        const outcome = await this.submitOne(item.op);
        if (outcome === 'submitted' || outcome === 'dropped') {
          // Success or permanent failure — consume the op.
        } else if (outcome === 'retry') {
          // Network failure: do NOT count an attempt so it stays fresh.
          remaining.unshift(item);
        } else {
          // 'counted' — transient server error; increment attempts and drop at cap.
          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            console.warn('[Analytics] Dropping op after max attempts:', item.op.kind);
          } else {
            remaining.unshift({ op: item.op, attempts });
          }
        }
      }
    } finally {
      this.pending = remaining;
      writeQueue(this.pending);
      this.flushing = false;
    }
  }

  private async submitOne(op: QueuedOperation): Promise<'submitted' | 'dropped' | 'retry' | 'counted'> {
    if (!supabase) return 'dropped';

    try {
        if (op.kind === 'event') {
        const { error } = await supabase
          .from('analytics_events')
          .upsert(
            {
              id: op.event.id,
              user_id: null,
              anonymous_id: op.event.anonymousId,
              session_id: op.event.sessionId,
              event_name: op.event.eventName,
              screen_name: op.event.screenName,
              event_metadata: op.event.eventMetadata as EventMetadata,
              platform: op.event.platform,
              app_version: op.event.appVersion,
              device_type: op.event.deviceType,
              os_version: op.event.osVersion,
              language: op.event.language,
              timezone: op.event.timezone,
              network_type: op.event.networkType,
              created_at: op.event.createdAt
            },
            { onConflict: 'id', ignoreDuplicates: true }
          );
        return this.classify(error ? `[${error.code}] ${error.message}` : '');
      }

      if (op.kind === 'performance') {
        const { error } = await supabase
          .from('performance_events')
          .upsert(
            {
              id: op.metric.id,
              user_id: null,
              session_id: op.metric.sessionId,
              metric_name: op.metric.metricName,
              metric_value: op.metric.metricValue,
              unit: op.metric.unit,
              app_version: op.metric.appVersion,
              platform: op.metric.platform,
              metadata: op.metric.metadata,
              created_at: op.metric.createdAt
            },
            { onConflict: 'id', ignoreDuplicates: true }
          );
        return this.classify(error ? `[${error.code}] ${error.message}` : '');
      }

      if (op.kind === 'session_upsert') {
        const { error } = await supabase
          .from('analytics_sessions')
          .upsert(
            {
              id: op.session.id,
              user_id: null,
              anonymous_id: op.session.anonymousId,
              session_key: op.session.sessionKey,
              started_at: op.session.startedAt,
              ended_at: op.session.endedAt,
              app_version: op.session.appVersion,
              build_number: op.session.buildNumber,
              platform: op.session.platform,
              device_type: op.session.deviceType,
              os_version: op.session.osVersion,
              language: op.session.language,
              timezone: op.session.timezone,
              network_type: op.session.networkType
            },
            { onConflict: 'session_key', ignoreDuplicates: true }
          );
        return this.classify(error ? `[${error.code}] ${error.message}` : '');
      }

      // session_end → end_analytics_session RPC (updates duration).
      const { error } = await supabase.rpc('end_analytics_session', {
        p_session_key: op.sessionKey,
        p_ended_at: op.endedAt
      });
      return this.classify(error ? `[${error.code}] ${error.message}` : '');
    } catch (err) {
      return this.classify(toErrorMessage(err));
    }
  }

  private classify(errorText: string): 'submitted' | 'dropped' | 'retry' | 'counted' {
    if (!errorText) return 'submitted';
    if (isNetworkFailure(errorText)) return 'retry';
    if (errorText.includes('42501')) {
      // RLS/permission — not going to succeed from this client; drop quietly.
      return 'dropped';
    }
    if (errorText.includes('42P01') || errorText.includes('does not exist')) {
      // Analytics tables not deployed yet — legitimate permanent failure.
      console.warn('[Analytics] Analytics tables missing (migration not applied):', errorText);
      return 'dropped';
    }
    if (errorText.includes('23503')) {
      // FK violation — the referenced analytics_sessions row does not exist
      // (e.g. an event queued by an old build whose session_id was orphaned).
      // It can never resolve client-side, so stop retrying it quietly.
      return 'dropped';
    }
    return 'counted';
  }
}

/**
 * Shared queue singleton. Analytics are intentionally anonymous — user_id is
 * always NULL, so there is no per-user attribution to wire up.
 */
export const analyticsQueue = new AnalyticsQueue();