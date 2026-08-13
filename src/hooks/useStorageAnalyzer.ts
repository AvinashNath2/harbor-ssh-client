import { useCallback, useEffect, useRef, useState } from "react";
import {
  deletePath,
  deletePathSudo,
  storageAgeHistogram,
  storageCancelScan,
  storageCategorySizes,
  storageCheckSudo,
  storageCleanupEstimate,
  storageCleanupExecute,
  storageCleanupPreview,
  storageFindDuplicates,
  storageLargestItems,
  storageOverview,
  storageScanPath,
  storageScanRoot,
  storageSystemInfo,
  type AgeHistogram,
  type CleanupEstimate,
  type CleanupPreview,
  type CleanupResult,
  type DiskMount,
  type DuplicateGroup,
  type FolderSize,
  type LargestFile,
  type StorageSystemInfo,
} from "../api";
import { computeCategories, type CategoryBucket } from "../utils/storageCategories";

export interface StorageLogEntry {
  id: number;
  ts: number;
  cycle: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  detail?: string;
}

export interface TreeNode {
  path: string;
  name: string;
  size_bytes: number;
  children: TreeNode[] | null; // null = not yet loaded
  loading: boolean;
  expanded: boolean;
}

export interface StorageState {
  loading: boolean;
  deepScanning: boolean;
  error: string | null;
  mounts: DiskMount[];
  sysInfo: StorageSystemInfo | null;
  rootFolders: FolderSize[];
  ageHistogram: AgeHistogram | null;
  lastRefresh: number | null;
  lastDeepScan: number | null;
  /** The root the LAST completed deep scan covered. `null` = no scan yet, `"/"`
   *  = whole-machine scan, `"/var/log"` etc = scoped scan. Drives the "Scan of
   *  X" chip in the header and the "categories only for full scans" note. */
  scannedRoot: string | null;
  /** UUID prefixed into the current in-flight scan's env vars so the control
   *  channel can pkill it. Cleared when the scan finishes or is cancelled. */
  scanCancelTag: string | null;
  logs: StorageLogEntry[];
  // Phase 2
  treeRoot: TreeNode | null;
  treeLoading: boolean;
  largestFiles: LargestFile[];
  largestFolders: LargestFile[];
  largestLoading: boolean;
  // Phase 3
  categories: CategoryBucket[];
  categoryRawSizes: FolderSize[];
  // Phase 4
  sudoAvailable: boolean | null;
  duplicates: DuplicateGroup[];
  duplicatesLoading: boolean;
}

let _logId = 0;
let _fetchCycle = 0;
const MAX_LOGS = 500;

/** UUID used as the HARBOR_CANCEL_TAG env var on remote scan commands, so the
 *  control channel can `pkill -f` this exact process tree. */
