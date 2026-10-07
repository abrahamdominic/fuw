import React from 'react';
import { PackageOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        background: 'var(--card-bg, #ffffff)',
        borderRadius: 14,
        border: '1px dashed var(--border, #dcebe0)',
        margin: '20px 0',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--green-100, #e8f5ec)',
          color: 'var(--green-800, #12603d)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        {icon || <PackageOpen size={28} />}
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--text-primary, #17231d)' }}>
        {title}
      </h3>
      {description && (
        <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-secondary, #55675b)', maxWidth: 440, lineHeight: 1.5 }}>
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};
