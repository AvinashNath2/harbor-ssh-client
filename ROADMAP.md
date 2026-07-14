# Remote VM Explorer — Development Roadmap

A phased build plan derived from the functional and non-functional requirements in [README.md](./README.md). The ordering principle: **make the core connection + browsing loop work end-to-end first**, harden it, then layer features. Each phase is shippable and testable on its own.

Legend: **FR-n** = functional requirement, **NFR-n** = non-functional requirement (numbering from the README).

---

## Phase 0 — Project scaffolding & plumbing

*Goal: a running Tauri app that can call a trivial Rust command from React. No SSH yet.*

- Initialize Tauri + React + TypeScript project; wire Tailwind.
- Establish the IPC pattern: one dummy Rust command (`ping`) invoked from the frontend, returning a value.
- Set up module layout on the Rust side (`ssh/`, `commands/`, `models/`) and the React side (`components/`, `hooks/`, `api/`).
- Add `ssh2` crate and confirm it compiles/links on your dev OS.
- Tooling: linting (clippy + eslint), formatting (rustfmt + prettier), and a basic CI check.

**Exit criteria:** app launches on your machine, frontend successfully calls a Rust command, repo builds clean in CI.
**Addresses:** NFR-8 (maintainability), foundation for NFR-4 (cross-platform).

---

## Phase 1 — Connect & authenticate (the core spike)

*Goal: from the UI, open a real SSH session to a VM and prove it works.*

- Rust: `connect(host, port, username, auth)` opening an `ssh2` session; support **key-based** and **password** auth (FR-2).
- Rust: `disconnect()` and session state held in a managed connection object.
- Minimal UI: a single connect form (host, port, user, auth method + key path/password) and a connection-status indicator.
- Surface auth/connection errors as clear, typed messages back to the UI (start of NFR-3).

**Exit criteria:** you can type in real VM details, hit Connect, and see a confirmed live session (e.g. a `whoami`/`pwd` returned to the UI).
**Addresses:** FR-2. This is the highest-risk phase — do it early to de-risk the `ssh2` integration.

---

## Phase 2 — File browsing & navigation

*Goal: see and move around the remote filesystem.*

- Rust: `list_folder(path)` over SFTP returning name, type, size, permissions, last-modified (FR-3).
- Frontend: render the listing with `react-arborist`; click into folders (FR-4).
- Navigation: breadcrumb trail + "jump to path" input (FR-4).
- Handle the common failures gracefully: permission denied, path not found, dropped session (NFR-3).

**Exit criteria:** connect to a VM and browse its directory tree with correct metadata; broken paths show a clear error instead of hanging.
**Addresses:** FR-3, FR-4.

---

## Phase 3 — File operations

*Goal: actually manage files, not just look at them.*

- Rust commands: `upload_file`, `download_file`, `rename`, `delete_file`, `create_folder` (FR-5).
- Frontend: context menu / toolbar actions wired to these commands, with confirm dialogs on destructive ops.
- Multi-select in the tree for batch delete/download (FR-6).
- Optimistic UI refresh (or targeted re-list) after each operation.

**Exit criteria:** full create/rename/delete/upload/download cycle works, including a batch delete and a batch download.
**Addresses:** FR-5, FR-6.

---

## Phase 4 — Transfer UX & connection management

*Goal: make it feel like a real product for repeat use.*

- Transfer progress: stream progress from Rust to UI, render per-transfer progress bars (FR-7).
- Connection profiles: add / save / edit / delete VM profiles — host, port, username, auth method (FR-1).
- Saved history: quick-reconnect list of recent VMs (FR-8).
- **Secure credential storage:** encrypt saved credentials at rest via the OS keychain (keytar-equivalent / `keyring` crate); never store plaintext (NFR-1).

**Exit criteria:** save a profile, reconnect in one click, watch a large upload report live progress; no plaintext secret exists on disk.
**Addresses:** FR-1, FR-7, FR-8, NFR-1.

---

## Phase 5 — Hardening (non-functional pass)

*Goal: make it robust, fast, and cross-platform before adding v2 features.*

- Performance: virtual scrolling / pagination for directories with thousands of files (NFR-2).
- Reliability: reconnect logic on dropped sessions, consistent error surfaces, no silent failures (NFR-3).
- Data integrity: verify file size/checksum after each transfer (NFR-9).
- Cross-platform: build and smoke-test on Windows, macOS, and Linux (NFR-4).
- Footprint check: confirm memory/CPU stay low under load (NFR-5).
- Usability: zero-config first run — app is usable without reading a manual (NFR-6).

**Exit criteria:** a 5,000-file directory scrolls smoothly, a killed connection recovers gracefully, transfers are checksum-verified, and the app runs on all three OSes.
**Addresses:** NFR-2, NFR-3, NFR-4, NFR-5, NFR-6, NFR-9.

> **MVP ships at the end of Phase 5.** Everything below is v2.

---

## Phase 6 — Terminal & preview (v2)

- Embedded terminal tab for the connected VM via `xterm.js`, backed by an SSH shell channel (FR-9).
- In-app file preview for text and images without downloading (FR-10).

**Addresses:** FR-9, FR-10.

---

## Phase 7 — Advanced transfer & multi-session (v2)

- Drag-and-drop upload from the local filesystem (FR-11).
- Multiple simultaneous connections / tabs (FR-12).
- Copy/move files between two open remote sessions (FR-13).
- Resume interrupted transfers (FR-14).

**Addresses:** FR-11, FR-12, FR-13, FR-14.

---

## Phase 8 — Extensibility & release polish

- Refactor the transport layer behind a trait/interface so new protocols (FTP, S3, WebDAV) can be added without a rewrite (NFR-7).
- `CONTRIBUTING.md`, code docs, module-boundary cleanup (NFR-8).
- Packaging, signing, auto-update, and a 1.0 release.

**Addresses:** NFR-7, NFR-8.

---

## Sequencing rationale

1. **Phases 1–3 are the vertical slice** — connect, browse, operate. Nothing else matters until this loop works, so it comes first and the risky `ssh2` spike (Phase 1) leads.
2. **Phase 4** turns the slice into something usable repeatedly (profiles, history, progress) and introduces credential security the moment credentials get persisted — not later.
3. **Phase 5** is a deliberate hardening gate before feature expansion, so v2 work builds on a stable base rather than papering over it.
4. **Phases 6–8** are additive and independent enough to reorder based on user demand; the extensibility refactor (Phase 8) is placed last because it's cheapest to design once the real usage patterns are known — but if FTP/S3 support is a near-term goal, pull NFR-7 forward into Phase 5.

## Suggested milestones

| Milestone | Phases | Outcome |
|---|---|---|
| **M1 — Walking skeleton** | 0–1 | App connects to a real VM |
| **M2 — Browsable** | 2 | Navigate the remote filesystem |
| **M3 — Functional MVP** | 3–4 | Full file management + saved connections |
| **M4 — Production MVP** | 5 | Hardened, cross-platform, secure |
| **M5 — v2 feature set** | 6–7 | Terminal, preview, multi-session |
| **M6 — 1.0** | 8 | Extensible, documented, packaged |
