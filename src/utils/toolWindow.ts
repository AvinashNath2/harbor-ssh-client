import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";

export type ToolView = "javaMonitor" | "dataProfiler" | "sessionLog";

export interface ToolParams {
  host?: string;
  username?: string;
  osInfo?: string; // only used by dataProfiler
}

const TITLES: Record<ToolView, string> = {
  javaMonitor: "Java Process Monitor",
  dataProfiler: "Data Profiler",
  sessionLog: "Session Log",
};

/**
 * Open a tool page in a separate native window. If the same tool window is
 * already open, focus it instead of spawning a duplicate. Window label matches
 * the `tool-*` glob in `src-tauri/capabilities/default.json` so the child
 * window inherits the same capabilities as the main window.
 */
export async function openToolWindow(view: ToolView, params: ToolParams = {}) {
  const label = `tool-${view}`;

  const existing = (await getAllWebviewWindows()).find((w) => w.label === label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const query = new URLSearchParams({ view });
  if (params.host) query.set("host", params.host);
  if (params.username) query.set("username", params.username);
  if (params.osInfo) query.set("osInfo", params.osInfo);

  new WebviewWindow(label, {
    url: `index.html?${query.toString()}`,
    title: `HarborSCP — ${TITLES[view]}`,
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
  });
}
