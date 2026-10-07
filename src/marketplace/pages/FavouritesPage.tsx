import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ShoppingBag, Store } from 'lucide-react';
import { fetchFavourites } from '../lib/api';
import type { MarketplaceProduct, MarketplaceVendor } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { VendorCard } from '../components/VendorCard';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useAuth } from '../lib/auth';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';

export const FavouritesPage: React.FC = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [vendors, setVendors] = useState<MarketplaceVendor[]>([]);
  const [tab, setTab] = useState<'products' | 'vendors'>('products');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    fetchFavourites().then((res) => {
      setProducts(res.products as any);
      setVendors(res.vendors as any);
    }).catch(console.error).finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div style={{ padding: '60px 0' }}>
        <EmptyState
          icon={<Heart size={32} />}
          title="Sign In to View Favourites"
          description="Save products, meals, textbooks, and campus vendors to easily find them later."
          action={
            <Link to={PLATFORM_PATHS.login} className="btn btn-primary" style={{ padding: '10px 22px' }}>
              Sign In
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Title */}
      <div style={{ marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border, #dcebe0)' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
          Saved Favourites
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary, #55675b)' }}>
          Your bookmarked products and favourite student vendors
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border, #dcebe0)', marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => setTab('products')}
          style={{
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            borderBottom: tab === 'products' ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
            color: tab === 'products' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Saved Products ({products.length})
        </button>

        <button
          type="button"
          onClick={() => setTab('vendors')}
          style={{
            padding: '10px 16px',
            background: 'none',
            border: 'none',
            borderBottom: tab === 'vendors' ? '3px solid var(--green-800, #12603d)' : '3px solid transparent',
            color: tab === 'vendors' ? 'var(--green-900, #0d4a2f)' : 'var(--text-secondary, #55675b)',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Favourite Stores ({vendors.length})
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={280} borderRadius={12} />
          ))}
        </div>
      ) : tab === 'products' ? (
        products.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={32} />}
            title="No Saved Products"
            description="Tap the heart icon on any listing to save it here for later."
            action={
              <Link to={mpPath("/browse")} className="btn btn-primary" style={{ padding: '9px 18px' }}>
                Browse Products
              </Link>
            }
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))', gap: 16 }}>
            {products.map((p) => (
              <ProductCard key={p.id} product={p} isFavouritedInitial={true} />
            ))}
          </div>
        )
      ) : (
        vendors.length === 0 ? (
          <EmptyState
            icon={<Store size={32} />}
            title="No Favourite Stores"
            description="Bookmark campus sellers you love for quick access to their new drops."
            action={
              <Link to={mpPath("/browse")} className="btn btn-primary" style={{ padding: '9px 18px' }}>
                Discover Stores
              </Link>
            }
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16 }}>
            {vendors.map((v) => (
              <VendorCard key={v.id} vendor={v} />
            ))}
          </div>
        )
      )}
    </div>
  );
};
