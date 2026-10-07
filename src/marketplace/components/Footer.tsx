import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Lock, HeartHandshake, HelpCircle } from 'lucide-react';
import { mpPath } from '../lib/routes';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        background: 'var(--green-900, #0d4a2f)',
        color: '#ffffff',
        padding: '48px 16px 24px',
        marginTop: 'auto',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div style={{ maxWidth: 'var(--shell-max, 1240px)', margin: '0 auto' }}>
        {/* Trust Badges Row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
            gap: 24,
            paddingBottom: 36,
            marginBottom: 36,
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: 10, borderRadius: 10 }}>
              <ShieldCheck size={22} color="#34d399" />
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Payment Protection</h4>
              <p style={{ margin: 0, fontSize: 13, color: '#a7f3d0', lineHeight: 1.4 }}>
                Money is safely held until you receive and confirm your order. Never get scammed on campus.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: 10, borderRadius: 10 }}>
              <HeartHandshake size={22} color="#34d399" />
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Verified Student Vendors</h4>
              <p style={{ margin: 0, fontSize: 13, color: '#a7f3d0', lineHeight: 1.4 }}>
                Every seller is linked to an authentic FUW student identity with campus verification.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: 10, borderRadius: 10 }}>
              <Lock size={22} color="#34d399" />
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Dispute Guarantee</h4>
              <p style={{ margin: 0, fontSize: 13, color: '#a7f3d0', lineHeight: 1.4 }}>
                Got the wrong item or defect? Open a dispute for full or partial refund investigation.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.1)', padding: 10, borderRadius: 10 }}>
              <HelpCircle size={22} color="#34d399" />
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Hostel Delivery & Pickups</h4>
              <p style={{ margin: 0, fontSize: 13, color: '#a7f3d0', lineHeight: 1.4 }}>
                Direct delivery to New Site, Female Hostels, Male Hostels, Faculty blocks & Wukari town.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Navigation Columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
            gap: 32,
            marginBottom: 36,
          }}
        >
          <div>
            <h5 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', color: '#ffffff' }}>Marketplace</h5>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <li><Link to={mpPath("/browse")} style={{ color: '#d1fae5', textDecoration: 'none' }}>All Categories</Link></li>
              <li><Link to={mpPath("/browse?listingType=product")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Physical Products</Link></li>
              <li><Link to={mpPath("/browse?listingType=service")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Campus Services</Link></li>
              <li><Link to={mpPath("/browse?category=food")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Food & Meals</Link></li>
              <li><Link to={mpPath("/browse?category=books")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Textbooks & Handouts</Link></li>
            </ul>
          </div>

          <div>
            <h5 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', color: '#ffffff' }}>Services & Skills</h5>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <li><Link to={mpPath("/browse?category=laundry")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Laundry & Ironing</Link></li>
              <li><Link to={mpPath("/browse?category=barbing")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Barbing & Haircuts</Link></li>
              <li><Link to={mpPath("/browse?category=hair-styling")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Hair Styling & Braids</Link></li>
              <li><Link to={mpPath("/browse?category=printing")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Printing & Binding</Link></li>
              <li><Link to={mpPath("/browse?category=repairs")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Phone & PC Repairs</Link></li>
            </ul>
          </div>

          <div>
            <h5 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', color: '#ffffff' }}>Vendors & Orders</h5>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <li><Link to={mpPath("/vendor/register")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Open Storefront</Link></li>
              <li><Link to={mpPath("/vendor/dashboard")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Vendor Dashboard</Link></li>
              <li><Link to={mpPath("/orders")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Track Your Order</Link></li>
              <li><Link to={mpPath("/messages")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Chat with Vendors</Link></li>
              <li><Link to={mpPath("/favourites")} style={{ color: '#d1fae5', textDecoration: 'none' }}>Saved Items</Link></li>
            </ul>
          </div>

          <div>
            <h5 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', color: '#ffffff' }}>FUW Campus Info</h5>
            <p style={{ fontSize: 13, color: '#a7f3d0', lineHeight: 1.5, margin: '0 0 12px' }}>
              Federal University Wukari, Katsina-Ala Road, P.M.B. 1020, Wukari, Taraba State, Nigeria.
            </p>
            <p style={{ fontSize: 12, color: '#6ee7b7', margin: 0 }}>
              Operating within FUW University safety guidelines.
            </p>
          </div>
        </div>

        {/* Copyright */}
        <div
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            paddingTop: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 12,
            color: '#a7f3d0',
          }}
        >
          <span>© {new Date().getFullYear()} Federal University Wukari Student Marketplace. All rights reserved.</span>
          <span>Designed with the official FUW design language.</span>
        </div>
      </div>
    </footer>
  );
};
