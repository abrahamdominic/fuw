import type { SyntheticEvent } from 'react';
import { supabase, requireSupabase } from './supabase';

export interface AccommodationProperty {
  id: string;
  provider_id?: string | null;
  title: string;
  slug: string;
  description: string;
  location_area: 'New Site' | 'Old Site' | 'Hospital Road' | 'Stadium Road' | 'General Hospital Area' | 'Katsina-Ala Road' | 'Campus Environs' | 'Wukari Town';
  address_landmark: string;
  distance_to_campus?: string | null;
  property_type: 'self_contained' | 'single_room' | 'flat_apartment' | 'bedspace' | 'shared_room';
  price_annual: number;
  price_semester?: number | null;
  caution_deposit: number;
  service_charge: number;
  total_units: number;
  available_units: number;
  availability_status: 'available' | 'fast_filling' | 'booked' | 'under_maintenance';
  images: string[];
  amenities: string[];
  rules_notes?: string | null;
  contact_phone: string;
  contact_whatsapp?: string | null;
  is_verified: boolean;
  is_featured: boolean;
  is_published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface AccommodationReview {
  id: string;
  property_id: string;
  user_id: string;
  rating: number;
  review_text: string;
  created_at: string;
}

export interface AccommodationReport {
  id?: string;
  property_id: string;
  reporter_id?: string | null;
  reason: 'scam_suspected' | 'fake_photos' | 'fake_caretaker' | 'already_booked' | 'price_gouging' | 'unreachable' | 'harassment' | 'other';
  details: string;
  status?: string;
  created_at?: string;
}

export interface AccommodationFilters {
  query?: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  minUnitsAvailable?: number;
  availabilityStatus?: string;
  propertyType?: string;
  amenity?: string;
}

export const ACCOMMODATION_LOCATIONS = [
  'All Locations',
  'New Site',
  'Old Site',
  'Hospital Road',
  'Stadium Road',
  'General Hospital Area',
  'Katsina-Ala Road',
  'Campus Environs',
  'Wukari Town'
] as const;

export const PROPERTY_TYPES = [
  { value: 'all', label: 'All Room Types' },
  { value: 'self_contained', label: 'Self-Contained' },
  { value: 'single_room', label: 'Single Room' },
  { value: 'flat_apartment', label: 'Flat / Apartment' },
  { value: 'bedspace', label: 'Bed Space' },
  { value: 'shared_room', label: 'Shared Room' }
] as const;

export const POPULAR_AMENITIES = [
  'Running Water',
  'Prepaid Meter / Light',
  'Fenced & Gated',
  'Security Guard',
  'Well Water / Borehole',
  'Tiled Floors',
  'Wardrobe',
  'Kitchenette / Kitchen',
  'Inverter / Solar Friendly',
  'Balcony'
] as const;

export function formatNaira(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0
  }).format(amount);
}

export function getPropertyTypeLabel(type: string): string {
  const match = PROPERTY_TYPES.find((t) => t.value === type);
  return match ? match.label : type.replace(/_/g, ' ');
}

export interface AvailabilityBadge {
  background: string;
  color: string;
  label: string;
}

/**
 * The single source of truth for how an availability status is presented.
 *
 * All four stored states are distinguishable. The listing grid and the detail
 * header both render this, so a lodge that is out of service is never
 * described as merely "booked" on one page and "under maintenance" on another.
 */
export function getAvailabilityBadge(status: string): AvailabilityBadge {
  switch (status) {
    case 'available':
      return { background: 'var(--success-bg)', color: '#047857', label: 'Available' };
    case 'fast_filling':
      return { background: 'var(--warning-bg)', color: 'var(--amber-700)', label: 'Fast Filling' };
    case 'under_maintenance':
      return { background: 'var(--surface-alt)', color: 'var(--text-secondary)', label: 'Under Maintenance' };
    case 'booked':
      return { background: 'var(--error-bg)', color: 'var(--red-700)', label: 'Fully Booked' };
    default:
      return { background: 'var(--surface-alt)', color: 'var(--text-secondary)', label: 'Unavailable' };
  }
}

/* -------------------------------------------------------------------------- */
/* Listing photography                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Placeholder shown only when a listing has no photograph left to show.
 *
 * It is a data URI rather than a file on the static host so it can never 404,
 * be missing from the asset pipeline, or be blocked by a content-policy that
 * only allows same-origin files. It is a deliberate, branded "photo coming
 * soon" card rather than a blank rectangle, so a missing photo still reads as
 * a working page instead of a broken one.
 */
