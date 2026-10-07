import { useState } from 'react';

export function Logo({ size = 36 }: { size?: number }) {
  const [src, setSrc] = useState('/images/fuw-logo.webp');

  return (
    <img
      className="fuw-logo"
      src={src}
      width={size}
      height={size}
      alt="Federal University Wukari"
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        borderRadius: 8,
        display: 'block'
      }}
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src.endsWith('.webp')) {
          setSrc('/images/fuw-logo.png');
        } else {
          el.style.display = 'none';
        }
      }}
    />
  );
}
