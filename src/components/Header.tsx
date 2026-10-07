import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu,
  X,
  LayoutDashboard,
  LogIn,
  UserPlus,
  LogOut,
  ShieldCheck,
  User,
  Sun,
  Moon,
  Home,
  LayoutGrid
} from 'lucide-react';
import { Logo } from './Logo';
import { useStore } from '../lib/useStore';
import { useAuth } from '../lib/AuthContext';
import { useTheme } from '../lib/ThemeContext';
import { useToast } from './Toast';
import { fx } from '../lib/motion';

export function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const store = useStore();
  const { toast } = useToast();
  const { isAuthenticated, isAdmin, profile, user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const currentUser = store.getCurrentUser();
  const displayName =
    profile?.displayName ||
    profile?.fullName?.split(' ')[0] ||
    currentUser.displayName ||
    currentUser.fullName?.split(' ')[0] ||
    'Student';

  // Close mobile drawer upon route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await signOut();
    toast('Logged out successfully', 'info');
    navigate('/login');
  };

  return (
    <>
      <header className="main-header">
        <Link className="brand" to="/home" aria-label="Federal University Wukari Digital Library Home">
          <Logo size={36} />
          <span className="brand-text">
            <b>FUW</b> Ecosystem
          </span>
        </Link>

        <nav className="desktop-nav" aria-label="Main Navigation">
          <NavLink to="/hub" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Campus Hub
          </NavLink>
          <NavLink to="/home" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Home
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Library
          </NavLink>
          <NavLink to="/accommodation" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Accommodation
          </NavLink>
          <NavLink to="/marketplace" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Marketplace
          </NavLink>
          <NavLink to="/faculties" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Faculties
          </NavLink>
          <NavLink to="/courses" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Courses
          </NavLink>
          <NavLink to="/repository" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Repository
          </NavLink>
          <NavLink to="/collections" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Collections
          </NavLink>
          <NavLink to="/help" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Help
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            About
          </NavLink>
        </nav>

        <div className="nav-actions">
          {/* Theme Toggle Button */}
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {isAuthenticated ? (
            <>
              {isAdmin ? (
                <Link className="portal-pill-link admin-pill" to="/admin" title="Admin Repository Portal">
                  <ShieldCheck size={14} />
                  <span>Admin ({displayName})</span>
                </Link>
              ) : (
                <Link className="portal-pill-link" to="/student" title="Student Learning Dashboard">
                  <LayoutDashboard size={14} />
                  <span>Dashboard ({displayName})</span>
                </Link>
              )}
              <button className="nav-logout-btn" onClick={handleLogout} title="Sign out">
                <LogOut size={14} />
                <span>Log out</span>
              </button>
            </>
          ) : (
            <>
              <Link className="login-link" to="/login">
                Log in
              </Link>
              <Link className="join-btn" to="/register">
                Create account
              </Link>
            </>
          )}
        </div>

        <button
          className="mobile-menu-toggle"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Drawer Navigation */}
      {open && (
        <div className={`mobile-nav-drawer ${fx.overlay}`} role="dialog" aria-modal="true">
          <div className={`mobile-nav-inner ${fx.fadeDown}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                THEME SETTING
              </span>
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
                style={{ width: 'auto', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 12px', borderRadius: 8 }}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            </div>

            <div className="mobile-nav-links">
              <NavLink to="/hub" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                FUW Campus Hub
              </NavLink>
              <NavLink to="/home" end className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Home
              </NavLink>
              <NavLink to="/library" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Library Collection
              </NavLink>
              <NavLink to="/accommodation" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Accommodation &amp; Hostels
              </NavLink>
              <NavLink to="/marketplace" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                FUW Marketplace
              </NavLink>
              <NavLink to="/faculties" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Faculties &amp; Departments
              </NavLink>
              <NavLink to="/courses" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Course Directory
              </NavLink>
              <NavLink to="/repository" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Institutional Repository
              </NavLink>
              <NavLink to="/collections" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Curated Collections
              </NavLink>
              <NavLink to="/help" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Help &amp; Services
              </NavLink>
              <NavLink to="/about" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                About FUW Ecosystem
              </NavLink>
              <NavLink to="/contact" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Support Desk
              </NavLink>
            </div>

            {isAuthenticated ? (
              <div className="mobile-nav-portals">
                <span className="mobile-portal-label">AUTHENTICATED PORTAL</span>
                <Link to="/hub" className="mobile-portal-btn student" style={{ marginBottom: 8 }}>
                  <LayoutGrid size={17} />
                  <span>Campus Hub Gateway</span>
                </Link>
                {isAdmin ? (
                  <Link to="/admin" className="mobile-portal-btn admin">
                    <ShieldCheck size={17} />
                    <span>Open Admin Portal</span>
                  </Link>
                ) : (
                  <Link to="/student" className="mobile-portal-btn student">
                    <LayoutDashboard size={17} />
                    <span>Open Student Portal</span>
                  </Link>
                )}
                <button className="mobile-auth-btn login" onClick={handleLogout} style={{ border: 0, width: '100%', cursor: 'pointer', marginTop: 8 }}>
                  <LogOut size={16} />
                  <span>Log out</span>
                </button>
              </div>
            ) : (
              <div className="mobile-nav-auth">
                <Link to="/login" className="mobile-auth-btn login">
                  <LogIn size={16} />
                  <span>Log in</span>
                </Link>
                <Link to="/register" className="mobile-auth-btn register">
                  <UserPlus size={16} />
                  <span>Create account</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
