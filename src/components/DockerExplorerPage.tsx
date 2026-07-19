import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  Copy,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDockerExplorer } from "../hooks/useDockerExplorer";
import type {
  ComposeProject,
  ContainerStats,
  DockerContainer,
  DockerNetwork,
  DockerVolume,
} from "../api";

interface DockerExplorerPageProps {
  onClose: () => void;
}

type FilterType = "all" | "running" | "stopped" | "compose";
type ViewMode = "graph" | "list";

export function DockerExplorerPage({ onClose }: DockerExplorerPageProps) {
  const docker = useDockerExplorer();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<
    "container" | "image" | "network" | "volume" | null
  >(null);

  const selectedContainer =
    docker.containers.find((c) => c.id === selectedId && selectedType === "container") ?? null;

  const filteredContainers = docker.containers.filter((c) => {
    const matchSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.image.toLowerCase().includes(search.toLowerCase()) ||
      c.ports.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ||
      (filter === "running" && c.state === "running") ||
      (filter === "stopped" && c.state !== "running") ||
      (filter === "compose" && !!c.compose_project);
    return matchSearch && matchFilter;
  });

  function handleSelectContainer(id: string) {
    setSelectedId(id);
    setSelectedType("container");
  }

  function handleCloseInspector() {
    setSelectedId(null);
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface-pane">
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border-raised bg-surface-toolbar px-4">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={14} strokeWidth={2.2} />
          HarborSCP
        </button>
        <div className="flex items-center gap-1.5 text-text-faint">
          <ChevronRight size={13} strokeWidth={2} />
          <Box size={13} strokeWidth={2} />
          <span className="text-[13px] font-semibold text-text-primary">Docker Infrastructure</span>
        </div>
        <div className="flex-1" />
        <div className="flex gap-1 rounded-[8px] border border-border-input bg-surface-chip p-0.5">
          {(["graph", "list"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                setViewMode(v);
              }}
              className={`rounded-[6px] px-3 py-1 text-[11.5px] font-medium capitalize transition-colors ${
                viewMode === v
                  ? "bg-surface text-text-primary shadow-soft"
                  : "text-text-faint hover:text-text-secondary"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            void docker.refresh();
          }}
          disabled={docker.loading}
          title="Refresh"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary disabled:opacity-50"
        >
          <RefreshCw size={14} strokeWidth={2} className={docker.loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!docker.available && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Box size={32} strokeWidth={1.5} className="mx-auto mb-3 text-text-faint" />
            <p className="text-[14px] font-semibold text-text-primary">Docker not available</p>
            <p className="mt-1 text-[12.5px] text-text-secondary">
              Docker is not installed or not accessible on this server.
            </p>
          </div>
        </div>
      )}

      {docker.available && (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[220px] flex-none flex-col border-r border-border bg-surface-sidebar">
            <div className="p-3">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder="Search…"
                className="h-[30px] w-full rounded-input border border-border-input bg-surface-pane px-2.5 text-[12px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dark"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              {(["all", "running", "stopped", "compose"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f);
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                    filter === f
                      ? "bg-accent/[0.12] text-accent-dark"
                      : "bg-surface-chip text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="border-t border-border px-3 py-2">
              <div className="grid grid-cols-2 gap-2">
                <StatCell label="Containers" value={docker.containers.length} />
                <StatCell
                  label="Running"
                  value={docker.containers.filter((c) => c.state === "running").length}
                  color="text-success"
                />
                <StatCell label="Images" value={docker.images.length} />
                <StatCell
                  label="Networks"
                  value={
                    docker.networks.filter((n) => !["bridge", "host", "none"].includes(n.name))
                      .length
                  }
                />
              </div>
            </div>
            {docker.projects.length > 0 && (
              <div className="border-t border-border px-3 py-2">
                <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.8px] text-text-faint">
                  Compose Projects
                </div>
                {docker.projects.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 py-1">
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        p.status.includes("running") ? "bg-success" : "bg-text-faint"
                      }`}
                    />
                    <span className="truncate text-[12px] text-text-primary">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative flex min-w-0 flex-1">
            {docker.loading && docker.containers.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <p className="text-[12.5px] text-text-secondary">Loading Docker resources…</p>
                </div>
              </div>
            ) : viewMode === "graph" ? (
              <DockerGraph
                containers={filteredContainers}
                networks={docker.networks}
                volumes={docker.volumes}
                projects={docker.projects}
                selectedId={selectedId}
                onSelectContainer={handleSelectContainer}
              />
            ) : (
              <ContainerListView
                containers={filteredContainers}
                selectedId={selectedId}
                onSelect={handleSelectContainer}
              />
            )}
          </div>

          {selectedContainer && (
            <InspectorPanel
              container={selectedContainer}
              onClose={handleCloseInspector}
              onAction={(action) => {
                void docker.runContainerAction(selectedContainer.id, action);
              }}
              getLogs={docker.getLogs}
              getStats={docker.getStats}
              getInspect={docker.getInspect}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  color = "text-text-primary",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-[6px] bg-surface-chip px-2 py-1.5">
      <div className={`text-[15px] font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-text-faint">{label}</div>
    </div>
  );
}

// ── Graph view ────────────────────────────────────────────────────────────────

function containerColor(state: string) {
  if (state === "running") return "#1f9d63";
  if (state === "paused") return "#e0a53c";
  return "#e5534b";
}

interface DockerGraphProps {
  containers: DockerContainer[];
  networks: DockerNetwork[];
  volumes: DockerVolume[];
  projects: ComposeProject[];
  selectedId: string | null;
  onSelectContainer: (id: string) => void;
}

function DockerGraph({ containers, selectedId, onSelectContainer }: DockerGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    containers.forEach((c, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      newNodes.push({
        id: `c-${c.id}`,
        type: "default",
        position: { x: col * 220, y: row * 130 },
        selected: selectedId === c.id,
        data: {
          label: (
            <div
              className="min-w-[180px] rounded-[8px] border bg-surface-pane p-2.5 text-left shadow-soft"
              style={{
                borderColor: containerColor(c.state) + "66",
                borderLeftWidth: 3,
                borderLeftColor: containerColor(c.state),
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ background: containerColor(c.state) }}
                />
                <span className="truncate text-[12px] font-semibold text-text-primary">
                  {c.name.replace(/^\//, "")}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-text-faint">
                {c.image.split(":")[0]}
              </div>
              <div className="mt-0.5 text-[10px] text-text-secondary">{c.status}</div>
              {c.compose_project && (
                <div className="mt-1 rounded-[4px] bg-accent/[0.08] px-1.5 py-0.5 text-[9.5px] font-medium text-accent-dark">
                  {c.compose_project}
                </div>
              )}
            </div>
          ),
        },
        style: { background: "transparent", border: "none", padding: 0 },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [containers, selectedId, setNodes, setEdges]);

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    const id = node.id.replace("c-", "");
    onSelectContainer(id);
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        style={{ background: "var(--color-surface, #f8f7f4)" }}
      >
        <Background color="#e8e5df" gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            const containerId = n.id.replace("c-", "");
            const c = containers.find((ct) => ct.id === containerId);
            return c ? containerColor(c.state) : "#ccc";
          }}
          style={{ background: "var(--color-surface-pane, #fff)" }}
        />
      </ReactFlow>
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ContainerListView({
  containers,
  selectedId,
  onSelect,
}: {
  containers: DockerContainer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col overflow-auto">
      <div className="flex items-center gap-3 border-b border-border bg-surface-colheader px-4 py-2 font-mono text-[11px] font-medium text-text-faint">
        <span className="w-5" />
        <span className="w-[200px]">Name</span>
        <span className="w-[200px]">Image</span>
        <span className="w-[100px]">State</span>
        <span className="flex-1">Status</span>
        <span className="w-[120px]">Ports</span>
      </div>
      {containers.length === 0 && (
        <div className="px-4 py-8 text-center text-[12.5px] text-text-faint">No containers</div>
      )}
      {containers.map((c) => (
        <div
          key={c.id}
          onClick={() => {
            onSelect(c.id);
          }}
          className={`flex cursor-pointer items-center gap-3 border-b border-border px-4 py-[9px] transition-colors last:border-0 ${
            selectedId === c.id ? "bg-accent/[0.07]" : "hover:bg-surface-hover"
          }`}
        >
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: containerColor(c.state) }}
          />
          <span className="w-[200px] truncate text-[12.5px] font-medium text-text-primary">
            {c.name.replace(/^\//, "")}
          </span>
          <span className="w-[200px] truncate font-mono text-[11px] text-text-secondary">
            {c.image}
          </span>
          <span
            className={`w-[100px] text-[12px] font-medium ${
              c.state === "running" ? "text-success" : "text-danger"
            }`}
          >
            {c.state}
          </span>
          <span className="flex-1 truncate text-[11.5px] text-text-faint">{c.status}</span>
          <span className="w-[120px] truncate font-mono text-[10.5px] text-text-tertiary">
            {c.ports || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Inspector panel ───────────────────────────────────────────────────────────

type InspectorTab = "overview" | "logs" | "stats" | "inspect";

function InspectorPanel({
  container,
  onClose,
  onAction,
  getLogs,
  getStats,
  getInspect,
}: {
  container: DockerContainer;
  onClose: () => void;
  onAction: (action: "start" | "stop" | "restart" | "kill" | "rm") => void;
  getLogs: (id: string) => Promise<string>;
  getStats: (id: string) => Promise<ContainerStats>;
  getInspect: (id: string) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [logs, setLogs] = useState<string | null>(null);
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [inspect, setInspect] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLogs(null);
    setStats(null);
    setInspect(null);
    setTab("overview");
  }, [container.id]);

  useEffect(() => {
    if (tab === "logs" && logs === null) {
      void getLogs(container.id)
        .then(setLogs)
        .catch(() => {
          setLogs("Failed to load logs.");
        });
    }
    if (tab === "stats" && stats === null) {
      void getStats(container.id)
        .then(setStats)
        .catch(() => {
          /* ignore */
        });
    }
    if (tab === "inspect" && inspect === null) {
      void getInspect(container.id)
        .then(setInspect)
        .catch(() => {
          /* ignore */
        });
    }
  }, [tab, container.id, logs, stats, inspect, getLogs, getStats, getInspect]);

  const isRunning = container.state === "running";

  function copyId() {
    void navigator.clipboard.writeText(container.id);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div className="flex w-[320px] flex-none flex-col border-l border-border bg-surface-pane">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-text-primary">
              {container.name.replace(/^\//, "")}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-text-faint">
              {container.image}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-2 flex-shrink-0 text-text-faint hover:text-text-secondary"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{
              background: containerColor(container.state) + "22",
              color: containerColor(container.state),
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: containerColor(container.state) }}
            />
            {container.state}
          </span>
          <button
            onClick={copyId}
            className="flex items-center gap-1 font-mono text-[10px] text-text-faint hover:text-text-secondary"
          >
            {copied ? <Check size={10} strokeWidth={2} /> : <Copy size={10} strokeWidth={2} />}
            {container.id.slice(0, 12)}
          </button>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {!isRunning && (
            <ActionBtn
              icon={<Play size={11} strokeWidth={2} />}
              label="Start"
              onClick={() => {
                onAction("start");
              }}
              color="success"
            />
          )}
          {isRunning && (
            <ActionBtn
              icon={<Square size={11} strokeWidth={2} />}
              label="Stop"
              onClick={() => {
                onAction("stop");
              }}
            />
          )}
          {isRunning && (
            <ActionBtn
              icon={<RotateCcw size={11} strokeWidth={2} />}
              label="Restart"
              onClick={() => {
                onAction("restart");
              }}
            />
          )}
          {isRunning && (
            <ActionBtn
              icon={<Zap size={11} strokeWidth={2} />}
              label="Kill"
              onClick={() => {
                onAction("kill");
              }}
              color="danger"
            />
          )}
          <ActionBtn
            icon={<Trash2 size={11} strokeWidth={2} />}
            label="Remove"
            onClick={() => {
              onAction("rm");
            }}
            color="danger"
          />
        </div>
      </div>

      <div className="flex border-b border-border">
        {(["overview", "logs", "stats", "inspect"] as InspectorTab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
            }}
            className={`flex-1 py-2 text-[11px] font-medium capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-accent-dark text-accent-dark"
                : "text-text-faint hover:text-text-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === "overview" && (
          <div className="space-y-1 p-4">
            <InfoRow label="Status" value={container.status} />
            <InfoRow label="Created" value={container.created_at} />
            <InfoRow label="Ports" value={container.ports || "none"} mono />
            {container.compose_project && (
              <InfoRow label="Project" value={container.compose_project} />
            )}
            {container.compose_service && (
              <InfoRow label="Service" value={container.compose_service} />
            )}
          </div>
        )}
        {tab === "logs" && (
          <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary">
            {logs === null ? "Loading…" : logs || "(no logs)"}
          </pre>
        )}
        {tab === "stats" && (
          <div className="space-y-1 p-4">
            {stats === null ? (
              <div className="text-[12px] text-text-faint">Loading…</div>
            ) : (
              <>
                <InfoRow label="CPU" value={stats.cpu_perc} />
                <InfoRow label="Memory" value={stats.mem_usage} />
                <InfoRow label="Net I/O" value={stats.net_io} mono />
                <InfoRow label="Block I/O" value={stats.block_io} mono />
              </>
            )}
          </div>
        )}
        {tab === "inspect" && (
          <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[10px] leading-relaxed text-text-secondary">
            {inspect === null ? "Loading…" : JSON.stringify(inspect, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  color = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  color?: "default" | "success" | "danger";
}) {
  const colorClass =
    color === "success"
      ? "border-success/30 text-success hover:bg-success/10"
      : color === "danger"
        ? "border-danger/30 text-danger hover:bg-danger/10"
        : "border-border-input text-text-secondary hover:bg-surface-chip";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-[6px] border px-2 py-1 text-[11px] font-medium transition-colors ${colorClass}`}
    >
      {icon}
      {label}
    </button>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-[80px] flex-shrink-0 text-[11px] text-text-faint">{label}</span>
      <span
        className={`flex-1 text-[12px] text-text-primary ${mono ? "font-mono text-[10.5px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
