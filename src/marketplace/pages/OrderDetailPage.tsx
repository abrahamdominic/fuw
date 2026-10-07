import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Package,
  MessageSquare,
  AlertTriangle,
  Star,
  CheckCircle2,
  ChevronLeft,
  ShieldCheck,
  Store,
  CreditCard,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import {
  fetchOrderDetails,
  fetchOrderPayment,
  confirmReceipt,
  initializePayment,
  verifyPayment,
  startConversation,
} from '../lib/api';
import type { MarketplaceOrder, MarketplacePayment } from '../lib/types';
import { formatNaira, formatDate, formatOrderStatus } from '../lib/format';
import { OrderTimeline } from '../components/OrderTimeline';
import {
  DISPUTE_ELIGIBLE_ORDER_STATUSES,
  RECEIPT_CONFIRMABLE_ORDER_STATUSES,
} from '../lib/orderStateMachine';
import { useToast } from '../components/Toast';
import { DisputeModal } from '../components/DisputeModal';
import { ReviewModal } from '../components/ReviewModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Skeleton } from '../components/Skeleton';
import { mpPath } from '../lib/routes';

type PaymentReturnState = 'idle' | 'checking' | 'paid' | 'unpaid' | 'error';

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [order, setOrder] = useState<MarketplaceOrder | null>(null);
  const [payment, setPayment] = useState<MarketplacePayment | null>(null);
  const [loading, setLoading] = useState(true);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmReceiptOpen, setConfirmReceiptOpen] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  const [paymentReturn, setPaymentReturn] = useState<PaymentReturnState>('idle');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [startingPayment, setStartingPayment] = useState(false);

  // The return check must run once per provider reference, otherwise a reload
  // would re-verify forever.
  const returnCheckRef = useRef<string | null>(null);

  const loadOrder = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await fetchOrderDetails(id);
      setOrder(data);
      if (data) {
        const pay = await fetchOrderPayment(data.id).catch(() => null);
        setPayment(pay);
      }
    } catch (err) {
      console.error('Failed to load order details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
  }, [id]);

  // Arriving back from Paystack means we should ask the provider what happened.
  // The ?payment=returned marker is only a trigger for that check, never proof.
  useEffect(() => {
    if (searchParams.get('payment') !== 'returned') return;
    setPaymentReturn('checking');
    const next = new URLSearchParams(searchParams);
    next.delete('payment');
    next.delete('reference');
    next.delete('trx');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /**
   * The browser coming back from Paystack proves nothing. Ask the server to
   * check the provider, using the reference we stored ourselves.
   */
  useEffect(() => {
    if (paymentReturn !== 'checking' || !payment) return;
    const reference = payment.provider_reference;
    if (!reference) {
      setPaymentReturn('unpaid');
      setPaymentMessage('No payment reference was recorded for this order.');
      return;
    }
    if (returnCheckRef.current === reference) return;
    returnCheckRef.current = reference;

    let cancelled = false;
    (async () => {
      try {
        const result = await verifyPayment(payment.id, reference);
        if (cancelled) return;
        if (result.status === 'succeeded') {
          setPaymentReturn('paid');
          setPaymentMessage('Payment confirmed. The vendor has been notified to fulfil your order.');
          toast('Payment confirmed', 'success');
          loadOrder();
        } else {
          setPaymentReturn('unpaid');
          setPaymentMessage(result.message ?? 'The provider has not confirmed this payment yet.');
          loadOrder();
        }
      } catch (err: any) {
        if (cancelled) return;
        setPaymentReturn('error');
        setPaymentMessage(err.message || 'We could not verify this payment right now.');
        loadOrder();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paymentReturn, payment]);

  const handleConfirmReceipt = async () => {
    if (!order) return;
    setConfirmingReceipt(true);
    try {
      await confirmReceipt(order.id);
      toast('Receipt confirmed! Funds released to vendor.', 'success');
      setConfirmReceiptOpen(false);
      loadOrder();
    } catch (err: any) {
      toast(err.message || 'Failed to confirm receipt', 'error');
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const handlePayNow = async () => {
    if (!payment) return;
    setStartingPayment(true);
    try {
      const checkout = await initializePayment(payment.id, 'card');
      window.location.assign(checkout.authorization_url);
    } catch (err: any) {
      toast(err.message || 'Could not start payment', 'error');
      setStartingPayment(false);
    }
  };

  const handleChatVendor = async () => {
    if (!order) return;
    try {
      const conv: any = await startConversation(order.vendor_id);
      navigate(mpPath(`/messages?conversationId=${conv?.id || conv}`));
    } catch {
      toast('Could not open conversation', 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px 0 60px' }}>
        <Skeleton height={40} width="40%" style={{ marginBottom: 20 }} />
        <Skeleton height={200} borderRadius={14} style={{ marginBottom: 20 }} />
        <Skeleton height={300} borderRadius={14} />
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <h2>Order Not Found</h2>
        <p style={{ color: 'var(--text-secondary, #55675b)' }}>
          The requested order does not exist or you do not have permission to view it.
        </p>
        <Link to={mpPath("/orders")} className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
          Back to My Orders
        </Link>
      </div>
    );
  }

  const statusInfo = formatOrderStatus(order.status);
  // Receipt confirmation releases escrow, so it is offered only once delivered.
  const canConfirm = RECEIPT_CONFIRMABLE_ORDER_STATUSES.includes(order.status);
  const canDispute = DISPUTE_ELIGIBLE_ORDER_STATUSES.includes(order.status);
  const canReview = order.status === 'completed';
  const paymentSucceeded = payment?.status === 'succeeded';
  const awaitingPayment = order.status === 'pending_payment' && !paymentSucceeded;
  const canPayNow = awaitingPayment && Boolean(payment?.provider);

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Back button */}
      <Link
        to={mpPath("/orders")}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-secondary, #55675b)',
          textDecoration: 'none',
          marginBottom: 16,
        }}
      >
        <ChevronLeft size={16} />
        <span>Back to All Orders</span>
      </Link>

      {/* Header bar */}
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
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--green-900, #0d4a2f)' }}>
              Order #{order.order_number}
            </h1>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 700,
                background: statusInfo.tone === 'success' ? '#d1fae5' : statusInfo.tone === 'warning' ? '#fef3c7' : statusInfo.tone === 'danger' ? '#fee2e2' : '#e0f2fe',
                color: statusInfo.tone === 'success' ? '#065f46' : statusInfo.tone === 'warning' ? '#92400e' : statusInfo.tone === 'danger' ? '#991b1b' : '#075985',
              }}
            >
              {statusInfo.label}
            </span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
            Placed on {formatDate(order.created_at)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canPayNow && (
            <button
              type="button"
              onClick={handlePayNow}
              disabled={startingPayment}
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              <CreditCard size={15} />
              <span>{startingPayment ? 'Opening Paystack…' : `Pay ${formatNaira(order.total_kobo)}`}</span>
            </button>
          )}

          {awaitingPayment && !canPayNow && (
            <span style={{ fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 5 }}>
              <AlertTriangle size={14} />
              Payment required before this order can proceed
            </span>
          )}

          <button
            type="button"
            onClick={handleChatVendor}
            className="btn btn-secondary"
            style={{ padding: '8px 14px', fontSize: 13 }}
          >
            <MessageSquare size={15} />
            <span>Chat Vendor</span>
          </button>

          {canConfirm && (
            <button
              type="button"
              onClick={() => setConfirmReceiptOpen(true)}
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              <CheckCircle2 size={15} />
              <span>Confirm Receipt</span>
            </button>
          )}

          {canReview && (
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid #b45309',
                background: '#fef3c7',
                color: '#92400e',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Star size={15} fill="#b45309" />
              <span>Write Review</span>
            </button>
          )}

          {canDispute && (
            <button
              type="button"
              onClick={() => setDisputeOpen(true)}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: '1px solid #fca5a5',
                background: '#fee2e2',
                color: '#991b1b',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <AlertTriangle size={14} />
              <span>Open Dispute</span>
            </button>
          )}
        </div>
      </div>

      {/* Payment return banner */}
      {paymentReturn !== 'idle' && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '16px 18px',
            borderRadius: 12,
            marginBottom: 20,
            fontSize: 14,
            border:
              paymentReturn === 'paid'
                ? '1px solid #a7f3d0'
                : paymentReturn === 'error'
                  ? '1px solid #fca5a5'
                  : '1px solid #fcd34d',
            background:
              paymentReturn === 'paid'
                ? '#d1fae5'
                : paymentReturn === 'error'
                  ? '#fee2e2'
                  : '#fef3c7',
            color:
              paymentReturn === 'paid'
                ? '#065f46'
                : paymentReturn === 'error'
                  ? '#991b1b'
                  : '#92400e',
          }}
        >
          {paymentReturn === 'checking' && <Loader2 size={18} className="spin" style={{ flexShrink: 0 }} />}
          {paymentReturn === 'paid' && <CheckCircle size={18} style={{ flexShrink: 0 }} />}
          {(paymentReturn === 'unpaid' || paymentReturn === 'error') && <XCircle size={18} style={{ flexShrink: 0 }} />}

          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block', marginBottom: 2 }}>
              {paymentReturn === 'checking'
                ? 'Checking your payment…'
                : paymentReturn === 'paid'
                  ? 'Payment confirmed'
                  : paymentReturn === 'unpaid'
                    ? 'Payment not completed'
                    : 'Could not verify payment'}
            </strong>
            {paymentMessage && <span>{paymentMessage}</span>}
          </div>
        </div>
      )}

      {/* Visual Timeline Section */}
      <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22, marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Order Progress Tracker</h3>
        <OrderTimeline currentStatus={order.status} orderHistory={order.history as any} />
      </div>

      {/* Main Details Grid */}
      <div style={{ display: 'grid', gap: 28 }} className="cart-grid-container cart-grid-order">
        {/* Left: Items list & Delivery Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Purchased Items */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Order Items</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(order.items || []).map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 14,
                    borderBottom: '1px solid var(--border, #dcebe0)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 6, background: 'var(--surface-alt, #f4f8f5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Package size={22} color="var(--muted, #55675b)" />
                    </div>
                    <div>
                      <h4 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600 }}>{it.product_title}</h4>
                      {it.variant_label && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>Option: {it.variant_label}</span>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', marginTop: 2 }}>
                        Qty: {it.quantity} × {formatNaira(it.unit_price_kobo)}
                      </div>
                    </div>
                  </div>

                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--green-900, #0d4a2f)' }}>
                    {formatNaira(it.line_total_kobo)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery & Fulfilment Details */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Delivery & Fulfilment</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 16, fontSize: 14 }}>
              <div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Fulfilment Type</span>
                <strong style={{ textTransform: 'capitalize' }}>{order.fulfilment.replace('_', ' ')}</strong>
              </div>

              {order.delivery_snapshot && (
                <>
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Recipient</span>
                    <strong>{order.delivery_snapshot.recipient_name} ({order.delivery_snapshot.phone})</strong>
                  </div>

                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Location / Hostel</span>
                    <strong>{order.delivery_snapshot.campus_area} · {order.delivery_snapshot.address_line}</strong>
                  </div>
                </>
              )}

              {order.delivery_snapshot?.meeting_point && (
                <div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block', marginBottom: 2 }}>Pickup Point</span>
                  <strong>{order.delivery_snapshot?.meeting_point}</strong>
                </div>
              )}
            </div>

            {order.buyer_note && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border, #dcebe0)', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary, #55675b)' }}>Note for seller: </span>
                <span>"{order.buyer_note}"</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Vendor & Payment Receipt */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Vendor Card */}
          {order.vendor && (
            <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 20 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Store Information</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-alt, #f4f8f5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Store size={22} color="var(--green-800, #12603d)" />
                </div>
                <div>
                  <strong style={{ fontSize: 15, display: 'block' }}>{order.vendor.store_name}</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>{order.vendor.campus_area}</span>
                </div>
              </div>
              <Link to={mpPath(`/vendor/${order.vendor.slug || order.vendor.id}`)} className="btn btn-secondary" style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}>
                Visit Storefront
              </Link>
            </div>
          )}

          {/* Payment Breakdown Receipt */}
          <div style={{ background: 'var(--surface, #ffffff)', borderRadius: 14, border: '1px solid var(--border, #dcebe0)', padding: 22 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 700 }}>Payment Summary</h3>

            {payment && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  marginBottom: 14,
                  fontSize: 12,
                  fontWeight: 600,
                  background: paymentSucceeded ? '#d1fae5' : payment.status === 'failed' ? '#fee2e2' : '#fef3c7',
                  color: paymentSucceeded ? '#065f46' : payment.status === 'failed' ? '#991b1b' : '#92400e',
                }}
              >
                {paymentSucceeded ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                <span>
                  {paymentSucceeded
                    ? 'Payment received and held in escrow'
                    : payment.status === 'failed'
                      ? 'Payment failed'
                      : payment.status === 'cancelled'
                        ? 'Payment cancelled'
                        : 'Payment not yet received'}
                  {payment.provider_reference ? ` · ${payment.provider_reference}` : ''}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #55675b)' }}>
                <span>Items Subtotal</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #17231d)' }}>{formatNaira(order.subtotal_kobo)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #55675b)' }}>
                <span>Delivery Fee</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #17231d)' }}>
                  {order.delivery_fee_kobo > 0 ? formatNaira(order.delivery_fee_kobo) : 'Free / Pickup'}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  marginTop: 4,
                  borderTop: '1px solid var(--border, #dcebe0)',
                  fontSize: 17,
                  fontWeight: 900,
                  color: 'var(--green-900, #0d4a2f)',
                }}
              >
                <span>Order Total</span>
                <span>{formatNaira(order.total_kobo)}</span>
              </div>
            </div>

            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: '#f4f8f5', fontSize: 12, color: 'var(--green-900, #0d4a2f)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={18} style={{ flexShrink: 0 }} />
              <span>
                {paymentSucceeded
                  ? 'Once confirmed as received, this payment is released to the vendor. Open a dispute first if anything is wrong.'
                  : 'Campus Protection applies once your payment is verified. Nothing is released to the vendor until you confirm delivery.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Receipt Dialog */}
      <ConfirmDialog
        isOpen={confirmReceiptOpen}
        onClose={() => setConfirmReceiptOpen(false)}
        onConfirm={handleConfirmReceipt}
        isLoading={confirmingReceipt}
        title="Confirm You Received This Order"
        message="Have you physically received and checked every item? This permanently releases the escrowed payment to the vendor and cannot be undone. If anything is wrong, close this and open a dispute instead."
        confirmLabel="Yes, Release Payment to Vendor"
      />

      {/* Dispute Modal */}
      <DisputeModal
        isOpen={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        orderId={order.id}
        orderNumber={order.order_number}
        onSuccess={loadOrder}
      />

      {/* Review Modal */}
      <ReviewModal
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
        orderId={order.id}
        orderNumber={order.order_number}
        onSuccess={loadOrder}
      />
    </div>
  );
};
