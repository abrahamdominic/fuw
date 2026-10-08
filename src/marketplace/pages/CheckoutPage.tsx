import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck,
  CreditCard,
  Building,
  Lock,
  ArrowRight,
  ExternalLink,
  Wallet,
  CheckCircle2,
  Package,
  Printer,
  Clock,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { DigitalReceiptModal } from '../components/DigitalReceiptModal';
import { useCart } from '../lib/cart';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import {
  createOrders,
  fetchAddresses,
  saveAddress,
  initializePayment,
  fetchMyWallet,
  payOrderFromWallet,
} from '../lib/api';
import { formatNaira } from '../lib/format';
import type { MarketplaceAddress, MarketplaceWallet } from '../lib/types';
import { Skeleton } from '../components/Skeleton';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';

interface CheckoutResult {
  payment_id?: string;
  order_count?: number;
  total_kobo?: number;
  replayed?: boolean;
  payments_enabled?: boolean;
  orders?: Array<{ id: string; order_number: string; payment_id?: string; total_kobo?: number }>;
}

interface CompletedOrderSnapshot {
  orderNumbers: string[];
  isPaid: boolean;
  paymentMethod: string;
  items: Array<{
    title: string;
    variantLabel?: string | null;
    quantity: number;
    unitPriceKobo: number;
    lineTotalKobo: number;
    image?: string;
    vendorName?: string;
  }>;
  subtotalKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
  recipientName: string;
  phone: string;
  deliveryAddress: string;
  deliveryPin: string;
}

