import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Box,
  ChevronRight,
  Database as DatabaseIcon,
  Folder as FolderIcon,
  Inbox,
  Info,
  Monitor,
  Network,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  SiApachekafka,
  SiCockroachlabs,
  SiDjango,
  SiElasticsearch,
  SiElasticstack,
  SiFastapi,
  SiFlask,
  SiGrafana,
  SiLaravel,
  SiMariadb,
  SiMongodb,
  SiMysql,
  SiNextdotjs,
  SiNginx,
  SiNodedotjs,
  SiPhp,
  SiPostgresql,
  SiPrometheus,
  SiPython,
  SiRabbitmq,
  SiReact,
  SiRedis,
  SiRuby,
  SiSpring,
  SiSvelte,
  SiTraefikproxy,
  SiVuedotjs,
  type IconType as SimpleIcon,
} from "@icons-pack/react-simple-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDockerExplorer, type DockerLogEntry } from "../hooks/useDockerExplorer";
import { DockerContainersView } from "./DockerContainersView";
import type {
  ComposeProject,
  ContainerMountInfo,
  ContainerStats,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from "../api";
import { usePageContext } from "../context/PageContext";
import { FEATURES } from "../lib/features";

interface DockerExplorerPageProps {
  onClose: () => void;
  /** Passed to the embedded ChatPanel so it can connect to the right host. */
  host: string;
  /** Optional: called with a short human-readable message when a node is clicked.
   *  Wire this to the chat panel to auto-inject context. */
  onNodeAutoMessage?: (message: string) => void;
}

// ── Types + helpers ───────────────────────────────────────────────────────────

type ServiceType =
  "database" | "cache" | "broker" | "proxy" | "frontend" | "backend" | "monitoring" | "app";

type FilterType =
  | "all"
  | "running"
  | "stopped"
  | "compose"
  | "healthy"
  | "unhealthy"
  | "database"
  | "cache"
  | "broker"
  | "proxy"
  | "worker"
  | "frontend"
  | "backend"
  | "monitoring";

function containerColor(state: string): string {
  if (state === "running") return "#1f9d63";
  if (state === "paused") return "#e0a53c";
  if (state === "restarting") return "#e0a53c";
  return "#e5534b";
}

function parseHealth(status: string): "healthy" | "unhealthy" | "starting" | null {
  if (status.includes("(healthy)")) return "healthy";
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(health: starting)")) return "starting";
  return null;
}

function detectServiceType(c: DockerContainer): ServiceType {
  const img = c.image.toLowerCase();
  if (/kafka|rabbitmq|nats|activemq|pulsar/.test(img)) return "broker";
  if (/postgres|mysql|mariadb|mongo|cassandra|elastic|oracle|mssql|sqlite|cockroach/.test(img))
    return "database";
  if (/redis|memcached|valkey/.test(img)) return "cache";
  if (/nginx|traefik|haproxy|caddy|envoy|istio|apache/.test(img)) return "proxy";
  if (/prometheus|grafana|kibana|datadog|jaeger|zipkin|alertmanager/.test(img)) return "monitoring";
  if (/\bnode\b|react|vue|angular|next|nuxt|gatsby|vite|svelte/.test(img)) return "frontend";
  if (
    /python|django|flask|fastapi|java|spring|ruby|rails|php|laravel|dotnet|express|gin|actix/.test(
      img,
    )
  )
    return "backend";
  return "app";
}

interface ServiceConfig {
  Icon: LucideIcon;
  color: string;
  bg: string;
  label: string;
}

const SERVICE_CONFIG: Record<ServiceType, ServiceConfig> = {
  database: { Icon: DatabaseIcon, color: "#1f9d63", bg: "rgba(31,157,99,0.05)", label: "database" },
  cache: { Icon: Zap, color: "#7c3aed", bg: "rgba(124,58,237,0.05)", label: "cache" },
  broker: { Icon: Inbox, color: "#ea580c", bg: "rgba(234,88,12,0.05)", label: "broker" },
  proxy: { Icon: Shield, color: "#0284c7", bg: "rgba(2,132,199,0.05)", label: "proxy" },
  frontend: { Icon: Monitor, color: "#0891b2", bg: "rgba(8,145,178,0.05)", label: "frontend" },
  backend: { Icon: Server, color: "#6366f1", bg: "rgba(99,102,241,0.05)", label: "backend" },
  monitoring: { Icon: Activity, color: "#d97706", bg: "rgba(217,119,6,0.05)", label: "monitoring" },
  app: { Icon: Box, color: "#6b7280", bg: "transparent", label: "" },
};

interface IconEntry {
  Icon: SimpleIcon;
  color: string;
}

const IMAGE_ICON_MAP: { pattern: RegExp; entry: IconEntry }[] = [
  // Databases
  { pattern: /postgres|postgresql/, entry: { Icon: SiPostgresql, color: "#4169E1" } },
  { pattern: /mysql/, entry: { Icon: SiMysql, color: "#4479A1" } },
  { pattern: /mariadb/, entry: { Icon: SiMariadb, color: "#003545" } },
  { pattern: /mongo/, entry: { Icon: SiMongodb, color: "#47A248" } },
  { pattern: /elastic|elasticsearch/, entry: { Icon: SiElasticsearch, color: "#005571" } },
  { pattern: /cockroach/, entry: { Icon: SiCockroachlabs, color: "#6933FF" } },
  // Cache
  { pattern: /redis/, entry: { Icon: SiRedis, color: "#FF4438" } },
  // Brokers
  { pattern: /kafka/, entry: { Icon: SiApachekafka, color: "#231F20" } },
  { pattern: /rabbitmq/, entry: { Icon: SiRabbitmq, color: "#FF6600" } },
  // Proxy
  { pattern: /nginx/, entry: { Icon: SiNginx, color: "#009639" } },
  { pattern: /traefik/, entry: { Icon: SiTraefikproxy, color: "#24A1C1" } },
  // Monitoring
  { pattern: /prometheus/, entry: { Icon: SiPrometheus, color: "#E6522C" } },
  { pattern: /grafana/, entry: { Icon: SiGrafana, color: "#F46800" } },
  { pattern: /kibana/, entry: { Icon: SiElasticstack, color: "#005571" } },
  // Frontend
  { pattern: /\bnode\b|nodejs/, entry: { Icon: SiNodedotjs, color: "#339933" } },
  { pattern: /react/, entry: { Icon: SiReact, color: "#61DAFB" } },
  { pattern: /vue/, entry: { Icon: SiVuedotjs, color: "#4FC08D" } },
  { pattern: /next/, entry: { Icon: SiNextdotjs, color: "#000000" } },
  { pattern: /svelte/, entry: { Icon: SiSvelte, color: "#FF3E00" } },
  // Backend
  { pattern: /django/, entry: { Icon: SiDjango, color: "#092E20" } },
  { pattern: /flask/, entry: { Icon: SiFlask, color: "#000000" } },
  { pattern: /fastapi/, entry: { Icon: SiFastapi, color: "#009688" } },
  { pattern: /spring/, entry: { Icon: SiSpring, color: "#6DB33F" } },
  { pattern: /rails|ruby/, entry: { Icon: SiRuby, color: "#CC342D" } },
  { pattern: /laravel/, entry: { Icon: SiLaravel, color: "#FF2D20" } },
  { pattern: /php/, entry: { Icon: SiPhp, color: "#777BB4" } },
  { pattern: /python/, entry: { Icon: SiPython, color: "#3776AB" } },
];

function getImageIcon(image: string): IconEntry | null {
  const img = image.toLowerCase();
  const match = IMAGE_ICON_MAP.find(({ pattern }) => pattern.test(img));
  return match ? match.entry : null;
}

function getBrandName(image: string): string {
  const img = image.toLowerCase();
  if (img.includes("postgres")) return "PostgreSQL";
  if (img.includes("mysql")) return "MySQL";
  if (img.includes("mariadb")) return "MariaDB";
  if (img.includes("mongo")) return "MongoDB";
  if (img.includes("redis")) return "Redis";
  if (img.includes("memcached")) return "Memcached";
  if (img.includes("kafka")) return "Kafka";
  if (img.includes("rabbitmq")) return "RabbitMQ";
  if (img.includes("nginx")) return "Nginx";
  if (img.includes("traefik")) return "Traefik";
  if (img.includes("haproxy")) return "HAProxy";
  if (img.includes("prometheus")) return "Prometheus";
  if (img.includes("grafana")) return "Grafana";
  if (img.includes("elastic")) return "Elasticsearch";
  if (img.includes("spring")) return "Spring";
  return "";
}

function detectCategory(c: DockerContainer): Set<string> {
  const img = c.image.toLowerCase();
  const svc = (c.compose_service ?? "").toLowerCase();
  const name = c.name.replace(/^\//, "").toLowerCase();
  const cats = new Set<string>();
  if (/kafka|rabbitmq|nats|activemq|pulsar/.test(img)) cats.add("broker");
  if (/postgres|mysql|mariadb|mongo|cassandra|elastic|oracle|mssql|sqlite|cockroach/.test(img))
    cats.add("database");
  if (/redis|memcached|valkey/.test(img)) cats.add("cache");
  if (/nginx|traefik|haproxy|caddy|envoy|istio|apache/.test(img)) cats.add("proxy");
  if (/prometheus|grafana|kibana|datadog|jaeger|zipkin|alertmanager/.test(img))
    cats.add("monitoring");
  if (/worker|celery|beat|consumer|queue|scheduler/.test(svc) || /worker|celery|beat/.test(name))
    cats.add("worker");
  if (/\bnode\b|react|vue|angular|next|nuxt|gatsby|vite|svelte/.test(img)) cats.add("frontend");
  if (
    /python|django|flask|fastapi|java|spring|ruby|rails|php|laravel|dotnet|express|gin|actix/.test(
      img,
    )
  )
    cats.add("backend");
  return cats;
}

interface ParsedPorts {
  pub: number[];
  int: number[];
}

function parsePorts(portsStr: string): ParsedPorts {
  const pub: number[] = [];
  const int: number[] = [];
  if (!portsStr) return { pub, int };
  const seenPub = new Set<number>();
  const seenInt = new Set<number>();
  for (const raw of portsStr.split(",")) {
    const p = raw.trim();
    const hostMatch = /(?:0\.0\.0\.0|:{2}|\[::]):(\d+)->/.exec(p);
    if (hostMatch) {
      const n = Number(hostMatch[1]);
      if (!seenPub.has(n)) {
        seenPub.add(n);
        pub.push(n);
      }
      continue;
    }
    const intMatch = /^(\d+)\//.exec(p);
    if (intMatch) {
      const n = Number(intMatch[1]);
      if (!seenInt.has(n)) {
        seenInt.add(n);
        int.push(n);
      }
    }
  }
  return { pub, int };
}

function parseCpuPercent(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace("%", ""));
  return isNaN(n) ? 0 : n;
}

function relAge(createdAt: string): string {
  if (!createdAt) return "";
  const t = Date.parse(createdAt.replace(/\s+[A-Z]{2,5}$/, ""));
  if (isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return "today";
  if (days < 30) return `${String(days)}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${String(mo)}mo ago`;
  return `${String(Math.floor(days / 365))}y ago`;
}

// Deterministic compose color per project name
function composeColor(project: string | null): string {
  if (!project) return "transparent";
  let hash = 0;
  for (let i = 0; i < project.length; i++) hash = (hash * 31 + project.charCodeAt(i)) | 0;
  const palette = [
    "#3f7be0",
    "#7c3aed",
    "#0891b2",
    "#e0a53c",
    "#1f9d63",
    "#d64545",
    "#ea580c",
    "#6366f1",
    "#0284c7",
  ];
  return palette[Math.abs(hash) % palette.length];
}

// ── Layout constants ──────────────────────────────────────────────────────────

const NET_X = 20;
const NET_W = 140;
const NET_H = 30;
const NET_GAP = 14;
const CON_X = 240;
const CON_W = 210;
const CON_H = 96;
const CON_GAP = 14;
const VOL_X = 540;
const VOL_W = 170;
const VOL_H = 52;
const COL_TOP = 40;
// VolumeGroup node (container's volumes grouped in a dashed box)
const VOLGROUP_W = 200;
const VOLGROUP_HEADER_H = 22;
const VOLGROUP_ROW_H = 22;
const VOLGROUP_PAD = 6;
// OrphanStack node (all unclaimed volumes stacked visually)
const ORPHAN_STACK_W = 180;
const ORPHAN_STACK_H = 64;

// ── Custom nodes ──────────────────────────────────────────────────────────────

interface ContainerNodeData extends Record<string, unknown> {
  container: DockerContainer;
  serviceType: ServiceType;
  stats: ContainerStats | undefined;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: string) => void;
}

const ContainerNodeComponent = memo(function ContainerNodeComponent({ data }: NodeProps) {
  const { container, serviceType, stats, isSelected, isDimmed } = data as ContainerNodeData;
  const stateColor = containerColor(container.state);
  const health = parseHealth(container.status);
  const cfg = SERVICE_CONFIG[serviceType];
  const imgIcon = getImageIcon(container.image);
  const ports = parsePorts(container.ports);
  const projColor = composeColor(container.compose_project);
  const cpuPct = parseCpuPercent(stats?.cpu_perc);
  const memShort = stats?.mem_usage ? stats.mem_usage.split(" / ")[0] : "";

  return (
    <div
      className="cursor-pointer overflow-hidden rounded-[10px] text-left"
      style={{
        width: CON_W,
        background: cfg.bg || "#ffffff",
        border: `1px solid ${stateColor}33`,
        borderLeft: `3px solid ${stateColor}`,
        opacity: isDimmed ? 0.12 : 1,
        boxShadow: isSelected
          ? `0 0 0 2px ${stateColor}66, 0 6px 14px -6px rgba(0,0,0,0.15)`
          : "0 1px 4px -2px rgba(0,0,0,0.08)",
        transition: "opacity 0.15s, box-shadow 0.15s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div className="px-2.5 py-1.5">
        {/* Row 1: compose color · state dot · name · brand icon */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {container.compose_project && (
              <span
                className="h-2 w-2 flex-none rounded-[2px]"
                style={{ background: projColor }}
                title={`Compose: ${container.compose_project}`}
              />
            )}
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: stateColor }}
            />
            <span
              className="truncate text-[12px] font-semibold text-text-primary"
              title={container.name.replace(/^\//, "")}
            >
              {container.name.replace(/^\//, "")}
            </span>
          </div>
          <div className="flex flex-none items-center gap-1">
            {health === "unhealthy" && (
              <span className="h-1.5 w-1.5 rounded-full bg-danger" title="Unhealthy" />
            )}
            {imgIcon ? (
              <imgIcon.Icon size={14} color={imgIcon.color} />
            ) : (
              <cfg.Icon size={13} style={{ color: cfg.color, opacity: 0.6 }} />
            )}
          </div>
        </div>

        {/* Row 2: image chip */}
        <div className="mt-1 truncate font-mono text-[10px] text-text-tertiary">
          {container.image}
        </div>

        {/* Row 3: port badges */}
        {(ports.pub.length > 0 || ports.int.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {ports.pub.slice(0, 3).map((p) => (
              <span
                key={`p-${String(p)}`}
                className="rounded-[3px] px-1 py-[1px] font-mono text-[9px] font-semibold"
                style={{ background: "rgba(214,69,69,0.12)", color: "#d64545" }}
              >
                pub {String(p)}
              </span>
            ))}
            {ports.int.slice(0, 3).map((p) => (
              <span
                key={`i-${String(p)}`}
                className="rounded-[3px] px-1 py-[1px] font-mono text-[9px] font-semibold"
                style={{ background: "rgba(120,120,120,0.12)", color: "#6a6f7a" }}
              >
                int {String(p)}
              </span>
            ))}
            {ports.pub.length + ports.int.length > 6 && (
              <span className="text-[9px] text-text-faint">+more</span>
            )}
          </div>
        )}

        {/* Row 4: CPU bar + mem */}
        {stats && container.state === "running" && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/5">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${String(Math.min(100, cpuPct))}%`,
                  background: cpuPct > 80 ? "#d64545" : cpuPct > 50 ? "#e0a53c" : "#1f9d63",
                }}
              />
            </div>
            <span className="font-mono text-[9.5px] tabular-nums text-text-secondary">
              {(stats.cpu_perc || "0%").padStart(5)}
            </span>
            {memShort && <span className="font-mono text-[9.5px] text-text-faint">{memShort}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

interface NetworkNodeData extends Record<string, unknown> {
  network: DockerNetwork;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: string) => void;
}

const NetworkNodeComponent = memo(function NetworkNodeComponent({ data }: NodeProps) {
  const { network, isSelected, isDimmed } = data as NetworkNodeData;
  return (
    <div
      className="flex cursor-pointer items-center gap-1.5 px-2.5"
      style={{
        width: NET_W,
        height: NET_H,
        borderRadius: 15,
        background: "#E6F1FB",
        border: `1.5px solid ${isSelected ? "#1a5fbf" : "#378ADD"}`,
        opacity: isDimmed ? 0.12 : 1,
        boxShadow: isSelected ? "0 0 0 2px #378ADD44" : "none",
        transition: "opacity 0.15s, box-shadow 0.15s",
      }}
    >
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Network size={12} className="flex-none text-[#1a5fbf]" />
      <span className="truncate text-[11px] font-semibold text-[#1a5fbf]" title={network.name}>
        {network.name}
      </span>
    </div>
  );
});

interface VolumeNodeData extends Record<string, unknown> {
  volume: DockerVolume;
  isOrphan: boolean;
  mountCount: number;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: string) => void;
}

const VolumeNodeComponent = memo(function VolumeNodeComponent({ data }: NodeProps) {
  const { volume, isOrphan, mountCount, isSelected, isDimmed } = data as VolumeNodeData;
  // Defensive: Docker sometimes returns anonymous volumes with blank Name.
  // The declared type says `string`, but runtime data can violate it.
  const rawName = (volume as { name?: unknown } | undefined)?.name;
  const volName: string = typeof rawName === "string" && rawName.length > 0 ? rawName : "(unnamed)";
  const isBind = volName.startsWith("/");
  const Icon = isOrphan ? AlertTriangle : isBind ? FolderIcon : DatabaseIcon;
  const iconColor = isOrphan ? "#e0a53c" : isBind ? "#6b7280" : "#1f9d63";
  const border = isOrphan ? "#e0a53c" : isSelected ? "#6366f1" : "#e0ddd6";

  return (
    <div
      className="flex cursor-pointer flex-col justify-center px-2.5"
      style={{
        width: VOL_W,
        height: VOL_H,
        borderRadius: 8,
        background: isOrphan ? "rgba(224,165,60,0.06)" : "#ffffff",
        border: `1px solid ${border}`,
        opacity: isDimmed ? 0.12 : 1,
        boxShadow: isSelected ? `0 0 0 2px ${border}55` : "0 1px 3px -1px rgba(0,0,0,0.08)",
        transition: "opacity 0.15s, box-shadow 0.15s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="flex-none" style={{ color: iconColor }} />
        <span className="truncate text-[11px] font-semibold text-text-primary" title={volName}>
          {isBind ? (volName.split("/").pop() ?? volName) : volName}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-tertiary">
        {isOrphan ? (
          <span className="font-semibold text-warning">orphan</span>
        ) : (
          <span>
            {String(mountCount)} mount{mountCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-text-faint">·</span>
        <span>
          {isBind ? "bind" : ((volume as { driver?: string } | undefined)?.driver ?? "?")}
        </span>
      </div>
    </div>
  );
});

// ── Volume group node (one per container, shows all its named volumes) ─────────

interface VolumeGroupEntry {
  volName: string;
  destination: string;
  rw: boolean;
}

interface VolumeGroupNodeData extends Record<string, unknown> {
  containerName: string;
  containerId: string;
  volumes: VolumeGroupEntry[];
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: string) => void;
}

const VolumeGroupNodeComponent = memo(function VolumeGroupNodeComponent({ data }: NodeProps) {
  const { containerName, volumes, isSelected, isDimmed } = data as VolumeGroupNodeData;
  const innerH = VOLGROUP_HEADER_H + volumes.length * VOLGROUP_ROW_H;
  const totalH = innerH + VOLGROUP_PAD * 2;

  return (
    <div
      style={{
        width: VOLGROUP_W,
        height: totalH,
        borderRadius: 8,
        border: `1.5px dashed ${isSelected ? "#6366f1" : "#c7ccd6"}`,
        background: isSelected ? "rgba(99,102,241,0.05)" : "rgba(244,245,247,0.9)",
        opacity: isDimmed ? 0.1 : 1,
        boxShadow: isSelected ? "0 0 0 2px #6366f133" : "0 1px 4px -2px rgba(0,0,0,0.07)",
        transition: "opacity 0.15s, box-shadow 0.15s",
        padding: VOLGROUP_PAD,
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {/* Group header */}
      <div
        className="flex items-center gap-1"
        style={{ height: VOLGROUP_HEADER_H, marginBottom: 2 }}
      >
        <DatabaseIcon size={10} className="flex-none text-text-faint" />
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-text-faint">
          {containerName}
        </span>
      </div>
      {/* Volume mini-rows */}
      {volumes.map((v) => (
        <div
          key={v.volName}
          style={{
            height: VOLGROUP_ROW_H,
            borderLeft: `2.5px solid ${v.rw ? "#6366f1" : "#9ca3af"}`,
            paddingLeft: 6,
            paddingRight: 4,
            marginBottom: 1,
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: v.rw ? "rgba(99,102,241,0.06)" : "rgba(156,163,175,0.08)",
            borderRadius: "0 4px 4px 0",
          }}
        >
          <DatabaseIcon size={9} style={{ flexShrink: 0, color: v.rw ? "#6366f1" : "#9ca3af" }} />
          <span
            className="flex-1 truncate font-mono text-[9.5px] text-text-primary"
            title={v.volName}
          >
            {v.volName.length > 18 ? `…${v.volName.slice(-16)}` : v.volName}
          </span>
          <span
            className="ml-auto flex-none font-mono text-[8.5px] font-semibold"
            style={{ color: v.rw ? "#6366f1" : "#9ca3af" }}
          >
            {v.rw ? "rw" : "ro"}
          </span>
        </div>
      ))}
    </div>
  );
});

// ── Orphan stack node (all volumes not mounted by any container) ──────────────

interface OrphanStackNodeData extends Record<string, unknown> {
  volumes: DockerVolume[];
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: string) => void;
}

const OrphanStackNodeComponent = memo(function OrphanStackNodeComponent({ data }: NodeProps) {
  const { volumes, isSelected, isDimmed } = data as OrphanStackNodeData;
  const count = volumes.length;
  const topVolName: string = count > 0 ? volumes[0].name : "";

  return (
    <div
      style={{
        width: ORPHAN_STACK_W,
        position: "relative",
        height: ORPHAN_STACK_H + (count >= 3 ? 8 : count >= 2 ? 4 : 0),
        opacity: isDimmed ? 0.1 : 1,
        cursor: "pointer",
        transition: "opacity 0.15s",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      {/* Shadow cards for stack depth */}
      {count >= 3 && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            right: -8,
            height: ORPHAN_STACK_H,
            borderRadius: 8,
            border: "1px solid rgba(224,165,60,0.25)",
            background: "rgba(224,165,60,0.04)",
          }}
        />
      )}
      {count >= 2 && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            right: -4,
            height: ORPHAN_STACK_H,
            borderRadius: 8,
            border: "1px solid rgba(224,165,60,0.4)",
            background: "rgba(224,165,60,0.06)",
          }}
        />
      )}
      {/* Top (front) card */}
      <div
        style={{
          position: "relative",
          width: ORPHAN_STACK_W,
          height: ORPHAN_STACK_H,
          borderRadius: 8,
          border: `1px solid ${isSelected ? "#e0a53c" : "rgba(224,165,60,0.65)"}`,
          background: isSelected ? "rgba(224,165,60,0.14)" : "rgba(255,252,235,0.95)",
          boxShadow: isSelected ? "0 0 0 2px #e0a53c44" : "0 1px 4px -2px rgba(0,0,0,0.10)",
          padding: "7px 10px",
        }}
      >
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={11} className="flex-none text-warning" />
          <span className="text-[10.5px] font-semibold text-warning">
            {String(count)} orphan vol{count !== 1 ? "s" : ""}
          </span>
        </div>
        {topVolName && (
          <div
            className="mt-1 truncate font-mono text-[9.5px] text-text-tertiary"
            title={topVolName}
          >
            {topVolName.length > 24 ? `…${topVolName.slice(-22)}` : topVolName}
          </div>
        )}
        {count > 1 && (
          <div className="mt-0.5 text-[9px] text-text-faint">
            +{String(count - 1)} more · click to inspect
          </div>
        )}
      </div>
    </div>
  );
});

const nodeTypes = {
  containerNode: ContainerNodeComponent,
  networkNode: NetworkNodeComponent,
  volumeNode: VolumeNodeComponent,
  volumeGroupNode: VolumeGroupNodeComponent,
  orphanStackNode: OrphanStackNodeComponent,
};

// ── Auto-message helper for AI chat ───────────────────────────────────────────

interface ExplorerSnapshot {
  containers: DockerContainer[];
  networks: DockerNetwork[];
  volumes: DockerVolume[];
  allStats: Map<string, ContainerStats>;
  allMounts: ContainerMountInfo[];
}

function buildAutoMessage(nodeId: string, snap: ExplorerSnapshot): string | null {
  if (nodeId.startsWith("c-")) {
    const c = snap.containers.find((x) => `c-${x.id}` === nodeId);
    if (!c) return null;
    const stats = snap.allStats.get(c.name.replace(/^\//, ""));
    const cpuMem = stats ? ` CPU: ${stats.cpu_perc}, mem: ${stats.mem_usage}.` : "";
    const proj = c.compose_project ? ` (compose project: ${c.compose_project})` : "";
    return `I'm looking at container "${c.name.replace(/^\//, "")}" — image ${c.image}, state ${c.state}. Ports: ${c.ports || "none"}. Networks: ${c.networks || "none"}.${cpuMem}${proj} Tell me about this container — what it does, security concerns, and any suggestions.`;
  }
  if (nodeId.startsWith("net-")) {
    const n = snap.networks.find((x) => `net-${x.id}` === nodeId);
    if (!n) return null;
    const attached = snap.containers.filter((c) =>
      c.networks
        .split(",")
        .map((s) => s.trim())
        .includes(n.name),
    );
    return `I'm looking at Docker network "${n.name}" (${n.driver} driver, scope: ${n.scope}). ${String(attached.length)} container${attached.length === 1 ? "" : "s"} attached: ${attached.map((c) => c.name.replace(/^\//, "")).join(", ") || "(none)"}. Explain what this network does and any concerns.`;
  }
  if (nodeId.startsWith("vol-")) {
    const v = snap.volumes.find((x) => `vol-${x.name}` === nodeId);
    if (!v) return null;
    const users: string[] = [];
    for (const cmi of snap.allMounts) {
      for (const mt of cmi.mounts) {
        if (mt.name === v.name) users.push(cmi.name);
      }
    }
    if (users.length === 0) {
      return `I'm looking at volume "${v.name}" (driver: ${v.driver}). It is not currently mounted by any container. Should I keep it or remove it?`;
    }
    return `I'm looking at volume "${v.name}" (driver: ${v.driver}). Mounted by: ${users.join(", ")}. What does this volume contain and are there any risks?`;
  }
  if (nodeId.startsWith("volgroup-")) {
    const cid = nodeId.slice(9);
    const c = snap.containers.find((x) => x.id === cid);
    if (!c) return null;
    const cmi = snap.allMounts.find((m) => m.name === c.name.replace(/^\//, ""));
    const volNames = (cmi?.mounts ?? [])
      .filter((m) => m.kind === "volume" && m.name)
      .map((m) => `${m.name} (${m.rw ? "rw" : "ro"} → ${m.destination})`);
    return `I'm looking at the volumes attached to container "${c.name.replace(/^\//, "")}". Volumes: ${volNames.join(", ") || "(none)"}. Explain what these volumes are used for and any data-safety concerns.`;
  }
  if (nodeId === "orphan-stack") {
    const orphanNames = snap.volumes
      .filter((v) => {
        for (const cmi of snap.allMounts) {
          for (const mt of cmi.mounts) {
            if (mt.kind === "volume" && mt.name === v.name) return false;
          }
        }
        return true;
      })
      .map((v) => v.name);
    return `I'm looking at ${String(orphanNames.length)} orphan volumes that are not mounted by any container: ${orphanNames.join(", ")}. Are these safe to remove? What could be inside them?`;
  }
  return null;
}

// ── Infrastructure analysis prompt ───────────────────────────────────────────

function buildInfraAnalysisPrompt(
  containers: DockerContainer[],
  networks: DockerNetwork[],
  volumes: DockerVolume[],
  allStats: Map<string, ContainerStats>,
  allMounts: ContainerMountInfo[],
  projects: ComposeProject[],
): string {
  // ── Container table
  const containerRows = containers.map((c) => {
    const name = c.name.replace(/^\//, "");
    const ports = parsePorts(c.ports);
    const portStr =
      [
        ...ports.pub.map((p) => `pub ${String(p)}`),
        ...ports.int.map((p) => `int ${String(p)}`),
      ].join(", ") || "none";
    const health = parseHealth(c.status);
    const healthStr =
      health === "healthy"
        ? "healthy"
        : health === "unhealthy"
          ? "⚠️ UNHEALTHY"
          : health === "starting"
            ? "starting"
            : "no healthcheck";
    const stats = allStats.get(name);
    const statsStr = stats ? `CPU ${stats.cpu_perc}  Mem ${stats.mem_usage}` : "n/a";
    const cm = allMounts.find((m) => m.name === name);
    const namedVols =
      (cm?.mounts ?? [])
        .filter((m) => m.kind === "volume" && m.name)
        .map((m) => `${m.name}(${m.rw ? "rw" : "ro"})→${m.destination}`)
        .join("; ") || "none";
    const binds =
      (cm?.mounts ?? [])
        .filter((m) => m.kind === "bind")
        .map((m) => `${m.source}→${m.destination}`)
        .join("; ") || "none";
    return `| ${name} | ${c.image} | ${c.state} | ${c.status} | ${portStr} | ${healthStr} | ${statsStr} | ${c.networks} | ${c.compose_project ?? "-"} | ${namedVols} | ${binds} |`;
  });
  const containerTable = [
    "| Name | Image | State | Status | Ports | Health | Stats | Networks | Compose | Named Volumes | Bind Mounts |",
    "|------|-------|-------|--------|-------|--------|-------|----------|---------|---------------|-------------|",
    ...containerRows,
  ].join("\n");

  // ── Network table
  const networkRows = networks.map((net) => {
    const attached =
      containers
        .filter((c) =>
          c.networks
            .split(",")
            .map((s) => s.trim())
            .includes(net.name),
        )
        .map((c) => c.name.replace(/^\//, ""))
        .join(", ") || "(none)";
    return `| ${net.name} | ${net.driver} | ${net.scope} | ${attached} |`;
  });
  const networkTable = [
    "| Network | Driver | Scope | Attached Containers |",
    "|---------|--------|-------|---------------------|",
    ...networkRows,
  ].join("\n");

  // ── Volume table
  const volumeRows = volumes.map((v) => {
    const users: string[] = [];
    for (const cmi of allMounts) {
      for (const mt of cmi.mounts) {
        if (mt.name === v.name) users.push(`${cmi.name}(${mt.rw ? "rw" : "ro"}→${mt.destination})`);
      }
    }
    return `| ${v.name} | ${v.driver} | ${v.mountpoint} | ${users.join("; ") || "⚠️ ORPHAN — not mounted"} |`;
  });
  const volumeTable = [
    "| Volume | Driver | Mountpoint | Mounted By |",
    "|--------|--------|------------|------------|",
    ...volumeRows,
  ].join("\n");

  // ── Compose projects
  const composeSection =
    projects.length === 0
      ? "No Compose projects detected."
      : projects
          .map(
            (p) =>
              `- **${p.name}** — ${p.status ?? "unknown status"} — ${p.config_files ?? "config unknown"}`,
          )
          .join("\n");

  // ── Orphan volumes count
  const mountedVolumeNames = new Set<string>();
  for (const cmi of allMounts) {
    for (const mt of cmi.mounts) {
      if (mt.kind === "volume" && mt.name) mountedVolumeNames.add(mt.name);
    }
  }
  const orphanCount = volumes.filter((v) => !mountedVolumeNames.has(v.name)).length;

  return `You are a Docker infrastructure expert. Analyze the following live Docker infrastructure data and produce a structured expert report using exactly this format:

---

## 1. Network Topology
- List all networks present and which driver they use (bridge/host/overlay/none)
- Identify which containers share the same network and can talk to each other
- Note any containers isolated from others

## 2. Container Breakdown (table format)
- Name + Image (short form)
- Port mapping: distinguish \`pub XXXX\` (exposed to host/internet) vs \`int XXXX\` (internal only)
- Health status (healthy / unhealthy / no healthcheck) — flag unhealthy with ⚠️
- Uptime / last restart (flag recently restarted containers)
- Volume attachments (named vs anonymous)

## 3. Data Persistence (Volumes)
- Named volumes: what service owns them, what data they hold
- Bind mounts: host path → container path, what's stored
- Anonymous/orphan volumes: count them, flag if they should be pruned
- Identify any stateful containers with NO volume (data loss risk on restart)

## 4. Security Observations
Flag any of these:
- Database or cache ports exposed publicly (should be \`int\` only in most cases)
- Admin UIs exposed publicly without auth mention (Kafdrop, Portainer, etc.)
- Containers running as root
- Missing resource limits (memory/CPU)
- Overly permissive port bindings (0.0.0.0 vs 127.0.0.1)

## 5. Operational Observations
- Which containers are stateless (safe to kill/restart anytime)
- Which containers are stateful (require graceful shutdown / volume backup)
- Auto-update mechanism present? (Watchtower, etc.) — note implications
- Any single points of failure (no replicas for critical services)

## 6. Actionable Recommendations
Ordered by priority (Critical → Warning → Info):
- 🔴 Critical: things that could cause data loss or security breach
- 🟡 Warning: things that will cause problems under load or failure
- 🟢 Info: housekeeping / optimization suggestions

---

Always use tables where data is comparative, use code blocks for commands, and flag anomalies inline with ⚠️. Keep explanations plain — assume the reader understands their own stack but wants a second pair of expert eyes, not a Docker tutorial.

---

## Live Infrastructure Data (${new Date().toLocaleString()})

**Summary:** ${String(containers.length)} containers (${String(containers.filter((c) => c.state === "running").length)} running) · ${String(networks.length)} networks · ${String(volumes.length)} volumes (${String(orphanCount)} orphans) · ${String(projects.length)} compose project${projects.length !== 1 ? "s" : ""}

### Containers
${containerTable}

### Networks
${networkTable}

### Volumes
${volumeTable}

### Compose Projects
${composeSection}

---

Please now analyze this infrastructure using the structure above.`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FILTER_GROUPS: { title: string; items: FilterType[] }[] = [
  { title: "Status", items: ["all", "running", "stopped"] },
  { title: "Health", items: ["healthy", "unhealthy"] },
  { title: "Compose", items: ["compose"] },
  {
    title: "Type",
    items: ["database", "cache", "broker", "proxy", "worker", "frontend", "backend", "monitoring"],
  },
];

type DockerTab = "graph" | "containers";

export function DockerExplorerPage({ onClose, host, onNodeAutoMessage }: DockerExplorerPageProps) {
  const explorer = useDockerExplorer();
  const pageCtx = usePageContext();
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showReadOnlyInfo, setShowReadOnlyInfo] = useState(false);
  const [tab, setTabState] = useState<DockerTab>(() => {
    try {
      const stored = localStorage.getItem("harbor.docker.tab");
      if (stored === "containers") return stored;
    } catch {
      /* ignore */
    }
    return "graph";
  });
  const [showLogs, setShowLogs] = useState(false);
  const [showDockerChat, setShowDockerChat] = useState(false);
  const [dockerChatAutoMsg, setDockerChatAutoMsg] = useState<string | null>(null);

  function setTab(next: DockerTab) {
    setTabState(next);
    try {
      localStorage.setItem("harbor.docker.tab", next);
    } catch {
      /* ignore */
    }
  }

  // Register this as the current page for chat context.
  // Cleanup only clears docker-specific context — do NOT reset currentPage,
  // otherwise closing this overlay while the terminal is still mounted would
  // wipe the terminal's active-page marker.
  useEffect(() => {
    pageCtx.setCurrentPage("docker");
    return () => {
      pageCtx.setDockerContext(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredContainers = useMemo(() => {
    return explorer.containers.filter((c) => {
      const name = c.name.replace(/^\//, "").toLowerCase();
      if (search && !name.includes(search.toLowerCase())) return false;
      const cats = detectCategory(c);
      switch (filter) {
        case "all":
          return true;
        case "running":
          return c.state === "running";
        case "stopped":
          return c.state !== "running";
        case "compose":
          return c.compose_project !== null;
        case "healthy":
          return parseHealth(c.status) === "healthy";
        case "unhealthy":
          return parseHealth(c.status) === "unhealthy";
        default:
          return cats.has(filter);
      }
    });
  }, [explorer.containers, filter, search]);

  // Publish docker context to chat whenever selection or counts change
  useEffect(() => {
    if (!selectedNodeId) {
      pageCtx.setDockerContext({
        selectedNodeId: null,
        selectedNodeType: null,
        selectedNodeJson: null,
        containerCount: explorer.containers.length,
        networkCount: explorer.networks.length,
        volumeCount: explorer.volumes.length,
      });
      return;
    }
    let nodeType: "container" | "network" | "volume" | null = null;
    let nodeJson: string | null = null;
    if (selectedNodeId.startsWith("c-")) {
      nodeType = "container";
      const c = explorer.containers.find((x) => `c-${x.id}` === selectedNodeId);
      if (c) {
        const stats = explorer.allStats.get(c.name.replace(/^\//, ""));
        nodeJson = JSON.stringify({
          name: c.name.replace(/^\//, ""),
          image: c.image,
          state: c.state,
          status: c.status,
          ports: c.ports,
          networks: c.networks,
          compose_project: c.compose_project,
          compose_service: c.compose_service,
          cpu: stats?.cpu_perc ?? null,
          mem: stats?.mem_usage ?? null,
        });
      }
    } else if (selectedNodeId.startsWith("net-")) {
      nodeType = "network";
      const n = explorer.networks.find((x) => `net-${x.id}` === selectedNodeId);
      if (n) nodeJson = JSON.stringify(n);
    } else if (selectedNodeId.startsWith("vol-")) {
      nodeType = "volume";
      const v = explorer.volumes.find((x) => `vol-${x.name}` === selectedNodeId);
      if (v) nodeJson = JSON.stringify(v);
    }
    pageCtx.setDockerContext({
      selectedNodeId,
      selectedNodeType: nodeType,
      selectedNodeJson: nodeJson,
      containerCount: explorer.containers.length,
      networkCount: explorer.networks.length,
      volumeCount: explorer.volumes.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, explorer.containers, explorer.networks, explorer.volumes, explorer.allStats]);

  // Pass explorer bits + auto-message callback into the click handler.
  // Empty string → explicit deselect (from pane click).
  const explorerRef = useRef({
    containers: explorer.containers,
    networks: explorer.networks,
    volumes: explorer.volumes,
    allStats: explorer.allStats,
    allMounts: explorer.allMounts,
  });
  explorerRef.current = {
    containers: explorer.containers,
    networks: explorer.networks,
    volumes: explorer.volumes,
    allStats: explorer.allStats,
    allMounts: explorer.allMounts,
  };
  const autoMsgRef = useRef(onNodeAutoMessage);
  autoMsgRef.current = onNodeAutoMessage;

  // Track previous selection outside setState so the updater is pure
  const prevSelectedRef = useRef<string | null>(null);
  prevSelectedRef.current = selectedNodeId;
  const handleSelect = useCallback((id: string) => {
    // Empty string → explicit deselect
    if (id === "") {
      setSelectedNodeId(null);
      return;
    }
    const prev = prevSelectedRef.current;
    const next = prev === id ? null : id;
    setSelectedNodeId(next);
    // Fire the auto-message as a side effect OUTSIDE the state updater —
    // React can call updaters multiple times (StrictMode) which would
    // otherwise send duplicate messages to the chat.
    if (next !== null && autoMsgRef.current) {
      try {
        const msg = buildAutoMessage(id, explorerRef.current);
        if (msg) autoMsgRef.current(msg);
      } catch (e) {
        console.warn("[Harbor] auto-message failed", e);
      }
    }
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface">
      {/* Header */}
      <div className="flex flex-none items-center justify-between border-b border-border bg-surface-toolbar px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded-input px-2 py-1 text-[11.5px] font-medium text-text-secondary hover:bg-surface-chip hover:text-text-primary"
            title="Back"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <div className="mx-2 h-4 w-px bg-border" />
          <h1 className="text-[13px] font-semibold text-text-primary">Docker Infrastructure</h1>
          <span className="text-[11px] text-text-tertiary">
            {String(explorer.containers.length)} containers · {String(explorer.networks.length)}{" "}
            networks · {String(explorer.volumes.length)} volumes
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Read-only badge */}
          <div className="relative">
            <button
              onClick={() => {
                setShowReadOnlyInfo((v) => !v);
              }}
              className="flex items-center gap-1 rounded-input border border-success/30 bg-success/10 px-2 py-1 text-[10.5px] font-semibold text-success hover:bg-success/15"
              title="This tool is read-only"
            >
              <ShieldCheck size={11} />
              Read-Only
              <Info size={9} />
            </button>
            {showReadOnlyInfo && (
              <div className="absolute right-0 top-full z-50 mt-1 w-[300px] rounded-input border border-border bg-surface-pane p-3 shadow-md">
                <p className="text-[11.5px] font-semibold text-text-primary">
                  Harbor never modifies your Docker state.
                </p>
                <p className="mt-1 text-[10.5px] text-text-secondary">
                  This dashboard only reads from your Docker socket. It never starts, stops,
                  removes, or modifies any container, image, network, or volume.
                </p>
                <p className="mt-1.5 text-[10px] font-medium text-text-tertiary">Commands used:</p>
                <ul className="mt-0.5 space-y-0.5 font-mono text-[10px] text-text-secondary">
                  <li>docker ps -a</li>
                  <li>docker inspect</li>
                  <li>docker stats --no-stream</li>
                  <li>docker logs</li>
                  <li>docker events</li>
                  <li>docker network ls</li>
                  <li>docker volume ls</li>
                </ul>
                <button
                  onClick={() => {
                    setShowReadOnlyInfo(false);
                  }}
                  className="mt-2 text-[10.5px] text-accent-dark hover:underline"
                >
                  Got it
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              void explorer.refresh();
            }}
            title="Refresh"
            className="rounded-chip p-1.5 text-text-secondary hover:bg-surface-chip hover:text-text-primary"
          >
            <RefreshCw size={12} className={explorer.loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex flex-none items-center gap-0 border-b border-border bg-surface-pane px-3">
        <TabButton
          label="Graph"
          active={tab === "graph"}
          onClick={() => {
            setTab("graph");
          }}
        />
        <TabButton
          label={`Containers (${String(explorer.containers.length)})`}
          active={tab === "containers"}
          onClick={() => {
            setTab("containers");
          }}
        />
        {tab === "graph" &&
          (FEATURES.AI ? (
            <button
              onClick={() => {
                const prompt = buildInfraAnalysisPrompt(
                  explorer.containers,
                  explorer.networks,
                  explorer.volumes,
                  explorer.allStats,
                  explorer.allMounts,
                  explorer.projects,
                );
                setDockerChatAutoMsg(prompt);
                setShowDockerChat(true);
              }}
              disabled={explorer.loading && explorer.containers.length === 0}
              className="ml-auto flex items-center gap-1.5 rounded-input border border-accent-muted/40 bg-accent/8 px-3 py-1 text-[11.5px] font-semibold text-accent-dark transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
              title="Analyze your Docker infrastructure with AI"
            >
              <Sparkles size={12} />
              {showDockerChat ? "Re-analyze" : "Analyze with AI"}
            </button>
          ) : (
            <div
              className="ml-auto flex cursor-not-allowed items-center gap-1.5 rounded-input border border-border-subtle bg-surface-chip px-3 py-1 text-[11.5px] font-semibold text-text-faint opacity-60"
              title="AI Analysis — Coming Soon"
            >
              <Sparkles size={12} />
              Analyze with AI
              <span className="rounded-full bg-surface-hover px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-text-tertiary">
                Soon
              </span>
            </div>
          ))}
      </div>

      {/* Floating log button */}
      <button
        onClick={() => {
          setShowLogs((v) => !v);
        }}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full border border-border bg-surface-pane px-3 py-1.5 text-[11px] font-medium text-text-secondary shadow-md hover:bg-surface-hover hover:text-text-primary"
        title="Show Docker fetch logs"
      >
        <Terminal size={12} />
        Logs
        {explorer.logs.length > 0 && (
          <span className="rounded-full bg-accent/15 px-1.5 py-[1px] text-[9.5px] font-semibold text-accent-dark">
            {String(explorer.logs.length)}
          </span>
        )}
      </button>

      {/* Log drawer */}
      {showLogs && (
        <DockerLogDrawer
          logs={explorer.logs}
          onClose={() => {
            setShowLogs(false);
          }}
        />
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main content: sidebar + active tab body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Filter sidebar (shared across all tabs) */}
          <div className="flex w-44 flex-none flex-col overflow-y-auto border-r border-border bg-surface-sidebar">
            <div className="px-2 py-2">
              <div className="relative">
                <Search
                  size={11}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary"
                />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                  placeholder="Filter…"
                  className="w-full rounded-input border border-border-input bg-surface-input py-1 pl-6 pr-2 text-[11.5px] text-text-primary outline-none focus:border-accent-muted"
                />
              </div>
            </div>
            {FILTER_GROUPS.map((g) => (
              <div key={g.title} className="border-t border-border-subtle px-2 py-2">
                <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-wide text-text-tertiary">
                  {g.title}
                </p>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setFilter(f);
                      }}
                      className={`flex items-center justify-between rounded-chip px-2 py-1 text-left text-[11px] transition-colors ${
                        filter === f
                          ? "bg-accent/10 font-semibold text-accent-dark"
                          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      }`}
                    >
                      <span className="capitalize">{f}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Active-tab body */}
          <div className="flex min-w-0 flex-1 flex-col">
            {explorer.loading && explorer.containers.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-text-tertiary">
                <RefreshCw size={20} className="animate-spin text-accent-dark/70" />
                <p className="text-[12px]">Loading Docker resources…</p>
              </div>
            ) : !explorer.available ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-text-tertiary">
                <AlertTriangle size={24} className="text-warning" />
                <p className="text-[13px] font-semibold text-text-primary">
                  Docker is not available on this host
                </p>
                <p className="text-[11.5px]">
                  Install Docker on the remote server or verify the daemon is running, then reload.
                </p>
              </div>
            ) : (
              <>
                {tab === "graph" && (
                  <>
                    <div className="min-h-0 flex-1">
                      {explorer.containers.length === 0 &&
                      explorer.networks.length === 0 &&
                      explorer.volumes.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-text-tertiary">
                          <Box size={24} className="text-text-faint" />
                          <p className="text-[13px] font-semibold text-text-primary">
                            No Docker resources yet
                          </p>
                          <p className="text-[11.5px]">
                            This host has Docker installed but no containers, networks, or volumes
                            to show.
                          </p>
                        </div>
                      ) : (
                        <DockerGraph
                          containers={filteredContainers}
                          allContainers={explorer.containers}
                          networks={explorer.networks}
                          volumes={explorer.volumes}
                          allStats={explorer.allStats}
                          allMounts={explorer.allMounts}
                          projects={explorer.projects}
                          selectedNodeId={selectedNodeId}
                          onSelect={handleSelect}
                        />
                      )}
                    </div>
                    <ExplainPanel
                      selectedNodeId={selectedNodeId}
                      containers={explorer.containers}
                      networks={explorer.networks}
                      volumes={explorer.volumes}
                      images={explorer.images}
                      allStats={explorer.allStats}
                      allMounts={explorer.allMounts}
                      projects={explorer.projects}
                    />
                  </>
                )}
                {tab === "containers" && (
                  <DockerContainersView
                    containers={filteredContainers}
                    allStats={explorer.allStats}
                    allMounts={explorer.allMounts}
                    images={explorer.images}
                    selectedContainerId={
                      selectedNodeId?.startsWith("c-") ? selectedNodeId.slice(2) : null
                    }
                    onSelectContainer={(id) => {
                      handleSelect(`c-${id}`);
                    }}
                    onAskAi={
                      onNodeAutoMessage
                        ? (msg) => {
                            onNodeAutoMessage(msg);
                          }
                        : undefined
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
        {/* end inner main content */}

        {/* Embedded AI chat panel (right side) */}
        {FEATURES.AI && showDockerChat && (
          <div className="flex w-[400px] flex-none flex-col border-l border-border">
            <ChatPanel
              host={host}
              onClose={() => {
                setShowDockerChat(false);
                setDockerChatAutoMsg(null);
              }}
              autoMessage={dockerChatAutoMsg}
              embedMode={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Docker Graph ──────────────────────────────────────────────────────────────

interface DockerGraphProps {
  containers: DockerContainer[];
  allContainers: DockerContainer[];
  networks: DockerNetwork[];
  volumes: DockerVolume[];
  allStats: Map<string, ContainerStats>;
  allMounts: ContainerMountInfo[];
  projects: ComposeProject[];
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
}

function DockerGraph({
  containers,
  allContainers,
  networks,
  volumes,
  allStats,
  allMounts,
  selectedNodeId,
  onSelect,
}: DockerGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  // Filter to named volumes (skip bind-mount paths, anonymous, and malformed).
  // Docker sometimes returns volumes with missing / non-string names — guard.
  const namedVols = useMemo(
    () =>
      volumes.filter(
        (v) => typeof v.name === "string" && v.name.length > 0 && !v.name.startsWith("/"),
      ),
    [volumes],
  );

  // Compute related node ids from the RAW source data (containers, networks,
  // allMounts) — NOT from the React Flow `edges` state. If we read from `edges`
  // we create a cycle: useEffect → setEdges → edges changes → relatedIds
  // recomputes → useEffect re-runs → setEdges again → ∞.
  const relatedIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const ids = new Set<string>([selectedNodeId]);

    if (selectedNodeId.startsWith("c-")) {
      const cid = selectedNodeId.slice(2);
      const container = containers.find((c) => c.id === cid);
      if (container) {
        // Networks the container is attached to
        container.networks
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => {
            const net = networks.find((n) => n.name === name);
            if (net) ids.add(`net-${net.id}`);
          });
        // Volume group for this container
        ids.add(`volgroup-${cid}`);
        // Legacy vol- nodes (kept for backwards compat)
        const bare = container.name.replace(/^\//, "");
        const cm = allMounts.find((m) => m.name === bare);
        cm?.mounts.forEach((mt) => {
          if (mt.kind === "volume" && mt.name) ids.add(`vol-${mt.name}`);
        });
      }
    } else if (selectedNodeId.startsWith("net-")) {
      const nid = selectedNodeId.slice(4);
      const net = networks.find((n) => n.id === nid);
      if (net) {
        for (const c of containers) {
          const cnets = c.networks
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (cnets.includes(net.name)) ids.add(`c-${c.id}`);
        }
      }
    } else if (selectedNodeId.startsWith("vol-")) {
      const vname = selectedNodeId.slice(4);
      for (const cm of allMounts) {
        for (const mt of cm.mounts) {
          if (mt.name === vname) {
            const c = containers.find((x) => x.name.replace(/^\//, "") === cm.name);
            if (c) ids.add(`c-${c.id}`);
          }
        }
      }
    } else if (selectedNodeId.startsWith("volgroup-")) {
      const cid = selectedNodeId.slice(9);
      ids.add(`c-${cid}`);
      const container = containers.find((c) => c.id === cid);
      if (container) {
        container.networks
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => {
            const net = networks.find((n) => n.name === name);
            if (net) ids.add(`net-${net.id}`);
          });
      }
    }
    // "orphan-stack" selected → only itself highlighted (no connections)
    return ids;
  }, [selectedNodeId, containers, networks, allMounts]);

  // Rebuild nodes + edges whenever data changes
  useEffect(() => {
    const nextNodes: Node[] = [];
    const nextEdges: Edge[] = [];

    // Networks column (left)
    networks.forEach((net, i) => {
      const id = `net-${net.id}`;
      nextNodes.push({
        id,
        type: "networkNode",
        position: { x: NET_X, y: COL_TOP + i * (NET_H + NET_GAP) },
        data: {
          network: net,
          isSelected: selectedNodeId === id,
          isDimmed: relatedIds !== null && !relatedIds.has(id),
          onSelect,
        },
        draggable: false,
      });
    });

    // Containers column (center)
    containers.forEach((c, i) => {
      const id = `c-${c.id}`;
      nextNodes.push({
        id,
        type: "containerNode",
        position: { x: CON_X, y: COL_TOP + i * (CON_H + CON_GAP) },
        data: {
          container: c,
          serviceType: detectServiceType(c),
          stats: allStats.get(c.name.replace(/^\//, "")),
          isSelected: selectedNodeId === id,
          isDimmed: relatedIds !== null && !relatedIds.has(id),
          onSelect,
        },
        draggable: false,
      });
    });

    // Network → Container edges — direction chosen so the edge originates from
    // the network's RIGHT side and terminates at the container's LEFT side
    // (networks live in the left column, containers in the middle column).
    for (const c of containers) {
      const netList = c.networks
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const netName of netList) {
        const net = networks.find((n) => n.name === netName);
        if (!net) continue;
        const edgeId = `net-edge-${net.id}-${c.id}`;
        const isRelated =
          relatedIds !== null && (relatedIds.has(`c-${c.id}`) || relatedIds.has(`net-${net.id}`));
        nextEdges.push({
          id: edgeId,
          source: `net-${net.id}`,
          target: `c-${c.id}`,
          type: "bezier",
          style: {
            stroke: "#378ADD",
            strokeWidth: isRelated ? 2.2 : 1,
            opacity:
              relatedIds !== null &&
              !relatedIds.has(`c-${c.id}`) &&
              !relatedIds.has(`net-${net.id}`)
                ? 0.06
                : 0.6,
            transition: "opacity 0.15s, stroke-width 0.15s",
          },
        });
      }
    }

    // Volumes column (right) — grouped per container + orphan stack
    // Build a map: containerId → list of volume mounts
    const containerVolMap = new Map<
      string,
      { volName: string; destination: string; rw: boolean }[]
    >();
    const usedVolumeNames = new Set<string>();

    for (const cmi of allMounts) {
      const bareName = cmi.name.replace(/^\//, "");
      const cNode = allContainers.find((c) => c.name.replace(/^\//, "") === bareName);
      if (!cNode) continue;
      if (!containers.some((c) => c.id === cNode.id)) continue; // hidden by filter
      const namedMounts = cmi.mounts.filter(
        (mt) => mt.kind === "volume" && mt.name && namedVols.some((v) => v.name === mt.name),
      );
      if (namedMounts.length === 0) continue;
      const entry = namedMounts.map((mt) => {
        usedVolumeNames.add(mt.name);
        return { volName: mt.name, destination: mt.destination, rw: mt.rw };
      });
      containerVolMap.set(cNode.id, entry);
    }

    // Orphan volumes = named volumes not claimed by any filtered container
    const orphanVols = namedVols.filter((v) => !usedVolumeNames.has(v.name));

    // Place VolumeGroupNodes — one per container that has volumes, aligned to
    // the container's Y position so the edge is horizontal-ish.
    let maxGroupBottom = COL_TOP;
    containers.forEach((c, i) => {
      const vols = containerVolMap.get(c.id);
      if (!vols || vols.length === 0) return;
      const groupId = `volgroup-${c.id}`;
      const containerY = COL_TOP + i * (CON_H + CON_GAP);
      const groupH = VOLGROUP_PAD * 2 + VOLGROUP_HEADER_H + vols.length * VOLGROUP_ROW_H;
      maxGroupBottom = Math.max(maxGroupBottom, containerY + groupH);

      nextNodes.push({
        id: groupId,
        type: "volumeGroupNode",
        position: { x: VOL_X, y: containerY },
        data: {
          containerName: c.name.replace(/^\//, ""),
          containerId: c.id,
          volumes: vols,
          isSelected: selectedNodeId === groupId,
          isDimmed: relatedIds !== null && !relatedIds.has(groupId),
          onSelect,
        },
        draggable: false,
      });

      // Single edge: container → volume group
      const hasRw = vols.some((v) => v.rw);
      const edgeColor = hasRw ? "#6366f1" : "#9ca3af";
      const isRelated =
        relatedIds !== null && (relatedIds.has(`c-${c.id}`) || relatedIds.has(groupId));
      nextEdges.push({
        id: `mount-group-${c.id}`,
        source: `c-${c.id}`,
        target: groupId,
        type: "bezier",
        style: {
          stroke: edgeColor,
          strokeWidth: isRelated ? 2.4 : 1.2,
          opacity: relatedIds !== null && !isRelated ? 0.06 : 0.75,
          transition: "opacity 0.15s, stroke-width 0.15s",
        },
      });
    });

    // Orphan stack node — below all volume groups
    if (orphanVols.length > 0) {
      const orphanId = "orphan-stack";
      nextNodes.push({
        id: orphanId,
        type: "orphanStackNode",
        position: { x: VOL_X, y: maxGroupBottom + 24 },
        data: {
          volumes: orphanVols,
          isSelected: selectedNodeId === orphanId,
          isDimmed: relatedIds !== null && !relatedIds.has(orphanId),
          onSelect,
        },
        draggable: false,
      });
    }

    setNodes(nextNodes);
    setEdges(nextEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, networks, volumes, allStats, allMounts, selectedNodeId, relatedIds, namedVols]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.3}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      panOnDrag
      zoomOnScroll
      nodesDraggable={false}
      nodesFocusable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => {
        // We manage selection state ourselves (see `isSelected` in node.data).
        // elementsSelectable is off so React Flow doesn't fight us for state.
        onSelect(node.id);
      }}
      onPaneClick={() => {
        onSelect("");
      }}
    >
      <Background gap={20} size={1} color="#e0ddd6" />
      <Controls position="bottom-left" showInteractive={false} />
      {/* Re-fit the viewport once nodes are actually populated + measured.
          The `fitView` prop only runs at mount when our nodes are still empty. */}
      <AutoFitOnPopulate nodeCount={nodes.length} />
      {/* Legend via React Flow's own Panel component — respects the pane's
          event system so it doesn't block clicks on nodes/edges below. */}
      <Panel
        position="bottom-right"
        className="pointer-events-none flex items-center gap-2 rounded-input border border-border-subtle bg-surface-pane/95 px-2 py-1 text-[10px] shadow-sm"
      >
        <LegendSwatch color="#378ADD" label="network" />
        <span className="text-text-faint">·</span>
        <LegendSwatch color="#6366f1" label="rw mount" />
        <span className="text-text-faint">·</span>
        <LegendSwatch color="#9ca3af" label="ro mount" />
      </Panel>
    </ReactFlow>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-text-secondary">
      <span className="inline-block h-[2.5px] w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/**
 * Sits inside <ReactFlow>. Watches for the moment nodes are first measured
 * (initialized) and calls fitView so all three columns are visible.
 * Runs once per non-empty node set (re-fires only if node count changes
 * significantly, e.g. filter toggled from empty → non-empty).
 */
function AutoFitOnPopulate({ nodeCount }: { nodeCount: number }) {
  const rf = useReactFlow();
  const initialized = useNodesInitialized();
  const lastFittedCountRef = useRef(0);
  useEffect(() => {
    if (!initialized || nodeCount === 0) return;
    // Fit whenever the count changed meaningfully (mount, or filter added/removed nodes).
    if (nodeCount !== lastFittedCountRef.current) {
      lastFittedCountRef.current = nodeCount;
      // Small delay so React Flow finishes internal measurement of new nodes.
      const t = setTimeout(() => {
        try {
          void rf.fitView({ padding: 0.12, duration: 200 });
        } catch {
          /* ignore */
        }
      }, 30);
      return () => {
        clearTimeout(t);
      };
    }
    return undefined;
  }, [initialized, nodeCount, rf]);
  return null;
}

// ── Explain Panel ─────────────────────────────────────────────────────────────

interface ExplainPanelProps {
  selectedNodeId: string | null;
  containers: DockerContainer[];
  networks: DockerNetwork[];
  volumes: DockerVolume[];
  images: DockerImage[];
  allStats: Map<string, ContainerStats>;
  allMounts: ContainerMountInfo[];
  projects: ComposeProject[];
}

function ExplainPanel({
  selectedNodeId,
  containers,
  networks,
  volumes,
  images,
  allStats,
  allMounts,
}: ExplainPanelProps) {
  if (!selectedNodeId) {
    return (
      <div className="flex h-[130px] flex-none items-center justify-center border-t border-border bg-surface-pane px-6 text-center">
        <p className="text-[11.5px] text-text-tertiary">
          Click any node to explore — containers, networks, and volumes light up their connections.
        </p>
      </div>
    );
  }

  if (selectedNodeId.startsWith("c-")) {
    const c = containers.find((x) => `c-${x.id}` === selectedNodeId);
    if (!c) return <div className="h-[210px] flex-none border-t border-border" />;
    const svc = detectServiceType(c);
    const cfg = SERVICE_CONFIG[svc];
    const imgIcon = getImageIcon(c.image);
    const brand = getBrandName(c.image);
    const stats = allStats.get(c.name.replace(/^\//, ""));
    const ports = parsePorts(c.ports);
    const mounts =
      allMounts
        .find((m) => m.name === c.name.replace(/^\//, ""))
        ?.mounts.filter((m) => m.kind === "volume") ?? [];
    const netList = c.networks
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const stateColor = containerColor(c.state);
    const typeName = brand ? `${brand} ${cfg.label || "service"}` : cfg.label || "application";
    const pubNote = ports.pub.length
      ? `It exposes port${ports.pub.length > 1 ? "s" : ""} ${ports.pub.join(", ")} to the host (published).`
      : "No ports are published to the host.";
    const projNote = c.compose_project ? ` Part of the ${c.compose_project} compose project.` : "";
    const description = `A ${typeName} container ${c.state === "running" ? "running" : c.state} (${c.status}). ${pubNote}${projNote}`;

    // Image section — find the exact image this container is running + siblings (same repo, other tags)
    const activeImageRef = c.image; // "repo:tag" or just "repo"
    const activeImage = images.find(
      (img) =>
        `${img.repository}:${img.tag}` === activeImageRef || img.repository === activeImageRef,
    );
    const siblingImages = activeImage
      ? images.filter(
          (img) =>
            img.repository === activeImage.repository &&
            `${img.repository}:${img.tag}` !== activeImageRef,
        )
      : [];

    return (
      <div className="flex h-[210px] flex-none border-t border-border bg-surface-pane px-3 py-2">
        <div className="mr-3 flex flex-none flex-col items-center gap-1">
          {imgIcon ? (
            <imgIcon.Icon size={30} color={imgIcon.color} />
          ) : (
            <cfg.Icon size={28} style={{ color: cfg.color }} />
          )}
          <span
            className="rounded-chip px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: `${stateColor}22`, color: stateColor }}
          >
            {c.state}
          </span>
        </div>
        <div
          className="flex min-w-0 flex-1 flex-col gap-0 overflow-y-auto"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[13px] font-semibold text-text-primary">
              {c.name.replace(/^\//, "")}
            </h3>
            <span className="truncate font-mono text-[10.5px] text-text-tertiary">{c.image}</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{description}</p>
          <div className="mt-1 grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
            {netList.length > 0 && (
              <>
                <span className="font-semibold text-text-tertiary">Networks</span>
                <span className="truncate text-text-secondary">{netList.join(", ")}</span>
              </>
            )}
            {mounts.length > 0 && (
              <>
                <span className="font-semibold text-text-tertiary">Volumes</span>
                <span className="truncate text-text-secondary">
                  {mounts.map((m) => `${m.name} (${m.rw ? "rw" : "ro"})`).join(", ")}
                </span>
              </>
            )}
            {stats && (
              <>
                <span className="font-semibold text-text-tertiary">CPU / Mem</span>
                <span className="font-mono text-text-secondary">
                  {stats.cpu_perc} · {stats.mem_usage}
                </span>
              </>
            )}
          </div>

          {/* Image section */}
          <div className="mt-2 border-t border-border-subtle pt-1.5">
            <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-wide text-text-faint">
              Image on this host
            </p>
            {activeImage ? (
              <div className="flex items-center gap-1.5 rounded-[4px] border border-success/25 bg-success/5 px-2 py-1 text-[10.5px]">
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full bg-success"
                  title="Active image"
                />
                <span className="flex-none font-mono font-semibold text-text-primary">
                  {activeImage.repository}:{activeImage.tag}
                </span>
                <span className="text-text-faint">·</span>
                <span className="font-mono text-text-tertiary">{activeImage.size}</span>
                <span className="text-text-faint">·</span>
                <span className="text-text-tertiary">{relAge(activeImage.created_at)}</span>
              </div>
            ) : (
              <p className="text-[10.5px] italic text-text-faint">
                Image metadata not available (image may be pulled but not listed)
              </p>
            )}
            {siblingImages.length > 0 && (
              <div className="mt-1">
                <p className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-text-faint">
                  Other tags ({String(siblingImages.length)}) — older / unused
                </p>
                <div className="flex flex-col gap-0.5">
                  {siblingImages.map((img) => {
                    const ref = `${img.repository}:${img.tag}`;
                    const usedByCount = containers.filter((ct) => ct.image === ref).length;
                    return (
                      <div
                        key={img.id}
                        className="flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[10px] hover:bg-surface-hover"
                      >
                        <span
                          className="h-1.5 w-1.5 flex-none rounded-full"
                          style={{ background: usedByCount > 0 ? "#e0a53c" : "#9ca3af" }}
                          title={
                            usedByCount > 0
                              ? `Used by ${String(usedByCount)} container(s)`
                              : "Not in use"
                          }
                        />
                        <span className="flex-none font-mono text-text-secondary">{img.tag}</span>
                        <span className="text-text-faint">·</span>
                        <span className="font-mono text-text-tertiary">{img.size}</span>
                        <span className="text-text-faint">·</span>
                        <span className="text-text-tertiary">{relAge(img.created_at)}</span>
                        {usedByCount > 0 && (
                          <span className="ml-auto text-[9.5px] font-semibold text-warning">
                            in use by {String(usedByCount)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (selectedNodeId.startsWith("net-")) {
    const net = networks.find((x) => `net-${x.id}` === selectedNodeId);
    if (!net) return <div className="h-[130px] flex-none border-t border-border" />;
    const attached = containers.filter((c) =>
      c.networks
        .split(",")
        .map((s) => s.trim())
        .includes(net.name),
    );
    const driverNote =
      net.driver === "bridge"
        ? "Containers on this network can reach each other by name — they are isolated from other networks unless explicitly connected."
        : net.driver === "host"
          ? "Uses the host's network stack directly. Containers share the host's IP and ports."
          : net.driver === "overlay"
            ? "Multi-host overlay network (Swarm). Spans multiple Docker hosts."
            : `Uses the '${net.driver}' network driver.`;
    return (
      <div className="flex h-[130px] flex-none border-t border-border bg-surface-pane px-3 py-2">
        <div className="mr-3 flex flex-none flex-col items-center gap-1">
          <Network size={28} className="text-[#378ADD]" />
          <span className="rounded-chip bg-[#E6F1FB] px-1.5 py-0.5 text-[9px] font-semibold text-[#1a5fbf]">
            {net.driver}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <h3 className="truncate text-[13px] font-semibold text-text-primary">{net.name}</h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-text-secondary">
            An {net.driver} network. {driverNote}
          </p>
          <div className="mt-1.5 grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
            <span className="font-semibold text-text-tertiary">Scope</span>
            <span className="text-text-secondary">{net.scope}</span>
            <span className="font-semibold text-text-tertiary">Attached</span>
            <span className="truncate text-text-secondary">
              {attached.length === 0
                ? "(no containers)"
                : `${attached.map((c) => c.name.replace(/^\//, "")).join(", ")} (${String(attached.length)} container${attached.length !== 1 ? "s" : ""})`}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (selectedNodeId.startsWith("vol-")) {
    const v = volumes.find((x) => `vol-${x.name}` === selectedNodeId);
    if (!v) return <div className="h-[130px] flex-none border-t border-border" />;
    const users: { name: string; dest: string; rw: boolean }[] = [];
    for (const cmi of allMounts) {
      for (const mt of cmi.mounts) {
        if (mt.name === v.name) {
          users.push({ name: cmi.name, dest: mt.destination, rw: mt.rw });
        }
      }
    }
    const isOrphan = users.length === 0;
    const iconColor = isOrphan ? "#e0a53c" : "#1f9d63";
    const Icon = isOrphan ? AlertTriangle : DatabaseIcon;
    const desc = isOrphan
      ? "This volume is not mounted by any container. Its data is not in active use and may be safe to remove."
      : `A named volume managed by Docker. Contents persist across container restarts and survive container removal. Mounted by ${String(users.length)} container${users.length !== 1 ? "s" : ""}.`;
    return (
      <div className="flex h-[130px] flex-none border-t border-border bg-surface-pane px-3 py-2">
        <div className="mr-3 flex flex-none flex-col items-center gap-1">
          <Icon size={28} style={{ color: iconColor }} />
          <span
            className="rounded-chip px-1.5 py-0.5 text-[9px] font-semibold"
            style={{ background: `${iconColor}22`, color: iconColor }}
          >
            {isOrphan ? "orphan" : "named"}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <h3 className="truncate text-[13px] font-semibold text-text-primary">{v.name}</h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-text-secondary">{desc}</p>
          <div className="mt-1.5 grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
            <span className="font-semibold text-text-tertiary">Driver</span>
            <span className="text-text-secondary">{v.driver}</span>
            <span className="font-semibold text-text-tertiary">Mount point</span>
            <span className="truncate font-mono text-text-secondary" title={v.mountpoint}>
              {v.mountpoint}
            </span>
            {users.length > 0 && (
              <>
                <span className="font-semibold text-text-tertiary">Mounted by</span>
                <span className="truncate text-text-secondary">
                  {users.map((u) => `${u.name} (${u.rw ? "rw" : "ro"} → ${u.dest})`).join(", ")}
                </span>
              </>
            )}
            {isOrphan && (
              <>
                <span className="font-semibold text-text-tertiary">Reclaim</span>
                <span className="font-mono text-text-secondary">docker volume rm {v.name}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (selectedNodeId.startsWith("volgroup-")) {
    const cid = selectedNodeId.slice(9);
    const c = containers.find((x) => x.id === cid);
    if (!c) return <div className="h-[130px] flex-none border-t border-border" />;
    const mounts =
      allMounts
        .find((m) => m.name === c.name.replace(/^\//, ""))
        ?.mounts.filter((m) => m.kind === "volume") ?? [];
    const stateColor = containerColor(c.state);
    return (
      <div className="flex h-[130px] flex-none border-t border-border bg-surface-pane px-3 py-2">
        <div className="mr-3 flex flex-none flex-col items-center gap-1">
          <DatabaseIcon size={28} className="text-[#6366f1]" />
          <span className="rounded-chip bg-[#6366f1]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6366f1]">
            volumes
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[13px] font-semibold text-text-primary">
              {c.name.replace(/^\//, "")} volumes
            </h3>
            <span
              className="rounded-chip px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ background: `${stateColor}22`, color: stateColor }}
            >
              {c.state}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-text-secondary">
            {mounts.length === 0
              ? "This container has no named volume mounts."
              : `${String(mounts.length)} volume mount${mounts.length !== 1 ? "s" : ""} — data persists across restarts.`}
          </p>
          <div className="mt-1.5 flex flex-col gap-0.5">
            {mounts.map((m) => (
              <div key={m.name + m.destination} className="flex items-center gap-2 text-[10.5px]">
                <span
                  className="flex-none rounded-[3px] px-1.5 py-[1px] font-semibold"
                  style={{
                    background: m.rw ? "rgba(99,102,241,0.12)" : "rgba(156,163,175,0.15)",
                    color: m.rw ? "#6366f1" : "#6b7280",
                  }}
                >
                  {m.rw ? "rw" : "ro"}
                </span>
                <span className="truncate font-mono text-text-primary">{m.name}</span>
                <span className="text-text-faint">→</span>
                <span className="truncate font-mono text-text-tertiary">{m.destination}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (selectedNodeId === "orphan-stack") {
    const usedNames = new Set<string>();
    for (const cmi of allMounts) {
      for (const mt of cmi.mounts) {
        if (mt.kind === "volume" && mt.name) usedNames.add(mt.name);
      }
    }
    const orphans = volumes.filter((v) => !usedNames.has(v.name));
    return (
      <div className="flex h-[130px] flex-none border-t border-border bg-surface-pane px-3 py-2">
        <div className="mr-3 flex flex-none flex-col items-center gap-1">
          <AlertTriangle size={28} className="text-warning" />
          <span className="rounded-chip bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
            orphan
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <h3 className="truncate text-[13px] font-semibold text-text-primary">
            {String(orphans.length)} orphan volume{orphans.length !== 1 ? "s" : ""}
          </h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-text-secondary">
            These volumes are not mounted by any container. Their data may be stale and they may be
            safe to remove with{" "}
            <span className="font-mono text-text-primary">docker volume prune</span>.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {orphans.map((v) => (
              <span
                key={v.name}
                className="rounded-chip border border-warning/30 bg-warning/6 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
                title={v.mountpoint}
              >
                {v.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <div className="h-[130px] flex-none border-t border-border" />;
}

// ── Docker Log Drawer ─────────────────────────────────────────────────────────

const SOURCE_STYLE: Record<string, { bg: string; color: string }> = {
  containers: { bg: "rgba(31,157,99,0.12)", color: "#1f9d63" },
  images: { bg: "rgba(2,132,199,0.12)", color: "#0284c7" },
  networks: { bg: "rgba(55,138,221,0.12)", color: "#378ADD" },
  volumes: { bg: "rgba(99,102,241,0.12)", color: "#6366f1" },
  stats: { bg: "rgba(217,119,6,0.12)", color: "#d97706" },
  mounts: { bg: "rgba(8,145,178,0.12)", color: "#0891b2" },
  compose: { bg: "rgba(124,58,237,0.12)", color: "#7c3aed" },
  fetch: { bg: "rgba(107,114,128,0.12)", color: "#6b7280" },
  cmd: { bg: "rgba(30,33,39,0.9)", color: "#dcdfe4" },
};

function DockerLogDrawer({ logs, onClose }: { logs: DockerLogEntry[]; onClose: () => void }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterSource, setFilterSource] = useState<string>("all");
  const reversed = useMemo(() => [...logs].reverse(), [logs]);
  const filtered = useMemo(
    () => (filterSource === "all" ? reversed : reversed.filter((e) => e.source === filterSource)),
    [reversed, filterSource],
  );
  const sources = useMemo(() => {
    const s = new Set(logs.map((e) => e.source));
    return ["all", ...Array.from(s)];
  }, [logs]);

  const errorCount = logs.filter((e) => e.level === "error").length;

  return (
    <>
      <div className="fixed inset-0 z-[49]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-[540px] flex-col border-l border-border bg-surface-pane shadow-2xl">
        {/* Header */}
        <div className="flex flex-none items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Terminal size={13} className="text-text-secondary" />
            <span className="text-[12.5px] font-semibold text-text-primary">Docker Fetch Logs</span>
            <span className="rounded-full bg-surface-chip px-2 py-0.5 text-[10px] text-text-tertiary">
              {String(logs.length)} entries
            </span>
            {errorCount > 0 && (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
                {String(errorCount)} error{errorCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-chip px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-chip hover:text-text-primary"
          >
            Close ✕
          </button>
        </div>

        {/* Source filter chips */}
        <div className="flex flex-none flex-wrap gap-1 border-b border-border-subtle px-2 py-1.5">
          {sources.map((src) => {
            const style = SOURCE_STYLE[src] as { bg: string; color: string } | undefined;
            return (
              <button
                key={src}
                onClick={() => {
                  setFilterSource(src);
                }}
                className="rounded-chip px-2 py-0.5 text-[10px] font-medium transition-colors"
                style={
                  filterSource === src
                    ? {
                        background: style?.bg ?? "rgba(107,114,128,0.12)",
                        color: style?.color ?? "#6b7280",
                      }
                    : undefined
                }
              >
                {src}
              </button>
            );
          })}
        </div>

        {/* Log entries */}
        <div className="flex-1 overflow-y-auto px-2 py-1.5" style={{ scrollbarWidth: "thin" }}>
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-[11.5px] text-text-tertiary">
              No log entries yet. Waiting for next fetch…
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((entry, idx) => {
                const style = SOURCE_STYLE[entry.source] ?? SOURCE_STYLE.fetch;
                const isExpanded = expandedId === entry.id;
                const time = new Date(entry.ts).toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                });
                // Show a cycle divider whenever the cycle number changes between entries
                const prevEntry = filtered[idx - 1] as DockerLogEntry | undefined;
                const showDivider = prevEntry?.cycle !== entry.cycle;
                const isLatestCycle = idx === 0;

                return (
                  <div key={entry.id}>
                    {showDivider && (
                      <div className={`flex items-center gap-2 ${idx > 0 ? "mt-3" : ""} mb-1`}>
                        <div className="h-px flex-1 bg-border-subtle" />
                        <div className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-2.5 py-0.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: isLatestCycle ? "#1f9d63" : "#9ca3af" }}
                          />
                          <span className="text-[9.5px] font-semibold text-text-tertiary">
                            Fetch #{String(entry.cycle)}
                          </span>
                          {isLatestCycle && (
                            <span className="text-[9px] font-semibold text-success">latest</span>
                          )}
                          <span className="text-[9px] text-text-faint tabular-nums">{time}</span>
                        </div>
                        <div className="h-px flex-1 bg-border-subtle" />
                      </div>
                    )}
                    <div
                      className={`rounded-[4px] border px-2 py-1 font-mono text-[11px] ${
                        entry.level === "error"
                          ? "border-danger/30 bg-danger/5"
                          : entry.level === "warn"
                            ? "border-warning/30 bg-warning/5"
                            : "border-transparent hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="flex-none text-[10px] tabular-nums text-text-faint">
                          {time}
                        </span>
                        <span
                          className="flex-none rounded-[3px] px-1 py-[1px] text-[9px] font-semibold"
                          style={{ background: style.bg, color: style.color }}
                        >
                          {entry.source}
                        </span>
                        <span
                          className={`flex-1 truncate ${
                            entry.level === "error"
                              ? "text-danger"
                              : entry.level === "warn"
                                ? "text-warning"
                                : "text-text-primary"
                          }`}
                        >
                          {entry.message}
                        </span>
                        {entry.detail && (
                          <button
                            onClick={() => {
                              setExpandedId(isExpanded ? null : entry.id);
                            }}
                            className="flex flex-none items-center gap-0.5 text-[9.5px] text-accent-dark hover:underline"
                          >
                            <ChevronRight
                              size={9}
                              className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            />
                            {isExpanded ? "hide" : "preview"}
                          </button>
                        )}
                      </div>
                      {isExpanded && entry.detail && (
                        <pre className="mt-1 max-h-[300px] overflow-auto rounded-[3px] bg-[#1e2127] px-2.5 py-2 text-[10px] leading-relaxed text-[#dcdfe4]">
                          {entry.detail}
                        </pre>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="flex flex-none items-center gap-2 border-t border-border-subtle px-3 py-1.5 text-[10px] text-text-faint">
          <Trash2 size={10} />
          Logs accumulate up to 300 entries · auto-fetches every 15 s
        </div>
      </div>
    </>
  );
}

// ── Tab strip button ──────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px flex h-9 items-center px-3 text-[12px] font-medium transition-colors ${
        active ? "text-accent-dark" : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {label}
      {active && (
        <span
          className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full bg-accent-dark"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
