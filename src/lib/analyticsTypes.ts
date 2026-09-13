/** Client-side analytics — shared types (mirrors the mobile app schema). */

export type AnalyticsEventName =
  | 'app_open'
  | 'app_background'
  | 'app_close'
  | 'login'
  | 'logout'
  | 'registration'
  | 'session_start'
  | 'session_end'
  | 'screen_view'
  | 'material_view'
  | 'material_download'
  | 'material_search'
  | 'search_result_click'
  | 'bookmark_add'
  | 'bookmark_remove'
  | 'article_view'
  | 'resource_view'
  | 'profile_view'
  | 'notification_open'
  | 'error_occurred'
  | 'app_update';

export interface EventMetadata {
  [key: string]: string | number | boolean | null;
}

export interface AnalyticsEvent {
  id: string;
  userId: string | null;
  anonymousId: string;
  sessionId: string;
  eventName: AnalyticsEventName;
  screenName: string | null;
  eventMetadata: EventMetadata;
  platform: string | null;
  appVersion: string | null;
  buildNumber: string | null;
  deviceType: string | null;
  osVersion: string | null;
  language: string | null;
  timezone: string | null;
  networkType: string | null;
  createdAt: string;
}

export interface AnalyticsSession {
  id: string;
  userId: string | null;
  anonymousId: string;
  sessionKey: string;
  startedAt: string;
  endedAt: string | null;
  appVersion: string | null;
  buildNumber: string | null;
  platform: string | null;
  deviceType: string | null;
  osVersion: string | null;
  language: string | null;
  timezone: string | null;
  networkType: string | null;
}

export interface PerformanceMetric {
  id: string;
  userId: string | null;
  sessionId: string | null;
  metricName: string;
  metricValue: number | null;
  unit: string;
  appVersion: string | null;
  platform: string | null;
  metadata: EventMetadata;
  createdAt: string;
}

export interface AnalyticsPreferences {
  analyticsEnabled: boolean;
  performanceDiagnosticsEnabled: boolean;
}

/** Aggregates produced by the admin `get_analytics_dashboard` RPC (jsonb). */
export interface AnalyticsDashboard {
  total_sessions: number;
  total_events: number;
  daily_active_users: number;
  weekly_active_users: number;
  monthly_active_users: number;
  avg_session_duration_seconds: number;
  most_used_screens: { screen: string; count: number }[];
  platform_distribution: { platform: string; count: number }[];
  app_version_distribution: { version: string; count: number }[];
  device_type_distribution: { device_type: string; count: number }[];
  network_type_distribution: { network: string; count: number }[];
  country_distribution: { country: string; count: number }[];
  searches_last_7d: number;
  errors_last_7d: number;
}

export interface TopMaterialRow {
  material_id: string;
  material_title: string;
  material_type: string;
  views: number;
  downloads: number;
}

export interface RecentAnalyticsEventRow {
  id: string;
  user_id: string | null;
  event_name: string;
  screen_name: string | null;
  event_metadata: object;
  platform: string | null;
  app_version: string | null;
  created_at: string;
}