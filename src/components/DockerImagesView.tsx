import { Box, Check, ChevronRight, Copy, Layers, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DockerContainer, DockerImage } from "../api";

interface DockerImagesViewProps {
  images: DockerImage[];
  containers: DockerContainer[];
  highlightedImageRef?: string | null;
}

interface ImageEntry {
  image: DockerImage;
  ref: string; // "repo:tag" (or "<dangling>" if repository is <none>)
  usedByRunning: string[]; // running container names
  usedByStopped: string[]; // stopped container names
  createdOrder: number; // higher = newer, derived from created_at
}

interface Group {
  repo: string;
  displayName: string; // "postgres" or "mycompany/my-api"
  entries: ImageEntry[];
  tagsCount: number;
  usedByCount: number; // unique containers using ANY tag in the group
  isDangling: boolean;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

/** Docker's `docker images` CreatedAt looks like "2024-06-01 12:34:56 -0700 PDT".
 *  We just need a sortable order; parse to timestamp when possible. */
function parseCreatedOrder(createdAt: string): number {
  if (!createdAt) return 0;
  // Strip trailing timezone abbreviation
  const s = createdAt.replace(/\s+[A-Z]{2,5}$/, "");
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

/** "2 weeks ago" / "3 days ago" from a timestamp. */
function relativeTime(t: number): string {
  if (!t) return "unknown";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${String(day)}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${String(month)}mo ago`;
  return `${String(Math.floor(day / 365))}y ago`;
}

/** Convert docker size strings like "23.4MB", "1.2GB" to bytes for summing. */
function parseSizeToBytes(size: string): number {
  const m = /^([\d.]+)\s*([KMG]?B)$/i.exec(size.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mul =
    unit === "B"
      ? 1
      : unit === "KB"
        ? 1024
        : unit === "MB"
          ? 1024 ** 2
          : unit === "GB"
            ? 1024 ** 3
            : 0;
  return isNaN(n) ? 0 : n * mul;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${String(b)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DockerImagesView({
  images,
  containers,
  highlightedImageRef,
}: DockerImagesViewProps) {
  const [search, setSearch] = useState("");
  const [openRepos, setOpenRepos] = useState<Set<string>>(new Set());
  const [copiedPrune, setCopiedPrune] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build cross-reference: container.image → containers using it
  const usersByImage = useMemo(() => {
    const map = new Map<string, { running: string[]; stopped: string[] }>();
    for (const c of containers) {
      const key = c.image;
      const bucket = map.get(key) ?? { running: [], stopped: [] };
      const bareName = c.name.replace(/^\//, "");
      if (c.state === "running") bucket.running.push(bareName);
      else bucket.stopped.push(bareName);
      map.set(key, bucket);
    }
    return map;
  }, [containers]);

  // Build image entries + groups
  const groups = useMemo<Group[]>(() => {
    const entries: ImageEntry[] = images.map((img) => {
      const isDangling = img.repository === "<none>" || img.tag === "<none>";
      const ref = isDangling ? `<dangling:${img.id.slice(0, 12)}>` : `${img.repository}:${img.tag}`;
      const users = usersByImage.get(ref) ?? { running: [], stopped: [] };
      return {
        image: img,
        ref,
        usedByRunning: users.running,
        usedByStopped: users.stopped,
        createdOrder: parseCreatedOrder(img.created_at),
      };
    });

    const byRepo = new Map<string, ImageEntry[]>();
    for (const e of entries) {
      const key = e.image.repository === "<none>" ? "<dangling>" : e.image.repository;
      const list = byRepo.get(key) ?? [];
      list.push(e);
      byRepo.set(key, list);
    }

    const built: Group[] = [];
    for (const [repo, list] of byRepo.entries()) {
      // Sort: in-use first (running > stopped), then by newest
      list.sort((a, b) => {
        const aInUse = a.usedByRunning.length > 0 ? 2 : a.usedByStopped.length > 0 ? 1 : 0;
        const bInUse = b.usedByRunning.length > 0 ? 2 : b.usedByStopped.length > 0 ? 1 : 0;
        if (aInUse !== bInUse) return bInUse - aInUse;
        return b.createdOrder - a.createdOrder;
      });
      const uniqueUsers = new Set<string>();
      for (const e of list) {
        for (const n of e.usedByRunning) uniqueUsers.add(n);
      }
      built.push({
        repo,
        displayName: repo === "<dangling>" ? "Dangling layers" : repo,
        entries: list,
        tagsCount: list.length,
        usedByCount: uniqueUsers.size,
        isDangling: repo === "<dangling>",
      });
    }
    // Sort: non-dangling first (by usedByCount desc, then by name); dangling last
    built.sort((a, b) => {
      if (a.isDangling !== b.isDangling) return a.isDangling ? 1 : -1;
      if (a.usedByCount !== b.usedByCount) return b.usedByCount - a.usedByCount;
      return a.displayName.localeCompare(b.displayName);
    });
    return built;
  }, [images, usersByImage]);

  // Search filter
  const q = search.trim().toLowerCase();
  const shownGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        entries: g.entries.filter(
          (e) => e.ref.toLowerCase().includes(q) || g.displayName.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.entries.length > 0);
  }, [groups, q]);

  // Compute reclaimable = dangling + tags not in use anywhere
  const reclaimable = useMemo(() => {
    let bytes = 0;
    let count = 0;
    for (const g of groups) {
      for (const e of g.entries) {
        const inUse = e.usedByRunning.length + e.usedByStopped.length > 0;
        if (!inUse || g.isDangling) {
          bytes += parseSizeToBytes(e.image.size);
          count += 1;
        }
      }
    }
    return { bytes, count };
  }, [groups]);

  // Auto-expand the group containing the highlighted image when selection changes
  useEffect(() => {
    if (!highlightedImageRef) return;
    const targetGroup = groups.find((g) => g.entries.some((e) => e.ref === highlightedImageRef));
    if (targetGroup) {
      setOpenRepos((prev) => {
        if (prev.has(targetGroup.repo)) return prev;
        const next = new Set(prev);
        next.add(targetGroup.repo);
        return next;
      });
    }
  }, [highlightedImageRef, groups]);

  // Scroll highlighted row into view after the group has expanded
  useEffect(() => {
    if (!highlightedImageRef) return;
    const t = setTimeout(() => {
      const el = scrollRef.current?.querySelector('[data-img-highlighted="true"]');
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
    return () => {
      clearTimeout(t);
    };
  }, [highlightedImageRef]);

  const PRUNE_CMD = "docker image prune -f && docker system prune -f";

  const toggleRepo = (repo: string) => {
    setOpenRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* Top action bar */}
      <div className="flex flex-none items-center gap-2 border-b border-border bg-surface-pane px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search image name or tag…"
            className="w-full rounded-input border border-border-input bg-surface-input py-1 pl-6 pr-2 text-[11.5px] text-text-primary outline-none focus:border-accent-muted"
          />
        </div>
        <div className="flex flex-none items-center gap-2">
          <div className="flex items-center gap-1 rounded-input border border-warning/40 bg-warning/8 px-2 py-1">
            <Trash2 size={10} className="text-warning" />
            <span className="text-[10.5px] font-semibold text-text-primary">
              Reclaimable: {formatBytes(reclaimable.bytes)}
            </span>
            <span className="text-[10px] text-text-tertiary">
              ({String(reclaimable.count)} images)
            </span>
          </div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(PRUNE_CMD);
              setCopiedPrune(true);
              setTimeout(() => {
                setCopiedPrune(false);
              }, 1500);
            }}
            title={`Copy: ${PRUNE_CMD}`}
            className="flex items-center gap-1 rounded-input border border-border-input bg-surface-pane px-2 py-1 text-[10.5px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            {copiedPrune ? <Check size={10} /> : <Copy size={10} />}
            {copiedPrune ? "Copied" : "Copy prune cmd"}
          </button>
        </div>
      </div>

      {/* Groups list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-2 py-2"
        style={{ scrollbarWidth: "thin" }}
      >
        {shownGroups.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-text-tertiary">
            <Box size={20} className="text-text-faint" />
            <p className="mt-2 text-[12px]">
              {images.length === 0 ? "No images on this host." : "No images match the search."}
            </p>
          </div>
        )}
        {shownGroups.map((g) => {
          const open = openRepos.has(g.repo) || q.length > 0;
          return (
            <RepoGroup
              key={g.repo}
              group={g}
              open={open}
              onToggle={() => {
                toggleRepo(g.repo);
              }}
              highlightedImageRef={highlightedImageRef ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Repo group ────────────────────────────────────────────────────────────────

function RepoGroup({
  group,
  open,
  onToggle,
  highlightedImageRef,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  highlightedImageRef: string | null;
}) {
  const totalBytes = group.entries.reduce((sum, e) => sum + parseSizeToBytes(e.image.size), 0);
  const hasHighlight =
    highlightedImageRef !== null && group.entries.some((e) => e.ref === highlightedImageRef);
  return (
    <div
      className="mb-1 overflow-hidden rounded-input border bg-surface-pane"
      style={{ borderColor: hasHighlight ? "rgba(251,191,36,0.5)" : undefined }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        <ChevronRight
          size={11}
          className={`flex-none text-text-tertiary transition-transform ${open ? "rotate-90" : ""}`}
        />
        {group.isDangling ? (
          <Trash2 size={12} className="flex-none text-warning" />
        ) : (
          <Layers
            size={12}
            className={`flex-none ${hasHighlight ? "text-amber-500" : "text-accent-dark"}`}
          />
        )}
        <span className="truncate text-[12px] font-semibold text-text-primary">
          {group.displayName}
        </span>
        <span className="ml-auto flex flex-none items-center gap-2 text-[10.5px] text-text-tertiary">
          <span>
            {String(group.tagsCount)} tag{group.tagsCount === 1 ? "" : "s"}
          </span>
          {!group.isDangling && (
            <>
              <span className="text-text-faint">·</span>
              <span
                className={group.usedByCount > 0 ? "font-semibold text-success" : "text-text-faint"}
              >
                in use by {String(group.usedByCount)}
              </span>
            </>
          )}
          <span className="text-text-faint">·</span>
          <span className="font-mono">{formatBytes(totalBytes)}</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 border-t border-border-subtle bg-surface-input px-1.5 py-1">
          {group.entries.map((e) => (
            <ImageRow
              key={e.image.id}
              entry={e}
              isDangling={group.isDangling}
              isHighlighted={highlightedImageRef === e.ref}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageRow({
  entry,
  isDangling,
  isHighlighted,
}: {
  entry: ImageEntry;
  isDangling: boolean;
  isHighlighted: boolean;
}) {
  const inUseRunning = entry.usedByRunning.length > 0;
  const inUseStopped = !inUseRunning && entry.usedByStopped.length > 0;
  const rel = relativeTime(entry.createdOrder);
  const label = isDangling
    ? entry.image.id.slice(0, 20)
    : `${entry.image.repository}:${entry.image.tag}`;
  return (
    <div
      data-img-highlighted={isHighlighted ? "true" : undefined}
      className={`grid grid-cols-[16px_1fr_80px_100px_1fr] items-center gap-2 rounded-chip px-1.5 py-1 text-[10.5px] transition-colors ${
        isDangling ? "text-text-tertiary" : "text-text-primary"
      }`}
      style={
        isHighlighted
          ? { background: "rgba(251,191,36,0.1)", outline: "1px solid rgba(251,191,36,0.55)" }
          : undefined
      }
    >
      <span
        className={`h-2 w-2 rounded-full ${
          inUseRunning ? "bg-success" : inUseStopped ? "bg-warning" : "bg-text-faint"
        }`}
        title={
          inUseRunning
            ? "In use (running)"
            : inUseStopped
              ? "Used only by stopped containers"
              : "Not in use"
        }
      />
      <span className="truncate font-mono">{label}</span>
      <span className="font-mono text-text-tertiary">{entry.image.size}</span>
      <span className="text-text-tertiary">{rel}</span>
      <span className="truncate text-text-secondary">
        {entry.usedByRunning.length > 0 && <span>used by: {entry.usedByRunning.join(", ")}</span>}
        {entry.usedByRunning.length === 0 && entry.usedByStopped.length > 0 && (
          <span className="text-text-tertiary">stopped: {entry.usedByStopped.join(", ")}</span>
        )}
      </span>
    </div>
  );
}
