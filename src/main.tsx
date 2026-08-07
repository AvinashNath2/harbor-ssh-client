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

  switch (view) {
    case "javaMonitor":
      return <ProcessMonitorPage host={host} username={username} onClose={closeSelf} />;
    case "dataProfiler":
      return (
        <StorageAnalyzerPage host={host} username={username} osInfo={osInfo} onClose={closeSelf} />
      );
    case "sessionLog":
      return <SessionLogPage onClose={closeSelf} />;
    default:
      return <App />;
  }
}

ReactDOM.createRoot(rootElement).render(<ErrorBoundary>{renderRoot()}</ErrorBoundary>);
