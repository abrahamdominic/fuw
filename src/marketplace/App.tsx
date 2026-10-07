import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { MarketplaceSplash } from './components/MarketplaceSplash';
import { mpPath, MARKETPLACE_BASE, PLATFORM_PATHS } from './lib/routes';

// Pages
import { HomePage } from './pages/HomePage';
import { BrowsePage } from './pages/BrowsePage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { VendorStorePage } from './pages/VendorStorePage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrdersPage } from './pages/OrdersPage';
import { WalletPage } from './pages/WalletPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { MessagesPage } from './pages/MessagesPage';
import { SupportInbox } from './pages/SupportPage';
import { FavouritesPage } from './pages/FavouritesPage';
import { ProfilePage } from './pages/ProfilePage';
import { VendorRegisterPage } from './pages/VendorRegisterPage';
import { VendorDashboardPage } from './pages/VendorDashboardPage';
import { AdminPortalPage } from './pages/AdminPortalPage';

/**
 * The Marketplace shell, mounted by `src/main.tsx` under `/marketplace/*`.
 *
 * Because this component renders inside a `<Route path="/marketplace/*">`, the
 * `<Routes>` below match the path that REMAINS after `/marketplace` - so
 * `path="/browse"` here resolves to `/marketplace/browse`. The `mpPath()`
 * prefix on every outbound link keeps the two halves in agreement.
 *
 * `.mp-root` scopes the Marketplace stylesheet so its reset and design tokens
 * cannot leak into the E Library shell (and vice versa).
 */
export const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // If returning from Paystack wallet funding with ?reference=fuw_fund_..., redirect to wallet
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get('reference') || params.get('trxref');
    if (ref && ref.startsWith('fuw_fund_') && !location.pathname.endsWith('/wallet')) {
      navigate(mpPath(`/wallet?reference=${encodeURIComponent(ref)}`), { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  return (
    <div className="mp-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <MarketplaceSplash />
      <Navbar />

      <main style={{ flex: 1, maxWidth: 'var(--shell-max, 1240px)', width: '100%', margin: '0 auto', padding: '24px 16px' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/product/:id" element={<ProductDetailPage />} />
          <Route path="/vendor/:slug" element={<VendorStorePage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/order/:id" element={<OrderDetailPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/vendor/support" element={<SupportInbox viewer="vendor" />} />
          <Route path="/admin/support" element={<SupportInbox viewer="admin" />} />
          <Route path="/favourites" element={<FavouritesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {/* One sign-in surface for the whole platform (must.md Phase 4).
              Kept as a route so old `/marketplace/login` bookmarks still land
              somewhere sensible instead of a 404. */}
          <Route path="/login" element={<Navigate to={PLATFORM_PATHS.login} replace />} />
          <Route path="/register" element={<Navigate to={PLATFORM_PATHS.register} replace />} />
          <Route path="/vendor/register" element={<VendorRegisterPage />} />
          <Route path="/vendor/dashboard" element={<VendorDashboardPage />} />
          <Route path="/admin" element={<AdminPortalPage />} />
          {/* Unknown Marketplace paths go to the Marketplace home, not the
              platform 404 — the splat only catches paths under /marketplace. */}
          <Route path="*" element={<Navigate to={mpPath('/')} replace />} />
        </Routes>
      </main>
    </div>
  );
};

/** Convenience re-export so the mount point does not import two modules. */
export { MARKETPLACE_BASE };
