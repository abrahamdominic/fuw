import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, ShoppingBag, ArrowRight, ShieldCheck, Store, MapPin } from 'lucide-react';
import { useCart } from '../lib/cart';
import { formatNaira } from '../lib/format';
import { EmptyState } from '../components/EmptyState';
import { mpPath } from '../lib/routes';

export const CartPage: React.FC = () => {
  const { items, removeItem, updateQuantity, clearCart, groupedByVendor, subtotalKobo } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div style={{ padding: '60px 0' }}>
        <EmptyState
          icon={<ShoppingBag size={32} />}
          title="Your Shopping Cart is Empty"
          description="Explore student products, meals, textbooks, electronics and campus services."
          action={
            <Link to={mpPath("/browse")} className="btn btn-primary" style={{ padding: '10px 22px' }}>
              <span>Start Browsing</span>
              <ArrowRight size={16} />
            </Link>
          }
        />
      </div>
    );
  }

  const totalDeliveryFee = groupedByVendor.reduce((acc, g) => acc + g.deliveryFeeKobo, 0);
  const grandTotal = subtotalKobo + totalDeliveryFee;

  return (
    <div style={{ paddingBottom: 60 }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, borderBottom: '1px solid var(--border, #dcebe0)', paddingBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary, #17231d)' }}>
            Shopping Cart
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary, #55675b)' }}>
            {items.length} {items.length === 1 ? 'item' : 'items'} from {groupedByVendor.length} {groupedByVendor.length === 1 ? 'vendor' : 'vendors'}
          </p>
        </div>

        <button
          type="button"
          onClick={clearCart}
          style={{
            background: 'none',
            border: 'none',
            color: '#b91c1c',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Clear cart
        </button>
      </div>

      <div style={{ display: 'grid', gap: 32 }} className="cart-grid-container">
        {/* Left: Vendor Groups & Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groupedByVendor.map((group) => (
            <div
              key={group.vendorId}
              style={{
                background: 'var(--surface, #ffffff)',
                borderRadius: 14,
                border: '1px solid var(--border, #dcebe0)',
                overflow: 'hidden',
              }}
            >
              {/* Vendor header */}
              <div
                style={{
                  padding: '14px 18px',
                  background: 'var(--surface-alt, #f4f8f5)',
                  borderBottom: '1px solid var(--border, #dcebe0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Store size={18} color="var(--green-800, #12603d)" />
                  <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary, #17231d)' }}>
                    {group.vendorName}
                  </span>
                  {group.campusArea && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                      <MapPin size={12} /> {group.campusArea}
                    </span>
                  )}
                </div>

                <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                  Delivery: {group.deliveryFeeKobo > 0 ? formatNaira(group.deliveryFeeKobo) : 'Campus Pickup / Free'}
                </span>
              </div>

              {/* Items in this vendor group */}
              <div style={{ padding: '0 18px' }}>
                {group.items.map((it) => {
                  const unitPrice = it.variant?.price_kobo ?? it.product.price_kobo;
                  const thumb = it.product.thumbnail_url || it.product.images?.[0]?.url;

                  return (
                    <div
                      key={`${it.productId}-${it.variantId || 'base'}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 0',
                        borderBottom: '1px solid var(--border, #dcebe0)',
                        gap: 16,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 8,
                            background: 'var(--surface-alt, #f4f8f5)',
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}
                        >
                          {thumb ? (
                            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                              <ShoppingBag size={24} color="var(--muted, #55675b)" />
                            </div>
                          )}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <Link
                            to={mpPath(`/product/${it.product.slug || it.productId}`)}
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'var(--text-primary, #17231d)',
                              textDecoration: 'none',
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.product.title}
                          </Link>

                          {it.variant && (
                            <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>
                              {it.variant.name}: {it.variant.value}
                            </span>
                          )}

                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green-900, #0d4a2f)', marginTop: 4 }}>
                            {formatNaira(unitPrice)}
                          </div>
                        </div>
                      </div>

                      {/* Quantity & Delete */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border, #dcebe0)', borderRadius: 6 }}>
                          <button
                            type="button"
                            onClick={() => updateQuantity(it.productId, it.variantId, it.quantity - 1)}
                            style={{ width: 28, height: 28, border: 'none', background: 'var(--surface-alt, #f4f8f5)', cursor: 'pointer' }}
                          >
                            -
                          </button>
                          <span style={{ width: 32, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>{it.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(it.productId, it.variantId, it.quantity + 1)}
                            style={{ width: 28, height: 28, border: 'none', background: 'var(--surface-alt, #f4f8f5)', cursor: 'pointer' }}
                          >
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItem(it.productId, it.variantId)}
                          style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', padding: 4 }}
                          title="Remove item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Right: Order Summary Card */}
        <div>
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              borderRadius: 14,
              border: '1px solid var(--border, #dcebe0)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              position: 'sticky',
              top: 80,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Order Summary</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #55675b)' }}>
                <span>Items Subtotal</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #17231d)' }}>{formatNaira(subtotalKobo)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary, #55675b)' }}>
                <span>Total Delivery Fees</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #17231d)' }}>
                  {totalDeliveryFee > 0 ? formatNaira(totalDeliveryFee) : 'Free / Pickup'}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 14,
                  marginTop: 6,
                  borderTop: '1px solid var(--border, #dcebe0)',
                  fontSize: 17,
                  fontWeight: 800,
                  color: 'var(--green-900, #0d4a2f)',
                }}
              >
                <span>Total</span>
                <span>{formatNaira(grandTotal)}</span>
              </div>
            </div>

            {/* Buyer protection guarantee */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, background: 'var(--green-100, #e8f5ec)', color: 'var(--green-800, #12603d)', fontSize: 12, fontWeight: 500 }}>
              <ShieldCheck size={18} style={{ flexShrink: 0 }} />
              <span>Payments held safe by FUW Marketplace until you confirm delivery.</span>
            </div>

            <button
              type="button"
              onClick={() => navigate(mpPath('/checkout'))}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px 18px', fontSize: 15 }}
            >
              <span>Proceed to Checkout</span>
              <ArrowRight size={16} />
            </button>

            <Link
              to={mpPath("/browse")}
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--green-800, #12603d)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
