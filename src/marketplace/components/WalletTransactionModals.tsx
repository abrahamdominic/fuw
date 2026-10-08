import React, { useState } from 'react';
import { CheckCircle2, ArrowUpRight, Copy, Check, X, ShieldCheck, Clock, Building } from 'lucide-react';
import { formatNaira } from '../lib/format';

export interface WalletFundSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  amountKobo: number;
  newBalanceKobo?: number;
  reference: string;
  onExploreMarketplace?: () => void;
}

export const WalletFundSuccessModal: React.FC<WalletFundSuccessModalProps> = ({
  isOpen,
  onClose,
  amountKobo,
  newBalanceKobo,
  reference,
  onExploreMarketplace,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const copyRef = () => {
    navigator.clipboard.writeText(reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
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
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 20,
          maxWidth: 460,
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          textAlign: 'center',
          padding: '32px 28px',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: '#55675b',
            cursor: 'pointer',
            padding: 4,
          }}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Celebratory Icon */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #e8f5ec, #c8ebd3)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 18px',
            color: '#12603d',
            boxShadow: '0 8px 20px rgba(18, 96, 61, 0.2)',
          }}
        >
          <CheckCircle2 size={42} strokeWidth={2.4} />
        </div>

        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: '#0d4a2f' }}>
          Wallet Funded Successfully!
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#55675b' }}>
          Your payment was confirmed and credited directly to your Campus Hub in-app wallet.
        </p>

        {/* Amount Pill */}
        <div
          style={{
            background: '#f4f8f5',
            borderRadius: 12,
            padding: '16px',
            border: '1px solid #dcebe0',
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 12, color: '#55675b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block' }}>
            Amount Credited
          </span>
          <span style={{ fontSize: 32, fontWeight: 900, color: '#0d4a2f', display: 'block', margin: '4px 0' }}>
            {formatNaira(amountKobo)}
          </span>
          {newBalanceKobo !== undefined && (
            <span style={{ fontSize: 12, color: '#187144', fontWeight: 600 }}>
              Updated Available Balance: <strong>{formatNaira(newBalanceKobo)}</strong>
            </span>
          )}
        </div>

        {/* Transaction details card */}
        <div style={{ background: '#f8faf9', borderRadius: 10, padding: '12px 16px', fontSize: 12, textAlign: 'left', marginBottom: 24, border: '1px solid #edf4f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#55675b' }}>Channel:</span>
            <strong style={{ color: '#17231d' }}>Paystack Gateway (Instant SSL)</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#55675b' }}>Reference:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontSize: 11, background: '#eef4f0', padding: '2px 6px', borderRadius: 4, color: '#0d4a2f' }}>
                {reference}
              </code>
              <button
                type="button"
                onClick={copyRef}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#12603d', padding: 2 }}
                title="Copy reference"
              >
                {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 10,
              background: '#12603d',
              color: '#ffffff',
              border: 'none',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
          {onExploreMarketplace && (
            <button
              type="button"
              onClick={onExploreMarketplace}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: 10,
                background: '#e8f5ec',
                color: '#0d4a2f',
                border: '1px solid #c2e2cc',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Shop Marketplace
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export interface WalletWithdrawSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  amountKobo: number;
  feeKobo: number;
  netKobo: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  reference: string;
}

export const WalletWithdrawSuccessModal: React.FC<WalletWithdrawSuccessModalProps> = ({
  isOpen,
  onClose,
  amountKobo,
  feeKobo,
  netKobo,
  bankName,
  accountName,
  accountNumber,
  reference,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const copyRef = () => {
    navigator.clipboard.writeText(reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maskedAccount = accountNumber.length >= 4
    ? `••••••${accountNumber.slice(-4)}`
    : accountNumber;

  return (
    <div
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
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 20,
          maxWidth: 480,
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          textAlign: 'center',
          padding: '30px 28px',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: '#55675b',
            cursor: 'pointer',
            padding: 4,
          }}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Payout Icon */}
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: '50%',
            background: '#e0f2fe',
            color: '#0369a1',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 16px rgba(3, 105, 161, 0.15)',
          }}
        >
          <Building size={34} />
        </div>

        <h2 style={{ margin: '0 0 4px', fontSize: 21, fontWeight: 800, color: '#0d4a2f' }}>
          Withdrawal Request Submitted
        </h2>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#55675b' }}>
          Your payout has been debited and queued for Nigerian bank transfer settlement.
        </p>

        {/* Payout details card */}
        <div
          style={{
            background: '#f8faf9',
            borderRadius: 14,
            padding: '16px',
            border: '1px solid #dcebe0',
            textAlign: 'left',
            fontSize: 13,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#55675b' }}>Withdrawal Amount:</span>
            <strong style={{ color: '#17231d' }}>{formatNaira(amountKobo)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#55675b' }}>Processing Fee:</span>
            <span style={{ color: '#55675b' }}>{formatNaira(feeKobo)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #edf4f0', paddingTop: 8 }}>
            <span style={{ fontWeight: 700, color: '#0d4a2f' }}>Net Bank Payout:</span>
            <strong style={{ fontSize: 16, color: '#0d4a2f', fontWeight: 900 }}>
              {formatNaira(netKobo)}
            </strong>
          </div>
          <div style={{ borderTop: '1px solid #edf4f0', paddingTop: 8 }}>
            <div style={{ color: '#55675b', fontSize: 11, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>
              Destination Account
            </div>
            <strong style={{ color: '#17231d', display: 'block' }}>{accountName}</strong>
            <span style={{ color: '#55675b', fontSize: 12 }}>
              {bankName} · {maskedAccount}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #edf4f0', paddingTop: 8 }}>
            <span style={{ color: '#55675b', fontSize: 12 }}>Payout Ref:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{ fontSize: 11, background: '#eef4f0', padding: '2px 6px', borderRadius: 4, color: '#0d4a2f' }}>
                {reference}
              </code>
              <button
                type="button"
                onClick={copyRef}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#12603d', padding: 2 }}
                title="Copy reference"
              >
                {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        </div>

        {/* Live Status Tracker */}
        <div style={{ background: '#f4f8f5', borderRadius: 10, padding: '12px 16px', marginBottom: 20, textAlign: 'left', border: '1px solid #dcebe0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#12603d', fontSize: 12, fontWeight: 700 }}>
            <Clock size={16} />
            <span>Estimated Payout Arrival: Within 5 – 30 minutes</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 10,
            background: '#12603d',
            color: '#ffffff',
            border: 'none',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Close &amp; View Withdrawals
        </button>
      </div>
    </div>
  );
};
