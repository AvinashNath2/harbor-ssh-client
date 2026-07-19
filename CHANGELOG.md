# Changelog

All notable changes to HarborSCP are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
