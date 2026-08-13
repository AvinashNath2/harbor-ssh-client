import {
  Database,
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
import { CategoryDonut, PartitionsBar } from "./storage/DashboardCharts";
import { DuplicatesTab } from "./storage/DuplicatesTab";
import { LargestItemsTable } from "./storage/LargestItemsTable";
import { ScopeOverview } from "./storage/ScopeOverview";
import { SettingsTab } from "./storage/SettingsTab";
import { DeepScanScopeModal } from "./storage/DeepScanScopeModal";
import { ServerLoadPopup } from "./storage/ServerLoadPopup";
import { StorageLogsDrawer } from "./storage/StorageLogsDrawer";
import { useServerLoad } from "../hooks/useServerLoad";
import { StorageTree } from "./storage/StorageTree";

type Tab = "dashboard" | "explorer" | "largest" | "cleanup" | "duplicates" | "settings";

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode; soon?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={15} /> },
  { id: "explorer", label: "Storage Explorer", icon: <FolderOpen size={15} /> },
  { id: "largest", label: "Largest Items", icon: <Database size={15} /> },
  { id: "cleanup", label: "Cleanup Center", icon: <Trash2 size={15} /> },
  { id: "duplicates", label: "Duplicates", icon: <ScrollText size={15} /> },
  { id: "settings", label: "Settings", icon: <Settings size={15} /> },
];

interface StorageAnalyzerPageProps {
  host: string;
  username: string;
  osInfo?: string;
  /** Profile's pinned defaultPath if any — pre-fills the Deep Scan scope modal
   *  so the recommended-directory input is the folder the user cares about. */
  defaultScanPath?: string;
  onClose: () => void;
  onBrowse?: (path: string) => void;
}