const FALLBACK_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500" role="img" aria-label="Photo coming soon">',
  '<rect width="800" height="500" fill="#eef5f0"/>',
  '<g fill="none" stroke="#12603d" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="0.72">',
  '<path d="M330 330V252l70-52 70 52v78z"/>',
  '<rect x="372" y="286" width="30" height="30" rx="3"/>',
  '<path d="M262 330h-34v-92l58-44"/>',
  '</g>',
  '<text x="400" y="400" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#12603d">FUW Accommodation</text>',
  '<text x="400" y="434" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" fill="#4b6a58">Photo coming soon</text>',
  '</svg>'
].join('');

export const ACCOMMODATION_FALLBACK_IMAGE = `data:image/svg+xml,${encodeURIComponent(FALLBACK_SVG)}`;

/**
 * Whether an entry from `accommodation_properties.images` can be handed to an
 * `<img src>`. Anything else — a bare storage path that was never resolved to
 * a URL, a null, a blank string — would render as a broken image, so it is
 * skipped rather than trusted.
 */
function isRenderableImage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url) return false;
  return /^(https?:\/\/|\/\/|\/|data:image\/)/i.test(url);
}

/**
 * First usable photo at or after `startIndex`, wrapping around the array.
 *
 * Returns null when the listing has no photograph at all, which callers pair
 * with `ACCOMMODATION_FALLBACK_IMAGE` — an `<img>` must never end up with an
 * empty `src`, because the browser then resolves it to the page URL and tries
 * to decode the HTML document as an image.
 */
export function resolveAccommodationImage(
  images: readonly string[] | null | undefined,
  startIndex = 0
): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const length = images.length;
  const base = ((startIndex % length) + length) % length;
  for (let step = 0; step < length; step++) {
    const candidate = images[(base + step) % length];
    if (isRenderableImage(candidate)) return candidate.trim();
  }
  return null;
}

/**
 * Keep a listing photo on screen when the URL it was published with fails.
 *
 * A listing is seeded and edited with third-party URLs, and those rot: an
 * Unsplash photo that returns 404 leaves a blank tile on the grid and an empty
 * black frame in the gallery. On failure the image walks forward to the next
 * photograph of the *same* property — so a listing with two photos shows the
 * one that actually exists — and only when every photograph has been tried
 * does it settle on the branded placeholder. URLs already known to have failed
 * are remembered on the element, so the handler can never loop.
 */
export function handleAccommodationImageError(
  event: SyntheticEvent<HTMLImageElement>,
  images: readonly string[] | null | undefined,
  startIndex = 0
): void {
  const img = event.currentTarget;
  const current = img.getAttribute('src') ?? '';

  // Already on the placeholder: there is nothing left to fall back to.
  if (current === ACCOMMODATION_FALLBACK_IMAGE || img.dataset.accImageFallback === '1') {
    img.dataset.accImageFallback = '1';
    return;
  }

  let seen: string[] = [];
  try {
    const stored = img.dataset.accImageSeen;
    if (stored) seen = JSON.parse(stored) as string[];
  } catch {
    seen = [];
  }
  if (!seen.includes(current)) seen.push(current);

  const total = Array.isArray(images) ? images.length : 0;
  for (let step = 0; step < total; step++) {
    const next = resolveAccommodationImage(images, startIndex + step);
    if (next && !seen.includes(next)) {
      img.dataset.accImageSeen = JSON.stringify(seen);
      img.src = next;
      return;
    }
  }

  img.dataset.accImageFallback = '1';
  img.src = ACCOMMODATION_FALLBACK_IMAGE;
}

