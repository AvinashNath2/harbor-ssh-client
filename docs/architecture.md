# Architecture

This page is for contributors who want to understand HarborSCP's internals.

## Overview

HarborSCP is a [Tauri 2](https://tauri.app) app: a Rust backend embedded in a WebView-based desktop window. The React frontend communicates with the Rust backend via Tauri's IPC bridge (type-safe `invoke` calls).

```
┌─────────────────────────────────────────────┐
│  React Frontend (WebView)                   │
│  src/api/tauri.ts  →  invoke("command", …)  │
└────────────────┬────────────────────────────┘
                 │ Tauri IPC (JSON)
┌────────────────▼────────────────────────────┐
│  Rust Backend (src-tauri/src/)              │
│  commands/ → ssh/ → libssh2 → SSH server   │
└─────────────────────────────────────────────┘
```

---

## Key constraint: `ssh2::Session` is `!Send`

The `ssh2` crate wraps `libssh2`, which is not thread-safe. `Session` cannot be moved across thread boundaries. This shapes the entire backend architecture:

- **Main SFTP session** lives in `SshState::inner` (Arc<Mutex<Option<SessionBundle>>>), accessed only from Tauri command threads (which run on a thread pool, but the mutex ensures serial access).
- **Each terminal tab** creates its own `SessionBundle` on its own dedicated thread — it never leaves that thread.
- **Each port-forward relay connection** creates its own `SessionBundle` on its own relay thread.

---

## `SshState` — managed application state

```rust
pub struct SshState {
    pub inner: Arc<Mutex<Option<SessionBundle>>>,       // main SFTP session
    pub creds: Arc<Mutex<Option<StoredCreds>>>,         // cached credentials for spawning sub-sessions
    pub terminals: Arc<Mutex<HashMap<String, TerminalHandle>>>,
    pub port_forwards: Arc<Mutex<HashMap<String, PortForwardHandle>>>,
    pub cancelled_transfers: Arc<Mutex<HashSet<String>>>,
}
```

`StoredCreds` is `Clone` so terminal and port-forward threads can take a copy and open their own SSH sessions independently.

---

## Command pattern

Every Rust function exposed to the frontend is a `#[tauri::command]`:

1. Defined in `src-tauri/src/commands/<module>.rs`
2. Re-exported in `src-tauri/src/commands/mod.rs`
3. Registered in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]`
4. Mirrored in `src/api/tauri.ts` as an `async function` that calls `invoke()`

---

## Terminal architecture

Each terminal tab:
1. Calls `open_terminal` (Tauri command)
2. Spawns a thread that creates a fresh `SessionBundle`, requests a PTY, starts a shell
3. Injects shell integration script (OSC 9001 markers for command tracking) silently
4. Enters a non-blocking read/write loop:
   - SSH → frontend: emits `terminal-data` events (base64-encoded)
   - Frontend → SSH: `write_terminal` sends bytes via an `mpsc::SyncSender`
5. On close: `close_terminal` sends `TerminalCmd::Close` via the channel

---

## Port forwarding architecture

Each tunnel:
1. Calls `start_port_forward` (Tauri command) → binds a `TcpListener` on `localhost:localPort`
2. Spawns a listener thread that accepts TCP connections in a non-blocking loop
3. Each accepted connection spawns a relay thread:
   - Creates a fresh `SessionBundle`
   - Calls `session.channel_direct_tcpip(remoteHost, remotePort, None)`
   - Runs a non-blocking bi-directional copy loop between the local TCP stream and the SSH channel
4. The listener thread checks a `mpsc::Receiver<()>` for a stop signal between accepts
5. `stop_port_forward` sends the stop signal; `stop_all_port_forwards` sends it to all

---

## Database schema

Session history is stored in `sessions.db` (SQLite):

```sql
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  host         TEXT NOT NULL,
  ip           TEXT NOT NULL,
  username     TEXT NOT NULL,
  started_at   INTEGER NOT NULL,       -- Unix ms
  ended_at     INTEGER,                -- NULL if orphaned
  cmd_count    INTEGER NOT NULL DEFAULT 0,
  profile_id   TEXT,
  profile_name TEXT
);

CREATE TABLE commands (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  idx                   INTEGER NOT NULL,
  executed_at           INTEGER NOT NULL,    -- Unix ms
  cwd                   TEXT NOT NULL,
  raw                   TEXT NOT NULL,       -- command text
  exit_code             INTEGER,
  duration_ms           INTEGER,
  output                TEXT,                -- captured stdout (truncated at 64KB)
  output_truncated      INTEGER NOT NULL DEFAULT 0,
  original_output_bytes INTEGER NOT NULL DEFAULT 0,
  source                TEXT                 -- "terminal" or "file_browser"
);
```

On startup, any sessions with `ended_at IS NULL` (orphaned by a crash) are closed with the current timestamp.

---

## Frontend hooks

Key custom hooks:

| Hook | Purpose |
|---|---|
| `useConnection` | Single SSH connection state machine — singleton |
| `useTabs` | Remote browser tab history (per-tab navigation stack) |
| `useLocalFiles` | Local filesystem browsing state |
| `useTransferQueue` | Upload/download queue with progress events |
| `usePortForwards` | Port forward tunnel state + `pf-error` event listener |
| `useSessionLog` | Creates/closes DB session, exposes `logCommand` |
| `useResizable` | Drag-to-resize panel dimensions with localStorage persistence |
| `useConnectionWatchdog` | Periodic SSH keepalive pings; triggers reconnect on failure |
