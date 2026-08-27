import React from 'react';
import { BarChart3 } from 'lucide-react';

export interface AnalyticsDatum {
  label: string;
  value: number;
  color?: string;
}

interface AnalyticsChartProps {
  title: string;
  description: string;
  items: AnalyticsDatum[];
  loading?: boolean;
  horizontal?: boolean;
  emptyText?: string;
  valueLabel?: string;
}

/**
 * Reusable analytics bar chart card. Renders real aggregate counts with
 * labels, values, native-tooltip detail (hover), loading skeletons and an
 * empty state. Uses `horizontal` mode for long label sets (faculties /
 * departments) and vertical bars for a small number of categories (gender).
 */
export function AnalyticsChart({
  title,
  description,
  items,
  loading = false,
  horizontal = false,
  emptyText = 'No data recorded yet.',
  valueLabel = 'records'
}: AnalyticsChartProps) {
  const filtered = items.filter((d) => d.value > 0);
  const max = Math.max(1, ...filtered.map((d) => d.value));
  const total = filtered.reduce((sum, d) => sum + d.value, 0);

  const barStyle = (color?: string): React.CSSProperties =>
    color
      ? { background: color }
      : horizontal
        ? { background: 'linear-gradient(90deg, #46cf7f 0%, #12603d 100%)' }
        : { background: 'linear-gradient(180deg, #46cf7f 0%, #12603d 100%)' };

  return (
    <div className="analytics-card">
      <div className="analytics-card-head">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      {loading ? (
        <div className={`analytics-skeleton ${horizontal ? 'h-mode' : 'v-mode'}`} aria-hidden="true">
          {Array.from({ length: horizontal ? 5 : 2 }).map((_, i) => (
            <i key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 12px' }}>
          <BarChart3 size={28} />
          <b>{emptyText}</b>
          <span>Live data appears here automatically as it is recorded.</span>
        </div>
      ) : horizontal ? (
        <div className="hchart" role="img" aria-label={`${title} — ${total.toLocaleString()} ${valueLabel} total`}>
          {filtered.map((d) => (
            <div className="hbar" key={d.label} title={`${d.label}: ${d.value.toLocaleString()} ${valueLabel}`}>
              <span className="hbar-label">{d.label}</span>
              <div className="hbar-track">
                <i style={{ ...barStyle(d.color), width: `${Math.max(2, Math.round((d.value / max) * 100))}%` }} />
              </div>
              <span className="hbar-count">{d.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="vchart" role="img" aria-label={`${title} — ${total.toLocaleString()} ${valueLabel} total`}>
          {filtered.map((d) => (
            <div className="vbar" key={d.label} title={`${d.label}: ${d.value.toLocaleString()} ${valueLabel}`}>
              <span className="vbar-count">{d.value.toLocaleString()}</span>
              <i style={{ ...barStyle(d.color), height: `${Math.max(2, Math.round((d.value / max) * 100))}%` }} />
              <b>{d.label}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}