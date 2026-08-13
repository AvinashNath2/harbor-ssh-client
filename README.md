<div align="center">

# HarborSCP

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/AvinashNath2/harbor-ssh-client?color=brightgreen)](https://github.com/AvinashNath2/harbor-ssh-client/releases/latest)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](https://github.com/AvinashNath2/harbor-ssh-client/releases/latest)

**Connect to any server · Browse files · Run commands · Inspect Docker · Profile storage — one native desktop app.**

<img src="docs/screenshots/01-connect.png" width="720" alt="HarborSCP" />

</div>

---

## Download

| Platform | Installer | File |
|---|---|---|
| **macOS Apple Silicon** | [![Download](https://img.shields.io/badge/dmg-download-000?logo=apple&logoColor=white)](https://github.com/AvinashNath2/harbor-ssh-client/releases/latest) | `HarborSCP_*_aarch64.dmg` |
| **macOS Intel** | [![Download](https://img.shields.io/badge/dmg-download-000?logo=apple&logoColor=white)](https://github.com/AvinashNath2/harbor-ssh-client/releases/latest) | `HarborSCP_*_x64.dmg` |
| **macOS Universal** | [![Download](https://img.shields.io/badge/dmg-download-000?logo=apple&logoColor=white)](https://github.com/AvinashNath2/harbor-ssh-client/releases/latest) | `HarborSCP_*_universal.dmg` |
| **Windows** | [![Download](https://img.shields.io/badge/exe-download-0078D4?logo=windows&logoColor=white)](https://github.com/AvinashNath2/harbor-ssh-client/releases/latest) | `HarborSCP_*_x64-setup.exe` · `.msi` · portable `.zip` |

[Build from source →](CONTRIBUTING.md)

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### 🔑 Saved connections
<img src="docs/screenshots/01-connect.png" width="100%" alt="Saved connections" />

- Save servers with SSH key or password
- Organize into folders and favorites
- Auto-imports `~/.ssh/config` entries
- One-click reconnect

</td>
<td width="50%" valign="top">

### 📁 File browser
<img src="docs/screenshots/02-file-browser.png" width="100%" alt="File browser" />

- Native-feel remote filesystem
- Create · rename · delete · chmod
- In-app file preview (no download)
- Right-click actions on any row

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ⇆ Dual-pane transfer
<img src="docs/screenshots/03-dual-pane.png" width="100%" alt="Dual pane" />

- Local ↔ remote, side by side
- Drag-and-drop upload / download
- Real-time progress · cancel mid-flight
- Handles nested folder transfers

</td>
<td width="50%" valign="top">

### 🖥 Embedded terminal
<img src="docs/screenshots/04-terminal.png" width="100%" alt="Terminal" />

- Full xterm.js shell in-app
- Every command logged with exit code
- Session Log replay any time
- Multiple tabs per connection

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🐳 Docker graph
<img src="docs/screenshots/05-docker-graph.png" width="100%" alt="Docker graph" />

- Visual map of containers, networks, volumes
- See what's wired to what at a glance
- Click a node for details

</td>
<td width="50%" valign="top">

### 📊 Container details
<img src="docs/screenshots/06-docker-containers.png" width="100%" alt="Docker containers" />

- Live CPU + memory sparklines
- Recent logs · mounts · image metadata
- Start · stop · inspect inline

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔀 Port forwarding
<img src="docs/screenshots/07-port-forward.png" width="100%" alt="Port forwarding" />

- Two-click tunnel setup
- Presets: PostgreSQL · MySQL · Redis · HTTP
- Multiple tunnels concurrently

</td>
<td width="50%" valign="top">

### 💽 Data Profiler *(new in v1.3)*
<!-- TODO(screenshot): docs/screenshots/08-data-profiler.png — Dashboard tab, whole-machine scan, showing KPIs + partition bar -->

- Disk usage · age histogram · categories
- Scoped scans with per-directory KPIs
- Largest files & folders · multi-select delete
- Sudo-elevated delete when needed
- Instant-cancel Deep Scan via second SSH channel

</td>
</tr>
</table>

---

## Data Profiler — closer look

The Data Profiler ships in its own window (icon next to Docker Infrastructure in the toolbar). Four tabs; the highlights:

<table>
<tr>
<td width="50%" valign="top">

**Scope-aware overview**
<!-- TODO(screenshot): docs/screenshots/09-scope-overview.png — Directory Overview panel with amber scoped callout, path chip, share-of-partition bar -->

- Whole-machine mode: `df` KPIs + partition bar
- Scoped mode: KPIs derived from *that folder only*, share-of-partition strip, amber "this is scoped, not machine-wide" callout

</td>
<td width="50%" valign="top">

**Safer Deep Scan**
<!-- TODO(screenshot): docs/screenshots/10-scope-modal.png — Deep Scan scope picker modal -->

- Pick a directory OR the whole filesystem
- Instant cancel via a 2nd SSH channel (`pkill` by tag) — no waiting for the current step to finish
- Server Load box stays live during scans

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Largest Items + delete**
<!-- TODO(screenshot): docs/screenshots/11-largest-items.png — Largest Items with checkboxes + bulk action bar -->

- Files and folders sorted by size
- Multi-select via checkboxes + bulk action bar
- Copy path · Browse in file manager · Delete
- Two-step confirmation on every delete

</td>
<td width="50%" valign="top">

**Sudo escalation**
<!-- TODO(screenshot): docs/screenshots/12-sudo-delete.png — DeleteConfirmDialog Step 2 with "Use sudo" checkbox visible -->

- Preflight probes writability of each item's parent
- Root-owned items flagged with a 🔒 icon
- Opt-in `sudo -n rm -rf` via control SSH channel
- "Retry failed with sudo" one-click after any perm-denied

</td>
</tr>
</table>

---

## Quick start

1. Download for your platform above
2. Click **+ New Session**, enter host + username
3. Choose password or SSH key, click **Connect**
4. Your files appear immediately. Terminal, Docker, and Data Profiler are one click away in the toolbar.

---

<details>
<summary><strong>Tech stack</strong></summary>

| Layer | Technology |
|---|---|
| App framework | [Tauri 2](https://tauri.app) — native desktop, ~10 MB bundle, no Electron |
| Backend | Rust — SSH/SFTP sessions, file ops, port forwarding, storage scans |
| SSH library | [`ssh2`](https://crates.io/crates/ssh2) crate (libssh2 bindings), **two sessions per connection** — one for work, one for control (cancel scans, run probes without blocking) |
| Frontend | React 19 + TypeScript |
| Terminal | [xterm.js](https://xtermjs.org) with shell integration hooks |
| Database | SQLite (via `rusqlite`) — local session log, saved servers |
| Styling | Tailwind CSS |

The Rust backend opens the SSH/SFTP session directly and exposes commands to the React frontend via Tauri's IPC bridge. No hosted server, no credentials leaving your machine.

</details>

<details>
<summary><strong>Screenshots to capture</strong></summary>

Some feature screenshots referenced above don't exist yet. Save PNGs to these paths (≤ ~1000 px wide, ideally cropped tight around the feature so the grid stays even):

| Path | What to capture |
|---|---|
| `docs/screenshots/08-data-profiler.png` | Data Profiler main window — Dashboard tab, whole-machine scan showing KPIs + partitions bar |
| `docs/screenshots/09-scope-overview.png` | Directory Overview panel after a scoped `/data` scan — the amber callout, path chip, share-of-partition strip |
| `docs/screenshots/10-scope-modal.png` | Deep Scan scope picker modal open, "Scan a specific directory" selected |
| `docs/screenshots/11-largest-items.png` | Largest Items tab with a few rows checked so the bulk action bar shows |
| `docs/screenshots/12-sudo-delete.png` | DeleteConfirmDialog on Step 2 with at least one item flagged 🔒 and the "Use sudo" checkbox visible |

Tip: for consistent height across the grid, crop each screenshot to roughly the same aspect (~16:10 works well).

</details>

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for build instructions, code style, and how to submit a PR. Bugs and feature requests: open a [GitHub Issue](https://github.com/AvinashNath2/harbor-ssh-client/issues).

---

<div align="center">

MIT License · Copyright © 2025 [Avinash Nath](https://github.com/AvinashNath2)

</div>
