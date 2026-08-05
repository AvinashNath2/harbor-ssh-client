import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoryBucket } from "../../utils/storageCategories";
import type { DiskMount, FolderSize } from "../../api";
import { formatBytes, HEALTH_COLOR, mountHealth } from "../../utils/storageHealth";

// ── Donut chart — storage by category ────────────────────────────────────────

interface CategoryDonutProps {
  categories: CategoryBucket[];
}

export function CategoryDonut({ categories }: CategoryDonutProps) {
  if (categories.length === 0) {
    return <EmptyChartState message="Run a Deep Scan to compute category breakdown" />;
  }

  const total = categories.reduce((s, c) => s + c.bytes, 0);

  return (
    <div className="flex items-center gap-6">
      <div className="h-48 w-48 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={categories}
              dataKey="bytes"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              strokeWidth={0}
            >
              {categories.map((c) => (
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                <Cell key={c.name} fill={c.color} fillOpacity={0.85} />
              ))}
            </Pie>
            <Tooltip
              content={({ payload }) => {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                const entry = payload?.[0]?.payload as CategoryBucket | undefined;
                if (!entry) return null;
                const pct = total > 0 ? ((entry.bytes / total) * 100).toFixed(1) : "0";
                return (
                  <div className="rounded-lg border border-border-raised bg-surface-pane px-3 py-2 text-[12px] shadow-modal">
                    <p className="font-semibold text-text-primary">{entry.name}</p>
                    <p className="text-text-secondary">
                      {formatBytes(entry.bytes)} · {pct}%
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5">
        {categories.map((c) => {
          const pct = total > 0 ? ((c.bytes / total) * 100).toFixed(1) : "0";
          return (
            <div key={c.name} className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                style={{ background: c.color }}
              />
              <span className="text-[12px] text-text-secondary">{c.name}</span>
              <span className="ml-auto pl-4 text-[12px] font-medium tabular-nums text-text-primary">
                {formatBytes(c.bytes)}
              </span>
              <span className="w-9 text-right text-[11px] tabular-nums text-text-faint">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Horizontal bar — top 20 folders ──────────────────────────────────────────

interface TopFoldersBarProps {
  folders: FolderSize[];
  totalBytes: number;
}

export function TopFoldersBar({ folders, totalBytes }: TopFoldersBarProps) {
  if (folders.length === 0) {
    return <EmptyChartState message="Run a Deep Scan to see folder breakdown" />;
  }

  const top = folders.slice(0, 20).map((f) => ({
    name: f.path.split("/").filter(Boolean).pop() ?? f.path,
    fullPath: f.path,
    value: f.size_bytes,
    pct: totalBytes > 0 ? (f.size_bytes / totalBytes) * 100 : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.min(top.length * 28 + 16, 400)}>
      <BarChart
        data={top}
        layout="vertical"
        margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
        barSize={14}
      >
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatBytes(v)}
          tick={{ fill: "#9c9790", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={100}
          tick={{ fill: "#b8b4ae", fontSize: 11, fontFamily: "monospace" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          content={({ payload }) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            const d = payload?.[0]?.payload as (typeof top)[number] | undefined;
            if (!d) return null;
            return (
              <div className="rounded-lg border border-border-raised bg-surface-pane px-3 py-2 text-[12px] shadow-modal">
                <p className="font-mono font-semibold text-text-primary">{d.fullPath}</p>
                <p className="text-text-secondary">
                  {formatBytes(d.value)} · {d.pct.toFixed(1)}% of disk
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {top.map((d) => (
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            <Cell
              key={d.fullPath}
              fill={
                d.pct > 40
                  ? HEALTH_COLOR.crit
                  : d.pct > 15
                    ? HEALTH_COLOR.danger
                    : d.pct > 5
                      ? HEALTH_COLOR.warn
                      : "#3f7be0"
              }
              fillOpacity={0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Stacked bar — usage per partition ────────────────────────────────────────

interface PartitionsBarProps {
  mounts: DiskMount[];
}

export function PartitionsBar({ mounts }: PartitionsBarProps) {
  if (mounts.length === 0) {
    return <EmptyChartState message="No mount data available" />;
  }

  const data = mounts.map((m) => ({
    name: m.mount,
    used: m.used,
    free: m.avail,
    tier: mountHealth(m.use_pct),
    usedLabel: formatBytes(m.used),
    freeLabel: formatBytes(m.avail),
    total: formatBytes(m.total),
    pct: m.use_pct,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.min(data.length * 36 + 16, 320)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 80, left: 0, bottom: 0 }}
        barSize={18}
      >
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatBytes(v)}
          tick={{ fill: "#9c9790", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={80}
          tick={{ fill: "#b8b4ae", fontSize: 11, fontFamily: "monospace" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          content={({ payload }) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            const d = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!d) return null;
            return (
              <div className="rounded-lg border border-border-raised bg-surface-pane px-3 py-2 text-[12px] shadow-modal">
                <p className="font-mono font-semibold text-text-primary">{d.name}</p>
                <p className="text-text-secondary">
                  Used: {d.usedLabel} · Free: {d.freeLabel} · Total: {d.total}
                </p>
                <p style={{ color: HEALTH_COLOR[d.tier] }} className="font-semibold">
                  {d.pct.toFixed(1)}% full
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="used" stackId="a" radius={[0, 0, 0, 0]}>
          {data.map((d) => (
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            <Cell key={d.name + "-used"} fill={HEALTH_COLOR[d.tier]} fillOpacity={0.8} />
          ))}
        </Bar>
        <Bar dataKey="free" stackId="a" radius={[0, 4, 4, 0]}>
          {data.map((d) => (
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            <Cell key={d.name + "-free"} fill="#e8e4dc" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Shared empty state ────────────────────────────────────────────────────────

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-24 items-center justify-center text-[12px] text-text-faint">
      {message}
    </div>
  );
}
