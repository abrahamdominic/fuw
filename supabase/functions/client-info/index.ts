// client-info — FUW E-Library security edge function.
//
// Returns accurate, server-observed network facts for the requesting client so
// the app can record real data (public IP address, approximate location and a
// derived device name) instead of making the client guess. These values are
// stored on `active_sessions` alongside the user id.
//
// Reads the connection metadata that the hosting edge runtime already supplies
// as HTTP headers (Supabase Functions flow through Cloudflare; Vercel-style
// infra exposes similar headers). No third-party lookup calls are made, so the
// edge function stays fast and dependency-free.
//
// Privacy notes:
//   * IMEI / MAC addresses are NOT exposed to web browsers by any Web API and
//     cannot appear here. The session row stores them as NULL for web clients
//     (columns exist for native/instrumented clients).
//   * Location is coarse (country / region / city when the runtime provides
//     them) — never a precise GPS coordinate.
import { corsFor, json } from '../_shared/ai.ts';

const X_FORWARDED_FOR = 'x-forwarded-for';
const CF_CONNECTING_IP = 'cf-connecting-ip';
const CF_IPCOUNTRY = 'cf-ipcountry';
const CF_IPREGION = 'cf-region';
const CF_IPCITY = 'cf-ipcity';
const CF_IPLATITUDE = 'cf-iplatitude';
const CF_IPLONGITUDE = 'cf-iplongitude';
const UA = 'user-agent';

function firstHeader(req: Request, name: string): string | null {
  const v = req.headers.get(name);
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function extractIp(req: Request): string | null {
  // Cloudflare provides the true client IP; prefer that over the chain.
  const cf = firstHeader(req, CF_CONNECTING_IP);
  if (cf) return cf;
  const chain = firstHeader(req, X_FORWARDED_FOR);
  if (chain) return chain.split(',')[0].trim() || null;
  return null;
}

function extractLocation(req: Request): {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: string | null;
  lon: string | null;
} {
  return {
    country: firstHeader(req, CF_IPCOUNTRY),
    region: firstHeader(req, CF_IPREGION),
    city: firstHeader(req, CF_IPCITY),
    lat: firstHeader(req, CF_IPLATITUDE),
    lon: firstHeader(req, CF_IPLONGITUDE)
  };
}

/** Human-readable device/platform name derived from the User-Agent header. */
function extractDeviceName(ua: string): string {
  let device = 'Computer';

  const lower = `${ua} `;
  if (/iPad/i.test(ua)) device = 'Apple iPad';
  else if (/iPhone/i.test(ua)) device = 'Apple iPhone';
  else if (/iPod/i.test(ua)) device = 'Apple iPod';
  else if (/Android/i.test(ua)) {
    const m = /Mobile Safari|Mobile/i;
    // Distinguish a phone from a tablet using the standard Android hints.
    const model =
      /; ([A-Za-z][A-Za-z0-9 _\-]{1,24})( Build\/|\b)/.exec(ua)?.[1] || null;
    device = /Mobile/i.test(ua) && !/Tablet/i.test(ua) ? 'Android Phone' : 'Android Tablet';
    if (model) device = `${device} (${model.trim()})`;
  } else if (/Windows/i.test(ua)) device = /ARM/i.test(ua) ? 'Windows on ARM' : 'Windows PC';
  else if (/Mac OS X|Macintosh/i.test(ua)) device = 'Apple Mac';
  else if (/Linux/i.test(ua)) device = 'Linux Device';
  else if (/CrOS/i.test(ua)) device = 'Chromebook';
  else if (/SmartTV|GoogleTV|Xbox|PlayStation/i.test(ua)) device = 'Smart TV / Console';

  if (/Edg\//i.test(lower)) device += ' · Edge';
  else if (/OPR\//i.test(lower)) device += ' · Opera';
  else if (/Chrome\//i.test(lower)) device += ' · Chrome';
  else if (/Firefox\//i.test(lower)) device += ' · Firefox';
  else if (/Safari\//i.test(lower)) device += ' · Safari';

  return device;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const ua = firstHeader(req, UA) ?? '';
  const location = extractLocation(req);

  const payload = {
    ip: extractIp(req),
    location: {
      country: location.country,
      region: location.region,
      city: location.city,
      latitude: location.lat,
      longitude: location.lon
    },
    device_name: ua ? extractDeviceName(ua) : null,
    user_agent: ua || null,
    // Web browsers cannot expose these; always null for browser clients.
    imei: null,
    mac_address: null,
    collected_at: new Date().toISOString()
  };

  return json(payload, 200, req);
});