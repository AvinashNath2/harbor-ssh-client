import { Activity, Box, ExternalLink, FileText, Loader2, Search, Sparkles } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContainerMountInfo, ContainerStats, DockerContainer, DockerImage } from "../api";
import { dockerContainerInspect, dockerContainerLogs } from "../api";
import { DockerImagesView } from "./DockerImagesView";
import { FEATURES } from "../lib/features";

interface DockerContainersViewProps {
  containers: DockerContainer[]; // already filtered by the sidebar chips
  allStats: Map<string, ContainerStats>;
  allMounts: ContainerMountInfo[];
  images: DockerImage[];
  selectedContainerId: string | null;
  onSelectContainer: (id: string) => void;
  /** Optional: send a rich context message to the AI chat. */
  onAskAi?: (message: string) => void;
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

function stateColor(state: string): string {
  if (state === "running") return "#1f9d63";
  if (state === "paused" || state === "restarting") return "#e0a53c";
  return "#e5534b";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DockerContainersView({
  containers,
  allStats,
  allMounts,
  images,
  selectedContainerId,
  onSelectContainer,
  onAskAi,
}: DockerContainersViewProps) {
  const [search, setSearch] = useState("");
  const [bottomHeight, setBottomHeight] = useState(260);
  const dragStateRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = { startY: e.clientY, startH: bottomHeight };
      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStateRef.current) return;
        const delta = dragStateRef.current.startY - ev.clientY;
        const newH = Math.max(140, Math.min(520, dragStateRef.current.startH + delta));
        setBottomHeight(newH);
      };
      const onMouseUp = () => {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [bottomHeight],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return containers;
    return containers.filter((c) => {
      const n = c.name.replace(/^\//, "").toLowerCase();
      const img = c.image.toLowerCase();
      return n.includes(q) || img.includes(q);
    });
  }, [containers, search]);

  const running = useMemo(
    () =>
      [...filtered]
        .filter((c) => c.state === "running")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );
  const stopped = useMemo(
    () =>
      [...filtered]
        .filter((c) => c.state !== "running")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );

