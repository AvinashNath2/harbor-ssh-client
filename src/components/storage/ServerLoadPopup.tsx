import { Activity, X } from "lucide-react";
import { useMemo } from "react";
import type { ServerLoadSample } from "../../hooks/useServerLoad";

interface Props {
  latest: ServerLoadSample | null;
  history: ServerLoadSample[];
  stalled: boolean;
  onDismiss: () => void;
}

function fmtGb(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Load average → percentage of total CPU capacity. Load == cores means 100%. */
function loadPct(load: number, cores: number): number {
  if (cores === 0) return 0;
  return Math.min(100, Math.max(0, (load / cores) * 100));
}

function loadColor(pct: number): string {
  if (pct < 50) return "#177a4c"; // green
  if (pct < 85) return "#e0a53c"; // amber
  return "#b33c34"; // red
}

/** Tiny inline SVG sparkline. Renders `values` normalized 0..1. */
function Sparkline({
  values,
  color,
  height = 22,
  width = 90,
}: {
  values: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  const path = useMemo(() => {
    if (values.length === 0) return "";
    const max = Math.max(...values, 0.01);
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    return values
      .map((v, i) => {
        const x = i * step;
        const y = height - (v / max) * (height - 2) - 1;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values, height, width]);

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <path d={path} stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

export function ServerLoadPopup({ latest, history, stalled, onDismiss }: Props) {
  const cpuPct = latest ? loadPct(latest.loadOneM, latest.cpuCores) : 0;
  const memPct =
    latest && latest.memTotalBytes > 0 ? (latest.memUsedBytes / latest.memTotalBytes) * 100 : 0;

  const cpuSeries = history.map((s) => loadPct(s.loadOneM, s.cpuCores));
  const memSeries = history.map((s) =>
    s.memTotalBytes > 0 ? (s.memUsedBytes / s.memTotalBytes) * 100 : 0,
  );

  return (
    <div
      className="absolute bottom-4 right-4 z-50 w-[280px] rounded-modal border border-border-raised bg-surface-pane"
      style={{ boxShadow: "0 16px 40px -12px rgba(20,18,15,0.28)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-[11.5px] font-semibold text-text-primary">
          <Activity size={12} strokeWidth={2.2} className="text-accent-dark" />
          Server Load
          {stalled && (
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning"
              title="Waiting on SSH — scan is holding the connection"
            />
          )}
        </div>
        <button
          onClick={onDismiss}
          title="Hide"
          className="flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >
          <X size={11} strokeWidth={2.2} />
        </button>
      </div>

      {/* Body */}
      <div className="space-y-2.5 px-3 py-2.5">
        {/* CPU row */}
        <div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-tertiary">CPU load</span>
            <span className="font-mono font-semibold" style={{ color: loadColor(cpuPct) }}>
              {latest ? `${latest.loadOneM.toFixed(2)} / ${latest.cpuCores.toString()}` : "—"}
              <span className="ml-1 text-text-faint">({cpuPct.toFixed(0)}%)</span>
            </span>
          </div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-chip">
              <div
                className="h-full transition-all"
                style={{ width: `${cpuPct.toFixed(0)}%`, background: loadColor(cpuPct) }}
              />
            </div>
            <Sparkline values={cpuSeries} color={loadColor(cpuPct)} width={64} height={16} />
          </div>
        </div>

        {/* RAM row */}
        <div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-tertiary">RAM</span>
            <span className="font-mono font-semibold text-text-secondary">
              {latest ? `${fmtGb(latest.memUsedBytes)} / ${fmtGb(latest.memTotalBytes)}` : "—"}
              <span className="ml-1 text-text-faint">({memPct.toFixed(0)}%)</span>
            </span>
          </div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-chip">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${memPct.toFixed(0)}%` }}
              />
            </div>
            <Sparkline values={memSeries} color="#3f7be0" width={64} height={16} />
          </div>
        </div>

        {/* Caption */}
        <p className="border-t border-border pt-2 text-[10px] leading-relaxed text-text-faint">
          Scans run with idle CPU + I/O priority (<span className="font-mono">nice</span> +{" "}
          <span className="font-mono">ionice</span>) so they yield to your active workload.
        </p>
      </div>
    </div>
  );
}
