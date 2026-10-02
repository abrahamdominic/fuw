import { requireSupabase } from './supabase';

export const PAYMENT_RECEIPTS_BUCKET = 'payment-receipts';
export const MAX_PAYMENT_RECEIPT_BYTES = 8 * 1024 * 1024;
export const PAYMENT_CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD'] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];
const ALLOWED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export interface PaymentConfiguration {
  active: boolean;
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

export const EMPTY_PAYMENT_CONFIGURATION: PaymentConfiguration = {
  active: false,
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
  return { ...EMPTY_PAYMENT_CONFIGURATION, ...(data as Partial<PaymentConfiguration>) };
}

export async function savePaymentConfiguration(
  configuration: PaymentConfiguration,
  premiumPlanSlug: string,
  priceKobo: number
): Promise<void> {
  const { error } = await requireSupabase().rpc('save_payment_configuration', {
    p_configuration: configuration,
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

export async function submitPaymentRequest(input: {
  planSlug: string;
  file: File;
  reference?: string;
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
    p_payment_reference: input.reference?.trim() || null
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
