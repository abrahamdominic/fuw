import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ShieldAlert,
  CheckCircle,
  Scale,
} from 'lucide-react';
import {
  fetchAdminStats,
  fetchAdminDisputes,
  fetchAdminReports,
  fetchAdminVerifications,
  getVerificationEvidenceUrl,
  resolveDispute,
  resolveReport,
  reviewVendorVerification,
  setAdminVerifiedVendorBadge,
  fetchPlatformSettings,
  fetchPendingManualTransfers,
  confirmManualTransfer,
  fetchAdvertPackages,
  fetchAdminAdverts,
  reviewAdvert,
  setAdvertActive,
  saveAdvertPackage,
  deleteAdvertPackage,
  fetchSupportQueue,
  updatePlatformSettings,
  fetchAdminEscrowAnalytics,
} from '../lib/api';
import type { PendingManualTransfer, AdminEscrowAnalytics } from '../lib/api';
import type { Advert, AdvertPackage, AdvertType } from '../lib/types';
import { formatNaira, formatDate } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { SupportInbox } from './SupportPage';
import { mpPath } from '../lib/routes';

/**
 * Lazily resolves a stored verification-evidence object to a signed URL. The
 * vendor-assets bucket is private, so this only yields a link for an object the
 * current user may read (the owning vendor, or a staff member once an
 * admin-read storage policy exists). Otherwise the file name is shown with a
 * muted note instead of a broken link.
 */
function VerificationEvidence({ evidencePath }: { evidencePath?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!evidencePath) return;
    let mounted = true;
    getVerificationEvidenceUrl(evidencePath)
      .then((u) => {
        if (mounted) setUrl(u);
      })
      .catch(() => {
        if (mounted) setUrl(null);
      });
    return () => {
      mounted = false;
    };
  }, [evidencePath]);

  if (!evidencePath) return null;
  return (
    <div style={{ fontSize: 12, marginTop: 6 }}>
      <strong>Evidence: </strong>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary, #12603d)', fontWeight: 700 }}>
          View uploaded file
        </a>
      ) : (
        <span style={{ color: 'var(--text-secondary, #55675b)' }}>
          {evidencePath.split('/').pop()} (stored privately for review)
        </span>
      )}
    </div>
  );
}

