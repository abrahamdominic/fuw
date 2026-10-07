import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
}) => {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    neutral: { bg: 'var(--surface-alt, #f4f8f5)', color: 'var(--text-secondary, #55675b)', border: 'var(--line, #dcebe0)' },
    success: { bg: 'var(--success-bg, #d1fae5)', color: '#065f46', border: '#a7f3d0' },
    warning: { bg: 'var(--warning-bg, #fef3c7)', color: '#92400e', border: '#fde68a' },
    error: { bg: 'var(--error-bg, #fee2e2)', color: '#991b1b', border: '#fca5a5' },
    info: { bg: 'var(--info-bg, #e0f2fe)', color: '#075985', border: '#bae6fd' },
  };

  const current = styles[variant] || styles.neutral;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: size === 'sm' ? '2px 8px' : '4px 10px',
        borderRadius: 999,
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 600,
        background: current.bg,
        color: current.color,
        border: `1px solid ${current.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};
