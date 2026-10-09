// StudentAffiliateTab.tsx — Course Rep & Student Affiliate Program UI
import React, { useState, useEffect } from 'react';
import {
  Users,
  Award,
  TrendingUp,
  Copy,
  Check,
  Share2,
  Wallet,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  Loader2,
  DollarSign,
  Gift,
  MessageCircle
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../components/Toast';
import {
  fetchAffiliateStats,
  generateMyReferralCode,
  applyReferralCode,
  requestAffiliateWithdrawal,
  type AffiliateStats
} from '../lib/affiliate';
import { formatNaira } from '../marketplace/lib/format';
import { BankResolutionInput, BankResolutionDetails } from '../components/BankResolutionInput';

export function StudentAffiliateTab() {
  const { profile, user } = useAuth();
  const { toast } = useToast();

  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Apply referral code state
  const [inputCode, setInputCode] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [appliedReferrer, setAppliedReferrer] = useState<string | null>(null);

  // Withdrawal modal state
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [bankDetails, setBankDetails] = useState<BankResolutionDetails>({
    bankCode: '',
    bankName: '',
    accountNumber: '',
    accountName: '',
    isVerified: false
  });
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchAffiliateStats(user?.id);
      setStats(data);
    } catch (err: any) {
      toast(err.message || 'Could not load affiliate metrics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.id]);

  const referralCode = stats?.referral_code || '';
  const referralLink = typeof window !== 'undefined' && referralCode
    ? `${window.location.origin}/register?ref=${referralCode}`
    : '';

  const handleCopyCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopiedCode(true);
      toast('Referral code copied to clipboard!', 'success');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast('Failed to copy code. Please copy manually.', 'error');
    }
  };

  const handleCopyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopiedLink(true);
      toast('Referral link copied to clipboard!', 'success');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast('Failed to copy link. Please copy manually.', 'error');
    }
  };

  const handleShare = async () => {
    if (!referralLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join FUW Campus Hub',
          text: `Use my invite code ${referralCode} to register on FUW Campus Hub for exam materials, CBT prep, and marketplace perks!`,
          url: referralLink
        });
      } catch {
        // Share cancelled or failed
      }
    } else {
      handleCopyLink();
    }
  };

  const handleWhatsAppShare = () => {
    if (!referralLink) return;
    const msg = `Join me on FUW Campus Hub for verified lecture notes, past questions, CGPA calculator, and student accommodation! Register using my link: ${referralLink}`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };

  const handleApplyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;
    try {
      setApplyingCode(true);
      const res = await applyReferralCode(inputCode.trim());
      if (res.success) {
        toast(`Referral code applied! Referred by ${res.referrer_name || 'Student'}.`, 'success');
        setAppliedReferrer(res.referrer_name || 'Verified Ambassador');
        setInputCode('');
        loadData();
      }
    } catch (err: any) {
      toast(err.message || 'Could not apply referral code.', 'error');
    } finally {
      setApplyingCode(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount < 500) {
      toast('Minimum withdrawal amount is ₦500.', 'error');
      return;
    }
    if (!bankDetails.isVerified || !bankDetails.accountName) {
      toast('Please enter a valid bank and account number verified by Paystack.', 'error');
      return;
    }
    const amountKobo = Math.round(amount * 100);
    if (stats && amountKobo > stats.available_wallet_kobo) {
      toast('Withdrawal amount exceeds your available wallet balance.', 'error');
      return;
    }

    try {
      setWithdrawing(true);
      await requestAffiliateWithdrawal({
        amountKobo,
        bankName: bankDetails.bankName,
        accountNumber: bankDetails.accountNumber,
        accountName: bankDetails.accountName
      });
      toast(`Withdrawal request of ₦${amount.toLocaleString()} submitted successfully!`, 'success');
      setShowWithdrawModal(false);
      setWithdrawAmount('');
      loadData();
    } catch (err: any) {
      toast(err.message || 'Could not process withdrawal request.', 'error');
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading && !stats) {
    return (
      <div className="portal-card" style={{ padding: '3rem', textAlign: 'center' }}>
        <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 1rem', color: 'var(--brand-green, #12603d)' }} />
        <p style={{ color: 'var(--text-secondary, #55675b)' }}>Loading affiliate metrics...</p>
      </div>
    );
  }

  const convertedCount = stats?.converted_referrals ?? 0;
  const milestoneTarget = 5;
  const milestoneProgress = Math.min(100, Math.round((convertedCount / milestoneTarget) * 100));
  const hasLifetimePlus = stats?.has_plus_lifetime || convertedCount >= milestoneTarget;

  return (
    <div className="student-affiliate-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Top Banner / Header */}
      <div
        className="portal-card"
        style={{
          background: 'linear-gradient(135deg, #12603d 0%, #0d462c 100%)',
          color: '#ffffff',
          padding: '2rem 1.75rem',
          borderRadius: '16px',
          boxShadow: '0 4px 20px rgba(18, 96, 61, 0.15)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                <Award size={14} />
                {stats?.is_course_rep
                  ? `Official Course Rep · ${stats.course_rep_level || profile?.level || ''}`
                  : 'Student Partner'}
              </span>
              {hasLifetimePlus && (
                <span
                  style={{
                    background: '#fbbf24',
                    color: '#78350f',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Sparkles size={13} /> Plus Lifetime Unlocked
                </span>
              )}
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 8px', color: '#ffffff' }}>
              Course Rep &amp; Student Affiliate Program
            </h1>
            <p style={{ margin: 0, opacity: 0.9, fontSize: '0.95rem', maxWidth: '620px', lineHeight: 1.5 }}>
              Earn <strong>10% instant commission</strong> (₦120 per student) on every Campus Hub Plus subscription and vendor onboarding. Refer 5 students to unlock permanent <strong>Lifetime Plus</strong> access for yourself!
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowWithdrawModal(true)}
            style={{
              background: '#ffffff',
              color: '#12603d',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}
          >
            <Wallet size={16} /> Withdraw Earnings
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
        <div className="portal-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', fontWeight: 600 }}>Total Referrals</span>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eff6ff', color: '#2563eb', display: 'grid', placeItems: 'center' }}>
              <Users size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#111827' }}>
            {stats?.total_referrals ?? 0}
          </div>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>Registered student accounts</span>
        </div>

        <div className="portal-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', fontWeight: 600 }}>Plus Conversions</span>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#ecfdf5', color: '#059669', display: 'grid', placeItems: 'center' }}>
              <TrendingUp size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#059669' }}>
            {convertedCount}
          </div>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>Subscribed to Campus Hub Plus</span>
        </div>

        <div className="portal-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', fontWeight: 600 }}>Total Commissions</span>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fef3c7', color: '#d97706', display: 'grid', placeItems: 'center' }}>
              <DollarSign size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#111827' }}>
            {formatNaira(stats?.total_earned_kobo ?? 0)}
          </div>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>All-time 10% earned</span>
        </div>

        <div className="portal-card" style={{ padding: '1.25rem', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border, #e5e7eb)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #6b7280)', fontWeight: 600 }}>Available in Wallet</span>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#e0e7ff', color: '#4f46e5', display: 'grid', placeItems: 'center' }}>
              <Wallet size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#4f46e5' }}>
            {formatNaira(stats?.available_wallet_kobo ?? 0)}
          </div>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>Ready for bank payout</span>
        </div>
      </div>

      {/* Shareable Code & Link Card */}
      <div className="portal-card" style={{ padding: '1.5rem', background: '#ffffff', borderRadius: '14px', border: '1px solid var(--border, #dcebe0)' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 1rem', color: '#17231d' }}>
          Your Ambassador Referral Link &amp; Code
        </h3>
        <p style={{ fontSize: '0.9rem', color: '#55675b', margin: '0 0 1.25rem' }}>
          Share your custom referral code or full link directly into your departmental and course WhatsApp groups. Any student who registers with your code earns you commission automatically on subscription purchases.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          {/* Referral Code Box */}
          <div style={{ padding: '1rem', background: '#f8faf9', borderRadius: '10px', border: '1px dashed #12603d' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#55675b', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
              Your Unique Referral Code
            </span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '0.1em', color: '#12603d', fontFamily: 'monospace' }}>
                {referralCode || 'GENERATING...'}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="btn-secondary"
                style={{ padding: '6px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                {copiedCode ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                {copiedCode ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Referral Link Box */}
          <div style={{ padding: '1rem', background: '#f8faf9', borderRadius: '10px', border: '1px solid #dcebe0' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#55675b', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
              Full Registration Link
            </span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span
                style={{
                  fontSize: '13px',
                  color: '#1f2937',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '180px'
                }}
                title={referralLink}
              >
                {referralLink}
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="btn-secondary"
                  style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  {copiedLink ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                  {copiedLink ? 'Copied' : 'Link'}
                </button>
                <button
                  type="button"
                  onClick={handleWhatsAppShare}
                  style={{
                    padding: '6px 10px',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: '#25D366',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="Share directly to WhatsApp group"
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="btn-primary"
                  style={{ padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <Share2 size={14} /> Share
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Milestone Progress Card */}
      <div
        className="portal-card"
        style={{
          padding: '1.5rem',
          background: hasLifetimePlus ? '#ecfdf5' : '#ffffff',
          borderRadius: '14px',
          border: hasLifetimePlus ? '1.5px solid #10b981' : '1px solid var(--border, #dcebe0)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: hasLifetimePlus ? '#d1fae5' : '#fef3c7',
                color: hasLifetimePlus ? '#059669' : '#d97706',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Award size={20} />
            </div>
            <div>
              <strong style={{ fontSize: '15px', color: '#17231d', display: 'block' }}>
                Campus Hub Plus Lifetime Access Milestone
              </strong>
              <span style={{ fontSize: '13px', color: '#55675b' }}>
                {hasLifetimePlus
                  ? 'Congratulations! You have unlocked permanent Lifetime Plus access.'
                  : `${convertedCount} of ${milestoneTarget} student Plus conversions completed`}
              </span>
            </div>
          </div>

          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: hasLifetimePlus ? '#059669' : '#12603d',
              background: '#ffffff',
              padding: '4px 10px',
              borderRadius: '999px',
              border: '1px solid #dcebe0'
            }}
          >
            {milestoneProgress}% Complete
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: '10px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden', marginBottom: '10px' }}>
          <div
            style={{
              height: '100%',
              width: `${milestoneProgress}%`,
              background: hasLifetimePlus ? '#10b981' : 'linear-gradient(90deg, #12603d, #059669)',
              transition: 'width 0.4s ease'
            }}
          />
        </div>

        <p style={{ margin: 0, fontSize: '12.5px', color: '#55675b', lineHeight: 1.5 }}>
          <strong>Reward details:</strong> Course reps and student ambassadors who convert 5 peers to Campus Hub Plus (₦1,200/semester) receive lifetime entitlement to encrypted PDF downloads, offline study vaults, and AI CBT study preps without ever paying semester renewals.
        </p>
      </div>

      {/* Enter / Apply a Referral Code (if not yet referred) */}
      <div className="portal-card" style={{ padding: '1.5rem', background: '#ffffff', borderRadius: '14px', border: '1px solid var(--border, #dcebe0)' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px', color: '#17231d' }}>
          Have a Course Rep's Referral Code?
        </h3>
        <p style={{ fontSize: '0.88rem', color: '#55675b', margin: '0 0 1rem' }}>
          If a course rep or friend invited you, enter their 6-character code below to link your account to their ambassador tree.
        </p>

        <form onSubmit={handleApplyCode} style={{ display: 'flex', gap: '8px', maxWidth: '400px' }}>
          <input
            type="text"
            placeholder="e.g. FUW101"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
            maxLength={10}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border, #dcebe0)',
              fontSize: '14px',
              fontFamily: 'monospace',
              letterSpacing: '0.05em'
            }}
          />
          <button
            type="submit"
            disabled={applyingCode || !inputCode.trim()}
            className="btn-primary"
            style={{ padding: '8px 16px', fontSize: '13px' }}
          >
            {applyingCode ? 'Applying...' : 'Apply Code'}
          </button>
        </form>
        {appliedReferrer && (
          <p style={{ marginTop: '8px', fontSize: '12px', color: '#059669', fontWeight: 600 }}>
            <Check size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
            Linked to referrer: {appliedReferrer}
          </p>
        )}
      </div>

      {/* Payout Modal */}
      {showWithdrawModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={() => setShowWithdrawModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '1.75rem',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#17231d' }}>
                Withdraw Commission Earnings
              </h3>
              <button
                type="button"
                onClick={() => setShowWithdrawModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#6b7280' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '13px', color: '#55675b', marginBottom: '1.25rem' }}>
              Available Balance: <strong>{formatNaira(stats?.available_wallet_kobo ?? 0)}</strong>. Funds are transferred to your Nigerian bank account within 24 hours of approval.
            </p>

            <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>
                  Amount (₦) · Min ₦500
                </label>
                <input
                  type="number"
                  min="500"
                  step="100"
                  placeholder="e.g. 2000"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  required
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px' }}
                />
              </div>

              <BankResolutionInput
                onChange={setBankDetails}
                disabled={withdrawing}
              />

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowWithdrawModal(false)}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#ffffff', cursor: 'pointer', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={withdrawing || !bankDetails.isVerified}
                  className="btn-primary"
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    opacity: withdrawing || !bankDetails.isVerified ? 0.6 : 1,
                    cursor: withdrawing || !bankDetails.isVerified ? 'not-allowed' : 'pointer'
                  }}
                >
                  {withdrawing ? 'Submitting...' : 'Request Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
export default StudentAffiliateTab;
