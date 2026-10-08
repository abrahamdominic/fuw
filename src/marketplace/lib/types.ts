export type ListingType = 'product' | 'service';
export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'not_applicable';
export type DeliveryType = 'pickup' | 'delivery' | 'both';
export type ListingStatus = 'draft' | 'active' | 'paused' | 'out_of_stock' | 'delisted';
export type VendorStatus = 'draft' | 'pending_review' | 'active' | 'suspended' | 'rejected';
export type VerificationStatus = 'none' | 'pending' | 'verified' | 'rejected';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'order_confirmed'
  | 'preparing'
  | 'ready_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'disputed'
  | 'refunded';

export type PaymentStatus =
  | 'created'
  | 'awaiting_payment'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';
export type DisputeReason =
  | 'item_not_received'
  | 'wrong_item'
  | 'damaged_item'
  | 'not_as_described'
  | 'order_issue'
  | 'payment_issue'
  | 'vendor_issue'
  | 'other';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'awaiting_vendor'
  | 'awaiting_buyer'
  | 'resolved_refund'
  | 'resolved_partial'
  | 'resolved_rejected'
  | 'closed';

export type SettlementStatus =
  | 'pending'
  | 'scheduled'
  | 'processing'
  | 'paid_out'
  | 'on_hold'
  | 'cancelled'
  | 'failed';

export type ReportTarget = 'product' | 'vendor' | 'review' | 'user' | 'message';

export type ConversationKind = 'direct' | 'order' | 'support';

