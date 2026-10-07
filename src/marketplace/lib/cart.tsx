import React, { createContext, useContext, useEffect, useState } from 'react';
import type { CartItem, CartVendorGroup, MarketplaceProduct, MarketplaceProductVariant } from './types';

interface CartContextType {
  items: CartItem[];
  addItem: (product: MarketplaceProduct, variant?: MarketplaceProductVariant, quantity?: number) => void;
  removeItem: (productId: string, variantId?: string) => void;
  updateQuantity: (productId: string, variantId: string | undefined, quantity: number) => void;
  clearCart: () => void;
  totalCount: number;
  subtotalKobo: number;
  groupedByVendor: CartVendorGroup[];
}

const CartContext = createContext<CartContextType>({} as CartContextType);

const CART_STORAGE_KEY = 'fuw_marketplace_cart_v1';

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.error('Failed to save cart to localStorage:', err);
    }
  }, [items]);

  const addItem = (product: MarketplaceProduct, variant?: MarketplaceProductVariant, quantity: number = 1) => {
    setItems((prev) => {
      const idx = prev.findIndex(
        (it) => it.productId === product.id && (it.variantId || '') === (variant?.id || '')
      );

      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          quantity: next[idx].quantity + quantity,
        };
        return next;
      }

      return [
        ...prev,
        {
          productId: product.id,
          variantId: variant?.id,
          product,
          variant,
          quantity,
        },
      ];
    });
  };

  const removeItem = (productId: string, variantId?: string) => {
    setItems((prev) =>
      prev.filter((it) => !(it.productId === productId && (it.variantId || '') === (variantId || '')))
    );
  };

  const updateQuantity = (productId: string, variantId: string | undefined, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId, variantId);
      return;
    }
    setItems((prev) =>
      prev.map((it) => {
        if (it.productId === productId && (it.variantId || '') === (variantId || '')) {
          return { ...it, quantity };
        }
        return it;
      })
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalCount = items.reduce((acc, it) => acc + it.quantity, 0);

  const subtotalKobo = items.reduce((acc, it) => {
    const unitPrice = it.variant?.price_kobo ?? it.product.price_kobo;
    return acc + unitPrice * it.quantity;
  }, 0);

  // Group items by vendor
  const vendorMap = new Map<string, CartVendorGroup>();

  for (const it of items) {
    const vId = it.product.vendor_id;
    const vName = it.product.vendor?.store_name || 'Campus Vendor';
    const campusArea = it.product.vendor?.campus_area;
    const unitPrice = it.variant?.price_kobo ?? it.product.price_kobo;
    const lineTotal = unitPrice * it.quantity;
    const deliveryFee = it.product.delivery_fee_kobo || 0;

    if (!vendorMap.has(vId)) {
      vendorMap.set(vId, {
        vendorId: vId,
        vendorName: vName,
        campusArea,
        items: [it],
        subtotalKobo: lineTotal,
        deliveryFeeKobo: deliveryFee,
        totalKobo: lineTotal + deliveryFee,
      });
    } else {
      const g = vendorMap.get(vId)!;
      g.items.push(it);
      g.subtotalKobo += lineTotal;
      // Vendor delivery fee is charged once per vendor in the cart
      g.deliveryFeeKobo = Math.max(g.deliveryFeeKobo, deliveryFee);
      g.totalKobo = g.subtotalKobo + g.deliveryFeeKobo;
    }
  }

  const groupedByVendor = Array.from(vendorMap.values());

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalCount,
        subtotalKobo,
        groupedByVendor,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => useContext(CartContext);
