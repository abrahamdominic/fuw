import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Snowflake,
  Lock,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
  Building,
  Check,
} from 'lucide-react';
import { WalletFundSuccessModal, WalletWithdrawSuccessModal } from '../components/WalletTransactionModals';
import {
  fetchMyWallet,
  fetchWalletStatement,
  fundWalletWithPaystack,
  verifyWalletFunding,
  fetchNigerianBanks,
  resolveBankAccount,
  requestWalletWithdrawal,
  fetchMyWithdrawals,
  type NigerianBank,
  type WalletWithdrawalItem,
} from '../lib/api';
import type { MarketplaceLedgerEntry, MarketplaceWallet } from '../lib/types';
import { formatDate, formatNaira, formatTimeAgo } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { mpPath } from '../lib/routes';

const PAGE_SIZE = 25;
const MIN_FUNDING_NAIRA = 100;
const MAX_FUNDING_NAIRA = 500000;
const MIN_WITHDRAW_NAIRA = 500;
const MAX_WITHDRAW_NAIRA = 500000;
const PRESET_AMOUNTS = [1000, 2000, 5000, 10000, 20000];

export const WalletPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Customized modal states for funding & withdrawal celebrations
  const [fundingSuccessModal, setFundingSuccessModal] = useState<{
    open: boolean;
    amountKobo: number;
    newBalanceKobo?: number;
    reference: string;
  } | null>(null);

  const [withdrawalSuccessModal, setWithdrawalSuccessModal] = useState<{
    open: boolean;
    amountKobo: number;
    feeKobo: number;
    netKobo: number;
    bankName: string;
    accountName: string;
    accountNumber: string;
    reference: string;
  } | null>(null);

  const [wallet, setWallet] = useState<MarketplaceWallet | null>(null);
  const [entries, setEntries] = useState<MarketplaceLedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active surfaces
  const [activeAction, setActiveAction] = useState<'fund' | 'withdraw'>('fund');
  const [activeListTab, setActiveListTab] = useState<'ledger' | 'withdrawals'>('ledger');

  // Funding state
  const [fundAmount, setFundAmount] = useState<string>('2000');
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);

  // Bank Withdrawal state (pay.md Phase 4.3)
  const [banks, setBanks] = useState<NigerianBank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [selectedBankCode, setSelectedBankCode] = useState('');
  const [selectedBankName, setSelectedBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [resolvingAccount, setResolvingAccount] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('5000');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  // One key per logical attempt: a double-tap or a retry of the same request
  // replays instead of debiting the wallet and paying out twice. Any change to
  // the form starts a fresh attempt.
  const withdrawalAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    withdrawalAttemptRef.current = null;
  }, [withdrawAmount, accountNumber, selectedBankCode]);

  // Withdrawals history state
  const [withdrawals, setWithdrawals] = useState<WalletWithdrawalItem[]>([]);
  const [withdrawalsTotal, setWithdrawalsTotal] = useState(0);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);

  // Verification state for returns from Paystack
  const [verifying, setVerifying] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<{
    type: 'success' | 'pending' | 'error';
    message: string;
  } | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (from: number) => {
    const [w, page] = await Promise.all([
      fetchMyWallet(),
      fetchWalletStatement(PAGE_SIZE, from),
    ]);
    if (!isMountedRef.current || typeof window === 'undefined') return;
    setWallet(w);
    setTotal(page.total);
    setEntries((prev) => (from === 0 ? page.entries : [...prev, ...page.entries]));
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    load(0)
      .catch((e) => {
        if (isMountedRef.current && typeof window !== 'undefined') setError(e?.message || 'Could not load your wallet.');
      })
      .finally(() => {
        if (isMountedRef.current && typeof window !== 'undefined') setLoading(false);
      });
  }, [user, load]);

  // Handle callback return from Paystack (Section 13, 14)
  useEffect(() => {
    const reference = searchParams.get('reference') || searchParams.get('trxref');
    if (!reference || !reference.startsWith('fuw_fund_')) return;

    setVerifying(true);
    verifyWalletFunding(reference)
      .then((res) => {
        if (res.status === 'succeeded') {
          const creditedKobo = res.amount_kobo ?? Math.round(Number(fundAmount || '2000') * 100);
          setFundingSuccessModal({
            open: true,
            amountKobo: creditedKobo,
            newBalanceKobo: (wallet?.available_kobo ?? 0) + creditedKobo,
            reference,
          });
          setVerificationNotice({
            type: 'success',
            message: `Payment confirmed! ₦${(creditedKobo / 100).toLocaleString()} credited to your wallet.`,
          });
          // Refresh wallet balance and statement
          load(0).catch(() => undefined);
        } else if (res.status === 'pending') {
          setVerificationNotice({
            type: 'pending',
            message: 'Payment received and is being verified by the server. Your balance will update shortly.',
          });
        } else {
          setVerificationNotice({
            type: 'error',
            message: res.reason || 'Payment could not be completed.',
          });
        }
      })
      .catch((err) => {
        setVerificationNotice({
          type: 'error',
          message: err?.message || 'Failed to verify payment status.',
        });
      })
      .finally(() => {
        setVerifying(false);
        // Clean query params so user doesn't re-trigger on refresh
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('reference');
        nextParams.delete('trxref');
        nextParams.delete('funding');
        setSearchParams(nextParams, { replace: true });
      });
  }, [searchParams, setSearchParams, load]);

  const loadMore = async () => {
    const next = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      await load(next);
      setOffset(next);
    } catch {
      // Keep existing entries
    } finally {
      setLoadingMore(false);
    }
  };

  const handleFundWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setFundingError(null);

    const amountNaira = Number(fundAmount);
    if (!Number.isFinite(amountNaira) || amountNaira < MIN_FUNDING_NAIRA) {
      setFundingError(`Minimum funding amount is ₦${MIN_FUNDING_NAIRA.toLocaleString()}.`);
      return;
    }
    if (amountNaira > MAX_FUNDING_NAIRA) {
      setFundingError(`Maximum funding amount per transaction is ₦${MAX_FUNDING_NAIRA.toLocaleString()}.`);
      return;
    }

    const amountKobo = Math.round(amountNaira * 100);
    setFundingLoading(true);

    try {
      const res = await fundWalletWithPaystack(amountKobo);
      if (res?.authorization_url) {
        window.location.assign(res.authorization_url);
      } else {
        throw new Error('Paystack did not provide a checkout URL.');
      }
    } catch (err: any) {
      setFundingError(err?.message || 'Could not start card funding. Please try again.');
      setFundingLoading(false);
    }
  };

  const getWithdrawalFee = (amountNaira: number) => {
    if (amountNaira <= 5000) return 25;
    if (amountNaira <= 50000) return 50;
    return 100;
  };

  const loadBanks = useCallback(async () => {
    if (banks.length > 0) return;
    setLoadingBanks(true);
    try {
      const list = await fetchNigerianBanks();
      setBanks(list);
      if (list.length > 0) {
        setSelectedBankCode((prev) => prev || list[0].code);
        setSelectedBankName((prev) => prev || list[0].name);
      }
    } catch {
      const fallbackBanks: NigerianBank[] = [
        { name: 'Access Bank', code: '044', slug: 'access-bank' },
        { name: 'GTBank (Guaranty Trust Bank)', code: '058', slug: 'gtbank' },
        { name: 'Zenith Bank', code: '057', slug: 'zenith-bank' },
        { name: 'First Bank of Nigeria', code: '011', slug: 'first-bank-of-nigeria' },
        { name: 'United Bank for Africa (UBA)', code: '033', slug: 'united-bank-for-africa' },
        { name: 'Kuda Bank', code: '50211', slug: 'kuda-bank' },
        { name: 'OPay', code: '999992', slug: 'opay' },
        { name: 'Palmpay', code: '999991', slug: 'palmpay' },
        { name: 'Moniepoint MFB', code: '50515', slug: 'moniepoint-mfb' },
        { name: 'Fidelity Bank', code: '070', slug: 'fidelity-bank' },
        { name: 'Stanbic IBTC Bank', code: '221', slug: 'stanbic-ibtc-bank' },
        { name: 'Wema Bank', code: '035', slug: 'wema-bank' },
      ];
      setBanks(fallbackBanks);
      setSelectedBankCode((prev) => prev || fallbackBanks[0].code);
      setSelectedBankName((prev) => prev || fallbackBanks[0].name);
    } finally {
      setLoadingBanks(false);
    }
  }, [banks.length]);

  const loadWithdrawals = useCallback(async () => {
    setLoadingWithdrawals(true);
    try {
      const res = await fetchMyWithdrawals(25, 0);
      setWithdrawals(res.withdrawals);
      setWithdrawalsTotal(res.total);
    } catch (e: any) {
      console.warn('Could not load withdrawals:', e);
    } finally {
      setLoadingWithdrawals(false);
    }
  }, []);

  useEffect(() => {
    if (activeAction === 'withdraw' || activeListTab === 'withdrawals') {
      loadBanks();
      loadWithdrawals();
    }
  }, [activeAction, activeListTab, loadBanks, loadWithdrawals]);

  // Account number auto-resolver with Paystack (debounced)
  useEffect(() => {
    const clean = accountNumber.replace(/\D/g, '');
    if (clean.length === 10 && selectedBankCode) {
      let active = true;
      setResolvingAccount(true);
      setResolveError(null);
      const timer = setTimeout(() => {
        resolveBankAccount(clean, selectedBankCode)
          .then((res) => {
            if (active) setAccountName(res.account_name);
          })
          .catch((err) => {
            if (active) {
              setAccountName('');
              setResolveError(err.message || 'Could not verify account name. Check account number and bank.');
            }
          })
          .finally(() => {
            if (active) setResolvingAccount(false);
          });
      }, 400);

      return () => {
        active = false;
        clearTimeout(timer);
      };
    } else {
      setAccountName('');
      setResolveError(null);
      setResolvingAccount(false);
    }
  }, [accountNumber, selectedBankCode]);

  const handleWithdrawalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);
    setWithdrawSuccess(null);

    const amountNaira = Number(withdrawAmount);
    if (!Number.isFinite(amountNaira) || amountNaira < MIN_WITHDRAW_NAIRA) {
      setWithdrawError(`Minimum withdrawal amount is ₦${MIN_WITHDRAW_NAIRA.toLocaleString()}.`);
      return;
    }
    if (amountNaira > MAX_WITHDRAW_NAIRA) {
      setWithdrawError(`Maximum single withdrawal is ₦${MAX_WITHDRAW_NAIRA.toLocaleString()}.`);
      return;
    }

    const amountKobo = Math.round(amountNaira * 100);
    if (amountKobo > (wallet?.available_kobo ?? 0)) {
      setWithdrawError('Insufficient wallet balance to cover this withdrawal.');
      return;
    }

    if (!accountName || !selectedBankCode) {
      setWithdrawError('Please enter a valid 10-digit account number and verify the account name before continuing.');
      return;
    }

    setWithdrawing(true);
    try {
      withdrawalAttemptRef.current ??= crypto.randomUUID();
      const res = await requestWalletWithdrawal({
        amountKobo,
        bankCode: selectedBankCode,
        bankName: selectedBankName,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        idempotencyKey: withdrawalAttemptRef.current,
      });
      // The attempt is complete (success or provider rejection); the next
      // submission is a new attempt even if the form is unchanged.
      withdrawalAttemptRef.current = null;
      if (res.status === 'failed') {
        setWithdrawError(res.message || 'The transfer was rejected by the bank. Your wallet has been refunded in full.');
      } else {
        const feeNaira = getWithdrawalFee(amountNaira);
        const feeKobo = feeNaira * 100;
        const netKobo = Math.max(0, amountKobo - feeKobo);

        setWithdrawalSuccessModal({
          open: true,
          amountKobo,
          feeKobo,
          netKobo,
          bankName: selectedBankName || 'Nigerian Bank',
          accountName: accountName.trim(),
          accountNumber: accountNumber.trim(),
          reference: res.reference,
        });

        const statusNote = res.status === 'successful'
          ? 'Withdrawal completed and has been sent to your bank account.'
          : 'Withdrawal received. Funds are held while the bank transfer is confirmed.';
        setWithdrawSuccess(
          `${statusNote} ₦${amountNaira.toLocaleString()} is on its way to ${selectedBankName} (${accountName}). Ref: ${res.reference}`
        );
      }
      load(0);
      loadWithdrawals();
      setWithdrawAmount('5000');
    } catch (err: any) {
      setWithdrawError(err?.message || 'Withdrawal could not be processed.');
    } finally {
      setWithdrawing(false);
    }
  };

  if (!user) {
    return <EmptyState icon={<Lock size={28} />} title="Sign in to see your wallet" />;
  }

  const frozen = !!wallet?.is_frozen;
  const available = wallet?.available_kobo ?? 0;
  const pending = wallet?.pending_kobo ?? 0;

  const formatEntryLabel = (type: string) => {
    switch (type) {
      case 'wallet_funding':
        return 'Card Funding (Paystack)';
      case 'wallet_payment':
        return 'Marketplace Purchase';
      case 'elibrary_premium_purchase':
        return 'eLibrary Premium Plan';
      case 'refund':
      case 'refund_credit':
        return 'Refund';
      case 'advert_spend':
        return 'Advert Package';
      case 'vendor_earning':
        return 'Vendor Earning';
      case 'escrow_funded':
        return 'Escrow Hold';
      case 'manual_credit':
        return 'Adjustment (Credit)';
      case 'manual_debit':
        return 'Adjustment (Debit)';
      case 'withdrawal':
        return 'Bank Withdrawal';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const renderWithdrawalStatus = (status: WalletWithdrawalItem['status']) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      pending: { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
      processing: { bg: '#e0f2fe', color: '#0369a1', label: 'Processing' },
      successful: { bg: '#dcfce7', color: '#166534', label: 'Successful' },
      failed: { bg: '#fee2e2', color: '#991b1b', label: 'Failed' },
      reversed: { bg: '#f3e8ff', color: '#6b21a8', label: 'Reversed (Refunded)' },
    };
    const cfg = styles[status] || { bg: '#f3f4f6', color: '#374151', label: status };
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 700,
          backgroundColor: cfg.bg,
          color: cfg.color,
          textTransform: 'capitalize',
        }}
      >
        {cfg.label}
      </span>
    );
  };

  const maskAccountNumber = (num: string) => {
    if (!num || num.length < 4) return num;
    return `******${num.slice(-4)}`;
  };

  const currentWithdrawNaira = Number(withdrawAmount) || 0;
  const currentWithdrawFeeNaira = getWithdrawalFee(currentWithdrawNaira);
  const totalDebitNaira = currentWithdrawNaira + currentWithdrawFeeNaira;
  const totalDebitKobo = totalDebitNaira * 100;
  const remainingKobo = Math.max(0, available - totalDebitKobo);

  return (
    <div className="page-pad wallet-page" style={{ maxWidth: 1040, margin: '0 auto' }}>
      <div className="page-head" style={{ marginBottom: 24 }}>
        <span className="kicker">FUW Financial Core</span>
        <h1>Centralized FUW Wallet</h1>
        <p>
          One secure wallet for your FUW account. Fund with your debit or credit card and pay
          seamlessly across Marketplace products, eLibrary premium plans, and campus services.
        </p>
      </div>

      {verifying && (
        <div className="wallet-notice wallet-notice--info" style={{ marginBottom: 20 }}>
          <Loader2 size={18} className="animate-spin" />
          <div>
            <strong>Verifying your payment with Paystack…</strong>
            <span>Please wait while the server securely confirms your card transaction.</span>
          </div>
        </div>
      )}

      {verificationNotice && (
        <div
          className={`wallet-notice ${
            verificationNotice.type === 'success'
              ? 'wallet-notice--info'
              : verificationNotice.type === 'pending'
              ? 'wallet-notice--info'
              : ''
          }`}
          style={{
            marginBottom: 20,
            borderColor: verificationNotice.type === 'success' ? 'var(--primary, #12603d)' : undefined,
          }}
        >
          {verificationNotice.type === 'success' ? (
            <CheckCircle2 size={18} color="var(--primary, #12603d)" />
          ) : (
            <AlertCircle size={18} />
          )}
          <div>
            <strong>
              {verificationNotice.type === 'success'
                ? 'Payment Successful'
                : verificationNotice.type === 'pending'
                ? 'Payment Processing'
                : 'Payment Notice'}
            </strong>
            <span>{verificationNotice.message}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <div className="wallet-grid">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={104} borderRadius={14} />
          ))}
        </div>
      ) : (
        <>
          {/* Top balance summary cards */}
          <div className="wallet-grid">
            <div className="wallet-tile wallet-tile--primary">
              <span className="wallet-tile__label">Available Balance</span>
              <strong className="wallet-tile__value">{formatNaira(available)}</strong>
              <span className="wallet-tile__foot">
                {frozen
                  ? 'Frozen. Contact the support team.'
                  : 'Spendable across Marketplace & eLibrary.'}
              </span>
            </div>

            <div className="wallet-tile">
              <span className="wallet-tile__label">Pending Escrow</span>
              <strong className="wallet-tile__value">{formatNaira(pending)}</strong>
              <span className="wallet-tile__foot">
                Funds held in escrow during active orders or disputes.
              </span>
            </div>

            <div className="wallet-tile">
              <span className="wallet-tile__label">Lifetime Movement</span>
              <strong className="wallet-tile__value">
                {formatNaira(
                  (wallet?.lifetime_credit_kobo ?? 0) + (wallet?.lifetime_debit_kobo ?? 0)
                )}
              </strong>
              <span className="wallet-tile__foot">
                {formatNaira(wallet?.lifetime_credit_kobo ?? 0)} in ·{' '}
                {formatNaira(wallet?.lifetime_debit_kobo ?? 0)} out
              </span>
            </div>
          </div>

          {frozen && (
            <div className="wallet-notice" style={{ marginBottom: 24 }}>
              <Snowflake size={18} />
              <div>
                <strong>This wallet is frozen.</strong>
                <span>{wallet?.frozen_reason || 'Contact the platform team for assistance.'}</span>
              </div>
              <Link to={mpPath('/vendor/support')} className="btn btn-secondary btn-sm">
                Contact support
              </Link>
            </div>
          )}

          {/* Action Tabs: Fund vs Withdraw (pay.md Phase 4.3) */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 20,
              borderBottom: '1px solid var(--border, #dcebe0)',
              paddingBottom: 14,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveAction('fund')}
              className={`btn ${activeAction === 'fund' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              <CreditCard size={17} />
              Fund Wallet (Card)
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveAction('withdraw');
                loadBanks();
                loadWithdrawals();
              }}
              className={`btn ${activeAction === 'withdraw' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              <Building size={17} />
              Withdraw to Bank
            </button>
          </div>

          {activeAction === 'fund' ? (
            /* Section 3 & 4: Fund Wallet with Paystack Card */
            <section
              className="card"
              style={{
                padding: 24,
                marginBottom: 28,
                borderRadius: 'var(--radius-lg, 14px)',
                background: 'var(--surface, #ffffff)',
                border: '1px solid var(--border, #dcebe0)',
                boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(18, 41, 28, 0.05))',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                  paddingBottom: 14,
                  borderBottom: '1px solid var(--border, #dcebe0)',
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 800,
                      color: 'var(--text-primary, #17231d)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <CreditCard size={20} color="var(--primary, #12603d)" />
                    Fund Wallet
                  </h2>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                    Fund your wallet instantly using your debit or credit card via Paystack.
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--primary, #12603d)',
                    background: 'var(--primary-bg, #e8f5ec)',
                    padding: '6px 10px',
                    borderRadius: 20,
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>Paystack Live Secured</span>
                </div>
              </div>

              {fundingError && (
                <div
                  className="wallet-notice"
                  style={{
                    marginBottom: 16,
                    padding: '10px 14px',
                    fontSize: 13,
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{fundingError}</span>
                </div>
              )}

              <form onSubmit={handleFundWallet}>
                <div style={{ marginBottom: 16 }}>
                  <label
                    htmlFor="fund-amount"
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      marginBottom: 8,
                      color: 'var(--text-primary, #17231d)',
                    }}
                  >
                    Amount to Fund (₦)
                  </label>

                  {/* Preset quick buttons */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    {PRESET_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setFundAmount(amt.toString())}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          border:
                            fundAmount === amt.toString()
                              ? '2px solid var(--primary, #12603d)'
                              : '1px solid var(--border, #dcebe0)',
                          background:
                            fundAmount === amt.toString()
                              ? 'var(--primary-bg, #e8f5ec)'
                              : 'var(--surface-alt, #f4f8f5)',
                          color:
                            fundAmount === amt.toString()
                              ? 'var(--primary, #12603d)'
                              : 'var(--text-primary, #17231d)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        +₦{amt.toLocaleString()}
                      </button>
                    ))}
                  </div>

                  <div style={{ position: 'relative', maxWidth: 360 }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 16,
                        fontWeight: 700,
                        color: 'var(--text-secondary, #55675b)',
                      }}
                    >
                      ₦
                    </span>
                    <input
                      id="fund-amount"
                      type="number"
                      min={MIN_FUNDING_NAIRA}
                      max={MAX_FUNDING_NAIRA}
                      step="100"
                      required
                      value={fundAmount}
                      onChange={(e) => setFundAmount(e.target.value)}
                      disabled={fundingLoading || frozen}
                      placeholder="Enter amount (min ₦100)"
                      style={{
                        width: '100%',
                        padding: '12px 14px 12px 32px',
                        borderRadius: 10,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 16,
                        fontWeight: 700,
                        background: 'var(--surface, #ffffff)',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 6,
                      fontSize: 12,
                      color: 'var(--text-secondary, #55675b)',
                    }}
                  >
                    Min: ₦{MIN_FUNDING_NAIRA.toLocaleString()} · Max: ₦{MAX_FUNDING_NAIRA.toLocaleString()} per transaction · Card payments only
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={fundingLoading || frozen || !fundAmount || Number(fundAmount) < MIN_FUNDING_NAIRA}
                    style={{
                      padding: '12px 24px',
                      fontSize: 14,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {fundingLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Connecting to Paystack…
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        Continue to Payment
                      </>
                    )}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                    <span>Supported cards:</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Visa · Mastercard · Verve</span>
                  </div>
                </div>
              </form>
            </section>
          ) : (
            /* Phase 4.3: Bank Withdrawal Form */
            <section
              className="card"
              style={{
                padding: 24,
                marginBottom: 28,
                borderRadius: 'var(--radius-lg, 14px)',
                background: 'var(--surface, #ffffff)',
                border: '1px solid var(--border, #dcebe0)',
                boxShadow: 'var(--shadow-sm, 0 2px 8px rgba(18, 41, 28, 0.05))',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                  paddingBottom: 14,
                  borderBottom: '1px solid var(--border, #dcebe0)',
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 800,
                      color: 'var(--text-primary, #17231d)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Building size={20} color="var(--primary, #12603d)" />
                    Withdraw to Bank Account
                  </h2>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                    Transfer your available FUW wallet balance directly to any verified Nigerian bank account.
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--primary, #12603d)',
                    background: 'var(--primary-bg, #e8f5ec)',
                    padding: '6px 10px',
                    borderRadius: 20,
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>NUBAN Verified Transfer</span>
                </div>
              </div>

              {withdrawSuccess && (
                <div
                  className="wallet-notice wallet-notice--info"
                  style={{
                    marginBottom: 16,
                    padding: '12px 16px',
                    fontSize: 13,
                    borderColor: 'var(--primary, #12603d)',
                  }}
                >
                  <CheckCircle2 size={18} color="var(--primary, #12603d)" />
                  <div>
                    <strong>Withdrawal Initiated</strong>
                    <span>{withdrawSuccess}</span>
                  </div>
                </div>
              )}

              {withdrawError && (
                <div
                  className="wallet-notice"
                  style={{
                    marginBottom: 16,
                    padding: '10px 14px',
                    fontSize: 13,
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{withdrawError}</span>
                </div>
              )}

              <form onSubmit={handleWithdrawalSubmit}>
                {/* Bank selector & Account number */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label
                      htmlFor="withdraw-bank"
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 700,
                        marginBottom: 8,
                        color: 'var(--text-primary, #17231d)',
                      }}
                    >
                      Select Bank
                    </label>
                    <select
                      id="withdraw-bank"
                      value={selectedBankCode}
                      onChange={(e) => {
                        const code = e.target.value;
                        setSelectedBankCode(code);
                        const b = banks.find((item) => item.code === code);
                        setSelectedBankName(b ? b.name : '');
                      }}
                      disabled={withdrawing || frozen || loadingBanks}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: 10,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: 'var(--surface, #ffffff)',
                      }}
                    >
                      {loadingBanks ? (
                        <option value="">Loading Nigerian banks…</option>
                      ) : (
                        banks.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="withdraw-acc"
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 700,
                        marginBottom: 8,
                        color: 'var(--text-primary, #17231d)',
                      }}
                    >
                      10-Digit NUBAN Account Number
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="withdraw-acc"
                        type="text"
                        maxLength={10}
                        inputMode="numeric"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                        disabled={withdrawing || frozen}
                        placeholder="e.g. 0123456789"
                        style={{
                          width: '100%',
                          padding: '11px 14px',
                          paddingRight: resolvingAccount ? 40 : 14,
                          borderRadius: 10,
                          border: '1px solid var(--border, #dcebe0)',
                          fontSize: 15,
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                          background: 'var(--surface, #ffffff)',
                        }}
                      />
                      {resolvingAccount && (
                        <span
                          style={{
                            position: 'absolute',
                            right: 12,
                            top: '50%',
                            transform: 'translateY(-50%)',
                          }}
                        >
                          <Loader2 size={16} className="animate-spin" color="var(--primary, #12603d)" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Resolved account name banner */}
                {accountName && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: 'var(--primary-bg, #e8f5ec)',
                      border: '1px solid var(--primary, #12603d)',
                      color: 'var(--primary, #12603d)',
                      marginBottom: 16,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    <Check size={16} />
                    <span>Verified Account Name: {accountName}</span>
                  </div>
                )}

                {resolveError && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: '#fee2e2',
                      border: '1px solid #ef4444',
                      color: '#991b1b',
                      marginBottom: 16,
                      fontSize: 13,
                    }}
                  >
                    {resolveError}
                  </div>
                )}

                {/* Amount to withdraw */}
                <div style={{ marginBottom: 16 }}>
                  <label
                    htmlFor="withdraw-amount"
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      marginBottom: 8,
                      color: 'var(--text-primary, #17231d)',
                    }}
                  >
                    Amount to Withdraw (₦)
                  </label>

                  {/* Preset quick buttons */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    {[2000, 5000, 10000, 20000, 50000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setWithdrawAmount(amt.toString())}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          border:
                            withdrawAmount === amt.toString()
                              ? '2px solid var(--primary, #12603d)'
                              : '1px solid var(--border, #dcebe0)',
                          background:
                            withdrawAmount === amt.toString()
                              ? 'var(--primary-bg, #e8f5ec)'
                              : 'var(--surface-alt, #f4f8f5)',
                          color:
                            withdrawAmount === amt.toString()
                              ? 'var(--primary, #12603d)'
                              : 'var(--text-primary, #17231d)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        ₦{amt.toLocaleString()}
                      </button>
                    ))}
                  </div>

                  <div style={{ position: 'relative', maxWidth: 360 }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 16,
                        fontWeight: 700,
                        color: 'var(--text-secondary, #55675b)',
                      }}
                    >
                      ₦
                    </span>
                    <input
                      id="withdraw-amount"
                      type="number"
                      min={MIN_WITHDRAW_NAIRA}
                      max={MAX_WITHDRAW_NAIRA}
                      step="100"
                      required
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      disabled={withdrawing || frozen}
                      placeholder="Enter amount (min ₦500)"
                      style={{
                        width: '100%',
                        padding: '12px 14px 12px 32px',
                        borderRadius: 10,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 16,
                        fontWeight: 700,
                        background: 'var(--surface, #ffffff)',
                      }}
                    />
                  </div>
                </div>

                {/* Fee Breakdown Box */}
                <div
                  style={{
                    background: 'var(--surface-alt, #f4f8f5)',
                    borderRadius: 10,
                    padding: '14px 18px',
                    marginBottom: 20,
                    border: '1px solid var(--border, #dcebe0)',
                    fontSize: 13,
                    maxWidth: 480,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-secondary, #55675b)' }}>Amount to transfer:</span>
                    <strong>₦{currentWithdrawNaira.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-secondary, #55675b)' }}>Transfer fee:</span>
                    <span>₦{currentWithdrawFeeNaira.toLocaleString()}</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingTop: 8,
                      borderTop: '1px solid var(--border, #dcebe0)',
                      fontWeight: 700,
                    }}
                  >
                    <span>Total debited from wallet:</span>
                    <span style={{ color: 'var(--primary, #12603d)', fontSize: 14 }}>
                      ₦{totalDebitNaira.toLocaleString()}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: totalDebitKobo > available ? '#991b1b' : 'var(--text-secondary, #55675b)',
                    }}
                  >
                    {totalDebitKobo > available ? (
                      <strong>Insufficient available balance (Available: {formatNaira(available)})</strong>
                    ) : (
                      <span>Remaining balance: {formatNaira(remainingKobo)}</span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      withdrawing ||
                      frozen ||
                      !accountName ||
                      !selectedBankCode ||
                      totalDebitKobo > available ||
                      currentWithdrawNaira < MIN_WITHDRAW_NAIRA ||
                      currentWithdrawNaira > MAX_WITHDRAW_NAIRA
                    }
                    style={{
                      padding: '12px 24px',
                      fontSize: 14,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {withdrawing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Processing Withdrawal…
                      </>
                    ) : (
                      <>
                        <Building size={16} />
                        Confirm & Withdraw ₦{currentWithdrawNaira.toLocaleString()}
                      </>
                    )}
                  </button>

                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                    Min: ₦{MIN_WITHDRAW_NAIRA.toLocaleString()} · Max: ₦{MAX_WITHDRAW_NAIRA.toLocaleString()} · Processed via NIBSS/Paystack
                  </span>
                </div>
              </form>
            </section>
          )}

          {/* Transaction History / Withdrawal Switcher (pay.md Phase 4.3) */}
          <section className="card wallet-statement" style={{ borderRadius: 'var(--radius-lg, 14px)', overflow: 'hidden' }}>
            <div
              className="card-head"
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border, #dcebe0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setActiveListTab('ledger')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    border: 'none',
                    background: activeListTab === 'ledger' ? 'var(--primary-bg, #e8f5ec)' : 'transparent',
                    color: activeListTab === 'ledger' ? 'var(--primary, #12603d)' : 'var(--text-secondary, #55675b)',
                    cursor: 'pointer',
                  }}
                >
                  Transaction Ledger ({total})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveListTab('withdrawals');
                    loadWithdrawals();
                  }}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    border: 'none',
                    background: activeListTab === 'withdrawals' ? 'var(--primary-bg, #e8f5ec)' : 'transparent',
                    color: activeListTab === 'withdrawals' ? 'var(--primary, #12603d)' : 'var(--text-secondary, #55675b)',
                    cursor: 'pointer',
                  }}
                >
                  Withdrawal History ({withdrawalsTotal})
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (activeListTab === 'ledger') {
                    load(0);
                  } else {
                    loadWithdrawals();
                  }
                }}
                className="btn btn-secondary btn-sm"
                title="Refresh statement"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <RefreshCw size={13} />
                Refresh
              </button>
            </div>

            {activeListTab === 'ledger' ? (
              <>
                {entries.length === 0 ? (
                  <EmptyState
                    icon={<Wallet size={26} />}
                    title="No transactions yet"
                    description="Your wallet funding, purchases, withdrawals, and refunds will appear here in your ledger."
                  />
                ) : (
                  <ul className="wallet-ledger">
                    {entries.map((e) => {
                      const credit = e.direction === 'credit';
                      return (
                        <li key={e.id} className="wallet-ledger__row" style={{ padding: '14px 20px' }}>
                          <span className={`wallet-ledger__icon ${credit ? 'is-credit' : 'is-debit'}`}>
                            {credit ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                          </span>

                          <span className="wallet-ledger__main" style={{ flex: 1 }}>
                            <strong style={{ display: 'block', fontSize: 14 }}>
                              {e.description || formatEntryLabel(e.entry_type)}
                            </strong>
                            <span className="wallet-ledger__meta" style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                              {formatEntryLabel(e.entry_type)} · {formatDate(e.created_at)}
                              {e.provider && <> · Provider: {e.provider}</>}
                              {e.provider_reference && <> · Ref: {e.provider_reference}</>}
                            </span>
                          </span>

                          <span className="wallet-ledger__amount" style={{ textAlign: 'right' }}>
                            <strong
                              className={credit ? 'is-credit' : 'is-debit'}
                              style={{ display: 'block', fontSize: 15, fontWeight: 800 }}
                            >
                              {credit ? '+' : '−'}{formatNaira(e.amount_kobo)}
                            </strong>
                            <span className="wallet-ledger__balance" style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                              Balance: {formatNaira(e.balance_after)} · {formatTimeAgo(e.created_at)}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {entries.length < total && (
                  <div className="wallet-statement__more" style={{ padding: 16, textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={loadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, total - offset)} more`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {loadingWithdrawals ? (
                  <div style={{ padding: 20 }}>
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} height={64} borderRadius={8} style={{ marginBottom: 12 }} />
                    ))}
                  </div>
                ) : withdrawals.length === 0 ? (
                  <EmptyState
                    icon={<Building size={26} />}
                    title="No bank withdrawals yet"
                    description="When you withdraw funds to your Nigerian bank account, tracking details and transfer status will appear here."
                  />
                ) : (
                  <ul className="wallet-ledger">
                    {withdrawals.map((w) => (
                      <li key={w.id} className="wallet-ledger__row" style={{ padding: '14px 20px' }}>
                        <span className="wallet-ledger__icon is-debit">
                          <ArrowUpRight size={16} />
                        </span>

                        <span className="wallet-ledger__main" style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                            <strong style={{ fontSize: 14 }}>
                              {w.bank_name} · {maskAccountNumber(w.account_number)}
                            </strong>
                            {renderWithdrawalStatus(w.status)}
                          </div>
                          <span className="wallet-ledger__meta" style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                            Recipient: {w.account_name} · Requested {formatDate(w.created_at)}
                            {w.reference && <> · Ref: {w.reference}</>}
                            {w.transfer_code && <> · Transfer: {w.transfer_code}</>}
                            {w.failure_reason && (
                              <span style={{ color: '#991b1b', display: 'block', marginTop: 2 }}>
                                Reason: {w.failure_reason}
                              </span>
                            )}
                          </span>
                        </span>

                        <span className="wallet-ledger__amount" style={{ textAlign: 'right' }}>
                          <strong className="is-debit" style={{ display: 'block', fontSize: 15, fontWeight: 800 }}>
                            −{formatNaira(w.amount_kobo)}
                          </strong>
                          <span className="wallet-ledger__balance" style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                            Fee: {formatNaira(w.fee_kobo)} · {formatTimeAgo(w.created_at)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* Customized Modals for Wallet Funding and Bank Withdrawal */}
      {fundingSuccessModal && (
        <WalletFundSuccessModal
          isOpen={fundingSuccessModal.open}
          onClose={() => setFundingSuccessModal(null)}
          amountKobo={fundingSuccessModal.amountKobo}
          newBalanceKobo={fundingSuccessModal.newBalanceKobo}
          reference={fundingSuccessModal.reference}
          onExploreMarketplace={() => {
            setFundingSuccessModal(null);
            navigate(mpPath('/browse'));
          }}
        />
      )}

      {withdrawalSuccessModal && (
        <WalletWithdrawSuccessModal
          isOpen={withdrawalSuccessModal.open}
          onClose={() => setWithdrawalSuccessModal(null)}
          amountKobo={withdrawalSuccessModal.amountKobo}
          feeKobo={withdrawalSuccessModal.feeKobo}
          netKobo={withdrawalSuccessModal.netKobo}
          bankName={withdrawalSuccessModal.bankName}
          accountName={withdrawalSuccessModal.accountName}
          accountNumber={withdrawalSuccessModal.accountNumber}
          reference={withdrawalSuccessModal.reference}
        />
      )}
    </div>
  );
};