export interface MarketplaceProfile {
  id: string;
  email?: string;
  full_name?: string;
  matric_number?: string;
  phone?: string;
  faculty?: string;
  department?: string;
  level?: string;
  avatar_url?: string;
  campus_hostel?: string;
  is_suspended?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface MarketplaceVendor {
  id: string;
  owner_id: string;
  store_name: string;
  slug: string;
  tagline?: string;
  description?: string;
  logo_url?: string;
  banner_url?: string;
  phone?: string;
  campus_area?: string;
  business_hours?: Record<string, string>;
  policies?: Record<string, string>;
  status: VendorStatus;
  is_verified: boolean;
  verification_status: VerificationStatus;
  rating_avg: number;
  rating_count: number;
  completed_orders_count: number;
  response_rate_percent?: number;
  response_time_minutes?: number;
  payout_bank_name?: string;
  payout_account_number?: string;
  payout_account_name?: string;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceCategory {
  id: string;
  slug: string;
  name: string;
  description?: string;
  icon: string;
  listing_type: ListingType;
  sort_order: number;
  is_active: boolean;
  commission_bps?: number;
  subcategories?: MarketplaceSubcategory[];
}

export interface MarketplaceSubcategory {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface MarketplaceProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  url: string;
  alt_text?: string;
  sort_order: number;
  is_primary: boolean;
}

export interface MarketplaceProductVariant {
  id: string;
  product_id: string;
  name: string;
  value: string;
  price_kobo?: number;
  compare_at_kobo?: number;
  quantity_total?: number;
  quantity_sold?: number;
  quantity_reserved?: number;
  sku?: string;
  sort_order: number;
  is_active: boolean;
}

export interface MarketplaceProduct {
  id: string;
  vendor_id: string;
  category_id: string;
  subcategory_id?: string;
  title: string;
  slug: string;
  description: string;
  listing_type: ListingType;
  price_kobo: number;
  compare_at_kobo?: number;
  condition: ItemCondition;
  condition_notes?: string;
  fulfilment: DeliveryType;
  delivery_fee_kobo?: number;
  campus_area?: string;
  meeting_point?: string;
  tags?: string[];
  quantity_total: number;
  quantity_sold: number;
  quantity_reserved: number;
  available_quantity?: number;
  lead_time_hours?: number;
  capacity?: number;
  service_area?: string;
  status: ListingStatus;
  is_service: boolean;
  thumbnail_url?: string;
  views_count: number;
  favourites_count: number;
  rating_avg: number;
  rating_count: number;
  created_at: string;
  updated_at: string;
  vendor?: MarketplaceVendor;
  category?: MarketplaceCategory;
  images?: MarketplaceProductImage[];
  variants?: MarketplaceProductVariant[];
}

export interface CartItem {
  productId: string;
  variantId?: string;
  product: MarketplaceProduct;
  variant?: MarketplaceProductVariant;
  quantity: number;
}

export interface CartVendorGroup {
  vendorId: string;
  vendorName: string;
  campusArea?: string;
  items: CartItem[];
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
}

export interface MarketplaceAddress {
  id: string;
  user_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  campus_area: string;
  address_line: string;
  landmark?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceDeliverySnapshot {
  recipient_name?: string;
  phone?: string;
  campus_area?: string;
  address_line?: string;
  landmark?: string;
  meeting_point?: string;
}

export interface MarketplaceOrder {
  id: string;
  checkout_id: string;
  order_number: string;
  buyer_id: string;
  vendor_id: string;
  status: OrderStatus;
  subtotal_kobo: number;
  delivery_fee_kobo: number;
  platform_fee_kobo: number;
  total_kobo: number;
  vendor_payout_kobo: number;
  currency: string;
  settlement_status: SettlementStatus;
  fulfilment: DeliveryType;
  delivery_snapshot?: MarketplaceDeliverySnapshot;
  delivery_pin?: string;
  buyer_note?: string;
  campus_area?: string;
  payment_id?: string;
  dispute_id?: string;
  paid_at?: string;
  confirmed_at?: string;
  delivered_at?: string;
  completed_at?: string;
  refunded_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  cancelled_by_role?: string;
  auto_confirm_at?: string;
  buyer_receipt_confirmed_at?: string;
  created_at: string;
  updated_at: string;
  items?: MarketplaceOrderItem[];
  vendor?: MarketplaceVendor;
  buyer?: MarketplaceProfile;
  history?: MarketplaceOrderStatusHistory[];
  dispute?: MarketplaceDispute;
  payment?: MarketplacePayment;
}

export interface MarketplacePayment {
  id: string;
  order_id: string;
  buyer_id: string;
  provider: string;
  provider_reference?: string;
  amount_kobo: number;
  currency: string;
  status: PaymentStatus;
  channel?: string;
  authorised_at?: string;
  captured_at?: string;
  failed_at?: string;
  failure_reason?: string;
  refunded_kobo: number;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceOrderItem {
  id: string;
  order_id: string;
  product_id?: string;
  variant_id?: string;
  product_title: string;
  variant_label?: string;
  image_path?: string;
  unit_price_kobo: number;
  quantity: number;
  line_total_kobo: number;
  is_service: boolean;
  fulfilment_note?: string;
  fulfilled_at?: string;
  created_at: string;
}

export interface MarketplaceOrderStatusHistory {
  id: string;
  order_id: string;
  status: OrderStatus;
  note?: string;
  actor_id?: string;
  created_at: string;
}

export interface MarketplaceReview {
  id: string;
  product_id?: string;
  vendor_id?: string;
  order_id?: string;
  reviewer_id: string;
  rating: number;
  title?: string;
  body?: string;
  photos?: string[];
  vendor_reply?: string;
  vendor_replied_at?: string;
  is_verified_purchase: boolean;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
  reviewer?: MarketplaceProfile;
  product?: MarketplaceProduct;
}

export interface MarketplaceConversation {
  id: string;
  kind: ConversationKind;
  buyer_id: string;
  vendor_id: string;
  product_id?: string | null;
  order_id?: string | null;
  last_message_at: string | null;
  last_message_preview?: string | null;
  buyer_unread: number;
  vendor_unread: number;
  is_locked: boolean;
  locked_reason?: string | null;
  created_at: string;
  updated_at: string;
  vendor?: MarketplaceVendor;
  buyer?: MarketplaceProfile;
  product?: MarketplaceProduct;
  last_message?: MarketplaceMessage;
}

/** Who sent a message. 'admin' is what distinguishes a support reply. */
export type MessageSenderRole = 'buyer' | 'vendor' | 'admin' | 'system';

export interface MarketplaceMessage {
  id: string;
  conversation_id: string;
  /** Breaks created_at ties so a transcript has a deterministic order. */
  seq?: number;
  sender_id: string | null;
  sender_role: MessageSenderRole;
  body: string;
  attachments?: unknown[] | null;
  is_system: boolean;
  read_at?: string | null;
  created_at: string;
  sender_name?: string | null;
  /** Set only on admin messages, so the UI can badge them. */
  sender_label?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 16: vendor ↔ admin support threads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who is waiting on whom. A thread's status always reflects the side that has
 * not spoken last, which is why sending is the only thing that flips it.
 */
export type SupportStatus = 'open' | 'awaiting_vendor' | 'awaiting_admin' | 'closed';

export interface SupportThread {
  id: string;
  subject: string;
  status: SupportStatus;
  last_message_at: string | null;
  last_message_preview?: string | null;
  created_at: string;
  closed_at?: string | null;
  /** Unread count for whoever is looking at this list. */
  vendor_unread?: number;
  admin_unread?: number;
}

/** The vendor's own view: enough to render a thread row. */
export type VendorSupportThread = SupportThread;

/** The admin queue's view, which is the only place a vendor is named. */
export interface AdminSupportThread extends SupportThread {
  admin_id: string | null;
  admin_display_name: string;
  vendor_id: string;
  vendor_owner_id: string;
  vendor_display_name: string;
  vendor_handle?: string;
  shop_name: string;
  vendor_status?: string;
  closed_by?: string | null;
  /**
   * True when the vendor has spoken and an admin has not answered since. The
   * queue sorts on this so unanswered threads sit at the top.
   */
  awaiting_admin: boolean;
}

export interface SupportMessage extends MarketplaceMessage {}

/** One thread plus the viewer's side of it. */
export interface SupportConversation extends SupportThread {
  role: 'vendor' | 'admin';
  vendor_id: string;
  shop_name?: string | null;
  vendor_owner_id?: string | null;
  messages: SupportMessage[];
}

export interface MarketplaceDispute {
  id: string;
  dispute_number: string;
  order_id: string;
  buyer_id: string;
  vendor_id: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  refund_amount_kobo?: number;
  resolution?: string;
  assigned_to?: string;
  assigned_at?: string;
  resolved_by?: string;
  resolved_at?: string;
  due_at?: string;
  created_at: string;
  updated_at: string;
  order?: MarketplaceOrder;
  buyer?: MarketplaceProfile;
  vendor?: MarketplaceVendor;
  evidence?: MarketplaceDisputeEvidence[];
}

export interface MarketplaceDisputeEvidence {
  id: string;
  dispute_id: string;
  uploader_id: string;
  storage_path: string;
  url?: string;
  notes?: string;
  created_at: string;
}

export interface MarketplaceReport {
  id: string;
  reporter_id: string;
  target_type: ReportTarget;
  target_id: string;
  reason: string;
  details?: string;
  status: 'open' | 'resolved' | 'dismissed';
  admin_note?: string;
  created_at: string;
  reporter?: MarketplaceProfile;
}

export interface MarketplaceNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export type WithdrawalStatus =
  | 'requested'
  | 'under_review'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'rejected'
  | 'cancelled';

/** Bank details live in one JSONB column, not three loose columns. */
export interface WithdrawalDestination {
  bank_name?: string;
  account_number?: string;
  account_name?: string;
}

export interface MarketplaceWithdrawal {
  id: string;
  vendor_id: string;
  amount_kobo: number;
  status: WithdrawalStatus;
  destination: WithdrawalDestination | null;
  reference?: string | null;
  requested_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reviewer_note?: string | null;
  paid_at?: string | null;
  failure_reason?: string | null;
  created_at: string;
  updated_at?: string;
}

// ── Wallet (PHASE 17) ────────────────────────────────────────────────────────
// Financial state is authoritative on the server. These shapes mirror what the
// wallet RPCs return; the client never derives a balance.

export type LedgerDirection = 'credit' | 'debit';
export type LedgerBucket = 'available' | 'pending';

export type LedgerEntryType =
  | 'wallet_funding'
  | 'wallet_payment'
  | 'elibrary_premium_purchase'
  | 'refund'
  | 'refund_credit'
  | 'manual_credit'
  | 'manual_debit'
  | 'payout'
  | 'payout_hold'
  | 'payout_reversed'
  | 'payout_paid'
  | 'escrow_funded'
  | 'escrow_refund'
  | 'escrow_release'
  | 'vendor_earning'
  | 'platform_fee'
  | 'platform_fee_refund'
  | 'advert_spend'
  | 'advert_refund';

export interface MarketplaceWallet {
  wallet_id: string | null;
  owner_user_id: string;
  vendor_id: string | null;
  is_vendor: boolean;
  currency: string;
  available_kobo: number;
  pending_kobo: number;
  total_kobo: number;
  lifetime_credit_kobo: number;
  lifetime_debit_kobo: number;
  is_frozen: boolean;
  frozen_reason?: string | null;
}

export interface MarketplaceLedgerEntry {
  id: string;
  direction: LedgerDirection;
  bucket: LedgerBucket;
  amount_kobo: number;
  balance_before?: number;
  balance_after: number;
  entry_type: LedgerEntryType;
  status: string;
  reference_type?: string | null;
  reference_id?: string | null;
  currency?: string;
  provider?: string | null;
  provider_transaction_id?: string | null;
  provider_reference?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  processed_at?: string;
}

/** Padded aggregate for the vendor earnings screen, computed server side. */
export interface VendorWalletSummary {
  vendor_id: string;
  wallet_id: string | null;
  currency: string;
  available_kobo: number;
  pending_kobo: number;
  lifetime_earned_kobo: number;
  lifetime_paid_out_kobo: number;
  advert_spend_kobo: number;
}

export interface MarketplaceSettlement {
  id: string;
  order_id: string;
  vendor_id: string;
  gross_kobo: number;
  commission_kobo: number;
  net_kobo: number;
  status: SettlementStatus;
  eligible_at?: string | null;
  released_at?: string | null;
  hold_reason?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PlatformSettings {
  id: number;
  default_commission_bps: number;
  default_delivery_fee_kobo: number;
  return_window_hours: number;
  settlement_delay_hours: number;
  auto_confirm_hours: number;
  min_withdrawal_kobo: number;
  max_listings_per_vendor: number;
  max_images_per_listing: number;
  max_variants_per_listing: number;
  allow_registration: boolean;
  allow_new_vendors: boolean;
  require_vendor_verification: boolean;
  min_rating_to_list: string;
  maintenance_mode: boolean;
  maintenance_message?: string;
  announcement?: string;
  payment_channels: string[];
  payment_provider: string;
  payments_enabled: boolean;
}

export interface ProductFilters {
  search?: string;
  category?: string;
  subcategory?: string;
  listingType?: ListingType | 'all';
  minPriceKobo?: number;
  maxPriceKobo?: number;
  condition?: ItemCondition | 'all';
  fulfilment?: DeliveryType | 'all';
  campusArea?: string;
  vendorId?: string;
  sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'popular';
}

// ── Adverts (PHASES 13-15) ───────────────────────────────────────────────────
// Every price and duration below comes from the database. The vendor form never
// carries its own copy of the price list; it renders whatever the server sends,
// and the server snapshots the chosen package onto the advert when it is bought.

export type AdvertType = 'featured' | 'sponsored';
export type AdvertAudience = 'male' | 'female' | 'both';
export type AdvertApprovalState = 'pending' | 'approved' | 'rejected';
export type AdvertStatus = 'scheduled' | 'active' | 'suspended' | 'expired' | 'cancelled';

export interface AdvertPackage {
  id: string;
  advert_type: AdvertType;
  duration_days: number;
  price_kobo: number;
  label: string;
  is_active: boolean;
  sort_order: number;
}

/** What the vendor is offered. Disabled options are admin-only. */
export interface AdvertPackageListResponse {
  packages: AdvertPackage[];
}

export interface Advert {
  id: string;
  vendor_id: string;
  product_id: string | null;
  package_id: string | null;
  advert_type: AdvertType;
  target_audience: AdvertAudience;
  /** Snapshotted at purchase time; a later admin price edit does not change it. */
  price_kobo: number;
  duration_days: number;
  start_at: string;
  end_at: string;
  approval_state: AdvertApprovalState;
  status: AdvertStatus;
  charged_at?: string | null;
  refunded_at?: string | null;
  reviewed_at?: string | null;
  reviewer_note?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  product?: { title: string; slug: string; thumbnail_path: string | null } | null;
  package?: AdvertPackage | null;
}

export interface SubmitAdvertResponse {
  advert_id: string;
  status: AdvertStatus;
  approval_state: AdvertApprovalState;
  price_kobo: number;
  duration_days: number;
  start_at: string;
  end_at: string;
}

export interface VisibleAdvert extends Advert {
  shop_name: string;
  vendor_slug: string;
  product_title: string | null;
  product_slug: string | null;
  product_price_kobo: number | null;
  product_image: string | null;
}

export interface VisibleAdvertsResponse {
  adverts: VisibleAdvert[];
  /** The viewer's own audience as the server computed it; null when unknown. */
  audience: AdvertAudience | null;
}
