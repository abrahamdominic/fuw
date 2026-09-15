import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, ChevronRight } from 'lucide-react';
import { MaterialItem } from '../lib/store';
import { useStore } from '../lib/useStore';
import { MaterialCard } from './MaterialCard';

interface TrendingMaterialsProps {
  onReadOnline: (material: MaterialItem) => void;
  onAskAi?: (material: MaterialItem) => void;
}

/** "Trending now" — the most-downloaded approved materials in the library. */
export function TrendingMaterialsSection({ onReadOnline, onAskAi }: TrendingMaterialsProps) {
  const store = useStore();

  const trending = useMemo(() => {
    return store
      .getApprovedMaterials()
      .slice()
      .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
      .slice(0, 6);
  }, [store]);

  if (trending.length === 0) return null;

  return (
    <section className="suggested-section" aria-label="Trending materials">
      <div className="section-head">
        <div>
          <p className="kicker">MOST DOWNLOADED THIS WEEK</p>
          <h2>Trending now</h2>
        </div>
        <Link to="/library">
          Browse library <ChevronRight size={16} />
        </Link>
      </div>
      <div className="suggested-grid">
        {trending.map((m) => (
          <MaterialCard key={m.id} material={m} onReadOnline={onReadOnline} onAskAi={onAskAi} />
        ))}
      </div>
      <small className="trending-note">
        <TrendingUp size={12} /> Ranked by student downloads across the e-library.
      </small>
    </section>
  );
}