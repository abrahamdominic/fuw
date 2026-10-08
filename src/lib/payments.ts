import { requireSupabase } from './supabase';

export const PAYMENT_RECEIPTS_BUCKET = 'payment-receipts';
export const MAX_PAYMENT_RECEIPT_BYTES = 8 * 1024 * 1024;
export const PAYMENT_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD'] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];
const ALLOWED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export interface PaymentConfiguration {
  active: boolean;
  manual_enabled: boolean;
  automatic_enabled: boolean;
  bank_name: string;
  account_name: string;
  account_number: string;
  instructions: string;
  currency: PaymentCurrency;
  require_reference: boolean;
  reference_label: string;
  other_information: string;
}

export interface PaymentRequest {
  id: string;
  student_id: string;
  plan_id: string;
  amount_kobo: number;
  currency: PaymentCurrency;
  receipt_path: string;
  payment_reference: string | null;
  submitted_amount_kobo?: number | null;
  payment_date?: string | null;
  payment_method?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  plan?: { name: string; slug: string; duration_days: number } | null;
  student?: {
    full_name: string | null;
    email: string | null;
    matric_number: string | null;
  } | null;
}

export interface AdminPaymentRequest extends PaymentRequest {
  plan_name: string;
  plan_slug: string;
  plan_duration_days: number;
  student_name: string | null;
  student_email: string | null;
  student_matric_number: string | null;
  total_count: number;
}

export interface PaymentTransaction {
  id: string;
  payment_reference: string;
  amount_kobo: number;
  currency: PaymentCurrency;
  payment_method: 'automatic' | 'manual';
  provider: string;
  status: 'pending' | 'verified' | 'failed' | 'expired';
  verification_status: 'pending' | 'verified' | 'failed';
  created_at: string;
  verified_at: string | null;
  activated_at: string | null;
  expires_at: string | null;
  failure_reason: string | null;
}

export interface PremiumPublicConfiguration {
  enabled: boolean;
  manual_payment_enabled: boolean;
  automatic_payment_enabled: boolean;
  features: Array<{ feature_key: string; label: string; description: string }>;
}

export const EMPTY_PAYMENT_CONFIGURATION: PaymentConfiguration = {
  active: false,
  manual_enabled: false,
  automatic_enabled: false,
  bank_name: '',
  account_name: '',
  account_number: '',
  instructions: '',
  currency: 'NGN',
  require_reference: false,
  reference_label: 'Payment reference',
  other_information: ''
};

export async function fetchPaymentConfiguration(): Promise<PaymentConfiguration> {
  const { data, error } = await requireSupabase().rpc('get_payment_configuration');
  if (error) throw new Error(error.message);
  const received = (data ?? {}) as Partial<PaymentConfiguration>;
  const result = { ...EMPTY_PAYMENT_CONFIGURATION, ...received };
  result.manual_enabled = typeof received.manual_enabled === 'boolean'
    ? received.manual_enabled
    : received.active === true;
  result.automatic_enabled = received.automatic_enabled === true;
  result.active = result.manual_enabled;
  return result;
}

export async function savePaymentConfiguration(
  configuration: PaymentConfiguration,
  premiumPlanSlug: string,
  priceKobo: number
): Promise<void> {
  const { error } = await requireSupabase().rpc('save_payment_configuration', {
    p_configuration: { ...configuration, active: configuration.manual_enabled },
    p_plan_slug: premiumPlanSlug,
    p_price_kobo: priceKobo
  });
  if (error) throw new Error(error.message);
}

export async function fetchMyPaymentRequests(): Promise<PaymentRequest[]> {
  const { data, error } = await requireSupabase()
    .from('payment_requests')
    .select('*, plan:plans(name, slug, duration_days)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentRequest[];
}

export async function fetchMyPaymentTransactions(): Promise<PaymentTransaction[]> {
  const { data, error } = await requireSupabase()
    .from('payment_transactions')
    .select('id, payment_reference, amount_kobo, currency, payment_method, provider, status, verification_status, created_at, verified_at, activated_at, expires_at, failure_reason')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentTransaction[];
}

export async function fetchPremiumPublicConfiguration(): Promise<PremiumPublicConfiguration> {
  const { data, error } = await requireSupabase().rpc('get_premium_public_configuration');
  if (error) throw new Error(error.message);
  return data as PremiumPublicConfiguration;
}

export async function startAutomaticPayment(planSlug: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('paystack-initialize', {
    body: { planSlug }
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.clone().json();
      if (typeof body?.message === 'string') detail = body.message;
    } catch {
      // Keep the SDK error when the Edge Function returned a non-JSON response.
    }
    throw new Error(detail || 'Could not start the automatic payment.');
  }
  if (typeof data?.authorization_url !== 'string' || !data.authorization_url.startsWith('https://checkout.paystack.com/')) {
    throw new Error('The payment provider returned an invalid checkout link.');
  }
  return data.authorization_url;
}

export async function verifyAutomaticPayment(reference: string): Promise<'pending' | 'verified' | 'failed' | 'expired'> {
  const { data, error } = await requireSupabase().functions.invoke('paystack-verify', {
    body: { reference }
  });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.clone().json();
      if (typeof body?.error === 'string') detail = body.error;
    } catch {
      // Keep the SDK error when the Edge Function returned a non-JSON response.
    }
    throw new Error(detail || 'Could not verify this payment.');
  }
  if (!['pending', 'verified', 'failed', 'expired'].includes(data?.status)) {
    throw new Error('The payment provider returned an invalid verification status.');
  }
  return data.status;
}

