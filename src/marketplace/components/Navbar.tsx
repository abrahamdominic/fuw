import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Search,
  ShoppingCart,
  Heart,
  MessageSquare,
  Wallet,
  Bell,
  User,
  Store,
  Sun,
  Moon,
  Menu,
  X,
  ShieldCheck,
  PackageCheck,
  ChevronDown,
  Home,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { fetchNotifications, markNotificationRead } from '../lib/api';
import { Logo } from './Logo';
import type { MarketplaceNotification } from '../lib/types';
import { mpPath, PLATFORM_PATHS } from '../lib/routes';
import { MessageText } from '../../components/MessageText';
import { EcosystemSwitcher } from '../../components/EcosystemSwitcher';

export const Navbar: React.FC = () => {
  const { user, profile, vendor, isAdmin, isStaff, theme, toggleTheme, signOut } = useAuth();
  const { totalCount: cartCount } = useCart();
  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<MarketplaceNotification[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
    setNotifMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (user) {
      fetchNotifications().then((list) => {
        setNotifications(list);
        setUnreadNotifCount(list.filter((n) => !n.is_read).length);
      }).catch(() => {});
    }
  }, [user]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(mpPath(`/browse?search=${encodeURIComponent(searchQuery.trim())}`));
    }
  };

  const handleMarkAllNotifs = async () => {
    await markNotificationRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadNotifCount(0);
  };

  const handleDismissNotification = async (notifId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await markNotificationRead(notifId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
      );
      setUnreadNotifCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    }
  };

  return (
    <header
      className="mp-navbar"
      style={{
        position: 'relative',
        zIndex: 40,
        background: 'var(--surface, #ffffff)',
        borderBottom: '1px solid var(--border, #dcebe0)',
        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(18, 96, 61, 0.08))',
      }}
    >

      {/* Main Navbar */}
      <div
        className="mp-nav-bar"
        style={{
          maxWidth: 'var(--shell-max, 1240px)',
          margin: '0 auto',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {/* Brand */}
        <div className="mp-nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* NOTE: visibility is owned by CSS (.mobile-only / .mp-nav-toggle) —
              an inline `display` here would override both media queries. */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="mobile-only mp-nav-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-primary, #17231d)',
              padding: 6,
            }}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          <Link
            to={mpPath("/")}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              color: 'var(--text-primary, #17231d)',
            }}
          >
            <Logo size={36} />
            <div className="mp-brand-text">
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--green-900, #0d4a2f)', display: 'block', lineHeight: 1.1 }}>
                FUW Marketplace
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', fontWeight: 500 }}>
                Federal University Wukari
              </span>
            </div>
          </Link>
        </div>

        {/* Search Bar (desktop) */}
        <form
          onSubmit={handleSearchSubmit}
          className="desktop-only mp-nav-search"
          style={{
            flex: 1,
            maxWidth: 480,
            position: 'relative',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search phones, textbooks, barbing, laundry..."
            style={{
              width: '100%',
              height: 42,
              padding: '0 40px 0 16px',
              borderRadius: 21,
              border: '1px solid var(--border, #dcebe0)',
              background: 'var(--surface-alt, #f4f8f5)',
              color: 'var(--text-primary, #17231d)',
              fontSize: 14,
              outline: 'none',
              transition: 'border-color 0.15s ease',
            }}
          />
          <button
            type="submit"
            aria-label="Search"
            style={{
              position: 'absolute',
              right: 12,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--green-800, #12603d)',
              display: 'flex',
              padding: 0,
            }}
          >
            <Search size={18} />
          </button>
        </form>

        {/* Action icons & links */}
        <div className="mp-nav-actions">
          {/* Ecosystem Quick Switcher */}
          <div className="desktop-only" style={{ display: 'inline-flex', alignItems: 'center', marginRight: 4 }}>
            <EcosystemSwitcher mode="dropdown" />
          </div>

          {/* Explore Browse Link */}
          <Link
            to={mpPath("/browse")}
            className="desktop-only mp-nav-textlink"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-primary, #17231d)',
              textDecoration: 'none',
              padding: '6px 10px',
            }}
          >
            Browse All
          </Link>

          {/* Vendor Hub Button */}
          {vendor ? (
            <Link
              to={mpPath("/vendor/dashboard")}
              className="desktop-only mp-nav-textlink mp-nav-cta"
              style={{
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'var(--green-100, #e8f5ec)',
                color: 'var(--green-800, #12603d)',
                border: '1px solid var(--green-600, #17854f)',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              <Store size={15} />
              <span>Vendor Hub</span>
            </Link>
          ) : (
            <Link
              to={mpPath("/vendor/register")}
              className="desktop-only mp-nav-textlink mp-nav-cta"
              style={{
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'var(--surface-alt, #f4f8f5)',
                color: 'var(--green-800, #12603d)',
                border: '1px solid var(--border, #dcebe0)',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              <Store size={15} />
              <span>Sell on FUW</span>
            </Link>
          )}

          {/* Admin link if staff/admin */}
          {(isAdmin || isStaff) && (
            <Link
              to={mpPath("/admin")}
              className="desktop-only mp-nav-optional mp-nav-textlink"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#b45309',
                textDecoration: 'none',
                padding: '4px 8px',
                background: '#fef3c7',
                borderRadius: 6,
                border: '1px solid #fde68a',
              }}
            >
              Admin Portal
            </Link>
          )}

          {/* PHASE 16: a staff member's own support queue, one click from anywhere */}
          {(isAdmin || isStaff) && (
            <Link
              to={mpPath("/admin/support")}
              className="desktop-only mp-nav-optional mp-nav-textlink"
              title="Vendor support queue"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--primary, #12603d)',
                textDecoration: 'none',
                padding: '4px 8px',
                background: 'var(--primary-bg, #e8f5ec)',
                borderRadius: 6,
              }}
            >
              Support
            </Link>
          )}

          {/* Favourites */}
          <Link
            to={mpPath("/favourites")}
            title="Saved Favourites"
            className="mp-nav-icon"
            style={{
              position: 'relative',
              color: 'var(--text-secondary, #55675b)',
              padding: 6,
              borderRadius: 8,
            }}
          >
            <Heart size={20} />
          </Link>

          {/* Wallet */}
          <Link
            to={mpPath("/wallet")}
            title="Your Wallet"
            className="mp-nav-icon"
            style={{
              position: 'relative',
              color: 'var(--text-secondary, #55675b)',
              padding: 6,
              borderRadius: 8,
            }}
          >
            <Wallet size={20} />
          </Link>

          {/* Messages */}
          <Link
            to={mpPath("/messages")}
            title="Messages & Vendor Chats"
            className="mp-nav-icon"
            style={{
              position: 'relative',
              color: 'var(--text-secondary, #55675b)',
              padding: 6,
              borderRadius: 8,
            }}
          >
            <MessageSquare size={20} />
          </Link>

          {/* Notifications Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setNotifMenuOpen(!notifMenuOpen)}
              title="Notifications"
              aria-label={`Notifications${unreadNotifCount > 0 ? ` (${unreadNotifCount} unread)` : ''}`}
              aria-expanded={notifMenuOpen}
              className="mp-nav-icon"
              style={{
                position: 'relative',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary, #55675b)',
                padding: 8,
                minWidth: 42,
                minHeight: 42,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
              }}
            >
              <Bell size={20} />
              {unreadNotifCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#b91c1c',
                    color: '#ffffff',
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {notifMenuOpen && (
              <>
                <div
                  className="mp-notif-backdrop"
                  onClick={() => setNotifMenuOpen(false)}
                  aria-hidden="true"
                />
                <div
                  className="mp-notif-panel"
                  role="dialog"
                  aria-label="Notifications"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    maxHeight: 420,
                    overflowY: 'auto',
                    background: 'var(--surface, #ffffff)',
                    borderRadius: 14,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
                    border: '1px solid var(--border, #dcebe0)',
                    padding: 14,
                    zIndex: 200,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--border, #dcebe0)', paddingBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bell size={16} color="var(--green-800, #12603d)" />
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Notifications</h4>
                      {unreadNotifCount > 0 && (
                        <span style={{ background: '#b91c1c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                          {unreadNotifCount}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {unreadNotifCount > 0 && (
                        <button
                          onClick={handleMarkAllNotifs}
                          style={{ background: 'none', border: 'none', color: 'var(--green-800, #12603d)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Mark all read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setNotifMenuOpen(false)}
                        aria-label="Close notifications"
                        title="Close"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-secondary, #55675b)',
                          padding: 4,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 4,
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                  {notifications.length === 0 ? (
                    <p style={{ margin: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--muted, #55675b)' }}>
                      No notifications yet
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          padding: '10px 8px',
                          borderRadius: 8,
                          background: n.is_read ? 'transparent' : 'var(--surface-alt, #f4f8f5)',
                          marginBottom: 6,
                          fontSize: 13,
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ display: 'block', color: 'var(--text-primary, #17231d)' }}>{n.title}</strong>
                          <span style={{ color: 'var(--text-secondary, #55675b)', fontSize: 12 }}>
                            <MessageText body={n.body} inline />
                          </span>
                        </div>
                        {!n.is_read && (
                          <button
                            type="button"
                            onClick={(e) => handleDismissNotification(n.id, e)}
                            title="Dismiss notification"
                            aria-label="Dismiss notification"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 4,
                              color: 'var(--text-secondary, #55675b)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 4,
                              flexShrink: 0,
                            }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Cart Icon with Badge */}
          <Link
            to={mpPath("/cart")}
            title="Shopping Cart"
            className="mp-nav-icon"
            style={{
              position: 'relative',
              color: 'var(--green-800, #12603d)',
              padding: 6,
              borderRadius: 8,
            }}
          >
            <ShoppingCart size={22} />
            {cartCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  minWidth: 18,
                  height: 18,
                  padding: '0 4px',
                  borderRadius: 9,
                  background: 'var(--green-800, #12603d)',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                }}
              >
                {cartCount}
              </span>
            )}
          </Link>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="mp-nav-icon mp-nav-theme"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary, #55675b)',
              padding: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              width: 36,
              height: 36,
            }}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {/* User Profile / Menu */}
          <div className="mp-nav-user" style={{ position: 'relative' }}>
            {user ? (
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--surface-alt, #f4f8f5)',
                  border: '1px solid var(--border, #dcebe0)',
                  borderRadius: 20,
                  padding: '4px 10px 4px 6px',
                  cursor: 'pointer',
                  color: 'var(--text-primary, #17231d)',
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--green-800, #12603d)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="desktop-only mp-user-name" style={{ fontSize: 13, fontWeight: 600, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile?.full_name ? profile.full_name.split(' ')[0] : 'Student'}
                </span>
                <ChevronDown size={14} />
              </button>
            ) : (
              <Link
                to={PLATFORM_PATHS.login}
                className="mp-nav-cta"
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: 'var(--green-800, #12603d)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <User size={15} />
                <span>Sign in</span>
              </Link>
            )}

            {/* User Dropdown Menu */}
            {userMenuOpen && user && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 6,
                  width: 220,
                  background: 'var(--surface, #ffffff)',
                  borderRadius: 12,
                  boxShadow: '0 12px 30px rgba(0,0,0,0.15)',
                  border: '1px solid var(--border, #dcebe0)',
                  padding: 8,
                  zIndex: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border, #dcebe0)' }}>
                  <strong style={{ fontSize: 13, display: 'block', color: 'var(--text-primary, #17231d)' }}>
                    {profile?.full_name || 'FUW Student'}
                  </strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)' }}>
                    {profile?.matric_number || profile?.department || user.email}
                  </span>
                </div>

                <Link
                  to={mpPath("/orders")}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: 'var(--text-primary, #17231d)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <PackageCheck size={16} />
                  <span>My Orders</span>
                </Link>

                <Link
                  to={mpPath("/profile")}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: 'var(--text-primary, #17231d)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <User size={16} />
                  <span>My Account & Addresses</span>
                </Link>

                {vendor ? (
                  <Link
                    to={mpPath("/vendor/dashboard")}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      color: 'var(--green-800, #12603d)',
                      fontWeight: 600,
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Store size={16} />
                    <span>Vendor Dashboard</span>
                  </Link>
                ) : (
                  <Link
                    to={mpPath("/vendor/register")}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      color: 'var(--green-800, #12603d)',
                      fontWeight: 600,
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Store size={16} />
                    <span>Become a Campus Vendor</span>
                  </Link>
                )}

                {(isAdmin || isStaff) && (
                  <Link
                    to={mpPath("/admin")}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 13,
                      color: '#b45309',
                      fontWeight: 700,
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <ShieldCheck size={16} />
                    <span>Admin Control Center</span>
                  </Link>
                )}

                <button
                  type="button"
                  onClick={() => signOut()}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: '#b91c1c',
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600,
                    marginTop: 4,
                    borderTop: '1px solid var(--border, #dcebe0)',
                  }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          className="mobile-only mp-nav-drawer"
          style={{
            padding: '16px',
            background: 'var(--surface, #ffffff)',
            borderTop: '1px solid var(--border, #dcebe0)',
          }}
        >
          {/* Quick Ecosystem Switcher Bar for Mobile */}
          <div style={{ marginBottom: 12 }}>
            <EcosystemSwitcher mode="bar" onSelect={() => setMobileMenuOpen(false)} />
          </div>

          {/* Mobile search */}
          <form onSubmit={handleSearchSubmit} style={{ marginBottom: 14 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products or services..."
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid var(--border, #dcebe0)',
                background: 'var(--surface-alt, #f4f8f5)',
                fontSize: 14,
              }}
            />
          </form>

          {/* Mobile Notifications Quick Access */}
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setNotifMenuOpen(true);
            }}
            className="mp-drawer-notif-btn"
            aria-label={`Open notifications (${unreadNotifCount} unread)`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Bell size={18} color="var(--green-800, #12603d)" />
              <span style={{ fontWeight: 600 }}>Notifications</span>
            </div>
            {unreadNotifCount > 0 ? (
              <span
                style={{
                  background: '#b91c1c',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 12,
                }}
              >
                {unreadNotifCount} new
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #55675b)' }}>All caught up</span>
            )}
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Link to={mpPath("/")} style={{ fontSize: 14, fontWeight: 700, color: 'var(--green-800, #12603d)', textDecoration: 'none', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Home size={16} />
              <span>Marketplace Home</span>
            </Link>
            <Link to={mpPath("/browse")} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #17231d)', textDecoration: 'none', padding: '6px 0' }}>
              Browse Marketplace
            </Link>
            <Link to={mpPath("/orders")} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #17231d)', textDecoration: 'none', padding: '6px 0' }}>
              My Orders & Tracking
            </Link>
            <Link to={mpPath("/wallet")} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #17231d)', textDecoration: 'none', padding: '6px 0' }}>
              My Wallet
            </Link>
            <Link to={mpPath("/messages")} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #17231d)', textDecoration: 'none', padding: '6px 0' }}>
              Messages & Chats
            </Link>
            <Link to={mpPath("/favourites")} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #17231d)', textDecoration: 'none', padding: '6px 0' }}>
              Saved Favourites
            </Link>
            {vendor ? (
              <Link to={mpPath("/vendor/dashboard")} style={{ fontSize: 14, fontWeight: 700, color: 'var(--green-800, #12603d)', textDecoration: 'none', padding: '6px 0' }}>
                Vendor Dashboard
              </Link>
            ) : (
              <Link to={mpPath("/vendor/register")} style={{ fontSize: 14, fontWeight: 700, color: 'var(--green-800, #12603d)', textDecoration: 'none', padding: '6px 0' }}>
                Open a Campus Storefront
              </Link>
            )}
            {(isAdmin || isStaff) && (
              <>
                <Link to={mpPath("/admin")} style={{ fontSize: 14, fontWeight: 700, color: '#b45309', textDecoration: 'none', padding: '6px 0' }}>
                  Admin Portal
                </Link>
                <Link to={mpPath("/admin/support")} style={{ fontSize: 14, fontWeight: 700, color: 'var(--green-800, #12603d)', textDecoration: 'none', padding: '6px 0' }}>
                  Support Queue
                </Link>
              </>
            )}
            <Link to={PLATFORM_PATHS.hub} style={{ fontSize: 14, fontWeight: 700, color: 'var(--green-800, #12603d)', textDecoration: 'none', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Return to FUW Campus Hub</span>
            </Link>
            <Link to={PLATFORM_PATHS.library} style={{ fontSize: 14, color: 'var(--text-secondary, #55675b)', textDecoration: 'none', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>FUW E-Library</span>
            </Link>
            <Link to={PLATFORM_PATHS.accommodation} style={{ fontSize: 14, color: 'var(--text-secondary, #55675b)', textDecoration: 'none', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>FUW Accommodation & Lodges</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};