export const AdminPortalPage: React.FC = () => {
  const { isAdmin, isStaff, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const tabFromQuery = searchParams.get('tab') as 'kpis' | 'transfers' | 'disputes' | 'verifications' | 'reports' | 'adverts' | 'support' | 'settings' | null;
  const [activeTab, setActiveTab] = useState<
    'kpis' | 'transfers' | 'disputes' | 'verifications' | 'reports' | 'adverts' | 'support' | 'settings'
  >(tabFromQuery && ['kpis', 'transfers', 'disputes', 'verifications', 'reports', 'adverts', 'support', 'settings'].includes(tabFromQuery) ? tabFromQuery : 'kpis');
  const [supportWaiting, setSupportWaiting] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [transfers, setTransfers] = useState<PendingManualTransfer[]>([]);
  const [proofRefs, setProofRefs] = useState<Record<string, string>>({});
  const [transferNotes, setTransferNotes] = useState<Record<string, string>>({});
  const [busyTransfer, setBusyTransfer] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [verifNotes, setVerifNotes] = useState<Record<string, string>>({});
  const [verifFilter, setVerifFilter] = useState<'all' | 'pending' | 'verified' | 'rejected'>('pending');
  const [busyVerif, setBusyVerif] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [escrowAnalytics, setEscrowAnalytics] = useState<AdminEscrowAnalytics | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    commissionPct: '8',
    ticketFeeNaira: '100',
    minWithdrawalNaira: '5000',
    autoConfirmHours: '72',
    settlementDelayHours: '72',
    returnWindowHours: '72',
    requireVerification: false,
    allowRegistration: true,
    allowNewVendors: true,
    paymentsEnabled: true,
    maintenanceMode: false,
    escrowFeeNaira: '1200',
    premiumEscrowCreditNaira: '2000',
    premiumEscrowDiscountPct: '50',
    premiumMarketplaceBenefitsEnabled: true,
    verifiedScholarBadgeEnabled: true,
    premiumVisibilityEnabled: true,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  // Dispute resolution modal
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<any>(null);
  const [disputeOutcome, setDisputeOutcome] = useState('refund_full');
  const [disputeRefundKobo, setDisputeRefundKobo] = useState('0');
  const [disputeResolutionNote, setDisputeResolutionNote] = useState('');
  const [disputeBusy, setDisputeBusy] = useState(false);

  // Adverts: the review queue, and the price list vendors are shown.
  const [adverts, setAdverts] = useState<Advert[]>([]);
  const [packages, setPackages] = useState<AdvertPackage[]>([]);
  const [advertFilter, setAdvertFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [advertNotes, setAdvertNotes] = useState<Record<string, string>>({});
  const [busyAdvert, setBusyAdvert] = useState<string | null>(null);
  const [editingPackage, setEditingPackage] = useState<AdvertPackage | null>(null);
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [pkgType, setPkgType] = useState<AdvertType>('sponsored');
  const [pkgDays, setPkgDays] = useState('7');
  const [pkgPrice, setPkgPrice] = useState('');
  const [pkgLabel, setPkgLabel] = useState('');
  const [pkgActive, setPkgActive] = useState(true);
  const [pkgBusy, setPkgBusy] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, d, r, v, set, t, escrow] = await Promise.all([
        fetchAdminStats(),
        fetchAdminDisputes(),
        fetchAdminReports(),
        fetchAdminVerifications(),
        fetchPlatformSettings(),
        // Reads are gated by the `mp_pay_select_finance` RLS policy, so staff
        // without the manage_payments permission simply get an empty list.
        fetchPendingManualTransfers().catch(() => []),
        fetchAdminEscrowAnalytics().catch(() => null),
      ]);
      setStats(s);
      setDisputes(d);
      setReports(r);
      setVerifications(v);
      setSettings(set);
      setEscrowAnalytics(escrow);
      if (set) {
        setSettingsForm({
          commissionPct: String((set.default_commission_bps ?? 800) / 100),
          ticketFeeNaira: String(Math.round((set.event_ticket_fee_kobo ?? 10000) / 100)),
          minWithdrawalNaira: String(Math.round((set.min_withdrawal_kobo ?? 500000) / 100)),
          autoConfirmHours: String(set.auto_confirm_hours ?? 72),
          settlementDelayHours: String(set.settlement_delay_hours ?? 72),
          returnWindowHours: String(set.return_window_hours ?? 72),
          requireVerification: Boolean(set.require_vendor_verification),
          allowRegistration: Boolean(set.allow_registration),
          allowNewVendors: Boolean(set.allow_new_vendors),
          paymentsEnabled: Boolean(set.payments_enabled),
          maintenanceMode: Boolean(set.maintenance_mode),
          escrowFeeNaira: String(Math.round((set.escrow_fee_kobo ?? 120000) / 100)),
          premiumEscrowCreditNaira: String(Math.round((set.premium_escrow_credit_kobo ?? 200000) / 100)),
          premiumEscrowDiscountPct: String(set.premium_escrow_discount_pct ?? 50),
          premiumMarketplaceBenefitsEnabled: set.premium_marketplace_benefits_enabled !== false,
          verifiedScholarBadgeEnabled: set.verified_scholar_badge_enabled !== false,
          premiumVisibilityEnabled: set.premium_visibility_enabled !== false,
        });
      }
      setTransfers(t);

      // Advert permissions are separate, so this must not break the rest.
      const [pkgList, advertList] = await Promise.all([
        fetchAdvertPackages(true).catch(() => ({ packages: [] as AdvertPackage[] })),
        fetchAdminAdverts({ approvalState: advertFilter })
          .catch(() => ({ adverts: [] as Advert[] })),
      ]);
      setPackages(pkgList.packages);
      setAdverts(advertList.adverts ?? []);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLoading) return;
    if (!isAdmin && !isStaff) {
      toast('Access restricted to marketplace administration staff', 'error');
      navigate(mpPath('/'));
      return;
    }
    loadData();
  }, [isLoading, isAdmin, isStaff]);

  // Re-reading the queue is cheap and keeps the counts on the tab honest.
  useEffect(() => {
    if (!isAdmin && !isStaff) return;
    fetchAdminAdverts({ approvalState: advertFilter })
      .then((r) => setAdverts(r.adverts ?? []))
      .catch(() => setAdverts([]));
  }, [advertFilter]);

  // Only the count of unanswered threads is needed for the tab badge.
  useEffect(() => {
    if (!isAdmin && !isStaff) return;
    fetchSupportQueue('awaiting_admin')
      .then((rows) => setSupportWaiting(rows.length))
      .catch(() => setSupportWaiting(0));
  }, [isAdmin, isStaff, activeTab]);

  const handleReviewAdvert = async (advert: Advert, decision: 'approve' | 'reject') => {
    setBusyAdvert(advert.id);
    try {
      await reviewAdvert(advert.id, decision, advertNotes[advert.id]?.trim() || undefined);
      toast(
        decision === 'approve'
          ? 'Advert approved and the vendor has been charged'
          : 'Advert rejected',
        'success',
      );
      setAdvertNotes((prev) => ({ ...prev, [advert.id]: '' }));
      const refreshed = await fetchAdminAdverts({ approvalState: advertFilter });
      setAdverts(refreshed.adverts ?? []);
    } catch (err: any) {
      toast(err?.message || 'Could not review the advert', 'error');
    } finally {
      setBusyAdvert(null);
    }
  };

  const handleToggleAdvert = async (advert: Advert) => {
    const nextActive = advert.status !== 'active';
    setBusyAdvert(advert.id);
    try {
      await setAdvertActive(advert.id, nextActive, advertNotes[advert.id]?.trim() || undefined);
      toast(nextActive ? 'Advert is live again' : 'Advert suspended', 'success');
      const refreshed = await fetchAdminAdverts({ approvalState: advertFilter });
      setAdverts(refreshed.adverts ?? []);
    } catch (err: any) {
      toast(err?.message || 'Could not change the advert', 'error');
    } finally {
      setBusyAdvert(null);
    }
  };

  const handleOpenPackage = (pkg: AdvertPackage | null) => {
    setEditingPackage(pkg);
    setPkgType(pkg?.advert_type ?? 'sponsored');
    setPkgDays(String(pkg?.duration_days ?? 7));
    setPkgPrice(pkg ? String(pkg.price_kobo / 100) : '');
    setPkgLabel(pkg?.label ?? '');
    setPkgActive(pkg?.is_active ?? true);
    setPackageModalOpen(true);
  };

  const handleSavePackage = async () => {
    const kobo = Math.round(Number(pkgPrice) * 100);
    const days = parseInt(pkgDays, 10);
    if (!Number.isFinite(kobo) || kobo < 0) {
      toast('Enter a price in naira', 'error');
      return;
    }
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast('Duration must be between 1 and 365 days', 'error');
      return;
    }
    setPkgBusy(true);
    try {
      await saveAdvertPackage({
        packageId: editingPackage?.id,
        advertType: pkgType,
        durationDays: days,
        priceKobo: kobo,
        label: pkgLabel.trim() || undefined,
        isActive: pkgActive,
        sortOrder: editingPackage?.sort_order ?? 0,
      });
      toast(editingPackage ? 'Package updated' : 'Package created', 'success');
      setPackageModalOpen(false);
      const refreshed = await fetchAdvertPackages(true);
      setPackages(refreshed.packages);
    } catch (err: any) {
      toast(err?.message || 'Could not save the package', 'error');
    } finally {
      setPkgBusy(false);
    }
  };

  const handleDeletePackage = async (pkg: AdvertPackage) => {
    setPkgBusy(true);
    try {
      const res = await deleteAdvertPackage(pkg.id);
      if (res.disabled_instead) {
        toast(
          `Package retired. ${res.adverts_using_it} advert(s) still point at it, so it was disabled rather than deleted.`,
          'info',
        );
      } else {
        toast('Package deleted', 'success');
      }
      const refreshed = await fetchAdvertPackages(true);
      setPackages(refreshed.packages);
    } catch (err: any) {
      toast(err?.message || 'Could not retire the package', 'error');
    } finally {
      setPkgBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const commPct = parseFloat(settingsForm.commissionPct);
    const commBps = Math.round(commPct * 100);
    const ticketKobo = Math.round(parseFloat(settingsForm.ticketFeeNaira || '0') * 100);
    const minWithdrawalKobo = Math.round(parseFloat(settingsForm.minWithdrawalNaira || '0') * 100);
    const autoConfirm = parseInt(settingsForm.autoConfirmHours, 10);
    const settlementDelay = parseInt(settingsForm.settlementDelayHours, 10);
    const returnWindow = parseInt(settingsForm.returnWindowHours, 10);
    const escrowFeeKobo = Math.round(parseFloat(settingsForm.escrowFeeNaira || '0') * 100);
    const premiumCreditKobo = Math.round(parseFloat(settingsForm.premiumEscrowCreditNaira || '0') * 100);
    const premiumDiscountPct = parseInt(settingsForm.premiumEscrowDiscountPct || '50', 10);

    if (isNaN(commBps) || commBps < 0 || commBps > 5000) {
      toast('Commission must be between 0% and 50%', 'error');
      return;
    }
    if (isNaN(ticketKobo) || ticketKobo < 0) {
      toast('Ticket fee cannot be negative', 'error');
      return;
    }
    if (isNaN(minWithdrawalKobo) || minWithdrawalKobo < 0) {
      toast('Minimum withdrawal cannot be negative', 'error');
      return;
    }
    if (isNaN(escrowFeeKobo) || escrowFeeKobo < 0) {
      toast('Escrow fee cannot be negative', 'error');
      return;
    }
    if (isNaN(premiumCreditKobo) || premiumCreditKobo < 0) {
      toast('Premium escrow credit cannot be negative', 'error');
      return;
    }
    if (isNaN(premiumDiscountPct) || premiumDiscountPct < 0 || premiumDiscountPct > 100) {
      toast('Premium escrow discount must be between 0% and 100%', 'error');
      return;
    }

    setSavingSettings(true);
    try {
      const updated = await updatePlatformSettings({
        default_commission_bps: commBps,
        event_ticket_fee_kobo: ticketKobo,
        min_withdrawal_kobo: minWithdrawalKobo,
        auto_confirm_hours: autoConfirm,
        settlement_delay_hours: settlementDelay,
        return_window_hours: returnWindow,
        require_vendor_verification: settingsForm.requireVerification,
        allow_registration: settingsForm.allowRegistration,
        allow_new_vendors: settingsForm.allowNewVendors,
        payments_enabled: settingsForm.paymentsEnabled,
        maintenance_mode: settingsForm.maintenanceMode,
        escrow_fee_kobo: escrowFeeKobo,
        premium_escrow_credit_kobo: premiumCreditKobo,
        premium_escrow_discount_pct: premiumDiscountPct,
        premium_marketplace_benefits_enabled: settingsForm.premiumMarketplaceBenefitsEnabled,
        verified_scholar_badge_enabled: settingsForm.verifiedScholarBadgeEnabled,
        premium_visibility_enabled: settingsForm.premiumVisibilityEnabled,
      });
      setSettings(updated);
      toast('Platform settings updated successfully and active immediately', 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to update platform settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleConfirmTransfer = async (row: PendingManualTransfer) => {
    const proof = (proofRefs[row.order_id] ?? '').trim();
    if (proof.length < 4) {
      toast('Enter the bank transfer reference (at least 4 characters)', 'error');
      return;
    }
    setBusyTransfer(row.order_id);
    try {
      await confirmManualTransfer(row.order_id, proof, transferNotes[row.order_id]);
      toast(`Payment confirmed for ${row.order_number}. Escrow is now funded.`, 'success');
      setProofRefs((prev) => ({ ...prev, [row.order_id]: '' }));
      loadData();
    } catch (err: any) {
      toast(err.message || 'Could not confirm this transfer', 'error');
    } finally {
      setBusyTransfer(null);
    }
  };

  const handleOpenResolveDispute = (d: any) => {
    setSelectedDispute(d);
    setDisputeOutcome('refund_full');
    setDisputeRefundKobo(String((d.order?.total_kobo || 0) / 100));
    setDisputeResolutionNote('Investigation completed. Resolution applied per marketplace terms.');
    setDisputeModalOpen(true);
  };

  const handleResolveDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispute) return;
    setDisputeBusy(true);
    try {
      const refundKobo = disputeOutcome.includes('refund') ? Math.round(parseFloat(disputeRefundKobo) * 100) : 0;
      await resolveDispute(selectedDispute.id, disputeOutcome, refundKobo, disputeResolutionNote);
      toast('Dispute resolved successfully! Ledger updated.', 'success');
      setDisputeModalOpen(false);
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to resolve dispute', 'error');
    } finally {
      setDisputeBusy(false);
    }
  };

  const handleReviewVerification = async (verificationId: string, approve: boolean, defaultNote: string) => {
    const note = (verifNotes[verificationId] || '').trim() || defaultNote;
    if (!approve && note.length < 10) {
      toast('Enter a reason (at least 10 characters) for the rejection', 'error');
      return;
    }
    setBusyVerif(verificationId);
    try {
      await reviewVendorVerification(verificationId, approve, note);
      toast(
        approve
          ? 'Vendor verification approved — badge granted'
          : 'Vendor verification rejected — vendor notified',
        'success',
      );
      setVerifNotes((prev) => ({ ...prev, [verificationId]: '' }));
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to update verification', 'error');
    } finally {
      setBusyVerif(null);
    }
  };

  const handleResolveReport = async (reportId: string, action: 'resolved' | 'dismissed') => {
    try {
      await resolveReport(reportId, action, `Report marked as ${action} by admin`);
      toast(`Report ${action}`, 'info');
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to process report', 'error');
    }
  };

  if (isLoading) {
    return (
      <div style={{ paddingBottom: 60, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Skeleton height={80} borderRadius={14} />
        <Skeleton height={140} borderRadius={14} />
        <Skeleton height={320} borderRadius={14} />
      </div>
    );
  }

  if (!isAdmin && !isStaff) {
    return (
      <div style={{ padding: '60px 0' }}>
        <EmptyState
          icon={<ShieldAlert size={36} color="#b45309" />}
          title="Access Restricted"
          description="This portal is restricted to Federal University Wukari marketplace administration staff."
          action={
            <Link to={mpPath('/')} className="btn btn-primary" style={{ padding: '10px 22px' }}>
              Return to Marketplace
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={22} color="#b45309" />
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
              Marketplace Control Center
            </h1>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
            Federal University Wukari Platform Administration & Moderation
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border, #dcebe0)', marginBottom: 24, overflowX: 'auto' }}>
        {[
          { key: 'kpis', label: 'Platform KPIs' },
          { key: 'transfers', label: `Transfers (${transfers.length})` },
          { key: 'disputes', label: `Disputes (${disputes.filter((d) => ['open', 'under_review'].includes(d.status)).length})` },
          { key: 'verifications', label: `Verifications (${verifications.filter((v) => v.status === 'pending').length})` },
          { key: 'reports', label: `Reports (${reports.filter((r) => r.status === 'open').length})` },
          { key: 'adverts', label: `Adverts (${adverts.filter((a) => a.approval_state === 'pending').length})` },
          { key: 'support', label: `Support (${supportWaiting})` },
          { key: 'settings', label: 'Settings & Fees' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
              color: activeTab === tab.key ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16, marginBottom: 24 }}>
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} height={100} borderRadius={12} />
          ))}
        </div>
      )}

      {/* TAB: BANK TRANSFER CONFIRMATION */}
      {!loading && activeTab === 'transfers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ padding: 14, borderRadius: 10, background: '#fef3c7', border: '1px solid #fcd34d', fontSize: 13, color: '#92400e' }}>
            Confirm a transfer only after the funds have cleared in the FUW
            marketplace account. This credits the buyer&apos;s escrow and starts
            fulfilment, so it cannot be undone from here.
          </div>

          {transfers.length === 0 ? (
            <EmptyState
              icon={<CheckCircle size={26} />}
              title="No transfers awaiting confirmation"
              description="Bank transfer orders appear here once a buyer has reserved items and is waiting on finance."
            />
          ) : (
            transfers.map((row) => (
              <div
                key={row.order_id}
                style={{
                  background: 'var(--surface, #ffffff)',
                  borderRadius: 12,
                  border: '1px solid var(--border, #dcebe0)',
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong style={{ fontSize: 15, color: 'var(--green-900, #0d4a2f)' }}>#{row.order_number}</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                      {row.buyer_name}
                      {row.buyer_email ? ` · ${row.buyer_email}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Amount Due</div>
                    <strong style={{ fontSize: 18, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>
                      {formatNaira(row.amount_kobo)}
                    </strong>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                  Reserved {formatDate(row.order_created_at)} · Payment status: {row.payment_status.replace(/_/g, ' ')}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleConfirmTransfer(row);
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Bank transfer reference *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={4}
                      value={proofRefs[row.order_id] ?? ''}
                      onChange={(e) => setProofRefs((prev) => ({ ...prev, [row.order_id]: e.target.value }))}
                      placeholder="e.g. NIP/NEFT/ALERT reference from the statement"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: '#ffffff',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Internal note (optional)
                    </label>
                    <input
                      type="text"
                      value={transferNotes[row.order_id] ?? ''}
                      onChange={(e) => setTransferNotes((prev) => ({ ...prev, [row.order_id]: e.target.value }))}
                      placeholder="e.g. credited to Wukari ops account 0042"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        fontSize: 14,
                        background: '#ffffff',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      disabled={busyTransfer === row.order_id}
                      className="btn btn-primary"
                      style={{ padding: '9px 16px', fontSize: 13 }}
                    >
                      <CheckCircle size={15} />
                      <span>{busyTransfer === row.order_id ? 'Confirming…' : 'Confirm Funds Received'}</span>
                    </button>
                  </div>
                </form>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 1: KPIS */}
      {!loading && activeTab === 'kpis' && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16 }}>
            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Registered Students</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>{stats.usersCount}</span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Active Campus Stores</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>{stats.vendorsCount}</span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Live Catalogue Items</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>{stats.productsCount}</span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Completed & Active Orders</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>{stats.ordersCount}</span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Open Disputes</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: stats.activeDisputesCount > 0 ? '#b91c1c' : '#065f46' }}>
                {stats.activeDisputesCount}
              </span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Pending Moderation Reports</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: stats.openReportsCount > 0 ? '#b45309' : '#065f46' }}>
                {stats.openReportsCount}
              </span>
            </div>
          </div>

          {/* Premium Marketplace Escrow Advantage Metrics */}
          {escrowAnalytics && (
            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--green-900, #0d4a2f)' }}>
                    Escrow &amp; Premium Marketplace Revenue Analytics
                  </h3>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                    Authoritative server ledger metrics tracking escrow fees, credits granted/used, and revenue performance
                  </span>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: 999, background: '#e8f5ec', color: '#12603d', fontSize: 12, fontWeight: 700 }}>
                  ₦1,200/Semester Model Active
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 14 }}>
                <div style={{ background: 'var(--surface-alt, #f7faf8)', padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Escrow Fees Collected</span>
                  <strong style={{ fontSize: 20, color: '#0d4a2f' }}>
                    {formatNaira(escrowAnalytics.total_escrow_fees_collected_kobo)}
                  </strong>
                </div>

                <div style={{ background: 'var(--surface-alt, #f7faf8)', padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Credits Granted (Gross)</span>
                  <strong style={{ fontSize: 20, color: '#1e40af' }}>
                    {formatNaira(escrowAnalytics.total_escrow_credit_granted_kobo)}
                  </strong>
                </div>

                <div style={{ background: 'var(--surface-alt, #f7faf8)', padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Credits Consumed</span>
                  <strong style={{ fontSize: 20, color: '#b45309' }}>
                    {formatNaira(escrowAnalytics.total_escrow_credit_consumed_kobo)}
                  </strong>
                </div>

                <div style={{ background: 'var(--surface-alt, #f7faf8)', padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Unused Credit Float</span>
                  <strong style={{ fontSize: 20, color: '#475569' }}>
                    {formatNaira(escrowAnalytics.total_escrow_credit_remaining_kobo)}
                  </strong>
                </div>

                <div style={{ background: 'var(--surface-alt, #f7faf8)', padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Discounts Waived (50%)</span>
                  <strong style={{ fontSize: 20, color: '#047857' }}>
                    {formatNaira(escrowAnalytics.total_discounts_applied_kobo)}
                  </strong>
                </div>

                <div style={{ background: 'var(--surface-alt, #f7faf8)', padding: 14, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>Active Credit Ledgers</span>
                  <strong style={{ fontSize: 20, color: '#0d4a2f' }}>
                    {escrowAnalytics.total_subscribers_with_credit}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DISPUTES */}
      {activeTab === 'disputes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {disputes.length === 0 ? (
            <EmptyState icon={<Scale size={32} />} title="No Disputes Reported" description="There are currently no open buyer or vendor disputes." />
          ) : (
            disputes.map((d) => (
              <div key={d.id} style={{ background: 'var(--surface, #ffffff)', borderRadius: 12, border: '1px solid var(--border, #dcebe0)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: 15, color: '#b91c1c' }}>Dispute #{d.dispute_number}</strong>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', marginLeft: 8 }}>
                      Order #{d.order?.order_number} · Reason: {d.reason.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: 4, background: d.status.startsWith('resolved') ? '#d1fae5' : '#fee2e2', color: d.status.startsWith('resolved') ? '#065f46' : '#991b1b', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                    {d.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', fontSize: 13 }}>
                  <p style={{ margin: '0 0 6px' }}><strong>Claim: </strong>{d.description}</p>
                  <div><strong>Buyer: </strong>{d.buyer?.full_name} ({d.buyer?.email}) · <strong>Store: </strong>{d.vendor?.shop_name || d.vendor?.store_name || 'Vendor'}</div>
                  <div><strong>Order Total: </strong>{formatNaira(d.order?.total_kobo || 0)}</div>
                </div>

                {!d.status.startsWith('resolved') && d.status !== 'closed' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={() => handleOpenResolveDispute(d)} className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 13 }}>
                      Investigate & Resolve
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: VERIFICATIONS */}
      {activeTab === 'verifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                { key: 'all', label: `All (${verifications.length})` },
                { key: 'pending', label: `Pending (${verifications.filter((v) => v.status === 'pending').length})` },
                { key: 'verified', label: `Verified (${verifications.filter((v) => v.status === 'verified').length})` },
                { key: 'rejected', label: `Rejected (${verifications.filter((v) => v.status === 'rejected').length})` },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setVerifFilter(f.key)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 999,
                  border: verifFilter === f.key ? '1px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                  background: verifFilter === f.key ? '#e8f5ec' : '#ffffff',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: verifFilter === f.key ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {verifications.filter((v) => verifFilter === 'all' || v.status === verifFilter).length === 0 ? (
            <EmptyState icon={<CheckCircle size={32} />} title="No Verification Requests" description="No vendors are currently waiting for verification review." />
          ) : (
            verifications
              .filter((v) => verifFilter === 'all' || v.status === verifFilter)
              .map((v) => (
                <div key={v.id} style={{ background: 'var(--surface, #ffffff)', borderRadius: 12, border: '1px solid var(--border, #dcebe0)', padding: 18, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{v.vendor?.shop_name || v.vendor?.store_name || 'Unknown store'}</strong>
                      <span style={{ padding: '3px 8px', borderRadius: 4, background: v.status === 'verified' ? '#d1fae5' : v.status === 'rejected' ? '#fee2e2' : '#fef3c7', color: v.status === 'verified' ? '#065f46' : v.status === 'rejected' ? '#991b1b' : '#92400e', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                        {v.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', marginTop: 6 }}>
                      Applied: {formatDate(v.created_at)}
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5 }}>
                      <strong>Request note: </strong>
                      {v.note || '(No note provided)'}
                    </p>
                    <VerificationEvidence evidencePath={v.evidence_path} />
                    {v.reviewer_note && (
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        <strong>Reviewer note: </strong>
                        {v.reviewer_note}
                      </p>
                    )}
                  </div>

                  {v.status === 'pending' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 260px' }}>
                      <textarea
                        rows={2}
                        value={verifNotes[v.id] || ''}
                        onChange={(e) => setVerifNotes((prev) => ({ ...prev, [v.id]: e.target.value }))}
                        placeholder="Optional note for approve · required reason (10+ chars) for reject"
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 13, resize: 'vertical' }}
                      />
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          disabled={busyVerif === v.id}
                          onClick={() => handleReviewVerification(v.id, true, 'Verified by FUW marketplace admin')}
                          className="btn btn-primary"
                          style={{ padding: '7px 12px', fontSize: 12, opacity: busyVerif === v.id ? 0.6 : 1 }}
                        >
                          {busyVerif === v.id ? 'Working...' : 'Approve Badge'}
                        </button>
                        <button
                          type="button"
                          disabled={busyVerif === v.id}
                          onClick={() => handleReviewVerification(v.id, false, '')}
                          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fee2e2', color: '#991b1b', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busyVerif === v.id ? 0.6 : 1 }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 12, color: v.status === 'verified' ? '#065f46' : '#991b1b' }}>
                        {v.status}
                      </span>
                      {v.vendor_id && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const nextState = v.status !== 'verified';
                              await setAdminVerifiedVendorBadge(v.vendor_id, nextState);
                              toast(`Vendor badge ${nextState ? 'enabled' : 'revoked'}.`, 'success');
                              const next = await fetchAdminVerifications();
                              setVerifications(next);
                            } catch (e: any) {
                              toast(e.message || 'Could not update badge.', 'error');
                            }
                          }}
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                        >
                          {v.status === 'verified' ? 'Revoke Badge' : 'Re-verify'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
          )}
        </div>
      )}

      {/* TAB 4: REPORTS */}
      {activeTab === 'reports' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {reports.length === 0 ? (
            <EmptyState icon={<ShieldAlert size={32} />} title="No Moderation Reports" description="No suspicious content or scams have been flagged." />
          ) : (
            reports.map((r) => (
              <div key={r.id} style={{ background: 'var(--surface, #ffffff)', borderRadius: 12, border: '1px solid var(--border, #dcebe0)', padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div>
                  <strong style={{ fontSize: 14, color: '#b91c1c' }}>Target: {r.target_type.toUpperCase()} · Reason: {r.reason}</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                    "{r.details || 'No additional details provided'}" · Reported by: {r.reporter?.full_name || 'Student'}
                  </p>
                </div>

                {r.status === 'open' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => handleResolveReport(r.id, 'resolved')} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }}>
                      Resolve Action
                    </button>
                    <button type="button" onClick={() => handleResolveReport(r.id, 'dismissed')} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', fontSize: 12, cursor: 'pointer' }}>
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}>{r.status}</span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 5: ADVERTS */}
      {activeTab === 'adverts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Advert Placements</h3>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                  This is the only price list vendors are shown. Editing a price never
                  changes what an advert already bought.
                </p>
              </div>
              <button type="button" onClick={() => handleOpenPackage(null)} className="btn btn-primary" style={{ padding: '9px 16px' }}>
                New package
              </button>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', border: '1px solid var(--border, #dcebe0)', borderRadius: 14, overflowX: 'auto' }}>
              {packages.length === 0 ? (
                <div style={{ padding: 24 }}>
                  <EmptyState title="No packages" description="Create one so vendors have something to buy." />
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f6faf7', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Placement</th>
                      <th style={{ padding: '12px 16px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Duration</th>
                      <th style={{ padding: '12px 16px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'right' }}>Price</th>
                      <th style={{ padding: '12px 16px', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>State</th>
                      <th style={{ padding: '12px 16px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((pkg) => (
                      <tr key={pkg.id} style={{ borderTop: '1px solid var(--border, #dcebe0)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700, textTransform: 'capitalize' }}>{pkg.advert_type}</td>
                        <td style={{ padding: '12px 16px' }}>{pkg.duration_days} days</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700 }}>{formatNaira(pkg.price_kobo)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                            padding: '2px 8px', borderRadius: 999,
                            background: pkg.is_active ? '#e3f5ea' : '#f1f4f2',
                            color: pkg.is_active ? '#12603d' : 'var(--text-secondary, #55675b)',
                          }}>
                            {pkg.is_active ? 'live' : 'hidden'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" onClick={() => handleOpenPackage(pkg)} style={{ background: 'none', border: 'none', color: 'var(--green-800, #12603d)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePackage(pkg)}
                            disabled={pkgBusy}
                            style={{ background: 'none', border: 'none', marginLeft: 14, color: '#b42318', fontWeight: 700, fontSize: 13, cursor: pkgBusy ? 'wait' : 'pointer' }}
                          >
                            Retire
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700 }}>Review queue</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
              Approving charges the vendor's wallet for the price on the advert.
              Rejecting an advert that already ran refunds it.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['pending', 'approved', 'rejected'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAdvertFilter(f)}
                  style={{
                    padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', textTransform: 'capitalize',
                    border: advertFilter === f ? '1px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                    background: advertFilter === f ? 'var(--green-800, #12603d)' : 'var(--surface, #ffffff)',
                    color: advertFilter === f ? '#fff' : 'var(--text-secondary, #55675b)',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            {adverts.length === 0 ? (
              <EmptyState title="Nothing here" description={`No ${advertFilter} adverts.`} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {adverts.map((advert) => (
                  <div
                    key={advert.id}
                    style={{ background: 'var(--surface, #ffffff)', border: '1px solid var(--border, #dcebe0)', borderRadius: 12, padding: 16 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{advert.product?.title ?? 'Storefront advert'}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', marginTop: 4 }}>
                          {advert.advert_type} · {advert.target_audience === 'both' ? 'everyone' : `${advert.target_audience} only`} ·{' '}
                          {formatNaira(advert.price_kobo)} for {advert.duration_days} days
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', marginTop: 4 }}>
                          {formatDate(advert.start_at)} to {formatDate(advert.end_at)} · status {advert.status}
                        </div>
                      </div>
                      {advert.approval_state === 'approved' && (
                        <button
                          type="button"
                          onClick={() => handleToggleAdvert(advert)}
                          disabled={busyAdvert === advert.id}
                          style={{
                            alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 8,
                            border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)',
                            fontWeight: 600, fontSize: 13, cursor: busyAdvert === advert.id ? 'wait' : 'pointer',
                          }}
                        >
                          {advert.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder="Note for the vendor (optional)"
                        value={advertNotes[advert.id] ?? ''}
                        onChange={(e) => setAdvertNotes((prev) => ({ ...prev, [advert.id]: e.target.value }))}
                        style={{ flex: '1 1 220px', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 13 }}
                      />
                      {advert.approval_state !== 'approved' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReviewAdvert(advert, 'approve')}
                            disabled={busyAdvert === advert.id}
                            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--green-800, #12603d)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: busyAdvert === advert.id ? 'wait' : 'pointer' }}
                          >
                            Approve &amp; charge {formatNaira(advert.price_kobo)}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewAdvert(advert, 'reject')}
                            disabled={busyAdvert === advert.id}
                            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #b42318', background: 'var(--surface, #ffffff)', color: '#b42318', fontWeight: 700, fontSize: 13, cursor: busyAdvert === advert.id ? 'wait' : 'pointer' }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 6: SETTINGS */}
      {/* PHASE 16: SUPPORT QUEUE */}
      {activeTab === 'support' && <SupportInbox viewer="admin" embedded />}

      {activeTab === 'settings' && (
        <div style={{ maxWidth: 720, background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 24 }}>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
              Platform Economic &amp; Operational Controls
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
              Changes persist in PostgreSQL and take effect immediately across all transactions, wallets, and seller verifications.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Financial &amp; Take Rates
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Platform Commission (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="50"
                    required
                    value={settingsForm.commissionPct}
                    onChange={(e) => setSettingsForm({ ...settingsForm, commissionPct: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>e.g. 8% (800 bps)</small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Event Ticket Fee (₦)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    required
                    value={settingsForm.ticketFeeNaira}
                    onChange={(e) => setSettingsForm({ ...settingsForm, ticketFeeNaira: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>₦100 flat fee (10,000 kobo)</small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Min Withdrawal (₦)
                  </label>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    required
                    value={settingsForm.minWithdrawalNaira}
                    onChange={(e) => setSettingsForm({ ...settingsForm, minWithdrawalNaira: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>e.g. ₦5,000</small>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Escrow &amp; Operational Time Windows
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Auto-Confirm Period (hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    required
                    value={settingsForm.autoConfirmHours}
                    onChange={(e) => setSettingsForm({ ...settingsForm, autoConfirmHours: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>Auto-releases escrow if buyer unresponsive</small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Settlement Release (hours)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="720"
                    required
                    value={settingsForm.settlementDelayHours}
                    onChange={(e) => setSettingsForm({ ...settingsForm, settlementDelayHours: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>Hold before vendor payout release</small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Return / Dispute Window (hours)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="720"
                    required
                    value={settingsForm.returnWindowHours}
                    onChange={(e) => setSettingsForm({ ...settingsForm, returnWindowHours: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>Max window to dispute after delivery</small>
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Escrow Fee &amp; Premium Marketplace Advantage Settings
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Standard Escrow Fee (₦)
                  </label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    required
                    value={settingsForm.escrowFeeNaira}
                    onChange={(e) => setSettingsForm({ ...settingsForm, escrowFeeNaira: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>Default fee per transaction (₦1,200)</small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Premium Escrow Credit (₦)
                  </label>
                  <input
                    type="number"
                    step="100"
                    min="0"
                    required
                    value={settingsForm.premiumEscrowCreditNaira}
                    onChange={(e) => setSettingsForm({ ...settingsForm, premiumEscrowCreditNaira: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>Credit granted per subscription period (₦2,000)</small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Post-Credit Escrow Discount (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={settingsForm.premiumEscrowDiscountPct}
                    onChange={(e) => setSettingsForm({ ...settingsForm, premiumEscrowDiscountPct: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                  <small style={{ color: 'var(--text-secondary, #55675b)', fontSize: 11 }}>Discount on remaining escrow after credit (50%)</small>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface-alt, #f7faf8)', padding: 16, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.premiumMarketplaceBenefitsEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, premiumMarketplaceBenefitsEnabled: e.target.checked })}
                  />
                  <span><strong>Enable Premium Escrow Benefits:</strong> Grants ₦2,000 escrow credit &amp; 50% discount to Premium members.</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.verifiedScholarBadgeEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, verifiedScholarBadgeEnabled: e.target.checked })}
                  />
                  <span><strong>Enable Verified Scholar Badges:</strong> Display official verification badge for authenticated students.</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.premiumVisibilityEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, premiumVisibilityEnabled: e.target.checked })}
                  />
                  <span><strong>Enable Premium Visibility Boost:</strong> Priority listing ranking for active Premium student sellers.</span>
                </label>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Platform Safety &amp; Onboarding Controls
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface-alt, #f7faf8)', padding: 16, borderRadius: 10, border: '1px solid var(--border, #dcebe0)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.requireVerification}
                    onChange={(e) => setSettingsForm({ ...settingsForm, requireVerification: e.target.checked })}
                  />
                  <span><strong>Require Vendor Verification:</strong> Vendors must be approved before publishing listings.</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.allowRegistration}
                    onChange={(e) => setSettingsForm({ ...settingsForm, allowRegistration: e.target.checked })}
                  />
                  <span><strong>Allow Student Registration:</strong> New buyers can create marketplace accounts.</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.allowNewVendors}
                    onChange={(e) => setSettingsForm({ ...settingsForm, allowNewVendors: e.target.checked })}
                  />
                  <span><strong>Allow New Vendor Applications:</strong> Students can register new store fronts.</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.paymentsEnabled}
                    onChange={(e) => setSettingsForm({ ...settingsForm, paymentsEnabled: e.target.checked })}
                  />
                  <span><strong>Payments &amp; Checkout Enabled:</strong> Active Paystack/Wallet transaction processing.</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={settingsForm.maintenanceMode}
                    onChange={(e) => setSettingsForm({ ...settingsForm, maintenanceMode: e.target.checked })}
                  />
                  <span style={{ color: settingsForm.maintenanceMode ? '#b42318' : 'inherit' }}>
                    <strong>Maintenance Mode:</strong> Restrict public marketplace access for scheduled maintenance.
                  </span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
              <button
                type="submit"
                disabled={savingSettings}
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700 }}
              >
                {savingSettings ? 'Saving Settings…' : 'Save Platform Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DISPUTE RESOLUTION MODAL */}
      <Modal isOpen={disputeModalOpen} onClose={() => setDisputeModalOpen(false)} title="Resolve Dispute" maxWidth="520px">
        <form onSubmit={handleResolveDispute} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Resolution Decision</label>
            <select
              value={disputeOutcome}
              onChange={(e) => setDisputeOutcome(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}
            >
              <option value="refund_full">Refund Full Amount to Buyer</option>
              <option value="refund_partial">Partial Refund to Buyer (Remainder to Vendor)</option>
              <option value="reject">Reject Dispute (Release Full Payment to Vendor)</option>
              <option value="close">Close Dispute Without Refund</option>
            </select>
          </div>

          {disputeOutcome.includes('refund') && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Refund Amount (₦)</label>
              <input
                type="number"
                required
                step="any"
                value={disputeRefundKobo}
                onChange={(e) => setDisputeRefundKobo(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Resolution Notes (Visible to Parties)</label>
            <textarea
              rows={3}
              required
              value={disputeResolutionNote}
              onChange={(e) => setDisputeResolutionNote(e.target.value)}
              placeholder="State the findings of the investigation and reason for decision..."
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => setDisputeModalOpen(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={disputeBusy} className="btn btn-primary" style={{ padding: '8px 16px' }}>
              {disputeBusy ? 'Executing...' : 'Apply Official Resolution'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ADVERT PACKAGE MODAL */}
      <Modal
        isOpen={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        title={editingPackage ? 'Edit advert package' : 'New advert package'}
        description={editingPackage ? 'Vendors who already bought this keep their original price.' : undefined}
        maxWidth="460px"
      >
        <form onSubmit={handleSavePackage} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Placement</label>
            <select value={pkgType} onChange={(e) => setPkgType(e.target.value as AdvertType)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#fff' }}>
              <option value="sponsored">Sponsored</option>
              <option value="featured">Featured</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Duration (days)</label>
            <input type="number" min={1} max={365} required value={pkgDays} onChange={(e) => setPkgDays(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Price (naira)</label>
            <input type="number" min={0} step="0.01" required value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Label shown to vendors</label>
            <input type="text" value={pkgLabel} onChange={(e) => setPkgLabel(e.target.value)} placeholder="Leave blank to generate one" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={pkgActive} onChange={(e) => setPkgActive(e.target.checked)} />
            Offer this package to vendors
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={() => setPackageModalOpen(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={pkgBusy} className="btn btn-primary" style={{ padding: '8px 16px' }}>
              {pkgBusy ? 'Saving…' : editingPackage ? 'Save changes' : 'Create package'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
