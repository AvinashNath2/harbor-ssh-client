# Changelog

All notable changes to HarborSCP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] — 2026-08-13

### Added
- **Data Profiler — scope-aware `<ScopeOverview>` panel** — two rendering modes decided by the active scan. Whole-machine shows classic `df` KPIs + partitions bar. Directory scan swaps to a boxed panel: prominent path chip, amber "scoped, not machine-wide" callout, KPIs derived from the scan only (Directory Size from `du -sB1`, Files from age histogram, Avg File Size, Top-level Entries, Parent Partition), and a 3-segment share-of-partition strip
- **Safer Deep Scan flow** — new scope-picker modal asks *"specific directory or the whole filesystem?"* before every scan. `HARBOR_CANCEL_TAG` env-var wraps every scan command; Cancel now kills the remote `du`/`find` process within ~1 s via `pkill -f` on a second SSH channel. A second `Session` (`control_session`) is opened at auth time — used for cancel, short polls (`storage_system_load`, `storage_check_sudo`, cleanup estimates/previews), and now `check_writable` + `delete_path_sudo`
- **Multi-select bulk delete in Largest Items** — checkbox column with indeterminate select-all; per-view selection (files vs folders); floating action bar with count · total-size · Clear · Delete-selected buttons; selected rows get a red-tinted background
- **Two-step DeleteConfirmDialog** — one dialog handles both single and bulk. Sequential deletion with per-item progress. One failure never aborts the batch. Post-batch summary lists failed items with exact error messages
- **Permission preflight for delete** — new backend command `check_writable` batch-probes writability of every parent directory in a single SSH exec (control channel). Items lacking write access get a 🔒 icon and an amber Step-1 warning
- **Sudo escalation for delete** — new backend command `delete_path_sudo` runs `sudo -n rm -rf` on the control channel with rc-marker error extraction. Step 2 shows a "Use sudo for privileged items" checkbox (on by default). "Retry N failed with sudo" one-click button appears in the post-batch view when any failure looks permission-y and sudo hasn't been tried yet. Common sudo failures translated into human-readable messages (`password required`, `no tty present`, `not in sudoers`)
- **Toolbar — Data Profiler icon** — promoted out of the Monitor dropdown to a standalone `HardDrive` icon next to Docker Infrastructure, so it reads as another "workspace one click away"
- **Reusable `<Menu>` component** — portal-rendered dropdown with keyboard navigation (Enter/Space/Esc/arrows/Home/End), click-outside-close, indeterminate state support, icon-only mode. Powers the Monitor menu; ready for reuse
- **Cleanup Preview modal** — per-preset detailed preview showing every file/folder that will be affected, grouped by category, with size totals
- **Live Server Load box** — always-visible sidebar strip showing 1m load / cores / mem-used-of-total, updated every 5 s via the control channel — no longer pauses during scans
- **Test fixture — `test-vm-heavy/`** — second Docker fixture on port 2223 for multi-connection testing (reconnect UX, port forwarding, cross-VM flows)

### Changed
- **`df` filter — un-filtered `overlay`** so scoped-scan parent-partition lookup works on Docker/K8s container hosts (previously the whole scoped comparison strip was hidden in containers)
- **`df` output deduped** — two mounts reporting identical `(total, used, avail)` are treated as filesystem aliases (Docker overlay + underlying device, bind mounts) and collapsed to one, keeping the shorter mount path. Fixes double-counted whole-machine KPIs on Docker (was reporting 1.8 TB on a 910 GB disk)
- **Data Profiler top nav — responsive** — locked `min-h`, `whitespace-nowrap` and `flex-shrink-0` on every action, progressive metadata collapse at `md`/`lg`/`xl`/`2xl` breakpoints so labels never wrap and buttons stay aligned when the window narrows
- **Storage Heatmap removed** — visual footprint didn't earn its keep vs the Largest Items table; simplified the Data Profiler nav
- **Largest Items — copy-path button** — filename now shows by default; full path appears with a Copy button underneath after clicking (avoids overflowing narrow columns)
- **I/O throttling for scans** — every scan command wrapped with `nice -n 19 [ionice -c 3] timeout <N>` so `du`/`find` can't starve production workloads
- **README** — reorganized into a compact 2-column feature grid; smaller screenshots; added a Data Profiler section with placeholders for new captures

### Fixed
- **`[object Object]` in delete errors** — Rust `AppError` arrives across the Tauri bridge as a plain `{code, message}` object, not an `Error` instance. Both the dialog UI and the hook's log entry now extract `.message` correctly
- **`Top-level Entries` off-by-one** — `du -x -d 1` emits a summary line for the scanned root itself; the ScopeOverview now excludes it before counting children
- **`Directory Size` off by ~68 KB** — previously summed the age-histogram file-bytes-only; now prefers the canonical `du -sB1` value from `state.rootFolders[scannedRoot]` when present
- **Cleanup Preview / Estimate size mismatch** — both paths now compute using the same aggregation logic
- **Inspect Element leaked into tool windows** — context-menu blocker was only in `App.tsx`, so Data Profiler / Java Monitor / Session Log child windows still exposed WebKit's context menu. Moved to `main.tsx` global scope. Also added devtools shortcut blocking (`F12`, `Cmd/Ctrl+Shift+I/J/C`, `Cmd+Opt+I/J/C`, `Cmd/Ctrl+U`), guarded on `import.meta.env.PROD` so dev builds keep inspector access

### Security
- **Devtools disabled in production** — Tauri v2 requires the `devtools` cargo feature to be opt-in for release builds; `Cargo.toml` verified to not include it. `WKWebView.allowsInspection` is never true in a signed release, even before the JS handlers
- **All windows blocked from Inspect Element** — main + all tool windows now share the same context-menu + keyboard-shortcut blockers

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
