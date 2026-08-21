import React from 'react';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <img
      className="fuw-logo"
      src="/images/Fuw.png"
      alt="Federal University Wukari"
      style={{ width: size, height: size }}
      onError={(e) => {
        // Fallback to text initials if image path fails
        (e.target as HTMLElement).style.display = 'none';
      }}
    />
  );
}
