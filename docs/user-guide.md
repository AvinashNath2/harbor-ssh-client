# User Guide

## Connecting to a server

1. Click **+ New Session** in the left sidebar (or press `⌘N`)
2. Fill in the connection details:
   - **Host** — hostname or IP address
   - **Port** — default `22`
   - **Username** — your SSH username
   - **Auth** — choose Password or SSH Key
3. Click **Connect**

To save the connection for later, click **Save Profile** before connecting.

### Import from `~/.ssh/config`

Click the **Import SSH Config** button in the sidebar to automatically import all hosts from your local `~/.ssh/config` file as saved profiles.

---

## File browser

Once connected, the remote file browser opens automatically.

### Navigation

- Click a folder to navigate into it
- Use the **breadcrumb** at the top to jump to a parent folder
- Press `⌘L` or `⌘G` to focus the path bar and type a path directly
- Click `~` to jump to your home directory
- Use `⌘[` / `⌘]` for back/forward

### File operations

Right-click any file or folder to:
- **Download** — save to your local machine
- **Rename** — rename in place
- **Delete** — permanently delete (confirmation required for multiple files)
- **Properties** — view permissions, owner, group, file info
- **Preview** — view text, image, or hex content without downloading

### Multi-select

- Click to select one item
- `⌘-click` to add/remove items from the selection
- `Shift-click` to select a range

### Dual-pane mode

Click the **Split** icon in the toolbar to open the local filesystem alongside the remote pane. Drag files between panes to upload or download.

---

## File transfers

### Upload

- Drag files from Finder (macOS) or File Explorer (Windows) onto the remote pane
- Or select a local file in dual-pane mode and drag it to the remote pane
- Or click the **Upload** button in the toolbar

### Download

- Select files in the remote pane and click **Download** in the toolbar
- Or drag remote files to the local pane in dual-pane mode

Transfers appear in the **Transfer panel** (bottom-left) with real-time progress. Click `×` to cancel a transfer.

---

## Terminal

Click **Terminal** (or the `PanelBottom` icon in the toolbar) to open an embedded SSH shell.

The terminal uses xterm.js and supports:
- Full color output
- Resize (drag the panel edge)
- Multiple terminal tabs
- Shell integration — commands are automatically captured in the session log

---

## SSH Port Forwarding (Tunnels)

Click the **⇄ Tunnels** icon in the toolbar to open the Tunnels panel.

### Adding a tunnel

1. Click **+ New**
2. Choose a preset (PostgreSQL, MySQL, Redis, HTTP) or enter manually:
   - **Local Port** — port on your Mac that will listen
   - **Remote Host** — host to connect to on the server side (usually `localhost`)
   - **Remote Port** — port on the server (e.g. `5432` for PostgreSQL)
3. Click **Add Tunnel**

The tunnel is active as long as HarborSCP is connected. Click `×` to stop a tunnel.

### Example: PostgreSQL tunnel

| Field | Value |
|---|---|
| Local Port | `5433` |
| Remote Host | `localhost` |
| Remote Port | `5432` |

Then connect from your Mac: `psql -h localhost -p 5433 -U myuser mydb`

---

## Session Log

Click **Session Log** in the toolbar to view a history of all connected sessions and commands.

Each session shows:
- Connection details (host, username, IP, duration)
- Every command run in the terminal — with exit code, duration, and captured output
- File operations (uploads, downloads, creates, renames, deletes) performed in the file browser

Sessions are stored locally in a SQLite database and persist between app launches.
