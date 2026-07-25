# Docker Dashboard Redesign — Full Technical Specification

**Project:** HarborSCP — Remote VM Explorer  
**Feature:** DockScope-Inspired Docker Infrastructure Dashboard  
**Status:** Planning complete · Ready for implementation  
**Date:** 2026-07-22  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What We Are Building](#2-what-we-are-building)
3. [What Gets Removed](#3-what-gets-removed)
4. [Architecture Overview](#4-architecture-overview)
5. [Phase 0 — Safety: Read-Only Enforcement](#5-phase-0--safety-read-only-enforcement)
6. [Phase 1 — Technology Icons](#6-phase-1--technology-icons)
7. [Phase 2 — New Rust Backend Command](#7-phase-2--new-rust-backend-command)
8. [Phase 3 — TypeScript API & Hook Updates](#8-phase-3--typescript-api--hook-updates)
9. [Phase 4 — Graph Layout Redesign](#9-phase-4--graph-layout-redesign)
10. [Phase 5 — Bottom Explain Panel](#10-phase-5--bottom-explain-panel)
11. [Phase 6 — AI Model Management](#11-phase-6--ai-model-management)
12. [Phase 7 — Global AI Chat Panel](#12-phase-7--global-ai-chat-panel)
13. [Phase 8 — Comprehensive SQLite Database](#13-phase-8--comprehensive-sqlite-database)
14. [Full File Change Manifest](#14-full-file-change-manifest)
15. [Verification Checklist](#15-verification-checklist)

---

## 1. Executive Summary

The current Docker Explorer is being fully redesigned based on the DockScope reference design. The new dashboard introduces:

- A **horizontal 3-column topology graph** (Networks → Containers → Volumes) replacing the compose-group parent-box layout
- **Real container-to-volume edges** sourced from `docker inspect` instead of image-name inference
- **Technology-specific brand icons** (PostgreSQL elephant, Redis cube, Kafka logo, Spring leaf, etc.) from `simple-icons`
- A **bottom explain panel** with plain-English narrations about any selected node
- **Read-only enforcement** — all write commands deleted; a visible `🔒 Read-Only` badge
- A **global AI chat sidebar** available across all app pages, with context-awareness (terminal CWD, docker node, file path) and a `▶ Run` button that sends AI-suggested commands directly to the active SSH terminal
- **In-app Ollama model management** — users download and switch models (2 GB to 43 GB) without ever touching the CLI
- A **comprehensive SQLite database** storing every conversation, context snapshot, command execution, and model usage record

---

## 2. What We Are Building

### 2.1 New App Layout

```
┌───────────────────────────────────────────────────────────────┐
│  AppHeader   [Terminal] [Docker] [Files]        [💬 AI Chat]  │
├───────────────────────────────────────────────────────────────┤
│                                              │                 │
│   Current Page (Terminal / Docker / Files)   │   Chat Panel   │
│                                              │    (320 px)    │
│                                              │                 │
└──────────────────────────────────────────────┴────────────────┘
```

The `ChatPanel` is mounted **once at the app root** and toggled via the header button from any page.

### 2.2 Docker Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HeaderBar                          [🔒 Read-Only]  [↻ Refresh]  [View] │
├──────────────┬──────────────────────────────────────┬───────────────────┤
│              │                                      │                   │
│   Filter     │   Docker Graph (React Flow)          │   AI Chat Panel   │
│   Sidebar    │   Networks | Containers | Volumes    │   (global)        │
│   (160 px)   │                                      │   (320 px)        │
│              ├──────────────────────────────────────┤                   │
│              │   Explain Panel (120 px, always on)  │                   │
└──────────────┴──────────────────────────────────────┴───────────────────┘
```

### 2.3 Graph Topology

```
LEFT COLUMN          CENTER COLUMN         RIGHT COLUMN
─────────────        ─────────────         ────────────
[backend-net]  ◄───  [🐘 db-1        ]
[blue pill]          [postgres:15    ]  ──► [postgres-data]
                     [pub 5432 ●     ]       [named · 2.4GB]
[frontend-net] ◄───  [⚛  react-app  ]
                     [node:18-alpine ]
                                      ──► [app-uploads   ]
[default]      ◄───  [🔴 redis-cache ]       [named · orphan⚠]
                     [redis:7-alpine ]
```

---

## 3. What Gets Removed

The following code is **deleted** (not disabled) before any new code is added:

| What | Where | Why |
|---|---|---|
| `docker_container_action` function | `src-tauri/src/commands/docker.rs` | Executes write Docker commands |
| `docker_image_action` function | `src-tauri/src/commands/docker.rs` | Executes write Docker commands |
| Their handler registrations | `src-tauri/src/lib.rs` | Unreachable without the functions |
| Their mod.rs exports | `src-tauri/src/commands/mod.rs` | Dead exports |
| Their frontend call sites | `src/api/tauri.ts`, `DockerExplorerPage.tsx` | No callers allowed |
| `ComposeGroupNodeComponent` | `src/components/DockerExplorerPage.tsx` | Replaced by compose color square on card |
| Compose `parentId` / `extent` node logic | `src/components/DockerExplorerPage.tsx` | Replaced by 3-column flat layout |
| Right-side `InspectorPanel` (9 tabs) | `src/components/DockerExplorerPage.tsx` | Replaced by bottom explain panel |

---

## 4. Architecture Overview

### 4.1 Data Flow

```
Remote VM Docker Engine
        │
        │  SSH (existing SshState)
        ▼
Rust backend (src-tauri/src/commands/docker.rs)
   docker ps -a  ──────────────────► list_docker_containers
   docker images ──────────────────► list_docker_images
   docker network ls ───────────────► list_docker_networks
   docker volume ls ────────────────► list_docker_volumes
   docker stats --no-stream ────────► docker_all_container_stats
   docker ps -aq + docker inspect ──► docker_all_mounts  [NEW]
        │
        │  Tauri IPC (invoke)
        ▼
TypeScript (src/api/tauri.ts)
        │
        ▼
useDockerExplorer hook (15s polling, allStats + allMounts)
        │
        ▼
DockerExplorerPage → DockerGraph + ExplainPanel
                                │
                                ▼ onNodeClick
                         PageContextProvider (global)
                                │
                                ▼
                         ChatPanel (global, any page)
                                │
                                ▼ fetch (localhost:11434)
                         Ollama (local LLM, user-managed)
                                │
                                ▼
                         SQLite (harbor-docker-chat.db)
```

### 4.2 New Files Created

```
src/
├── context/
│   └── PageContext.tsx          ← global page context provider
├── lib/
│   └── terminalBus.ts          ← event bus: chat → terminal
├── hooks/
│   ├── useModelManager.ts      ← Ollama detection + model download
│   └── useChatSession.ts       ← SQLite sessions + Ollama streaming
└── components/
    └── ChatPanel.tsx           ← global AI chat UI + model manager
```

### 4.3 Dependencies Added

```bash
# Frontend
npm install @icons-pack/react-simple-icons   # tech brand SVG icons
npm install @tauri-apps/plugin-sql           # SQLite via Tauri plugin
```

```toml
# src-tauri/Cargo.toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

---

## 5. Phase 0 — Safety: Read-Only Enforcement

> This is implemented **first**, before any new feature work begins.

### 5.1 The Rule

The Docker dashboard **never mutates** Docker state. It only reads.

### 5.2 Commands Deleted

```
docker_container_action  →  previously ran: docker start / stop / restart / rm
docker_image_action      →  previously ran: docker rmi / pull
```

Both are removed from `docker.rs`, `mod.rs`, `lib.rs`, and all TypeScript call sites.

### 5.3 Read-Only Whitelist

Only these commands are permitted. No new commands may be added without updating this list:

| Rust Command | Shell Executed on Remote VM |
|---|---|
| `docker_available` | `docker info` |
| `list_docker_containers` | `docker ps -a --format '{{json .}}'` |
| `list_docker_images` | `docker images --format '{{json .}}'` |
| `list_docker_networks` | `docker network ls --format '{{json .}}'` |
| `list_docker_volumes` | `docker volume ls --format '{{json .}}'` |
| `list_compose_projects` | `docker ps --format '{{json .Labels}}'` |
| `docker_container_inspect` | `docker inspect <id>` |
| `docker_container_logs` | `docker logs <id>` |
| `docker_container_stats` | `docker stats --no-stream <id>` |
| `docker_container_events` | `docker events --filter ...` |
| `docker_all_container_stats` | `docker stats --no-stream` (all containers) |
| `docker_all_mounts` *(new)* | `docker ps -aq` → `docker inspect <ids...>` |

### 5.4 UI Badge

The header bar displays a **green shield badge** at all times on the Docker page:

```
🔒 Read-Only
```

Clicking it opens a small popover:
> *"Harbor's Docker view only reads from your Docker socket. It never starts, stops, removes, or modifies any container, image, network, or volume. Commands used: docker ps, docker inspect, docker stats, docker logs, docker events."*

---

## 6. Phase 1 — Technology Icons

### 6.1 Package

```bash
npm install @icons-pack/react-simple-icons
```

SVG components for 3000+ tech brands, fully bundled — no CDN, no network requests. Safe for offline/Tauri use.

### 6.2 Icon Mapping

Each container image name is matched against these patterns (first match wins):

| Image Pattern | Icon Component | Brand Color |
|---|---|---|
| `postgres` / `postgresql` | `SiPostgresql` | `#4169E1` |
| `mysql` | `SiMysql` | `#4479A1` |
| `mariadb` | `SiMariadb` | `#003545` |
| `mongo` | `SiMongodb` | `#47A248` |
| `elastic` / `elasticsearch` | `SiElasticsearch` | `#005571` |
| `cockroach` | `SiCockroachdb` | `#6933FF` |
| `redis` | `SiRedis` | `#FF4438` |
| `memcached` | `SiMemcached` | `#00B2A9` |
| `kafka` | `SiApachekafka` | `#231F20` |
| `rabbitmq` | `SiRabbitmq` | `#FF6600` |
| `nginx` | `SiNginx` | `#009639` |
| `traefik` | `SiTraefik` | `#24A1C1` |
| `haproxy` | `SiApachehaproxy` | `#0068D1` |
| `prometheus` | `SiPrometheus` | `#E6522C` |
| `grafana` | `SiGrafana` | `#F46800` |
| `kibana` | `SiElasticstack` | `#005571` |
| `node` / `nodejs` | `SiNodedotjs` | `#339933` |
| `react` | `SiReact` | `#61DAFB` |
| `vue` | `SiVuedotjs` | `#4FC08D` |
| `next` | `SiNextdotjs` | `#000000` |
| `svelte` | `SiSvelte` | `#FF3E00` |
| `django` | `SiDjango` | `#092E20` |
| `flask` | `SiFlask` | `#000000` |
| `fastapi` | `SiFastapi` | `#009688` |
| `python` | `SiPython` | `#3776AB` |
| `spring` | `SiSpring` | `#6DB33F` |
| `rails` / `ruby` | `SiRuby` | `#CC342D` |
| `laravel` | `SiLaravel` | `#FF2D20` |
| `php` | `SiPhp` | `#777BB4` |
| *(no match)* | Lucide `Box` (fallback) | `#6b7280` |

### 6.3 Fallback Strategy

The existing `SERVICE_CONFIG` map (for background tints and filter chip colors by `ServiceType`) is **kept unchanged**. Only the icon displayed in the top-right of each container card is replaced with the `Si*` brand icon. If no `Si*` match is found, the Lucide fallback icon from `SERVICE_CONFIG` is used.

---

## 7. Phase 2 — New Rust Backend Command

### 7.1 Why It's Needed

Container-to-volume edges require knowing which volumes each container actually mounts. This data comes from `docker inspect`, not `docker ps`. A single batched SSH call fetches it for all containers at once.

### 7.2 New Structs — `src-tauri/src/commands/docker.rs`

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MountEntry {
    #[serde(rename = "Type",        alias = "type")]          pub kind:        String,
    #[serde(rename = "Name",        alias = "name",        default)] pub name:  String,
    #[serde(rename = "Source",      alias = "source",      default)] pub source: String,
    #[serde(rename = "Destination", alias = "destination", default)] pub destination: String,
    #[serde(rename = "RW",          alias = "rw",          default)] pub rw:    bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContainerMountInfo {
    pub id:     String,
    pub name:   String,   // container name, stripped of leading "/"
    pub mounts: Vec<MountEntry>,
}

// Internal only — never serialized to frontend
#[derive(Debug, Deserialize)]
struct InspectRaw {
    #[serde(rename = "Id")]               id:     String,
    #[serde(rename = "Name")]             name:   String,
    #[serde(rename = "Mounts", default)]  mounts: Vec<MountEntry>,
}
```

> **Why the dual `rename`/`alias`:** Docker's `inspect` JSON uses PascalCase (`"Type"`, `"Name"`, `"RW"`). The `alias` handles lowercase variants defensively.

### 7.3 New Command

```rust
#[tauri::command]
pub async fn docker_all_mounts(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<ContainerMountInfo>, String> {
    let session = {
        let guard = state.0.lock().await;
        guard.as_ref().ok_or("Not connected")?.clone()
    };
    tokio::task::spawn_blocking(move || {
        let ids_out = sftp_op!(session.channel_session(), {
            ch.exec("docker ps -aq 2>/dev/null").map_err(|e| e.to_string())?;
            let mut s = String::new();
            ch.read_to_string(&mut s).map_err(|e| e.to_string())?;
            Ok::<String, String>(s)
        })?;
        let ids: String = ids_out.split_whitespace().collect::<Vec<_>>().join(" ");
        if ids.is_empty() { return Ok(vec![]); }
        let inspect_out = sftp_op!(session.channel_session(), {
            ch.exec(&format!("docker inspect {} 2>/dev/null", ids))
              .map_err(|e| e.to_string())?;
            let mut s = String::new();
            ch.read_to_string(&mut s).map_err(|e| e.to_string())?;
            Ok::<String, String>(s)
        })?;
        let raw: Vec<InspectRaw> = serde_json::from_str(&inspect_out).unwrap_or_default();
        Ok(raw.into_iter().map(|r| ContainerMountInfo {
            id:     r.id,
            name:   r.name.trim_start_matches('/').to_string(),
            mounts: r.mounts,
        }).collect())
    }).await.map_err(|e| e.to_string())?
}
```

### 7.4 Register in `mod.rs` and `lib.rs`

`src-tauri/src/commands/mod.rs`:
```rust
pub use docker::{docker_all_mounts, ContainerMountInfo, MountEntry};
```

`src-tauri/src/lib.rs` — add to `generate_handler![]`:
```rust
docker_all_mounts,
```

---

## 8. Phase 3 — TypeScript API & Hook Updates

### 8.1 `src/api/tauri.ts`

Add types and invoke wrapper:

```typescript
export interface MountEntry {
  kind:        string;   // "volume" | "bind" | "tmpfs"
  name:        string;   // volume name (empty for bind mounts)
  source:      string;   // host path
  destination: string;   // container path inside the container
  rw:          boolean;  // true = read-write, false = read-only
}

export interface ContainerMountInfo {
  id:     string;
  name:   string;        // container name without leading "/"
  mounts: MountEntry[];
}

export async function dockerAllMounts(): Promise<ContainerMountInfo[]> {
  return invoke<ContainerMountInfo[]>("docker_all_mounts");
}
```

Also **remove** the following from `tauri.ts`:
- Any function calling `docker_container_action`
- Any function calling `docker_image_action`

### 8.2 `src/hooks/useDockerExplorer.ts`

Add `allMounts` to `DockerState`:

```typescript
export interface DockerState {
  available:  boolean;
  loading:    boolean;
  error:      string | null;
  containers: DockerContainer[];
  images:     DockerImage[];
  networks:   DockerNetwork[];
  volumes:    DockerVolume[];
  projects:   ComposeProject[];
  allStats:   Map<string, ContainerStats>;
  allMounts:  ContainerMountInfo[];        // ← NEW
}
```

In `fetchAll`, add to `Promise.all`:
```typescript
const [containers, images, networks, volumes, projects, statsArr, mountsArr] =
  await Promise.all([
    listDockerContainers().catch(() => []),
    listDockerImages().catch(() => []),
    listDockerNetworks().catch(() => []),
    listDockerVolumes().catch(() => []),
    listComposeProjects().catch(() => []),
    dockerAllContainerStats().catch(() => []),
    dockerAllMounts().catch(() => []),       // ← NEW
  ]);
```

---

## 9. Phase 4 — Graph Layout Redesign

### 9.1 Layout Constants

```typescript
// Horizontal 3-column fixed-position layout
const NET_X = 10,  NET_W = 130, NET_H = 30, NET_GAP = 14;   // left column
const CON_X = 200, CON_W = 158, CON_H = 56, CON_GAP = 10;   // center column
const VOL_X = 420, VOL_W = 148, VOL_H = 50, VOL_GAP = 12;   // right column
```

### 9.2 Container Node Card

```
┌──────────────────────────────────────────┐
│ ■ [●] api-server                [🐘 16px] │  Row 1: compose square · state dot · name · Si* icon
│ [pub 8080] [pub 443] [int 3000]           │  Row 2: port badges (red=pub, gray=int)
│ [postgres:15-alpine]                      │  Row 3: purple image chip (18 char max)
│ [████░░  2.1%]  128 MB                   │  Row 4: CPU bar (60px) + mem text
└──────────────────────────────────────────┘
```

- **Background:** `serviceConfig.bg` (service-type tint)
- **Left border:** `3px solid` in state color (green=running, red=exited, amber=restarting)
- **Selected:** `outline: 1.5px solid #6366f1`
- **React Flow handles:** `source` on right side, `target` on left side

### 9.3 Network Node (Blue Pill)

```
┌────────────────────────────────┐
│  🌐  backend-net               │
└────────────────────────────────┘
```

- `border-radius: 15px` · `background: #E6F1FB` · `border: 1.5px solid #378ADD`
- React Flow handle: `target` on right edge (containers connect from center → left)

### 9.4 Volume Node (White Card)

**Named volume (normal):**
```
┌──────────────────────────────┐
│  🗄  postgres-data  [2 mounts]│
└──────────────────────────────┘
```

**Orphan volume (amber warning):**
```
┌──────────────────────────────┐
│  ⚠  old-backup-data  orphan  │  amber border #f59e0b
└──────────────────────────────┘
```

- React Flow handle: `target` on left edge (containers connect from center → right)

### 9.5 Edges

**Container → Network edges**
- Source: container node right handle
- Target: network node right handle (network is to the left, so edge goes left)
- Built from `container.networks` field (comma-separated network names from `docker ps`)

**Container → Volume edges**
- Source: container node right handle
- Target: volume node left handle
- Built from `allMounts` data (real `docker inspect` — never inferred)
- Edge color: `#6366f1` (indigo) for read-write, `#9ca3af` (gray) for read-only
- Edge label: `rw` or `ro`

**No inferred edges.** Only connections that Docker itself reports are drawn.

### 9.6 Selection Highlighting

```typescript
// State
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

// Related nodes: selected + its direct 1-hop neighbors
const relatedIds = useMemo(() => {
  if (!selectedNodeId) return null;
  const ids = new Set([selectedNodeId]);
  edges.forEach(e => {
    if (e.source === selectedNodeId) ids.add(e.target);
    if (e.target === selectedNodeId) ids.add(e.source);
  });
  return ids;
}, [selectedNodeId, edges]);

// Apply: unrelated nodes → opacity 0.12, unrelated edges → opacity 0.06
// Related edges → strokeWidth 2.4
// All via CSS transition: 0.15s
```

Click the same node again → deselects, all opacity returns to 1.

### 9.7 Port Badge Parser

```typescript
function parsePorts(portsStr: string): { pub: number[]; int: number[] } {
  const pub: number[] = [], int: number[] = [];
  if (!portsStr) return { pub, int };
  for (const p of portsStr.split(",").map(s => s.trim())) {
    const hostMatch = p.match(/0\.0\.0\.0:(\d+)->/);
    if (hostMatch) { pub.push(Number(hostMatch[1])); continue; }
    const intMatch = p.match(/(\d+)\//);
    if (intMatch) int.push(Number(intMatch[1]));
  }
  return { pub, int };
}
// "0.0.0.0:5432->5432/tcp"  →  red  badge: pub 5432
// "6379/tcp"                →  gray badge: int 6379
```

### 9.8 Orphan Volume Detection

```typescript
// Build a map: volume name → [container names that mount it]
const volumeUsers = new Map<string, string[]>();
for (const cmi of allMounts) {
  for (const m of cmi.mounts) {
    if (m.kind === "volume" && m.name) {
      const arr = volumeUsers.get(m.name) ?? [];
      arr.push(cmi.name);
      volumeUsers.set(m.name, arr);
    }
  }
}

// A volume is orphaned when no container mounts it
const isOrphan = (volumeName: string) =>
  (volumeUsers.get(volumeName)?.length ?? 0) === 0;
```

---

## 10. Phase 5 — Bottom Explain Panel

Always visible at `height: 120px` below the graph canvas. No AI call — pure template strings built from live node data at render time.

### 10.1 Panel States

#### No node selected
```
Click any node to explore — containers, networks, and volumes light up their connections.
```
*(centered, muted gray text)*

#### Container selected
```
[🐘 32px]  db-1                                  ● running
           postgres:15-alpine                     database

A PostgreSQL database container running for 3 days. It exposes port 5432 to
the host (published — accessible from outside the VM). Part of myapp project.

Networks:  backend-net  default
Volumes:   postgres-data → /var/lib/postgresql/data  (rw)
CPU / Mem: ████░░  2.1%  /  128 MB
```

#### Network selected
```
[🌐 32px]  backend-net                            bridge

An internal bridge network. Containers on this network can reach each other
by name — isolated from other networks unless explicitly connected.

Subnet:     172.20.0.0/16     Gateway: 172.20.0.1
Attached:   api-server  db-1  redis  (3 containers)
```

#### Volume selected (normal)
```
[🗄 32px]  postgres-data                          named · local

A named volume managed by Docker. Contents persist across container restarts
and survive container removal. Mounted read-write by 1 container.

Size:       2.4 GB
Mount:      /var/lib/postgresql/data  (rw)  in  db-1
```

#### Volume selected (orphan)
```
[⚠ 32px amber]  old-backup-data                  named · local · orphan

⚠ This volume is not mounted by any running container. Its data is not in
active use and may be safe to remove.

Size:       180 MB
Reclaim:    docker volume rm old-backup-data
```

---

## 11. Phase 6 — AI Model Management

### 11.1 Backend: Ollama

The AI chat is powered by **Ollama** — a local LLM inference server. Ollama runs on the user's machine (not the remote VM), exposes a REST API on `http://localhost:11434`, and keeps all data private.

The app detects Ollama by calling `GET http://localhost:11434/api/tags`. If Ollama is not running, the chat panel shows an install prompt. If it is running but no models are downloaded, it shows the model catalog.

### 11.2 Model Catalog (Baked In)

Users download and manage models entirely within the app. No Ollama CLI needed.

| Model ID | Display Name | Size | Tier | Description |
|---|---|---|---|---|
| `phi3:mini` | Phi-3 Mini | 2.3 GB | Fast | Quick answers. Runs on any machine. |
| `llama3.2:3b` | Llama 3.2 3B | 2.0 GB | Fast | Excellent quality/speed balance. |
| `qwen2.5:3b` | Qwen 2.5 3B | 1.9 GB | Fast | Strong at infra and code topics. |
| `mistral:7b` | Mistral 7B | 4.1 GB | Balanced | High quality. Needs 8 GB RAM. |
| `llama3.1:8b` | Llama 3.1 8B | 4.7 GB | Balanced | Long, detailed explanations. |
| `llama3.3:70b` | Llama 3.3 70B | 43 GB | Max | Best quality. Needs GPU / 64 GB RAM. |

No size restriction is enforced. The user decides what their machine can handle.

### 11.3 `useModelManager` Hook — `src/hooks/useModelManager.ts`

```typescript
interface ModelManager {
  ollamaRunning:    boolean;
  installedModels:  string[];                    // ["phi3:mini", "llama3.2:3b"]
  activeModel:      string | null;               // stored in localStorage
  downloadProgress: Map<string, number>;         // modelId → 0-100%
  pullModel:        (id: string) => Promise<void>;
  deleteModel:      (id: string) => Promise<void>;
  setActiveModel:   (id: string) => void;
}
```

**Download mechanism** — streams progress from Ollama's pull API:
```typescript
async function pullModel(modelId: string, onProgress: (pct: number) => void) {
  const res = await fetch("http://localhost:11434/api/pull", {
    method: "POST",
    body: JSON.stringify({ name: modelId, stream: true }),
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n").filter(Boolean)) {
      const j = JSON.parse(line);
      if (j.total && j.completed)
        onProgress(Math.round((j.completed / j.total) * 100));
    }
  }
}
```

### 11.4 Model Manager UI

Opened via `⚙ Models` button in the chat panel header:

```
┌──────────────────────────────────┐
│  AI Models                [Done] │
├──────────────────────────────────┤
│  Ollama: ● Running               │
│                                  │
│  INSTALLED                       │
│  ● phi3:mini      2.3 GB   [✕]  │  ← active (radio)
│  ○ llama3.2:3b    2.0 GB   [✕]  │
│                                  │
│  AVAILABLE TO DOWNLOAD           │
│  qwen2.5:3b   1.9 GB  Fast  [↓] │
│  mistral:7b   4.1 GB  Bal   [↓] │
│  llama3.1:8b  4.7 GB  Bal   [↓] │
│  llama3.3:70b 43 GB   Max   [↓] │
│                                  │
│  ▓▓▓▓▓▓░░░░ 62%  mistral:7b    │  ← live download progress
└──────────────────────────────────┘
```

---

## 12. Phase 7 — Global AI Chat Panel

### 12.1 Scope

The chat is **not** scoped to the Docker page. It is a global feature, accessible from any page. The same `ChatPanel` component serves:

- Terminal page — knows CWD, last command, last output
- Docker page — knows selected container/network/volume details
- Files page — knows current file path

### 12.2 Page Context Provider — `src/context/PageContext.tsx`

Each page updates its context whenever relevant state changes. The chat reads the active context when building each message's system prompt.

```typescript
type CurrentPage = "terminal" | "docker" | "files" | "home";

interface TerminalContext {
  cwd:              string;
  connectedHost:    string;
  lastCommand:      string;
  lastOutputLines:  string[];   // last 30 lines of terminal output
}

interface DockerContext {
  selectedNodeId:    string | null;
  selectedNodeType:  "container" | "network" | "volume" | null;
  selectedNodeJson:  string | null;   // full serialized node data
  containerCount:    number;
  networkCount:      number;
  volumeCount:       number;
}

interface FileContext {
  filePath: string;
  fileName: string;
}
```

### 12.3 Dynamic System Prompt

The system prompt is rebuilt on every message from live context:

**Terminal page:**
```
You are an expert infrastructure assistant embedded in HarborSCP.
When suggesting shell commands, wrap them in ```bash blocks — they can be run
directly in the user's terminal with one click.

CURRENT CONTEXT — Terminal:
Host: user@192.168.1.100
Working directory: /var/www/myapp
Last command run: docker-compose up -d
Last output:
  Creating network "myapp_default" with the default driver
  Creating myapp_db_1 ... done
  Creating myapp_api_1 ... done
```

**Docker page:**
```
You are an expert infrastructure assistant embedded in HarborSCP.

CURRENT CONTEXT — Docker Dashboard:
Host: user@192.168.1.100
Containers: 12, Networks: 4, Volumes: 8
Selected node:
{
  "type": "container",
  "name": "db-1",
  "image": "postgres:15-alpine",
  "state": "running",
  "ports": "0.0.0.0:5432->5432/tcp",
  "networks": "backend-net,default"
}
```

### 12.4 Terminal "Run Command" Integration

#### Event Bus — `src/lib/terminalBus.ts`

```typescript
export const terminalBus = new EventTarget();

export function sendCommandToTerminal(command: string) {
  terminalBus.dispatchEvent(
    Object.assign(new Event("run-command"), { command })
  );
}
```

#### Terminal Panel subscribes on mount:

```typescript
useEffect(() => {
  const handler = (e: Event & { command?: string }) => {
    if (e.command) ptyWriteRef.current?.(e.command + "\n");
  };
  terminalBus.addEventListener("run-command", handler);
  return () => terminalBus.removeEventListener("run-command", handler);
}, []);
```

#### Command Card UI in chat responses:

When the AI response contains a ` ```bash ` code block, it renders as:

```
┌──────────────────────────────────────────────┐
│  bash                                        │
│  $ docker logs --tail 100 api-server         │
│                              [Copy]  [▶ Run] │
└──────────────────────────────────────────────┘
```

- `[▶ Run]` → calls `sendCommandToTerminal(command)`
- `[Copy]` → calls `navigator.clipboard.writeText(command)`
- `python` / `sql` blocks → `[Copy]` only, no Run button

### 12.5 Chat Panel UI

```
┌─────────────────────────────────────┐
│  Docker AI      [● Ollama] [⚙] [+]  │  header bar
├─────────────────────────────────────┤
│  ▾ Jul 22 14:30  (current session)  │  session picker dropdown
│    Jul 21 09:15                     │
│    Jul 20 17:42                     │
├─────────────────────────────────────┤
│                                     │
│  [You clicked db-1 (postgres:15)]   │  auto-msg: gray bg, small font
│                                     │
│  ┌───────────────────────────────┐  │
│  │ [🐘] db-1 is a PostgreSQL 15  │  │  AI response: white card, left
│  │ database. Port 5432 is        │  │
│  │ published to the host...      │  │
│  └───────────────────────────────┘  │
│                                     │
│              [Is this version safe?]│  user msg: blue tint, right-aligned
│                                     │
│  ┌───────────────────────────────┐  │
│  │ PostgreSQL 15 is the current  │  │  streaming: blinking cursor ▌
│  │ stable release... ▌           │  │
│  └───────────────────────────────┘  │
│                                     │
├─────────────────────────────────────┤
│  [Ask anything about db-1...   ] ↵  │  input + send button
└─────────────────────────────────────┘
```

**States:**
- `ollamaRunning = false` → amber banner: *"Ollama not running. [Download Ollama ↗]"*
- `activeModel = null` → blue banner: *"No model selected. [⚙ Choose Model]"*
- `streaming = true` → input disabled + spinner on send button
- `messages.length === 0` → placeholder: *"Click any node or ask a question to start"*

**Ollama API call (per message):**
```typescript
// POST http://localhost:11434/api/chat
{
  model: activeModel,     // "phi3:mini" etc — user's choice
  stream: true,
  messages: [
    { role: "system",    content: buildSystemPrompt(pageContext) },
    ...last10Messages,   // rolling context window
    { role: "user",      content: userText }
  ]
}
```

---

## 13. Phase 8 — Comprehensive SQLite Database

### 13.1 Overview

Every interaction is recorded. Nothing is discarded. The database enables:
- Full conversation replay with original context
- "Commands I've run" history
- Model performance comparison
- Session search and archive
- Audit trail of what the AI said vs what was executed

**Database file:** `harbor-docker-chat.db` in the Tauri app data directory.  
**Plugin:** `@tauri-apps/plugin-sql` with SQLite backend.

### 13.2 Schema — 6 Tables

---

#### Table 1: `chat_sessions`

One row per conversation thread.

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            TEXT    PRIMARY KEY,
  title         TEXT,                  -- auto-set from first 60 chars of first user message
  host          TEXT    NOT NULL,      -- SSH host at session start, e.g. "user@192.168.1.10"
  origin_page   TEXT    NOT NULL,      -- page where created: 'terminal'|'docker'|'files'|'home'
  started_at    INTEGER NOT NULL,      -- unix ms
  last_active   INTEGER NOT NULL,      -- unix ms — updated on every message
  message_count INTEGER DEFAULT 0,     -- maintained by app logic
  model_used    TEXT,                  -- last active model in this session
  archived      INTEGER DEFAULT 0      -- soft delete: 1 = hidden from default list
);

CREATE INDEX IF NOT EXISTS idx_sessions_host        ON chat_sessions(host);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON chat_sessions(last_active DESC);
```

---

#### Table 2: `chat_messages`

Every message in every session.

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id            TEXT    PRIMARY KEY,
  session_id    TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          TEXT    NOT NULL CHECK(role IN ('user','assistant','system','auto')),
                        -- 'auto' = node-click injected context message (not typed by user)
  content       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,      -- unix ms

  -- Page context captured at the moment this message was sent
  ctx_page      TEXT,                  -- 'terminal'|'docker'|'files'|'home'
  ctx_host      TEXT,                  -- SSH host at message time
  ctx_cwd       TEXT,                  -- working directory (terminal page)
  ctx_last_cmd  TEXT,                  -- last command visible in terminal at send time
  ctx_node_id   TEXT,                  -- selected docker node ID (docker page)
  ctx_node_type TEXT,                  -- 'container'|'network'|'volume'
  ctx_node_json TEXT,                  -- full JSON of selected node

  -- AI response metadata (assistant messages only)
  model_id      TEXT,                  -- model that generated this, e.g. "phi3:mini"
  response_ms   INTEGER,               -- wall-clock ms from request start to last token
  token_count   INTEGER,               -- estimated token count of response
  has_commands  INTEGER DEFAULT 0,     -- 1 if content contains ```bash blocks

  -- Error tracking
  error         TEXT                   -- non-null if Ollama returned an error for this message
);

CREATE INDEX IF NOT EXISTS idx_messages_session  ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_has_cmds ON chat_messages(has_commands) WHERE has_commands = 1;
CREATE INDEX IF NOT EXISTS idx_messages_model    ON chat_messages(model_id) WHERE model_id IS NOT NULL;
```

---

#### Table 3: `chat_commands`

Every shell command extracted from AI responses.

```sql
CREATE TABLE IF NOT EXISTS chat_commands (
  id          TEXT    PRIMARY KEY,
  message_id  TEXT    NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  session_id  TEXT    NOT NULL,        -- denormalized for easy querying
  language    TEXT    NOT NULL DEFAULT 'bash',  -- bash|python|sql|yaml|etc
  command     TEXT    NOT NULL,        -- exact text inside the code block
  block_index INTEGER NOT NULL,        -- 0-based order within the message (1st, 2nd block, etc)

  -- User interaction tracking
  was_copied  INTEGER DEFAULT 0,       -- 1 if user clicked [Copy]
  was_run     INTEGER DEFAULT 0,       -- 1 if user clicked [▶ Run]
  run_count   INTEGER DEFAULT 0,       -- incremented every time [▶ Run] is clicked
  first_run_at INTEGER,                -- unix ms of first Run click
  last_run_at  INTEGER                 -- unix ms of most recent Run click
);

CREATE INDEX IF NOT EXISTS idx_commands_session ON chat_commands(session_id);
CREATE INDEX IF NOT EXISTS idx_commands_was_run ON chat_commands(was_run) WHERE was_run = 1;
CREATE INDEX IF NOT EXISTS idx_commands_lang    ON chat_commands(language);
```

---

#### Table 4: `terminal_snapshots`

A snapshot of the terminal state captured each time a user sends a message from the terminal page.

```sql
CREATE TABLE IF NOT EXISTS terminal_snapshots (
  id           TEXT    PRIMARY KEY,
  session_id   TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id   TEXT    REFERENCES chat_messages(id) ON DELETE SET NULL,
  host         TEXT    NOT NULL,
  cwd          TEXT,                   -- current working directory
  last_command TEXT,                   -- last command run before this message
  last_output  TEXT,                   -- last 30 lines of terminal output (joined with \n)
  captured_at  INTEGER NOT NULL        -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_tsnap_session ON terminal_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_tsnap_host    ON terminal_snapshots(host);
```

---

#### Table 5: `docker_snapshots`

A snapshot of the Docker graph state captured when a node is clicked and auto-messages are sent.

```sql
CREATE TABLE IF NOT EXISTS docker_snapshots (
  id                 TEXT    PRIMARY KEY,
  session_id         TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id         TEXT    REFERENCES chat_messages(id) ON DELETE SET NULL,
  host               TEXT    NOT NULL,
  selected_node_id   TEXT,
  selected_node_type TEXT,             -- 'container'|'network'|'volume'
  selected_node_json TEXT,             -- full JSON snapshot of the node at click time
  total_containers   INTEGER,          -- total containers visible at the time
  total_networks     INTEGER,
  total_volumes      INTEGER,
  captured_at        INTEGER NOT NULL  -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_dsnap_session ON docker_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_dsnap_node    ON docker_snapshots(selected_node_id) WHERE selected_node_id IS NOT NULL;
```

---

#### Table 6: `model_usage_log`

Per-message AI performance and usage telemetry.

```sql
CREATE TABLE IF NOT EXISTS model_usage_log (
  id             TEXT    PRIMARY KEY,
  session_id     TEXT    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id     TEXT    NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  model_id       TEXT    NOT NULL,     -- "phi3:mini" | "llama3.2:3b" | etc
  prompt_chars   INTEGER,              -- character count of full prompt sent to Ollama
  response_chars INTEGER,              -- character count of response received
  response_ms    INTEGER,              -- wall-clock latency ms
  streamed       INTEGER DEFAULT 1,    -- 1 = streaming was used
  used_at        INTEGER NOT NULL      -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_usage_model   ON model_usage_log(model_id);
CREATE INDEX IF NOT EXISTS idx_usage_session ON model_usage_log(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_date    ON model_usage_log(used_at);
```

### 13.3 What Each Table Enables

| Table | Enables |
|---|---|
| `chat_sessions` | Session list view, archive/restore, host-scoped filtering |
| `chat_messages` | Full conversation replay, global search, export to markdown |
| `chat_commands` | "Commands I've run" audit log, re-run history, copy statistics |
| `terminal_snapshots` | Replay what terminal looked like when each question was asked |
| `docker_snapshots` | Replay which container/network/volume was selected per question |
| `model_usage_log` | Model latency comparison, total usage per model, session cost estimates |

---

## 14. Full File Change Manifest

### Deleted

| File | What's Removed |
|---|---|
| `src-tauri/src/commands/docker.rs` | `docker_container_action`, `docker_image_action` functions |
| `src-tauri/src/commands/mod.rs` | Their re-exports |
| `src-tauri/src/lib.rs` | Their handler registrations |
| `src/api/tauri.ts` | Their frontend invoke wrappers |
| `src/components/DockerExplorerPage.tsx` | `ComposeGroupNodeComponent`, `InspectorPanel`, compose parent node logic |

### Modified

| File | What Changes |
|---|---|
| `package.json` | Add `@icons-pack/react-simple-icons`, `@tauri-apps/plugin-sql` |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-sql = { version = "2", features = ["sqlite"] }` |
| `src-tauri/src/lib.rs` | Register `tauri_plugin_sql`, add `docker_all_mounts` to handler |
| `src-tauri/capabilities/default.json` | Add `sql:allow-execute`, `sql:allow-select`, `sql:allow-load` |
| `src-tauri/src/commands/docker.rs` | Add `MountEntry`, `ContainerMountInfo`, `InspectRaw` structs + `docker_all_mounts` command |
| `src-tauri/src/commands/mod.rs` | Export `docker_all_mounts`, `ContainerMountInfo`, `MountEntry` |
| `src/api/tauri.ts` | Add `MountEntry`, `ContainerMountInfo`, `dockerAllMounts()` |
| `src/hooks/useDockerExplorer.ts` | Add `allMounts: ContainerMountInfo[]` to state; fetch in `fetchAll` |
| `src/components/DockerExplorerPage.tsx` | Full redesign — 3-column graph, brand icons, explain panel, read-only badge, chat wiring |
| `src/components/TerminalPanel.tsx` | Subscribe to `terminalBus` → write received commands to SSH PTY |
| `src/App.tsx` (or root layout) | Mount `PageContextProvider` + `ChatPanel` at root; add chat toggle to header |

### Created

| File | Purpose |
|---|---|
| `src/context/PageContext.tsx` | Global page context provider — terminal / docker / file state |
| `src/lib/terminalBus.ts` | Lightweight event bus: chat `▶ Run` → terminal PTY write |
| `src/hooks/useModelManager.ts` | Ollama detection, model catalog, pull progress, active model |
| `src/hooks/useChatSession.ts` | SQLite sessions, Ollama streaming chat, message + snapshot persistence |
| `src/components/ChatPanel.tsx` | Global AI chat sidebar + inline model manager modal |

---

## 15. Verification Checklist

### Build

- [ ] `cargo build` in `src-tauri/` — zero Rust compilation errors
- [ ] `npm run typecheck` — zero TypeScript errors
- [ ] `npm run lint` — zero ESLint errors
- [ ] `npm run tauri dev` — app starts and connects to SSH server

### Read-Only Safety

- [ ] `grep -r "docker_container_action" src/` → zero results
- [ ] `grep -r "docker_image_action" src-tauri/` → zero results
- [ ] `🔒 Read-Only` badge visible in header on Docker page
- [ ] Clicking the badge opens popover listing read-only commands
- [ ] No button, right-click menu, or keyboard shortcut can start/stop/remove anything

### Graph Layout

- [ ] 3-column layout: blue network pills (left) · container cards (center) · volume cards (right)
- [ ] Postgres container shows PostgreSQL elephant icon in `#4169E1` blue
- [ ] Redis container shows Redis cube icon in `#FF4438` red
- [ ] Spring Boot container shows Spring leaf icon in `#6DB33F` green
- [ ] Kafka container shows Kafka logo in `#231F20`
- [ ] Unknown/custom image shows Lucide `Box` fallback
- [ ] Container→volume edges appear only for containers with actual volume mounts
- [ ] `rw` edges are indigo, `ro` edges are gray
- [ ] No compose parent boxes — compose membership shown as tiny colored square on card only
- [ ] Port badges: `pub 5432` in red for host-exposed, `int 6379` in gray for internal
- [ ] CPU bar fills proportionally; mem text displayed beside it
- [ ] Running container has green left border, exited has red, restarting has amber

### Selection Highlighting

- [ ] Click a container → it and its directly connected nodes stay at full opacity; everything else fades to ~10%
- [ ] Edges to connected nodes become thicker (strokeWidth 2.4); unrelated edges near-invisible
- [ ] Explain panel updates immediately with container details, service description, networks, volumes
- [ ] Click same node again → full opacity restored across all nodes/edges
- [ ] Click a different node → highlight switches to new selection

### Explain Panel

- [ ] Container click: tech name sentence + uptime + port exposure note + compose project name
- [ ] Network click: driver semantics explained in plain English + subnet + gateway + attached count
- [ ] Volume click (normal): persistence explanation + mount path + rw/ro + container name
- [ ] Orphan volume click: amber warning + "not mounted by any container" + `docker volume rm` command shown
- [ ] Panel shows immediately on click with no loading state (data is pre-computed)

### Model Manager

- [ ] `⚙ Models` button in chat header opens model manager modal
- [ ] Installed models listed with radio buttons; clicking selects active model
- [ ] Active model selection persists across app restarts (localStorage)
- [ ] Clicking `↓` on available model starts download; progress bar updates live (0–100%)
- [ ] After download completes, model moves to Installed list
- [ ] `llama3.3:70b` (43 GB) can be initiated — no size restriction enforced by app
- [ ] Clicking `✕` next to installed model removes it (calls `DELETE /api/delete`)

### Global Chat — Without Ollama

- [ ] Amber banner: *"Ollama not running"* with link to download page
- [ ] Explain panel still shows template narrations — no empty state or crash
- [ ] Chat input is disabled when Ollama unavailable

### Global Chat — With Ollama + Active Model

- [ ] Chat panel accessible from header `💬` button on any page (terminal, docker, files)
- [ ] Click a container on Docker page → auto-message sent with node context; AI streams response
- [ ] Click a network → auto-message includes network name, driver, subnet
- [ ] Type follow-up question → AI response uses full conversation history (last 10 messages)
- [ ] System prompt reflects current page (terminal CWD / docker node / file path)
- [ ] `[+]` New button → new session created; prior session preserved

### Terminal Integration

- [ ] AI response with `bash` code block renders styled command card with `[▶ Run]` and `[Copy]`
- [ ] `[▶ Run]` sends command to active SSH terminal and it executes
- [ ] `[Copy]` writes command text to clipboard
- [ ] `python` / `sql` blocks show `[Copy]` only — no Run button

### SQLite Persistence

- [ ] `harbor-docker-chat.db` exists in Tauri app data dir after first message
- [ ] All 6 tables present with correct schema
- [ ] `chat_sessions` row created with `title`, `host`, `origin_page`, `started_at`
- [ ] `chat_messages` row for every message with `ctx_page`, `ctx_cwd`, `ctx_node_json` populated
- [ ] `chat_commands` rows created for every `bash` code block in assistant messages
- [ ] `was_run` set to 1 and `run_count` incremented when `▶ Run` is clicked
- [ ] `terminal_snapshots` row saved for each user message on terminal page (cwd + last output)
- [ ] `docker_snapshots` row saved for each node-click auto-message (node JSON + counts)
- [ ] `model_usage_log` row saved after each AI response (`model_id`, `response_ms`, `response_chars`)
- [ ] Session dropdown shows past sessions sorted by `last_active DESC`
- [ ] Switching sessions loads complete message history from SQLite
- [ ] Restart app → all sessions, messages, snapshots, and usage logs intact

---

*Document generated: 2026-07-22 · HarborSCP Docker Dashboard Redesign v1.0*
