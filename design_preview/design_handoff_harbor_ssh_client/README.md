# Handoff: Harbor — Modern SSH / SFTP Client UI

## Overview
Harbor is a modern desktop SSH/SFTP connection manager and file-transfer client — a spiritual successor to WinSCP, redesigned to be dense but clean for power users. This handoff covers three views: a **New Session dialog**, and the main **dual-pane file browser** in two themes (dark "Nocturne" and light "Daybreak"). The design targets a cross-platform, neutral desktop app (Electron/Tauri, or native).

## About the Design Files
The file in this bundle (`Harbor SSH Client.dc.html`) is a **design reference created in HTML** — a prototype showing the intended look, layout, and behavior. It is **not production code to copy directly**. The task is to **recreate these designs in the target codebase's environment** (React/Electron, Tauri + Svelte/Vue, SwiftUI, etc.) using that project's established patterns, component library, and state management. If no environment exists yet, choose the most appropriate stack for a cross-platform desktop file client and implement there.

The HTML uses a small custom template runtime (`<sc-for>`, `{{ }}` holes) — ignore those mechanics; they only render the file lists from data arrays. Reproduce the **visual result**, not the templating.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and layout are specified exactly below. Recreate the UI pixel-accurately using the codebase's libraries. The two themes (dark/light) are the same layout with swapped tokens — build one component tree, theme it with tokens.

---

## Design Tokens

### Typography
- **Sans (UI):** `IBM Plex Sans` — weights 300/400/500/600/700
- **Mono (paths, sizes, perms, terminal, metrics):** `IBM Plex Mono` — weights 400/500/600
- Body antialiased; `text-rendering: optimizeLegibility`
- Sizes in use: 10px (mono labels, uppercase, letter-spacing 1–1.2px), 10.5–11.5px (mono metrics/perms), 12–12.5px (row names, list items), 13–14px (buttons, titles), 16px (dialog title)

### Color — Dark theme "Nocturne"
| Role | Hex |
|---|---|
| App / content bg | `#0f1218` |
| Titlebar / sidebar / status bg | `#0b0d12` |
| Toolbar / pane-header bg | `#0d1017` |
| Column-header bg | `#0b0d12` |
| Input / field bg | `#0d1017` |
| Panel/raised bg (modal, chips) | `#12151c` / `#1e2430` |
| Hover row bg | `#161b24` |
| Border (primary) | `#1b2029` |
| Border (raised/input) | `#262c38` / `#2a3140` |
| Text primary | `#d5dae4` (headings `#eaf1ff`) |
| Text secondary | `#8a93a6` |
| Text tertiary / mono meta | `#737b8c` / `#6a7284` |
| Text faint | `#5c6474` / `#565e6d` |
| Terminal bg | `#08090d` |

### Color — Light theme "Daybreak"
| Role | Hex |
|---|---|
| App / content bg | `#f6f5f1` |
| Titlebar / status bg | `#eceae4` |
| Sidebar bg | `#efede8` |
| Toolbar / pane-header bg | `#faf9f6` |
| Column-header bg | `#f2f0eb` |
| Pane list bg | `#ffffff` |
| Input / field bg | `#ffffff` |
| Raised/chip bg | `#eceae4` |
| Hover row bg | `#f0f4fb` |
| Border (primary) | `#dcd8d0` / `#e6e2da` |
| Border (input) | `#e0dcd3` |
| Text primary | `#26282d` (headings `#1c3f7a` on accent) |
| Text secondary | `#6a6f7a` |
| Text tertiary / mono meta | `#8a8578` |
| Text faint | `#b0ab9e` / `#a8a397` |
| Terminal bg | `#08090d` (terminal stays dark in both themes) |

### Accent & status (shared intent, per-theme hex)
- **Accent (primary/brand):** Dark `#4c9dff` → `#2f6bdb` gradient (150deg). Light `#3f7be0` → `#2f6bdb`. Soft accent bg: dark `rgba(76,157,255,0.12–0.14)`, light `rgba(47,107,219,0.10–0.12)`.
- **Success / online / upload-done:** Dark `#33c489`, Light `#1f9d63`.
- **Warning / favorites star:** `#e0a53c` (also the **folder icon color** in both themes).
- **Danger / delete:** Dark `#f2555a`, Light `#d64545`.
- **Offline dot:** Dark `#3a414f`, Light `#c9c4b8`.

### Radius & shadow
- Radius: inputs/buttons `9px`, small chips/icons `6–7px`, file-type icon `4px`, modal `16px`, window `12px`, avatar/status dots `50%`.
- Window shadow: `0 40px 90px -30px rgba(0,0,0,0.55)` (dark) / `rgba(60,55,45,0.35)` (light).
- Accent button glow: `0 4px 14px -4px rgba(76,157,255,0.6)`.
- Focused field ring: `border-color: accent` + `box-shadow: 0 0 0 3px rgba(76,157,255,0.12)`.

