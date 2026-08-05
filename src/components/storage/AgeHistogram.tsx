import type { AgeHistogram } from "../../api";
import { formatBytes } from "../../utils/storageHealth";

interface AgeHistogramProps {
  data: AgeHistogram;
}

const BUCKETS: { key: keyof AgeHistogram; label: string; color: string }[] = [
  { key: "last_24h_bytes", label: "Last 24 h", color: "#3b82f6" },
  { key: "last_7d_bytes", label: "Last 7 d", color: "#8b5cf6" },
  { key: "last_30d_bytes", label: "Last 30 d", color: "#6366f1" },
  { key: "last_90d_bytes", label: "Last 90 d", color: "#f59e0b" },
  { key: "older_bytes", label: "> 90 d", color: "#6b7280" },
];

export function AgeHistogramBar({ data }: AgeHistogramProps) {
  const total =
    data.last_24h_bytes +
    data.last_7d_bytes +
    data.last_30d_bytes +
    data.last_90d_bytes +
    data.older_bytes;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-[12px] text-text-faint">
        No file-age data yet — run a Deep Scan to populate
      </div>
    );
  }

  const buckets = BUCKETS.map((b) => ({
    ...b,
    bytes: data[b.key],
    pct: total > 0 ? (data[b.key] / total) * 100 : 0,
  }));

  return (
    <div className="flex flex-col gap-3">
      {/* Stacked bar */}
      <div className="flex h-6 w-full overflow-hidden rounded-lg">
        {buckets.map((b) =>
          b.pct > 0 ? (
            <div
              key={b.key}
              style={{ width: `${b.pct.toFixed(2)}%`, background: b.color }}
              title={`${b.label}: ${formatBytes(b.bytes)} (${b.pct.toFixed(1)}%)`}
            />
          ) : null,
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {buckets.map((b) => (
          <div key={b.key} className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: b.color }} />
            <span className="text-[11.5px] text-text-secondary">{b.label}</span>
            <span className="text-[11.5px] font-medium text-text-primary">
              {formatBytes(b.bytes)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-text-faint">
        {data.total_files.toLocaleString()} files sampled (capped at 200 k)
      </p>
    </div>
  );
}
