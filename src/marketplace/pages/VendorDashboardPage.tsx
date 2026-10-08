import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package,
  Plus,
  CheckCircle2,
  Truck,
  Edit,
  ExternalLink,
  Store,
  Upload,
  Image as ImageIcon,
  X,
  Loader2,
  Clock,
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  Award,
  ShoppingCart,
  Percent,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchVendorOrders,
  fetchProducts,
  fetchCategories,
  upsertProduct,
  uploadProductImage,
  setListingStatus,
  adjustInventory,
  transitionOrder,
  requestWithdrawal,
  fetchWithdrawals,
  fetchVendorSettlements,
  fetchVendorWalletSummary,
  fetchWalletStatement,
  requestVendorVerification,
  uploadVerificationEvidence,
  saveVendor,
  fetchAdvertPackages,
  fetchMyAdverts,
  submitAdvert,
  cancelAdvert,
} from '../lib/api';
import type {
  MarketplaceOrder,
  MarketplaceProduct,
  MarketplaceCategory,
  MarketplaceWithdrawal,
  MarketplaceSettlement,
  MarketplaceLedgerEntry,
  VendorWalletSummary,
  ListingStatus,
  OrderStatus,
  Advert,
  AdvertPackage,
  AdvertAudience,
} from '../lib/types';
import { formatNaira, formatDate, formatOrderStatus, resolveProductImageUrl } from '../lib/format';
import { getProductFallbackImage } from '../components/ProductCard';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { SupportInbox } from './SupportPage';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';

