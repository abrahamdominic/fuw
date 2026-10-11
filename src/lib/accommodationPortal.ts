// Data layer for the landlord / caretaker accommodation portal.
//
// Every mutation here is a SECURITY DEFINER RPC (see
// supabase/migrations/20261010122000_acc_provider_portal_rpcs.sql). The client
// never writes the accommodation tables directly: row-level security plus guard
// triggers reject that, so a crafted request cannot self-verify, self-publish,
// or move money. Reads also go through RPCs so a provider only ever sees the
// listings and payments they are entitled to.

import { requireSupabase, supabase } from './supabase';
import type { RentPeriod } from './advertFee';
import type { PhotoSlot } from './accommodation';

export type ProviderType = 'landlord' | 'caretaker';
export type VerificationStatus = 'pending_verification' | 'verified' | 'rejected' | 'suspended';
export type ModerationStatus =
  | 'draft'
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'rented'
  | 'removed';
export type AdvertPaymentStatus = 'unpaid' | 'reserved' | 'captured' | 'refunded' | 'failed';

export interface ProviderProfile {
  registered: boolean;
  role: string | null;
  id?: string;
  full_name?: string;
  business_name?: string | null;
  provider_type?: ProviderType;
  phone?: string;
  whatsapp?: string | null;
  state?: string | null;
  lga?: string | null;
  town?: string | null;
  address?: string | null;
  preferred_contact_method?: string | null;
  ownership_status?: string | null;
  properties_count?: number | null;
  intended_location?: string | null;
  advert_rent_kobo?: number | null;
  verification_status?: VerificationStatus;
  rejection_reason?: string | null;
  is_suspended?: boolean;
  created_at?: string;
}

export interface ProviderProperty {
  id: string;
  title: string;
  slug: string;
  location_area: string;
  property_type: string;
  price_annual: number;
  description: string;
  address_landmark: string;
  contact_phone: string;
  contact_whatsapp: string | null;
  amenities: string[];
  rules_notes: string | null;
  rent_period: RentPeriod;
  advert_rent_kobo: number | null;
  images: string[] | null;
  photo_slots?: PhotoSlot[] | null;
  photos_complete?: boolean;
  connection_fee_required?: boolean;
  availability_status: string;
  available_units: number | null;
  total_units: number | null;
  moderation_status: ModerationStatus;
  is_published: boolean;
  moderation_note: string | null;
  created_at: string;
  updated_at: string;
  provider_id: string;
  is_owner: boolean;
  payment_status: AdvertPaymentStatus | null;
  fee_kobo: number | null;
  currency: string | null;
}

export interface AdvertPayment {
  id: string;
  property_id: string;
  annual_rent_kobo: number;
  fee_bps: number;
  fee_kobo: number;
  currency: string;
  payment_status: AdvertPaymentStatus;
  moderation_cycle: number;
  reservation_ref: string;
  reserved_at: string;
  captured_at: string | null;
  refunded_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  property_title: string | null;
}

export interface CaretakerAssignment {
  id: string;
  property_id: string;
  status: 'active' | 'revoked';
  can_create_advert: boolean;
  can_edit_details: boolean;
  can_manage_images: boolean;
  can_change_availability: boolean;
  can_mark_rented: boolean;
  created_at: string;
  revoked_at: string | null;
  property_title: string | null;
  property_slug: string | null;
  caretaker_name: string | null;
  caretaker_user_id: string | null;
  landlord_name: string | null;
}

export interface AdvertSettings {
  fee_bps: number;
  enabled: boolean;
  currency: string;
}

export interface ProviderApplication {
  id: string;
  user_id: string | null;
  full_name: string;
  business_name: string | null;
  provider_type: ProviderType;
  phone: string;
  whatsapp: string | null;
  office_address: string | null;
  state: string | null;
  lga: string | null;
  town: string | null;
  address: string | null;
  preferred_contact_method: string | null;
  ownership_status: string | null;
  properties_count: number | null;
  intended_location: string | null;
  advert_rent_kobo: number | null;
  verification_status: VerificationStatus;
  rejection_reason: string | null;
  identity_document_path: string | null;
  ownership_evidence_path: string | null;
  authorization_evidence_path: string | null;
  is_suspended: boolean;
  created_at: string;
  updated_at: string;
  email: string | null;
  role: string | null;
}

