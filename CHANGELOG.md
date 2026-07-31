# Changelog

All notable changes to HarborSCP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-07-28

### Added
- **Data Profiler** — full-screen storage analyzer opened via the HardDrive button in the terminal tab bar (SSH-connected sessions only)
- **Dashboard** — 6 KPI cards (Total Disk, Used, Free, Use %, Total Files, Largest Root Folder); file-age histogram (last 24h / 7d / 30d / 90d / older); mount table with color-coded usage bars; root folder breakdown table; storage-by-category donut chart; top-20 folders horizontal bar chart; usage-per-partition stacked bar chart
- **Storage Explorer** — expandable VS Code-style file tree; each node loads depth-1 `du` on click; proportional usage bars colored by health tier; Reset button
- **Storage Heatmap** — recharts Treemap sized by folder bytes, colored by % of disk (violet → warn → danger → critical); hover tooltip; click-to-browse
- **Largest Items** — Files / Folders segmented table (up to 200 entries each); sortable by Path, Size, Modified; Browse action jumps to file browser
- **Cleanup Center** — 8 preset action cards (journal vacuum, APT/DNF/YUM cache, Docker prune, old /tmp files, core dumps, rotated logs); per-card dry-run estimate; countdown modal (5-second timer, Cancel, Run Now); sudo password prompt when passwordless sudo is unavailable; exit code and output shown in result view
- **Duplicates** — md5sum-based duplicate scanner; configurable root, minimum file size (default 10 MB), max depth; collapsible hash-grouped result list with recoverable-bytes summary; Browse action per file
- **Settings** — editable health thresholds for mount fullness and folder share (persisted to localStorage); Reset to Defaults
- **Storage Analyzer Logs drawer** — floating "Logs (N)" pill on every tab; right-side drawer with level and source filters; records every SSH command sent, response size, timing, and warnings
- **Rust storage commands** — `storage_overview`, `storage_system_info`, `storage_scan_root`, `storage_scan_path`, `storage_age_histogram`, `storage_category_sizes`, `storage_largest_items`, `storage_check_sudo`, `storage_cleanup_estimate`, `storage_cleanup_execute`, `storage_find_duplicates`
- `CommandSource` extended with `"cleanup"` for session-log entries

## [0.1.0] — 2025-07-19

### Added
- SSH connection profiles with password and SSH key authentication
- Import connections from `~/.ssh/config`
- Remote file browser with full CRUD operations (list, navigate, create, rename, delete)
- Dual-pane mode — local and remote filesystem side-by-side
- Drag-and-drop upload from Finder / File Explorer onto the remote pane
- Queued file transfers with per-file progress bars and cancel support
- Embedded xterm.js terminal with shell integration (OSC 9001 markers for command tracking)
- Session activity log — every command recorded with exit code, duration, and output
- SSH local port forwarding (Tunnels panel) with preset configs for PostgreSQL, MySQL, Redis, HTTP
- File detail panel with chmod/permissions editor
- File preview — text, image, and hex view without downloading
- Command palette (`⌘K`) for quick navigation
- Auto-reconnect with exponential backoff on dropped connections
- Connection profiles with folder grouping and favorites
- Path autocomplete and real-time validation in both file browsers
- Shift-click range selection in the remote file browser
- `⌘L` / `⌘G` keyboard shortcut to focus the path bar
- Home (`~`) button in both browser panes
- Hover pencil icon on remote breadcrumb for quick path editing
- Import SSH config hosts (`~/.ssh/config`) into connection profiles
- Reconnection banner with attempt counter
- OS-level drag-and-drop from Finder directly onto the remote pane
