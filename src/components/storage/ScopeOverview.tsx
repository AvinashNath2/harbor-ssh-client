import { Activity, Check, Copy, Database, HardDrive, Info, RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";
import type { AgeHistogram, DiskMount, FolderSize } from "../../api";
import { formatBytes, HEALTH_COLOR, mountHealth } from "../../utils/storageHealth";
import { KpiCard } from "./KpiCard";

/**
 * Scope-aware overview panel at the top of the Data Profiler dashboard.
 *
 * Two rendering modes decided by `scannedRoot`:
 *   - Whole machine (null / "/"): global `df` KPIs, same as before scoped scans existed.
 *   - Directory scan: KPIs derived from that directory's scan output only. A prominent
 *     path chip + amber callout make the scope unmistakable so users don't read
 *     "42 GB used" as machine-wide.
 *
 * Portable: takes plain props, no hook coupling, no side effects. Same component
 * renders for both modes so the container has one visual identity.
 */

export interface ScopeOverviewProps {
  scannedRoot: string | null;
  mounts: DiskMount[];
  ageHistogram: AgeHistogram | null;
  rootFolders: FolderSize[];
  lastDeepScan: number | null;
  loading: boolean;
}

export function ScopeOverview(props: ScopeOverviewProps) {
  const { scannedRoot } = props;
  if (scannedRoot !== null && scannedRoot !== "/") {
    return <ScopedMode {...props} scannedRoot={scannedRoot} />;
  }
  return <WholeMachineMode {...props} />;
}

// ── Whole-machine mode ───────────────────────────────────────────────────────

function WholeMachineMode({ mounts, ageHistogram, loading }: ScopeOverviewProps) {
  const totalBytes = mounts.reduce((s, m) => s + m.total, 0);
  const usedBytes = mounts.reduce((s, m) => s + m.used, 0);
  const freeBytes = mounts.reduce((s, m) => s + m.avail, 0);
  const usePct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const tierColor = HEALTH_COLOR[mountHealth(usePct)];
  const totalFileCount = ageHistogram?.total_files ?? null;

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Disk Overview
        </h2>
        <span className="text-[11px] text-text-tertiary">· Whole machine</span>
      </div>

      {loading && mounts.length === 0 ? (
        <div className="flex items-center gap-2 text-[12px] text-text-faint">
          <RefreshCw size={12} className="animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 xl:grid-cols-5">
          <KpiCard label="Total Disk" value={formatBytes(totalBytes)} icon={<HardDrive size={14} />} />
          <KpiCard label="Used" value={formatBytes(usedBytes)} color={tierColor} icon={<Database size={14} />} />
          <KpiCard label="Free" value={formatBytes(freeBytes)} color="#22c55e" icon={<HardDrive size={14} />} />
          <KpiCard label="Use %" value={`${usePct.toFixed(1)}%`} color={tierColor} icon={<Activity size={14} />} />
          <KpiCard
            label="Total Files"
            value={totalFileCount !== null ? totalFileCount.toLocaleString() : "—"}
            sub={totalFileCount === null ? "Run Deep Scan" : undefined}
            icon={<ScrollText size={14} />}
          />
        </div>
      )}
    </section>
  );
}

// ── Scoped-directory mode ────────────────────────────────────────────────────

interface ScopedModeProps extends ScopeOverviewProps {
  scannedRoot: string;
}

function ScopedMode({ scannedRoot, mounts, ageHistogram, rootFolders, lastDeepScan }: ScopedModeProps) {
  // `du -x -B1 -d 1 <root>` emits a summary line for the root itself alongside
  // its direct children. Split them apart:
  //   - rootEntry (path === scannedRoot): the canonical `du -sB1` size — prefer
  //     this over sum(ageHistogram) since it also counts directory blocks.
  //   - childEntries: the actual top-level entries under the scanned folder.
  const rootEntry = rootFolders.find((f) => f.path === scannedRoot);
  const childEntries = rootFolders.filter((f) => f.path !== scannedRoot);

  const histogramBytes = ageHistogram ? sumHistogram(ageHistogram) : null;
  const dirBytes = rootEntry?.size_bytes ?? histogramBytes;
  const fileCount = ageHistogram?.total_files ?? null;
  const avgFileBytes =
    histogramBytes !== null && fileCount !== null && fileCount > 0
      ? histogramBytes / fileCount
      : null;
  const topLevelEntries = childEntries.length;
  const parentMount = findParentMount(scannedRoot, mounts);
  const scannedAgo = lastDeepScan !== null ? formatRelative(lastDeepScan) : null;
  const scannedFull = lastDeepScan !== null ? new Date(lastDeepScan).toLocaleString() : undefined;

  return (
    <section className="rounded-2xl border border-border-raised bg-surface-pane p-5">
      {/* Header row: title + path chip + scanned-at */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Directory Overview
        </h2>
        <PathChip path={scannedRoot} />
        {scannedAgo && (
          <span
            className="ml-auto text-[11px] text-text-tertiary"
            title={scannedFull}
          >
            Scanned {scannedAgo}
          </span>
        )}
      </div>

      {/* Scope callout — impossible to miss */}
      <div className="mb-4 flex items-start gap-2 rounded-[10px] border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
        <Info size={13} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-amber-700" />
        <span>
          All statistics on this page are scoped to{" "}
          <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11.5px] text-amber-900">
            {scannedRoot}
          </span>{" "}
          — <span className="font-semibold">not the whole machine.</span> Global disk and partition
          data is not shown in this view. Run a fresh Deep Scan with{" "}
          <span className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
            Entire filesystem
          </span>{" "}
          to see machine-wide stats.
        </span>
      </div>

      {/* KPI grid — every value is derived from the scoped scan */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard
          label="Directory Size"
          value={dirBytes !== null ? formatBytes(dirBytes) : "—"}
          sub={dirBytes === null ? "Run Deep Scan" : undefined}
          color="#3f7be0"
          icon={<HardDrive size={14} />}
        />
        <KpiCard
          label="Files"
          value={fileCount !== null ? fileCount.toLocaleString() : "—"}
          sub={fileCount === null ? "Run Deep Scan" : undefined}
          icon={<ScrollText size={14} />}
        />
        <KpiCard
          label="Avg File Size"
          value={avgFileBytes !== null ? formatBytes(avgFileBytes) : "—"}
          icon={<Database size={14} />}
        />
        <KpiCard
          label="Top-level Entries"
          value={topLevelEntries > 0 ? topLevelEntries.toLocaleString() : "—"}
          sub={topLevelEntries > 0 ? "children of scanned root" : undefined}
          icon={<Activity size={14} />}
        />
        <KpiCard
          label="Parent Partition"
          value={parentMount ? parentMount.mount : "—"}
          sub={parentMount ? `${parentMount.use_pct.toFixed(1)}% full` : "unknown"}
          color={parentMount ? HEALTH_COLOR[mountHealth(parentMount.use_pct)] : undefined}
          icon={<HardDrive size={14} />}
        />
      </div>

      {/* Comparison strip — how much of the parent partition this dir occupies */}
      {parentMount && dirBytes !== null && (
        <div className="mt-4">
          <PartitionComparisonStrip
            scannedRoot={scannedRoot}
            dirBytes={dirBytes}
            mount={parentMount}
          />
        </div>
      )}
    </section>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function PathChip({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  function onCopy() {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1400);
    });
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 font-mono text-[11.5px]"
      style={{ background: "rgba(63,123,224,0.10)", border: "1px solid rgba(63,123,224,0.28)", color: "#2657a8" }}
    >
      <span>🔎</span>
      <span className="max-w-[420px] truncate">{path}</span>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? "Copied" : "Copy path"}
        className="flex items-center justify-center rounded p-0.5 text-[#2657a8]/70 transition-colors hover:bg-[rgba(63,123,224,0.14)] hover:text-[#2657a8]"
      >
        {copied ? <Check size={11} strokeWidth={2.4} /> : <Copy size={11} strokeWidth={2} />}
      </button>
    </span>
  );
}

