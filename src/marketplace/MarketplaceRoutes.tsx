import React from 'react';
import { App as MarketplaceShell } from './App';
import { AuthProvider } from './lib/auth';
import { CartProvider } from './lib/cart';
import { ToastProvider } from './components/Toast';

// Marketplace styles are `.mp-root`-scoped, so they cannot affect the platform
// shell. Importing them here (rather than in `src/main.tsx`) keeps them in the
// Marketplace's lazy chunk, so a visitor who never opens the Marketplace never
// downloads its CSS.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/marketplace.css';

/**
 * Everything the Marketplace needs, mounted under the platform's shared
 * providers (`ThemeProvider` → `AuthProvider` → `ToastProvider`, all in
 * `src/main.tsx`).
 *
 * The only Marketplace-owned providers left are the cart (a
 * `fuw_marketplace_cart_v1` localStorage key) and the toast surface. Session,
 * profile identity and theme are NOT re-created here — must.md Phase 4 forbids
 * a second authentication system.
 */
export const MarketplaceRoutes: React.FC = () => (
  <AuthProvider>
    <CartProvider>
      <ToastProvider>
        <MarketplaceShell />
      </ToastProvider>
    </CartProvider>
  </AuthProvider>
);

export default MarketplaceRoutes;