### Spacing
- Window size in mocks: **1360 × 860**. Sidebar **250px**. Transfer gutter **52px**. Dock height **198px**. Titlebar **46px**, toolbar **44px**, pane header **40px**, column header **28px**, status bar **30px**, file row **31px**.

---

## Screens / Views

### 1. Main window — dual-pane file browser (themes 1A dark / 1B light)

**Purpose:** Browse local and remote filesystems side by side, transfer files between them, run a terminal, and watch transfer progress.

**Layout (top to bottom):**
1. **Titlebar (46px):** left — app mark (22px rounded-square accent gradient, "H") + wordmark "Harbor". Divider. Connection **tabs**: active tab has content-bg fill + `2px` accent bottom-border, a green status dot, host name, and `×`. Inactive tabs muted. A `＋` to open a new tab. Right — window controls (`—`, `▢`, `✕`) in mono, faint color.
2. **Sidebar (250px):** header "Sessions" + count. Full-width accent **"＋ New Session"** button (36px, gradient, glow). Search input (34px) with `⌕` and `⌘K` hint. Then **grouped session list** — group labels are 10px mono uppercase, letter-spacing 1.2px. Each session item: status dot (green online / faint offline) + name (12.5px) + host (10.5px mono, secondary) stacked; favorites show a `★`. **Active session** ("staging-web" under STAGING) has soft-accent bg + `inset 2px 0 accent` left bar + "LIVE" mono badge. Bottom: user row (26px avatar circle "DK" + name + `⚙`), separated by a top border.
3. **Toolbar (44px):** left — connection status chip (green dot + `deploy@staging-web` in mono, on soft-green bg). Divider. Icon buttons: `⟳` refresh, `↑` upload, `↓` download, `＋` new folder, `⌫` delete (hover turns danger). Right — filter input (30px, 220px wide) + view toggle segmented (`☰` list active / `▦` grid).
4. **Dual panes (flex row):**
   - **Local pane** (flex 1, right border): header (40px) with `LOCAL` chip (mono, on raised bg) + breadcrumb path (`~ / projects / acme-app`, mono, separators faint) + `⟳`. Column header (28px): NAME · SIZE (right-aligned) · MODIFIED · PERMS (mono uppercase labels). Then file rows.
   - **Transfer gutter (52px):** centered vertical stack — a 38px accent-gradient round button `→` labeled "put" (upload to remote) and a 38px outlined round button `←` labeled "get" (download).
   - **Remote pane** (flex 1): identical structure; header chip `REMOTE` uses accent color/bg; shows a green connected dot + `⟳`; breadcrumb `/ var / www / acme-app`; list bg white in light theme.
   - **File row (31px):** grid `16px minmax(0,1fr) 78px 118px 100px`, gap 12, padding 0 14. Columns: **icon** (16px rounded-4 square) · **name** (12.5px, folders/symlinks weight 600, ellipsis) · **size** (11.5px mono, right-aligned, `—` for folders) · **modified** (11.5px mono) · **perms** (10.5px mono, faint, e.g. `drwxr-xr-x`, `-rw-r--r--`, `lrwxrwxrwx`). Hover = hover-row bg. Bottom border very subtle.
     - **Icon rules:** folder → solid `#e0a53c` square, no glyph. Symlink → bluish-gray square with `↳` glyph. File → neutral gray square (`rgba(130,134,142,0.14)` bg, `0.30` border) with the file **extension** (up to 4 chars) in 7px mono, color `#8b93a3`. Symlink name shows target: `current → releases/42`.
5. **Dock (198px, top border):** split row.
   - **Terminal (flex 1.35, always dark `#08090d`):** header (32px) green dot + `TERMINAL` + `— deploy@staging-web` + `bash` (right). Body: mono 12px, line-height 1.7. Prompt colored — user `#33c489`, `:` `#6a7284`, path `#6cb0ff`, `$` `#6a7284`, typed command `#c7cfdb`, output `#737b8c`, success `#8fe8c0`. Blinking block cursor (see Interactions).
   - **Transfers (flex 1, left border):** header `TRANSFERS` + "2 active · 1 done". Rows: 20px rounded direction chip (`↑` accent / `↓` success), filename (12px, ellipsis) + `%` (mono), a 4px progress track (`#1e2430`) with accent (upload) or success (download) gradient fill, right meta `4.2 MB/s` (mono, width 66px, right-aligned). Completed row: `✓` chip, dimmed to 0.6 opacity, "Done · 8.4 MB".
6. **Status bar (30px):** mono 11px. Left — green dot + `SFTP-3`, `AES-256-GCM`, `ed25519`, latency `42 ms`. Right — accent `⇅ 2 active`, `10 items · 3 selected`, total `152.4 MB`.

