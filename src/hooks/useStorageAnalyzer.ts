import { useCallback, useEffect, useRef, useState } from "react";
import {
  storageAgeHistogram,
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

  const startDeepScan = useCallback(async () => {
    if (!mountedRef.current) return;
    deepScanAbortRef.current = false;
    const cycle = ++_fetchCycle;

    setState((s) => ({ ...s, deepScanning: true, error: null }));
    const l0: StorageLogEntry[] = [];
    appendLog(
      { level: "info", source: "deep-scan", message: "Starting: du -x -B1 -d 1 /…" },
      cycle,
      l0,
    );
    flushLogs(l0);

    const t0 = Date.now();
    const rootFolders = await safe("storage_scan_root", () => storageScanRoot(1));
    const dt1 = Date.now() - t0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!mountedRef.current || deepScanAbortRef.current) {
      setState((s) => ({ ...s, deepScanning: false }));
      return;
    }

    const l1: StorageLogEntry[] = [];
    if (rootFolders) {
      appendLog(
        {
          level: "info",
          source: "deep-scan",
          message: `du complete — ${String(rootFolders.length)} entries in ${String(dt1)}ms`,
        },
        cycle,
        l1,
      );
      setState((s) => ({ ...s, rootFolders }));
    } else {
      appendLog({ level: "warn", source: "deep-scan", message: "du returned no data" }, cycle, l1);
    }
    flushLogs(l1);

    const l2: StorageLogEntry[] = [];
    appendLog(
      { level: "info", source: "age-histogram", message: "Running find / -printf mtime…" },
      cycle,
      l2,
    );
    flushLogs(l2);

    const t2 = Date.now();
    const ageHistogram = await safe("storage_age_histogram", () => storageAgeHistogram("/"));
    const dt2 = Date.now() - t2;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!mountedRef.current || deepScanAbortRef.current) {
      setState((s) => ({ ...s, deepScanning: false }));
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
      appendLog({ level: "warn", source: "age-histogram", message: "histogram failed" }, cycle, l3);
    }

    setState((s) => ({
      ...s,
      ageHistogram: ageHistogram ?? s.ageHistogram,
    }));
    flushLogs(l3);

    // ── Phase 3: category sizes ───────────────────────────────────────────────
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
      setState((s) => ({ ...s, deepScanning: false }));
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
        categories,
        categoryRawSizes: catSizes,
      }));
    } else {
      appendLog(
        { level: "warn", source: "categorize", message: "category sizes failed" },
        cycle,
        l5,
      );
      setState((s) => ({ ...s, deepScanning: false, lastDeepScan: Date.now() }));
    }
    flushLogs(l5);
  }, [appendLog, flushLogs]);

  const cancelDeepScan = useCallback(() => {
    deepScanAbortRef.current = true;
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
