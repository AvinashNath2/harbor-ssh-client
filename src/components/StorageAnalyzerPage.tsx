import {
  Activity,
  Database,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  ScrollText,
  Settings,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useStorageAnalyzer } from "../hooks/useStorageAnalyzer";
import { formatBytes, HEALTH_COLOR, mountHealth } from "../utils/storageHealth";
import { AgeHistogramBar } from "./storage/AgeHistogram";
import { CleanupCenter } from "./storage/CleanupCenter";
import { CategoryDonut, PartitionsBar, TopFoldersBar } from "./storage/DashboardCharts";
import { DuplicatesTab } from "./storage/DuplicatesTab";
import { KpiCard } from "./storage/KpiCard";
import { LargestItemsTable } from "./storage/LargestItemsTable";
import { SettingsTab } from "./storage/SettingsTab";
import { StorageHeatmap } from "./storage/StorageHeatmap";
import { StorageLogsDrawer } from "./storage/StorageLogsDrawer";
import { StorageTree } from "./storage/StorageTree";

type Tab = "dashboard" | "explorer" | "heatmap" | "largest" | "cleanup" | "duplicates" | "settings";

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode; soon?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={15} /> },
  { id: "explorer", label: "Storage Explorer", icon: <FolderOpen size={15} /> },
  { id: "heatmap", label: "Storage Heatmap", icon: <Activity size={15} /> },
  { id: "largest", label: "Largest Items", icon: <Database size={15} /> },
  { id: "cleanup", label: "Cleanup Center", icon: <Trash2 size={15} /> },
  { id: "duplicates", label: "Duplicates", icon: <ScrollText size={15} /> },
  { id: "settings", label: "Settings", icon: <Settings size={15} /> },
];

interface StorageAnalyzerPageProps {
  host: string;
  username: string;
  osInfo?: string;
  onClose: () => void;
  onBrowse?: (path: string) => void;
}