function generateCancelTag(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function safe<T>(_label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function makeName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function useStorageAnalyzer() {
  const [state, setState] = useState<StorageState>({
    loading: false,
    deepScanning: false,
    error: null,
    mounts: [],
    sysInfo: null,
    rootFolders: [],
    ageHistogram: null,
    lastRefresh: null,
    lastDeepScan: null,
    scannedRoot: null,
    scanCancelTag: null,
    logs: [],
    treeRoot: null,
    treeLoading: false,
    largestFiles: [],
    largestFolders: [],
    largestLoading: false,
    categories: [],
    categoryRawSizes: [],
    sudoAvailable: null,
    duplicates: [],
    duplicatesLoading: false,
  });

  const mountedRef = useRef(true);
  const deepScanAbortRef = useRef(false);
  /** Ref mirror of `state.scanCancelTag` so `cancelDeepScan` (a stable
   *  useCallback with no state deps) can read the current tag without
   *  triggering closures over state. Synced via useEffect below. */
  const currentCancelTagRef = useRef<string | null>(null);
  useEffect(() => {
    currentCancelTagRef.current = state.scanCancelTag;
  }, [state.scanCancelTag]);

  const appendLog = useCallback(
    (
      entry: Omit<StorageLogEntry, "id" | "ts" | "cycle">,
      cycle: number,
      batch: StorageLogEntry[],
    ) => {
      batch.push({ id: ++_logId, ts: Date.now(), cycle, ...entry });
    },
    [],
  );

  const flushLogs = useCallback((newLogs: StorageLogEntry[]) => {
    if (!mountedRef.current || newLogs.length === 0) return;
    setState((s) => {
      const combined = [...s.logs, ...newLogs];
      return {
        ...s,
        logs: combined.length > MAX_LOGS ? combined.slice(-MAX_LOGS) : combined,
      };
    });
  }, []);

  const fetchOverview = useCallback(async () => {
    if (!mountedRef.current) return;
    const cycle = ++_fetchCycle;
    const logs: StorageLogEntry[] = [];
    const add = (e: Omit<StorageLogEntry, "id" | "ts" | "cycle">) => {
      appendLog(e, cycle, logs);
    };

    setState((s) => ({ ...s, loading: true, error: null }));

    const t0 = Date.now();
    add({ level: "info", source: "overview", message: "Running df -PB1…" });
    const [mounts, sysInfo] = await Promise.all([
      safe("storage_overview", storageOverview),
      safe("storage_system_info", storageSystemInfo),
    ]);
    const dt = Date.now() - t0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!mountedRef.current) return;

    if (!mounts) {
      add({ level: "error", source: "overview", message: "df failed — not connected?" });
      setState((s) => ({
        ...s,
        loading: false,
        error: "Could not reach SSH session. Please reconnect.",
      }));
      flushLogs(logs);
      return;
    }

    add({
      level: "info",
      source: "overview",
      message: `Got ${String(mounts.length)} mounts, sysinfo ${sysInfo ? "ok" : "unavailable"} — ${String(dt)}ms`,
    });

    setState((s) => ({
      ...s,
      loading: false,
      mounts,
      sysInfo: sysInfo ?? s.sysInfo,
      lastRefresh: Date.now(),
    }));

    flushLogs(logs);
  }, [appendLog, flushLogs]);

  /**
   * Run the deep-scan pipeline against `root` (defaults to "/" = whole machine).
   *
   * Pipeline (all sequential — single SSH channel):
   *   1. `du -d 1 <root>`   → state.rootFolders
   *   2. `find <root> ...`  → state.ageHistogram
   *   3. If root === "/":  `du -s` on well-known category paths → state.categories
   *      Otherwise skip — the category list is a hardcoded set of full-filesystem
   *      well-known paths (/var/log, /home, /var/lib/docker, …) and is not
   *      meaningful for a scoped scan.
   *
   * Every scan generates a UUID cancel-tag that is baked into the remote
   * command's env-var prefix. `cancelDeepScan()` uses the tag to `pkill` the
   * running process via the SECONDARY SSH channel, so cancel is instant even
   * mid-`du`. Falls back to abort-between-steps if the control channel isn't
   * available.
   */
  const startDeepScan = useCallback(
    async (root = "/") => {
      if (!mountedRef.current) return;
      deepScanAbortRef.current = false;
      const cancelTag = generateCancelTag();
      // Set the ref synchronously (state update happens on next render, but the
      // scan pipeline starts immediately after this call — the user could
      // click Cancel before the state effect fires).
      currentCancelTagRef.current = cancelTag;
      const cycle = ++_fetchCycle;
      const isWholeMachine = root === "/";

      setState((s) => ({
        ...s,
        deepScanning: true,
        error: null,
        scanCancelTag: cancelTag,
        // Clear stale data so the UI shows loading state cleanly.
        rootFolders: [],
        ageHistogram: null,
        // Categories only make sense for whole-machine scans; wipe when scoped.
        categories: isWholeMachine ? s.categories : [],
        categoryRawSizes: isWholeMachine ? s.categoryRawSizes : [],
      }));

      const l0: StorageLogEntry[] = [];
      appendLog(
        {
          level: "info",
          source: "deep-scan",
          message: `Starting deep scan of ${root} (cancel tag ${cancelTag.slice(0, 8)}…)`,
        },
        cycle,
        l0,
      );
      flushLogs(l0);

      // ── Step 1: folder sizes ────────────────────────────────────────────────
      const t0 = Date.now();
      const rootFolders = await safe("storage_scan_root", () =>
        storageScanRoot(root, 1, cancelTag),
      );
      const dt1 = Date.now() - t0;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current || deepScanAbortRef.current) {
        setState((s) => ({ ...s, deepScanning: false, scanCancelTag: null }));
        return;
      }

      const l1: StorageLogEntry[] = [];
      if (rootFolders) {
        appendLog(
          {
            level: "info",
            source: "deep-scan",
            message: `du ${root} complete — ${String(rootFolders.length)} entries in ${String(dt1)}ms`,
          },
          cycle,
          l1,
        );
        setState((s) => ({ ...s, rootFolders }));
      } else {
        appendLog(
          { level: "warn", source: "deep-scan", message: "du returned no data" },
          cycle,
          l1,
        );
      }
      flushLogs(l1);

      // ── Step 2: age histogram ───────────────────────────────────────────────
      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: "info",
          source: "age-histogram",
          message: `Running find ${root} -printf mtime…`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);

      const t2 = Date.now();
      const ageHistogram = await safe("storage_age_histogram", () =>
        storageAgeHistogram(root, cancelTag),
      );
      const dt2 = Date.now() - t2;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current || deepScanAbortRef.current) {
        setState((s) => ({ ...s, deepScanning: false, scanCancelTag: null }));
        return;
      }

      const l3: StorageLogEntry[] = [];
      if (ageHistogram) {
        appendLog(
          {
            level: "info",
            source: "age-histogram",
            message: `Done — ${ageHistogram.total_files.toLocaleString()} files in ${String(dt2)}ms`,
          },
          cycle,
          l3,
        );
      } else {
        appendLog(
          { level: "warn", source: "age-histogram", message: "histogram failed" },
          cycle,
          l3,
        );
      }
      setState((s) => ({ ...s, ageHistogram: ageHistogram ?? s.ageHistogram }));
      flushLogs(l3);

      // ── Step 3: category sizes (whole-machine scans only) ──────────────────
      if (!isWholeMachine) {
        setState((s) => ({
          ...s,
          deepScanning: false,
          lastDeepScan: Date.now(),
          scannedRoot: root,
          scanCancelTag: null,
        }));
        return;
      }

      const l4: StorageLogEntry[] = [];
      appendLog(
        { level: "info", source: "categorize", message: "Fetching targeted category sizes…" },
        cycle,
        l4,
      );
      flushLogs(l4);

      const t4 = Date.now();
      const catSizes = await safe("storage_category_sizes", storageCategorySizes);
      const dt4 = Date.now() - t4;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current || deepScanAbortRef.current) {
        setState((s) => ({ ...s, deepScanning: false, scanCancelTag: null }));
        return;
      }

      const l5: StorageLogEntry[] = [];
      if (catSizes) {
        const categories = computeCategories(catSizes);
        appendLog(
          {
            level: "info",
            source: "categorize",
            message: `${String(categories.length)} categories from ${String(catSizes.length)} paths — ${String(dt4)}ms`,
          },
          cycle,
          l5,
        );
        setState((s) => ({
          ...s,
          deepScanning: false,
          lastDeepScan: Date.now(),
          scannedRoot: root,
          scanCancelTag: null,
          categories,
          categoryRawSizes: catSizes,
        }));
      } else {
        appendLog(
          { level: "warn", source: "categorize", message: "category sizes failed" },
          cycle,
          l5,
        );
        setState((s) => ({
          ...s,
          deepScanning: false,
          lastDeepScan: Date.now(),
          scannedRoot: root,
          scanCancelTag: null,
        }));
      }
      flushLogs(l5);
    },
    [appendLog, flushLogs],
  );

  const cancelDeepScan = useCallback(() => {
    // Flip the local abort ref immediately — the between-step guards will
    // exit the pipeline as soon as they check.
    deepScanAbortRef.current = true;
    // Fire the remote pkill via the CONTROL SSH channel so the running
    // du/find dies within ~1 s. Fire-and-forget; if there's no tag (no
    // active scan) or the control channel isn't available, this is a
    // no-op and we fall back to between-step abort.
    const tag = currentCancelTagRef.current;
    currentCancelTagRef.current = null;
    if (tag) {
      void storageCancelScan(tag).catch(() => undefined);
    }
  }, []);

  // ── Phase 2: tree ────────────────────────────────────────────────────────────

  const loadTree = useCallback(
    async (rootPath: string) => {
      if (!mountedRef.current) return;
      const cycle = ++_fetchCycle;
      setState((s) => ({ ...s, treeLoading: true }));

      const t0 = Date.now();
      const l: StorageLogEntry[] = [];
      appendLog({ level: "info", source: "tree", message: `du -d 1 ${rootPath}…` }, cycle, l);
      flushLogs(l);

      const children = await safe("storage_scan_path", () => storageScanPath(rootPath, 1));
      const dt = Date.now() - t0;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current) return;

      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: children ? "info" : "warn",
          source: "tree",
          message: children
            ? `${String(children.length)} entries in ${String(dt)}ms`
            : `scan failed for ${rootPath}`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);

      const root: TreeNode = {
        path: rootPath,
        name: makeName(rootPath) || rootPath,
        size_bytes: children?.reduce((s, c) => s + c.size_bytes, 0) ?? 0,
        expanded: true,
        loading: false,
        children: (children ?? []).map((c) => ({
          path: c.path,
          name: makeName(c.path),
          size_bytes: c.size_bytes,
          children: null,
          loading: false,
          expanded: false,
        })),
      };

      setState((s) => ({ ...s, treeRoot: root, treeLoading: false }));
    },
    [appendLog, flushLogs],
  );

  const expandNode = useCallback(
    async (path: string) => {
      // Set loading flag on the target node
      setState((s) => {
        if (!s.treeRoot) return s;
        return { ...s, treeRoot: setNodeLoading(s.treeRoot, path, true) };
      });

      const cycle = ++_fetchCycle;
      const l: StorageLogEntry[] = [];
      appendLog({ level: "info", source: "tree", message: `expand: du -d 1 ${path}…` }, cycle, l);
      flushLogs(l);

      const t0 = Date.now();
      const children = await safe("storage_scan_path", () => storageScanPath(path, 1));
      const dt = Date.now() - t0;

      if (!mountedRef.current) return;

      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: children ? "info" : "warn",
          source: "tree",
          message: children
            ? `${String(children.length)} entries — ${String(dt)}ms`
            : `expand failed: ${path}`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);

      const childNodes: TreeNode[] = (children ?? []).map((c) => ({
        path: c.path,
        name: makeName(c.path),
        size_bytes: c.size_bytes,
        children: null,
        loading: false,
        expanded: false,
      }));

      setState((s) => {
        if (!s.treeRoot) return s;
        return {
          ...s,
          treeRoot: setNodeChildren(s.treeRoot, path, childNodes),
        };
      });
    },
    [appendLog, flushLogs],
  );

  const collapseNode = useCallback((path: string) => {
    setState((s) => {
      if (!s.treeRoot) return s;
      return { ...s, treeRoot: setNodeCollapsed(s.treeRoot, path) };
    });
  }, []);

  // ── Phase 2: largest items ───────────────────────────────────────────────────

  const fetchLargestItems = useCallback(
    async (root: string) => {
      if (!mountedRef.current) return;
      const cycle = ++_fetchCycle;
      setState((s) => ({ ...s, largestLoading: true }));

      const l: StorageLogEntry[] = [];
      appendLog(
        {
          level: "info",
          source: "largest",
          message: `Fetching largest files & folders under ${root}…`,
        },
        cycle,
        l,
      );
      flushLogs(l);

      const t0 = Date.now();
      const [files, folders] = await Promise.all([
        safe("storage_largest_items_files", () => storageLargestItems(root, "files", 200)),
        safe("storage_largest_items_folders", () => storageLargestItems(root, "folders", 200)),
      ]);
      const dt = Date.now() - t0;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current) return;

      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: "info",
          source: "largest",
          message: `${String((files ?? []).length)} files, ${String((folders ?? []).length)} folders — ${String(dt)}ms`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);

      setState((s) => ({
        ...s,
        largestLoading: false,
        largestFiles: files ?? s.largestFiles,
        largestFolders: folders ?? s.largestFolders,
      }));
    },
    [appendLog, flushLogs],
  );

  /**
   * Delete a single entry (file OR folder) from the largest-items table, then
   * optimistically remove the row so the UI updates without re-scanning.
   *
   * Rethrows on failure so the caller (DeleteConfirmDialog) can show the error
   * inline and leave the row in place.
   */
  const deleteLargestItem = useCallback(
    async (path: string, kind: "file" | "folder", useSudo = false) => {
      const cycle = ++_fetchCycle;
      const l: StorageLogEntry[] = [];
      appendLog(
        {
          level: "info",
          source: "largest",
          message: `Deleting ${kind}${useSudo ? " (sudo)" : ""}: ${path}`,
        },
        cycle,
        l,
      );
      flushLogs(l);

      try {
        if (useSudo) await deletePathSudo(path);
        else await deletePath(path);
      } catch (e) {
        // Tauri `AppError` comes across as a plain `{ code, message }` object,
        // not an Error instance — extract `.message` explicitly so logs and
        // toasts don't render `[object Object]`.
        let msg: string;
        if (e instanceof Error) msg = e.message;
        else if (e && typeof e === "object" && "message" in e) msg = String(e.message);
        else msg = String(e);
        const l2: StorageLogEntry[] = [];
        appendLog(
          { level: "error", source: "largest", message: `Delete failed: ${msg}` },
          cycle,
          l2,
        );
        flushLogs(l2);
        throw e;
      }

      const l3: StorageLogEntry[] = [];
      appendLog(
        { level: "info", source: "largest", message: `Deleted ${path}` },
        cycle,
        l3,
      );
      flushLogs(l3);

      // Optimistic removal — the deleted path drops out of both lists.
      setState((s) => ({
        ...s,
        largestFiles: s.largestFiles.filter((f) => f.path !== path),
        largestFolders: s.largestFolders.filter((f) => f.path !== path),
      }));
    },
    [appendLog, flushLogs],
  );

  // ── Phase 4: Cleanup + Duplicates ───────────────────────────────────────────

  const checkSudoAvailable = useCallback(async () => {
    if (!mountedRef.current) return;
    const cycle = ++_fetchCycle;
    const l: StorageLogEntry[] = [];
    appendLog({ level: "info", source: "sudo-check", message: "sudo -n true…" }, cycle, l);
    flushLogs(l);
    const result = await safe("storage_check_sudo", storageCheckSudo);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!mountedRef.current) return;
    const l2: StorageLogEntry[] = [];
    appendLog(
      {
        level: "info",
        source: "sudo-check",
        message: result ? "Passwordless sudo available" : "No passwordless sudo",
      },
      cycle,
      l2,
    );
    flushLogs(l2);
    setState((s) => ({ ...s, sudoAvailable: result ?? false }));
  }, [appendLog, flushLogs]);

  const runCleanupEstimate = useCallback(
    async (target: string): Promise<CleanupEstimate | null> => {
      if (!mountedRef.current) return null;
      const cycle = ++_fetchCycle;
      const l: StorageLogEntry[] = [];
      appendLog(
        { level: "info", source: "cleanup-estimate", message: `Estimating ${target}…` },
        cycle,
        l,
      );
      flushLogs(l);
      const t0 = Date.now();
      const result = await safe("storage_cleanup_estimate", () => storageCleanupEstimate(target));
      const dt = Date.now() - t0;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current) return null;
      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: result ? "info" : "warn",
          source: "cleanup-estimate",
          message: result
            ? `${target}: ${result.estimated_bytes.toLocaleString()} bytes — ${String(dt)}ms`
            : `estimate failed for ${target}`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);
      return result;
    },
    [appendLog, flushLogs],
  );

  const runCleanupPreview = useCallback(
    async (target: string): Promise<CleanupPreview | null> => {
      if (!mountedRef.current) return null;
      const cycle = ++_fetchCycle;
      const l: StorageLogEntry[] = [];
      appendLog(
        { level: "info", source: "cleanup-preview", message: `Listing items for ${target}…` },
        cycle,
        l,
      );
      flushLogs(l);
      const t0 = Date.now();
      const result = await safe("storage_cleanup_preview", () => storageCleanupPreview(target));
      const dt = Date.now() - t0;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current) return null;
      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: result ? "info" : "warn",
          source: "cleanup-preview",
          message: result
            ? `${target}: ${result.itemCount.toString()} item(s), ${result.totalBytes.toLocaleString()} bytes — ${String(dt)}ms`
            : `preview failed for ${target}`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);
      return result;
    },
    [appendLog, flushLogs],
  );

  const runCleanupExecute = useCallback(
    async (target: string, sudoPassword?: string): Promise<CleanupResult | null> => {
      if (!mountedRef.current) return null;
      const cycle = ++_fetchCycle;
      const l: StorageLogEntry[] = [];
      appendLog(
        { level: "info", source: "cleanup-execute", message: `Executing ${target}…` },
        cycle,
        l,
      );
      flushLogs(l);
      const t0 = Date.now();
      const result = await safe("storage_cleanup_execute", () =>
        storageCleanupExecute(target, sudoPassword),
      );
      const dt = Date.now() - t0;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current) return null;
      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: result?.exit_code === 0 ? "info" : "warn",
          source: "cleanup-execute",
          message: result
            ? `${target} exit=${String(result.exit_code)} — ${String(dt)}ms`
            : `${target} failed`,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          detail: result?.stderr?.slice(0, 300) ?? undefined,
        },
        cycle,
        l2,
      );
      flushLogs(l2);
      return result;
    },
    [appendLog, flushLogs],
  );

  const startFindDuplicates = useCallback(
    async (root: string, minSizeBytes: number, maxDepth: number) => {
      if (!mountedRef.current) return;
      const cycle = ++_fetchCycle;
      setState((s) => ({ ...s, duplicatesLoading: true }));
      const l: StorageLogEntry[] = [];
      appendLog(
        {
          level: "info",
          source: "duplicates",
          message: `find duplicates: root=${root} minSize=${String(minSizeBytes)} depth=${String(maxDepth)}…`,
        },
        cycle,
        l,
      );
      flushLogs(l);
      const t0 = Date.now();
      const groups = await safe("storage_find_duplicates", () =>
        storageFindDuplicates(root, minSizeBytes, maxDepth),
      );
      const dt = Date.now() - t0;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!mountedRef.current) return;
      const l2: StorageLogEntry[] = [];
      appendLog(
        {
          level: groups ? "info" : "warn",
          source: "duplicates",
          message: groups
            ? `${String(groups.length)} duplicate groups — ${String(dt)}ms`
            : `duplicate scan failed`,
        },
        cycle,
        l2,
      );
      flushLogs(l2);
      setState((s) => ({
        ...s,
        duplicatesLoading: false,
        duplicates: groups ?? s.duplicates,
      }));
    },
    [appendLog, flushLogs],
  );

  // Auto-refresh overview every 30 seconds (mounts only, not du)
  useEffect(() => {
    mountedRef.current = true;
    void fetchOverview();

    const interval = setInterval(() => {
      void fetchOverview();
    }, 30_000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
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
  };
}

// ── Tree mutation helpers (pure) ──────────────────────────────────────────────

function setNodeLoading(node: TreeNode, path: string, loading: boolean): TreeNode {
  if (node.path === path) return { ...node, loading, expanded: true };
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => setNodeLoading(c, path, loading)) };
}

function setNodeChildren(node: TreeNode, path: string, children: TreeNode[]): TreeNode {
  if (node.path === path) return { ...node, children, loading: false, expanded: true };
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => setNodeChildren(c, path, children)) };
}

function setNodeCollapsed(node: TreeNode, path: string): TreeNode {
  if (node.path === path) return { ...node, expanded: false };
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => setNodeCollapsed(c, path)) };
}