### 2. New Session dialog (2A)

**Purpose:** Create/edit a connection and save it into a folder. This is what opens on clicking **＋ New Session**.

**Layout:** Modal centered over a dimmed, blurred app backdrop (scrim `rgba(6,8,12,0.72)`, `backdrop-filter: blur(3px)`; the titlebar stays visible above at 0.55 opacity for context). Modal card: **600px wide**, bg `#12151c`, border `#2a3140`, radius 16, shadow `0 40px 100px -20px rgba(0,0,0,0.7)`.

**Sections:**
- **Header (padding 20 24):** 38px rounded soft-accent icon tile with `＋`, title "New Session" (16px, `#eaf1ff`), subtitle "Configure a connection and save it to a folder" (12.5px secondary), `✕` close.
- **Body (padding 20 24, gap 16):** all inputs 38px, bg `#0d1017`, border `#262c38`, radius 9, focus → accent border.
  - **SESSION NAME** — text input (`staging-web`).
  - **HOST / ADDRESS** (flex 1, mono) + **PORT** (96px, mono, `22`).
  - **PROTOCOL** segmented (`SFTP` active gradient / `SCP` / `FTP`) + **USERNAME** (mono).
  - **AUTHENTICATION** segmented (`Password` / `SSH Key` active / `Agent`), then a key-file row: `⚿` (success) + `~/.ssh/id_ed25519` (mono) + "Browse…" button.
  - **SAVE TO FOLDER** — an **open dropdown** (accent border + focus ring): selected header row "Staging" with folder icon + rotated chevron; option rows Production (count 2), **Staging (selected, ✓, soft-accent bg)**, Personal (count 2); a divider; then **"＋ New folder…"** row — dashed accent square + accent label — for creating a new folder inline.
- **Footer (padding 16 24, top border):** left — "Test connection" (green dot + label). Right — "Cancel" (ghost) + **"Save & Connect"** (accent gradient button with glow).

**Field labels** throughout: 10px mono, weight 600, letter-spacing 1px, color `#6a7284`, margin-bottom 7px.

---

## Interactions & Behavior
- **New Session button** → opens the New Session dialog (screen 2). On **Save & Connect**, persist the session under the chosen folder and it appears in the sidebar list under that group; then open a connection tab and populate the remote pane.
- **Save to folder dropdown** → selecting a folder sets the group; **＋ New folder…** should prompt for a folder name inline (text input replacing the row), then create the group.
- **Test connection** → attempts an SSH handshake, shows success/error inline (green/danger dot).
- **Transfer gutter → / ←** → uploads selected local files to remote / downloads selected remote files; each creates a row in the Transfers panel with live progress, speed, and ETA.
- **File rows** → single-click selects (multi-select with modifiers), double-click enters folders / opens files; hover shows hover bg. Selection count feeds the status bar. Right-click → context menu (rename, delete, permissions, download/upload).
- **Terminal** → live PTY; blinking block cursor animation: `@keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }`, 1.1s step-end infinite on a `#c7cfdb` block.
- **Breadcrumbs** → clicking a segment navigates to that directory; keep an optional local↔remote path-sync toggle.
- **Tabs** → each tab is an independent connection/session; `＋` opens New Session.
- **Themes** → dark (Nocturne) and light (Daybreak) are token swaps of one component tree; terminal stays dark in both.

## State Management
- `sessions`: array of `{ id, name, host, port, username, protocol, authType, keyPath, folder, status }` grouped by `folder`.
- `folders`: list of group names (Production, Staging, Personal, …) — creatable.
- `activeConnection`: current tab; `tabs`: open connections.
- `localPath` / `remotePath`, and the file listings for each (name, type dir|file|link, size, modified, perms, linkTarget).
- `selection` per pane (for the status bar count + transfers).
- `transfers`: array of `{ id, name, direction up|down, pct, speed, eta, state active|done }`.
- `terminalBuffer`: lines with role (prompt/command/output/success).
- `theme`: `nocturne` | `daybreak`.

## Assets
No image assets — the design is pure CSS/type. Icons are Unicode glyphs (`⟳ ↑ ↓ ＋ ⌫ ⌕ ⚿ ↳ ✓ ✕ ⚙ ★ ⇅ ▾ ☰ ▦`) as placeholders; replace with the codebase's **icon library** (e.g. Lucide/Phosphor/SF Symbols) at equivalent sizes. File-type icons are colored squares with the extension text — keep or map to a real file-type icon set. Fonts: IBM Plex Sans + IBM Plex Mono (Google Fonts).

## Files
- `Harbor SSH Client.dc.html` — the full design reference (New Session dialog + dark & light dual-pane browser). Open in a browser to inspect exact styles; all inline styles reflect the spec above.
