import { Activity } from "lucide-react";
import { useMemo } from "react";
import type { ServerLoadSample } from "../../hooks/useServerLoad";

interface Props {
  latest: ServerLoadSample | null;
  history: ServerLoadSample[];
  stalled: boolean;
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

/** Tiny inline SVG sparkline. Renders `values` as a line 0..max. */
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

/**
 * Compact server-load box designed to live in the Data Profiler's left sidebar.
 * Always visible (no dismiss); polls whenever the Data Profiler window is open.
 */
export function ServerLoadPopup({ latest, history, stalled }: Props) {
  const cpuPct = latest ? loadPct(latest.loadOneM, latest.cpuCores) : 0;
  const memPct =
    latest && latest.memTotalBytes > 0 ? (latest.memUsedBytes / latest.memTotalBytes) * 100 : 0;

  const cpuSeries = history.map((s) => loadPct(s.loadOneM, s.cpuCores));
  const memSeries = history.map((s) =>
    s.memTotalBytes > 0 ? (s.memUsedBytes / s.memTotalBytes) * 100 : 0,
  );

  return (
    <div className="mx-2 mt-auto rounded-lg border border-border bg-surface-pane">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <Activity size={10} strokeWidth={2.4} className="text-accent-dark" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">
          Server Load
        </span>
        {stalled && (
          <span
            className="ml-auto inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning"
            title="Waiting on SSH — a scan is holding the connection"
          />
        )}
      </div>

      {/* Body */}
      <div className="space-y-2 px-2.5 py-2">
        {/* CPU */}
        <div>
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-text-tertiary">CPU</span>
            <span className="font-mono font-semibold" style={{ color: loadColor(cpuPct) }}>
              {cpuPct.toFixed(0)}%
            </span>
          </div>
          <div className="mt-0.5 flex items-end gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-chip">
              <div
                className="h-full transition-all"
                style={{ width: `${cpuPct.toFixed(0)}%`, background: loadColor(cpuPct) }}
              />
            </div>
            <Sparkline values={cpuSeries} color={loadColor(cpuPct)} width={40} height={12} />
          </div>
          <div className="mt-0.5 font-mono text-[9.5px] text-text-faint">
            {latest ? `load ${latest.loadOneM.toFixed(2)} / ${latest.cpuCores.toString()}` : "—"}
          </div>
        </div>

        {/* RAM */}
        <div>
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-text-tertiary">RAM</span>
            <span className="font-mono font-semibold text-text-secondary">
              {memPct.toFixed(0)}%
            </span>
          </div>
          <div className="mt-0.5 flex items-end gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-chip">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${memPct.toFixed(0)}%` }}
              />
            </div>
            <Sparkline values={memSeries} color="#3f7be0" width={40} height={12} />
          </div>
          <div className="mt-0.5 font-mono text-[9.5px] text-text-faint">
            {latest ? `${fmtGb(latest.memUsedBytes)} / ${fmtGb(latest.memTotalBytes)}` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
