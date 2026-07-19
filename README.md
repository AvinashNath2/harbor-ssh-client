# HarborSCP

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/AvinashNath2/harbor-ssh-client/actions/workflows/ci.yml/badge.svg)](https://github.com/AvinashNath2/harbor-ssh-client/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/AvinashNath2/harbor-ssh-client/releases)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-24C8D8)](https://tauri.app)

**A native SSH/SFTP desktop client for developers.** Browse, manage, and transfer files on any SSH server — no terminal gymnastics required.

> Built with Tauri + Rust for a lightweight, native experience. No Electron, no bloat.

---

## Features

- **Connection profiles** — save servers with password or SSH key auth, organize into folders, mark favorites
- **Import from `~/.ssh/config`** — one click to import all your existing SSH hosts
- **Remote file browser** — navigate, create, rename, delete, and preview files on the remote server
- **Dual-pane mode** — local and remote side-by-side for easy drag-and-drop transfers
- **Queued transfers** — upload and download with real-time progress bars; cancel mid-transfer
- **Embedded terminal** — full xterm.js shell with shell integration hooks (command history, exit codes, CWD tracking)
- **Session log** — every command recorded with timestamp, exit code, duration, and output
- **SSH port forwarding** — tunnel any remote service to your local machine with preset configs (PostgreSQL, MySQL, Redis, HTTP)
- **File detail panel** — view and edit permissions (chmod), owner, group, file info
- **File preview** — inspect text, images, and binary files without downloading
- **Command palette** — `⌘K` to jump anywhere
- **Auto-reconnect** — transparent reconnection on dropped connections
- **Cross-platform** — macOS, Windows, and Linux from one codebase

---

## Screenshots

> Screenshots coming soon — contributions welcome!

---

## Installation

### Download a release

Go to the [Releases page](https://github.com/AvinashNath2/harbor-ssh-client/releases) and download the installer for your platform:

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `HarborSCP_aarch64.dmg` |
| macOS (Intel) | `HarborSCP_x64.dmg` |
| Windows | `HarborSCP_x64-setup.exe` or `.msi` |
| Linux | `HarborSCP_amd64.AppImage` or `.deb` |

### Build from source

See [CONTRIBUTING.md](CONTRIBUTING.md#building-from-source).

---

## Quick Start

1. Launch HarborSCP
2. Click **+ New Session** in the sidebar
3. Enter your server's host, port, username, and choose password or SSH key auth
4. Click **Connect**
5. Browse your remote files, open the terminal, or start a tunnel

---

## Tech Stack

| Layer | Technology |
|---|---|
| App framework | [Tauri 2](https://tauri.app) — native desktop, ~10MB bundle |
| Backend | Rust — SSH/SFTP session handling, file ops, port forwarding |
| SSH library | [`ssh2`](https://crates.io/crates/ssh2) crate (libssh2 bindings) |
| Frontend | React 19 + TypeScript |
| Terminal | [xterm.js](https://xtermjs.org) with custom shell integration |
| Database | SQLite (via `rusqlite`) — local session log |
| Styling | Tailwind CSS |

**Architecture:** Rust backend opens the SSH/SFTP session directly and exposes commands (`list_folder`, `upload_file`, `channel_direct_tcpip`, etc.) to the React frontend via Tauri's IPC bridge. No hosted server, no credentials leaving the machine.

---

## Documentation

Full documentation is available at [avinashnath2.github.io/harbor-ssh-client](https://avinashnath2.github.io/harbor-ssh-client/) (GitHub Pages).

- [Installation guide](docs/installation.md)
- [User guide](docs/user-guide.md)
- [Configuration](docs/configuration.md)
- [FAQ](docs/faq.md)
- [Architecture](docs/architecture.md)

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:

- How to build the project locally
- Code style guidelines
- How to submit a pull request

For bug reports and feature requests, use [GitHub Issues](https://github.com/AvinashNath2/harbor-ssh-client/issues).

---

## License

HarborSCP is released under the [MIT License](LICENSE).

Copyright (c) 2025 [Avinash Nath](https://github.com/AvinashNath2)