export interface AdminAdvert {
  id: string;
  title: string;
  slug: string;
  provider_id: string;
  moderation_status: ModerationStatus;
  is_published: boolean;
  rent_period: RentPeriod;
  advert_rent_kobo: number | null;
  price_annual: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  moderation_note: string | null;
  created_at: string;
  provider_name: string | null;
  provider_type: ProviderType | null;
  payment_id: string | null;
  payment_status: AdvertPaymentStatus | null;
  fee_kobo: number | null;
  fee_bps: number | null;
  annual_rent_kobo: number | null;
  reservation_ref: string | null;
  refunded_at: string | null;
  captured_at: string | null;
  payer_user_id: string | null;
}

function unwrap<T>(data: unknown, fallback: T): T {
  return (data as T) ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Provider registration + profile                                            */
/* -------------------------------------------------------------------------- */

export interface RegisterProviderInput {
  accountType: ProviderType;
  fullName: string;
  phone: string;
  state?: string;
  lga?: string;
  town?: string;
  address?: string;
  preferredContact?: string;
  ownershipStatus?: string;
  propertiesCount?: number;
  intendedLocation?: string;
  advertRentKobo?: number;
  businessName?: string;
  identityDocumentPath?: string;
  ownershipEvidencePath?: string;
  authorizationEvidencePath?: string;
}

export function registerProvider(input: RegisterProviderInput) {
  const client = requireSupabase();
  return client
    .rpc('acc_register_provider', {
      p_account_type: input.accountType,
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_state: input.state ?? null,
      p_lga: input.lga ?? null,
      p_town: input.town ?? null,
      p_address: input.address ?? null,
      p_preferred_contact: input.preferredContact ?? null,
      p_ownership_status: input.ownershipStatus ?? null,
      p_properties_count: input.propertiesCount ?? null,
      p_intended_location: input.intendedLocation ?? null,
      p_advert_rent_kobo: input.advertRentKobo ?? null,
      p_business_name: input.businessName ?? null,
      p_identity_document_path: input.identityDocumentPath ?? null,
      p_ownership_evidence_path: input.ownershipEvidencePath ?? null,
      p_authorization_evidence_path: input.authorizationEvidencePath ?? null
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as { ok: boolean; provider_id: string; account_type: ProviderType; verification_status: VerificationStatus };
    });
}

export async function fetchMyProvider(): Promise<ProviderProfile> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_my_provider');
  if (error) throw error;
  return unwrap<ProviderProfile>(data, { registered: false, role: null });
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export interface SavePropertyInput {
  propertyId?: string | null;
  title: string;
  description: string;
  locationArea: string;
  addressLandmark: string;
  propertyType: string;
  rentAmountKobo: number;
  rentPeriod: RentPeriod;
  totalUnits: number;
  availableUnits: number;
  availabilityStatus: string;
  images: string[];
  amenities: string[];
  contactPhone: string;
  distanceToCampus?: string;
  cautionDepositKobo?: number;
  serviceChargeKobo?: number;
  rulesNotes?: string;
  contactWhatsapp?: string;
  photoSlots?: PhotoSlot[] | null;
  connectionFeeRequired?: boolean;
}

export function saveProperty(input: SavePropertyInput) {
  const client = requireSupabase();
  return client
    .rpc('acc_save_property', {
      p_property_id: input.propertyId ?? null,
      p_title: input.title,
      p_description: input.description,
      p_location_area: input.locationArea,
      p_address_landmark: input.addressLandmark,
      p_property_type: input.propertyType,
      p_rent_amount_kobo: input.rentAmountKobo,
      p_rent_period: input.rentPeriod,
      p_total_units: input.totalUnits,
      p_available_units: input.availableUnits,
      p_availability_status: input.availabilityStatus,
      p_images: input.images,
      p_amenities: input.amenities,
      p_contact_phone: input.contactPhone,
      p_distance_to_campus: input.distanceToCampus ?? null,
      p_caution_deposit_kobo: input.cautionDepositKobo ?? 0,
      p_service_charge_kobo: input.serviceChargeKobo ?? 0,
      p_rules_notes: input.rulesNotes ?? null,
      p_contact_whatsapp: input.contactWhatsapp ?? null,
      p_photo_slots: input.photoSlots ?? null,
      p_connection_fee_required: input.connectionFeeRequired ?? null
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as {
        ok: boolean;
        property_id: string;
        moderation_status: ModerationStatus;
        is_published: boolean;
        annual_rent_kobo: number;
        fee_bps: number;
        fee_kobo: number;
        currency: string;
        photos_complete?: boolean;
        connection_fee_required?: boolean;
      };
    });
}

export async function fetchMyProperties(): Promise<ProviderProperty[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_my_properties');
  if (error) throw error;
  return unwrap<{ properties: ProviderProperty[] }>(data, { properties: [] }).properties;
}

export function submitAdvert(propertyId: string) {
  const client = requireSupabase();
  return client
    .rpc('acc_submit_advert', { p_property_id: propertyId })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as {
        ok: boolean;
        property_id: string;
        payment_id: string;
        moderation_status: ModerationStatus;
        annual_rent_kobo: number;
        fee_bps: number;
        fee_kobo: number;
        currency: string;
        reservation_ref: string;
      };
    });
}

