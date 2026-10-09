import React from 'react';
import { Wallet, ShieldCheck, Clock, CheckCircle2, ArrowUpRight, DollarSign } from 'lucide-react';
import { formatNaira } from '../lib/format';

export interface VendorEscrowCardsProps {
  availableKobo: number;
  escrowKobo: number;
  pendingOrdersKobo: number;
  pendingOrdersCount: number;
  totalReleasedKobo: number;
  withdrawableKobo: number;
  onRequestPayout?: () => void;
  canRequestPayout?: boolean;
}

export const VendorEscrowCards: React.FC<VendorEscrowCardsProps> = ({
  availableKobo,
  escrowKobo,
  pendingOrdersKobo,
  pendingOrdersCount,
  totalReleasedKobo,
  withdrawableKobo,
  onRequestPayout,
  canRequestPayout = true
}) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
        gap: 16,
        marginBottom: 24
      }}
    >
      {/* 1. Available Wallet Balance */}
      <div
        className="vendor-metric-card"
        style={{
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 14,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'all 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary, #55675b)' }}>
            Available Wallet Balance
          </span>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(11, 107, 58, 0.1)',
              color: 'var(--primary, #0B6B3A)'
            }}
          >
            <Wallet size={18} />
          </div>
        </div>
        <div>
          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-900, #0d4a2f)', display: 'block' }}>
            {formatNaira(availableKobo)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', marginTop: 4, display: 'block' }}>
            Funds ready for immediate use or withdrawal
          </span>
        </div>
      </div>

      {/* 2. Funds in Escrow */}
      <div
        className="vendor-metric-card"
        style={{
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 14,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'all 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary, #55675b)' }}>
            Funds in Escrow
          </span>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(217, 119, 6, 0.12)',
              color: '#d97706'
            }}
          >
            <ShieldCheck size={18} />
          </div>
        </div>
        <div>
          <span style={{ fontSize: 24, fontWeight: 800, color: escrowKobo > 0 ? '#b45309' : 'var(--text-primary, #17231d)', display: 'block' }}>
            {formatNaira(escrowKobo)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', marginTop: 4, display: 'block' }}>
            Held securely until buyer confirms receipt
          </span>
        </div>
      </div>

      {/* 3. Pending Payments */}
      <div
        className="vendor-metric-card"
        style={{
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 14,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'all 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary, #55675b)' }}>
            Pending Payments
          </span>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(37, 99, 235, 0.12)',
              color: '#2563eb'
            }}
          >
            <Clock size={18} />
          </div>
        </div>
        <div>
          <span style={{ fontSize: 24, fontWeight: 800, color: pendingOrdersKobo > 0 ? '#1d4ed8' : 'var(--text-primary, #17231d)', display: 'block' }}>
            {formatNaira(pendingOrdersKobo)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', marginTop: 4, display: 'block' }}>
            {pendingOrdersCount} active {pendingOrdersCount === 1 ? 'order' : 'orders'} in progress / transit
          </span>
        </div>
      </div>

      {/* 4. Total Released Funds */}
      <div
        className="vendor-metric-card"
        style={{
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--border, #dcebe0)',
          borderRadius: 14,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'all 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary, #55675b)' }}>
            Total Released Funds
          </span>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(5, 150, 105, 0.12)',
              color: '#059669'
            }}
          >
            <CheckCircle2 size={18} />
          </div>
        </div>
        <div>
          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary, #17231d)', display: 'block' }}>
            {formatNaira(totalReleasedKobo)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', marginTop: 4, display: 'block' }}>
            All-time cumulative fulfilled order earnings
          </span>
        </div>
      </div>

      {/* 5. Withdrawable Earnings */}
      <div
        className="vendor-metric-card"
        style={{
          background: 'var(--surface, #ffffff)',
          border: '2px solid rgba(11, 107, 58, 0.3)',
          borderRadius: 14,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 6px rgba(11, 107, 58, 0.08)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary, #0B6B3A)' }}>
            Withdrawable Earnings
          </span>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--primary-bg, #e8f5ec)',
              color: 'var(--primary, #0B6B3A)'
            }}
          >
            <DollarSign size={18} />
          </div>
        </div>
        <div>
          <span style={{ fontSize: 24, fontWeight: 900, color: 'var(--green-900, #0d4a2f)', display: 'block' }}>
            {formatNaira(withdrawableKobo)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', marginTop: 4, display: 'block' }}>
            Net balance after holds and platform deductions
          </span>
          {onRequestPayout && (
            <button
              type="button"
              onClick={onRequestPayout}
              disabled={!canRequestPayout || withdrawableKobo < 500000}
              style={{
                marginTop: 10,
                width: '100%',
                padding: '7px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: withdrawableKobo >= 500000 ? 'var(--primary, #0B6B3A)' : '#e2e8f0',
                color: withdrawableKobo >= 500000 ? '#ffffff' : '#94a3b8',
                border: 'none',
                cursor: withdrawableKobo >= 500000 ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s ease'
              }}
            >
              <span>Request Payout</span>
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorEscrowCards;
