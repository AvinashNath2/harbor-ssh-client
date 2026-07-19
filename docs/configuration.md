# Configuration

## Connection profiles

Profiles are saved locally (no cloud sync). Each profile stores:
- Host, port, username
- Auth type (password or SSH key path)
- Optional folder for grouping
- Favorite flag for pinning to the top

Profiles are stored in the app's data directory (no plaintext passwords — passwords are re-entered each time for security).

### SSH key authentication

In the **New Session** dialog, choose **SSH Key** and enter the path to your private key (e.g. `~/.ssh/id_rsa`). If your key has a passphrase, enter it in the Passphrase field.

Common key locations:
- `~/.ssh/id_rsa` — RSA key
- `~/.ssh/id_ed25519` — Ed25519 key (recommended)
- `~/.ssh/id_ecdsa` — ECDSA key

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` | Open command palette |
| `⌘L` or `⌘G` | Focus path bar in active pane |
| `⌘[` | Go back |
| `⌘]` | Go forward |
| `⌘R` | Reload current folder |
| `⌘N` | New session |
| `⌘T` | Toggle terminal |
| `Shift-click` | Range-select files |
| `⌘-click` | Multi-select files |
| `Escape` | Cancel / close path bar |
| `Tab` or `Enter` | Accept autocomplete suggestion in path bar |
| `↑` / `↓` | Navigate autocomplete dropdown |

---

## Panel sizing

All panels (sidebar, terminal, detail panel) are resizable by dragging their edges. Sizes are saved automatically to `localStorage` and persist between sessions.

| Setting key | Default |
|---|---|
| `harbor.sidebarWidth` | 250px |
| `harbor.terminalHeight` | 340px |
| `harbor.detailPanelWidth` | 272px |
| `harbor.sidebarHidden` | false |

---

## Session log storage

The session log database is stored at:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/com.harborscp.app/sessions.db` |
| Windows | `%APPDATA%\com.harborscp.app\sessions.db` |
| Linux | `~/.local/share/com.harborscp.app/sessions.db` |

To clear all session history, delete this file.
