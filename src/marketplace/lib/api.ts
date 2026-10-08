import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';
import type {
  MarketplaceCategory,
  MarketplaceProduct,
  MarketplaceVendor,
  MarketplaceOrder,
  MarketplaceConversation,
  MarketplaceMessage,
  MarketplaceReview,
  MarketplaceAddress,
  MarketplaceNotification,
  MarketplacePayment,
  MarketplaceSettlement,
  MarketplaceWithdrawal,
  MarketplaceWallet,
  MarketplaceLedgerEntry,
  VendorWalletSummary,
  PlatformSettings,
  ProductFilters,
  DisputeReason,
  ListingStatus,
  OrderStatus,
  PaymentStatus,
  ReportTarget,
  Advert,
  AdvertPackageListResponse,
  AdvertType,
  AdvertAudience,
  AdvertApprovalState,
  AdvertStatus,
  SubmitAdvertResponse,
  VisibleAdvertsResponse,
  SupportStatus,
  VendorSupportThread,
  AdminSupportThread,
  SupportConversation,
  SupportMessage,
} from './types';

// =============================================================================
// CATEGORIES & TAXONOMY
// =============================================================================

export async function fetchCategories(): Promise<MarketplaceCategory[]> {
  const { data: categories, error } = await supabase
    .from('marketplace_categories')
    .select(`
      id, slug, name, description, icon, listing_type, sort_order, is_active, commission_bps,
      subcategories:marketplace_subcategories(id, category_id, slug, name, sort_order, is_active)
    `)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (categories as MarketplaceCategory[]) || [];
}

// =============================================================================
// PRODUCTS & SEARCH
// =============================================================================

