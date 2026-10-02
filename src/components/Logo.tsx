import React, { useState } from 'react';

export function Logo({ size = 34 }: { size?: number }) {
  // WebP first (smallest), with a genuine PNG fallback so the mark still
  // renders if the modern format is ever unavailable.
  const [src, setSrc] = useState('/images/fuw-logo.webp');

  return (
    <img
      className="fuw-logo"
      src={src}
      width={size}
      height={size}
      alt="Federal University Wukari"
      style={{ width: size, height: size }}
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src.endsWith('.webp')) {
          setSrc('/images/fuw-logo.png');
        } else {
          // Fallback to text initials if image path fails
          el.style.display = 'none';
        }
      }}
    />
  );
}