export function setPropertyState(propertyId: string, action: 'rented' | 'removed') {
  const client = requireSupabase();
  return client
    .rpc('acc_set_property_state', { p_property_id: propertyId, p_action: action })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as { ok: boolean; property_id: string; moderation_status: ModerationStatus };
    });
}

/* -------------------------------------------------------------------------- */
/* Advert payments + fee preview                                              */
/* -------------------------------------------------------------------------- */

export async function fetchMyAdvertPayments(): Promise<AdvertPayment[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_my_advert_payments', { p_limit: 100, p_offset: 0 });
  if (error) throw error;
  return unwrap<{ payments: AdvertPayment[] }>(data, { payments: [] }).payments;
}

export async function previewAdvertFee(
  rentAmountKobo: number,
  rentPeriod: RentPeriod
): Promise<{ annual_rent_kobo: number; fee_kobo: number; fee_bps: number; currency: string; enabled: boolean }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_preview_advert_fee', {
    p_rent_amount_kobo: rentAmountKobo,
    p_rent_period: rentPeriod
  });
  if (error) throw error;
  return data as { annual_rent_kobo: number; fee_kobo: number; fee_bps: number; currency: string; enabled: boolean };
}

export async function fetchAdvertSettings(): Promise<AdvertSettings> {
  if (!supabase) return { fee_bps: 150, enabled: true, currency: 'NGN' };
  const { data, error } = await supabase.rpc('acc_advert_settings');
  if (error) return { fee_bps: 150, enabled: true, currency: 'NGN' };
  return unwrap<AdvertSettings>(data, { fee_bps: 150, enabled: true, currency: 'NGN' });
}

/* -------------------------------------------------------------------------- */
/* Caretaker assignments                                                      */
/* -------------------------------------------------------------------------- */

export interface AssignCaretakerInput {
  propertyId: string;
  caretakerEmail: string;
  canCreateAdvert?: boolean;
  canEditDetails?: boolean;
  canManageImages?: boolean;
  canChangeAvailability?: boolean;
  canMarkRented?: boolean;
}

export function assignCaretaker(input: AssignCaretakerInput) {
  const client = requireSupabase();
  return client
    .rpc('acc_assign_caretaker', {
      p_property_id: input.propertyId,
      p_caretaker_email: input.caretakerEmail,
      p_can_create_advert: input.canCreateAdvert ?? false,
      p_can_edit_details: input.canEditDetails ?? false,
      p_can_manage_images: input.canManageImages ?? true,
      p_can_change_availability: input.canChangeAvailability ?? false,
      p_can_mark_rented: input.canMarkRented ?? false
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as { ok: boolean; assignment_id: string };
    });
}

export function revokeCaretaker(assignmentId: string) {
  const client = requireSupabase();
  return client
    .rpc('acc_revoke_caretaker', { p_assignment_id: assignmentId })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as { ok: boolean; assignment_id: string };
    });
}

export async function fetchMyAssignments(): Promise<CaretakerAssignment[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_my_assignments');
  if (error) throw error;
  return unwrap<{ assignments: CaretakerAssignment[] }>(data, { assignments: [] }).assignments;
}

/* -------------------------------------------------------------------------- */
/* Admin operations                                                           */
/* -------------------------------------------------------------------------- */

