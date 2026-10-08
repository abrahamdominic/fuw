import React from 'react';
import { Printer, X, ShieldCheck, CheckCircle2, Download, Copy, Check } from 'lucide-react';
import { formatNaira, formatDate } from '../lib/format';
import type { MarketplaceOrder } from '../lib/types';

export interface ReceiptItem {
  id?: string;
  title: string;
  variantLabel?: string | null;
  quantity: number;
  unitPriceKobo: number;
  lineTotalKobo: number;
}

export interface DigitalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: string;
  orderDate?: string | Date;
  status?: string;
  paymentMethod?: string;
  transactionRef?: string;
  buyerName?: string;
  buyerPhone?: string;
  deliveryAddress?: string;
  deliveryPin?: string;
  vendorName?: string;
  vendorLocation?: string;
  items: ReceiptItem[];
  subtotalKobo: number;
  deliveryFeeKobo?: number;
  totalKobo: number;
}

export const DigitalReceiptModal: React.FC<DigitalReceiptModalProps> = ({
  isOpen,
  onClose,
  orderNumber,
  orderDate = new Date(),
  status = 'Paid · Escrow Secured',
  paymentMethod = 'Wallet / Paystack Escrow',
  transactionRef,
  buyerName,
  buyerPhone,
  deliveryAddress,
  deliveryPin,
  vendorName = 'Verified Campus Vendor',
  vendorLocation = 'Wukari Campus Environs',
  items,
  subtotalKobo,
  deliveryFeeKobo = 0,
  totalKobo,
}) => {
  const [copiedRef, setCopiedRef] = React.useState(false);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const copyRef = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 2000);
  };

  const formattedDate = typeof orderDate === 'string'
    ? formatDate(orderDate)
    : new Date(orderDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + new Date(orderDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="receipt-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 25, 17, 0.75)',
        backdropFilter: 'blur(3px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="receipt-modal-card"
        style={{
          background: '#ffffff',
          borderRadius: 16,
          maxWidth: 620,
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header toolbar (screen only) */}
        <div
          className="receipt-toolbar no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            background: '#f4f8f5',
            borderBottom: '1px solid #dcebe0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0d4a2f' }}>
              OFFICIAL TRANSACTION RECEIPT
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handlePrint}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 8,
                background: '#12603d',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <Printer size={15} />
              <span>Print Receipt</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#55675b',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 6,
              }}
              aria-label="Close receipt"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Printable Receipt Body */}
        <div
          className="receipt-printable-body"
          style={{
            padding: '28px 32px',
            overflowY: 'auto',
            color: '#17231d',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {/* Institution banner */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0d4a2f', paddingBottom: 16, marginBottom: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: '#12603d', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 900, fontSize: 18 }}>
                  FUW
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0d4a2f', letterSpacing: '-0.3px' }}>
                    Federal University Wukari
                  </h2>
                  <span style={{ fontSize: 12, color: '#55675b', fontWeight: 600 }}>
                    CAMPUS HUB · DIGITAL MARKETPLACE
                  </span>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#55675b', fontWeight: 700, letterSpacing: 0.5 }}>
                Receipt No
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#0d4a2f' }}>
                RCP-{orderNumber}
              </div>
              <div style={{ fontSize: 11, color: '#688272', marginTop: 2 }}>
                {formattedDate}
              </div>
            </div>
          </div>

          {/* Status and Escrow Seal */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#e8f5ec',
              border: '1px solid #b7dfc6',
              borderRadius: 8,
              padding: '10px 16px',
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={20} color="#12603d" />
              <div>
                <strong style={{ fontSize: 13, color: '#0d4a2f', display: 'block' }}>
                  {status}
                </strong>
                <span style={{ fontSize: 11, color: '#2a5a3e' }}>
                  Funds locked in platform escrow until physical delivery verification
                </span>
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: 'uppercase',
                padding: '3px 8px',
                borderRadius: 4,
                background: '#12603d',
                color: '#ffffff',
                letterSpacing: 0.5,
              }}
            >
              VERIFIED
            </span>
          </div>

          {/* Parties Meta Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20, fontSize: 12 }}>
            <div style={{ background: '#f8faf9', padding: 12, borderRadius: 8, border: '1px solid #edf4f0' }}>
              <span style={{ color: '#55675b', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                Purchased By
              </span>
              <strong style={{ fontSize: 13, color: '#17231d', display: 'block' }}>
                {buyerName || 'Campus Student'}
              </strong>
              {buyerPhone && <div style={{ color: '#55675b', marginTop: 2 }}>Tel: {buyerPhone}</div>}
              {deliveryAddress && (
                <div style={{ color: '#55675b', marginTop: 2 }}>
                  Destination: {deliveryAddress}
                </div>
              )}
            </div>

            <div style={{ background: '#f8faf9', padding: 12, borderRadius: 8, border: '1px solid #edf4f0' }}>
              <span style={{ color: '#55675b', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                Vendor / Merchant
              </span>
              <strong style={{ fontSize: 13, color: '#17231d', display: 'block' }}>
                {vendorName}
              </strong>
              <div style={{ color: '#55675b', marginTop: 2 }}>
                Location: {vendorLocation}
              </div>
              <div style={{ color: '#12603d', fontWeight: 600, marginTop: 2 }}>
                Verified Student Merchant
              </div>
            </div>
          </div>

          {/* Delivery PIN Card (If available) */}
          {deliveryPin && (
            <div
              style={{
                background: '#fffbeb',
                border: '1.5px dashed #f59e0b',
                borderRadius: 8,
                padding: '10px 16px',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', display: 'block' }}>
                  Delivery Verification PIN
                </span>
                <span style={{ fontSize: 11, color: '#78350f' }}>
                  Share this code with the vendor only upon receiving and inspecting goods.
                </span>
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 900,
                  letterSpacing: 4,
                  background: '#ffffff',
                  padding: '4px 14px',
                  borderRadius: 6,
                  border: '1px solid #fcd34d',
                  color: '#92400e',
                }}
              >
                {deliveryPin}
              </div>
            </div>
          )}

          {/* Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20, fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #dcebe0', background: '#f4f8f5', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', color: '#0d4a2f', fontWeight: 700 }}>Item Description</th>
                <th style={{ padding: '8px 10px', color: '#0d4a2f', fontWeight: 700, textAlign: 'center' }}>Qty</th>
                <th style={{ padding: '8px 10px', color: '#0d4a2f', fontWeight: 700, textAlign: 'right' }}>Unit Price</th>
                <th style={{ padding: '8px 10px', color: '#0d4a2f', fontWeight: 700, textAlign: 'right' }}>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #edf4f0' }}>
                  <td style={{ padding: '10px' }}>
                    <strong style={{ display: 'block', color: '#17231d' }}>{item.title}</strong>
                    {item.variantLabel && (
                      <span style={{ fontSize: 11, color: '#55675b' }}>Variant: {item.variantLabel}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'center', color: '#55675b' }}>
                    {item.quantity}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#55675b' }}>
                    {formatNaira(item.unitPriceKobo)}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: '#17231d' }}>
                    {formatNaira(item.lineTotalKobo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals Summary */}
          <div style={{ marginLeft: 'auto', width: '260px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#55675b' }}>
              <span>Items Subtotal:</span>
              <span>{formatNaira(subtotalKobo)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#55675b' }}>
              <span>Campus Delivery Fee:</span>
              <span>{deliveryFeeKobo > 0 ? formatNaira(deliveryFeeKobo) : 'Free / Self-Pickup'}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                paddingTop: 8,
                marginTop: 4,
                borderTop: '2px solid #0d4a2f',
                fontSize: 16,
                fontWeight: 900,
                color: '#0d4a2f',
              }}
            >
              <span>Total Paid:</span>
              <span>{formatNaira(totalKobo)}</span>
            </div>
          </div>

          {/* Payment & Audit Info */}
          <div style={{ borderTop: '1px solid #dcebe0', paddingTop: 14, fontSize: 11, color: '#688272', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span>Payment Channel: <strong>{paymentMethod}</strong></span>
              {transactionRef && (
                <span style={{ marginLeft: 10 }}>
                  Ref: <strong style={{ cursor: 'pointer' }} onClick={() => copyRef(transactionRef)} title="Click to copy">
                    {transactionRef} {copiedRef ? '(Copied!)' : ''}
                  </strong>
                </span>
              )}
            </div>
            <div>
              Secured by FUW Escrow Protection Ledger
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