export const VendorDashboardPage: React.FC = () => {
  const { user, vendor, refreshAuth, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'listings' | 'orders' | 'earnings' | 'adverts' | 'support' | 'settings' | 'verification'>('overview');
  const [loading, setLoading] = useState(true);

  // Data
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [withdrawals, setWithdrawals] = useState<MarketplaceWithdrawal[]>([]);
  const [settlements, setSettlements] = useState<MarketplaceSettlement[]>([]);
  const [walletSummary, setWalletSummary] = useState<VendorWalletSummary | null>(null);
  const [statement, setStatement] = useState<MarketplaceLedgerEntry[]>([]);

  // Add / Edit Product Modal state
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodTitle, setProdTitle] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodCatId, setProdCatId] = useState('');
  const [prodSubcatId, setProdSubcatId] = useState('');
  const [prodType, setProdType] = useState<'product' | 'service'>('product');
  const [prodPrice, setProdPrice] = useState('');
  const [prodComparePrice, setProdComparePrice] = useState('');
  const [prodCondition, setProdCondition] = useState('new');
  const [prodQty, setProdQty] = useState('10');
  const [prodFulfilment, setProdFulfilment] = useState<'pickup' | 'delivery' | 'both'>('both');
  const [prodDeliveryFee, setProdDeliveryFee] = useState('500');
  const [prodMeetingPoint, setProdMeetingPoint] = useState('');
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [prodBusy, setProdBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stock adjust modal
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<MarketplaceProduct | null>(null);
  const [stockDelta, setStockDelta] = useState('5');
  const [stockNote, setStockNote] = useState('Restocked items');
  const [stockBusy, setStockBusy] = useState(false);

  // Withdrawal modal
  const [withdrawalModalOpen, setWithdrawalModalOpen] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState('5000');
  const [withdrawBank, setWithdrawBank] = useState(vendor?.payout_bank_name || 'Opay');
  const [withdrawAccount, setWithdrawAccount] = useState(vendor?.payout_account_number || '');
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  // Adverts. The package list is what the admin priced; nothing here decides cost.
  const [adverts, setAdverts] = useState<Advert[]>([]);
  const [packages, setPackages] = useState<AdvertPackage[]>([]);
  const [advertModalOpen, setAdvertModalOpen] = useState(false);
  const [advertProductId, setAdvertProductId] = useState('');
  const [advertPackageId, setAdvertPackageId] = useState('');
  const [advertAudience, setAdvertAudience] = useState<AdvertAudience>('both');
  const [advertBusy, setAdvertBusy] = useState(false);
  const [advertCancelling, setAdvertCancelling] = useState<string | null>(null);

  // Verification request modal
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);
  const [verificationNote, setVerificationNote] = useState('');
  const [verificationFile, setVerificationFile] = useState<File | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);

  const closeVerificationModal = () => {
    setVerificationModalOpen(false);
    setVerificationNote('');
    setVerificationFile(null);
  };

  // Store settings form
  const [settingsName, setSettingsName] = useState(vendor?.store_name || '');
  const [settingsTagline, setSettingsTagline] = useState(vendor?.tagline || '');
  const [settingsDesc, setSettingsDesc] = useState(vendor?.description || '');
  const [settingsPhone, setSettingsPhone] = useState(vendor?.phone || '');
  const [settingsArea, setSettingsArea] = useState(vendor?.campus_area || 'Male Hostel A');
  const [settingsBusy, setSettingsBusy] = useState(false);

  const loadData = async () => {
    if (!vendor) return;
    setLoading(true);
    try {
      const [ordList, prodList, catList, withList, settList, walletList, entriesList] = await Promise.all([
        fetchVendorOrders(vendor.id),
        fetchProducts({ vendorId: vendor.id }, 1, 100),
        fetchCategories(),
        fetchWithdrawals(vendor.id),
        fetchVendorSettlements(vendor.id),
        fetchVendorWalletSummary(vendor.id),
        fetchWalletStatement(20, 0),
      ]);
      setOrders(ordList);
      setProducts(prodList.products);
      setCategories(catList);
      setWithdrawals(withList);
      setSettlements(settList);
      setWalletSummary(walletList);
      setStatement(entriesList.entries);

      if (catList.length > 0 && !prodCatId) {
        setProdCatId(catList[0].id);
      }
    } catch (err) {
      console.error('Failed to load vendor data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Adverts load on their own so a failure here cannot blank the whole dashboard.
  const loadAdverts = async () => {
    try {
      const [pkgList, myAdverts] = await Promise.all([
        fetchAdvertPackages(),
        fetchMyAdverts(),
      ]);
      setPackages(pkgList.packages);
      setAdverts(myAdverts.adverts ?? []);
    } catch (err) {
      console.error('Failed to load adverts:', err);
      setAdverts([]);
      setPackages([]);
    }
  };

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate(PLATFORM_PATHS.login);
      return;
    }
    if (!vendor) {
      navigate(mpPath('/vendor/register'));
      return;
    }
    loadData();
    loadAdverts();
  }, [isLoading, user, vendor]);

  // The notification link points straight at this tab.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'adverts') {
      setActiveTab('adverts');
    }
  }, []);

  const advertableProducts = products.filter((p) => p.status === 'active');
  const selectedPackage = packages.find((p) => p.id === advertPackageId);

  const handleOpenAdvert = () => {
    setAdvertProductId(advertableProducts[0]?.id ?? '');
    setAdvertPackageId(packages[0]?.id ?? '');
    setAdvertAudience('both');
    setAdvertModalOpen(true);
  };

  const handleSubmitAdvert = async () => {
    if (!advertProductId || !advertPackageId) {
      toast('Choose a listing and a package', 'error');
      return;
    }
    setAdvertBusy(true);
    try {
      await submitAdvert({
        productId: advertProductId,
        packageId: advertPackageId,
        targetAudience: advertAudience,
      });
      toast('Advert submitted. It is queued for review', 'success');
      setAdvertModalOpen(false);
      await loadAdverts();
    } catch (err: any) {
      toast(err?.message || 'Failed to submit the advert', 'error');
    } finally {
      setAdvertBusy(false);
    }
  };

  const handleCancelAdvert = async (advert: Advert) => {
    setAdvertCancelling(advert.id);
    try {
      const res = await cancelAdvert(advert.id);
      toast(
        res.refunded_kobo > 0
          ? `Advert withdrawn. ${formatNaira(res.refunded_kobo)} returned to your wallet`
          : 'Advert withdrawn',
        'success',
      );
      await loadAdverts();
    } catch (err: any) {
      toast(err?.message || 'Failed to withdraw the advert', 'error');
    } finally {
      setAdvertCancelling(null);
    }
  };

  const handleOpenAddProduct = () => {
    setEditingProductId(null);
    setProdTitle('');
    setProdDesc('');
    setProdType('product');
    setProdPrice('');
    setProdComparePrice('');
    setProdCondition('new');
    setProdQty('10');
    setProdFulfilment('both');
    setProdDeliveryFee('500');
    setProdMeetingPoint('');
    setProdImageUrl('');
    if (categories.length > 0) setProdCatId(categories[0].id);
    setProductModalOpen(true);
  };

  const handleOpenEditProduct = (p: MarketplaceProduct) => {
    setEditingProductId(p.id);
    setProdTitle(p.title);
    setProdDesc(p.description);
    setProdType(p.listing_type);
    setProdCatId(p.category_id);
    setProdSubcatId(p.subcategory_id || '');
    setProdPrice(String(p.price_kobo / 100));
    setProdComparePrice(p.compare_at_kobo ? String(p.compare_at_kobo / 100) : '');
    setProdCondition(p.condition);
    setProdQty(String(p.quantity_total));
    setProdFulfilment(p.fulfilment);
    setProdDeliveryFee(p.delivery_fee_kobo ? String(p.delivery_fee_kobo / 100) : '0');
    setProdMeetingPoint(p.meeting_point || '');
    setProdImageUrl(p.thumbnail_url || p.images?.[0]?.url || '');
    setProductModalOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Please upload a valid image file (JPG, PNG, or WebP).', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Image file size must be less than 5MB.', 'error');
      return;
    }

    setUploadingImage(true);
    try {
      const url = await uploadProductImage(file, vendor?.id || user?.id || 'general');
      setProdImageUrl(url);
      toast('Product photo uploaded successfully!', 'success');
    } catch (err: any) {
      console.error('Image upload failed:', err);
      toast(err.message || 'Failed to upload product photo.', 'error');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodTitle.trim() || !prodDesc.trim() || !prodPrice) {
      toast('Please fill in title, description and price', 'error');
      return;
    }

    setProdBusy(true);
    try {
      const priceKobo = Math.round(parseFloat(prodPrice) * 100);
      const compareKobo = prodComparePrice ? Math.round(parseFloat(prodComparePrice) * 100) : undefined;
      const deliveryFeeKobo = prodFulfilment !== 'pickup' && prodDeliveryFee ? Math.round(parseFloat(prodDeliveryFee) * 100) : 0;

      const imagesPayload = prodImageUrl.trim() ? [{ url: prodImageUrl.trim(), is_primary: true }] : undefined;

      await upsertProduct({
        product_id: editingProductId || undefined,
        title: prodTitle.trim(),
        description: prodDesc.trim(),
        category_id: prodCatId,
        subcategory_id: prodSubcatId || undefined,
        listing_type: prodType,
        price_kobo: priceKobo,
        compare_at_kobo: compareKobo,
        condition: prodCondition,
        quantity: prodType === 'product' ? parseInt(prodQty || '0', 10) : 0,
        fulfilment: prodFulfilment,
        delivery_fee_kobo: deliveryFeeKobo,
        meeting_point: prodMeetingPoint.trim() || undefined,
        publish: true,
        images: imagesPayload,
      });

      toast(editingProductId ? 'Listing updated successfully' : 'Product published to campus marketplace!', 'success');
      setProductModalOpen(false);
      loadData();
    } catch (err: any) {
      console.error('Save product error:', err);
      toast(err.message || 'Failed to save listing. Check inputs.', 'error');
    } finally {
      setProdBusy(false);
    }
  };

  const handleToggleStatus = async (productId: string, current: ListingStatus) => {
    const next: ListingStatus = current === 'active' ? 'paused' : 'active';
    try {
      await setListingStatus(productId, next);
      toast(`Listing ${next === 'active' ? 'activated' : 'paused'}`, 'info');
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to change listing status', 'error');
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockProduct) return;
    setStockBusy(true);
    try {
      await adjustInventory(stockProduct.id, parseInt(stockDelta, 10), stockNote.trim());
      toast('Inventory updated', 'success');
      setStockModalOpen(false);
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to adjust stock', 'error');
    } finally {
      setStockBusy(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, nextStatus: OrderStatus) => {
    try {
      await transitionOrder(orderId, nextStatus);
      toast(`Order status updated to ${nextStatus.replace('_', ' ')}`, 'success');
      loadData();
    } catch (err: any) {
      toast(err.message || 'Failed to update order status', 'error');
    }
  };

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawBusy(true);
    try {
      const amountKobo = Math.round(parseFloat(withdrawalAmount) * 100);
      await requestWithdrawal(amountKobo, withdrawBank, withdrawAccount, vendor?.payout_account_name || vendor?.store_name || '');
      toast('Withdrawal requested! Payout will be processed to your bank account.', 'success');
      setWithdrawalModalOpen(false);
      loadData();
    } catch (err: any) {
      toast(err.message || 'Withdrawal failed. Check minimum withdrawal limit (₦5,000).', 'error');
    } finally {
      setWithdrawBusy(false);
    }
  };

  const handleApplyVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    const note = verificationNote.trim();
    if (!note) {
      toast('Please write a brief note for verification', 'error');
      return;
    }
    if (note.length < 20) {
      toast('Please provide a note with at least 20 characters explaining your store operations.', 'error');
      return;
    }
    setVerificationBusy(true);
    let evidencePath: string | undefined;
    try {
      if (verificationFile && vendor) {
        evidencePath = await uploadVerificationEvidence(verificationFile, vendor.id);
      }
      await requestVendorVerification(note, evidencePath);
      toast('Verification request submitted for admin review.', 'success');
      closeVerificationModal();
      refreshAuth();
    } catch (err: any) {
      toast(err.message || 'Failed to submit verification request', 'error');
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsBusy(true);
    try {
      await saveVendor({
        vendor_id: vendor?.id,
        store_name: settingsName.trim(),
        slug: vendor!.slug,
        phone: settingsPhone.trim(),
        tagline: settingsTagline.trim() || undefined,
        description: settingsDesc.trim() || undefined,
        campus_area: settingsArea,
      });
      toast('Store settings updated', 'success');
      refreshAuth();
    } catch (err: any) {
      toast(err.message || 'Failed to update settings', 'error');
    } finally {
      setSettingsBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ paddingBottom: 60, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Skeleton height={120} borderRadius={14} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <Skeleton height={100} borderRadius={12} />
          <Skeleton height={100} borderRadius={12} />
          <Skeleton height={100} borderRadius={12} />
        </div>
        <Skeleton height={320} borderRadius={14} />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div style={{ padding: '40px 0' }}>
        <EmptyState
          icon={<Store size={36} />}
          title="No Active Storefront Found"
          description="You do not have an active vendor storefront associated with your account yet. Register your student business to start selling products and services on campus."
          action={
            <Link to={mpPath('/vendor/register')} className="btn btn-primary" style={{ padding: '10px 22px' }}>
              Register Storefront
            </Link>
          }
        />
      </div>
    );
  }

  // Overview metrics come from the wallet ledger, never from re-summing
  // settlements in the browser. The settlement row is a receivable, not a
  // balance: money only becomes withdrawable when it lands in `available`.
  const totalRevenueKobo = walletSummary?.lifetime_earned_kobo ?? 0;
  const availableBalanceKobo = walletSummary?.available_kobo ?? 0;
  const pendingBalanceKobo = walletSummary?.pending_kobo ?? 0;
  const paidOutKobo = walletSummary?.lifetime_paid_out_kobo ?? 0;

  const pendingOrdersCount = orders.filter((o) => ['paid', 'order_confirmed', 'preparing'].includes(o.status)).length;

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border, #dcebe0)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--green-900, #0d4a2f)' }}>
              {vendor.store_name}
            </h1>
            {vendor.is_verified ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#d1fae5', color: '#065f46', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                <CheckCircle2 size={14} /> Verified Vendor
              </span>
            ) : (vendor as any).verification === 'pending' || (vendor as any).verification_status === 'pending' || vendor.status === 'pending_review' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                <Clock size={13} /> PENDING REVIEW
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setVerificationModalOpen(true)}
                style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                Get Verified Checkmark
              </button>
            )}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
            Campus Vendor Control Center · {vendor.campus_area || 'FUW Campus'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Link
            to={mpPath(`/vendor/${vendor.slug}`)}
            target="_blank"
            className="btn btn-secondary"
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            <span>View Public Store</span>
            <ExternalLink size={14} />
          </Link>
          <button
            type="button"
            onClick={handleOpenAddProduct}
            className="btn btn-primary"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            <Plus size={16} />
            <span>Add New Listing</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border, #dcebe0)', marginBottom: 24, overflowX: 'auto' }}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'analytics', label: 'Business Analytics' },
          { key: 'listings', label: `Listings (${products.length})` },
          { key: 'orders', label: `Orders (${orders.length})` },
          { key: 'earnings', label: 'Earnings & Payouts' },
          { key: 'adverts', label: `Adverts (${adverts.length})` },
          { key: 'support', label: 'Support' },
          { key: 'settings', label: 'Store Settings' },
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
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height={100} borderRadius={12} />
          ))}
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {!loading && activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* KPI Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16 }}>
            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Available Payout Balance</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>
                {formatNaira(Math.max(0, availableBalanceKobo))}
              </span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Gross Sales Volume</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary, #17231d)' }}>
                {formatNaira(totalRevenueKobo)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', display: 'block', marginTop: 4 }}>
                {formatNaira(paidOutKobo)} already paid out
              </span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Pending Clearance</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: pendingBalanceKobo > 0 ? '#b45309' : 'var(--text-primary, #17231d)' }}>
                {formatNaira(pendingBalanceKobo)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', display: 'block', marginTop: 4 }}>
                Held until delivery is confirmed
              </span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Pending Shipments</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: pendingOrdersCount > 0 ? '#b45309' : 'var(--text-primary, #17231d)' }}>
                {pendingOrdersCount}
              </span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', padding: 20, borderRadius: 12, border: '1px solid var(--border, #dcebe0)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Store Rating</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary, #17231d)' }}>
                {Number(vendor.rating_avg) > 0 ? `${Number(vendor.rating_avg).toFixed(1)} ★` : 'New'}
              </span>
            </div>
          </div>

          {/* Quick Recent Orders */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent Customer Orders</h3>
              <button onClick={() => setActiveTab('orders')} style={{ background: 'none', border: 'none', color: 'var(--green-800, #12603d)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                View all orders →
              </button>
            </div>

            {orders.length === 0 ? (
              <p style={{ color: 'var(--muted, #55675b)', fontSize: 14, margin: 0 }}>No customer orders placed yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {orders.slice(0, 4).map((o) => (
                  <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', fontSize: 13 }}>
                    <div>
                      <strong style={{ display: 'block' }}>#{o.order_number}</strong>
                      <span style={{ color: 'var(--text-secondary, #55675b)' }}>{formatDate(o.created_at)} · {o.items?.length || 1} items</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ display: 'block', color: 'var(--green-900, #0d4a2f)' }}>{formatNaira(o.total_kobo)}</strong>
                      <span style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 700 }}>{o.status.replace('_', ' ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: BUSINESS ANALYTICS */}
      {activeTab === 'analytics' && (() => {
        const totalRev = orders.filter((o) => o.status !== 'cancelled').reduce((acc, o) => acc + o.total_kobo, 0);
        const netEarn = orders.filter((o) => o.status !== 'cancelled').reduce((acc, o) => acc + (o.vendor_payout_kobo || o.subtotal_kobo), 0);
        const completedCount = orders.filter((o) => o.status === 'completed').length;
        const inTransitCount = orders.filter((o) => ['paid', 'confirmed', 'in_transit', 'delivered'].includes(o.status)).length;
        const pendingCount = orders.filter((o) => o.status === 'pending_payment').length;
        const cancelledCount = orders.filter((o) => ['cancelled', 'disputed'].includes(o.status)).length;
        const aov = orders.length > 0 ? Math.round(totalRev / orders.length) : 0;
        const totalViews = products.reduce((acc, p) => acc + (p.views_count || 0), 0);
        const convRate = totalViews > 0 ? ((orders.length / totalViews) * 100).toFixed(1) : '0.0';
        const bestSellers = [...products].sort((a, b) => (b.quantity_sold || 0) - (a.quantity_sold || 0)).slice(0, 5);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Analytics Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#17231d' }}>
                  Vendor Business Performance Analytics
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                  Real-time sales velocity, order metrics, customer conversion, and top revenue drivers.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#e8f5ec', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#065f46' }}>
                <TrendingUp size={14} />
                <span>Live Data Tracking</span>
              </div>
            </div>

            {/* Top Metric Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
              <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#55675b' }}>Gross Sales Revenue</span>
                  <DollarSign size={18} color="#059669" />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green-900, #0d4a2f)' }}>{formatNaira(totalRev)}</div>
                <div style={{ fontSize: 11, color: '#059669', marginTop: 4 }}>Across {orders.length} total customer orders</div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#55675b' }}>Net Payout Earnings</span>
                  <Award size={18} color="#2563eb" />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#1d4ed8' }}>{formatNaira(netEarn)}</div>
                <div style={{ fontSize: 11, color: '#55675b', marginTop: 4 }}>After platform commission deductions</div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#55675b' }}>Average Order Value</span>
                  <ShoppingCart size={18} color="#b45309" />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#92400e' }}>{formatNaira(aov)}</div>
                <div style={{ fontSize: 11, color: '#55675b', marginTop: 4 }}>Average basket size per customer</div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#55675b' }}>Listing Views &amp; Conversion</span>
                  <Percent size={18} color="#7c3aed" />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#6d28d9' }}>{convRate}%</div>
                <div style={{ fontSize: 11, color: '#55675b', marginTop: 4 }}>{totalViews} views generated</div>
              </div>
            </div>

            {/* Split Row: Order Pipeline & Escrow Status */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 20 }}>
              {/* Order Status Funnel */}
              <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Order Fulfillment Pipeline</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>Completed &amp; Delivered</span>
                    <strong style={{ fontSize: 15, color: '#166534' }}>{completedCount} orders</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>In Progress / In Transit</span>
                    <strong style={{ fontSize: 15, color: '#1e40af' }}>{inTransitCount} orders</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>Awaiting Buyer Payment</span>
                    <strong style={{ fontSize: 15, color: '#92400e' }}>{pendingCount} orders</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>Cancelled / Disputed</span>
                    <strong style={{ fontSize: 15, color: '#991b1b' }}>{cancelledCount} orders</strong>
                  </div>
                </div>
              </div>

              {/* Escrow & Payout Health */}
              <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Escrow &amp; Payout Liquidity</h4>
                  <ShieldCheck size={18} color="#059669" />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ background: '#f8faf9', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                    <span style={{ fontSize: 12, color: '#55675b', display: 'block' }}>Held in Escrow Protection</span>
                    <strong style={{ fontSize: 20, color: 'var(--green-900, #0d4a2f)', display: 'block', margin: '4px 0' }}>
                      {formatNaira(walletSummary?.pending_kobo ?? 0)}
                    </strong>
                    <span style={{ fontSize: 11, color: '#55675b' }}>Released automatically when buyer confirms delivery</span>
                  </div>

                  <div style={{ background: '#f8faf9', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                    <span style={{ fontSize: 12, color: '#55675b', display: 'block' }}>Available for Immediate Withdrawal</span>
                    <strong style={{ fontSize: 20, color: '#059669', display: 'block', margin: '4px 0' }}>
                      {formatNaira(walletSummary?.available_kobo ?? 0)}
                    </strong>
                    <span style={{ fontSize: 11, color: '#55675b' }}>Direct to your verified Nigerian bank account</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Best Performing Products Table */}
            <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 12, padding: 20 }}>
              <h4 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Top Selling Products &amp; Services</h4>
              {bestSellers.length === 0 ? (
                <p style={{ color: 'var(--text-secondary, #55675b)', fontSize: 13 }}>No product sales recorded yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left', color: '#55675b' }}>
                        <th style={{ padding: '8px 12px' }}>Product</th>
                        <th style={{ padding: '8px 12px' }}>Price</th>
                        <th style={{ padding: '8px 12px' }}>Units Sold</th>
                        <th style={{ padding: '8px 12px' }}>Stock Left</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>Est. Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bestSellers.map((prod) => (
                        <tr key={prod.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600 }}>{prod.title}</td>
                          <td style={{ padding: '10px 12px' }}>{formatNaira(prod.price_kobo)}</td>
                          <td style={{ padding: '10px 12px', color: '#059669', fontWeight: 700 }}>{prod.quantity_sold || 0}</td>
                          <td style={{ padding: '10px 12px' }}>{prod.quantity_total - (prod.quantity_sold || 0)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--green-900, #0d4a2f)' }}>
                            {formatNaira(prod.price_kobo * (prod.quantity_sold || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* TAB 2: LISTINGS */}
      {activeTab === 'listings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Published Products & Services</h3>
            <button type="button" onClick={handleOpenAddProduct} className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 13 }}>
              <Plus size={15} /> <span>New Listing</span>
            </button>
          </div>

          {products.length === 0 ? (
            <EmptyState
              icon={<Package size={32} />}
              title="No Listings Yet"
              description="Add your first campus product, meal, or service to start getting customer orders."
              action={
                <button type="button" onClick={handleOpenAddProduct} className="btn btn-primary" style={{ padding: '9px 18px' }}>
                  Create First Listing
                </button>
              }
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {products.map((p) => {
                const stock = p.quantity_total - p.quantity_sold - p.quantity_reserved;
                const isOut = !p.is_service && stock <= 0;

                return (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--surface, #ffffff)',
                      borderRadius: 12,
                      border: '1px solid var(--border, #dcebe0)',
                      padding: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 260 }}>
                      <div style={{ width: 54, height: 54, borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', overflow: 'hidden', flexShrink: 0 }}>
                        {(() => {
                          const thumbSrc = resolveProductImageUrl(
                            p.thumbnail_url || (p as any).thumbnail_path || p.images?.[0]?.url || (p.images?.[0] as any)?.storage_path
                          ) || getProductFallbackImage(p);
                          return (
                            <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          );
                        })()}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{p.title}</h4>
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: p.is_service ? '#e0f2fe' : 'var(--surface-alt, #f4f8f5)', color: p.is_service ? '#0369a1' : 'var(--text-secondary, #55675b)', fontWeight: 600 }}>
                            {p.listing_type}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', marginTop: 2 }}>
                          {formatNaira(p.price_kobo)} · {!p.is_service ? (isOut ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>Out of Stock</span> : `${stock} in stock`) : 'Service on booking'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(p.id, p.status)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1px solid var(--border, #dcebe0)',
                          background: p.status === 'active' ? '#d1fae5' : '#fee2e2',
                          color: p.status === 'active' ? '#065f46' : '#991b1b',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {p.status.toUpperCase()}
                      </button>

                      {!p.is_service && (
                        <button
                          type="button"
                          onClick={() => { setStockProduct(p); setStockModalOpen(true); }}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Stock ±
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenEditProduct(p)}
                        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer', display: 'flex' }}
                        title="Edit listing"
                      >
                        <Edit size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ORDERS */}
      {activeTab === 'orders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Incoming Customer Orders</h3>

          {orders.length === 0 ? (
            <EmptyState
              icon={<Truck size={32} />}
              title="No Orders Received"
              description="Customer orders will appear here for you to accept, prepare, and deliver."
            />
          ) : (
            orders.map((o) => {
              const statusInfo = formatOrderStatus(o.status);

              return (
                <div
                  key={o.id}
                  style={{
                    background: 'var(--surface, #ffffff)',
                    borderRadius: 14,
                    border: '1px solid var(--border, #dcebe0)',
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <strong style={{ fontSize: 15, color: 'var(--green-900, #0d4a2f)' }}>#{o.order_number}</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', marginLeft: 8 }}>{formatDate(o.created_at)}</span>
                    </div>
                    <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: statusInfo.tone === 'success' ? '#d1fae5' : '#fef3c7', color: statusInfo.tone === 'success' ? '#065f46' : '#92400e' }}>
                      {statusInfo.label}
                    </span>
                  </div>

                  {/* Customer and Delivery info */}
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>
                      <strong>Customer: </strong> {o.buyer?.full_name || 'FUW Student'} ({o.buyer?.phone || o.delivery_snapshot?.phone || 'No phone'})
                    </div>
                    {o.delivery_snapshot?.address_line && (
                      <div>
                        <strong>Deliver To: </strong> {o.delivery_snapshot.campus_area} · {o.delivery_snapshot.address_line}
                        {o.delivery_snapshot.landmark ? ` (${o.delivery_snapshot.landmark})` : ''}
                      </div>
                    )}
                    {o.delivery_snapshot?.meeting_point && (
                      <div>
                        <strong>Pickup Point: </strong> {o.delivery_snapshot.meeting_point}
                      </div>
                    )}
                    {o.buyer_note && (
                      <div style={{ color: 'var(--text-secondary, #55675b)' }}>
                        <em>Buyer note: "{o.buyer_note}"</em>
                      </div>
                    )}
                  </div>

                  {/* Items */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(o.items || []).map((it) => (
                      <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span>{it.quantity} × {it.product_title}</span>
                        <strong style={{ color: 'var(--green-900, #0d4a2f)' }}>{formatNaira(it.line_total_kobo)}</strong>
                      </div>
                    ))}
                  </div>

                  {/* Fulfilment status buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border, #dcebe0)' }}>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>Total: {formatNaira(o.total_kobo)}</span>

                    <div style={{ display: 'flex', gap: 8 }}>
                      {o.status === 'paid' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateOrderStatus(o.id, 'order_confirmed')}
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                        >
                          Confirm Order
                        </button>
                      )}
                      {o.status === 'order_confirmed' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateOrderStatus(o.id, 'preparing')}
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                        >
                          Mark Preparing
                        </button>
                      )}
                      {o.status === 'preparing' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateOrderStatus(o.id, 'ready_for_delivery')}
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                        >
                          Ready for Delivery
                        </button>
                      )}
                      {o.status === 'ready_for_delivery' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateOrderStatus(o.id, 'delivered')}
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                        >
                          Mark as Delivered
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 4: EARNINGS & WITHDRAWALS */}
      {activeTab === 'earnings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16 }}>
            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Available for Withdrawal</span>
              <span style={{ fontSize: 30, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>
                {formatNaira(walletSummary?.available_kobo ?? 0)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginTop: 6 }}>
                Minimum payout ₦5,000.00
              </span>
              <button
                type="button"
                onClick={() => setWithdrawalModalOpen(true)}
                disabled={(walletSummary?.available_kobo ?? 0) < 500000}
                className="btn btn-primary"
                style={{ padding: '10px 20px', fontSize: 14, marginTop: 14 }}
              >
                Request Bank Payout
              </button>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Pending Clearance</span>
              <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-primary, #16281d)' }}>
                {formatNaira(walletSummary?.pending_kobo ?? 0)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginTop: 6 }}>
                Held until the buyer confirms delivery.
              </span>
            </div>

            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 6 }}>Lifetime Earnings</span>
              <span style={{ fontSize: 30, fontWeight: 800 }}>{formatNaira(walletSummary?.lifetime_earned_kobo ?? 0)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginTop: 6 }}>
                Paid out {formatNaira(walletSummary?.lifetime_paid_out_kobo ?? 0)} to date.
              </span>
            </div>
          </div>

          {/* Transaction history, straight from the append-only ledger. */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Transaction History</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
              Every movement on your wallet, newest first. These balances are maintained by the
              platform and cannot be edited from this page.
            </p>
            {statement.length === 0 ? (
              <p style={{ color: 'var(--muted, #55675b)', fontSize: 13, margin: 0 }}>No transactions yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {statement.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      padding: '11px 13px', borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', fontSize: 13,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ textTransform: 'capitalize' }}>{entry.entry_type.replace(/_/g, ' ')}</strong>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>
                        {entry.description || entry.reference_type || '-'} · {formatDate(entry.created_at)}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <strong style={{ color: entry.direction === 'credit' ? '#065f46' : '#991b1b' }}>
                        {entry.direction === 'credit' ? '+' : '−'}{formatNaira(entry.amount_kobo)}
                      </strong>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>
                        {entry.bucket} · {formatNaira(entry.balance_after)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Past Withdrawals */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Payout History</h3>
            {withdrawals.length === 0 ? (
              <p style={{ color: 'var(--muted, #55675b)', fontSize: 13, margin: 0 }}>No withdrawals requested yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {withdrawals.map((w) => (
                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', fontSize: 13 }}>
                    <div>
                      <strong>{formatNaira(w.amount_kobo)}</strong>
                      {w.destination?.bank_name && (
                        <> to {w.destination.bank_name} ({w.destination.account_number})</>
                      )}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>{formatDate(w.requested_at || w.created_at)}</span>
                      {w.reviewer_note && (
                        <span style={{ display: 'block', fontSize: 11, color: '#991b1b' }}>{w.reviewer_note}</span>
                      )}
                    </div>
                    <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, color: w.status === 'paid' ? '#065f46' : (w.status === 'rejected' || w.status === 'cancelled') ? '#991b1b' : '#92400e' }}>
                      {w.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Receivables, for context only. These are not balances. */}
          {settlements.length > 0 && (
            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Order Settlements</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                What each completed order owes you, and whether it has cleared.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {settlements.slice(0, 20).map((s) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 13px', borderRadius: 8, background: 'var(--surface-alt, #f4f8f5)', fontSize: 13 }}>
                    <div>
                      <strong>{formatNaira(s.net_kobo)}</strong>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>
                        Gross {formatNaira(s.gross_kobo)} · fee {formatNaira(s.commission_kobo)}
                        {s.eligible_at ? ` · clears ${formatDate(s.eligible_at)}` : ''}
                      </span>
                    </div>
                    <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, color: s.status === 'paid_out' ? '#065f46' : (s.status === 'cancelled' || s.status === 'failed') ? '#991b1b' : '#92400e' }}>
                      {s.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: ADVERTS */}
      {activeTab === 'adverts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Your Adverts</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                Pay to be shown higher in search and on the marketplace home page.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenAdvert}
              disabled={advertableProducts.length === 0 || packages.length === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px',
                borderRadius: 10, border: 'none', cursor:
                  advertableProducts.length === 0 || packages.length === 0 ? 'not-allowed' : 'pointer',
                background: 'var(--green-800, #12603d)', color: '#fff', fontWeight: 700, fontSize: 14,
                opacity: advertableProducts.length === 0 || packages.length === 0 ? 0.5 : 1,
              }}
            >
              <Plus size={16} /> Boost a listing
            </button>
          </div>

          {advertableProducts.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
              Only active listings can be advertised. Publish a listing first.
            </p>
          )}

          {adverts.length === 0 ? (
            <EmptyState
              title="No adverts yet"
              description="Boost a listing to reach more students."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {adverts.map((advert) => {
                const canWithdraw =
                  advert.approval_state === 'pending' ||
                  (advert.status === 'scheduled' && new Date(advert.start_at) > new Date());
                const badge =
                  advert.approval_state === 'rejected' ? 'rejected'
                  : advert.status === 'expired' ? 'expired'
                  : advert.status === 'suspended' ? 'suspended'
                  : advert.status === 'scheduled' ? 'scheduled'
                  : 'live';
                return (
                  <div
                    key={advert.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
                      background: 'var(--surface, #ffffff)', border: '1px solid var(--border, #dcebe0)',
                      borderRadius: 12, padding: 16,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                          {advert.product?.title ?? 'Storefront advert'}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                          padding: '2px 8px', borderRadius: 999,
                          background: badge === 'live' ? '#e3f5ea' : '#f1f4f2',
                          color: badge === 'live' ? '#12603d' : 'var(--text-secondary, #55675b)',
                        }}>
                          {badge}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                          {advert.advert_type}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                        {formatNaira(advert.price_kobo)} for {advert.duration_days} days
                        {' · '}
                        {advert.target_audience === 'both'
                          ? 'everyone'
                          : `${advert.target_audience} buyers only`}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', marginTop: 4 }}>
                        {formatDate(advert.start_at)} to {formatDate(advert.end_at)}
                      </div>
                      {advert.approval_state === 'pending' && (
                        <div style={{ fontSize: 12, color: 'var(--amber-700, #8a5a00)', marginTop: 6 }}>
                          Awaiting review. You are not charged until it is approved.
                        </div>
                      )}
                      {advert.reviewer_note && (
                        <div style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>
                          “{advert.reviewer_note}”
                        </div>
                      )}
                    </div>
                    {canWithdraw && (
                      <button
                        type="button"
                        onClick={() => handleCancelAdvert(advert)}
                        disabled={advertCancelling === advert.id}
                        style={{
                          alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 8,
                          border: '1px solid var(--border, #dcebe0)', background: 'var(--surface, #ffffff)',
                          color: 'var(--text-secondary, #55675b)', fontWeight: 600, fontSize: 13,
                          cursor: advertCancelling === advert.id ? 'wait' : 'pointer',
                        }}
                      >
                        {advertCancelling === advert.id ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PHASE 16: SUPPORT */}
      {activeTab === 'support' && (
        <SupportInbox viewer="vendor" embedded />
      )}

      {/* TAB 6: SETTINGS */}
      {activeTab === 'settings' && (
        <div style={{ maxWidth: 600, background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 24 }}>
          <h3 style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 700 }}>Storefront Settings</h3>
          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Store Name</label>
              <input type="text" required value={settingsName} onChange={(e) => setSettingsName(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Tagline</label>
              <input type="text" value={settingsTagline} onChange={(e) => setSettingsTagline(e.target.value)} placeholder="Short business catchphrase" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Store Description</label>
              <textarea rows={3} value={settingsDesc} onChange={(e) => setSettingsDesc(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Contact Phone / WhatsApp</label>
              <input type="tel" required value={settingsPhone} onChange={(e) => setSettingsPhone(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Primary Campus Location</label>
              <select value={settingsArea} onChange={(e) => setSettingsArea(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}>
                <option value="Male Hostel A">Male Hostel A</option>
                <option value="Male Hostel B">Male Hostel B</option>
                <option value="Female Hostel A">Female Hostel A</option>
                <option value="Female Hostel B">Female Hostel B</option>
                <option value="New Site Campus">New Site Campus</option>
                <option value="Faculty of Science">Faculty of Science</option>
                <option value="Faculty of Computing">Faculty of Computing</option>
                <option value="Off-Campus Wukari">Off-Campus Wukari</option>
              </select>
            </div>

            <button type="submit" disabled={settingsBusy} className="btn btn-primary" style={{ padding: '10px 18px', alignSelf: 'flex-start' }}>
              {settingsBusy ? 'Saving...' : 'Save Settings'}
            </button>
          </form>
        </div>
      )}

      {/* ADD / EDIT PRODUCT MODAL */}
      <Modal isOpen={productModalOpen} onClose={() => setProductModalOpen(false)} title={editingProductId ? 'Edit Listing' : 'Add New Product or Service'} maxWidth="600px">
        <form onSubmit={handleSaveProduct} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Listing Type</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
                <input type="radio" name="prodType" checked={prodType === 'product'} onChange={() => setProdType('product')} />
                <span>Physical Product</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
                <input type="radio" name="prodType" checked={prodType === 'service'} onChange={() => setProdType('service')} />
                <span>Campus Service</span>
              </label>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Title *</label>
            <input type="text" required value={prodTitle} onChange={(e) => setProdTitle(e.target.value)} placeholder="e.g. Scientific Calculator Casio FX-991" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Category *</label>
            <select value={prodCatId} onChange={(e) => setProdCatId(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}>
              {categories.filter((c) => c.listing_type === prodType).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="mp-field-grid" style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Selling Price (₦) *</label>
              <input type="number" required min="1" step="any" value={prodPrice} onChange={(e) => setProdPrice(e.target.value)} placeholder="e.g. 5000" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Original / Compare Price (₦)</label>
              <input type="number" min="1" step="any" value={prodComparePrice} onChange={(e) => setProdComparePrice(e.target.value)} placeholder="e.g. 6500 (optional)" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
            </div>
          </div>

          {prodType === 'product' && (
            <div className="mp-field-grid" style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Condition</label>
                <select value={prodCondition} onChange={(e) => setProdCondition(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}>
                  <option value="new">Brand New</option>
                  <option value="like_new">Like New</option>
                  <option value="good">Good Condition</option>
                  <option value="fair">Fair / Used</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Available Stock Quantity</label>
                <input type="number" min="0" value={prodQty} onChange={(e) => setProdQty(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Description *</label>
            <textarea rows={3} required value={prodDesc} onChange={(e) => setProdDesc(e.target.value)} placeholder="Provide full details, specifications, warranty, condition notes..." style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Product Picture / Photo
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleImageUpload}
                />
                <button
                  type="button"
                  disabled={uploadingImage || prodBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {uploadingImage ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Uploading photo...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      <span>Upload Product Picture</span>
                    </>
                  )}
                </button>

                {prodImageUrl && (
                  <button
                    type="button"
                    onClick={() => setProdImageUrl('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#b91c1c',
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: 4,
                    }}
                  >
                    <X size={14} /> Clear Image
                  </button>
                )}
              </div>

              {prodImageUrl && (
                <div style={{ position: 'relative', width: 90, height: 90, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border, #dcebe0)', background: '#f8faf9' }}>
                  <img
                    src={prodImageUrl}
                    alt="Product preview"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              )}

              <div style={{ marginTop: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 4 }}>
                  Or enter direct image URL:
                </span>
                <input
                  type="url"
                  value={prodImageUrl}
                  onChange={(e) => setProdImageUrl(e.target.value)}
                  placeholder="https://example.com/product-photo.jpg"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 13 }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => setProductModalOpen(false)} disabled={prodBusy} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={prodBusy} className="btn btn-primary" style={{ padding: '9px 20px' }}>
              {prodBusy ? 'Publishing...' : editingProductId ? 'Update Listing' : 'Publish Listing'}
            </button>
          </div>
        </form>
      </Modal>

      {/* STOCK ADJUST MODAL */}
      <Modal isOpen={stockModalOpen} onClose={() => setStockModalOpen(false)} title={`Adjust Stock: ${stockProduct?.title || ''}`} maxWidth="400px">
        <form onSubmit={handleAdjustStock} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Quantity to Add/Subtract</label>
            <input type="number" required value={stockDelta} onChange={(e) => setStockDelta(e.target.value)} placeholder="Use negative number to decrease" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Reason / Note</label>
            <input type="text" value={stockNote} onChange={(e) => setStockNote(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={() => setStockModalOpen(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={stockBusy} className="btn btn-primary" style={{ padding: '8px 16px' }}>{stockBusy ? 'Saving...' : 'Apply Adjustment'}</button>
          </div>
        </form>
      </Modal>

      {/* WITHDRAWAL MODAL */}
      <Modal isOpen={withdrawalModalOpen} onClose={() => setWithdrawalModalOpen(false)} title="Request Payout Transfer" maxWidth="440px">
        <form onSubmit={handleRequestWithdrawal} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Amount (₦) *</label>
            <input type="number" required min="5000" step="any" value={withdrawalAmount} onChange={(e) => setWithdrawalAmount(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Bank Name *</label>
            <input type="text" required value={withdrawBank} onChange={(e) => setWithdrawBank(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Account Number *</label>
            <input type="text" required maxLength={10} value={withdrawAccount} onChange={(e) => setWithdrawAccount(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => setWithdrawalModalOpen(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={withdrawBusy} className="btn btn-primary" style={{ padding: '8px 16px' }}>{withdrawBusy ? 'Submitting...' : 'Submit Payout Request'}</button>
          </div>
        </form>
      </Modal>

      {/* VERIFICATION MODAL */}
      <Modal isOpen={verificationModalOpen} onClose={closeVerificationModal} title="Apply for Verified Student Seller Badge" maxWidth="480px">
        <form onSubmit={handleApplyVerification} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
            Verified vendors get a trust badge on all product listings, higher ranking in search, and lower dispute hold times.
          </p>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Verification Details / Proof *</label>
            <textarea rows={3} required value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="Provide your FUW student ID details, matriculation number, or shop location for verification..." style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Supporting Evidence (optional)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setVerificationFile(e.target.files?.[0] ?? null)}
              style={{ width: '100%', fontSize: 13 }}
            />
            {verificationFile && (
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary, #55675b)', marginTop: 4 }}>
                {verificationFile.name} ({(verificationFile.size / 1024 / 1024).toFixed(2)} MB)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={closeVerificationModal} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={verificationBusy} className="btn btn-primary" style={{ padding: '8px 16px' }}>{verificationBusy ? 'Submitting...' : 'Submit Verification'}</button>
          </div>
        </form>
      </Modal>

      {/* ADVERT MODAL */}
      <Modal isOpen={advertModalOpen} onClose={() => setAdvertModalOpen(false)} title="Boost a listing" description="Prices are set by the marketplace admin." maxWidth="480px">
        <form onSubmit={handleSubmitAdvert} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Which listing?</label>
            <select required value={advertProductId} onChange={(e) => setAdvertProductId(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#fff' }}>
              {advertableProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Placement</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {packages.map((pkg) => (
                <label
                  key={pkg.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                    border: advertPackageId === pkg.id
                      ? '2px solid var(--green-800, #12603d)'
                      : '1px solid var(--border, #dcebe0)',
                    background: advertPackageId === pkg.id ? '#f2faf5' : 'var(--surface, #ffffff)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="radio"
                      name="advert-package"
                      checked={advertPackageId === pkg.id}
                      onChange={() => setAdvertPackageId(pkg.id)}
                    />
                    <span>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, textTransform: 'capitalize' }}>
                        {pkg.advert_type}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        {pkg.duration_days} days
                      </span>
                    </span>
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{formatNaira(pkg.price_kobo)}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Who should see it?</label>
            <select value={advertAudience} onChange={(e) => setAdvertAudience(e.target.value as AdvertAudience)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#fff' }}>
              <option value="both">Everyone</option>
              <option value="male">Male buyers only</option>
              <option value="female">Female buyers only</option>
            </select>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
              Targeting is applied by the server using each buyer's own profile.
            </p>
          </div>

          {selectedPackage && (
            <div style={{ background: '#f2faf5', borderRadius: 10, padding: 14, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary, #55675b)' }}>Placement cost</span>
                <span style={{ fontWeight: 700 }}>{formatNaira(selectedPackage.price_kobo)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ color: 'var(--text-secondary, #55675b)' }}>Runs for</span>
                <span style={{ fontWeight: 700 }}>{selectedPackage.duration_days} days</span>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                Charged from your wallet only after an admin approves it. Withdraw before it starts running and you are not charged.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={() => setAdvertModalOpen(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', background: '#ffffff', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={advertBusy} className="btn btn-primary" style={{ padding: '8px 16px' }}>
              {advertBusy ? 'Submitting…' : 'Submit for review'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
