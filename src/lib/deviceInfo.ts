/**
 * Browser-based device/technical info for analytics.
 *
 * Privacy rule: we never read the public IP, IMEI/MAC, camera identifiers or
 * precise location. Only the fields below (all coarse-grained) are collected.
 */

export interface WebDeviceInfo {
  platform: string;
  osVersion: string | null;
  deviceType: 'Phone' | 'Tablet' | 'Desktop' | 'TV' | 'Unknown';
  appVersion: string;
  buildNumber: string;
  language: string;
  timezone: string;
  networkType: string | null;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
}

const APP_VERSION = 'web-1.0.0';

let networkCache: string | null = null;
let networkCachedAt = 0;
let batteryCache: { level: number | null; charging: boolean | null } = {
  level: null,
  charging: null
};

function userAgent(): string {
  try {
    return navigator.userAgent || '';
  } catch {
    return '';
  }
}

function parsePlatform(): { platform: string; osVersion: string | null } {
  const ua = userAgent();
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const ver = /OS (\d+[._]\d+)/i.exec(ua);
    return {
      platform: /iPad/i.test(ua) ? 'iOS (iPad)' : 'iOS',
      osVersion: ver ? ver[1].replace('_', '.') : null
    };
  }
  if (/Android/i.test(ua)) {
    const ver = /Android (\d+(\.\d+)?)/i.exec(ua);
    return { platform: 'Android', osVersion: ver ? ver[1] : null };
  }
  if (/Mac OS X|Macintosh/i.test(ua)) {
    const ver = /Mac OS X (\d+[._]\d+)/i.exec(ua);
    return { platform: 'macOS', osVersion: ver ? ver[1].replace('_', '.') : null };
  }
  if (/Windows/i.test(ua)) {
    const ver = /Windows NT (\d+(\.\d+)?)/i.exec(ua);
    const map: Record<string, string> = {
      '11.0': '11',
      '10.0': '10',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7'
    };
    return { platform: 'Windows', osVersion: ver ? map[ver[1]] ?? ver[1] : null };
  }
  if (/Linux/i.test(ua)) return { platform: 'Linux', osVersion: null };
  return { platform: 'Web', osVersion: null };
}

export function detectDeviceType(): WebDeviceInfo['deviceType'] {
  const ua = userAgent();
  const hasTouch = typeof navigator !== 'undefined' && 'maxTouchPoints' in navigator && navigator.maxTouchPoints > 0;
  const isTablet =
    /iPad/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
    (/Tablet|SILK|PlayBook/i.test(ua));
  if (isTablet) return 'Tablet';
  if (/Android|iPhone|iPod|BlackBerry|Opera Mini|IEMobile|Mobile/i.test(ua)) {
    return hasTouch ? 'Phone' : 'Phone';
  }
  if (/SmartTV|TV\sBrowser|Xbox|PlayStation|GoogleTV/i.test(ua)) return 'TV';
  return 'Desktop';
}

function getNetworkType(): string | null {
  const now = Date.now();
  if (networkCache && now - networkCachedAt < 30_000) return networkCache;
  try {
    const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } })
      .connection;
    networkCache = conn?.type || conn?.effectiveType || null;
    networkCachedAt = now;
  } catch {
    networkCache = null;
  }
  return networkCache;
}

/** Best-effort battery read (Chromium only). Cached after first success. */
export async function warmBattery(): Promise<void> {
  try {
    const b = await (navigator as unknown as {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    }).getBattery?.();
    if (b) {
      batteryCache = { level: b.level, charging: b.charging };
    }
  } catch {
    // Battery API unavailable or blocked — leave defaults.
  }
}

export function getStaticDeviceInfo(): WebDeviceInfo {
  const { platform, osVersion } = parsePlatform();
  let language = 'unknown';
  try {
    language = navigator.language || (navigator.languages && navigator.languages[0]) || 'unknown';
  } catch {}
  let timezone = 'unknown';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {}

  return {
    platform,
    osVersion,
    deviceType: detectDeviceType(),
    appVersion: APP_VERSION,
    buildNumber: 'web',
    language,
    timezone,
    networkType: getNetworkType(),
    batteryLevel: batteryCache.level,
    batteryCharging: batteryCache.charging
  };
}