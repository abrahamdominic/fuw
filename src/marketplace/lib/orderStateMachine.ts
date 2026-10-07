import type { OrderStatus } from './types';

export type TransitionRole = 'buyer' | 'vendor' | 'admin' | 'system';

export interface OrderTransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  roles: TransitionRole[];
}

/**
 * Mirror of the server-side table `public.marketplace_order_transitions`,
 * which is enforced authoritatively by `mp_transition_order`.
 *
 * This is a UI-only copy used to decide which affordances to render. It must
 * never be treated as an authorization boundary. `scripts/verify-frontend-state-machine.mjs`
 * fails if this table drifts from the live database table.
 */
export const ORDER_TRANSITIONS: OrderTransitionRule[] = [
  { from: 'pending_payment', to: 'paid', roles: ['system'] },
  { from: 'pending_payment', to: 'cancelled', roles: ['admin', 'buyer', 'system'] },

  { from: 'paid', to: 'order_confirmed', roles: ['admin', 'vendor'] },
  { from: 'paid', to: 'cancelled', roles: ['admin', 'vendor'] },

  { from: 'order_confirmed', to: 'preparing', roles: ['vendor'] },
  { from: 'order_confirmed', to: 'cancelled', roles: ['admin', 'vendor'] },

  { from: 'preparing', to: 'ready_for_delivery', roles: ['vendor'] },
  { from: 'preparing', to: 'cancelled', roles: ['admin', 'vendor'] },

  { from: 'ready_for_delivery', to: 'delivered', roles: ['vendor'] },
  { from: 'ready_for_delivery', to: 'cancelled', roles: ['admin', 'vendor'] },

  { from: 'delivered', to: 'completed', roles: ['buyer', 'system'] },
  { from: 'delivered', to: 'disputed', roles: ['admin', 'buyer'] },

  { from: 'completed', to: 'disputed', roles: ['admin', 'buyer'] },

  { from: 'disputed', to: 'completed', roles: ['admin'] },
  { from: 'disputed', to: 'cancelled', roles: ['admin'] },
  { from: 'disputed', to: 'refunded', roles: ['admin'] },
];

export function canTransition(from: OrderStatus, to: OrderStatus, role: TransitionRole): boolean {
  if (from === to) return false;
  return ORDER_TRANSITIONS.some(
    (rule) => rule.from === from && rule.to === to && rule.roles.includes(role)
  );
}

export function allowedNextStatuses(from: OrderStatus, role: TransitionRole): OrderStatus[] {
  const seen = new Set<OrderStatus>();
  const out: OrderStatus[] = [];
  for (const rule of ORDER_TRANSITIONS) {
    if (rule.from === from && rule.roles.includes(role) && !seen.has(rule.to)) {
      seen.add(rule.to);
      out.push(rule.to);
    }
  }
  return out;
}

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['refunded'];

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'paid',
  'order_confirmed',
  'preparing',
  'ready_for_delivery',
  'delivered',
];

export const DISPUTE_ELIGIBLE_ORDER_STATUSES: OrderStatus[] = ['delivered', 'completed'];

export const VENDOR_ACTIONABLE_ORDER_STATUSES: OrderStatus[] = [
  'paid',
  'order_confirmed',
  'preparing',
  'ready_for_delivery',
];

/**
 * Receipt confirmation is the only buyer-side transition that releases escrow,
 * and it is enforced by `mp_confirm_receipt` rather than `mp_transition_order`.
 */
export const RECEIPT_CONFIRMABLE_ORDER_STATUSES: OrderStatus[] = ['delivered'];