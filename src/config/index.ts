// ── AI / Ollama ───────────────────────────────────────────────────────────────
export const OLLAMA_BASE_URL          = "http://localhost:11434";
export const AI_MAX_ITERATIONS        = 8;
export const AI_TOOL_TIMEOUT_MS       = 30_000;
export const AI_ROLLING_WINDOW        = 10;
export const AI_RECOMMENDED_MODEL     = "llama3.2:3b";

// ── SSH connection watchdog ───────────────────────────────────────────────────
export const WATCHDOG_PING_INTERVAL_MS  = 30_000;
export const WATCHDOG_FOCUS_DEBOUNCE_MS = 200;

// ── File transfer ─────────────────────────────────────────────────────────────
export const TRANSFER_MAX_CONCURRENT = 2;

// ── Directory listing cache ───────────────────────────────────────────────────
export const CACHE_MAX_DIRS    = 20;
export const CACHE_MAX_ENTRIES = 200_000;

// ── Docker Explorer ───────────────────────────────────────────────────────────
export const DOCKER_MAX_LOGS = 300;

// ── File browser UI (canonical — both FileBrowser and LocalBrowser use these) ─
export const BROWSER_COMPACT_THRESHOLD  = 560;
export const BROWSER_ROW_HEIGHT         = 33;
export const BROWSER_ROW_HEIGHT_COMPACT = 32;
export const BROWSER_GRID_COMPACT       = "16px minmax(0,1fr) 70px 110px";
export const MIME_HARBOR_LOCAL          = "application/x-harbor-local";
export const MIME_HARBOR_REMOTE         = "application/x-harbor-remote";

// ── Terminal ──────────────────────────────────────────────────────────────────
export const TERMINAL_DEFAULT_MAX_LINES = 500;
export const TERMINAL_DEFAULT_MAX_BYTES = 100 * 1024; // 100 KB

// ── Sort worker ───────────────────────────────────────────────────────────────
export const SORT_WORKER_THRESHOLD = 200;