interface PartitionComparisonStripProps {
  scannedRoot: string;
  dirBytes: number;
  mount: DiskMount;
}

/**
 * Three-segment horizontal bar showing how the scanned directory compares to
 * the rest of the parent partition. The one piece of global context worth
 * keeping in scoped mode — "the folder you scanned is 3.2% of the partition
 * it lives on."
 *
 * Note: `dirBytes` comes from a scan whose sizes may differ slightly from `df`
 * counted bytes (block-size rounding, sparse files, mount overlays). We clamp
 * `dirBytes` to `mount.used` to avoid the "other data" segment going negative
 * when the scan reports slightly more than df's used count.
 */
function PartitionComparisonStrip({ scannedRoot, dirBytes, mount }: PartitionComparisonStripProps) {
  const clampedDir = Math.min(dirBytes, mount.used);
  const otherUsed = Math.max(0, mount.used - clampedDir);
  const free = mount.avail;
  const total = Math.max(1, mount.total);
  const dirPct = (clampedDir / total) * 100;
  const otherPct = (otherUsed / total) * 100;
  const freePct = (free / total) * 100;

  return (
    <div className="rounded-[10px] border border-border-subtle bg-surface-chip/40 px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Share of {mount.mount}
        </span>
        <span className="font-mono text-[11px] text-text-tertiary">
          {dirPct.toFixed(2)}% of partition
        </span>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#e8e4dc]">
        <div
          style={{ width: `${dirPct.toString()}%`, background: "#3f7be0" }}
          title={`${scannedRoot} — ${formatBytes(clampedDir)}`}
        />
        <div
          style={{ width: `${otherPct.toString()}%`, background: "#c8b98a" }}
          title={`Other data on ${mount.mount} — ${formatBytes(otherUsed)}`}
        />
        <div
          style={{ width: `${freePct.toString()}%`, background: "transparent" }}
          title={`Free on ${mount.mount} — ${formatBytes(free)}`}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <LegendDot color="#3f7be0" label={scannedRoot} value={formatBytes(clampedDir)} />
        <LegendDot color="#c8b98a" label={`Other on ${mount.mount}`} value={formatBytes(otherUsed)} />
        <LegendDot color="#e8e4dc" label="Free" value={formatBytes(free)} />
      </div>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: color, border: color === "#e8e4dc" ? "1px solid #d0ccc4" : undefined }}
      />
      <span className="font-mono text-text-tertiary">{label}</span>
      <span className="tabular-nums text-text-secondary">— {value}</span>
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sumHistogram(h: AgeHistogram): number {
  return h.last_24h_bytes + h.last_7d_bytes + h.last_30d_bytes + h.last_90d_bytes + h.older_bytes;
}

/**
 * Longest-prefix match: find the mount whose `mount` path is the longest prefix
 * of the given directory. Root `"/"` is a valid fallback for any path.
 */
function findParentMount(path: string, mounts: DiskMount[]): DiskMount | null {
  let best: DiskMount | null = null;
  for (const m of mounts) {
    if (path === m.mount || path.startsWith(m.mount === "/" ? "/" : `${m.mount}/`)) {
      if (!best || m.mount.length > best.mount.length) best = m;
    }
  }
  return best;
}

function formatRelative(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 45) return "just now";
  if (sec < 90) return "1 min ago";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min.toString()} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr.toString()} hr ago`;
  const d = Math.floor(hr / 24);
  return `${d.toString()} d ago`;
}