export async function fetchAccommodationProperties(
  filters: AccommodationFilters = {}
): Promise<AccommodationProperty[]> {
  try {
    if (!supabase) return [];
    let query = supabase
      .from('accommodation_properties')
      .select('*')
      .eq('is_published', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false });

    if (filters.location && filters.location !== 'All Locations') {
      query = query.eq('location_area', filters.location);
    }

    if (filters.propertyType && filters.propertyType !== 'all') {
      query = query.eq('property_type', filters.propertyType);
    }

    if (filters.minPrice !== undefined && filters.minPrice > 0) {
      query = query.gte('price_annual', filters.minPrice);
    }

    if (filters.maxPrice !== undefined && filters.maxPrice > 0) {
      query = query.lte('price_annual', filters.maxPrice);
    }

    if (filters.minUnitsAvailable !== undefined && filters.minUnitsAvailable > 0) {
      query = query.gte('available_units', filters.minUnitsAvailable);
    }

    if (filters.availabilityStatus && filters.availabilityStatus !== 'all') {
      query = query.eq('availability_status', filters.availabilityStatus);
    }

    if (filters.amenity) {
      query = query.contains('amenities', [filters.amenity]);
    }

    const { data, error } = await query;
    if (error) throw error;

    let results = (data || []) as AccommodationProperty[];

    if (filters.query && filters.query.trim()) {
      const q = filters.query.toLowerCase().trim();
      results = results.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.address_landmark.toLowerCase().includes(q) ||
          p.location_area.toLowerCase().includes(q)
      );
    }

    return results;
  } catch (err) {
    console.error('Failed to fetch accommodation properties:', err);
    return [];
  }
}

export async function fetchAccommodationPropertyBySlug(
  slugOrId: string
): Promise<AccommodationProperty | null> {
  try {
    if (!supabase) return null;
    // Try by slug first
    let { data, error } = await supabase
      .from('accommodation_properties')
      .select('*')
      .eq('slug', slugOrId)
      .maybeSingle();

    if (!data && !error && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId)) {
      const byId = await supabase
        .from('accommodation_properties')
        .select('*')
        .eq('id', slugOrId)
        .maybeSingle();
      data = byId.data;
    }

    return data as AccommodationProperty | null;
  } catch (err) {
    console.error('Failed to fetch accommodation detail:', err);
    return null;
  }
}

export async function submitAccommodationReport(
  report: AccommodationReport
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = requireSupabase();
    const { error } = await client.from('accommodation_reports').insert({
      property_id: report.property_id,
      reporter_id: report.reporter_id || null,
      reason: report.reason,
      details: report.details.trim(),
      status: 'pending'
    });

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to submit report' };
  }
}

export async function submitAccommodationInquiry(inquiry: {
  property_id: string;
  student_name: string;
  student_phone: string;
  message: string;
  preferred_move_in?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const client = requireSupabase();
    const user = (await client.auth.getUser()).data.user;
    if (!user) throw new Error('Must be logged in to send inquiry');

    const { error } = await client.from('accommodation_inquiries').insert({
      property_id: inquiry.property_id,
      student_id: user.id,
      student_name: inquiry.student_name.trim(),
      student_phone: inquiry.student_phone.trim(),
      message: inquiry.message.trim(),
      preferred_move_in: inquiry.preferred_move_in || null
    });

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send inquiry' };
  }
}

export async function submitAccommodationReview(
  property_id: string,
  rating: number,
  review_text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = requireSupabase();
    const user = (await client.auth.getUser()).data.user;
    if (!user) throw new Error('Must be logged in to leave a review');

    const { error } = await client.from('accommodation_reviews').insert({
      property_id,
      user_id: user.id,
      rating,
      review_text: review_text.trim(),
      is_approved: true
    });

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to submit review' };
  }
}