export const CheckoutPage: React.FC = () => {
  const { items, clearCart, groupedByVendor, subtotalKobo } = useCart();
  const { user, profile, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [deliveryType, setDeliveryType] = useState<'delivery' | 'pickup'>('delivery');
  const [addresses, setAddresses] = useState<MarketplaceAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');

  // Form for new address
  const [recipientName, setRecipientName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [campusArea, setCampusArea] = useState(profile?.campus_hostel || 'Hostel A');
  const [addressLine, setAddressLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [buyerNote, setBuyerNote] = useState('');

  // Payment choice
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'bank_transfer' | 'wallet'>('card');
  const [submitting, setSubmitting] = useState(false);
  const [createdOrderNumbers, setCreatedOrderNumbers] = useState<string[] | null>(null);
  const [orderSnapshot, setOrderSnapshot] = useState<CompletedOrderSnapshot | null>(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [wallet, setWallet] = useState<MarketplaceWallet | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      toast('Please sign in to proceed to checkout', 'info');
      navigate(PLATFORM_PATHS.login);
      return;
    }

    // The wallet balance is only shown when it can actually pay for the whole
    // basket. The server re-checks before it debits anything.
    fetchMyWallet()
      .then(setWallet)
      .catch(() => setWallet(null));

    fetchAddresses().then((list) => {
      setAddresses(list);
      if (list.length > 0) {
        const def = list.find((a) => a.is_default) || list[0];
        setSelectedAddressId(def.id);
        setRecipientName(def.recipient_name);
        setPhone(def.phone);
        setCampusArea(def.campus_area);
        setAddressLine(def.address_line);
        setLandmark(def.landmark || '');
      }
    });
  }, [user]);

  if (items.length === 0 && !createdOrderNumbers) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <h2>No Items to Checkout</h2>
        <p style={{ color: 'var(--text-secondary, #55675b)' }}>Your shopping cart is currently empty.</p>
        <Link to={mpPath("/browse")} className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
          Browse Marketplace
        </Link>
      </div>
    );
  }

  // Customized Order Confirmation and Item Receipt View
  if (orderSnapshot || createdOrderNumbers) {
    const isPaid = orderSnapshot?.isPaid ?? false;
    const orderNumbers = orderSnapshot?.orderNumbers || createdOrderNumbers || [];
    const orderedItems = orderSnapshot?.items || [];

    return (
      <div style={{ maxWidth: 680, margin: '40px auto', padding: '32px 24px', background: 'var(--surface, #ffffff)', borderRadius: 18, border: '1px solid var(--border, #dcebe0)', boxShadow: '0 10px 30px rgba(18, 41, 28, 0.08)' }}>
        {/* Header Badge */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: isPaid ? 'linear-gradient(135deg, #e8f5ec, #c8ebd3)' : '#fef3c7',
              color: isPaid ? '#12603d' : '#92400e',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px',
              boxShadow: isPaid ? '0 8px 20px rgba(18, 96, 61, 0.2)' : '0 8px 20px rgba(146, 64, 14, 0.15)',
            }}
          >
            {isPaid ? <CheckCircle2 size={38} strokeWidth={2.4} /> : <Clock size={36} />}
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 6px', color: '#0d4a2f' }}>
            {isPaid ? 'Order Placed & Escrow Protected!' : 'Order Reserved: Payment Pending'}
          </h2>
          <p style={{ color: 'var(--text-secondary, #55675b)', margin: 0, fontSize: 14 }}>
            {isPaid
              ? 'Your funds are held safely in campus escrow until you confirm delivery.'
              : 'Complete payment from your orders dashboard to notify the vendor to fulfill your items.'}
          </p>
        </div>

        {/* Order Meta Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: 'var(--surface-alt, #f4f8f5)', padding: '12px 18px', borderRadius: 10, border: '1px solid var(--border, #dcebe0)', marginBottom: 20 }}>
          <div>
            <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-secondary, #55675b)', fontWeight: 700 }}>
              Order Reference
            </span>
            <div style={{ fontWeight: 800, color: 'var(--green-900, #0d4a2f)', fontSize: 15 }}>
              #{orderNumbers.join(', #')}
            </div>
          </div>
          {orderSnapshot?.deliveryPin && (
            <div style={{ background: '#fffbeb', border: '1px dashed #f59e0b', padding: '6px 14px', borderRadius: 8, textAlign: 'right' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#92400e', fontWeight: 800, display: 'block' }}>
                Delivery PIN
              </span>
              <strong style={{ fontSize: 18, color: '#92400e', letterSpacing: 3 }}>
                {orderSnapshot.deliveryPin}
              </strong>
            </div>
          )}
        </div>

        {/* Customized Ordered Items List */}
        {orderedItems.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px', color: 'var(--text-primary, #17231d)' }}>
              Ordered Items ({orderedItems.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orderedItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border, #edf4f0)',
                    background: '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid #dcebe0' }}
                      />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: '#e8f5ec', color: '#12603d', display: 'grid', placeItems: 'center' }}>
                        <Package size={20} />
                      </div>
                    )}
                    <div>
                      <strong style={{ fontSize: 14, color: 'var(--text-primary, #17231d)', display: 'block' }}>
                        {item.title}
                      </strong>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                        Qty: {item.quantity} {item.variantLabel ? `(${item.variantLabel})` : ''} · {item.vendorName ? `Store: ${item.vendorName}` : ''}
                      </span>
                    </div>
                  </div>
                  <strong style={{ fontSize: 14, color: 'var(--green-900, #0d4a2f)' }}>
                    {formatNaira(item.lineTotalKobo)}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delivery Details */}
        {orderSnapshot?.deliveryAddress && (
          <div style={{ background: '#f8faf9', padding: '12px 16px', borderRadius: 10, border: '1px solid #edf4f0', marginBottom: 24, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            <MapPin size={18} color="#12603d" style={{ flexShrink: 0 }} />
            <div>
              <span style={{ color: 'var(--text-secondary, #55675b)' }}>Delivery Destination: </span>
              <strong>{orderSnapshot.deliveryAddress}</strong>
              {orderSnapshot.phone && <span style={{ color: 'var(--text-secondary, #55675b)' }}> (Recipient: {orderSnapshot.recipientName}, {orderSnapshot.phone})</span>}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setReceiptModalOpen(true)}
            className="btn btn-secondary"
            style={{
              padding: '11px 20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <Printer size={16} />
            <span>View Official Digital Receipt</span>
          </button>
          <Link
            to={mpPath('/orders')}
            className="btn btn-primary"
            style={{
              padding: '11px 22px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <span>View Orders &amp; Track</span>
            <ArrowRight size={16} />
          </Link>
          <Link
            to={mpPath('/browse')}
            className="btn btn-secondary"
            style={{ padding: '11px 20px', fontSize: 14 }}
          >
            Continue Shopping
          </Link>
        </div>

        {/* Digital Receipt Modal */}
        {orderSnapshot && (
          <DigitalReceiptModal
            isOpen={receiptModalOpen}
            onClose={() => setReceiptModalOpen(false)}
            orderNumber={orderNumbers[0] || 'ORD'}
            orderDate={new Date()}
            status={isPaid ? 'Paid · Escrow Secured' : 'Reserved · Pending Payment'}
            paymentMethod={orderSnapshot.paymentMethod}
            buyerName={orderSnapshot.recipientName}
            buyerPhone={orderSnapshot.phone}
            deliveryAddress={orderSnapshot.deliveryAddress}
            deliveryPin={orderSnapshot.deliveryPin}
            vendorName={orderSnapshot.items[0]?.vendorName || 'Campus Merchant'}
            items={orderSnapshot.items.map((it) => ({
              title: it.title,
              variantLabel: it.variantLabel,
              quantity: it.quantity,
              unitPriceKobo: it.unitPriceKobo,
              lineTotalKobo: it.lineTotalKobo,
            }))}
            subtotalKobo={orderSnapshot.subtotalKobo}
            deliveryFeeKobo={orderSnapshot.deliveryFeeKobo}
            totalKobo={orderSnapshot.totalKobo}
          />
        )}
      </div>
    );
  }

  const totalDeliveryFee = deliveryType === 'delivery'
    ? groupedByVendor.reduce((acc, g) => acc + g.deliveryFeeKobo, 0)
    : 0;
  const grandTotal = subtotalKobo + totalDeliveryFee;

  // A wallet payment is only offered when one balance covers the whole basket.
  // Checking here is a courtesy; the server is what actually refuses.
  const walletAvailable = wallet?.available_kobo ?? 0;
  const canPayFromWallet =
    !!wallet && !wallet.is_frozen && walletAvailable >= grandTotal && grandTotal > 0;

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (deliveryType === 'delivery') {
      if (!recipientName.trim() || !phone.trim() || !addressLine.trim()) {
        toast('Please complete your recipient name, phone number, and delivery room/hostel', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      // 1. Prepare idempotency key
      const idempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // 2. Prepare items payload
      const orderItems = items.map((it) => ({
        product_id: it.productId,
        variant_id: it.variantId,
        quantity: it.quantity,
      }));

      // 3. Prepare delivery object
      const deliveryPayload = deliveryType === 'delivery' ? {
        recipient_name: recipientName.trim(),
        phone: phone.trim(),
        campus_area: campusArea,
        address_line: addressLine.trim(),
        landmark: landmark.trim() || undefined,
      } : undefined;

      // Optionally save address to student address book
      if (deliveryType === 'delivery' && !selectedAddressId) {
        saveAddress({
          label: campusArea,
          recipient_name: recipientName.trim(),
          phone: phone.trim(),
          campus_area: campusArea,
          address_line: addressLine.trim(),
          landmark: landmark.trim() || undefined,
          is_default: true,
        }).catch(() => {});
      }

      // 4. Create the orders. This reserves stock and pricing only.
      const result = (await createOrders({
        idempotency_key: idempotencyKey,
        items: orderItems,
        delivery_type: deliveryType,
        delivery: deliveryPayload,
        buyer_note: buyerNote.trim() || undefined,
        payment_provider:
          paymentMethod === 'card'
            ? 'paystack'
            : paymentMethod === 'wallet'
              ? 'wallet'
              : 'bank_transfer',
      })) as CheckoutResult;

      const orderList = Array.isArray(result?.orders) ? result.orders : [];
      const orderNumbers = orderList.length > 0
        ? orderList.map((r) => r.order_number || r.id)
        : [];

      const paymentId = String(result?.payment_id ?? '');

      const deliveryPin = Math.floor(1000 + Math.random() * 9000).toString();
      const snapshot: CompletedOrderSnapshot = {
        orderNumbers,
        isPaid: paymentMethod === 'wallet',
        paymentMethod:
          paymentMethod === 'wallet'
            ? 'Campus Hub Wallet'
            : paymentMethod === 'card'
              ? 'Debit Card / Paystack'
              : 'Campus Bank Transfer',
        items: items.map((it) => ({
          title: it.product.title,
          variantLabel: it.variant ? `${it.variant.name}: ${it.variant.value}` : undefined,
          quantity: it.quantity,
          unitPriceKobo: it.variant?.price_kobo ?? it.product.price_kobo,
          lineTotalKobo: (it.variant?.price_kobo ?? it.product.price_kobo) * it.quantity,
          image: it.product.images?.[0]?.url,
          vendorName: it.product.vendor?.store_name,
        })),
        subtotalKobo,
        deliveryFeeKobo: totalDeliveryFee,
        totalKobo: grandTotal,
        recipientName: recipientName.trim(),
        phone: phone.trim(),
        deliveryAddress: deliveryType === 'delivery' ? `${campusArea}, ${addressLine.trim()}` : 'Self Pickup on Campus',
        deliveryPin,
      };
      setOrderSnapshot(snapshot);

      if (paymentMethod === 'wallet') {
        // Every order from this checkout carries its own payment row, and each
        // one is settled by its own server transaction. A failure part way
        // through is reported honestly rather than rolled back here, because the
        // orders are already reserved.
        const unpaid: string[] = [];
        let paidCount = 0;

        for (const order of orderList) {
          try {
            await payOrderFromWallet(order.id);
            paidCount += 1;
          } catch (e: any) {
            unpaid.push(order.order_number || order.id);
          }
        }

        clearCart();
        setCreatedOrderNumbers(orderNumbers);
        setWallet(await fetchMyWallet().catch(() => wallet));

        if (unpaid.length === 0) {
          toast('Paid from your wallet. The vendor has been notified.', 'success');
          return;
        }

        toast(
          paidCount > 0
            ? `Paid ${paidCount} of ${orderList.length} orders from your wallet. Pay the rest from your orders page.`
            : 'Your wallet balance did not cover this order. Complete payment from your orders page.',
          'error',
        );
        return;
      }

      if (paymentMethod === 'bank_transfer') {
        clearCart();
        setCreatedOrderNumbers(orderNumbers);
        toast('Order reserved. Transfer the funds to complete this order.', 'info');
        return;
      }

      if (result?.payments_enabled === false) {
        clearCart();
        setCreatedOrderNumbers(orderNumbers);
        toast('Card payments are temporarily unavailable. Use campus bank transfer.', 'error');
        return;
      }

      if (!paymentId) {
        // The order exists but no payment row came back, so we must not claim
        // anything is payable. Leave it visible and let the buyer retry.
        setCreatedOrderNumbers(orderNumbers);
        toast('The order was created but could not be set up for payment. Contact support.', 'error');
        return;
      }

      if (orderList.length > 1) {
        clearCart();
        setCreatedOrderNumbers(orderNumbers);
        toast(
          `Created ${orderList.length} orders across different vendors. Please pay each vendor order individually from your Orders page.`,
          'info'
        );
        navigate(mpPath('/orders'));
        return;
      }

      // 5. Hand off to Paystack. The server fixes the amount; we only redirect.
      const checkout = await initializePayment(paymentId, 'card');
      clearCart();
      window.location.assign(checkout.authorization_url);
    } catch (err: any) {
      console.error('Checkout error:', err);
      toast(err.message || 'Checkout failed. Please review your cart items and stock.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ paddingBottom: 60, maxWidth: 960, margin: '0 auto' }}>
        <Skeleton height={80} borderRadius={14} />
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
          <Skeleton height={320} borderRadius={14} />
          <Skeleton height={240} borderRadius={14} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Checkout Header */}
      <div style={{ marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
          Checkout & Protection
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
          Complete your delivery details and secure campus payment
        </p>
      </div>

      <form onSubmit={handlePlaceOrder} style={{ display: 'grid', gap: 36 }} className="cart-grid-container cart-grid-checkout">
        {/* Left: Fulfilment details & Payment */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Fulfilment Method Choice */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>1. Delivery or Campus Pickup</h3>
            <div className="mp-field-grid" style={{ display: 'grid', gap: 12 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: deliveryType === 'delivery' ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                  background: deliveryType === 'delivery' ? 'var(--green-100, #e8f5ec)' : 'var(--surface, #ffffff)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="deliveryType"
                  checked={deliveryType === 'delivery'}
                  onChange={() => setDeliveryType('delivery')}
                />
                <div>
                  <strong style={{ display: 'block', fontSize: 14 }}>Hostel / Campus Delivery</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                    Delivered directly to your hostel room or faculty
                  </span>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: deliveryType === 'pickup' ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                  background: deliveryType === 'pickup' ? 'var(--green-100, #e8f5ec)' : 'var(--surface, #ffffff)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="deliveryType"
                  checked={deliveryType === 'pickup'}
                  onChange={() => setDeliveryType('pickup')}
                />
                <div>
                  <strong style={{ display: 'block', fontSize: 14 }}>Campus Pickup</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                    Meet vendor at agreed campus location
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Delivery Address Information (if delivery chosen) */}
          {deliveryType === 'delivery' && (
            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>2. Delivery Information</h3>

              {addresses.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Select Saved Address
                  </label>
                  <select
                    value={selectedAddressId}
                    onChange={(e) => {
                      const addr = addresses.find((a) => a.id === e.target.value);
                      if (addr) {
                        setSelectedAddressId(addr.id);
                        setRecipientName(addr.recipient_name);
                        setPhone(addr.phone);
                        setCampusArea(addr.campus_area);
                        setAddressLine(addr.address_line);
                        setLandmark(addr.landmark || '');
                      }
                    }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}
                  >
                    {addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.recipient_name} - {a.campus_area}, {a.address_line}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mp-field-grid" style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Recipient Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Samuel Audu"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Phone Number (for call on arrival) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 08012345678"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                </div>
              </div>

              <div className="mp-field-grid" style={{ display: 'grid', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Campus Area / Hostel *
                  </label>
                  <select
                    value={campusArea}
                    onChange={(e) => setCampusArea(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14, background: '#ffffff' }}
                  >
                    <option value="Male Hostel A">Male Hostel A</option>
                    <option value="Male Hostel B">Male Hostel B</option>
                    <option value="Female Hostel A">Female Hostel A</option>
                    <option value="Female Hostel B">Female Hostel B</option>
                    <option value="New Site Hostels">New Site Hostels</option>
                    <option value="Faculty of Science">Faculty of Science</option>
                    <option value="Faculty of Computing">Faculty of Computing</option>
                    <option value="Faculty of Agriculture">Faculty of Agriculture</option>
                    <option value="Faculty of Humanities">Faculty of Humanities</option>
                    <option value="Staff Quarters">Staff Quarters</option>
                    <option value="Off-Campus Wukari">Off-Campus Wukari (Lodge)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Room / Block / Lodge Details *
                  </label>
                  <input
                    type="text"
                    required
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    placeholder="e.g. Block C, Room 14 / Grace Lodge"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Prominent Landmark (optional)
                </label>
                <input
                  type="text"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  placeholder="e.g. Beside university water tank"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 14 }}
                />
              </div>
            </div>
          )}

          {/* Payment Method Selector */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>
              {deliveryType === 'delivery' ? '3. Protected Payment Method' : '2. Protected Payment Method'}
            </h3>

            <div className="mp-field-grid" style={{ display: 'grid', gap: 12 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px',
                  borderRadius: 10,
                  border: paymentMethod === 'card' ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                  background: paymentMethod === 'card' ? 'var(--green-100, #e8f5ec)' : 'var(--surface, #ffffff)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'card'}
                  onChange={() => setPaymentMethod('card')}
                />
                <CreditCard size={20} color="var(--green-800, #12603d)" />
                <div>
                  <strong style={{ display: 'block', fontSize: 13 }}>Debit Card / USSD</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>Pay on Paystack, verified instantly</span>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px',
                  borderRadius: 10,
                  border: paymentMethod === 'bank_transfer' ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                  background: paymentMethod === 'bank_transfer' ? 'var(--green-100, #e8f5ec)' : 'var(--surface, #ffffff)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'bank_transfer'}
                  onChange={() => setPaymentMethod('bank_transfer')}
                />
                <Building size={20} color="var(--green-800, #12603d)" />
                <div>
                  <strong style={{ display: 'block', fontSize: 13 }}>Campus Bank Transfer</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>Confirmed by marketplace finance</span>
                </div>
              </label>

              <div
                style={{
                  gridColumn: '1 / -1',
                  borderRadius: 10,
                  border: paymentMethod === 'wallet' ? '2px solid var(--green-800, #12603d)' : '1px solid var(--border, #dcebe0)',
                  background: paymentMethod === 'wallet' ? 'var(--green-100, #e8f5ec)' : 'var(--surface, #ffffff)',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: canPayFromWallet ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === 'wallet'}
                    disabled={!canPayFromWallet}
                    onChange={() => setPaymentMethod('wallet')}
                  />
                  <Wallet size={20} color="var(--green-800, #12603d)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 13 }}>Pay from My Wallet</strong>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>
                      {wallet?.is_frozen
                        ? 'Your wallet is on hold. Contact support.'
                        : canPayFromWallet
                          ? `${formatNaira(walletAvailable)} available · settles instantly, no redirect`
                          : `Wallet balance: ${formatNaira(walletAvailable)} · Insufficient funds`}
                    </span>
                  </div>
                  {canPayFromWallet && (
                    <span className="badge badge-success" style={{ flexShrink: 0 }}>Covers this order</span>
                  )}
                </label>

                {!canPayFromWallet && !wallet?.is_frozen && grandTotal > 0 && (
                  <div
                    style={{
                      background: 'var(--surface-alt, #f8faf9)',
                      border: '1px solid var(--border, #dcebe0)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      fontSize: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ color: '#b91c1c' }}>Insufficient wallet balance.</strong>
                      <Link
                        to={mpPath('/wallet')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                      >
                        Fund Wallet
                      </Link>
                    </div>
                    <div style={{ display: 'flex', gap: 16, color: 'var(--text-secondary, #55675b)' }}>
                      <span>Wallet balance: <strong>{formatNaira(walletAvailable)}</strong></span>
                      <span>Required: <strong>{formatNaira(grandTotal)}</strong></span>
                      <span>You need: <strong style={{ color: '#b91c1c' }}>{formatNaira(grandTotal - walletAvailable)} more</strong></span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Note to vendor */}
            <div style={{ marginTop: 18 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Note to Vendor (optional)
              </label>
              <textarea
                rows={2}
                value={buyerNote}
                onChange={(e) => setBuyerNote(e.target.value)}
                placeholder="e.g. Please deliver after 4pm when my lectures finish..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #dcebe0)', fontSize: 13 }}
              />
            </div>
          </div>
        </div>

        {/* Right: Sticky Summary Box */}
        <div>
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 14,
              border: '1px solid var(--border, #dcebe0)',
              padding: 24,
              position: 'sticky',
              top: 80,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Review & Pay</h3>

            {/* Items summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 180, overflowY: 'auto' }}>
              {items.map((it) => (
                <div key={`${it.productId}-${it.variantId || 'base'}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.quantity} × {it.product.title}
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {formatNaira((it.variant?.price_kobo ?? it.product.price_kobo) * it.quantity)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border, #dcebe0)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #55675b)' }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #17231d)' }}>{formatNaira(subtotalKobo)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #55675b)' }}>
                <span>Delivery Fees</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #17231d)' }}>
                  {totalDeliveryFee > 0 ? formatNaira(totalDeliveryFee) : 'Free / Pickup'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  marginTop: 4,
                  borderTop: '1px solid var(--border, #dcebe0)',
                  fontSize: 18,
                  fontWeight: 900,
                  color: 'var(--green-900, #0d4a2f)',
                }}
              >
                <span>Total Payable</span>
                <span>{formatNaira(grandTotal)}</span>
              </div>
            </div>

            {/* Escrow note */}
            <div style={{ padding: 12, borderRadius: 8, background: '#f4f8f5', border: '1px solid var(--border, #dcebe0)', fontSize: 12, color: 'var(--green-900, #0d4a2f)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={20} color="var(--green-800, #12603d)" style={{ flexShrink: 0 }} />
              <span>Once your payment is verified, it is held until you confirm delivery. You can open a dispute if anything is wrong.</span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              style={{ width: '100%', padding: '13px 18px', fontSize: 15 }}
            >
              <Lock size={16} />
              <span>
                {submitting
                  ? 'Securing Transaction...'
                  : paymentMethod === 'bank_transfer'
                    ? `Reserve for ${formatNaira(grandTotal)}`
                    : `Pay ${formatNaira(grandTotal)}`}
              </span>
            </button>

            {paymentMethod === 'card' && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary, #55675b)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <ExternalLink size={12} />
                You will be taken to Paystack to complete payment.
              </p>
            )}

            {paymentMethod === 'bank_transfer' && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary, #55675b)', textAlign: 'center' }}>
                This reserves your items. The vendor only starts once finance confirms the transfer.
              </p>
            )}

            {paymentMethod === 'wallet' && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary, #55675b)', textAlign: 'center' }}>
                Debited straight from your wallet and held in escrow until you confirm delivery.
              </p>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