export async function adminListProviderApplications(
  status?: VerificationStatus | null,
  limit = 50,
  offset = 0
): Promise<{ applications: ProviderApplication[]; total: number }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_admin_list_provider_applications', {
    p_status: status ?? null,
    p_limit: limit,
    p_offset: offset
  });
  if (error) throw error;
  return unwrap(data, { applications: [], total: 0 });
}

export function adminReviewProviderApplication(
  providerId: string,
  decision: 'approve' | 'reject' | 'suspend' | 'reinstate',
  note?: string
) {
  const client = requireSupabase();
  return client
    .rpc('acc_admin_review_provider_application', {
      p_provider_id: providerId,
      p_decision: decision,
      p_note: note ?? null
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as { ok: boolean; provider_id: string; decision: string };
    });
}

export async function adminListAdverts(
  status?: ModerationStatus | null,
  limit = 50,
  offset = 0
): Promise<{ adverts: AdminAdvert[]; total: number }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('acc_admin_list_adverts', {
    p_status: status ?? null,
    p_limit: limit,
    p_offset: offset
  });
  if (error) throw error;
  return unwrap(data, { adverts: [], total: 0 });
}

export function adminReviewAdvert(propertyId: string, decision: 'approve' | 'reject', note?: string) {
  const client = requireSupabase();
  return client
    .rpc('acc_admin_review_advert', {
      p_property_id: propertyId,
      p_decision: decision,
      p_note: note ?? null
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as { ok: boolean; property_id: string; decision: string; fee_kobo: number; payment_status: string };
    });
}

export function adminUpdateAdvertSettings(input: { feeBps?: number; enabled?: boolean; currency?: string }) {
  const client = requireSupabase();
  return client
    .rpc('acc_admin_update_advert_settings', {
      p_fee_bps: input.feeBps ?? null,
      p_enabled: input.enabled ?? null,
      p_currency: input.currency ?? null
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as AdvertSettings;
    });
}

/* -------------------------------------------------------------------------- */
/* Connection fee (admin config + student payment)                            */
/* -------------------------------------------------------------------------- */

export interface ConnectionFeeConfig {
  enabled: boolean;
  amount_kobo: number;
  currency: string;
}

export async function fetchConnectionFeeConfig(): Promise<ConnectionFeeConfig> {
  if (!supabase) return { enabled: false, amount_kobo: 0, currency: 'NGN' };
  const { data, error } = await supabase.rpc('acc_connection_fee_config');
  if (error) return { enabled: false, amount_kobo: 0, currency: 'NGN' };
  return unwrap<ConnectionFeeConfig>(data, { enabled: false, amount_kobo: 0, currency: 'NGN' });
}

export function adminUpdateConnectionFee(input: { enabled: boolean; amountKobo?: number }) {
  const client = requireSupabase();
  return client
    .rpc('acc_admin_update_connection_fee', {
      p_enabled: input.enabled,
      p_amount_kobo: input.amountKobo ?? null
    })
    .then(({ data, error }) => {
      if (error) throw error;
      return data as ConnectionFeeConfig;
    });
}

/* -------------------------------------------------------------------------- */
/* Storage helpers                                                            */
/* -------------------------------------------------------------------------- */

async function requireUserId(): Promise<string> {
  const client = requireSupabase();
  const { data } = await client.auth.getUser();
  if (!data.user) throw new Error('Sign in to upload files');
  return data.user.id;
}

/** Upload a listing photo into the caller's own `providers/<uid>/` folder. */
export async function uploadListingImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
    throw new Error('Please choose a JPG, PNG, WebP or AVIF image.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Images must be 5MB or smaller.');
  }
  const client = requireSupabase();
  const uid = await requireUserId();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `providers/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await client.storage
    .from('accommodation-images')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return client.storage.from('accommodation-images').getPublicUrl(path).data.publicUrl;
}

/** Upload a private identity / ownership document. Returns the storage path. */
export async function uploadProviderDocument(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
    throw new Error('Documents must be a JPG, PNG, WebP or PDF.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Documents must be 10MB or smaller.');
  }
  const client = requireSupabase();
  const uid = await requireUserId();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await client.storage
    .from('provider-documents')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  return path;
}

/** Short-lived signed URL for a private provider document (owner or admin). */
export async function signProviderDocument(path: string): Promise<string | null> {
  const client = requireSupabase();
  const { data, error } = await client.storage.from('provider-documents').createSignedUrl(path, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}
