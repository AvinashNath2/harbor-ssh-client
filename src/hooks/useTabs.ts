import { useCallback, useEffect, useRef, useState } from "react";
import { type AppError, type FileEntry } from "../api";
import { cancelFolderList, startFolderListStream } from "../api/folderListStream";
import { CACHE_MIN_ENTRIES, dirCache } from "../cache/dirCache";
import { normalizeRemotePath } from "../utils/remotePath";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RefreshStatus = "idle" | "refreshing";

export interface Tab {
  id: string;
  path: string;
  label: string;
  entries: FileEntry[];
  status: "loading" | "ready" | "error";
  error: string | null;
  history: string[];
  historyIndex: number;
  refreshStatus: RefreshStatus;
  loadedCount: number;
  totalCount: number | null;
  /** Live folder count from in-flight stream (footer during refresh). */
  streamFolderCount: number;
  /** Live file count from in-flight stream (footer during refresh). */
  streamFileCount: number;
  /** Last known full-load duration from cache (ms), used for refresh ETA. */
  estimatedLoadMs: number | null;
  /** When the current background refresh started. */
  refreshStartedAt: number | null;
}

export interface UseTabsOptions {
  cacheScope: string;
  onFreshEntries?: (entries: FileEntry[]) => void;
  onRefreshFailed?: (message: string) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTabs(
  homeDir: string,
  connectionLabel: string,
  onConnectionLost?: () => Promise<boolean>,
  options?: UseTabsOptions,
) {
  const cacheScope = options?.cacheScope ?? connectionLabel;
  const onFreshEntriesRef = useRef(options?.onFreshEntries);
  onFreshEntriesRef.current = options?.onFreshEntries;
  const onRefreshFailedRef = useRef(options?.onRefreshFailed);
  onRefreshFailedRef.current = options?.onRefreshFailed;

  const firstTabRef = useRef(makeTab(homeDir, connectionLabel));

  const [tabs, setTabs] = useState<Tab[]>([firstTabRef.current]);
  const [activeId, setActiveId] = useState<string>(firstTabRef.current.id);

  const inflightRef = useRef<Map<string, number>>(new Map());
  const listIdRef = useRef<Map<string, string>>(new Map());
  const unlistenRef = useRef<Map<string, () => void>>(new Map());
  const pendingRef = useRef<Map<string, FileEntry[]>>(new Map());
  const hadCacheRef = useRef<Map<string, boolean>>(new Map());
  const loadStartRef = useRef<Map<string, number>>(new Map());

  const onConnectionLostRef = useRef(onConnectionLost);
  onConnectionLostRef.current = onConnectionLost;

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const cleanupStream = useCallback((tabId: string) => {
    const listId = listIdRef.current.get(tabId);
    if (listId) {
      void cancelFolderList(listId);
      listIdRef.current.delete(tabId);
    }
    unlistenRef.current.get(tabId)?.();
    unlistenRef.current.delete(tabId);
    pendingRef.current.delete(tabId);
    hadCacheRef.current.delete(tabId);
    loadStartRef.current.delete(tabId);
  }, []);

  const loadDir = useCallback(
    async (tabId: string, path: string, forceRefresh = false) => {
      const normalizedPath = normalizeRemotePath(path);
      const seq = (inflightRef.current.get(tabId) ?? 0) + 1;
      inflightRef.current.set(tabId, seq);

      cleanupStream(tabId);

      loadStartRef.current.set(tabId, Date.now());

      const cachedMeta = !forceRefresh
        ? dirCache.getWithMeta<FileEntry>(cacheScope, normalizedPath)
        : null;
      const hadCache = cachedMeta !== null;
      hadCacheRef.current.set(tabId, hadCache);

      if (cachedMeta) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  path: normalizedPath,
                  entries: cachedMeta.entries,
                  status: "ready",
                  error: null,
                  refreshStatus: "refreshing",
                  loadedCount: 0,
                  totalCount: null,
                  streamFolderCount: 0,
                  streamFileCount: 0,
                  estimatedLoadMs: cachedMeta.loadDurationMs,
                  refreshStartedAt: Date.now(),
                }
              : t,
          ),
        );
      } else {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  path: normalizedPath,
                  entries: [],
                  status: "loading",
                  error: null,
                  refreshStatus: "refreshing",
                  loadedCount: 0,
                  totalCount: null,
                  streamFolderCount: 0,
                  streamFileCount: 0,
                  estimatedLoadMs: null,
                  refreshStartedAt: Date.now(),
                }
              : t,
          ),
        );
      }

      pendingRef.current.set(tabId, []);

      const listId = crypto.randomUUID();
      listIdRef.current.set(tabId, listId);

      let rafPending = false;
      const flushPending = () => {
        rafPending = false;
        if (inflightRef.current.get(tabId) !== seq) return;
        const pending = pendingRef.current.get(tabId) ?? [];
        if (pending.length === 0) return;

        if (hadCacheRef.current.get(tabId)) return;

        const preview = countStreamPreview(pending);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  entries: [...pending],
                  status: "loading",
                  loadedCount: pending.length,
                  streamFolderCount: preview.streamFolderCount,
                  streamFileCount: preview.streamFileCount,
                }
              : t,
          ),
        );
      };

      const scheduleFlush = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(flushPending);
      };

      try {
        const unlisten = await startFolderListStream(normalizedPath, listId, {
          onChunk: (chunk) => {
            if (inflightRef.current.get(tabId) !== seq) return;
            const pending = pendingRef.current.get(tabId) ?? [];
            pending.push(...chunk.entries);
            pendingRef.current.set(tabId, pending);

            const preview = countStreamPreview(pending);
            const progress = {
              loadedCount: pending.length,
              streamFolderCount: preview.streamFolderCount,
              streamFileCount: preview.streamFileCount,
            };

            if (hadCacheRef.current.get(tabId)) {
              setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...progress } : t)));
            } else {
              setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...progress } : t)));
              scheduleFlush();
            }
          },
          onDone: (total) => {
            if (inflightRef.current.get(tabId) !== seq) return;
            const fresh = pendingRef.current.get(tabId) ?? [];
            const loadDurationMs = Date.now() - (loadStartRef.current.get(tabId) ?? Date.now());

            if (fresh.length >= CACHE_MIN_ENTRIES) {
              dirCache.set(cacheScope, normalizedPath, fresh, loadDurationMs);
            }

            setTabs((prev) =>
              prev.map((t) =>
                t.id === tabId
                  ? {
                      ...t,
                      entries: fresh,
                      status: "ready",
                      refreshStatus: "idle",
                      loadedCount: fresh.length,
                      totalCount: total,
                      streamFolderCount: 0,
                      streamFileCount: 0,
                      estimatedLoadMs: loadDurationMs,
                      refreshStartedAt: null,
                    }
                  : t,
              ),
            );

            onFreshEntriesRef.current?.(fresh);
            cleanupStream(tabId);
          },
          onError: (message) => {
            if (inflightRef.current.get(tabId) !== seq) return;

            if (hadCacheRef.current.get(tabId)) {
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === tabId ? { ...t, refreshStatus: "idle", status: "ready" } : t,
                ),
              );
              onRefreshFailedRef.current?.(message);
            } else if (isConnectionMessage(message)) {
              void tryRecoverAndRetry(tabId, normalizedPath, seq);
            } else {
              setTabs((prev) =>
                prev.map((t) => (t.id === tabId ? { ...t, status: "error", error: message } : t)),
              );
            }
            cleanupStream(tabId);
          },
        });

        unlistenRef.current.set(tabId, unlisten);
      } catch (err: unknown) {
        if (inflightRef.current.get(tabId) !== seq) return;
        if (hadCache) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, refreshStatus: "idle", status: "ready" } : t,
            ),
          );
          onRefreshFailedRef.current?.(extractMessage(err));
        } else if (isConnectionMessage(extractMessage(err))) {
          await tryRecoverAndRetry(tabId, normalizedPath, seq);
        } else {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, status: "error", error: extractMessage(err) } : t,
            ),
          );
        }
        cleanupStream(tabId);
      }

      async function tryRecoverAndRetry(tid: string, npath: string, expectedSeq: number) {
        const cb = onConnectionLostRef.current;
        const recovered = cb ? await cb() : false;
        if (recovered && inflightRef.current.get(tid) === expectedSeq) {
          await loadDir(tid, npath, forceRefresh);
        } else {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tid ? { ...t, status: "error", error: "Connection lost" } : t,
            ),
          );
        }
      }
    },
    [cacheScope, cleanupStream],
  );

  useEffect(() => {
    void loadDir(firstTabRef.current.id, homeDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const activeStreams = listIdRef.current;
    return () => {
      for (const tabId of activeStreams.keys()) cleanupStream(tabId);
    };
  }, [cleanupStream]);

  const navigateTo = useCallback(
    (tabId: string, path: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const newHistory = [...t.history.slice(0, t.historyIndex + 1), path];
          return { ...t, history: newHistory, historyIndex: newHistory.length - 1 };
        }),
      );
      void loadDir(tabId, path);
    },
    [loadDir],
  );

  const goBack = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || tab.historyIndex <= 0) return;
      const newIndex = tab.historyIndex - 1;
      const targetPath = tab.history[newIndex];
      if (!targetPath) return;
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, historyIndex: newIndex, path: targetPath } : t)),
      );
      void loadDir(tabId, targetPath);
    },
    [tabs, loadDir],
  );

  const goForward = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || tab.historyIndex >= tab.history.length - 1) return;
      const newIndex = tab.historyIndex + 1;
      const targetPath = tab.history[newIndex];
      if (!targetPath) return;
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, historyIndex: newIndex, path: targetPath } : t)),
      );
      void loadDir(tabId, targetPath);
    },
    [tabs, loadDir],
  );

  const openTab = useCallback(
    (path?: string) => {
      const startPath = path ?? activeTab.path;
      const tab = makeTab(startPath, connectionLabel);
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      void loadDir(tab.id, startPath);
    },
    [activeTab.path, connectionLabel, loadDir],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      cleanupStream(tabId);
      setTabs((prev) => {
        if (prev.length === 1) return prev;
        return prev.filter((t) => t.id !== tabId);
      });

      setActiveId((prev) => {
        if (prev !== tabId) return prev;
        const idx = tabs.findIndex((t) => t.id === tabId);
        const remaining = tabs.filter((t) => t.id !== tabId);
        const target = remaining.at(Math.max(0, idx - 1));
        return target?.id ?? prev;
      });
    },
    [tabs, cleanupStream],
  );

  const reload = useCallback(() => {
    dirCache.invalidate(cacheScope, activeTab.path);
    void loadDir(activeId, activeTab.path, true);
  }, [activeId, activeTab.path, cacheScope, loadDir]);

  const invalidatePathCache = useCallback(
    (path: string) => {
      dirCache.invalidateParent(cacheScope, normalizeRemotePath(path));
    },
    [cacheScope],
  );

  return {
    tabs,
    activeId,
    activeTab,
    activateTab: setActiveId,
    navigateTo,
    goBack,
    goForward,
    openTab,
    closeTab,
    reload,
    invalidatePathCache,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countStreamPreview(entries: FileEntry[]): {
  streamFolderCount: number;
  streamFileCount: number;
} {
  let streamFolderCount = 0;
  let streamFileCount = 0;
  for (const e of entries) {
    if (e.kind === "directory") streamFolderCount++;
    else streamFileCount++;
  }
  return { streamFolderCount, streamFileCount };
}

function makeTab(path: string, label: string): Tab {
  return {
    id: crypto.randomUUID(),
    path,
    label,
    entries: [],
    status: "loading",
    error: null,
    history: [path],
    historyIndex: 0,
    refreshStatus: "idle",
    loadedCount: 0,
    totalCount: null,
    streamFolderCount: 0,
    streamFileCount: 0,
    estimatedLoadMs: null,
    refreshStartedAt: null,
  };
}

function isConnectionMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("not connected") || m.includes("connection failed") || m.includes("connection reset")
  );
}

function extractMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return (err as AppError).message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}