export function StorageAnalyzerPage({
  host,
  username,
  osInfo,
  defaultScanPath,
  onClose,
  onBrowse,
}: StorageAnalyzerPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [showLogs, setShowLogs] = useState(false);
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const {
    state,
    fetchOverview,
    startDeepScan,
    cancelDeepScan,
    loadTree,
    expandNode,
    collapseNode,
    fetchLargestItems,
    deleteLargestItem,
    checkSudoAvailable,
    runCleanupEstimate,
    runCleanupPreview,
    runCleanupExecute,
    startFindDuplicates,
  } = useStorageAnalyzer();

  // Server-load box — always polling while the Data Profiler window is open,
  // so the sidebar strip stays live even when no scan is running.
  const serverLoad = useServerLoad(true);

  // Sum of all mount totals — passed to ExplorerTab so folder-size bars can
  // scale against machine-wide disk. ScopeOverview computes its own totals
  // internally from either mounts (whole-machine) or the age histogram (scoped).
  const totalBytes = state.mounts.reduce((s, m) => s + m.total, 0);

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
      {/*
       * Responsive priority: identity + server pill + primary actions (Refresh,
       * Deep Scan, Close) are ALWAYS visible. Secondary metadata (OS, uptime,
       * updated-at) hides progressively as width shrinks, so buttons never wrap
       * or grow vertically. Locked `min-h-[52px]` keeps the bar exactly one
       * row tall regardless of content.
       */}
      <div className="flex min-h-[52px] flex-shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-surface-titlebar px-5 py-2">
        {/* Left cluster — identity */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <HardDrive size={18} className="text-[#3f7be0]" />
          <span className="whitespace-nowrap text-[14px] font-semibold text-text-primary">
            Data Profiler
          </span>
        </div>

        <div className="h-4 w-px flex-shrink-0" style={{ background: "#dedad3" }} />

        {/* Server pill — always visible; truncates for very long hosts */}
        <div className="flex min-w-0 max-w-[220px] flex-shrink items-center gap-1.5 rounded-lg bg-surface-chip px-2.5 py-1">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-400" />
          <span className="truncate whitespace-nowrap font-mono text-[12px] text-text-primary">
            {username}@{host}
          </span>
        </div>

        {/* Secondary metadata — hides on smaller widths, in priority order */}
        {state.sysInfo && (
          <>
            <span className="hidden whitespace-nowrap text-[11.5px] text-text-faint xl:inline">
              {state.sysInfo.os_name} {state.sysInfo.os_version}
            </span>
            <span className="hidden max-w-[220px] truncate whitespace-nowrap text-[11.5px] text-text-faint 2xl:inline">
              {state.sysInfo.uptime}
            </span>
          </>
        )}

        {osInfo && !state.sysInfo && (
          <span className="hidden whitespace-nowrap text-[11.5px] text-text-faint xl:inline">
            {osInfo}
          </span>
        )}

        {state.lastRefresh && (
          <span className="hidden whitespace-nowrap text-[11px] text-text-faint lg:inline">
            Updated {new Date(state.lastRefresh).toLocaleTimeString()}
          </span>
        )}

        <div className="min-w-4 flex-1" />

        {/* Right cluster — actions. Every button `flex-shrink-0` so they NEVER
            wrap or shrink. Refresh label collapses to icon-only below `md`. */}
        <button
          onClick={() => void fetchOverview()}
          disabled={state.loading}
          className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border-input px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary disabled:opacity-50"
          title="Refresh disk overview (df)"
        >
          <RefreshCw size={12} className={state.loading ? "animate-spin" : ""} />
          <span className="hidden whitespace-nowrap md:inline">Refresh Overview</span>
        </button>

        {/* Scope-of-last-scan chip — long paths truncate but the chip stays put */}
        {state.scannedRoot !== null && !state.deepScanning && (
          <div
            className="flex h-8 max-w-[260px] flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11.5px]"
            style={
              state.scannedRoot === "/"
                ? {
                    background: "rgba(31,157,99,0.10)",
                    borderColor: "rgba(31,157,99,0.30)",
                    color: "#177a4c",
                  }
                : {
                    background: "rgba(63,123,224,0.08)",
                    borderColor: "rgba(63,123,224,0.30)",
                    color: "#2f6bdb",
                  }
            }
            title={
              state.scannedRoot === "/"
                ? "The current dashboard reflects a whole-machine scan"
                : `The current dashboard reflects a scoped scan of ${state.scannedRoot}`
            }
          >
            <span className="truncate whitespace-nowrap">
              {state.scannedRoot === "/" ? "🌐 Whole machine" : `🔎 Scan of ${state.scannedRoot}`}
            </span>
            {state.lastDeepScan !== null && (
              <span className="hidden flex-shrink-0 whitespace-nowrap opacity-70 lg:inline">
                · {new Date(state.lastDeepScan).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => {
            if (state.deepScanning) {
              cancelDeepScan();
            } else {
              setScopeModalOpen(true);
            }
          }}
          disabled={!state.deepScanning && state.loading}
          className="flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{
            background: state.deepScanning
              ? "linear-gradient(135deg,#ef4444,#dc2626)"
              : "linear-gradient(135deg,#3f7be0,#2f6bdb)",
          }}
          title={
            state.deepScanning
              ? "Cancel scan — terminates the remote du/find within ~1 s"
              : "Deep scan: pick a directory or the whole filesystem"
          }
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
          className="ml-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
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
            <span className="font-semibold">Deep Scan running</span> — click Cancel any time to
            terminate the remote <span className="font-mono">du</span>/
            <span className="font-mono">find</span> process (takes ~1 s). Server load monitoring
            stays live throughout.
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
          {/* Live server-load box — always visible in the empty sidebar space */}
          <ServerLoadPopup
            latest={serverLoad.latest}
            history={serverLoad.history}
            stalled={serverLoad.stalled}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "dashboard" && <DashboardTab state={state} />}

          {activeTab === "explorer" && (
            <ExplorerTab
              state={state}
              totalBytes={totalBytes}
              onExpand={expandNode}
              onCollapse={collapseNode}
              onLoadRoot={() => void loadTree("/")}
            />
          )}

          {activeTab === "largest" && (
            <LargestItemsTable
              files={state.largestFiles}
              folders={state.largestFolders}
              loading={state.largestLoading}
              onBrowse={onBrowse}
              onRefresh={(root) => void fetchLargestItems(root)}
              root="/"
              onDelete={deleteLargestItem}
            />
          )}

          {activeTab === "cleanup" && (
            <CleanupCenter
              sudoAvailable={state.sudoAvailable}
              onCheckSudo={() => void checkSudoAvailable()}
              onEstimate={runCleanupEstimate}
              onPreview={runCleanupPreview}
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

      {scopeModalOpen && (
        <DeepScanScopeModal
          defaultPath={defaultScanPath ?? "~"}
          onCancel={() => {
            setScopeModalOpen(false);
          }}
          onStart={(root) => {
            setScopeModalOpen(false);
            void startDeepScan(root);
          }}
        />
      )}
    </div>
  );
}

// ── Dashboard tab ─────────────────────────────────────────────────────────────

interface DashboardTabProps {
  state: ReturnType<typeof useStorageAnalyzer>["state"];
}

function DashboardTab({ state }: DashboardTabProps) {
  return (
    <div className="flex flex-col gap-6">
      <ScopeOverview
        scannedRoot={state.scannedRoot}
        mounts={state.mounts}
        ageHistogram={state.ageHistogram}
        rootFolders={state.rootFolders}
        lastDeepScan={state.lastDeepScan}
        loading={state.loading}
      />

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Storage by Age
          {state.scannedRoot !== null && state.scannedRoot !== "/" && (
            <span className="ml-2 font-mono normal-case tracking-normal text-text-tertiary">
              — in {state.scannedRoot}
            </span>
          )}
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

      {/* ── Phase 3 charts ───────────────────────────────────────────────── */}

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
          Storage by Category
        </h2>
        <div className="rounded-xl border border-border-raised bg-surface-pane p-5">
          {state.scannedRoot !== null && state.scannedRoot !== "/" ? (
            <div className="text-[12.5px] leading-relaxed text-text-secondary">
              <p>
                Category breakdown is only available for whole-machine scans. Run a fresh Deep Scan
                and pick{" "}
                <span className="rounded bg-surface-chip px-1 py-0.5 font-mono text-[11px]">
                  Scan the entire filesystem
                </span>{" "}
                to compute it — the current dashboard reflects a scoped scan of{" "}
                <span className="font-mono text-text-primary">{state.scannedRoot}</span>.
              </p>
            </div>
          ) : (
            <CategoryDonut categories={state.categories} />
          )}
        </div>
      </section>

      {(() => {
        const scoped = state.scannedRoot !== null && state.scannedRoot !== "/";
        if (scoped) {
          // ScopeOverview already shows the parent-partition comparison strip
          // for the scanned directory. Skip the machine-wide partitions bar
          // entirely here — showing all partitions in scoped mode is exactly
          // the "mixed context" bug we set out to fix.
          return null;
        }
        return (
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-faint">
              Usage per Partition
            </h2>
            <div className="rounded-xl border border-border-raised bg-surface-pane p-5">
              <PartitionsBar mounts={state.mounts} />
            </div>
          </section>
        );
      })()}
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
