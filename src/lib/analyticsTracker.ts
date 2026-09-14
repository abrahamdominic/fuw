import type {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsSession,
  EventMetadata,
  PerformanceMetric
} from './analyticsTypes';
import { getStaticDeviceInfo, warmBattery } from './deviceInfo';
import { analyticsQueue } from './analyticsQueue';
import {
  isAnalyticsEnabled,
  isPerformanceDiagnosticsEnabled
} from './privacyPreferences';

const ANON_ID_KEY = 'fuw_anonymous_id_v1';
const SCREEN_FLUSH_THROTTLE_MS = 1_000;
const FLUSH_TIMER_MS = 20_000;

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `xxxx-xxxx-xxxx-xxxx`.replace(/x/g, () =>
    ((Math.random() * 36) | 0).toString(36)
  );
}

let currentScreen: string | null = null;
let currentSessionId: string | null = null;
let currentSessionKey: string | null = null;
let sessionRegistered = false;
let lastScreenNameSent = '';
let lastScreenSentAt = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function anonymousId(): string {
  try {
    const existing = window.localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
  } catch {}
  const id = newId();
  try {
    window.localStorage.setItem(ANON_ID_KEY, id);
  } catch {}
  return id;
}

function sessionId(): string {
  if (currentSessionId) return currentSessionId;
  ensureSessionRegistered();
  return currentSessionId ?? '';
}

/**
 * Registers the foreground session exactly once per active cycle. Ids are
 * reused if any event already generated them eagerly so every event's
 * session_id always resolves to the analytics_sessions row upserted here —
 * otherwise the FK rejects the batch (23503) and the op is dropped after
 * MAX_ATTEMPTS retries.
 */
function ensureSessionRegistered(): void {
  if (sessionRegistered) return;
  sessionRegistered = true;
  if (!currentSessionId) currentSessionId = newId();
  if (!currentSessionKey) currentSessionKey = newId();

  const info = getStaticDeviceInfo();
  const session: AnalyticsSession = {
    id: currentSessionId,
    userId: null,
    anonymousId: anonymousId(),
    sessionKey: currentSessionKey,
    startedAt: new Date().toISOString(),
    endedAt: null,
    appVersion: info.appVersion,
    buildNumber: info.buildNumber,
    platform: info.platform,
    deviceType: info.deviceType,
    osVersion: info.osVersion,
    language: info.language,
    timezone: info.timezone,
    networkType: info.networkType
  };
  analyticsQueue.enqueue({ kind: 'session_upsert', session });
  trackEvent('session_start');
}

function buildBase(): Pick<
  AnalyticsEvent,
  | 'anonymousId'
  | 'platform'
  | 'appVersion'
  | 'buildNumber'
  | 'deviceType'
  | 'osVersion'
  | 'language'
  | 'timezone'
  | 'networkType'
> {
  const info = getStaticDeviceInfo();
  return {
    anonymousId: anonymousId(),
    platform: info.platform,
    appVersion: info.appVersion,
    buildNumber: info.buildNumber,
    deviceType: info.deviceType,
    osVersion: info.osVersion,
    language: info.language,
    timezone: info.timezone,
    networkType: info.networkType
  };
}

function trackEvent(
  name: AnalyticsEventName,
  screen?: string | null,
  metadata?: EventMetadata
): void {
  if (!isAnalyticsEnabled() && name !== 'error_occurred') return;

  const event: AnalyticsEvent = {
    id: newId(),
    userId: null,
    sessionId: sessionId(),
    eventName: name,
    screenName: screen ?? currentScreen,
    eventMetadata: metadata ?? {},
    ...buildBase(),
    createdAt: new Date().toISOString()
  };

  analyticsQueue.enqueue({ kind: 'event', event });
}

