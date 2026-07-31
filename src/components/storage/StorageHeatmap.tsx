import { Treemap, ResponsiveContainer } from "recharts";
import type { TreemapNode } from "recharts";
import { useState } from "react";
import type { FolderSize } from "../../api";
import { formatBytes, HEALTH_COLOR } from "../../utils/storageHealth";

interface StorageHeatmapProps {
  folders: FolderSize[];
  totalBytes: number;
  onBrowse?: (path: string) => void;
}

interface HoverInfo {
  path: string;
  size: number;
  pct: number;
  x: number;
  y: number;
}

export function StorageHeatmap({ folders, totalBytes, onBrowse }: StorageHeatmapProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  if (folders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="text-[13px] text-text-secondary">No folder data yet</p>
        <p className="text-[11.5px] text-text-faint">
          Run a <span className="font-semibold text-text-accent">Deep Scan</span> to populate the
          treemap
        </p>
      </div>
    );
  }

  // recharts Treemap needs `name` and `value` keys
  const data = folders
    .filter((f) => f.size_bytes > 0)
    .map((f) => ({
      name: f.path.split("/").filter(Boolean).pop() ?? f.path,
      fullPath: f.path,
      value: f.size_bytes,
    }));

  function getColor(value: number): string {
    const pct = totalBytes > 0 ? (value / totalBytes) * 100 : 0;
    // Re-map folder share % to health tier: >40% → crit, 15-40% → danger, 5-15% → warn, else ok
    if (pct > 40) return HEALTH_COLOR.crit;
    if (pct > 15) return HEALTH_COLOR.danger;
    if (pct > 5) return HEALTH_COLOR.warn;
    return "#3f7be0";
  }

  // Custom cell renderer — must return SVG elements
  function CustomCell(props: TreemapNode) {
    const { x, y, width, height } = props;
    const fullPath = props.fullPath as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const name = props.name ?? "";
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const value = props.value ?? 0;
    const pct = totalBytes > 0 ? (value / totalBytes) * 100 : 0;
    const fill = getColor(value);
    const showLabel = width > 60 && height > 30;
    const showSubLabel = width > 80 && height > 50;

    return (
      <g
        onMouseEnter={(e) => {
          setHover({
            path: fullPath ?? name,
            size: value,
            pct,
            x: e.clientX,
            y: e.clientY,
          });
        }}
        onMouseLeave={() => { setHover(null); }}
        onClick={() => {
          if (onBrowse && fullPath) onBrowse(fullPath);
        }}
        style={{ cursor: onBrowse ? "pointer" : "default" }}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          style={{
            fill,
            fillOpacity: 0.75,
            stroke: "rgba(0,0,0,0.06)",
            strokeWidth: 1,
          }}
        />
        {showLabel && (
          <text
            x={x + width / 2}
            y={y + height / 2 - (showSubLabel ? 8 : 0)}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fill: "rgba(42,39,32,0.9)",
              fontSize: Math.min(14, width / 6),
              fontWeight: 600,
              fontFamily: "monospace",
              pointerEvents: "none",
            }}
          >
            {name.length > Math.floor(width / 9) ? name.slice(0, Math.floor(width / 9)) + "…" : name}
          </text>
        )}
        {showSubLabel && (
          <text
            x={x + width / 2}
            y={y + height / 2 + 14}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fill: "rgba(107,103,96,0.9)",
              fontSize: Math.min(11, width / 8),
              fontFamily: "monospace",
              pointerEvents: "none",
            }}
          >
            {formatBytes(value)}
          </text>
        )}
      </g>
    );
  }

  const treemapContent = CustomCell as unknown as (props: TreemapNode) => React.ReactElement;

  return (
    <div className="relative flex flex-col gap-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-[11.5px] text-text-faint">
        {(["ok", "warn", "danger", "crit"] as const).map((tier) => (
          <div key={tier} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
              style={{
                background: tier === "ok" ? "#3f7be0" : HEALTH_COLOR[tier],
              }}
            />
            <span>
              {tier === "ok" ? "<5%" : tier === "warn" ? "5–15%" : tier === "danger" ? "15–40%" : ">40%"}{" "}
              of disk
            </span>
          </div>
        ))}
        <span className="ml-auto">Click a cell to browse that folder</span>
      </div>

      {/* Treemap */}
      <div className="rounded-xl border border-border-raised overflow-hidden" style={{ height: 480 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="value"
            nameKey="name"
            nodeGap={2}
            content={treemapContent}
            isAnimationActive={false}
          />
        </ResponsiveContainer>
      </div>

      {/* Hover tooltip — rendered in page coordinates */}
      {hover && (
        <div
          className="pointer-events-none fixed z-[70] rounded-lg border border-border-raised bg-surface-pane px-3 py-2 shadow-modal text-[12px]"
          style={{ left: hover.x + 12, top: hover.y - 40 }}
        >
          <p className="font-mono font-semibold text-text-primary">{hover.path}</p>
          <p className="text-text-secondary">
            {formatBytes(hover.size)} — {hover.pct.toFixed(1)}% of disk
          </p>
          {onBrowse && (
            <p className="mt-0.5 text-[10.5px] text-text-accent">Click to browse</p>
          )}
        </div>
      )}
    </div>
  );
}