export function StorageAnalyzerPage({
  host,
  username,
  osInfo,
  onClose,
  onBrowse,
}: StorageAnalyzerPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [showLogs, setShowLogs] = useState(false);
  const {
    state,
    fetchOverview,
    startDeepScan,
    cancelDeepScan,
    loadTree,
    expandNode,
    collapseNode,
    fetchLargestItems,
    checkSudoAvailable,
    runCleanupEstimate,
    runCleanupExecute,
    startFindDuplicates,
  } = useStorageAnalyzer();

  // Aggregate KPIs across mounts
  const totalBytes = state.mounts.reduce((s, m) => s + m.total, 0);
  const usedBytes = state.mounts.reduce((s, m) => s + m.used, 0);
  const freeBytes = state.mounts.reduce((s, m) => s + m.avail, 0);
  const usePct = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const largestRootFolder = state.rootFolders[0] ?? null;
  const totalFileCount = state.ageHistogram?.total_files ?? null;

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    // Auto-load data when switching to a tab for the first time
    if (tab === "explorer" && !state.treeRoot && !state.treeLoading) {
      void loadTree("/");
    }
    if (tab === "largest" && state.largestFiles.length === 0 && !state.largestLoading) {
      void fetchLargestItems("/");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface">
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-5 py-3 bg-surface-titlebar">
        <div className="flex items-center gap-2">
          <HardDrive size={18} className="text-[#3f7be0]" />
          <span className="text-[14px] font-semibold text-text-primary">Data Profiler</span>
        </div>

        <div className="mx-2 h-4 w-px flex-shrink-0" style={{ background: "#dedad3" }} />

        {/* Server pill */}
        <div className="flex items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-1">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-400" />
          <span className="font-mono text-[12px] text-text-primary">
            {username}@{host}
          </span>
        </div>

        {state.sysInfo && (
          <>
            <span className="text-[11.5px] text-text-faint">
              {state.sysInfo.os_name} {state.sysInfo.os_version}
            </span>
            <span className="text-[11.5px] text-text-faint">{state.sysInfo.uptime}</span>
          </>
        )}

        {osInfo && !state.sysInfo && (
          <span className="text-[11.5px] text-text-faint">{osInfo}</span>
        )}

        {state.lastRefresh && (
          <span className="text-[11px] text-text-faint">
            Updated {new Date(state.lastRefresh).toLocaleTimeString()}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => void fetchOverview()}
          disabled={state.loading}
          className="flex items-center gap-1.5 rounded-lg border border-border-input px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary disabled:opacity-50"
          title="Refresh disk overview (df)"
        >
          <RefreshCw size={12} className={state.loading ? "animate-spin" : ""} />
          Refresh Overview
        </button>

        <button
          onClick={() => {
            if (state.deepScanning) {
              cancelDeepScan();
            } else {
              void startDeepScan();
            }
          }}
          disabled={!state.deepScanning && state.loading}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{
            background: state.deepScanning
              ? "linear-gradient(135deg,#ef4444,#dc2626)"
              : "linear-gradient(135deg,#3f7be0,#2f6bdb)",
          }}
          title={state.deepScanning ? "Cancel deep scan" : "Deep scan (du + age histogram)"}
        >
          {state.deepScanning ? (
            <>
              <X size={12} /> Cancel
            </>
          ) : (
            <>
              <Zap size={12} /> Deep Scan
            </>
          )}
        </button>

        <button
          onClick={onClose}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── SSH occupancy banner ─────────────────────────────────────────────── */}
      {state.deepScanning && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2">
          <Loader2 size={12} className="animate-spin text-amber-500 flex-shrink-0" />
          <span className="text-[11.5px] text-amber-700">
            <span className="font-semibold">Deep Scan running</span> — SSH channel is occupied.
            Terminal commands will resume when the scan completes or is cancelled.
          </span>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-44 flex-shrink-0 flex-col border-r border-border py-3 bg-surface-sidebar">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id && !item.soon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (!item.soon) handleTabChange(item.id);
                }}
                disabled={item.soon}
                className={`relative mx-2 mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${
                  active
                    ? "bg-[rgba(47,107,219,0.10)] font-semibold text-text-accent shadow-[inset_2px_0_0_#2f6bdb]"
                    : item.soon
                      ? "cursor-not-allowed text-text-faint opacity-50"
                      : "text-text-secondary hover:bg-surface-chip hover:text-text-primary"
                }`}
              >
                <span className={active ? "text-[#3f7be0]" : ""}>{item.icon}</span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.soon && (
                  <span className="rounded-sm bg-surface-chip px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-text-faint">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "dashboard" && (
            <DashboardTab
              state={state}
              totalBytes={totalBytes}
              usedBytes={usedBytes}
              freeBytes={freeBytes}
              usePct={usePct}
              totalFileCount={totalFileCount}
              largestRootFolder={largestRootFolder}
            />
          )}

          {activeTab === "explorer" && (
            <ExplorerTab
              state={state}
              totalBytes={totalBytes}
              onExpand={expandNode}
              onCollapse={collapseNode}
              onLoadRoot={() => void loadTree("/")}
            />
          )}

          {activeTab === "heatmap" && (
            <HeatmapTab state={state} totalBytes={totalBytes} onBrowse={onBrowse} />
          )}

          {activeTab === "largest" && (
            <LargestItemsTable
              files={state.largestFiles}
              folders={state.largestFolders}
              loading={state.largestLoading}
              onBrowse={onBrowse}
              onRefresh={(root) => void fetchLargestItems(root)}
              root="/"
            />
          )}

          {activeTab === "cleanup" && (
            <CleanupCenter
              sudoAvailable={state.sudoAvailable}
              onCheckSudo={() => void checkSudoAvailable()}
              onEstimate={runCleanupEstimate}
              onExecute={runCleanupExecute}
            />
          )}

          {activeTab === "duplicates" && (
            <DuplicatesTab
              duplicates={state.duplicates}
              loading={state.duplicatesLoading}
              onScan={(root, minSizeBytes, maxDepth) =>
                void startFindDuplicates(root, minSizeBytes, maxDepth)
              }
              onBrowse={onBrowse}
            />
          )}

          {activeTab === "settings" && <SettingsTab />}
        </main>
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-3 border-t border-border px-5 py-2 bg-surface-titlebar">
        {state.deepScanning && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3f7be0]" />
            <span className="text-[11.5px] text-text-accent">Deep scan running…</span>
          </div>
        )}
        {(state.treeLoading || state.largestLoading || state.duplicatesLoading) &&
          !state.deepScanning && (
            <div className="flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin text-text-faint" />
              <span className="text-[11.5px] text-text-faint">Loading…</span>
            </div>
          )}
        {state.loading && !state.deepScanning && !state.treeLoading && !state.largestLoading && (
          <div className="flex items-center gap-1.5">
            <RefreshCw size={11} className="animate-spin text-text-faint" />
            <span className="text-[11.5px] text-text-faint">Refreshing…</span>
          </div>
        )}
        {state.error && <span className="text-[11.5px] text-red-400">{state.error}</span>}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-400" />
          <span className="text-[11px] text-text-faint">SSH connected</span>
        </div>
      </div>

      {/* ── Floating logs pill ───────────────────────────────────────────────── */}
      <button
        onClick={() => {
          setShowLogs((v) => !v);
        }}
        className="fixed bottom-10 right-4 z-50 flex items-center gap-1.5 rounded-full border border-border-raised bg-surface-pane px-3 py-1.5 shadow-lg transition-colors hover:bg-surface-chip"
        title="Toggle storage analyzer logs"
      >
        <ScrollText size={12} className="text-text-faint" />
        <span className="text-[11.5px] font-medium text-text-secondary">
          Logs ({state.logs.length})
        </span>
      </button>

      {showLogs && (
        <StorageLogsDrawer
          logs={state.logs}
          onClose={() => {
            setShowLogs(false);
          }}
        />
      )}
    </div>
  );
}