export async function fetchAccommodationReviews(
  property_id: string
): Promise<AccommodationReview[]> {
  try {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('accommodation_reviews')
      .select('*')
      .eq('property_id', property_id)
      .eq('is_approved', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as AccommodationReview[];
  } catch (err) {
    console.error('Failed to fetch reviews:', err);
    return [];
  }
}

/**
 * Record that a published listing was opened, returning its new view total.
 *
 * This has to go through the `increment_accommodation_view_count` RPC rather
 * than a client-side UPDATE: `accommodation_properties` is row-level-secured
 * and grants UPDATE only to the owning provider and to platform admins, so a
 * visitor's write would be rejected by policy. The function is SECURITY
 * DEFINER, atomic, and only counts published listings.
 *
 * Never throws. A popularity figure is decoration; failing to draw it must not
 * take down the listing the student is trying to read.
 */
export async function recordAccommodationView(
  property_id: string
): Promise<number | null> {
  try {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('increment_accommodation_view_count', {
      p_property_id: property_id
    });

    if (error) throw error;
    return typeof data === 'number' ? data : null;
  } catch (err) {
    console.error('Failed to record accommodation view:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOMMATE FINDER PLATFORM
// ─────────────────────────────────────────────────────────────────────────────

export interface RoommateRequest {
  id: string;
  student_id: string;
  target_gender: 'Male' | 'Female' | 'Any';
  budget_min: number;
  budget_max: number;
  accommodation_type: string;
  preferred_location: string;
  description: string;
  phone_number: string;
  whatsapp_number: string;
  status: 'active' | 'matched' | 'closed';
  view_count: number;
  created_at: string;
  updated_at: string;
  student_name?: string;
  student_gender?: string;
  student_department?: string;
  student_level?: string;
  student_avatar?: string;
  student_verified?: boolean;
}

export interface PublishRoommateRequestInput {
  id?: string;
  target_gender: 'Male' | 'Female' | 'Any';
  budget_min: number;
  budget_max: number;
  accommodation_type: string;
  preferred_location: string;
  description: string;
  phone_number: string;
  whatsapp_number: string;
}

export interface RoommateFilterOptions {
  gender?: string;
  location?: string;
  accommodationType?: string;
  minBudget?: number;
  maxBudget?: number;
  query?: string;
}

export const ROOMMATE_ACCOMMODATION_TYPES = [
  'Shared Lodge',
  'Self-Contain',
  'Single Room',
  'Flat / Apartment',
  'Bedspace',
  'Any / Flexible'
] as const;

export function formatPhoneNumberForCall(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  return `+234${cleaned.replace(/^0+/, '')}`;
}

export function formatWhatsAppUrl(whatsapp: string, contextMessage?: string): string {
  let cleaned = whatsapp.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.slice(1);
  } else if (!cleaned.startsWith('234') && cleaned.length === 10) {
    cleaned = '234' + cleaned;
  }
  const msg = encodeURIComponent(
    contextMessage || 'Hello! I saw your roommate request on FUW Campus Hub Accommodation and would like to connect.'
  );
  return `https://wa.me/${cleaned}?text=${msg}`;
}

export async function fetchRoommateRequests(filters?: RoommateFilterOptions): Promise<RoommateRequest[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('fetch_roommate_requests', {
    p_gender: filters?.gender && filters.gender !== 'All' ? filters.gender : null,
    p_location: filters?.location && filters.location !== 'All Locations' ? filters.location : null,
    p_type: filters?.accommodationType && filters.accommodationType !== 'All' ? filters.accommodationType : null,
    p_max_budget: filters?.maxBudget ?? null,
    p_min_budget: filters?.minBudget ?? null,
  });
  if (error) throw error;
  let list = (data || []) as RoommateRequest[];
  if (filters?.query) {
    const q = filters.query.toLowerCase();
    list = list.filter(
      (r) =>
        r.student_name?.toLowerCase().includes(q) ||
        r.preferred_location?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.accommodation_type?.toLowerCase().includes(q) ||
        r.student_department?.toLowerCase().includes(q)
    );
  }
  return list;
}

export async function publishRoommateRequest(input: PublishRoommateRequestInput): Promise<{
  success: boolean;
  request_id: string;
  notifications_sent: number;
  request: RoommateRequest;
}> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('publish_roommate_request', {
    p_id: input.id ?? null,
    p_target_gender: input.target_gender,
    p_budget_min: input.budget_min,
    p_budget_max: input.budget_max,
    p_accommodation_type: input.accommodation_type,
    p_preferred_location: input.preferred_location,
    p_description: input.description,
    p_phone_number: input.phone_number,
    p_whatsapp_number: input.whatsapp_number,
  });
  if (error) throw error;
  return data;
}

export async function fetchMyRoommateRequests(): Promise<RoommateRequest[]> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];
  const { data, error } = await client
    .from('roommate_requests')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as RoommateRequest[];
}

export async function setRoommateRequestStatus(id: string, status: 'active' | 'matched' | 'closed'): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('set_roommate_request_status', {
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function deleteRoommateRequest(id: string): Promise<boolean> {
  const client = requireSupabase();
  const { error } = await client.from('roommate_requests').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function recordRoommateView(id: string): Promise<void> {
  try {
    if (!supabase) return;
    await supabase.rpc('increment_roommate_request_view', { p_id: id });
  } catch {
    // Non-blocking telemetry
  }
}