export async function fetchProducts(
  filters: ProductFilters = {},
  page: number = 1,
  limit: number = 18
): Promise<{ products: MarketplaceProduct[]; totalCount: number }> {
  let query = supabase
    .from('marketplace_products')
    .select(`
      *,
      vendor:marketplace_vendors!inner(id, store_name, slug, logo_url, is_verified, rating_avg, campus_area, status),
      category:marketplace_categories(id, slug, name, icon),
      images:marketplace_product_images(id, url, storage_path, alt_text, sort_order, is_primary)
    `, { count: 'exact' })
    .eq('status', 'active')
    .eq('vendor.status', 'active')
    .is('deleted_at', null);

  if (filters.search) {
    const s = filters.search.trim();
    query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%,tags.cs.{${s.toLowerCase()}}`);
  }

  if (filters.category) {
    query = query.eq('category.slug', filters.category);
  }

  if (filters.listingType && filters.listingType !== 'all') {
    query = query.eq('listing_type', filters.listingType);
  }

  if (filters.condition && filters.condition !== 'all') {
    query = query.eq('condition', filters.condition);
  }

  if (filters.fulfilment && filters.fulfilment !== 'all') {
    query = query.in('fulfilment', [filters.fulfilment, 'both']);
  }

  if (filters.minPriceKobo !== undefined && filters.minPriceKobo > 0) {
    query = query.gte('price_kobo', filters.minPriceKobo);
  }

  if (filters.maxPriceKobo !== undefined && filters.maxPriceKobo > 0) {
    query = query.lte('price_kobo', filters.maxPriceKobo);
  }

  if (filters.campusArea) {
    query = query.eq('campus_area', filters.campusArea);
  }

  if (filters.vendorId) {
    query = query.eq('vendor_id', filters.vendorId);
  }

  // Sorting
  switch (filters.sortBy) {
    case 'price_asc':
      query = query.order('price_kobo', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price_kobo', { ascending: false });
      break;
    case 'rating':
      query = query.order('rating_avg', { ascending: false });
      break;
    case 'popular':
      query = query.order('views_count', { ascending: false });
      break;
    case 'newest':
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, count, error } = await query.range(from, to);

  if (error) throw error;
  return {
    products: (data as MarketplaceProduct[]) || [],
    totalCount: count || 0,
  };
}

export async function fetchProductByIdOrSlug(idOrSlug: string): Promise<MarketplaceProduct | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  
  const query = supabase
    .from('marketplace_products')
    .select(`
      *,
      vendor:marketplace_vendors(id, owner_id, store_name, slug, tagline, description, logo_url, banner_url, phone, campus_area, is_verified, verification_status, rating_avg, rating_count, completed_orders_count, response_rate_percent, response_time_minutes),
      category:marketplace_categories(id, slug, name, icon),
      images:marketplace_product_images(id, url, storage_path, alt_text, sort_order, is_primary),
      variants:marketplace_product_variants(id, product_id, name, value, price_kobo, compare_at_kobo, quantity_total, quantity_sold, quantity_reserved, sku, sort_order, is_active)
    `)
    .is('deleted_at', null);

  const { data, error } = isUuid ? await query.eq('id', idOrSlug).maybeSingle() : await query.eq('slug', idOrSlug).maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Count the view in the background. This has to be the SECURITY DEFINER RPC:
  // `marketplace_products` grants UPDATE to the owning vendor and admins only,
  // so a visitor's own write is rejected by row-level security. The previous
  // call here was `mp_record_search`, which is a search-history recorder -- it
  // never touched this table, so view_count stayed at 0 on every product
  // forever. Failures are ignored: a counter must not break the page.
  supabase
    .rpc('mp_increment_product_view', { p_product_id: (data as any).id })
    .then(() => {}, () => {});

  return data as MarketplaceProduct;
}

// =============================================================================
// VENDOR STOREFRONT
// =============================================================================

export async function fetchVendorByIdOrSlug(idOrSlug: string): Promise<MarketplaceVendor | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  
  const query = supabase
    .from('marketplace_vendors')
    .select('*')
    .is('deleted_at', null);

  const { data, error } = isUuid ? await query.eq('id', idOrSlug).maybeSingle() : await query.eq('slug', idOrSlug).maybeSingle();

  if (error) throw error;
  return data as MarketplaceVendor | null;
}

export async function fetchMyVendor(): Promise<MarketplaceVendor | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('marketplace_vendors')
    .select('*')
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data as MarketplaceVendor | null;
}

export async function saveVendor(data: {
  store_name: string;
  slug: string;
  phone: string;
  tagline?: string;
  description?: string;
  campus_area?: string;
  business_hours?: Record<string, string>;
  policies?: Record<string, string>;
  payout_bank_name?: string;
  payout_account_number?: string;
  vendor_id?: string;
}) {
  const { data: res, error } = await supabase.rpc('mp_save_vendor', {
    p_store_name: data.store_name,
    p_slug: data.slug,
    p_phone: data.phone,
    p_tagline: data.tagline || null,
    p_description: data.description || null,
    p_campus_area: data.campus_area || null,
    p_business_hours: data.business_hours || null,
    p_policies: data.policies || null,
    p_payout_bank_name: data.payout_bank_name || null,
    p_payout_account_number: data.payout_account_number || null,
    p_vendor_id: data.vendor_id || null,
  });

  if (error) throw error;
  return res;
}

export async function upsertProduct(data: {
  product_id?: string;
  title: string;
  description: string;
  category_id: string;
  subcategory_id?: string;
  listing_type?: 'product' | 'service';
  price_kobo: number;
  compare_at_kobo?: number;
  condition?: string;
  condition_notes?: string;
  quantity?: number;
  fulfilment?: 'pickup' | 'delivery' | 'both';
  delivery_fee_kobo?: number;
  campus_area?: string;
  meeting_point?: string;
  tags?: string[];
  lead_time_hours?: number;
  capacity?: number;
  service_area?: string;
  publish?: boolean;
  images?: Array<{ url?: string; storage_path?: string; is_primary?: boolean; alt_text?: string }>;
}) {
  const imagesPayload = data.images && data.images.length > 0 ? data.images.map((img, idx) => {
    let path = img.storage_path;
    if (!path && img.url) {
      if (img.url.includes('/marketplace-product-images/')) {
        path = img.url.split('/marketplace-product-images/').pop();
      } else if (!img.url.startsWith('http')) {
        path = img.url;
      }
    }
    const ext = path ? path.split('.').pop()?.toLowerCase() : 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return {
      path,
      mime,
      alt: img.alt_text || null,
      primary: img.is_primary ?? idx === 0,
      sort: idx
    };
  }) : null;

  const { data: res, error } = await supabase.rpc('mp_upsert_product', {
    p_product_id: data.product_id || null,
    p_title: data.title,
    p_description: data.description,
    p_category_id: data.category_id,
    p_subcategory_id: data.subcategory_id || null,
    p_listing_type: data.listing_type || 'product',
    p_price_kobo: data.price_kobo,
    p_compare_at_kobo: data.compare_at_kobo || null,
    p_condition: (data.condition as any) || 'new',
    p_condition_notes: data.condition_notes || null,
    p_quantity: data.quantity !== undefined ? data.quantity : null,
    p_fulfilment: data.fulfilment || 'pickup',
    p_delivery_fee_kobo: data.delivery_fee_kobo || 0,
    p_campus_area: data.campus_area || null,
    p_meeting_point: data.meeting_point || null,
    p_tags: data.tags || null,
    p_lead_time_hours: data.lead_time_hours || null,
    p_capacity: data.capacity || null,
    p_service_area: data.service_area || null,
    p_publish: data.publish ?? true,
    p_images: imagesPayload ? JSON.stringify(imagesPayload) : null,
  });

  if (error) throw error;
  return res;
}

export async function setListingStatus(productId: string, status: ListingStatus) {
  const { data, error } = await supabase.rpc('mp_set_listing_status', {
    p_product_id: productId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

export async function adjustInventory(productId: string, delta: number, note: string, variantId?: string) {
  const { data, error } = await supabase.rpc('mp_adjust_inventory', {
    p_product_id: productId,
    p_delta: delta,
    p_note: note,
    p_variant_id: variantId || null,
  });
  if (error) throw error;
  return data;
}

export async function uploadProductImage(file: File, vendorId: string): Promise<string> {
  if (!file) throw new Error('No file selected.');
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image size must be less than 5MB.');
  }
  const cleanExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${cleanExt}`;
  const filePath = `${vendorId}/product-images/${safeName}`;

  const { error } = await supabase.storage
    .from('marketplace-product-images')
    .upload(filePath, file, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || 'Failed to upload product image.');
  }

  const { data } = supabase.storage
    .from('marketplace-product-images')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

// =============================================================================
// CART & CHECKOUT
// =============================================================================

export async function computeCart(items: Array<{ product_id: string; variant_id?: string; quantity: number }>) {
  const { data, error } = await supabase.rpc('mp_compute_cart', {
    p_items: JSON.stringify(items),
  });
  if (error) throw error;
  return data;
}

export async function createOrders(payload: {
  idempotency_key: string;
  items: Array<{ product_id: string; variant_id?: string; quantity: number }>;
  delivery_type: 'pickup' | 'delivery';
  delivery?: {
    recipient_name: string;
    phone: string;
    campus_area: string;
    address_line: string;
    landmark?: string;
  };
  buyer_note?: string;
  payment_provider?:
    | 'paystack'
    | 'flutterwave'
    | 'bank_transfer'
    | 'manual_bank_transfer'
    | 'wallet'
    | 'none';
}) {
  const { data, error } = await supabase.rpc('mp_create_orders', {
    p_idempotency_key: payload.idempotency_key,
    p_items: payload.items,
    p_delivery_type: payload.delivery_type,
    p_delivery: payload.delivery || null,
    p_buyer_note: payload.buyer_note || null,
    p_payment_provider: payload.payment_provider || 'manual_bank_transfer',
  });
  if (error) throw error;
  return data;
}

export async function transitionOrder(orderId: string, nextStatus: OrderStatus, reason?: string) {
  const { data, error } = await supabase.rpc('mp_transition_order', {
    p_order_id: orderId,
    p_to_status: nextStatus,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data;
}

// =============================================================================
// PAYMENTS
// =============================================================================

/** The payment record for an order, readable by the buyer and the vendor. */
export async function fetchOrderPayment(orderId: string): Promise<MarketplacePayment | null> {
  const { data, error } = await supabase
    .from('marketplace_payments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as MarketplacePayment) ?? null;
}

export interface PaymentInitialization {
  authorization_url: string;
  reference: string;
  amount_kobo: number;
  currency: string;
  payment_id: string;
  order_id: string;
}

/**
 * Starts a Paystack checkout and returns the URL to send the buyer to.
 *
 * The amount is decided by the server, so this cannot be used to pay a
 * different number than the order total.
 */
export async function initializePayment(
  paymentId: string,
  channel: 'card' | 'ussd' | 'bank_transfer' = 'card'
): Promise<PaymentInitialization> {
  return invokePaymentFunction<PaymentInitialization>('marketplace-paystack-initialize', {
    paymentId,
    channel,
  });
}

export interface PaymentVerification {
  status: string;
  applied: boolean;
  message?: string;
}

/**
 * Asks the server to check a payment against the provider. Used after the buyer
 * returns from Paystack so a slow webhook does not leave the order stuck.
 */
export async function verifyPayment(
  paymentId: string,
  reference: string
): Promise<PaymentVerification> {
  return invokePaymentFunction<PaymentVerification>('marketplace-paystack-verify', {
    paymentId,
    reference,
  });
}

async function invokePaymentFunction<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in to continue.');

  const response = await fetch(
    `${supabaseUrl}/functions/v1/${fn}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload && typeof payload.error === 'string' && payload.error) ||
        'The payment service is unavailable. Please try again.'
    );
  }
  return payload as T;
}

/**
 * Releases escrow to the vendor. This is the only buyer action that moves money,
 * and it is deliberately not a plain status transition.
 */
export async function confirmReceipt(orderId: string) {
  const { data, error } = await supabase.rpc('mp_confirm_receipt', {
    p_order_id: orderId,
  });
  if (error) throw error;
  return data;
}

/** Finance-only: records a bank transfer that a buyer reported making. */
export async function confirmManualTransfer(
  orderId: string,
  proofReference: string,
  note?: string
) {
  const { data, error } = await supabase.rpc('mp_confirm_manual_transfer', {
    p_order_id: orderId,
    p_proof_reference: proofReference.trim(),
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return data;
}

export interface PendingManualTransfer {
  order_id: string;
  order_number: string;
  payment_id: string;
  buyer_name: string;
  buyer_email?: string;
  amount_kobo: number;
  provider_reference?: string;
  payment_status: PaymentStatus;
  created_at: string;
  order_created_at: string;
}

/**
 * Unpaid bank-transfer orders awaiting a finance decision. Readable only by
 * roles holding `manage_payments`, enforced by the `mp_pay_select_finance` RLS
 * policy.
 */
export async function fetchPendingManualTransfers(): Promise<PendingManualTransfer[]> {
  const { data, error } = await supabase
    .from('marketplace_payments')
    .select(`
      id,
      order_id,
      provider_reference,
      amount_kobo,
      status,
      created_at,
      order:marketplace_orders!marketplace_payments_order_id_fkey(
        id,
        order_number,
        created_at,
        buyer:profiles!marketplace_orders_buyer_id_fkey(id, full_name, email)
      )
    `)
    .eq('provider', 'manual_bank_transfer')
    .in('status', ['awaiting_payment', 'created', 'processing'])
    .order('created_at', { ascending: true });

  if (error) throw error;

  const rows: PendingManualTransfer[] = [];
  for (const row of (data ?? []) as any[]) {
    const order = Array.isArray(row.order) ? row.order[0] : row.order;
    if (!order) continue;
    rows.push({
      order_id: order.id as string,
      order_number: order.order_number as string,
      payment_id: row.id as string,
      buyer_name: (order.buyer?.full_name as string) || 'FUW Student',
      buyer_email: (order.buyer?.email as string) || undefined,
      amount_kobo: Number(row.amount_kobo ?? 0),
      provider_reference: (row.provider_reference as string) || undefined,
      payment_status: row.status as PaymentStatus,
      created_at: row.created_at as string,
      order_created_at: order.created_at as string,
    });
  }
  return rows;
}

// =============================================================================
// ORDERS
// =============================================================================

export async function fetchBuyerOrders(): Promise<MarketplaceOrder[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('marketplace_orders')
    .select(`
      *,
      vendor:marketplace_vendors(id, store_name, slug, logo_url, phone, campus_area),
      items:marketplace_order_items(*)
    `)
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceOrder[]) || [];
}

export async function fetchVendorOrders(vendorId: string): Promise<MarketplaceOrder[]> {
  const { data, error } = await supabase
    .from('marketplace_orders')
    .select(`
      *,
      buyer:profiles!buyer_id(id, full_name, email, phone:phone_number, matric_number),
      items:marketplace_order_items(*)
    `)
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceOrder[]) || [];
}

export async function fetchOrderDetails(orderId: string): Promise<MarketplaceOrder | null> {
  const { data, error } = await supabase
    .from('marketplace_orders')
    .select(`
      *,
      vendor:marketplace_vendors(id, store_name, slug, logo_url, phone, campus_area),
      buyer:profiles!buyer_id(id, full_name, email, phone:phone_number, matric_number),
      items:marketplace_order_items(*),
      history:marketplace_order_status_history(*),
      dispute:marketplace_disputes(*)
    `)
    .eq('id', orderId)
    .single();

  if (error) throw error;
  return data as MarketplaceOrder | null;
}

// =============================================================================
// MESSAGING & CHAT
// =============================================================================

export async function fetchConversations(): Promise<MarketplaceConversation[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('marketplace_conversations')
    .select(`
      *,
      vendor:marketplace_vendors(id, store_name, slug, logo_url, owner_id),
      buyer:profiles!buyer_id(id, full_name, avatar_url),
      product:marketplace_products(id, title, price_kobo, thumbnail_url)
    `)
    .order('last_message_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceConversation[]) || [];
}

export async function startConversation(vendorId: string, productId?: string) {
  const { data, error } = await supabase.rpc('mp_start_conversation', {
    p_vendor_id: vendorId,
    p_product_id: productId || null,
  });
  if (error) throw error;
  return data;
}

export async function fetchMessages(conversationId: string): Promise<MarketplaceMessage[]> {
  const { data, error } = await supabase
    .from('marketplace_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as MarketplaceMessage[]) || [];
}

export async function sendMessage(conversationId: string, body: string, attachments?: any[]) {
  const { data, error } = await supabase.rpc('mp_send_message', {
    p_conversation_id: conversationId,
    p_body: body,
    p_attachments: attachments ? JSON.stringify(attachments) : null,
  });
  if (error) throw error;
  return data;
}

// =============================================================================
// PHASE 16: VENDOR ↔ ADMIN SUPPORT THREADS
// =============================================================================

/**
 * Opens a thread, or appends to the vendor's existing open thread with the same
 * subject. The server owns that decision so a refresh cannot spawn duplicates.
 */
export async function startSupportThread(subject: string, body: string) {
  const { data, error } = await supabase.rpc('mp_start_support_thread', {
    p_subject: subject,
    p_body: body,
  });
  if (error) throw error;
  return (data as { conversation_id: string; subject: string; status: SupportStatus }) ?? null;
}

export async function fetchMySupportThreads() {
  const { data, error } = await supabase.rpc('mp_my_support_threads');
  if (error) throw error;
  return ((data as { threads?: VendorSupportThread[] })?.threads ?? []) as VendorSupportThread[];
}

export async function fetchSupportQueue(status?: SupportStatus | 'all') {
  const { data, error } = await supabase.rpc('mp_admin_support_threads', {
    p_status: !status || status === 'all' ? null : status,
  });
  if (error) throw error;
  return ((data as { threads?: AdminSupportThread[] })?.threads ?? []) as AdminSupportThread[];
}

export async function fetchSupportThread(conversationId: string): Promise<SupportConversation> {
  const { data, error } = await supabase.rpc('mp_support_thread', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  if (!data) throw new Error('Support thread not found');
  return data as SupportConversation;
}

export async function sendSupportMessage(
  conversationId: string,
  body: string,
  attachments?: unknown[],
) {
  const { data, error } = await supabase.rpc('mp_send_support_message', {
    p_conversation_id: conversationId,
    p_body: body,
    p_attachments: attachments ?? null,
  });
  if (error) throw error;
  return data as SupportMessage;
}

export async function markSupportRead(conversationId: string) {
  const { error } = await supabase.rpc('mp_mark_support_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

export async function claimSupportThread(conversationId: string, note?: string) {
  const { data, error } = await supabase.rpc('mp_claim_support_thread', {
    p_conversation_id: conversationId,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data;
}

/** Closes a thread, which requires a note the vendor can read. */
export async function setSupportStatus(
  conversationId: string,
  status: SupportStatus,
  note?: string,
) {
  const { data, error } = await supabase.rpc('mp_set_support_status', {
    p_conversation_id: conversationId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data;
}

export async function markConversationRead(conversationId: string) {
  const { error } = await supabase.rpc('mp_mark_conversation_read', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

// =============================================================================
// REVIEWS & RATINGS
// =============================================================================

export async function createReview(payload: {
  order_id: string;
  rating: number;
  title?: string;
  body: string;
  photos?: string[];
}) {
  const { data, error } = await supabase.rpc('mp_create_review', {
    p_order_id: payload.order_id,
    p_rating: payload.rating,
    p_title: payload.title || null,
    p_body: payload.body,
    p_photos: payload.photos || null,
  });
  if (error) throw error;
  return data;
}

export async function replyToReview(reviewId: string, reply: string) {
  const { data, error } = await supabase.rpc('mp_reply_to_review', {
    p_review_id: reviewId,
    p_reply: reply,
  });
  if (error) throw error;
  return data;
}

export async function fetchProductReviews(productId: string): Promise<MarketplaceReview[]> {
  const { data, error } = await supabase
    .from('marketplace_reviews')
    .select(`
      *,
      reviewer:profiles!author_id(id, full_name, avatar_url, faculty, department)
    `)
    .eq('product_id', productId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceReview[]) || [];
}

export async function fetchVendorReviews(vendorId: string): Promise<MarketplaceReview[]> {
  const { data, error } = await supabase
    .from('marketplace_reviews')
    .select(`
      *,
      reviewer:profiles!author_id(id, full_name, avatar_url, faculty, department),
      product:marketplace_products(id, title, thumbnail_url)
    `)
    .eq('vendor_id', vendorId)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceReview[]) || [];
}

// =============================================================================
// FAVOURITES
// =============================================================================

export async function toggleFavourite(productId?: string, vendorId?: string) {
  const { data, error } = await supabase.rpc('mp_toggle_favourite', {
    p_product_id: productId || null,
    p_vendor_id: vendorId || null,
  });
  if (error) throw error;
  return data;
}

export async function fetchFavourites() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { products: [], vendors: [] };

  const { data, error } = await supabase
    .from('marketplace_favourites')
    .select(`
      id, product_id, vendor_id,
      product:marketplace_products(*, vendor:marketplace_vendors(id, store_name, slug, is_verified)),
      vendor:marketplace_vendors(*)
    `)
    .eq('user_id', user.id);

  if (error) throw error;

  const products = (data || []).map((f) => f.product).filter(Boolean);
  const vendors = (data || []).map((f) => f.vendor).filter(Boolean);
  return { products, vendors };
}

// =============================================================================
// DISPUTES & REPORTS
// =============================================================================

export async function openDispute(orderId: string, reason: DisputeReason, description: string) {
  const { data, error } = await supabase.rpc('mp_open_dispute', {
    p_order_id: orderId,
    p_reason: reason,
    p_description: description,
  });
  if (error) throw error;
  return data;
}

export async function addDisputeEvidence(disputeId: string, storagePath: string, notes?: string) {
  const { data, error } = await supabase.rpc('mp_add_dispute_evidence', {
    p_dispute_id: disputeId,
    p_storage_path: storagePath,
    p_mime_type: 'image/jpeg',
    p_size_bytes: 1024,
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
}

export async function resolveDispute(disputeId: string, outcome: string, refundKobo: number, resolution: string) {
  const { data, error } = await supabase.rpc('mp_resolve_dispute', {
    p_dispute_id: disputeId,
    p_outcome: outcome,
    p_refund_kobo: refundKobo || null,
    p_resolution: resolution,
  });
  if (error) throw error;
  return data;
}

export async function createReport(targetType: ReportTarget, targetId: string, reason: string, details?: string) {
  const { data, error } = await supabase.rpc('mp_create_report', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_details: details || null,
  });
  if (error) throw error;
  return data;
}

// =============================================================================
// ADDRESSES & PROFILE
// =============================================================================

export async function fetchAddresses(): Promise<MarketplaceAddress[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('marketplace_addresses')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceAddress[]) || [];
}

export async function saveAddress(payload: {
  id?: string;
  label: string;
  recipient_name: string;
  phone: string;
  campus_area: string;
  address_line: string;
  landmark?: string;
  is_default?: boolean;
}) {
  const { data, error } = await supabase.rpc('mp_save_address', {
    p_address_id: payload.id || null,
    p_label: payload.label,
    p_recipient_name: payload.recipient_name,
    p_phone: payload.phone,
    p_campus_area: payload.campus_area,
    p_address_line: payload.address_line,
    p_landmark: payload.landmark || null,
    p_is_default: payload.is_default || false,
  });
  if (error) throw error;
  return data;
}

export async function deleteAddress(addressId: string) {
  const { data, error } = await supabase.rpc('mp_delete_address', {
    p_address_id: addressId,
  });
  if (error) throw error;
  return data;
}

// =============================================================================
// WITHDRAWALS & EARNINGS
// =============================================================================

export async function requestWithdrawal(amountKobo: number, bankName: string, accountNum: string, _accountName?: string) {
  const { data, error } = await supabase.rpc('mp_request_withdrawal', {
    p_amount_kobo: amountKobo,
    p_bank_name: bankName,
    p_account_number: accountNum,
  });
  if (error) throw error;
  return data;
}

export async function fetchWithdrawals(vendorId: string): Promise<MarketplaceWithdrawal[]> {
  const { data, error } = await supabase
    .from('marketplace_withdrawals')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceWithdrawal[]) || [];
}

export async function fetchVendorSettlements(vendorId: string): Promise<MarketplaceSettlement[]> {
  const { data, error } = await supabase
    .from('marketplace_settlements')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as MarketplaceSettlement[]) || [];
}

// =============================================================================
// WALLET (PHASE 17)
// =============================================================================
//
// Every balance on screen comes from the database. The ledger is the record of
// truth; the wallet row is a cached total of it. Nothing here derives money.

/** The signed-in user's own wallet. No argument: the server resolves the owner. */
export async function fetchMyWallet(): Promise<MarketplaceWallet> {
  const { data, error } = await supabase.rpc('mp_wallet_get');
  if (error) throw error;
  return data as MarketplaceWallet;
}

/**
 * Padded aggregate for the earnings screen. The server sums the ledger, so the
 * dashboard cannot drift from the ledger by re-implementing the arithmetic.
 */
export async function fetchVendorWalletSummary(vendorId?: string): Promise<VendorWalletSummary> {
  const { data, error } = await supabase.rpc(
    'mp_vendor_wallet_summary',
    vendorId ? { p_vendor_id: vendorId } : undefined,
  );
  if (error) throw error;
  return data as VendorWalletSummary;
}

export interface WalletStatementPage {
  entries: MarketplaceLedgerEntry[];
  total: number;
  wallet_id: string | null;
}

/** Paginated transaction history for the signed-in user. */
export async function fetchWalletStatement(
  limit = 25,
  offset = 0,
): Promise<WalletStatementPage> {
  const { data, error } = await supabase.rpc('mp_wallet_statement', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const page = (data || {}) as { entries?: MarketplaceLedgerEntry[]; total?: number; wallet_id?: string };
  return {
    entries: page.entries || [],
    total: page.total || 0,
    wallet_id: page.wallet_id ?? null,
  };
}

/**
 * Pay one of your own orders from your wallet balance.
 *
 * The server debits the wallet and moves the order in a single transaction, so
 * there is no window in which the money is gone but the order is still unpaid.
 * Passing an amount is deliberately impossible: the client cannot choose what to
 * pay.
 */
export async function payOrderFromWallet(orderId: string) {
  const { data, error } = await supabase.rpc('mp_pay_order_from_wallet', {
    p_order_id: orderId,
  });
  if (error) throw error;
  // already_settled comes back on both the fresh and the replayed paths, so a
  // retried payment reads as success rather than as a failure.
  // The early-return replay branch reports no payment_id or amount, so every
  // field beyond `paid` is optional.
  return data as {
    paid: boolean;
    already_settled?: boolean;
    order_id: string;
    status?: string;
    payment_status?: string;
    payment_id?: string;
    amount_kobo?: number;
    balance_after_kobo?: number;
    ledger_entry_id?: string;
  };
}

/**
 * Initiates card funding for the FUW wallet via Paystack.
 * Authoritative amount and record created on the server.
 */
export async function fundWalletWithPaystack(amountKobo: number): Promise<{
  authorization_url: string;
  reference: string;
  amount_kobo: number;
}> {
  const { data, error } = await supabase.functions.invoke('wallet-paystack-initialize', {
    body: { amountKobo },
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.clone().json();
      if (typeof body?.error === 'string') detail = body.error;
    } catch {
      // fallback
    }
    throw new Error(detail || 'Could not initialize wallet funding.');
  }
  if (!data?.authorization_url || !String(data.authorization_url).startsWith('https://checkout.paystack.com/')) {
    throw new Error('Payment provider returned an invalid checkout URL.');
  }
  return data;
}

/**
 * Server-side check of Paystack wallet funding.
 * Atomically credits wallet upon provider confirmation.
 */
export async function verifyWalletFunding(reference: string): Promise<{
  status: 'succeeded' | 'pending' | 'failed';
  amount_kobo?: number;
  balance_after_kobo?: number;
  reason?: string;
}> {
  const { data, error } = await supabase.functions.invoke('wallet-paystack-verify', {
    body: { reference },
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.clone().json();
      if (typeof body?.error === 'string') detail = body.error;
    } catch {
      // fallback
    }
    throw new Error(detail || 'Could not verify wallet funding.');
  }
  return data;
}

export interface NigerianBank {
  name: string;
  code: string;
  slug: string;
  active?: boolean;
}

export interface BankAccountResolution {
  account_name: string;
  account_number: string;
  bank_id?: number;
}

export interface WalletWithdrawalItem {
  id: string;
  amount_kobo: number;
  fee_kobo: number;
  net_amount_kobo: number;
  currency: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  status: 'pending' | 'processing' | 'successful' | 'failed' | 'reversed';
  reference: string;
  transfer_code?: string | null;
  failure_reason?: string | null;
  created_at: string;
  processed_at?: string | null;
}

/** Fetches supported Nigerian banks from Paystack. */
export async function fetchNigerianBanks(): Promise<NigerianBank[]> {
  const { data, error } = await supabase.functions.invoke('wallet-paystack-withdraw', {
    body: { action: 'get_banks' },
  });
  if (error) throw new Error(error.message || 'Could not load banks.');
  return (data?.banks || []) as NigerianBank[];
}

/** Validates and resolves account holder name with Paystack. */
export async function resolveBankAccount(accountNumber: string, bankCode: string): Promise<BankAccountResolution> {
  const { data, error } = await supabase.functions.invoke('wallet-paystack-withdraw', {
    body: { action: 'resolve_account', accountNumber, bankCode },
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.clone().json();
      if (typeof body?.error === 'string') detail = body.error;
    } catch {}
    throw new Error(detail || 'Could not resolve account details.');
  }
  if (!data?.account_name) {
    throw new Error('Could not verify bank account.');
  }
  return data as BankAccountResolution;
}

/** Requests a student wallet withdrawal. */
export async function requestWalletWithdrawal(params: {
  amountKobo: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /**
   * Reuse the same key when retrying one logical attempt. The server replays
   * against it instead of debiting the wallet and paying out a second time.
   */
  idempotencyKey?: string;
}): Promise<{
  success: boolean;
  status: string;
  replayed?: boolean;
  reference: string;
  amount_kobo: number;
  fee_kobo: number;
  net_amount_kobo: number;
  balance_after_kobo: number;
  /** Only populated when Paystack itself returns an approval URL. */
  approval_url?: string | null;
  provider_status?: string;
  message?: string;
}> {
  const { data, error } = await supabase.functions.invoke('wallet-paystack-withdraw', {
    body: { action: 'submit_withdrawal', ...params },
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.clone().json();
      if (typeof body?.error === 'string') detail = body.error;
    } catch {}
    throw new Error(detail || 'Withdrawal request failed.');
  }
  return data;
}

/** Fetches user withdrawal history from server. */
export async function fetchMyWithdrawals(limit = 20, offset = 0): Promise<{
  total: number;
  withdrawals: WalletWithdrawalItem[];
}> {
  const { data, error } = await supabase.rpc('fuw_get_my_withdrawals', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return {
    total: Number(data?.total ?? 0),
    withdrawals: (data?.withdrawals || []) as WalletWithdrawalItem[],
  };
}

/**
 * Pay for an eLibrary premium plan using the centralized FUW wallet.
 * Fully atomic transaction in PostgreSQL.
 */
export async function payPremiumPlanFromWallet(planSlug: string): Promise<{
  success: boolean;
  plan_name: string;
  amount_kobo: number;
  balance_after_kobo: number;
  expires_at: string;
  reference: string;
}> {
  const { data, error } = await supabase.rpc('pay_premium_plan_from_wallet', {
    p_plan_slug: planSlug,
  });
  if (error) throw error;
  return data;
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

export async function fetchNotifications(): Promise<MarketplaceNotification[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('marketplace_notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw error;
  return ((data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    body: row.message || row.body || '',
    link: row.link,
    is_read: Boolean(row.read_at || row.is_read),
    created_at: row.created_at,
  }))) as MarketplaceNotification[];
}

export async function markNotificationRead(notificationId?: string) {
  const { error } = await supabase.rpc('mp_mark_notification_read', {
    p_notification_id: notificationId || null,
  });
  if (error) throw error;
}

// =============================================================================
// PLATFORM SETTINGS & ADMIN
// =============================================================================

export async function fetchPlatformSettings(): Promise<PlatformSettings | null> {
  const { data, error } = await supabase
    .from('marketplace_platform_settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) return null;
  return data as PlatformSettings;
}

export async function updatePlatformSettings(input: {
  default_commission_bps?: number;
  event_ticket_fee_kobo?: number;
  min_withdrawal_kobo?: number;
  settlement_delay_hours?: number;
  auto_confirm_hours?: number;
  return_window_hours?: number;
  require_vendor_verification?: boolean;
  allow_registration?: boolean;
  allow_new_vendors?: boolean;
  payments_enabled?: boolean;
  maintenance_mode?: boolean;
  escrow_fee_kobo?: number;
  premium_escrow_credit_kobo?: number;
  premium_escrow_discount_pct?: number;
  premium_marketplace_benefits_enabled?: boolean;
  verified_scholar_badge_enabled?: boolean;
  premium_visibility_enabled?: boolean;
}): Promise<PlatformSettings> {
  const { data, error } = await supabase.rpc('mp_update_platform_settings', {
    p_default_commission_bps: input.default_commission_bps ?? null,
    p_event_ticket_fee_kobo: input.event_ticket_fee_kobo ?? null,
    p_min_withdrawal_kobo: input.min_withdrawal_kobo ?? null,
    p_settlement_delay_hours: input.settlement_delay_hours ?? null,
    p_auto_confirm_hours: input.auto_confirm_hours ?? null,
    p_return_window_hours: input.return_window_hours ?? null,
    p_require_vendor_verification: input.require_vendor_verification ?? null,
    p_allow_registration: input.allow_registration ?? null,
    p_allow_new_vendors: input.allow_new_vendors ?? null,
    p_payments_enabled: input.payments_enabled ?? null,
    p_maintenance_mode: input.maintenance_mode ?? null,
    p_escrow_fee_kobo: input.escrow_fee_kobo ?? null,
    p_premium_escrow_credit_kobo: input.premium_escrow_credit_kobo ?? null,
    p_premium_escrow_discount_pct: input.premium_escrow_discount_pct ?? null,
    p_premium_marketplace_benefits_enabled: input.premium_marketplace_benefits_enabled ?? null,
    p_verified_scholar_badge_enabled: input.verified_scholar_badge_enabled ?? null,
    p_premium_visibility_enabled: input.premium_visibility_enabled ?? null,
  });
  if (error) throw error;
  return data as PlatformSettings;
}

export async function requestVendorVerification(note: string, evidencePath?: string) {
  const { data, error } = await supabase.rpc('mp_request_vendor_verification', {
    p_note: note,
    p_evidence_path: evidencePath || null,
  });
  if (error) throw error;
  return data;
}

export async function fetchAdminStats() {
  const [
    { count: usersCount },
    { count: vendorsCount },
    { count: productsCount },
    { count: ordersCount },
    { count: disputesCount },
    { count: reportsCount },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('marketplace_vendors').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('marketplace_products').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('marketplace_orders').select('*', { count: 'exact', head: true }),
    supabase.from('marketplace_disputes').select('*', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
    supabase.from('marketplace_reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  return {
    usersCount: usersCount || 0,
    vendorsCount: vendorsCount || 0,
    productsCount: productsCount || 0,
    ordersCount: ordersCount || 0,
    activeDisputesCount: disputesCount || 0,
    openReportsCount: reportsCount || 0,
  };
}

export async function fetchAdminDisputes() {
  const { data, error } = await supabase
    .from('marketplace_disputes')
    .select(`
      *,
      order:marketplace_orders(*, items:marketplace_order_items(*)),
      buyer:profiles!buyer_id(*),
      vendor:marketplace_vendors(*)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function fetchAdminReports() {
  const { data, error } = await supabase
    .from('marketplace_reports')
    .select(`
      *,
      reporter:profiles!reporter_id(*)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function resolveReport(reportId: string, status: 'resolved' | 'dismissed', adminNote: string) {
  const { data, error } = await supabase.rpc('mp_resolve_report', {
    p_report_id: reportId,
    p_action: status,
    p_note: adminNote,
  });
  if (error) throw error;
  return data;
}

export async function reviewVendorVerification(verificationId: string, approve: boolean, note: string) {
  const { data, error } = await supabase.rpc('mp_review_vendor_verification', {
    // The RPC signature is (p_request_id, p_approve, p_note). Passing the
    // parameter under the old `p_verification_id` name made approve/reject
    // fail with "function not found matching the given name and argument types".
    p_request_id: verificationId,
    p_approve: approve,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

export async function fetchAdminVerifications() {
  const { data, error } = await supabase
    .from('marketplace_vendor_verifications')
    .select(`
      *,
      vendor:marketplace_vendors(*)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Upload a vendor's verification evidence to the `marketplace-vendor-assets`
 * bucket. The path must live under `<vendor_id>/verification/`, which is what
 * the `mp_request_vendor_verification` RPC validates.
 */
export async function uploadVerificationEvidence(file: File, vendorId: string): Promise<string> {
  if (!file) throw new Error('No file selected.');
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Evidence file must be less than 5MB.');
  }
  const cleanExt = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${cleanExt}`;
  const filePath = `${vendorId}/verification/${safeName}`;

  const { error } = await supabase.storage
    .from('marketplace-vendor-assets')
    .upload(filePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw new Error(error.message || 'Failed to upload verification evidence.');
  }
  return filePath;
}

/**
 * Best-effort signed URL for a stored evidence object. The storage bucket is
 * private, so this only works for an object the current user is allowed to
 * read (the vendor who owns it, or a staff member once an admin-read policy
 * is in place).
 */
export async function getVerificationEvidenceUrl(evidencePath: string): Promise<string | null> {
  if (!evidencePath) return null;
  const { data, error } = await supabase.storage
    .from('marketplace-vendor-assets')
    .createSignedUrl(evidencePath, 600);
  if (error || !data) return null;
  return data.signedUrl;
}

// ── Adverts (PHASES 13-15) ───────────────────────────────────────────────────

/**
 * The price list the vendor form renders. This is the only source of advert
 * pricing anywhere in the app.
 */
export async function fetchAdvertPackages(
  includeInactive = false,
): Promise<AdvertPackageListResponse> {
  const { data, error } = await supabase.rpc('mp_list_advert_packages', {
    p_include_inactive: includeInactive,
  });
  if (error) throw error;
  // A `RETURNS JSONB` function answers with `null` when it has no rows to
  // aggregate, and the callers dereference `.packages` directly.
  return data ?? { packages: [] };
}

/**
 * The vendor's own adverts. Requires a storefront; the server resolves the
 * vendor from the signed-in user rather than trusting a passed id.
 */
export async function fetchMyAdverts(): Promise<{ adverts: Advert[] }> {
  const { data, error } = await supabase.rpc('mp_my_adverts');
  if (error) throw error;
  return data ?? { adverts: [] };
}

/**
 * Place an advert. The price charged is the server's, taken from the package,
 * and the returned row carries the snapshot the vendor will be held to.
 */
export async function submitAdvert(input: {
  productId: string;
  packageId: string;
  targetAudience: AdvertAudience;
  startAt?: string;
}): Promise<SubmitAdvertResponse> {
  const { data, error } = await supabase.rpc('mp_submit_advert', {
    p_product_id: input.productId,
    p_package_id: input.packageId,
    p_target_audience: input.targetAudience,
    p_start_at: input.startAt ?? null,
  });
  if (error) throw error;
  return data as SubmitAdvertResponse;
}

/**
 * Withdraw a pending advert, or one that has not started running. Refunds the
 * wallet if it had already been charged.
 */
export async function cancelAdvert(advertId: string): Promise<{ refunded_kobo: number }> {
  const { data, error } = await supabase.rpc('mp_cancel_advert', { p_advert_id: advertId });
  if (error) throw error;
  return data as { refunded_kobo: number };
}

/**
 * Adverts the signed-in user is entitled to see. Targeting is evaluated on the
 * server from the viewer's profile, so a client cannot widen it.
 */
export async function fetchVisibleAdverts(
  advertType?: AdvertType,
  limit = 20,
): Promise<VisibleAdvertsResponse> {
  const { data, error } = await supabase.rpc('mp_visible_adverts', {
    p_advert_type: advertType ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  // See `fetchAdvertPackages`: an empty `jsonb` aggregate arrives as `null`,
  // and both the home and browse pages call `.adverts` on the result.
  return data ?? { adverts: [], audience: null };
}

// ── Advert admin ────────────────────────────────────────────────────────────

export async function fetchAdminAdverts(filters?: {
  approvalState?: AdvertApprovalState;
  status?: AdvertStatus;
}): Promise<{ adverts: Advert[] }> {
  const { data, error } = await supabase.rpc('mp_admin_list_adverts', {
    p_approval_state: filters?.approvalState ?? null,
    p_status: filters?.status ?? null,
  });
  if (error) throw error;
  return data ?? { adverts: [] };
}

/**
 * Approve or reject. Approval charges the vendor's wallet from the server side;
 * rejecting an already-approved advert refunds it.
 */
export async function reviewAdvert(
  advertId: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<{ advert_id: string; approval_state: AdvertApprovalState; charged_kobo: number }> {
  const { data, error } = await supabase.rpc('mp_review_advert', {
    p_advert_id: advertId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as {
    advert_id: string;
    approval_state: AdvertApprovalState;
    charged_kobo: number;
  };
}

/** Suspend a running advert, or put it back. Neither action moves money. */
export async function setAdvertActive(
  advertId: string,
  active: boolean,
  note?: string,
): Promise<{ advert_id: string; status: AdvertStatus }> {
  const { data, error } = await supabase.rpc('mp_set_advert_active', {
    p_advert_id: advertId,
    p_active: active,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as { advert_id: string; status: AdvertStatus };
}

/** Create a package, or edit an existing one in place. */
export async function saveAdvertPackage(input: {
  packageId?: string;
  advertType: AdvertType;
  durationDays: number;
  priceKobo: number;
  label?: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<{ package_id: string }> {
  const { data, error } = await supabase.rpc('mp_save_advert_package', {
    p_package_id: input.packageId ?? null,
    p_advert_type: input.advertType,
    p_duration_days: input.durationDays,
    p_price_kobo: input.priceKobo,
    p_label: input.label ?? null,
    p_is_active: input.isActive ?? true,
    p_sort_order: input.sortOrder ?? 0,
  });
  if (error) throw error;
  return data as { package_id: string };
}

/**
 * Retire a package. If adverts are still sold against it the package is
 * disabled rather than deleted, so those adverts keep their reference.
 */
export async function deleteAdvertPackage(
  packageId: string,
): Promise<{ disabled_instead?: boolean; deleted?: boolean; adverts_using_it?: number }> {
  const { data, error } = await supabase.rpc('mp_delete_advert_package', {
    p_package_id: packageId,
  });
  if (error) throw error;
  return data as { disabled_instead?: boolean; deleted?: boolean; adverts_using_it?: number };
}

// =============================================================================
// PREMIUM MARKETPLACE ADVANTAGE & ESCROW CREDIT
// =============================================================================

export interface EscrowCreditInfo {
  has_premium: boolean;
  credit_granted_kobo: number;
  credit_used_kobo: number;
  credit_remaining_kobo: number;
  discount_pct: number;
  is_active: boolean;
  expires_at: string | null;
}

export interface EscrowPreviewResult {
  is_premium: boolean;
  normal_escrow_fee_kobo: number;
  credit_available_kobo: number;
  credit_applied_kobo: number;
  discount_pct: number;
  discount_applied_kobo: number;
  final_escrow_fee_kobo: number;
  credit_remaining_after_kobo: number;
}

export interface AdminEscrowAnalytics {
  total_escrow_credit_granted_kobo: number;
  total_escrow_credit_consumed_kobo: number;
  total_escrow_credit_remaining_kobo: number;
  total_discounts_applied_kobo: number;
  total_escrow_fees_collected_kobo: number;
  total_subscribers_with_credit: number;
  total_orders_benefiting: number;
}

export async function fetchUserEscrowCredit(): Promise<EscrowCreditInfo> {
  const { data, error } = await supabase.rpc('mp_get_user_escrow_credit');
  if (error) throw error;
  return data as EscrowCreditInfo;
}

export async function previewCheckoutEscrow(subtotalKobo: number): Promise<EscrowPreviewResult> {
  const { data, error } = await supabase.rpc('mp_preview_checkout_escrow', {
    p_subtotal_kobo: subtotalKobo,
  });
  if (error) throw error;
  return data as EscrowPreviewResult;
}

export async function fetchAdminEscrowAnalytics(): Promise<AdminEscrowAnalytics> {
  const { data, error } = await supabase.rpc('mp_get_admin_escrow_analytics');
  if (error) throw error;
  return data as AdminEscrowAnalytics;
}