  const selected = useMemo(
    () => containers.find((c) => c.id === selectedContainerId) ?? null,
    [containers, selectedContainerId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top section: list + focus panel */}
      <div className="flex min-h-0 flex-1">
        {/* Left list */}
        <div className="flex w-72 flex-none flex-col border-r border-border bg-surface-pane">
          <div className="border-b border-border-subtle p-2">
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
                placeholder="Search containers…"
                className="w-full rounded-input border border-border-input bg-surface-input py-1 pl-6 pr-2 text-[11.5px] text-text-primary outline-none focus:border-accent-muted"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {running.length > 0 && (
              <Group label="Running" count={running.length}>
                {running.map((c) => (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    stats={allStats.get(c.name.replace(/^\//, ""))}
                    active={selectedContainerId === c.id}
                    onSelect={() => {
                      onSelectContainer(c.id);
                    }}
                  />
                ))}
              </Group>
            )}
            {stopped.length > 0 && (
              <Group label="Stopped" count={stopped.length}>
                {stopped.map((c) => (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    stats={undefined}
                    active={selectedContainerId === c.id}
                    onSelect={() => {
                      onSelectContainer(c.id);
                    }}
                  />
                ))}
              </Group>
            )}
            {running.length === 0 && stopped.length === 0 && (
              <p className="px-3 py-4 text-center text-[11.5px] text-text-tertiary">
                No containers match the current filter.
              </p>
            )}
          </div>
        </div>

        {/* Right focus panel */}
        <div
          className="min-w-0 flex-1 overflow-y-auto bg-surface"
          style={{ scrollbarWidth: "thin" }}
        >
          {selected ? (
            <FocusPanel
              container={selected}
              stats={allStats.get(selected.name.replace(/^\//, ""))}
              allMounts={allMounts}
              onAskAi={onAskAi}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div>
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent-dark">
                  <Box size={18} />
                </div>
                <p className="text-[13px] font-semibold text-text-primary">
                  Pick a container from the list
                </p>
                <p className="mt-1 text-[11.5px] text-text-tertiary">
                  Its networks, volumes, live stats, and recent logs will appear here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drag-to-resize handle */}
      <div
        role="separator"
        aria-label="Resize image inventory panel"
        className="group flex h-2 flex-none cursor-row-resize items-center justify-center border-y border-border-subtle bg-surface-toolbar select-none hover:bg-accent/10 transition-colors"
        onMouseDown={handleDragStart}
      >
        <div className="h-[3px] w-8 rounded-full bg-border group-hover:bg-accent/40 transition-colors" />
      </div>

      {/* Bottom: Image Inventory */}
      <div
        className="flex-none overflow-hidden border-t border-border"
        style={{ height: bottomHeight }}
      >
        <DockerImagesView
          images={images}
          containers={containers}
          highlightedImageRef={selected?.image ?? null}
        />
      </div>
    </div>
  );
}

// ── List primitives ───────────────────────────────────────────────────────────

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border-subtle first:border-t-0">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-surface-toolbar px-2 py-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-wide text-text-tertiary">
          {label}
        </span>
        <span className="text-[10px] text-text-faint">{String(count)}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

const ContainerRow = memo(function ContainerRow({
  container,
  stats,
  active,
  onSelect,
}: {
  container: DockerContainer;
  stats: ContainerStats | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const color = stateColor(container.state);
  const name = container.name.replace(/^\//, "");
  const ports = parsePorts(container.ports);
  return (
    <button
      onClick={onSelect}
      className={`group flex flex-col items-start gap-0.5 border-b border-border-subtle px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover ${
        active ? "bg-accent/6 border-l-2 border-l-accent-dark" : ""
      }`}
    >
      <div className="flex w-full items-center gap-1.5">
        <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />
        <span className="truncate text-[11.5px] font-semibold text-text-primary" title={name}>
          {name}
        </span>
        {stats && (
          <span className="ml-auto flex-none font-mono text-[9.5px] text-text-tertiary">
            {stats.cpu_perc}
          </span>
        )}
      </div>
      <div className="flex w-full items-center gap-1.5">
        <span className="truncate font-mono text-[10px] text-text-tertiary" title={container.image}>
          {container.image}
        </span>
      </div>
      {(ports.pub.length > 0 || ports.int.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {ports.pub.slice(0, 3).map((p) => (
            <span
              key={`p${String(p)}`}
              className="rounded-[3px] px-1 py-[1px] font-mono text-[9px] font-semibold"
              style={{ background: "rgba(214,69,69,0.12)", color: "#d64545" }}
            >
              pub {String(p)}
            </span>
          ))}
          {ports.int.slice(0, 2).map((p) => (
            <span
              key={`i${String(p)}`}
              className="rounded-[3px] px-1 py-[1px] font-mono text-[9px] font-semibold"
              style={{ background: "rgba(120,120,120,0.12)", color: "#6a6f7a" }}
            >
              int {String(p)}
            </span>
          ))}
        </div>
      )}
    </button>
  );
});

// ── Focus panel ───────────────────────────────────────────────────────────────

function FocusPanel({
  container,
  stats,
  allMounts,
  onAskAi,
}: {
  container: DockerContainer;
  stats: ContainerStats | undefined;
  allMounts: ContainerMountInfo[];
  onAskAi?: (msg: string) => void;
}) {
  const color = stateColor(container.state);
  const name = container.name.replace(/^\//, "");
  const ports = parsePorts(container.ports);
  const networks = container.networks
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const mounts = useMemo(
    () => allMounts.find((m) => m.name === name)?.mounts.filter((m) => m.kind === "volume") ?? [],
    [allMounts, name],
  );

  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [showFullLogs, setShowFullLogs] = useState(false);
  const [showInspect, setShowInspect] = useState(false);

  // Lazy load recent-log preview when selection changes.
  const containerIdRef = useRef(container.id);
  useEffect(() => {
    containerIdRef.current = container.id;
    setLogs(null);
    setLogsError(null);
    setLogsLoading(true);
    dockerContainerLogs(container.id)
      .then((raw) => {
        if (containerIdRef.current !== container.id) return;
        // Take the last 30 non-empty lines
        const lines = raw.split("\n").filter((l) => l.length > 0);
        const tail = lines.slice(-30).join("\n");
        setLogs(tail);
      })
      .catch((e: unknown) => {
        if (containerIdRef.current !== container.id) return;
        setLogsError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (containerIdRef.current === container.id) setLogsLoading(false);
      });
  }, [container.id]);

  const askAi = () => {
    if (!onAskAi) return;
    const cpuMem = stats ? ` CPU ${stats.cpu_perc}, mem ${stats.mem_usage}.` : "";
    const proj = container.compose_project ? ` (compose: ${container.compose_project})` : "";
    const netList = networks.join(", ") || "none";
    const mountList = mounts.length
      ? mounts.map((m) => `${m.name}→${m.destination} (${m.rw ? "rw" : "ro"})`).join(", ")
      : "none";
    const msg = `I'm focused on container "${name}" (${container.image}, ${container.state}). Ports: ${container.ports || "none"}. Networks: ${netList}. Volumes: ${mountList}.${cpuMem}${proj} What can you tell me about this container?`;
    onAskAi(msg);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header block */}
      <div className="flex-none border-b border-border bg-surface-pane px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />
              <h2 className="truncate text-[15px] font-semibold text-text-primary">{name}</h2>
              <span
                className="rounded-chip px-1.5 py-0.5 text-[9.5px] font-semibold uppercase"
                style={{ background: `${color}22`, color }}
              >
                {container.state}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[11.5px] text-text-tertiary">
              {container.image}
            </p>
            <p className="mt-1 text-[11px] text-text-secondary">{container.status}</p>
          </div>
          <div className="flex flex-none flex-col items-end gap-1">
            {stats && (
              <>
                <span className="rounded-chip bg-success/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
                  CPU {stats.cpu_perc}
                </span>
                <span className="rounded-chip bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-dark">
                  {stats.mem_usage}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[11px]">
          {container.compose_project && (
            <>
              <span className="text-text-tertiary">Compose project</span>
              <span className="truncate font-medium text-text-primary">
                {container.compose_project}
                {container.compose_service ? ` · ${container.compose_service}` : ""}
              </span>
            </>
          )}
          <span className="text-text-tertiary">Ports</span>
          <span className="flex flex-wrap gap-1">
            {ports.pub.length === 0 && ports.int.length === 0 && (
              <span className="text-text-tertiary">none</span>
            )}
            {ports.pub.map((p) => (
              <span
                key={`p${String(p)}`}
                className="rounded-[3px] px-1 py-[1px] font-mono text-[10px] font-semibold"
                style={{ background: "rgba(214,69,69,0.12)", color: "#d64545" }}
              >
                pub {String(p)}
              </span>
            ))}
            {ports.int.map((p) => (
              <span
                key={`i${String(p)}`}
                className="rounded-[3px] px-1 py-[1px] font-mono text-[10px] font-semibold"
                style={{ background: "rgba(120,120,120,0.12)", color: "#6a6f7a" }}
              >
                int {String(p)}
              </span>
            ))}
          </span>
          <span className="text-text-tertiary">Networks</span>
          <span className="flex flex-wrap gap-1">
            {networks.length === 0 && <span className="text-text-tertiary">none</span>}
            {networks.map((n) => (
              <span
                key={n}
                className="rounded-chip bg-[#E6F1FB] px-1.5 py-0.5 text-[10px] font-medium text-[#1a5fbf]"
              >
                {n}
              </span>
            ))}
          </span>
          <span className="text-text-tertiary">Volumes</span>
          <span className="flex flex-col gap-0.5">
            {mounts.length === 0 && <span className="text-text-tertiary">none</span>}
            {mounts.map((m) => (
              <span
                key={`${m.name}${m.destination}`}
                className="font-mono text-[10.5px]"
                style={{
                  borderLeft: `2px solid ${m.rw ? "#6366f1" : "#9ca3af"}`,
                  paddingLeft: "6px",
                }}
              >
                <span className="text-accent-dark">{m.name}</span>
                <span className="text-text-tertiary"> → {m.destination}</span>
                <span
                  className="ml-1 rounded-chip px-1 py-0.5 text-[9px] font-semibold uppercase"
                  style={{
                    background: m.rw ? "rgba(99,102,241,0.12)" : "rgba(156,163,175,0.18)",
                    color: m.rw ? "#6366f1" : "#6a6f7a",
                    border: `1px solid ${m.rw ? "rgba(99,102,241,0.3)" : "rgba(156,163,175,0.4)"}`,
                  }}
                >
                  {m.rw ? "rw" : "ro"}
                </span>
              </span>
            ))}
          </span>
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setShowFullLogs(true);
            }}
            className="flex items-center gap-1 rounded-input border border-border-input bg-surface-pane px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <FileText size={11} /> Full logs
          </button>
          <button
            onClick={() => {
              setShowInspect(true);
            }}
            className="flex items-center gap-1 rounded-input border border-border-input bg-surface-pane px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <ExternalLink size={11} /> Inspect
          </button>
          {FEATURES.AI && onAskAi ? (
            <button
              onClick={askAi}
              className="flex items-center gap-1 rounded-input bg-accent-dark px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent"
            >
              <Sparkles size={11} /> Ask AI
            </button>
          ) : (
            <div
              className="flex cursor-not-allowed items-center gap-1 rounded-input border border-border-subtle px-2 py-1 text-[11px] font-semibold text-text-faint opacity-50"
              title="AI — Coming Soon"
            >
              <Sparkles size={11} /> Ask AI
              <span className="text-[8px] font-bold uppercase tracking-wide">Soon</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent logs preview */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5">
          <Activity size={12} className="text-text-tertiary" />
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-tertiary">
            Recent logs
          </span>
          {logsLoading && <Loader2 size={10} className="animate-spin text-text-tertiary" />}
          <button
            onClick={() => {
              setShowFullLogs(true);
            }}
            className="ml-auto text-[10.5px] text-accent-dark hover:underline"
          >
            open full →
          </button>
        </div>
        {logsError && (
          <p className="rounded-input border border-danger/30 bg-danger/5 px-2 py-1.5 text-[11px] text-danger">
            {logsError}
          </p>
        )}
        {!logsLoading && !logsError && (
          <pre className="overflow-x-auto rounded-input border border-border-subtle bg-[#1e2127] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[#dcdfe4]">
            {logs && logs.length > 0 ? logs : "(no recent output)"}
          </pre>
        )}
      </div>

      {/* Modals */}
      {showFullLogs && (
        <LogsModal
          containerId={container.id}
          name={name}
          onClose={() => {
            setShowFullLogs(false);
          }}
        />
      )}
      {showInspect && (
        <InspectModal
          containerId={container.id}
          name={name}
          onClose={() => {
            setShowInspect(false);
          }}
        />
      )}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function LogsModal({
  containerId,
  name,
  onClose,
}: {
  containerId: string;
  name: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dockerContainerLogs(containerId)
      .then((s) => {
        setContent(s);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [containerId]);
  return (
    <ModalShell title={`Logs · ${name}`} onClose={onClose}>
      {error ? (
        <p className="text-[12px] text-danger">{error}</p>
      ) : content == null ? (
        <div className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
          <Loader2 size={11} className="animate-spin" /> Loading logs…
        </div>
      ) : (
        <pre className="overflow-auto rounded-input bg-[#1e2127] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[#dcdfe4]">
          {content}
        </pre>
      )}
    </ModalShell>
  );
}

function InspectModal({
  containerId,
  name,
  onClose,
}: {
  containerId: string;
  name: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dockerContainerInspect(containerId)
      .then((v: unknown) => {
        setContent(JSON.stringify(v, null, 2));
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [containerId]);
  return (
    <ModalShell title={`Inspect · ${name}`} onClose={onClose}>
      {error ? (
        <p className="text-[12px] text-danger">{error}</p>
      ) : content == null ? (
        <div className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
          <Loader2 size={11} className="animate-spin" /> Loading inspect…
        </div>
      ) : (
        <pre className="overflow-auto rounded-input bg-surface-input px-3 py-2 font-mono text-[11px] leading-relaxed text-text-primary">
          {content}
        </pre>
      )}
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex max-h-[85vh] w-[880px] max-w-full flex-col overflow-hidden rounded-modal bg-surface-pane shadow-modal">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-chip px-2 py-0.5 text-[11.5px] text-text-secondary hover:bg-surface-chip hover:text-text-primary"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-hidden p-3">{children}</div>
      </div>
    </div>
  );
}
