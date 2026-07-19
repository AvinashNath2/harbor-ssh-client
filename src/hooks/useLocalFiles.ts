import { useCallback, useEffect, useRef, useState } from "react";
import { getLocalHome, listLocalFolder, type LocalFileEntry } from "../api";

export interface LocalTab {
  path: string;
  entries: LocalFileEntry[];
  status: "loading" | "ready" | "error";
  error: string | null;
  history: string[];
  historyIndex: number;
}

export function useLocalFiles() {
  const [tab, setTab] = useState<LocalTab>({
    path: "",
    entries: [],
    status: "loading",
    error: null,
    history: [],
    historyIndex: -1,
  });

  // Keep a ref to the current tab so callbacks can read current state without
  // capturing stale closures and without needing tab as a dependency.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [homeDir, setHomeDir] = useState<string>("");

  const loadPath = useCallback(async (path: string, pushHistory = true) => {
    setTab((prev) => ({
      ...prev,
      path,
      status: "loading",
      error: null,
      history: pushHistory ? [...prev.history.slice(0, prev.historyIndex + 1), path] : prev.history,
      historyIndex: pushHistory ? prev.historyIndex + 1 : prev.historyIndex,
    }));

    try {
      const entries = await listLocalFolder(path);
      setTab((prev) => ({ ...prev, entries, status: "ready" }));
    } catch (e) {
      const msg = extractMsg(e);
      setTab((prev) => ({ ...prev, status: "error", error: msg }));
    }
  }, []);

  // Bootstrap from home directory.
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

  // Read current state from the ref to avoid side effects inside updaters.
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
    if (current.path) void loadPath(current.path, false);
  }, [loadPath]);

  const canGoBack = tab.historyIndex > 0;
  const canGoForward = tab.historyIndex < tab.history.length - 1;

  return { tab, navigateTo, goBack, goForward, reload, canGoBack, canGoForward, homeDir };
}

function extractMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  if (e instanceof Error) return e.message;
  return String(e);
}