// ── Dashboard tab ─────────────────────────────────────────────────────────────

interface DashboardTabProps {
  state: ReturnType<typeof useStorageAnalyzer>["state"];
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usePct: number;
  totalFileCount: number | null;
  largestRootFolder: { path: string; size_bytes: number } | null;
}

function DashboardTab({
  state,
  totalBytes,
  usedBytes,
  freeBytes,
  usePct,
  totalFileCount,
  largestRootFolder,
}: DashboardTabProps) {
  const overallTier = mountHealth(usePct);
  const tierColor = HEALTH_COLOR[overallTier];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Disk Overview
        </h2>

        {state.loading && state.mounts.length === 0 ? (
          <div className="flex items-center gap-2 text-[12px] text-text-faint">
            <RefreshCw size={12} className="animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
            <KpiCard
              label="Total Disk"
              value={formatBytes(totalBytes)}
              icon={<HardDrive size={14} />}
            />
            <KpiCard
              label="Used"
              value={formatBytes(usedBytes)}
              color={tierColor}
              icon={<Database size={14} />}
            />
            <KpiCard
              label="Free"
              value={formatBytes(freeBytes)}
              color="#22c55e"
              icon={<HardDrive size={14} />}
            />
            <KpiCard
              label="Use %"
              value={`${usePct.toFixed(1)}%`}
              color={tierColor}
              icon={<Activity size={14} />}
            />
            <KpiCard
              label="Total Files"
              value={totalFileCount !== null ? totalFileCount.toLocaleString() : "—"}
              sub={totalFileCount === null ? "Run Deep Scan" : undefined}
              icon={<ScrollText size={14} />}
            />
            <KpiCard
              label="Largest Root Folder"
              value={largestRootFolder ? formatBytes(largestRootFolder.size_bytes) : "—"}
              sub={largestRootFolder?.path}
              icon={<Folder size={14} />}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Storage by Age
        </h2>
        <div className="rounded-xl border border-border-raised bg-surface-pane p-4">
          {state.ageHistogram ? (
            <AgeHistogramBar data={state.ageHistogram} />
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[12.5px] text-text-secondary">
                File-age histogram not yet available.
              </p>
              <p className="text-[11.5px] text-text-faint">
                Click <span className="font-semibold text-text-accent">Deep Scan</span> to run{" "}
                <code className="rounded bg-surface-chip px-1 text-[10.5px]">
                  find / -printf &apos;%T@ %s&apos;
                </code>{" "}
                and bucket all files by modification time.
              </p>
            </div>
          )}
        </div>
      </section>

      {state.mounts.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
            Mounts
          </h2>
          <div className="overflow-hidden rounded-xl border border-border-raised">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: "#dedad3", background: "#ece9e3" }}
                >
                  {["Mount", "Filesystem", "Used", "Free", "Total", "Usage"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint ${i >= 2 && i < 5 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.mounts.map((m) => {
                  const tier = mountHealth(m.use_pct);
                  const color = HEALTH_COLOR[tier];
                  return (
                    <tr
                      key={m.mount}
                      className="border-b transition-colors hover:bg-surface-chip"
                      style={{ borderColor: "#e5e2db" }}
                    >
                      <td className="px-4 py-2.5 font-mono font-medium text-text-primary">
                        {m.mount}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{m.fs}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {formatBytes(m.used)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {formatBytes(m.avail)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {formatBytes(m.total)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-chip">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${m.use_pct.toFixed(2)}%`, background: color }}
                            />
                          </div>
                          <span
                            className="w-10 text-right text-[11px] font-semibold"
                            style={{ color }}
                          >
                            {m.use_pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {state.rootFolders.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
            Root Folder Breakdown
            {state.lastDeepScan && (
              <span className="ml-2 font-normal normal-case text-text-faint">
                — scanned {new Date(state.lastDeepScan).toLocaleTimeString()}
              </span>
            )}
          </h2>
          <div className="overflow-hidden rounded-xl border border-border-raised">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: "#dedad3", background: "#ece9e3" }}
                >
                  <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                    Path
                  </th>
                  <th className="px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                    Size
                  </th>
                  <th className="w-48 px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.rootFolders.slice(0, 20).map((f) => {
                  const ratio =
                    state.rootFolders.length > 0
                      ? f.size_bytes / (state.rootFolders[0]?.size_bytes || 1)
                      : 0;
                  return (
                    <tr
                      key={f.path}
                      className="border-b transition-colors hover:bg-surface-chip"
                      style={{ borderColor: "#e5e2db" }}
                    >
                      <td className="px-4 py-2.5 font-mono text-text-primary">{f.path}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                        {formatBytes(f.size_bytes)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-chip">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(ratio * 100).toFixed(2)}%`, background: "#3f7be0" }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Phase 3 charts ───────────────────────────────────────────────── */}

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Storage by Category
        </h2>
        <div className="rounded-xl border border-border-raised bg-surface-pane p-5">
          <CategoryDonut categories={state.categories} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Top Folders
        </h2>
        <div className="rounded-xl border border-border-raised bg-surface-pane p-5">
          <TopFoldersBar folders={state.rootFolders} totalBytes={totalBytes} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Usage per Partition
        </h2>
        <div className="rounded-xl border border-border-raised bg-surface-pane p-5">
          <PartitionsBar mounts={state.mounts} />
        </div>
      </section>
    </div>
  );
}

// ── Storage Explorer tab ──────────────────────────────────────────────────────

interface ExplorerTabProps {
  state: ReturnType<typeof useStorageAnalyzer>["state"];
  totalBytes: number;
  onExpand: (path: string) => void;
  onCollapse: (path: string) => void;
  onLoadRoot: () => void;
}

function ExplorerTab({ state, totalBytes, onExpand, onCollapse, onLoadRoot }: ExplorerTabProps) {
  const diskTotal = totalBytes || 1;

  if (state.treeLoading && !state.treeRoot) {
    return (
      <div className="flex items-center gap-2 py-16 text-[12px] text-text-faint">
        <Loader2 size={14} className="animate-spin" />
        Building tree… (running du -d 1 /)
      </div>
    );
  }

  if (!state.treeRoot) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <FolderOpen size={32} className="text-text-faint opacity-40" />
        <p className="text-[13px] text-text-secondary">Storage Explorer not loaded yet</p>
        <p className="text-[11.5px] text-text-faint">
          Click <span className="font-semibold text-text-accent">Load Tree</span> to scan / at depth
          1 (fast, under a second)
        </p>
        <button
          onClick={onLoadRoot}
          className="mt-2 flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold text-white"
          style={{ background: "linear-gradient(135deg,#3f7be0,#2f6bdb)" }}
        >
          <FolderOpen size={13} /> Load Tree
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Storage Explorer — click folders to expand
        </h2>
        <button
          onClick={onLoadRoot}
          disabled={state.treeLoading}
          className="flex items-center gap-1.5 rounded-lg border border-border-input px-3 py-1.5 text-[11.5px] text-text-secondary hover:bg-surface-chip disabled:opacity-50"
        >
          <RefreshCw size={11} className={state.treeLoading ? "animate-spin" : ""} />
          Reset
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 border-b border-border px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
        <span className="flex-1">Path</span>
        <span className="w-24 text-right">Share</span>
        <span className="w-20 text-right">Size</span>
      </div>

      {/* Tree */}
      <div className="overflow-hidden rounded-xl border border-border-raised bg-surface-pane">
        <StorageTree
          root={state.treeRoot}
          totalBytes={diskTotal}
          onExpand={(path) => {
            onExpand(path);
          }}
          onCollapse={onCollapse}
        />
      </div>
    </div>
  );
}

// ── Heatmap tab ───────────────────────────────────────────────────────────────

interface HeatmapTabProps {
  state: ReturnType<typeof useStorageAnalyzer>["state"];
  totalBytes: number;
  onBrowse?: (path: string) => void;
}

function HeatmapTab({ state, totalBytes, onBrowse }: HeatmapTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Storage Heatmap — folder sizes as proportional rectangles
        </h2>
        {state.lastDeepScan && (
          <span className="text-[11px] text-text-faint">
            Data from {new Date(state.lastDeepScan).toLocaleTimeString()}
          </span>
        )}
      </div>
      <StorageHeatmap
        folders={state.rootFolders}
        totalBytes={totalBytes || 1}
        onBrowse={onBrowse}
      />
    </div>
  );
}
