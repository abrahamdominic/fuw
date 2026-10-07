import { describe, it, expect } from 'vitest';
import {
  ORDER_TRANSITIONS,
  canTransition,
  allowedNextStatuses,
  ACTIVE_ORDER_STATUSES,
  DISPUTE_ELIGIBLE_ORDER_STATUSES,
  RECEIPT_CONFIRMABLE_ORDER_STATUSES,
} from '../lib/orderStateMachine';
import type { OrderStatus } from '../lib/types';

/**
 * The order state machine is authoritative in PostgreSQL
 * (`public.marketplace_order_transitions`, enforced by `mp_transition_order`).
 * `src/lib/orderStateMachine.ts` mirrors that table for UI affordances only.
 *
 * These tests pin the security-critical rules of the real server contract.
 * `scripts/verify-frontend-state-machine.mjs` additionally proves this mirror
 * still matches the live database table.
 */
describe('Order state machine mirror', () => {
  it('never lets a buyer or admin mark an order paid', () => {
    expect(canTransition('pending_payment', 'paid', 'buyer')).toBe(false);
    expect(canTransition('pending_payment', 'paid', 'admin')).toBe(false);
    expect(canTransition('pending_payment', 'paid', 'vendor')).toBe(false);
    expect(canTransition('pending_payment', 'paid', 'system')).toBe(true);
  });

  it('never lets a vendor mark an order delivered or completed', () => {
    expect(canTransition('delivered', 'completed', 'vendor')).toBe(false);
    expect(canTransition('delivered', 'completed', 'buyer')).toBe(true);
    expect(canTransition('ready_for_delivery', 'delivered', 'vendor')).toBe(true);
  });

  it('prohibits skipping payment and fulfilment stages', () => {
    expect(canTransition('pending_payment', 'completed', 'vendor')).toBe(false);
    expect(canTransition('pending_payment', 'delivered', 'vendor')).toBe(false);
    expect(canTransition('paid', 'delivered', 'vendor')).toBe(false);
    expect(canTransition('paid', 'preparing', 'vendor')).toBe(false);
    expect(canTransition('order_confirmed', 'ready_for_delivery', 'vendor')).toBe(false);
  });

  it('restricts dispute resolution to admin only', () => {
    expect(canTransition('disputed', 'refunded', 'buyer')).toBe(false);
    expect(canTransition('disputed', 'completed', 'vendor')).toBe(false);
    expect(canTransition('disputed', 'refunded', 'admin')).toBe(true);
    expect(canTransition('disputed', 'completed', 'admin')).toBe(true);
  });

  it('does not let a buyer cancel a paid order to dodge the process', () => {
    expect(canTransition('paid', 'cancelled', 'buyer')).toBe(false);
    expect(canTransition('paid', 'cancelled', 'vendor')).toBe(true);
    expect(canTransition('pending_payment', 'cancelled', 'buyer')).toBe(true);
  });

  it('allows the full happy path', () => {
    expect(canTransition('paid', 'order_confirmed', 'vendor')).toBe(true);
    expect(canTransition('order_confirmed', 'preparing', 'vendor')).toBe(true);
    expect(canTransition('preparing', 'ready_for_delivery', 'vendor')).toBe(true);
    expect(canTransition('ready_for_delivery', 'delivered', 'vendor')).toBe(true);
    expect(canTransition('delivered', 'completed', 'buyer')).toBe(true);
  });

  it('never allows a transition out of refunded', () => {
    for (const rule of ORDER_TRANSITIONS) {
      expect(rule.from === 'refunded').toBe(false);
    }
    for (const role of ['buyer', 'vendor', 'admin', 'system'] as const) {
      const next = allowedNextStatuses('refunded', role);
      expect(next).toEqual([]);
    }
  });

  it('exposes dispute eligibility only for delivered or completed orders', () => {
    for (const status of DISPUTE_ELIGIBLE_ORDER_STATUSES) {
      expect(canTransition(status, 'disputed', 'buyer')).toBe(true);
    }
    for (const status of ['pending_payment', 'paid', 'order_confirmed', 'preparing', 'ready_for_delivery'] as OrderStatus[]) {
      expect(canTransition(status, 'disputed', 'buyer')).toBe(false);
    }
  });

  it('exposes receipt confirmation only after delivery', () => {
    expect(RECEIPT_CONFIRMABLE_ORDER_STATUSES).toEqual(['delivered']);
  });

  it('keeps active-tab statuses aligned with the vendor pipeline', () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual([
      'paid',
      'order_confirmed',
      'preparing',
      'ready_for_delivery',
      'delivered',
    ]);
  });
});