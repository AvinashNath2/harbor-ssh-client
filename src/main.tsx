import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./App.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProcessMonitorPage } from "./components/ProcessMonitorPage";
import { SessionLogPage } from "./components/SessionLogPage";
import { StorageAnalyzerPage } from "./components/StorageAnalyzerPage";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found in index.html");

// StrictMode is intentionally OFF: it double-mounts effects in dev, which
// spawns two SSH terminal sessions per XTermView and confuses xterm's fit
// pipeline (dispose + remount races). Turn back on when the terminal code
// is fully idempotent to double-mount.

// ── Disable "Inspect Element" access across every window ────────────────────
// Runs once, globally, so main + all tool windows (dataProfiler, javaMonitor,
// sessionLog) inherit it — moving it here fixes the previous gap where child
// windows still exposed the WebKit context menu.
//
// Right-click context menu is blocked in ALL builds (xterm.js's own selection
// menu is exempted so terminals still work). Devtools keyboard shortcuts are
// only blocked in production — dev still needs F12 for debugging.
function installInspectionBlockers() {
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest(".xterm")) return; // xterm.js manages its own menu / selection
    e.preventDefault();
  });

  if (!import.meta.env.PROD) return;

  // Common devtools shortcuts across macOS / Windows / Linux WebKit builds.
  document.addEventListener("keydown", (e) => {
    const cmd = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    // F12 anywhere
    if (e.key === "F12") {
      e.preventDefault();
      return;
    }
    // Cmd/Ctrl + Shift + I / J / C  → devtools / console / element picker
    if (cmd && e.shiftKey && (key === "i" || key === "j" || key === "c")) {
      e.preventDefault();
      return;
    }
    // macOS: Cmd + Opt + I / J / C  (Safari-style)
    if (e.metaKey && e.altKey && (key === "i" || key === "j" || key === "c")) {
      e.preventDefault();
      return;
    }
    // Cmd/Ctrl + U → View Source
    if (cmd && !e.shiftKey && !e.altKey && key === "u") {
      e.preventDefault();
    }
  });
}
installInspectionBlockers();

// Tool child windows share the same bundle as the main window; they set
// ?view=... in the URL to render just the tool page instead of the full app.
const params = new URLSearchParams(window.location.search);
const view = params.get("view");

function closeSelf() {
  void getCurrentWebviewWindow().close();
}

function renderRoot() {
  const host = params.get("host") ?? "";
  const username = params.get("username") ?? "";
  const osInfo = params.get("osInfo") ?? undefined;
  const defaultPath = params.get("defaultPath") ?? undefined;

  switch (view) {
    case "javaMonitor":
      return <ProcessMonitorPage host={host} username={username} onClose={closeSelf} />;
    case "dataProfiler":
      return (
        <StorageAnalyzerPage
          host={host}
          username={username}
          osInfo={osInfo}
          defaultScanPath={defaultPath}
          onClose={closeSelf}
        />
      );
    case "sessionLog":
      return <SessionLogPage onClose={closeSelf} />;
    default:
      return <App />;
  }
}

ReactDOM.createRoot(rootElement).render(<ErrorBoundary>{renderRoot()}</ErrorBoundary>);
