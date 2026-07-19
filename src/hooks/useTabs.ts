import { useCallback, useEffect, useRef, useState } from "react";
import { listFolder, type AppError, type FileEntry } from "../api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  path: string;
  entries: FileEntry[];
  status: "loading" | "ready" | "error";
  error: string | null;
  history: string[];
  historyIndex: number;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * `onConnectionLost` returns a boolean promise:
 *   true  → the caller successfully reconnected; loadDir will retry once.
 *   false → give up; the tab shows an error.
 */
export function useTabs(homeDir: string, onConnectionLost?: () => Promise<boolean>) {
  // Stable ref so the initial tab's ID is the same object across renders.
  const firstTabRef = useRef(makeTab(homeDir));

  const [tabs, setTabs] = useState<Tab[]>([firstTabRef.current]);
  const [activeId, setActiveId] = useState<string>(firstTabRef.current.id);

  const inflightRef = useRef<Map<string, number>>(new Map());
  // Keep callback in a ref so loadDir's useCallback closure stays stable.
  const onConnectionLostRef = useRef(onConnectionLost);
  onConnectionLostRef.current = onConnectionLost;

  // closeTab ensures tabs always has ≥ 1 entry, so tabs[0] is always defined.
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // ── Core loader ────────────────────────────────────────────────────────────

  const loadDir = useCallback(async (tabId: string, path: string) => {
    const seq = (inflightRef.current.get(tabId) ?? 0) + 1;
    inflightRef.current.set(tabId, seq);

    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, path, status: "loading", error: null } : t)),
    );

    try {
      const entries = await listFolder(path);
      if (inflightRef.current.get(tabId) !== seq) return;
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, entries, status: "ready" } : t)));
    } catch (err: unknown) {
      if (inflightRef.current.get(tabId) !== seq) return;
      if (isConnectionError(err)) {
        // Ask the outer app to try to recover. If it reports success, retry
        // this exact load once. Otherwise leave the tab in an error state so
        // the fallback disconnect flow runs.
        const cb = onConnectionLostRef.current;
        const recovered = cb ? await cb() : false;
        if (recovered) {
          try {
            const entries = await listFolder(path);
            if (inflightRef.current.get(tabId) !== seq) return;
            setTabs((prev) =>
              prev.map((t) => (t.id === tabId ? { ...t, entries, status: "ready" } : t)),
            );
            return;
          } catch (retryErr: unknown) {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === tabId ? { ...t, status: "error", error: extractMessage(retryErr) } : t,
              ),
            );
            return;
          }
        }
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, status: "error", error: extractMessage(err) } : t,
        ),
      );
    }
  }, []);

  useEffect(() => {
    void loadDir(firstTabRef.current.id, homeDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public actions ─────────────────────────────────────────────────────────

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
      const tab = makeTab(startPath);
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      void loadDir(tab.id, startPath);
    },
    [activeTab.path, loadDir],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length === 1) return prev;
        return prev.filter((t) => t.id !== tabId);
      });

      setActiveId((prev) => {
        if (prev !== tabId) return prev;
        const idx = tabs.findIndex((t) => t.id === tabId);
        const remaining = tabs.filter((t) => t.id !== tabId);
        // `Array.at` returns T | undefined, so the ?. chain is valid.
        const target = remaining.at(Math.max(0, idx - 1));
        return target?.id ?? prev;
      });
    },
    [tabs],
  );

  const reload = useCallback(() => {
    void loadDir(activeId, activeTab.path);
  }, [activeId, activeTab.path, loadDir]);

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
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTab(path: string): Tab {
  return {
    id: crypto.randomUUID(),
    path,
    entries: [],
    status: "loading",
    error: null,
    history: [path],
    historyIndex: 0,
  };
}

function isConnectionError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: string }).code;
    return code === "CONNECTION_FAILED" || code === "NOT_CONNECTED";
  }
  return false;
}

function extractMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return (err as AppError).message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}
