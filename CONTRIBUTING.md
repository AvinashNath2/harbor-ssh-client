# Contributing to HarborSCP

Thank you for your interest in contributing! This guide covers everything you need to get started.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Rust | stable | Install via [rustup.rs](https://rustup.rs) |
| Node.js | 20+ | Install via [nodejs.org](https://nodejs.org) or `nvm` |
| Xcode CLI | latest | macOS only — `xcode-select --install` |
| MSVC Build Tools | 2022 | Windows only — via Visual Studio Installer |
| `libssh-dev` / `libwebkit2gtk-4.1-dev` | — | Linux only — see below |

### Linux system dependencies (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssh-dev
```

---

## Building from source

```bash
# 1. Clone
git clone https://github.com/AvinashNath2/harbor-ssh-client.git
cd harbor-ssh-client

# 2. Install frontend dependencies
npm install

# 3. Start the dev server (hot-reload frontend + Tauri backend)
npm run tauri dev
```

The app window opens automatically. Frontend changes hot-reload instantly; Rust changes trigger an automatic recompile (takes a few seconds).

To build a production binary:

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/
```

---

## Project structure

```
harbor-ssh-client/
├── src/                        # React/TypeScript frontend
│   ├── api/                    # Tauri IPC bridge (tauri.ts + index.ts)
│   ├── components/             # UI components (FileBrowser, Terminal, etc.)
│   ├── hooks/                  # Custom React hooks (useConnection, useTransferQueue, etc.)
│   └── App.tsx                 # Root component + layout
├── src-tauri/
│   └── src/
│       ├── commands/           # Tauri command handlers (fs.rs, terminal.rs, port_forward.rs, …)
│       ├── ssh/mod.rs          # SSH session management, SshState, SessionBundle
│       ├── models/mod.rs       # Shared data types (AppError, FileEntry, ConnectResult, …)
│       ├── db.rs               # SQLite session log schema + migrations
│       └── lib.rs              # Command registration + app setup
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # CI — type check, lint, cargo check/clippy on all platforms
│   │   └── release.yml         # Release — builds binaries and creates GitHub Release
│   └── ISSUE_TEMPLATE/         # Bug report + feature request templates
└── docs/                       # Documentation (served via GitHub Pages)
```

---

## Code style

### TypeScript / React

- **ESLint + Prettier** are enforced via Husky pre-commit hooks — you don't need to run them manually.
- To run manually: `npm run lint` / `npm run format`
- To type-check: `npm run typecheck`

### Rust

- `rustfmt` for formatting (pre-commit hook applies it automatically to staged `.rs` files)
- `cargo clippy -- -D warnings` for lints
- Run manually: `cargo fmt` / `cargo clippy`

---

## Architecture notes

A few non-obvious things to know before touching the Rust backend:

1. **`ssh2::Session` is `!Send`** — it cannot cross thread boundaries. Every terminal tab and every port-forward relay connection creates its own `SessionBundle` (fresh SSH session) on its own thread. Never try to share a `Session` across threads.

2. **`SshState`** is the Tauri managed state struct. It holds:
   - `inner` — the main SFTP session (`Option<SessionBundle>`)
   - `creds` — cached `StoredCreds` (used by terminal/port-forward threads to create their own sessions)
   - `terminals` — active terminal thread handles
   - `port_forwards` — active port-forward listener handles
   - `cancelled_transfers` — set of cancelled transfer IDs

3. **New Tauri commands** must be: registered in `commands/mod.rs` (pub use), listed in `lib.rs`'s `generate_handler![]`, and added to `src/api/tauri.ts` on the frontend.

4. **Error handling** — all commands return `Result<T, AppError>`. `AppError` serializes to `{ code, message }` on the frontend. Use `AppError::internal()`, `AppError::connection_failed()`, `AppError::auth_failed()`, `AppError::not_connected()`.

---

## Submitting a pull request

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   # or: fix/my-bug, docs/update-readme
   ```

2. **Make your changes.** Follow the code style guidelines above.

3. **Run checks** before pushing:
   ```bash
   npm run typecheck
   npm run lint
   cargo clippy -- -D warnings
   cargo fmt --check
   ```

4. **Push** and open a pull request against `main`. Fill in the PR template.

5. A maintainer will review and merge. For larger features, open an issue first to discuss the approach.

### Commit message format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add SFTP resume support
fix: prevent duplicate terminal sessions on reconnect
docs: update keyboard shortcuts table
refactor: extract relay loop into helper
```

---

## Reporting bugs

Use the [Bug Report](https://github.com/AvinashNath2/harbor-ssh-client/issues/new?template=bug_report.yml) issue template. Include your OS, HarborSCP version, and steps to reproduce.

## Requesting features

Use the [Feature Request](https://github.com/AvinashNath2/harbor-ssh-client/issues/new?template=feature_request.yml) issue template.
