import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  Copy,
  RefreshCw,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDockerExplorer } from "../hooks/useDockerExplorer";
import type { ContainerStats, DockerContainer, DockerNetwork } from "../api";

interface DockerExplorerPageProps {
  onClose: () => void;
}

type FilterType = "all" | "running" | "stopped" | "compose";
type ViewMode = "graph" | "list";

// ── Custom React Flow nodes ───────────────────────────────────────────────────

interface ContainerNodeData extends Record<string, unknown> {
  container: DockerContainer;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function containerColor(state: string) {
  if (state === "running") return "#1f9d63";
  if (state === "paused") return "#e0a53c";
  return "#e5534b";
}

function parseHealth(status: string): "healthy" | "unhealthy" | "starting" | null {
  if (status.includes("(healthy)")) return "healthy";
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(health: starting)")) return "starting";
  return null;
}

const ContainerNodeComponent = memo(function ContainerNodeComponent({
  data,
}: NodeProps) {
  const { container, isSelected, onSelect } = data as ContainerNodeData;
  const color = containerColor(container.state);
  const health = parseHealth(container.status);
  return (
    <div
      onClick={() => { onSelect(container.id); }}
      className="cursor-pointer rounded-[8px] bg-surface-pane p-2.5 text-left"
      style={{
        border: `1px solid ${color}55`,
        borderLeft: `3px solid ${color}`,
        minWidth: 180,
        boxShadow: isSelected
          ? `0 0 0 2px ${color}66, 0 4px 12px -4px rgba(0,0,0,0.15)`
          : "0 2px 8px -4px rgba(0,0,0,0.12)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-[12px] font-semibold text-text-primary">
          {container.name.replace(/^\//, "")}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-text-faint">
        {container.image.split(":")[0]}
      </div>
      <div className="mt-0.5 text-[10px] text-text-secondary">{container.status}</div>
      {health && (
        <div className={`mt-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold ${
          health === "healthy" ? "bg-success/10 text-success" :
          health === "unhealthy" ? "bg-danger/10 text-danger" :
          "bg-warning/10 text-warning"
        }`}>
          {health}
        </div>
      )}
      {container.compose_project && (
        <div className="mt-1 rounded-[4px] bg-accent/[0.08] px-1.5 py-0.5 text-[9.5px] font-medium text-accent-dark">
          {container.compose_project}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});

const NetworkNodeComponent = memo(function NetworkNodeComponent({ data }: NodeProps) {
  const { network } = data as { network: DockerNetwork };
  return (
    <div className="rounded-full border border-[#3f7be055] bg-[#3f7be011] px-3 py-1.5"
      style={{ boxShadow: "0 2px 8px -4px rgba(63,123,224,0.3)" }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-dark" />
        <span className="font-mono text-[11px] font-semibold text-accent-dark">{network.name}</span>
      </div>
      <div className="mt-0.5 text-[9.5px] text-text-faint">{network.driver}</div>
    </div>
  );
});

const nodeTypes = {
  container: ContainerNodeComponent,
  network: NetworkNodeComponent,
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function DockerExplorerPage({ onClose }: DockerExplorerPageProps) {
  const docker = useDockerExplorer();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedContainer =
    docker.containers.find((c) => c.id === selectedId) ?? null;

  const filteredContainers = useMemo(
    () =>
      docker.containers.filter((c) => {
        const q = search.toLowerCase();
        const matchSearch =
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          c.ports.toLowerCase().includes(q);
        const matchFilter =
          filter === "all" ||
          (filter === "running" && c.state === "running") ||
          (filter === "stopped" && c.state !== "running") ||
          (filter === "compose" && !!c.compose_project);
        return matchSearch && matchFilter;
      }),
    [docker.containers, search, filter],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface-pane">
      {/* Header */}
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
        {/* Graph / List toggle */}
        <div className="flex gap-1 rounded-[8px] border border-border-input bg-surface-chip p-0.5">
          {(["graph", "list"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => { setViewMode(v); }}
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
          onClick={() => { void docker.refresh(); }}
          disabled={docker.loading}
          title="Refresh"
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary disabled:opacity-50"
        >
          <RefreshCw size={14} strokeWidth={2} className={docker.loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Docker not available */}
      {!docker.available && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Box size={32} strokeWidth={1.5} className="mx-auto mb-3 text-text-faint" />
            <p className="text-[14px] font-semibold text-text-primary">Docker not available</p>
            <p className="mt-1 text-[12.5px] text-text-secondary">
              Docker is not installed or not in PATH on this server.
            </p>
          </div>
        </div>
      )}

      {docker.available && (
        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <div className="flex w-[220px] flex-none flex-col border-r border-border bg-surface-sidebar">
            <div className="p-3">
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); }}
                placeholder="Search…"
                className="h-[30px] w-full rounded-input border border-border-input bg-surface-pane px-2.5 text-[12px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dark"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              {(["all", "running", "stopped", "compose"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); }}
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
                  value={docker.networks.filter((n) => !["bridge", "host", "none"].includes(n.name)).length}
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
                        p.status?.toLowerCase().includes("running") ? "bg-success" : "bg-text-faint"
                      }`}
                    />
                    <span className="truncate text-[12px] text-text-primary">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
            {docker.error && (
              <div className="mx-3 mt-2 rounded-input border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
                {docker.error}
              </div>
            )}
          </div>

          {/* Main area */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            {docker.loading && docker.containers.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  <p className="text-[12.5px] text-text-secondary">Loading Docker resources…</p>
                </div>
              </div>
            ) : filteredContainers.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-[12.5px] text-text-faint">No containers match the current filter.</p>
              </div>
            ) : viewMode === "graph" ? (
              <DockerGraph
                containers={filteredContainers}
                networks={docker.networks}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            ) : (
              <ContainerListView
                containers={filteredContainers}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </div>

          {/* Inspector */}
          {selectedContainer && (
            <InspectorPanel
              container={selectedContainer}
              onClose={() => { setSelectedId(null); }}
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

// ── Stat cell ─────────────────────────────────────────────────────────────────

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

interface DockerGraphProps {
  containers: DockerContainer[];
  networks: DockerNetwork[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function DockerGraph({
  containers,
  networks,
  selectedId,
  onSelect,
}: DockerGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  useEffect(() => {
    const containerNodes: Node[] = containers.map((c, i) => ({
      id: `c-${c.id}`,
      type: "container",
      position: { x: (i % 4) * 240, y: Math.floor(i / 4) * 200 },
      data: {
        container: c,
        isSelected: selectedId === c.id,
        onSelect,
      } satisfies ContainerNodeData,
    }));

    const containerNetworkNames = new Set(
      containers.flatMap(c => c.networks.split(",").map(n => n.trim()).filter(Boolean))
    );

    const usedNetworks = networks.filter(n =>
      !["bridge", "host", "none"].includes(n.name) && containerNetworkNames.has(n.name)
    );

    const totalNetworkWidth = Math.max(usedNetworks.length * 220, containers.length * 240);
    const networkNodes: Node[] = usedNetworks.map((n, i) => ({
      id: `net-${n.id}`,
      type: "network",
      position: { x: i * 220 + (totalNetworkWidth - usedNetworks.length * 220) / 2, y: Math.ceil(containers.length / 4) * 200 + 60 },
      data: { network: n },
    }));

    const networkIdByName = new Map(usedNetworks.map(n => [n.name, n.id]));
    const newEdges: Edge[] = [];
    containers.forEach(c => {
      const cNetworks = c.networks.split(",").map(n => n.trim()).filter(Boolean);
      cNetworks.forEach(netName => {
        const netId = networkIdByName.get(netName);
        if (netId) {
          newEdges.push({
            id: `e-${c.id}-${netId}`,
            source: `c-${c.id}`,
            target: `net-${netId}`,
            style: { stroke: "#3f7be044", strokeWidth: 1.5 },
            animated: c.state === "running",
          });
        }
      });
    });

    setNodes([...containerNodes, ...networkNodes]);
    setEdges(newEdges);
    // setNodes and setEdges are stable refs; omitting from deps is intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, networks, selectedId, onSelect]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.15}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        style={{ background: "transparent" }}
      >
        <Background color="#e0ddd6" gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const c = containers.find((ct) => `c-${ct.id}` === n.id);
            return c ? containerColor(c.state) : "#3f7be066";
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
        <span className="w-4" />
        <span className="w-[180px]">Name</span>
        <span className="w-[200px]">Image</span>
        <span className="w-[90px]">State</span>
        <span className="flex-1">Status</span>
        <span className="w-[140px]">Ports</span>
      </div>
      {containers.map((c) => (
        <div
          key={c.id}
          onClick={() => { onSelect(c.id); }}
          className={`flex cursor-pointer items-center gap-3 border-b border-border px-4 py-[9px] transition-colors last:border-0 ${
            selectedId === c.id ? "bg-accent/[0.07]" : "hover:bg-surface-hover"
          }`}
        >
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: containerColor(c.state) }}
          />
          <span className="w-[180px] truncate text-[12.5px] font-medium text-text-primary">
            {c.name.replace(/^\//, "")}
          </span>
          <span className="w-[200px] truncate font-mono text-[11px] text-text-secondary">
            {c.image}
          </span>
          <span
            className={`w-[90px] text-[12px] font-medium ${
              c.state === "running" ? "text-success" : "text-danger"
            }`}
          >
            {c.state}
          </span>
          <span className="flex-1 truncate text-[11.5px] text-text-faint">{c.status}</span>
          <span className="w-[140px] truncate font-mono text-[10.5px] text-text-tertiary">
            {c.ports || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Inspector panel (read-only) ───────────────────────────────────────────────

type InspectorTab = "overview" | "env" | "mounts" | "networks" | "ports" | "logs" | "stats" | "inspect";

function InspectorPanel({
  container,
  onClose,
  getLogs,
  getStats,
  getInspect,
}: {
  container: DockerContainer;
  onClose: () => void;
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
    void getInspect(container.id)
      .then(setInspect)
      .catch(() => { /* silently ignore */ });
  }, [container.id, getInspect]);

  useEffect(() => {
    if (tab === "logs" && logs === null) {
      void getLogs(container.id)
        .then(setLogs)
        .catch(() => { setLogs("Failed to load logs."); });
    }
    if (tab === "stats" && stats === null) {
      void getStats(container.id)
        .then(setStats)
        .catch(() => { /* silently ignore */ });
    }
  }, [tab, container.id, logs, stats, getLogs, getStats]);

  function copyId() {
    void navigator.clipboard.writeText(container.id);
    setCopied(true);
    setTimeout(() => { setCopied(false); }, 1500);
  }

  const color = containerColor(container.state);

  const firstInspect = (inspect as Record<string, unknown>[] | null)?.[0];
  const configObj = firstInspect?.Config as Record<string, unknown> | undefined;
  const envVars: string[] = (configObj?.Env as string[] | undefined) ?? [];
  const mounts: { Type: string; Source: string; Destination: string; Mode: string; RW: boolean }[] =
    (firstInspect?.Mounts as { Type: string; Source: string; Destination: string; Mode: string; RW: boolean }[] | undefined) ?? [];
  const networkSettings = firstInspect?.NetworkSettings as Record<string, unknown> | undefined;
  const networksObj: Record<string, { IPAddress?: string; Gateway?: string; MacAddress?: string }> =
    (networkSettings?.Networks as Record<string, { IPAddress?: string; Gateway?: string; MacAddress?: string }> | undefined) ?? {};
  const networkEntries = Object.entries(networksObj);
  const portsObj: Record<string, { HostIp: string; HostPort: string }[] | null> =
    (networkSettings?.Ports as Record<string, { HostIp: string; HostPort: string }[] | null> | undefined) ?? {};
  const portEntries = Object.entries(portsObj);

  return (
    <div className="flex w-[320px] flex-none flex-col border-l border-border bg-surface-pane">
      {/* Header */}
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
            style={{ background: color + "22", color }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
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
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-border">
        {(["overview", "env", "mounts", "networks", "ports", "logs", "stats", "inspect"] as InspectorTab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); }}
            className={`px-2.5 py-2 text-[10.5px] font-medium capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-accent-dark text-accent-dark"
                : "text-text-faint hover:text-text-secondary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "overview" && (
          <div className="divide-y divide-border">
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
        {tab === "env" && (
          <div className="divide-y divide-border">
            {envVars.length === 0 ? (
              <div className="p-4 text-[12px] text-text-faint">No environment variables</div>
            ) : envVars.map((entry, i) => {
              const eq = entry.indexOf("=");
              const key = eq >= 0 ? entry.slice(0, eq) : entry;
              const val = eq >= 0 ? entry.slice(eq + 1) : "";
              return (
                <div key={i} className="flex items-start gap-2 px-4 py-1.5">
                  <span className="w-[140px] flex-shrink-0 truncate font-mono text-[10px] font-semibold text-accent-dark">{key}</span>
                  <span className="flex-1 break-all font-mono text-[10px] text-text-secondary">{val}</span>
                </div>
              );
            })}
          </div>
        )}
        {tab === "mounts" && (
          <div className="divide-y divide-border">
            {mounts.length === 0 ? (
              <div className="p-4 text-[12px] text-text-faint">No mounts</div>
            ) : mounts.map((m, i) => (
              <div key={i} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`rounded-[4px] px-1.5 py-0.5 font-mono text-[9px] font-semibold ${m.Type === "volume" ? "bg-accent/10 text-accent-dark" : "bg-surface-chip text-text-secondary"}`}>{m.Type}</span>
                  <span className={`text-[10px] ${m.RW ? "text-success" : "text-text-faint"}`}>{m.RW ? "read-write" : "read-only"}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-text-faint">{m.Source}</div>
                <div className="mt-0.5 font-mono text-[10.5px] font-medium text-text-primary">→ {m.Destination}</div>
              </div>
            ))}
          </div>
        )}
        {tab === "networks" && (
          <div className="divide-y divide-border">
            {networkEntries.length === 0 ? (
              <div className="p-4 text-[12px] text-text-faint">No networks</div>
            ) : networkEntries.map(([name, info]) => (
              <div key={name} className="px-4 py-2.5">
                <div className="text-[12px] font-semibold text-text-primary">{name}</div>
                {info.IPAddress && <div className="mt-0.5 font-mono text-[10.5px] text-text-secondary">IP: {info.IPAddress}</div>}
                {info.Gateway && <div className="mt-0.5 font-mono text-[10px] text-text-faint">Gateway: {info.Gateway}</div>}
                {info.MacAddress && <div className="mt-0.5 font-mono text-[10px] text-text-faint">MAC: {info.MacAddress}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === "ports" && (
          <div className="divide-y divide-border">
            {portEntries.length === 0 ? (
              <div className="p-4 text-[12px] text-text-faint">No port mappings</div>
            ) : portEntries.map(([portProto, bindings]) => (
              <div key={portProto} className="flex items-center gap-3 px-4 py-2">
                <span className="font-mono text-[11px] font-semibold text-text-primary">{portProto}</span>
                <span className="text-text-faint">→</span>
                <span className="font-mono text-[11px] text-text-secondary">
                  {bindings?.map(b => `${b.HostIp === "0.0.0.0" ? "" : b.HostIp + ":"}${b.HostPort}`).join(", ") ?? "not published"}
                </span>
              </div>
            ))}
          </div>
        )}
        {tab === "logs" && (
          <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary">
            {logs === null ? "Loading…" : logs || "(no logs)"}
          </pre>
        )}
        {tab === "stats" && (
          <div className="divide-y divide-border">
            {stats === null ? (
              <div className="p-4 text-[12px] text-text-faint">Loading…</div>
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

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-4 py-2">
      <span className="w-[80px] flex-shrink-0 text-[11px] text-text-faint">{label}</span>
      <span className={`flex-1 text-[12px] text-text-primary ${mono ? "font-mono text-[10.5px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}
