import { requireSupabase } from './supabase';

const BUCKET = 'campus-media';

/**
 * Scopes accepted by public.guard_campus_media_upload(). The database is the
 * authority; this list exists so the UI can only offer paths that will pass.
 */
export const CAMPUS_MEDIA_SCOPES = [
  'events',
  'organizations',
  'lost-found',
  'assignments',
  'learning'
] as const;

export type CampusMediaScope = (typeof CAMPUS_MEDIA_SCOPES)[number];

/** Must stay in lockstep with the bucket's file_size_limit. */
export const CAMPUS_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

const ACCEPTED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
] as const;

export type CampusMediaContentType = (typeof ACCEPTED_CONTENT_TYPES)[number];

const EXTENSION_FOR_TYPE: Record<CampusMediaContentType, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf']
};

export const CAMPUS_MEDIA_ACCEPT_ATTRIBUTE = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf'
].join(',');

/**
 * The storage guard only ever sees the *declared* MIME type, because that is
 * what the Storage API records in object metadata. ff.md 19 is explicit that a
 * client-declared type must never be sufficient, so the browser checks the real
 * leading bytes before we send anything. A renamed executable is caught here
 * instead of being stored as a "PNG".
 */
function sniffContentType(bytes: Uint8Array): CampusMediaContentType | '' {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  const asciiAt = (offset: number, text: string) =>
    text.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0));

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (asciiAt(0, 'RIFF') && asciiAt(8, 'WEBP')) return 'image/webp';
  if (asciiAt(0, '%PDF-')) return 'application/pdf';
  return '';
}

export interface ValidatedCampusMedia {
  file: File;
  contentType: CampusMediaContentType;
  extension: string;
}

/**
 * Mirrors guard_campus_media_upload() so callers get an immediate, specific
 * error instead of a round trip. The trigger re-checks all of this server-side;
 * passing here is necessary but never sufficient.
 */
export async function validateCampusMediaFile(file: File): Promise<ValidatedCampusMedia> {
  const declared = String(file.type ?? '').toLowerCase();
  const extension = file.name.includes('.')
    ? file.name.split('.').pop()!.toLowerCase()
    : '';

  if (file.size <= 0) {
    throw new Error('That file is empty. Choose a file with actual content.');
  }
  if (file.size > CAMPUS_MEDIA_MAX_BYTES) {
    throw new Error(
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB: compress it or upload a smaller file.`
    );
  }
  if (!ACCEPTED_CONTENT_TYPES.includes(declared as CampusMediaContentType)) {
    throw new Error('Campus media must be a JPG, PNG, WebP or PDF.');
  }
  if (!EXTENSION_FOR_TYPE[declared as CampusMediaContentType].includes(extension)) {
    throw new Error(
      `The file extension ".${extension || 'none'}" does not match its ${declared} content type. Rename it so the two agree.`
    );
  }

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const actual = sniffContentType(header);
  if (!actual) {
    throw new Error('That file could not be identified. Only JPG, PNG, WebP and PDF are accepted.');
  }
  if (actual !== declared) {
    throw new Error(
      `That file is really ${actual}, not ${declared}. Rename or re-export it so the extension is honest.`
    );
  }

  return { file, contentType: declared as CampusMediaContentType, extension };
}

function buildObjectPath(scope: CampusMediaScope, ownerId: string, fileName: string): string {
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-80);
  return `${scope}/${ownerId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
}

/**
 * Uploads to the private campus-media bucket at <scope>/<owner>/<file>, which
 * is the only shape the guard accepts. No public URL is ever produced here: the
 * bucket is private and files are read back through short-lived signed URLs.
 */
export async function uploadCampusMedia(
  file: File,
  scope: CampusMediaScope
): Promise<string> {
  if (!CAMPUS_MEDIA_SCOPES.includes(scope)) {
    throw new Error(`Unknown campus media scope "${scope}".`);
  }
  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to upload a file.');

  const validated = await validateCampusMediaFile(file);
  const path = buildObjectPath(scope, user.id, validated.file.name);

  const { error } = await client.storage.from(BUCKET).upload(path, validated.file, {
    contentType: validated.contentType,
    upsert: false
  });

  if (error) {
    // P0001 is what the guard raises; surface its message rather than a generic
    // "upload failed" so a mismatch is debuggable.
    const detail = error.message || 'File upload failed.';
    if (/row-level security|not permitted|allowed set|out of range|upload path|unknown upload scope/i.test(detail)) {
      throw new Error(`Upload rejected by campus media rules: ${detail}`);
    }
    throw new Error(detail);
  }
  return path;
}

/** Best-effort cleanup; never throws, matching the other delete helpers. */
export async function removeCampusMedia(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await requireSupabase().storage.from(BUCKET).remove([path]).catch(() => {});
}

const SIGNED_URL_TTL_SECONDS = 300;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Returns a short-lived signed URL, or '' when the current user may not read
 * the object. '' is a normal outcome, not an error: lost-found and assignment
 * media is owner-or-admin only, so a signed URL legitimately refuses for
 * everyone else.
 */
export async function getCampusMediaUrl(path: string | null | undefined): Promise<string> {
  if (!path) return '';
  const cached = signedUrlCache.get(path);
  if (cached && Date.now() < cached.expiresAt) return cached.url;
  try {
    const { data, error } = await requireSupabase()
      .storage.from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return '';
    signedUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 30) * 1000
    });
    return data.signedUrl;
  } catch {
    return '';
  }
}

/** Called on sign-out, alongside clearSignedUrlCache(). */
export function clearCampusMediaUrlCache(): void {
  signedUrlCache.clear();
}

/**
 * Removes a media path from its owning row. Used when a student swaps or drops
 * a file so the old object does not linger in the bucket.
 */
export async function clearListingMedia(
  module: 'events' | 'organizations' | 'lost-found',
  table: string,
  id: string,
  column: string
): Promise<void> {
  await requireSupabase().from(table).update({ [column]: null }).eq('id', id);
}
