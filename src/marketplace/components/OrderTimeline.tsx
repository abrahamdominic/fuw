import React from 'react';
import { CheckCircle2, Clock, Truck, Package, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { OrderStatus } from '../lib/types';

interface OrderTimelineProps {
  currentStatus: OrderStatus;
  orderHistory?: Array<{ status: OrderStatus; note?: string; created_at: string }>;
}

const STEPS: Array<{ key: OrderStatus; label: string; icon: any }> = [
  { key: 'pending_payment', label: 'Payment', icon: Clock },
  { key: 'paid', label: 'Paid & Protected', icon: ShieldCheck },
  { key: 'order_confirmed', label: 'Confirmed', icon: CheckCircle2 },
  { key: 'preparing', label: 'In Progress', icon: Package },
  { key: 'ready_for_delivery', label: 'Ready', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: Truck },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
];

export const OrderTimeline: React.FC<OrderTimelineProps> = ({ currentStatus }) => {
  const isSpecial = ['cancelled', 'disputed', 'refunded'].includes(currentStatus);

  if (isSpecial) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          borderRadius: 10,
          background: currentStatus === 'disputed' ? '#fee2e2' : '#f3f4f6',
          color: currentStatus === 'disputed' ? '#991b1b' : '#374151',
          border: `1px solid ${currentStatus === 'disputed' ? '#fca5a5' : '#e5e7eb'}`,
        }}
      >
        <AlertTriangle size={22} />
        <div>
          <strong style={{ fontSize: 14, display: 'block', textTransform: 'capitalize' }}>
            Order {currentStatus.replace('_', ' ')}
          </strong>
          <span style={{ fontSize: 12 }}>
            {currentStatus === 'disputed' && 'This order is under review by campus marketplace administrators. Funds remain protected.'}
            {currentStatus === 'cancelled' && 'This order was cancelled and inventory has been released.'}
            {currentStatus === 'refunded' && 'Payment has been refunded back to the buyer.'}
          </span>
        </div>
      </div>
    );
  }

  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);

  if (currentIndex === -1) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          borderRadius: 10,
          background: '#f3f4f6',
          color: '#374151',
          border: '1px solid #e5e7eb',
        }}
      >
        <AlertTriangle size={22} />
        <div>
          <strong style={{ fontSize: 14, display: 'block' }}>
            Order status: {currentStatus.replace(/_/g, ' ')}
          </strong>
          <span style={{ fontSize: 12 }}>
            This order is not on the standard fulfilment timeline. Open a dispute or contact support.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="order-timeline">
      <div className="order-timeline-track">
        {STEPS.map((step, idx) => {
          const isDone = currentIndex >= idx;
          const isCurrent = currentIndex === idx;
          const Icon = step.icon;

          return (
            <React.Fragment key={step.key}>
              <div className="order-timeline-step">
                <div
                  className={
                    'order-timeline-dot' +
                    (isDone ? ' is-done' : '') +
                    (isCurrent ? ' is-current' : '')
                  }
                >
                  <Icon size={16} />
                </div>
                <span
                  className={
                    'order-timeline-label' +
                    (isDone ? ' is-done' : '') +
                    (isCurrent ? ' is-current' : '')
                  }
                >
                  {step.label}
                </span>
              </div>

              {idx < STEPS.length - 1 && (
                <div
                  aria-hidden
                  className={
                    'order-timeline-link' + (currentIndex > idx ? ' is-done' : '')
                  }
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
