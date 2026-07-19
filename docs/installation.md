# Installation

## Download a release

Go to the [Releases page](https://github.com/AvinashNath2/harbor-ssh-client/releases) and download the installer for your platform.

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `HarborSCP_aarch64.dmg` | M1/M2/M3 Macs |
| macOS (Intel) | `HarborSCP_x64.dmg` | Intel Macs |
| Windows | `HarborSCP_x64-setup.exe` | NSIS installer |
| Windows | `HarborSCP_x64.msi` | MSI installer |
| Linux | `HarborSCP_amd64.AppImage` | Universal, no install needed |
| Linux | `HarborSCP_amd64.deb` | Debian / Ubuntu |

### macOS

1. Download the `.dmg` matching your chip
2. Open it and drag **HarborSCP** to `/Applications`
3. On first launch: right-click → Open (to bypass Gatekeeper on unsigned builds)

### Windows

Run the `.exe` or `.msi` installer and follow the prompts.

### Linux (AppImage)

```bash
chmod +x HarborSCP_amd64.AppImage
./HarborSCP_amd64.AppImage
```

Or install the `.deb`:

```bash
sudo dpkg -i HarborSCP_amd64.deb
```

---

## Build from source

### Prerequisites

| Tool | Version |
|---|---|
| Rust | stable (via [rustup.rs](https://rustup.rs)) |
| Node.js | 20+ |
| Xcode CLI | macOS only — `xcode-select --install` |
| MSVC Build Tools | Windows only |

**Linux only:**
```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf libssh-dev
```

### Steps

```bash
git clone https://github.com/AvinashNath2/harbor-ssh-client.git
cd harbor-ssh-client
npm install
npm run tauri build
```

The built app is in `src-tauri/target/release/bundle/`.
