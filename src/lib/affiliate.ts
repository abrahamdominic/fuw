import { requireSupabase } from './supabase';

export interface AffiliateStats {
  is_course_rep: boolean;
  course_rep_level?: string | null;
  referral_code: string;
  total_referrals: number;
  converted_referrals: number;
  total_earned_kobo: number;
  available_wallet_kobo: number;
  has_plus_lifetime: boolean;
  commission_rate_percent: number;
}

export async function fetchAffiliateStats(userId?: string): Promise<AffiliateStats> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_affiliate_dashboard_stats', {
    p_user_id: userId || null
  });
  if (error) throw new Error(error.message);
  return data as AffiliateStats;
}

export async function generateMyReferralCode(userId?: string): Promise<string> {
  const client = requireSupabase();
  let targetId = userId;
  if (!targetId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error('Sign in required');
    targetId = user.id;
  }
  const { data, error } = await client.rpc('generate_user_referral_code', {
    p_user_id: targetId
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function applyReferralCode(code: string): Promise<{
  success: boolean;
  referrer_name?: string;
  referral_code?: string;
  message?: string;
}> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('apply_referral_code', {
    p_code: code
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function requestAffiliateWithdrawal(input: {
  amountKobo: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<any> {
  const client = requireSupabase();
  // Uses existing centralized wallet withdrawal RPC
  const { data, error } = await client.rpc('mp_wallet_withdraw', {
    p_amount_kobo: input.amountKobo,
    p_bank_name: input.bankName,
    p_account_number: input.accountNumber,
    p_account_name: input.accountName
  });
  if (error) throw new Error(error.message);
  return data;
}
