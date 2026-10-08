import React from 'react';
import { ShieldCheck, Award, Sparkles, Store, BadgeCheck } from 'lucide-react';

export interface VerifiedScholarBadgeProps {
  isVerified?: boolean;
  isPremium?: boolean;
  hasGoldenBadge?: boolean;
  isVerifiedVendor?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showScholar?: boolean;
  showPremium?: boolean;
  showGolden?: boolean;
  showVendor?: boolean;
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
 * 3. "Golden Honor" is displayed when `hasGoldenBadge === true` (granted by admin).
 * 4. "Verified Vendor" is displayed when `isVerifiedVendor === true`.
 * 5. Badges display cleanly side-by-side.
 */
export const VerifiedScholarBadge: React.FC<VerifiedScholarBadgeProps> = ({
  isVerified = false,
  isPremium = false,
  hasGoldenBadge = false,
  isVerifiedVendor = false,
  size = 'sm',
  showScholar = true,
  showPremium = true,
  showGolden = true,
  showVendor = true,
  className = '',
  style = {},
}) => {
  if (!isVerified && !isPremium && !hasGoldenBadge && !isVerifiedVendor) return null;

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

      {/* 3. Golden Honor Badge (granted by library administration) */}
      {hasGoldenBadge && showGolden && (
        <span
          className="badge-golden-honor"
          title="Golden Honor Scholar (Honored by University Administration)"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: paddings[size],
            fontSize: fontSizes[size],
            fontWeight: 800,
            borderRadius: 999,
            background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
            color: '#78350f',
            border: '1px solid #d97706',
            boxShadow: '0 1px 3px rgba(217, 119, 6, 0.25)',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <Award size={iconSizes[size]} color="#78350f" />
          <span>Golden Honor</span>
        </span>
      )}

      {/* 4. Verified Campus Vendor Badge */}
      {isVerifiedVendor && showVendor && (
        <span
          className="badge-verified-vendor"
          title="Verified Campus Vendor"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: paddings[size],
            fontSize: fontSizes[size],
            fontWeight: 700,
            borderRadius: 999,
            background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
            color: '#0369a1',
            border: '1px solid #7dd3fc',
            boxShadow: '0 1px 2px rgba(3, 105, 161, 0.08)',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <BadgeCheck size={iconSizes[size]} color="#0284c7" />
          <span>Verified Vendor</span>
        </span>
      )}
    </div>
  );
};

export default VerifiedScholarBadge;
