import { useCallback, useEffect, useRef, useState } from "react";
import { getLocalHome, listLocalFolder, type LocalFileEntry } from "../api";
import { CACHE_MIN_ENTRIES, dirCache, LOCAL_CACHE_SCOPE } from "../cache/dirCache";

export type LocalRefreshStatus = "idle" | "refreshing";

export interface LocalTab {
  path: string;
  entries: LocalFileEntry[];
  status: "loading" | "ready" | "error";
  error: string | null;
  history: string[];
  historyIndex: number;
  refreshStatus: LocalRefreshStatus;
  estimatedLoadMs: number | null;
  refreshStartedAt: number | null;
}

export function useLocalFiles() {
  const [tab, setTab] = useState<LocalTab>({
    path: "",
    entries: [],
    status: "loading",
    error: null,
    history: [],
    historyIndex: -1,
    refreshStatus: "idle",
    estimatedLoadMs: null,
    refreshStartedAt: null,
  });

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [homeDir, setHomeDir] = useState<string>("");
  const inflightRef = useRef(0);

  const loadPath = useCallback(async (path: string, pushHistory = true, forceRefresh = false) => {
    const seq = ++inflightRef.current;
    const loadStart = Date.now();

    const cachedMeta = !forceRefresh
      ? dirCache.getWithMeta<LocalFileEntry>(LOCAL_CACHE_SCOPE, path)
      : null;
    const hadCache = cachedMeta !== null;

    if (cachedMeta) {
      setTab((prev) => ({
        ...prev,
        path,
        entries: cachedMeta.entries,
        status: "ready",
        error: null,
        refreshStatus: "refreshing",
        estimatedLoadMs: cachedMeta.loadDurationMs,
        refreshStartedAt: loadStart,
        history: pushHistory
          ? [...prev.history.slice(0, prev.historyIndex + 1), path]
          : prev.history,
        historyIndex: pushHistory ? prev.historyIndex + 1 : prev.historyIndex,
      }));
    } else {
      setTab((prev) => ({
        ...prev,
        path,
        status: "loading",
        error: null,
        refreshStatus: "idle",
        entries: [],
        estimatedLoadMs: null,
        refreshStartedAt: loadStart,
        history: pushHistory
          ? [...prev.history.slice(0, prev.historyIndex + 1), path]
          : prev.history,
        historyIndex: pushHistory ? prev.historyIndex + 1 : prev.historyIndex,
      }));
    }

    try {
      const entries = await listLocalFolder(path);
      if (inflightRef.current !== seq) return;

      const loadDurationMs = Date.now() - loadStart;
      if (entries.length >= CACHE_MIN_ENTRIES) {
        dirCache.set(LOCAL_CACHE_SCOPE, path, entries, loadDurationMs);
      }

      setTab((prev) => ({
        ...prev,
        entries,
        status: "ready",
        refreshStatus: "idle",
        estimatedLoadMs: loadDurationMs,
        refreshStartedAt: null,
      }));
    } catch (e) {
      if (inflightRef.current !== seq) return;
      const msg = extractMsg(e);
      if (hadCache) {
        setTab((prev) => ({
          ...prev,
          status: "ready",
          refreshStatus: "idle",
          refreshStartedAt: null,
        }));
      } else {
        setTab((prev) => ({ ...prev, status: "error", error: msg }));
      }
    }
  }, []);

  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    void (async () => {
      try {
        const home = await getLocalHome();
        setHomeDir(home);
        await loadPath(home, false);
        setTab((prev) => ({
          ...prev,
          history: [home],
          historyIndex: 0,
        }));
      } catch {
        setTab((prev) => ({ ...prev, status: "error", error: "Cannot read home directory" }));
      }
    })();
  }, [loadPath]);

  const navigateTo = useCallback(
    (path: string) => {
      void loadPath(path, true);
    },
    [loadPath],
  );

  const goBack = useCallback(() => {
    const current = tabRef.current;
    if (current.historyIndex <= 0) return;
    const newIndex = current.historyIndex - 1;
    const targetPath = current.history[newIndex];
    if (!targetPath) return;
    setTab((prev) => ({ ...prev, historyIndex: newIndex, path: targetPath }));
    void loadPath(targetPath, false);
  }, [loadPath]);

  const goForward = useCallback(() => {
    const current = tabRef.current;
    if (current.historyIndex >= current.history.length - 1) return;
    const newIndex = current.historyIndex + 1;
    const targetPath = current.history[newIndex];
    if (!targetPath) return;
    setTab((prev) => ({ ...prev, historyIndex: newIndex, path: targetPath }));
    void loadPath(targetPath, false);
  }, [loadPath]);

  const reload = useCallback(() => {
    const current = tabRef.current;
    if (current.path) {
      dirCache.invalidate(LOCAL_CACHE_SCOPE, current.path);
      void loadPath(current.path, false, true);
    }
  }, [loadPath]);

  const invalidatePathCache = useCallback((path: string) => {
    dirCache.invalidateParent(LOCAL_CACHE_SCOPE, path);
  }, []);

  const canGoBack = tab.historyIndex > 0;
  const canGoForward = tab.historyIndex < tab.history.length - 1;

  return {
    tab,
    navigateTo,
    goBack,
    goForward,
    reload,
    invalidatePathCache,
    canGoBack,
    canGoForward,
    homeDir,
  };
}

function extractMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  if (e instanceof Error) return e.message;
  return String(e);
}
