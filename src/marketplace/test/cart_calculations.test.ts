import { describe, it, expect } from 'vitest';
import type { CartItem } from '../lib/types';

function calculateCartTotals(items: CartItem[], deliveryType: 'delivery' | 'pickup') {
  const subtotalKobo = items.reduce((acc, item) => acc + item.product.price_kobo * item.quantity, 0);

  // Group by vendor to compute delivery fees per vendor
  const vendorGroups: Record<string, CartItem[]> = {};
  for (const item of items) {
    const vId = item.product.vendor_id;
    if (!vendorGroups[vId]) vendorGroups[vId] = [];
    vendorGroups[vId].push(item);
  }

  const vendorCount = Object.keys(vendorGroups).length;
  // If delivery, ₦500 per distinct vendor (50,000 kobo); if pickup, ₦0
  const deliveryFeeKobo = deliveryType === 'delivery' ? vendorCount * 50000 : 0;
  const grandTotalKobo = subtotalKobo + deliveryFeeKobo;

  return {
    subtotalKobo,
    deliveryFeeKobo,
    grandTotalKobo,
    vendorCount,
  };
}

describe('Cart Calculations, Vendor Grouping & Delivery Fees', () => {
  const mockProductA: any = {
    id: 'prod-1',
    vendor_id: 'vendor-1',
    title: 'Textbook CSC 201',
    price_kobo: 350000, // ₦3,500
    quantity_available: 5,
  };

  const mockProductB: any = {
    id: 'prod-2',
    vendor_id: 'vendor-1',
    title: 'CSC Notebook',
    price_kobo: 50000, // ₦500
    quantity_available: 10,
  };

  const mockProductC: any = {
    id: 'prod-3',
    vendor_id: 'vendor-2',
    title: 'Hot Fried Rice & Chicken',
    price_kobo: 200000, // ₦2,000
    quantity_available: 20,
  };

  it('calculates single vendor subtotal and delivery fee correctly', () => {
    const items: CartItem[] = [
      { productId: mockProductA.id, product: mockProductA, quantity: 2 },
      { productId: mockProductB.id, product: mockProductB, quantity: 1 },
    ];

    const result = calculateCartTotals(items, 'delivery');
    expect(result.subtotalKobo).toBe(750000); // (3500 * 2 + 500) = 7500 Naira = 750,000 kobo
    expect(result.vendorCount).toBe(1);
    expect(result.deliveryFeeKobo).toBe(50000); // 1 vendor = ₦500
    expect(result.grandTotalKobo).toBe(800000); // ₦8,000
  });

  it('calculates multi-vendor delivery fees separately per vendor', () => {
    const items: CartItem[] = [
      { productId: mockProductA.id, product: mockProductA, quantity: 1 }, // vendor 1
      { productId: mockProductC.id, product: mockProductC, quantity: 2 }, // vendor 2
    ];

    const result = calculateCartTotals(items, 'delivery');
    expect(result.subtotalKobo).toBe(750000); // 3500 + (2000 * 2) = 7500 Naira
    expect(result.vendorCount).toBe(2);
    expect(result.deliveryFeeKobo).toBe(100000); // 2 vendors = ₦1,000
    expect(result.grandTotalKobo).toBe(850000); // ₦8,500
  });

  it('charges ₦0 delivery fee for campus pickup orders', () => {
    const items: CartItem[] = [
      { productId: mockProductA.id, product: mockProductA, quantity: 1 },
      { productId: mockProductC.id, product: mockProductC, quantity: 1 },
    ];

    const result = calculateCartTotals(items, 'pickup');
    expect(result.deliveryFeeKobo).toBe(0);
    expect(result.grandTotalKobo).toBe(result.subtotalKobo);
  });
});