function trackPerformance(
  metricName: string,
  metricValue: number | null,
  unit = 'ms',
  metadata?: EventMetadata
): void {
  if (!isPerformanceDiagnosticsEnabled()) return;

  const metric: PerformanceMetric = {
    id: newId(),
    userId: null,
    sessionId: sessionId(),
    metricName,
    metricValue,
    unit,
    appVersion: getStaticDeviceInfo().appVersion,
    platform: getStaticDeviceInfo().platform,
    metadata: metadata ?? {},
    createdAt: new Date().toISOString()
  };

  analyticsQueue.enqueue({ kind: 'performance', metric });
}
export const analyticsTracker = {
  /**
   * Analytics are anonymous: the `userId` parameter is intentionally ignored.
   * Attribution uses the installation-scoped anonymous_id only.
   */
  init(_userId: string | null): void {
    void warmBattery();

    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(() => {
      void analyticsQueue.flush();
    }, FLUSH_TIMER_MS);
  },

  /** Ignored — analytics are anonymous and never attributed to a user. */
  setUserId(_userId: string | null): void {
    // Kept for API compatibility; user_id is always NULL in the data model.
  },

  setScreenName(name: string): void {
    currentScreen = name;
  },

  trackEvent,

  trackPerformance,

  trackMaterialView(materialId: string, materialTitle?: string, materialType?: string): void {
    trackEvent('material_view', currentScreen, {
      material_id: materialId,
      material_title: materialTitle ?? null,
      material_type: materialType ?? null
    });
  },

  trackMaterialDownload(materialId: string, materialTitle?: string): void {
    trackEvent('material_download', currentScreen, {
      material_id: materialId,
      material_title: materialTitle ?? null
    });
  },

  trackMaterialSearch(query: string, resultCount?: number, metadata?: EventMetadata): void {
    trackEvent('material_search', 'library', {
      query_length: query.length,
      result_count: resultCount ?? 0,
      ...metadata
    });
  },

  trackSearchResultClick(materialId: string): void {
    trackEvent('search_result_click', 'library', {
      material_id: materialId
    });
  },

  trackBookmarkToggle(materialId: string, added: boolean): void {
    trackEvent(added ? 'bookmark_add' : 'bookmark_remove', currentScreen, {
      material_id: materialId
    });
  },

  /**
   * Auth-flow helper is kept for API compatibility — the user id argument is
   * ignored because analytics are anonymous.
   */
  trackAuthEvent(
    name: 'login' | 'logout' | 'registration',
    _userId: string | null,
    metadata?: EventMetadata
  ): void {
    trackEvent(name, undefined, metadata);
  },

  trackError(error: unknown, screen?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'unknown';
    trackEvent('error_occurred', screen ?? currentScreen, {
      error_message: message.slice(0, 200),
      error_name: errorName
    });
  },

  onAppOpen(): void {
    // Register the session FIRST so app_open's session_id is never orphaned.
    ensureSessionRegistered();
    trackEvent('app_open');
  },

  onAppBackground(): void {
    trackEvent('app_background');
    void analyticsQueue.flush();
  },

  onAppClose(): void {
    trackEvent('app_close');
    analyticsTracker.onSessionEnd();
    void analyticsQueue.flush();
  },

  onScreenView(screenName: string): void {
    const now = Date.now();
    if (screenName === lastScreenNameSent && now - lastScreenSentAt < SCREEN_FLUSH_THROTTLE_MS) {
      return;
    }
    lastScreenNameSent = screenName;
    lastScreenSentAt = now;

    currentScreen = screenName;
    trackEvent('screen_view', screenName);
  },

  onSessionStart(): void {
    ensureSessionRegistered();
    void analyticsQueue.flush();
  },

  onSessionEnd(): void {
    if (!sessionRegistered) return;
    analyticsQueue.enqueue({
      kind: 'session_end',
      sessionKey: currentSessionKey ?? '',
      endedAt: new Date().toISOString()
    });
    trackEvent('session_end');
    currentSessionKey = null;
    currentSessionId = null;
    sessionRegistered = false;
  },

  async shutdown(): Promise<void> {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    await analyticsQueue.flush();
  }
};

export default analyticsTracker;