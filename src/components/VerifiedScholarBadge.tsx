import React from 'react';
import { ShieldCheck, Award, Sparkles } from 'lucide-react';

export interface VerifiedScholarBadgeProps {
  isVerified?: boolean;
  isPremium?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showScholar?: boolean;
  showPremium?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * VerifiedScholarBadge Component
 * 
 * Rules:
 * 1. "Verified Scholar" represents verified academic student identity/matriculation.
 *    It is ONLY shown when `isVerified === true`. Paying for Premium NEVER grants this badge.
 * 2. "Premium Member" is displayed when `isPremium === true`.
 * 3. Verified + Premium members display both badges cleanly side-by-side.
 */
export const VerifiedScholarBadge: React.FC<VerifiedScholarBadgeProps> = ({
  isVerified = false,
  isPremium = false,
  size = 'sm',
  showScholar = true,
  showPremium = true,
  className = '',
  style = {},
}) => {
  if (!isVerified && !isPremium) return null;

  const fontSizes = { sm: 11, md: 12, lg: 13 };
  const iconSizes = { sm: 13, md: 15, lg: 17 };
  const paddings = { sm: '2px 8px', md: '4px 10px', lg: '6px 12px' };

  return (
    <div
      className={`verified-scholar-badges ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        ...style,
      }}
    >
      {/* 1. Verified Scholar Badge (identity/matriculation verified) */}
      {isVerified && showScholar && (
        <span
          className="badge-verified-scholar"
          title="Verified Student Identity (Officially Verified Scholar)"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: paddings[size],
            fontSize: fontSizes[size],
            fontWeight: 700,
            borderRadius: 999,
            background: 'linear-gradient(135deg, #e8f5ec 0%, #d1fae5 100%)',
            color: '#065f46',
            border: '1px solid #a7f3d0',
            boxShadow: '0 1px 2px rgba(6, 95, 70, 0.08)',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <ShieldCheck size={iconSizes[size]} color="#059669" />
          <span>Verified Scholar</span>
        </span>
      )}

      {/* 2. Premium Member Badge (paid subscription active) */}
      {isPremium && showPremium && (
        <span
          className="badge-premium-member"
          title="Active Campus Hub Plus / Premium Member"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: paddings[size],
            fontSize: fontSizes[size],
            fontWeight: 700,
            borderRadius: 999,
            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
            color: '#92400e',
            border: '1px solid #fcd34d',
            boxShadow: '0 1px 2px rgba(146, 64, 14, 0.08)',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <Sparkles size={iconSizes[size]} color="#b45309" />
          <span>Premium Member</span>
        </span>
      )}
    </div>
  );
};

export default VerifiedScholarBadge;
