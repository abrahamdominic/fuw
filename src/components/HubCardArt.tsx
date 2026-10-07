import React from 'react';

/**
 * Distinct decorative artwork for the three Campus Hub service cards.
 *
 * The bands previously shared near-identical green gradients, which made the
 * cards hard to tell apart at a glance. Each service now has its own palette
 * plus a themed inline SVG motif: shelves for the E-Library, storefronts for
 * the Marketplace, and rooftops for Accommodation.
 *
 * Inline SVG is used deliberately so nothing new needs to be added to the
 * static asset pipeline or the Netlify deploy, and the artwork stays crisp at
 * any card width. It renders as an absolutely positioned background layer so
 * the existing badge, icon and label markup sits on top unchanged.
 */

export type HubMotif = 'library' | 'marketplace' | 'accommodation';

export const HUB_PALETTES: Record<
  HubMotif,
  { band: string; accent: string; glow: string }
> = {
  library: {
    band: 'linear-gradient(135deg, #0d3b66 0%, #12508c 55%, #1a6fb5 100%)',
    accent: '#7dd3fc',
    glow: 'rgba(125, 211, 252, 0.30)'
  },
  marketplace: {
    band: 'linear-gradient(135deg, #7a2e12 0%, #b45309 55%, #d97706 100%)',
    accent: '#fcd34d',
    glow: 'rgba(252, 211, 77, 0.28)'
  },
  accommodation: {
    band: 'linear-gradient(135deg, #3b0764 0%, #6b21a8 55%, #9333ea 100%)',
    accent: 'rgba(233, 213, 255, 0.85)',
    glow: 'rgba(233, 213, 255, 0.28)'
  }
};

/** Band background style for a hub service card. */
export function hubBandStyle(motif: HubMotif): React.CSSProperties {
  return { background: HUB_PALETTES[motif].band };
}

/**
 * Background artwork layer. Must be placed inside a `position: relative`
 * container that also holds the band's foreground content.
 */
export function HubMotifLayer({ motif }: { motif: HubMotif }) {
  const { accent, glow } = HUB_PALETTES[motif];

  const strokeProps = {
    fill: 'none',
    stroke: accent,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity: 0.6
  };

  return (
    <>
      <svg
        aria-hidden
        focusable="false"
        viewBox="0 0 200 100"
        preserveAspectRatio="xMidYMax slice"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      >
        {motif === 'library' && (
          <g {...strokeProps}>
            <line x1="14" y1="88" x2="186" y2="88" />
            <rect x="28" y="62" width="14" height="26" rx="2" />
            <rect x="46" y="54" width="12" height="34" rx="2" />
            <line x1="62" y1="56" x2="62" y2="88" />
            <rect x="68" y="66" width="16" height="22" rx="2" />
            <line x1="90" y1="70" x2="90" y2="88" />
            <path d="M104 88V46l22-12 22 12v42" />
            <line x1="104" y1="58" x2="148" y2="58" />
            <rect x="116" y="62" width="12" height="26" rx="2" />
            <rect x="132" y="58" width="14" height="30" rx="2" />
            <rect x="158" y="60" width="13" height="28" rx="2" />
            <line x1="175" y1="64" x2="175" y2="88" />
          </g>
        )}

        {motif === 'marketplace' && (
          <g {...strokeProps}>
            <path d="M18 44h164l-8 44H26z" />
            <path d="M28 44l9-17h126l9 17" />
            <rect x="58" y="58" width="26" height="30" rx="2" />
            <rect x="104" y="58" width="26" height="30" rx="2" />
            <line x1="40" y1="88" x2="40" y2="80" />
            <line x1="160" y1="88" x2="160" y2="80" />
            <circle cx="150" cy="26" r="7" />
            <path d="M150 12v7M150 33v7M136 26h7M157 26h7" />
          </g>
        )}

        {motif === 'accommodation' && (
          <g {...strokeProps}>
            <path d="M18 88V52l32-22 32 22v36" />
            <rect x="38" y="60" width="14" height="12" rx="2" />
            <rect x="60" y="60" width="14" height="12" rx="2" />
            <path d="M100 88V44l28-20 28 20v44" />
            <rect x="118" y="58" width="12" height="11" rx="2" />
            <rect x="140" y="58" width="12" height="11" rx="2" />
            <line x1="100" y1="72" x2="156" y2="72" />
            <path d="M168 88V66l14-10 14 10v22" />
          </g>
        )}
      </svg>

      {/* Soft accent glow so the flat gradient does not read as empty space. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: '-12%',
          top: '-50%',
          width: '64%',
          height: '130%',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${glow} 0%, rgba(255, 255, 255, 0) 70%)`,
          pointerEvents: 'none'
        }}
      />
    </>
  );
}