import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Compass,
  BookOpen,
  ShoppingBag,
  Home,
  GraduationCap,
  ChevronDown,
  Layers
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export interface EcosystemPillar {
  id: string;
  name: string;
  shortName: string;
  path: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  description: string;
  color: string;
  bgColor: string;
  badge?: string;
}

export const ECOSYSTEM_PILLARS: EcosystemPillar[] = [
  {
    id: 'hub',
    name: 'Campus Hub',
    shortName: 'Hub',
    path: '/hub',
    icon: Compass,
    description: 'Central campus gateway & news',
    color: '#12603d',
    bgColor: '#e7f5eb'
  },
  {
    id: 'library',
    name: 'E-Library',
    shortName: 'Library',
    path: '/library',
    icon: BookOpen,
    description: 'Academic notes & past questions',
    color: '#0284c7',
    bgColor: '#e0f2fe'
  },
  {
    id: 'marketplace',
    name: 'Marketplace',
    shortName: 'Market',
    path: '/marketplace',
    icon: ShoppingBag,
    description: 'Campus commerce & escrow buying',
    color: '#d97706',
    bgColor: '#fef3c7'
  },
  {
    id: 'accommodation',
    name: 'Accommodation',
    shortName: 'Lodges',
    path: '/accommodation',
    icon: Home,
    description: 'Verified off-campus student lodges',
    color: '#8b5cf6',
    bgColor: '#f3e8ff'
  }
];

interface EcosystemSwitcherProps {
  mode?: 'dropdown' | 'bar' | 'mobile-drawer';
  className?: string;
  onSelect?: () => void;
}

export const EcosystemSwitcher: React.FC<EcosystemSwitcherProps> = ({
  mode = 'dropdown',
  className = '',
  onSelect
}) => {
  const location = useLocation();
  const { isAuthenticated, role } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentPath = location.pathname;

  const currentPillar = ECOSYSTEM_PILLARS.find((p) => {
    if (p.id === 'hub' && (currentPath === '/hub' || currentPath === '/')) return true;
    if (p.id === 'library' && currentPath.startsWith('/library')) return true;
    if (p.id === 'marketplace' && currentPath.startsWith('/marketplace')) return true;
    if (p.id === 'accommodation' && (currentPath.startsWith('/accommodation') || currentPath.startsWith('/roommates'))) return true;
    return false;
  }) || ECOSYSTEM_PILLARS[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Handle mobile drawer or compact quick-strip mode
  if (mode === 'bar') {
    return (
      <div
        className={`ecosystem-quick-bar ${className}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
          padding: '8px',
          background: 'var(--surface-alt, #f4f8f5)',
          borderRadius: 12,
          border: '1px solid var(--border, #dcebe0)'
        }}
      >
        {ECOSYSTEM_PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          const isActive = currentPillar.id === pillar.id;
          return (
            <Link
              key={pillar.id}
              to={pillar.path}
              onClick={onSelect}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '6px 4px',
                borderRadius: 8,
                textDecoration: 'none',
                background: isActive ? '#ffffff' : 'transparent',
                boxShadow: isActive ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                border: isActive ? `1px solid ${pillar.color}` : '1px solid transparent',
                transition: 'all 0.15s ease'
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isActive ? pillar.bgColor : 'transparent',
                  color: pillar.color
                }}
              >
                <Icon size={16} />
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? 'var(--text-primary, #17231d)' : 'var(--text-secondary, #55675b)',
                  whiteSpace: 'nowrap'
                }}
              >
                {pillar.shortName}
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  // Mobile drawer full navigation list
  if (mode === 'mobile-drawer') {
    return (
      <div className={`ecosystem-mobile-list ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #55675b)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
          FUW Ecosystem Hub
        </div>
        {ECOSYSTEM_PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          const isActive = currentPillar.id === pillar.id;
          return (
            <Link
              key={pillar.id}
              to={pillar.path}
              onClick={onSelect}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                textDecoration: 'none',
                background: isActive ? pillar.bgColor : 'transparent',
                border: isActive ? `1px solid ${pillar.color}40` : '1px solid transparent',
                transition: 'background 0.15s ease'
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: pillar.bgColor,
                  color: pillar.color,
                  flexShrink: 0
                }}
              >
                <Icon size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
                  {pillar.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pillar.description}
                </div>
              </div>
              {isActive && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: pillar.color,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: '#ffffff'
                  }}
                >
                  Active
                </span>
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  // Default: Dropdown popover button
  return (
    <div ref={containerRef} className={`ecosystem-switcher-container ${className}`} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border, #dcebe0)',
          background: 'var(--surface-alt, #f4f8f5)',
          color: 'var(--text-primary, #17231d)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease'
        }}
        aria-label="Switch FUW Ecosystem Service"
        aria-expanded={open}
      >
        <Layers size={15} style={{ color: currentPillar.color }} />
        <span>{currentPillar.shortName}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-secondary, #55675b)' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 280,
            background: 'var(--surface, #ffffff)',
            borderRadius: 14,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.15)',
            border: '1px solid var(--border, #dcebe0)',
            padding: 10,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}
        >
          <div style={{ padding: '6px 8px 8px', borderBottom: '1px solid var(--border, #edf4f0)', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #55675b)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              FUW Campus Ecosystem
            </span>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#7a9685' }}>
              Jump quickly to any university pillar
            </p>
          </div>

          {ECOSYSTEM_PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            const isActive = currentPillar.id === pillar.id;
            return (
              <Link
                key={pillar.id}
                to={pillar.path}
                onClick={() => {
                  setOpen(false);
                  onSelect?.();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  background: isActive ? pillar.bgColor : 'transparent',
                  transition: 'background 0.12s ease'
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: pillar.bgColor,
                    color: pillar.color,
                    flexShrink: 0
                  }}
                >
                  <Icon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
                    {pillar.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary, #55675b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pillar.description}
                  </div>
                </div>
                {isActive && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: pillar.color,
                      padding: '2px 5px',
                      borderRadius: 4,
                      background: '#ffffff'
                    }}
                  >
                    Active
                  </span>
                )}
              </Link>
            );
          })}

          {isAuthenticated && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border, #edf4f0)' }}>
              <Link
                to={role === 'lecturer' ? '/lecturer' : role === 'admin' || role === 'super_admin' ? '/admin' : '/student'}
                onClick={() => {
                  setOpen(false);
                  onSelect?.();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: 'var(--green-900, #0d4a2f)',
                  background: '#f4fbf6',
                  fontSize: 12,
                  fontWeight: 700
                }}
              >
                <GraduationCap size={15} />
                <span>
                  Go to {role === 'lecturer' ? 'Lecturer Portal' : role === 'admin' || role === 'super_admin' ? 'Admin Portal' : 'Student Dashboard'}
                </span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
