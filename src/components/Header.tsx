import React, { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LayoutDashboard, LogIn, UserPlus, LogOut, User } from 'lucide-react';
import { Logo } from './Logo';
import { useStore } from '../lib/useStore';
import { useToast } from './Toast';

export function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const store = useStore();
  const { toast } = useToast();

  const isStudent = store.isLoggedInStudent();
  const currentUser = store.getCurrentUser();

  // Close mobile drawer upon route change
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    store.logoutStudent();
    toast('Logged out successfully', 'info');
    navigate('/login');
  };

  return (
    <>
      <header className="main-header">
        <Link className="brand" to="/" aria-label="Federal University Wukari Digital Library Home">
          <Logo size={36} />
          <span className="brand-text">
            <b>FUW</b> E-Library
          </span>
        </Link>

        <nav className="desktop-nav" aria-label="Main Navigation">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Home
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Library
          </NavLink>
          <NavLink to="/faculties" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Faculties
          </NavLink>
          <NavLink to="/courses" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Courses
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            About
          </NavLink>
          <NavLink to="/contact" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Contact
          </NavLink>
        </nav>

        <div className="nav-actions">
          {isStudent ? (
            <>
              <Link className="portal-pill-link" to="/student" title="Student Learning Dashboard">
                <LayoutDashboard size={14} />
                <span>Dashboard ({currentUser.displayName || currentUser.fullName.split(' ')[0]})</span>
              </Link>
              <button className="nav-logout-btn" onClick={handleLogout} title="Sign out of student portal">
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
        <div className="mobile-nav-drawer" role="dialog" aria-modal="true">
          <div className="mobile-nav-inner">
            <div className="mobile-nav-links">
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Home
              </NavLink>
              <NavLink to="/library" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Library Collection
              </NavLink>
              <NavLink to="/faculties" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Faculties & Departments
              </NavLink>
              <NavLink to="/courses" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Course Directory
              </NavLink>
              <NavLink to="/about" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                About FUW E-Library
              </NavLink>
              <NavLink to="/contact" className={({ isActive }) => (isActive ? 'mobile-link active' : 'mobile-link')}>
                Library Support Desk
              </NavLink>
            </div>

            {isStudent ? (
              <div className="mobile-nav-portals">
                <span className="mobile-portal-label">STUDENT DASHBOARD</span>
                <Link to="/student" className="mobile-portal-btn student">
                  <LayoutDashboard size={17} />
                  <span>Open Student Portal</span>
                </Link>
                <button className="mobile-auth-btn login" onClick={handleLogout} style={{ border: 0, width: '100%', cursor: 'pointer' }}>
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
