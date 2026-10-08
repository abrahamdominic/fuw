import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Package,
  AlertTriangle,
  Star,
  CheckCircle2,
  MessageSquare,
  CreditCard,
  Wallet,
  Printer,
} from 'lucide-react';
import { DigitalReceiptModal } from '../components/DigitalReceiptModal';
import {
  fetchBuyerOrders,
  confirmReceipt,
  fetchOrderPayment,
  initializePayment,
  startConversation,
  fetchMyWallet,
  payOrderFromWallet,
} from '../lib/api';
import type { MarketplaceOrder, MarketplaceWallet } from '../lib/types';
import { formatNaira, formatDate, formatOrderStatus } from '../lib/format';
import { useToast } from '../components/Toast';
import { DisputeModal } from '../components/DisputeModal';
import { ReviewModal } from '../components/ReviewModal';
import { EmptyState } from '../components/EmptyState';
import {
  ACTIVE_ORDER_STATUSES,
  DISPUTE_ELIGIBLE_ORDER_STATUSES,
  RECEIPT_CONFIRMABLE_ORDER_STATUSES,
} from '../lib/orderStateMachine';
import { Skeleton } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { mpPath } from '../lib/routes';

export const OrdersPage: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'completed' | 'disputed'>('all');

  // Modals state
  const [disputeModalOrder, setDisputeModalOrder] = useState<MarketplaceOrder | null>(null);
  const [reviewModalOrder, setReviewModalOrder] = useState<MarketplaceOrder | null>(null);
  const [confirmReceiptOrder, setConfirmReceiptOrder] = useState<MarketplaceOrder | null>(null);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [receiptModalOrder, setReceiptModalOrder] = useState<MarketplaceOrder | null>(null);

  // Wallet balance, so a reserved order can be settled without leaving the page.
  const [wallet, setWallet] = useState<MarketplaceWallet | null>(null);
  const [payingFromWallet, setPayingFromWallet] = useState<string | null>(null);

  const loadWallet = () => {
    fetchMyWallet().then(setWallet).catch(() => setWallet(null));
  };

  const loadOrders = async () => {
    setLoading(true);
    try {
      const list = await fetchBuyerOrders();
      setOrders(list);
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    loadWallet();
  }, []);

  const handleConfirmReceipt = async () => {
    if (!confirmReceiptOrder) return;
    setConfirmingReceipt(true);
    try {
      // mp_confirm_receipt, not a plain status change: this is the only buyer
      // action that releases escrowed money to the vendor.
      await confirmReceipt(confirmReceiptOrder.id);
      toast('Receipt confirmed! Funds released to vendor.', 'success');
      setConfirmReceiptOrder(null);
      loadOrders();
    } catch (err: any) {
      toast(err.message || 'Failed to confirm receipt', 'error');
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const handlePayOrder = async (order: MarketplaceOrder) => {
    try {
      const pay = await fetchOrderPayment(order.id);
      if (!pay) {
        toast('This order has no payment to retry. Contact support.', 'error');
        return;
      }
      const checkout = await initializePayment(pay.id, 'card');
      window.location.assign(checkout.authorization_url);
    } catch (err: any) {
      toast(err.message || 'Could not start payment', 'error');
    }
  };

  const handlePayFromWallet = async (order: MarketplaceOrder) => {
    setPayingFromWallet(order.id);
    try {
      const res = await payOrderFromWallet(order.id);
      toast(
        res.already_settled
          ? 'That order was already paid.'
          : `Paid ${formatNaira(order.total_kobo)} from your wallet. The vendor has been notified.`,
        'success',
      );
      loadOrders();
      loadWallet();
    } catch (err: any) {
      toast(err.message || 'Could not pay from your wallet', 'error');
      loadWallet();
    } finally {
      setPayingFromWallet(null);
    }
  };

  const handleChatVendor = async (vendorId: string, _orderId?: string) => {
    try {
      const conv: any = await startConversation(vendorId);
      navigate(mpPath(`/messages?conversationId=${conv?.id || conv}`));
    } catch {
      toast('Could not open conversation', 'error');
    }
  };

  // The server re-checks the balance before it debits, so this is only about
  // not offering a button that is certain to fail.
  const canPayFromWallet = (order: MarketplaceOrder) =>
    !!wallet && !wallet.is_frozen && wallet.available_kobo >= order.total_kobo;

  const filteredOrders = orders.filter((o) => {
    if (filterTab === 'active') return ACTIVE_ORDER_STATUSES.includes(o.status);
    if (filterTab === 'completed') return o.status === 'completed';
    if (filterTab === 'disputed') return ['disputed', 'refunded'].includes(o.status);
    return true;
  });

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Title */}
      <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
          My Orders & Tracking
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
          Track delivery status, confirm order arrival, and manage student purchase protection
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border, #dcebe0)', marginBottom: 24 }}>
        {[
          { key: 'all', label: `All Orders (${orders.length})` },
          { key: 'active', label: `In Progress (${orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length})` },
          { key: 'completed', label: `Completed (${orders.filter((o) => o.status === 'completed').length})` },
          { key: 'disputed', label: `Disputes (${orders.filter((o) => ['disputed', 'refunded'].includes(o.status)).length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilterTab(tab.key as any)}
            style={{
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              borderBottom: filterTab === tab.key ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
              color: filterTab === tab.key ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={140} borderRadius={14} />
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={<Package size={32} />}
          title="No Orders in this View"
          description="Orders you place on the marketplace will appear here with live tracking and purchase protection."
          action={
            <Link to={mpPath("/browse")} className="btn btn-primary" style={{ padding: '9px 20px' }}>
              <span>Browse Listings</span>
            </Link>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {filteredOrders.map((order) => {
            const statusInfo = formatOrderStatus(order.status);
            const canConfirm = RECEIPT_CONFIRMABLE_ORDER_STATUSES.includes(order.status);
            const canDispute = DISPUTE_ELIGIBLE_ORDER_STATUSES.includes(order.status);
            const canReview = order.status === 'completed';
            const awaitingPayment = order.status === 'pending_payment';

            return (
              <div
                key={order.id}
                style={{
                  background: 'var(--surface, #ffffff)',
                  borderRadius: 14,
                  border: '1px solid var(--border, #dcebe0)',
                  overflow: 'hidden',
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                {/* Header row: Order # & Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--green-900, #0d4a2f)' }}>
                      #{order.order_number}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                      · {formatDate(order.created_at)}
                    </span>
                  </div>

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

                {/* Vendor and Items */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, borderTop: '1px solid var(--border, #dcebe0)', borderBottom: '1px solid var(--border, #dcebe0)', padding: '14px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {awaitingPayment && (
                      <div style={{ fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <AlertTriangle size={13} />
                        Payment not received. The vendor has not been asked to fulfil this order.
                      </div>
                    )}

                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
                      Store: <strong>{order.vendor?.store_name || 'Campus Vendor'}</strong> ({order.vendor?.campus_area || 'Campus'})
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(order.items || []).map((it) => (
                        <span key={it.id} style={{ fontSize: 14, color: 'var(--text-primary, #17231d)' }}>
                          {it.quantity} × {it.product_title} {it.variant_label ? `(${it.variant_label})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)', display: 'block' }}>
                      {awaitingPayment ? 'Total Due' : 'Order Total'}
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--green-900, #0d4a2f)' }}>
                      {formatNaira(order.total_kobo)}
                    </span>
                  </div>
                </div>

                {/* Action Buttons Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Link
                      to={mpPath(`/order/${order.id}`)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        background: 'var(--surface-alt, #f4f8f5)',
                        color: 'var(--text-primary, #17231d)',
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Order Details
                    </Link>

                    <button
                      type="button"
                      onClick={() => setReceiptModalOrder(order)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        background: '#ffffff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        color: 'var(--green-900, #0d4a2f)',
                      }}
                    >
                      <Printer size={14} />
                      <span>Receipt</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleChatVendor(order.vendor_id, order.id)}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border, #dcebe0)',
                        background: '#ffffff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <MessageSquare size={14} />
                      <span>Message Vendor</span>
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {awaitingPayment && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePayOrder(order)}
                          className="btn btn-primary"
                          style={{ padding: '8px 16px', fontSize: 13 }}
                        >
                          <CreditCard size={15} />
                          <span>Pay {formatNaira(order.total_kobo)}</span>
                        </button>

                        {canPayFromWallet(order) && (
                          <button
                            type="button"
                            onClick={() => handlePayFromWallet(order)}
                            disabled={payingFromWallet === order.id}
                            className="btn btn-secondary"
                            style={{ padding: '8px 16px', fontSize: 13 }}
                          >
                            <Wallet size={15} />
                            <span>
                              {payingFromWallet === order.id
                                ? 'Paying...'
                                : `Use wallet (${formatNaira(wallet!.available_kobo)})`}
                            </span>
                          </button>
                        )}
                      </>
                    )}

                    {canConfirm && (
                      <button
                        type="button"
                        onClick={() => setConfirmReceiptOrder(order)}
                        className="btn btn-primary"
                        style={{ padding: '8px 16px', fontSize: 13 }}
                      >
                        <CheckCircle2 size={15} />
                        <span>Confirm Received</span>
                      </button>
                    )}

                    {canReview && (
                      <button
                        type="button"
                        onClick={() => setReviewModalOrder(order)}
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
                        <Star size={14} fill="#b45309" />
                        <span>Write Review</span>
                      </button>
                    )}

                    {canDispute && (
                      <button
                        type="button"
                        onClick={() => setDisputeModalOrder(order)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 8,
                          border: '1px solid #fca5a5',
                          background: '#fee2e2',
                          color: '#991b1b',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <AlertTriangle size={13} />
                        <span>Dispute</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm Receipt Dialog */}
      <ConfirmDialog
        isOpen={Boolean(confirmReceiptOrder)}
        onClose={() => setConfirmReceiptOrder(null)}
        onConfirm={handleConfirmReceipt}
        isLoading={confirmingReceipt}
        title="Confirm Order Receipt"
        message="Have you physically received and inspected all items in this order? Confirming receipt will permanently release payment to the vendor."
        confirmLabel="Yes, I Received Everything"
      />

      {/* Dispute Modal */}
      {disputeModalOrder && (
        <DisputeModal
          isOpen={Boolean(disputeModalOrder)}
          onClose={() => setDisputeModalOrder(null)}
          orderId={disputeModalOrder.id}
          orderNumber={disputeModalOrder.order_number}
          onSuccess={loadOrders}
        />
      )}

      {/* Review Modal */}
      {reviewModalOrder && (
        <ReviewModal
          isOpen={Boolean(reviewModalOrder)}
          onClose={() => setReviewModalOrder(null)}
          orderId={reviewModalOrder.id}
          orderNumber={reviewModalOrder.order_number}
          onSuccess={loadOrders}
        />
      )}

      {/* Digital Receipt Modal */}
      {receiptModalOrder && (
        <DigitalReceiptModal
          isOpen={Boolean(receiptModalOrder)}
          onClose={() => setReceiptModalOrder(null)}
          orderNumber={receiptModalOrder.order_number}
          orderDate={receiptModalOrder.created_at}
          status={formatOrderStatus(receiptModalOrder.status).label}
          paymentMethod="Campus Hub Escrow"
          transactionRef={receiptModalOrder.id}
          buyerName={receiptModalOrder.delivery_snapshot?.recipient_name || receiptModalOrder.buyer?.full_name}
          buyerPhone={receiptModalOrder.delivery_snapshot?.phone || receiptModalOrder.buyer?.phone}
          deliveryAddress={
            receiptModalOrder.delivery_snapshot
              ? `${receiptModalOrder.delivery_snapshot.campus_area || ''}, ${receiptModalOrder.delivery_snapshot.address_line || ''}`
              : receiptModalOrder.campus_area
          }
          deliveryPin={receiptModalOrder.delivery_pin || undefined}
          vendorName={receiptModalOrder.vendor?.store_name}
          vendorLocation={receiptModalOrder.vendor?.campus_area}
          items={(receiptModalOrder.items || []).map((it) => ({
            id: it.id,
            title: it.product_title,
            variantLabel: it.variant_label,
            quantity: it.quantity,
            unitPriceKobo: it.unit_price_kobo,
            lineTotalKobo: it.line_total_kobo,
          }))}
          subtotalKobo={receiptModalOrder.subtotal_kobo}
          deliveryFeeKobo={receiptModalOrder.delivery_fee_kobo}
          totalKobo={receiptModalOrder.total_kobo}
        />
      )}
    </div>
  );
};
