import { ChevronRight, Info } from "lucide-react";
import { useState } from "react";
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
import type { DiskMount } from "../../api";
import { formatBytes, HEALTH_COLOR, mountHealth } from "../../utils/storageHealth";

// ── Donut chart — storage by category ────────────────────────────────────────

interface CategoryDonutProps {
  categories: CategoryBucket[];
}

export function CategoryDonut({ categories }: CategoryDonutProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (categories.length === 0) {
    return (
      <>
        <CategoryInfoBanner />
        <EmptyChartState message="Run a Deep Scan to compute category breakdown" />
      </>
    );
  }

  const total = categories.reduce((s, c) => s + c.bytes, 0);

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <CategoryInfoBanner />
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

        {/* Legend — each row expandable to show composition paths */}
        <div className="min-w-0 flex-1">
          {categories.map((c) => {
            const pct = total > 0 ? ((c.bytes / total) * 100).toFixed(1) : "0";
            const isOpen = expanded.has(c.name);
            return (
              <div key={c.name} className="border-b border-border-subtle last:border-0">
                <button
                  onClick={() => {
                    toggle(c.name);
                  }}
                  className="flex w-full items-center gap-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                  title={`${c.entries.length.toString()} path(s) — click to ${isOpen ? "hide" : "show"}`}
                >
                  <ChevronRight
                    size={11}
                    strokeWidth={2.2}
                    className={`flex-shrink-0 text-text-faint transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
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
                </button>
                {isOpen && (
                  <ul
                    className="mb-1.5 ml-[26px] space-y-0.5 pl-3"
                    style={{ borderLeft: `2px solid ${c.color}55` }}
                  >
                    {c.entries.map((e) => (
                      <li
                        key={e.path}
                        className="flex items-center gap-3 py-0.5 font-mono text-[11px]"
                      >
                        <span className="truncate text-text-tertiary">{e.path}</span>
                        <span className="ml-auto flex-shrink-0 tabular-nums text-text-secondary">
                          {formatBytes(e.size_bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CategoryInfoBanner() {
  return (
    <div className="flex items-start gap-1.5 rounded-[8px] bg-surface-chip px-2.5 py-1.5 text-[11px] leading-relaxed text-text-tertiary">
      <Info size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-text-faint" />
      <span>
        Sizes are computed by running <span className="font-mono">du -s</span> on a hard-coded list
        of well-known paths (e.g. <span className="font-mono">/var/lib/docker</span>,{" "}
        <span className="font-mono">/var/log</span>). Only paths that exist on this server
        contribute. Click a category to see which paths make it up.
      </span>
    </div>
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
