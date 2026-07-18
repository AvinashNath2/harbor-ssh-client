import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found in index.html");

// StrictMode is intentionally OFF: it double-mounts effects in dev, which
// spawns two SSH terminal sessions per XTermView and confuses xterm's fit
// pipeline (dispose + remount races). Turn back on when the terminal code
// is fully idempotent to double-mount.
ReactDOM.createRoot(rootElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
