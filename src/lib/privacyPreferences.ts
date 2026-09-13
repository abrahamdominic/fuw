import type { AnalyticsPreferences } from './analyticsTypes';

const STORAGE_KEY = 'fuw_analytics_preferences_v1';

const DEFAULTS: AnalyticsPreferences = {
  analyticsEnabled: true,
  performanceDiagnosticsEnabled: true,
};

export function getAnalyticsPreferences(): AnalyticsPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AnalyticsPreferences>;
    return {
      analyticsEnabled:
        typeof parsed.analyticsEnabled === 'boolean'
          ? parsed.analyticsEnabled
          : DEFAULTS.analyticsEnabled,
      performanceDiagnosticsEnabled:
        typeof parsed.performanceDiagnosticsEnabled === 'boolean'
          ? parsed.performanceDiagnosticsEnabled
          : DEFAULTS.performanceDiagnosticsEnabled
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAnalyticsPreferences(next: Partial<AnalyticsPreferences>): AnalyticsPreferences {
  const current = getAnalyticsPreferences();
  const merged = { ...current, ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Storage unavailable (private mode / quota) — in-memory only.
  }
  return merged;
}

export function isAnalyticsEnabled(): boolean {
  return getAnalyticsPreferences().analyticsEnabled;
}

export function isPerformanceDiagnosticsEnabled(): boolean {
  return getAnalyticsPreferences().performanceDiagnosticsEnabled;
}