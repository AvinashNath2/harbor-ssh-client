# Remote VM Explorer

A lightweight, open-source desktop app to connect to a remote VM over SSH and browse, manage, and transfer files through a visual file explorer — no more `cd`-ing around in a terminal or fighting with WinSCP.

## Overview

Connect to any VM you can SSH into (cloud instance, home server, VPS) using a private key or password, and get a native file browser: navigate folders, upload/download, rename, delete, and manage files with a proper UI instead of raw shell commands.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App framework | [Tauri](https://tauri.app) | Native desktop app (Win/Mac/Linux) from one codebase; far smaller and lighter than Electron |
| Backend logic | Rust | Runs inside the Tauri app; handles the actual SSH/SFTP connection |
| SSH/SFTP client | [`ssh2`](https://crates.io/crates/ssh2) crate | Mature libssh2 bindings — connection, auth, and file operations |
| Frontend | React + TypeScript | UI layer, calls Rust commands via Tauri's IPC bridge |
| File tree UI | `react-arborist` | Ready-made folder/file tree component |
| Styling | Tailwind CSS | Fast, consistent styling |
| Terminal (v2) | `xterm.js` | Embedded terminal tab alongside the file browser |

**Architecture:** the Rust backend opens the SSH/SFTP session directly to the remote VM and exposes simple commands (`list_folder`, `upload_file`, `download_file`, `delete_file`, etc.) that the React frontend calls almost like local functions. No hosted server, no credentials leaving the user's machine.

## Functional requirements

### MVP
1. Connection management — add, save, edit, delete VM connection profiles (host, port, username, auth method)
2. Authentication — support both SSH key-based and password-based login
3. File browsing — list folder contents: name, type, size, permissions, last modified
4. Navigation — click into folders, breadcrumb trail, jump to a specific path
5. File operations — upload, download, rename, delete, create new folder
6. Multi-select — select multiple files for batch delete/download
7. Transfer feedback — progress bar for uploads/downloads
8. Saved connection history — quick-reconnect to recent VMs

### v2 / later
9. Embedded terminal tab for the connected VM
10. File preview (text/images) without downloading
11. Drag-and-drop upload from local filesystem
12. Multiple simultaneous connections/tabs
13. Copy/move files between two open remote sessions
14. Resume interrupted transfers

## Non-functional requirements

1. **Security** — credentials encrypted at rest, never stored in plaintext; SSH key auth preferred over password
2. **Performance** — large directories (thousands of files) load without freezing the UI (pagination/virtual scrolling)
3. **Reliability** — graceful handling of dropped connections, clear error messages, no silent failures
4. **Cross-platform** — runs on Windows, macOS, and Linux from one codebase
5. **Lightweight footprint** — low memory/CPU usage (primary reason for choosing Tauri over Electron)
6. **Usability** — zero-config first run, no manual required to connect and browse
7. **Extensibility** — architecture allows adding new protocols later (FTP, S3, WebDAV) without a rewrite
8. **Maintainability** — clean module boundaries, documented code, contributor-friendly (this README, `CONTRIBUTING.md`)
9. **Data integrity** — verify file size/checksum after transfer to catch corruption

## Status

Early planning — requirements and tech stack defined, scaffolding not yet started.

## License

TBD (recommend MIT or Apache-2.0 for an OSS project like this).