export async function submitPaymentRequest(input: {
  planSlug: string;
  file: File;
  reference?: string;
  paymentDate: string;
  submittedAmountKobo: number;
}): Promise<PaymentRequest> {
  if (!ALLOWED_RECEIPT_TYPES.has(input.file.type)) {
    throw new Error('Choose a JPG, PNG, or PDF receipt.');
  }
  if (input.file.size <= 0 || input.file.size > MAX_PAYMENT_RECEIPT_BYTES) {
    throw new Error('Receipt must be smaller than 8 MB.');
  }

  const client = requireSupabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error('Sign in to submit a payment.');

  const extension = input.file.type === 'application/pdf' ? 'pdf' : input.file.type === 'image/png' ? 'png' : 'jpg';
  const receiptPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await client.storage
    .from(PAYMENT_RECEIPTS_BUCKET)
    .upload(receiptPath, input.file, { contentType: input.file.type, upsert: false });
  if (uploadError) throw new Error(`Receipt upload failed: ${uploadError.message}`);

  const { data, error } = await client.rpc('submit_payment_request', {
    p_plan_slug: input.planSlug,
    p_receipt_path: receiptPath,
    p_payment_reference: input.reference?.trim() || null,
    p_payment_date: input.paymentDate,
    p_submitted_amount_kobo: input.submittedAmountKobo,
    p_payment_method: 'bank_transfer'
  });
  if (error) {
    const { error: cleanupError } = await client.storage.from(PAYMENT_RECEIPTS_BUCKET).remove([receiptPath]);
    if (cleanupError) console.error('Could not remove orphaned payment receipt:', cleanupError.message);
    throw new Error(error.message);
  }
  return data as PaymentRequest;
}

export async function fetchPaymentRequests(input: {
  query: string;
  status: 'all' | 'pending' | 'approved' | 'rejected';
  planId: string | null;
  fromDate: string | null;
  toDate: string | null;
  limit: number;
  offset: number;
}): Promise<AdminPaymentRequest[]> {
  const { data, error } = await requireSupabase().rpc('admin_list_payment_requests', {
    p_query: input.query,
    p_status: input.status,
    p_plan_id: input.planId,
    p_from: input.fromDate,
    p_to: input.toDate,
    p_limit: input.limit,
    p_offset: input.offset
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminPaymentRequest[];
}

export async function getPaymentReceiptUrl(path: string): Promise<string> {
  const { data, error } = await requireSupabase()
    .storage.from(PAYMENT_RECEIPTS_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open this receipt.');
  return data.signedUrl;
}

export async function reviewPaymentRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<void> {
  const { error } = await requireSupabase().rpc('review_payment_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_rejection_reason: rejectionReason?.trim() || null
  });
  if (error) throw new Error(error.message);
}

export interface UserWalletBalance {
  wallet_id: string | null;
  currency: string;
  available_kobo: number;
  pending_kobo: number;
  total_kobo: number;
  is_frozen: boolean;
  frozen_reason?: string | null;
}

export async function fetchMyWalletBalance(): Promise<UserWalletBalance> {
  const { data, error } = await requireSupabase().rpc('mp_wallet_get');
  if (error) throw new Error(error.message);
  return data as UserWalletBalance;
}

export async function payPremiumPlanFromWallet(planSlug: string): Promise<{
  success: boolean;
  plan_name: string;
  amount_kobo: number;
  balance_after_kobo: number;
  expires_at: string;
  reference: string;
}> {
  const { data, error } = await requireSupabase().rpc('pay_premium_plan_from_wallet', {
    p_plan_slug: planSlug
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function refundPaymentTransactionToWallet(
  transactionId: string,
  reason: string
): Promise<{ success: boolean; refunded_amount_kobo: number; balance_after_kobo: number }> {
  const { data, error } = await requireSupabase().rpc('refund_payment_transaction_to_wallet', {
    p_transaction_id: transactionId,
    p_reason: reason
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function giftPremiumPlanFromWallet(
  recipientIdentifier: string,
  planSlug: string = 'semester-access'
): Promise<{
  success: boolean;
  recipient_name: string;
  recipient_matric: string;
  plan_name: string;
  amount_kobo: number;
  expires_at: string;
  reference: string;
}> {
  const { data, error } = await requireSupabase().rpc('gift_premium_plan_from_wallet', {
    p_recipient_identifier: recipientIdentifier,
    p_plan_slug: planSlug
  });
  if (error) throw new Error(error.message);
  return data;
}


