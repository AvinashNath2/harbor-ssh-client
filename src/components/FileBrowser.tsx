import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  FolderOpen,
  HardDrive,
  Info,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeFolderSize, listFolder, type FileEntry } from "../api";
import { useElementWidth } from "../hooks/useElementWidth";
import type { Tab } from "../hooks/useTabs";
import { fileIcon, fileTypeLabel } from "../utils/fileType";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

type SortColumn = "name" | "size" | "modified" | "type";
type SortDir = "asc" | "desc";

const COMPACT_THRESHOLD = 560;
const GRID_WIDE = "16px minmax(0,1fr) 110px 78px 118px 100px";
const GRID_COMPACT = "16px minmax(0,1fr) 70px 110px";

const HARBOR_LOCAL_MIME = "application/x-harbor-local";
const HARBOR_REMOTE_MIME = "application/x-harbor-remote";

interface FileBrowserProps {
  tab: Tab;
  selected: Set<string>;
  onNavigate: (path: string) => void;
  onReload: () => void;
  onSelectionChange: (paths: Set<string>) => void;
  onRename: (oldPath: string, newName: string) => Promise<void>;
  onDelete: (paths: string[]) => void;
  onDownload: (paths: string[]) => void;
  onReceiveLocalDrop: (localPaths: string[]) => void;
  /** User picked "Properties" — open the detail panel for this path. */
  onOpenDetail?: (path: string) => void;
  /** User picked "Edit permissions" — open detail panel on Permissions tab in edit mode. */
  onEditPermissions?: (path: string) => void;
  homeDir: string;
  /** User picked "Show content" — open the file preview modal directly. */
  onShowPreview?: (entry: FileEntry) => void;
}

interface CtxMenu {
  x: number;
  y: number;
  paths: string[];
  entry: FileEntry;
}

export function FileBrowser({
  tab,
  selected,
  onNavigate,
  onReload,
  onSelectionChange,
  onRename,
  onDelete,
  onDownload,
  onReceiveLocalDrop,
  homeDir,
  onOpenDetail,
  onEditPermissions,
  onShowPreview,
}: FileBrowserProps) {
  const [containerRef, containerWidth] = useElementWidth();
  const compact = containerWidth > 0 && containerWidth < COMPACT_THRESHOLD;
  const gridCols = compact ? GRID_COMPACT : GRID_WIDE;

  const [pathInput, setPathInput] = useState("");
  const [editingPath, setEditingPath] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Search + sort state — both are local view options, per-tab.
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortColumn>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const pathInputRef = useRef<HTMLInputElement>(null);
  const lastClickedIndexRef = useRef<number>(-1);
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const pathValidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [acItems, setAcItems] = useState<string[]>([]);
  const [acIndex, setAcIndex] = useState(-1);
  const acTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On-demand computed folder sizes. Keyed by full remote path.
  const [folderSizes, setFolderSizes] = useState<Record<string, number>>({});
  const [loadingFolderSizes, setLoadingFolderSizes] = useState<Set<string>>(new Set());
  const inflightSizes = useRef<Set<string>>(new Set());

  // Reset search + folder sizes cache when the tab navigates elsewhere.
  useEffect(() => {
    setSearch("");
    setFolderSizes({});
    setLoadingFolderSizes(new Set());
    inflightSizes.current.clear();
  }, [tab.path]);

  // ⌘L / ⌘G focuses the path bar.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "g")) {
        e.preventDefault();
        setPathInput(tab.path);
        setEditingPath(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [tab.path]);

  // Auto-focus path input when editing mode activates.
  useEffect(() => {
    if (editingPath) pathInputRef.current?.focus();
  }, [editingPath]);

  // Path validation — 400ms debounce.
  useEffect(() => {
    if (!editingPath) { setPathValid(null); return; }
    const raw = pathInput.trim();
    if (!raw) { setPathValid(null); return; }
    if (pathValidTimerRef.current) clearTimeout(pathValidTimerRef.current);
    pathValidTimerRef.current = setTimeout(() => {
      const lastSlash = raw.lastIndexOf("/");
      const dir = lastSlash <= 0 ? "/" : raw.slice(0, lastSlash);
      const base = raw.endsWith("/") ? "" : raw.slice(lastSlash + 1);
      const checkDir = raw.endsWith("/") ? raw.replace(/\/$/, "") || "/" : dir;
      void listFolder(checkDir).then((entries) => {
        setPathValid(!base || entries.some((en) => en.name === base));
      }).catch(() => { setPathValid(false); });
    }, 400);
    return () => { if (pathValidTimerRef.current) clearTimeout(pathValidTimerRef.current); };
  }, [pathInput, editingPath]);

  // Autocomplete — 200ms debounce.
  useEffect(() => {
    if (!editingPath) { setAcItems([]); setAcIndex(-1); return; }
    const raw = pathInput.trim();
    if (!raw) { setAcItems([]); return; }
    if (acTimerRef.current) clearTimeout(acTimerRef.current);
    acTimerRef.current = setTimeout(() => {
      const lastSlash = raw.lastIndexOf("/");
      const dir = lastSlash <= 0 ? "/" : raw.slice(0, lastSlash);
      const prefix = raw.slice(lastSlash + 1).toLowerCase();
      void listFolder(dir).then((entries) => {
        const matches = entries
          .filter((en) => en.kind === "directory" && en.name.toLowerCase().startsWith(prefix))
          .map((en) => (dir === "/" ? "/" + en.name : dir + "/" + en.name));
        setAcItems(matches.slice(0, 12));
        setAcIndex(-1);
      }).catch(() => { setAcItems([]); });
    }, 200);
    return () => { if (acTimerRef.current) clearTimeout(acTimerRef.current); };
  }, [pathInput, editingPath]);

  function requestFolderSize(path: string) {
    // Record indexing is typed as always-defined without noUncheckedIndexedAccess,
    // so use `in` to detect the actually-cached case.
    if (path in folderSizes || inflightSizes.current.has(path)) return;
    inflightSizes.current.add(path);
    setLoadingFolderSizes((prev) => new Set([...prev, path]));
    computeFolderSize(path)
      .then((size) => { setFolderSizes((prev) => ({ ...prev, [path]: size })); })
      .catch(() => undefined)
      .finally(() => {
        inflightSizes.current.delete(path);
        setLoadingFolderSizes((prev) => { const s = new Set(prev); s.delete(path); return s; });
      });
  }

  // Filter + sort the entries. Folders always come first within a direction.
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? tab.entries.filter((e) => e.name.toLowerCase().includes(q))
      : tab.entries;

    const dirMul = sortDir === "asc" ? 1 : -1;
    const cmp = (a: FileEntry, b: FileEntry): number => {
      // Folders always float to the top regardless of sort direction — it's
      // the file-manager convention users expect.
      const aDir = a.kind === "directory";
      const bDir = b.kind === "directory";
      if (aDir !== bDir) return aDir ? -1 : 1;
      switch (sortCol) {
        case "size": {
          const as = a.kind === "directory" ? folderSizes[a.path] ?? -1 : a.size ?? 0;
          const bs = b.kind === "directory" ? folderSizes[b.path] ?? -1 : b.size ?? 0;
          return dirMul * (as - bs);
        }
        case "modified":
          return dirMul * ((a.modified ?? 0) - (b.modified ?? 0));
        case "type":
          return dirMul * fileTypeLabel(a.name, a.kind).localeCompare(fileTypeLabel(b.name, b.kind));
        case "name":
        default:
          return dirMul * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
    };
    return [...filtered].sort(cmp);
  }, [tab.entries, search, sortCol, sortDir, folderSizes]);

  function toggleSort(col: SortColumn) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  // Stable reference so ContextMenu's useEffect doesn't re-register on every render.
  const closeCtxMenu = useCallback(() => {
    setCtxMenu(null);
  }, []);

  function handlePathSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (pathInput.trim()) {
      onNavigate(pathInput.trim());
      setPathValid(null);
      setAcItems([]);
      setEditingPath(false);
      setPathInput("");
    }
  }

  function handleRowClick(e: React.MouseEvent, entry: FileEntry, idx: number) {
    if (e.shiftKey && lastClickedIndexRef.current >= 0) {
      const lo = Math.min(idx, lastClickedIndexRef.current);
      const hi = Math.max(idx, lastClickedIndexRef.current);
      onSelectionChange(new Set(visibleEntries.slice(lo, hi + 1).map((en) => en.path)));
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (meta) {
      const next = new Set(selected);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      onSelectionChange(next);
    } else {
      onSelectionChange(new Set([entry.path]));
    }
    lastClickedIndexRef.current = idx;
  }

  function handleRowDoubleClick(entry: FileEntry) {
    if (entry.kind === "directory") {
      onSelectionChange(new Set());
      onNavigate(entry.path);
    }
  }

  function handleRowContextMenu(e: React.MouseEvent, entry: FileEntry) {
    e.preventDefault();
    if (!selected.has(entry.path)) {
      onSelectionChange(new Set([entry.path]));
    }
    const paths = selected.has(entry.path) ? [...selected] : [entry.path];
    setCtxMenu({ x: e.clientX, y: e.clientY, paths, entry });
  }

  function buildMenuItems(ctx: CtxMenu): ContextMenuItem[] {
    const single = ctx.paths.length === 1;
    const isSingleDir = single && ctx.entry.kind === "directory";
    const filePaths = ctx.paths.filter((p) => {
      const en = tab.entries.find((e) => e.path === p);
      return en?.kind === "file";
    });

    // ── Folder-specific single-item menu ──────────────────────────────────────
    if (isSingleDir) {
      return [
        {
          label: "View content",
          icon: <FolderOpen size={12} strokeWidth={2} />,
          onClick: () => {
            onSelectionChange(new Set());
            onNavigate(ctx.entry.path);
          },
        },
        { label: "---", onClick: () => undefined },
        {
          label: "Rename",
          icon: <Pencil size={11} strokeWidth={2} />,
          onClick: () => { setRenamingPath(ctx.paths[0]); },
        },
        {
          label: "Edit permissions",
          icon: <Lock size={12} strokeWidth={2} />,
          onClick: () => {
            onSelectionChange(new Set([ctx.entry.path]));
            onEditPermissions?.(ctx.entry.path);
          },
        },
        {
          label: "Copy path",
          icon: <Copy size={12} strokeWidth={2} />,
          onClick: () => { void navigator.clipboard.writeText(ctx.entry.path); },
        },
        {
          label: "Compute size",
          icon: <HardDrive size={12} strokeWidth={2} />,
          onClick: () => { requestFolderSize(ctx.entry.path); },
        },
        { label: "---", onClick: () => undefined },
        {
          label: "Delete",
          icon: <Trash2 size={13} strokeWidth={2} />,
          danger: true,
          onClick: () => { onDelete(ctx.paths); },
        },
      ];
    }

    // ── File / multi-select menu ──────────────────────────────────────────────
    const isFile = single && ctx.entry.kind === "file";
    return [
      {
        label: "Show content",
        icon: <Eye size={12} strokeWidth={2} />,
        disabled: !isFile,
        onClick: () => {
          onSelectionChange(new Set([ctx.entry.path]));
          onShowPreview?.(ctx.entry);
        },
      },
      { label: "---", onClick: () => undefined },
      {
        label: "Properties",
        icon: <Info size={12} strokeWidth={2} />,
        disabled: !single,
        onClick: () => {
          onSelectionChange(new Set([ctx.entry.path]));
          onOpenDetail?.(ctx.entry.path);
        },
      },
      {
        label: "Edit permissions",
        icon: <Lock size={12} strokeWidth={2} />,
        disabled: !single,
        onClick: () => {
          onSelectionChange(new Set([ctx.entry.path]));
          onEditPermissions?.(ctx.entry.path);
        },
      },
      {
        label: "Copy path",
        icon: <Copy size={12} strokeWidth={2} />,
        disabled: !single,
        onClick: () => { void navigator.clipboard.writeText(ctx.entry.path); },
      },
      { label: "---", onClick: () => undefined },
      {
        label: "Rename",
        icon: <Pencil size={11} strokeWidth={2} />,
        disabled: !single,
        onClick: () => { setRenamingPath(ctx.paths[0]); },
      },
      {
        label: "Download",
        icon: <ArrowDown size={13} strokeWidth={2} />,
        disabled: filePaths.length === 0,
        onClick: () => { onDownload(filePaths); },
      },
      { label: "---", onClick: () => undefined },
      {
        label: ctx.paths.length > 1 ? `Delete ${ctx.paths.length.toString()} items` : "Delete",
        icon: <Trash2 size={13} strokeWidth={2} />,
        danger: true,
        onClick: () => { onDelete(ctx.paths); },
      },
    ];
  }

  // Drag-and-drop: accept local paths dropped here → upload to current dir.
  const [isDropTarget, setIsDropTarget] = useState(false);
  function handleDragOver(e: React.DragEvent) {
    const hasLocal = e.dataTransfer.types.includes(HARBOR_LOCAL_MIME);
    const hasOsFiles = e.dataTransfer.types.includes("Files");
    if (hasLocal || hasOsFiles) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDropTarget(true);
    }
  }
  function handleDragLeave() {
    setIsDropTarget(false);
  }
  function handleDrop(e: React.DragEvent) {
    setIsDropTarget(false);
    const raw = e.dataTransfer.getData(HARBOR_LOCAL_MIME);
    if (raw) {
      e.preventDefault();
      try {
        const paths: unknown = JSON.parse(raw);
        if (Array.isArray(paths)) onReceiveLocalDrop(paths.filter((p): p is string => typeof p === "string"));
      } catch { /* ignore */ }
      return;
    }
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const localPaths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i] as File & { path?: string };
        if (file.path) localPaths.push(file.path);
      }
      if (localPaths.length > 0) onReceiveLocalDrop(localPaths);
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col bg-surface-pane"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={isDropTarget ? { boxShadow: "inset 0 0 0 3px #3f7be0" } : undefined}
    >
      {/* Pane header */}
      <div className="flex h-10 flex-none items-center gap-2.5 border-b border-border-raised bg-surface-toolbar px-3.5">
        <span
          className="flex-shrink-0 rounded-[5px] px-[7px] py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[1px] text-accent-dark"
          style={{ background: "rgba(47,107,219,0.12)" }}
        >
          REMOTE
        </span>

        {editingPath ? (
          <form onSubmit={handlePathSubmit} className="relative flex flex-1 items-center gap-2">
            <input
              ref={pathInputRef}
              autoFocus
              type="text"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); }}
              onBlur={() => { setTimeout(() => { setEditingPath(false); setAcItems([]); setPathValid(null); }, 120); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditingPath(false); setAcItems([]); return; }
                if (acItems.length > 0) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setAcIndex((i) => Math.min(i + 1, acItems.length - 1)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setAcIndex((i) => Math.max(i - 1, -1)); return; }
                  if (e.key === "Tab" || (e.key === "Enter" && acIndex >= 0)) {
                    e.preventDefault();
                    const chosen = acItems[acIndex >= 0 ? acIndex : 0];
                    if (chosen) { setPathInput(chosen + "/"); setAcIndex(-1); }
                    return;
                  }
                }
              }}
              placeholder={tab.path}
              className={`flex-1 bg-transparent font-mono text-[12px] text-text-primary outline-none ${
                pathValid === false ? "rounded border border-danger px-1" : ""
              }`}
              title={pathValid === false ? "Path does not exist" : undefined}
            />
            <PathAutocomplete
              items={acItems}
              activeIndex={acIndex}
              onSelect={(p) => { setPathInput(p); setAcItems([]); setAcIndex(-1); pathInputRef.current?.focus(); }}
            />
          </form>
        ) : (
          <Breadcrumb
            path={tab.path}
            onNavigate={(p) => {
              onSelectionChange(new Set());
              onNavigate(p);
            }}
            onEdit={() => {
              setPathInput(tab.path);
              setEditingPath(true);
            }}
          />
        )}

        <button
          onClick={() => { onSelectionChange(new Set()); onNavigate(homeDir); }}
          title="Go to home directory"
          className="flex-shrink-0 rounded-[5px] px-[6px] py-[2px] font-mono text-[10px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >~</button>

        <div className="flex-1" />

        {/* In-folder search */}
        <div className="flex h-7 items-center gap-1.5 rounded-input border border-border-input bg-surface-pane px-2">
          <Search size={11} strokeWidth={2} className="text-text-faint" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearch(""); (e.target as HTMLInputElement).blur(); }
            }}
            placeholder="Filter…"
            className="w-[110px] bg-transparent text-[11.5px] text-text-primary outline-none placeholder:text-text-faint"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); }}
              title="Clear filter"
              className="flex h-4 w-4 items-center justify-center text-text-faint hover:text-text-secondary"
            >
              <X size={10} strokeWidth={2.4} />
            </button>
          )}
        </div>

        <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-success" />
        <button
          onClick={onReload}
          title="Reload"
          className="text-text-faint transition-colors hover:text-text-secondary"
        >
          <RefreshCw size={13} strokeWidth={2} />
        </button>
      </div>

      {/* Column header */}
      <div
        className="grid flex-none select-none items-center gap-3 border-b border-border-raised bg-surface-colheader px-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.5px] text-text-tertiary"
        style={{ height: "28px", gridTemplateColumns: gridCols }}
      >
        <span />
        <SortHeader col="name" label="Name" active={sortCol} dir={sortDir} onClick={toggleSort} />
        {!compact && (
          <SortHeader col="type" label="Type" active={sortCol} dir={sortDir} onClick={toggleSort} />
        )}
        <SortHeader col="size" label="Size" active={sortCol} dir={sortDir} onClick={toggleSort} align="right" />
        <SortHeader col="modified" label="Modified" active={sortCol} dir={sortDir} onClick={toggleSort} />
        {!compact && <span>Perms</span>}
      </div>

      {/* Content */}
      <div
        className="min-h-0 flex-1 overflow-auto"
        onClick={() => {
          onSelectionChange(new Set());
        }}
      >
        {tab.status === "loading" && (
          <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
            Loading…
          </div>
        )}

        {tab.status === "error" && (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm text-center">
              <p className="text-[13px] font-medium text-danger">Cannot open directory</p>
              <p className="mt-1 font-mono text-[11px] text-text-tertiary">{tab.error}</p>
              <button
                onClick={onReload}
                className="mt-3 text-[12px] text-accent-dark hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {tab.status === "ready" && (
          <>
            {renameError && (
              <div className="flex items-center justify-between gap-3 border-b border-danger/20 bg-danger/10 px-4 py-2">
                <span className="text-[12px] text-danger">Rename failed: {renameError}</span>
                <button
                  onClick={() => { setRenameError(null); }}
                  className="text-[11px] text-danger/60 hover:text-danger"
                >
                  ✕
                </button>
              </div>
            )}
            {/* ".." parent navigation row */}
            {tab.path !== "/" && (
              <div
                onDoubleClick={() => {
                  const parent = tab.path.replace(/\/[^/]+\/?$/, "") || "/";
                  onSelectionChange(new Set());
                  onNavigate(parent);
                }}
                className="grid cursor-pointer select-none items-center gap-3 border-b border-border-subtle px-3.5 transition-colors hover:bg-surface-hover"
                style={{ height: "31px", gridTemplateColumns: gridCols }}
              >
                <div
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px]"
                  style={{ background: "#e0a53c", border: "1px solid #c8922a" }}
                />
                <span className="truncate font-semibold text-[12.5px] text-text-secondary">..</span>
                {!compact && <span className="font-mono text-[11px] text-text-faint">Folder</span>}
                <span className="text-right font-mono text-[11.5px] text-text-tertiary">—</span>
                <span className="font-mono text-[11.5px] text-text-tertiary" />
                {!compact && <span className="font-mono text-[10.5px] text-text-faint" />}
              </div>
            )}

            {visibleEntries.length > 0 && (
              <FileList
                entries={visibleEntries}
                selected={selected}
                renamingPath={renamingPath}
                compact={compact}
                gridCols={gridCols}
                folderSizes={folderSizes}
                loadingFolderSizes={loadingFolderSizes}
                onRowClick={handleRowClick}
                onRowDoubleClick={handleRowDoubleClick}
                onRowContextMenu={handleRowContextMenu}
                onRenameCommit={(oldPath, newName) => {
                  setRenamingPath(null);
                  if (newName) {
                    setRenameError(null);
                    onRename(oldPath, newName).catch((e: unknown) => {
                      setRenameError(e instanceof Error ? e.message : String(e));
                    });
                  }
                }}
              />
            )}

            {tab.entries.length === 0 && !search && (
              <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
                Empty directory
              </div>
            )}

            {tab.entries.length > 0 && visibleEntries.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-text-faint">
                <span>No matches for &ldquo;{search}&rdquo;</span>
                <button
                  onClick={() => { setSearch(""); }}
                  className="text-[11.5px] text-accent-dark hover:underline"
                >
                  Clear filter
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer — file count + size */}
      {tab.status === "ready" && (
        <RemoteFooter
          entries={tab.entries}
          filtered={search ? visibleEntries.length : null}
        />
      )}

      {ctxMenu != null && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildMenuItems(ctxMenu)}
          onClose={closeCtxMenu}
        />
      )}
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function Breadcrumb({
  path,
  onNavigate,
  onEdit,
}: {
  path: string;
  onNavigate: (p: string) => void;
  onEdit: () => void;
}) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div
      onClick={onEdit}
      title="Click to type a path  (⌘L or ⌘G)"
      className="group flex min-w-0 flex-1 cursor-text items-center gap-[5px] font-mono text-[12px]"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNavigate("/");
        }}
        className="flex-shrink-0 text-text-faint transition-colors hover:text-text-secondary"
      >
        /
      </button>
      {segments.map((seg, i) => {
        const segPath = "/" + segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={segPath} className="flex min-w-0 items-center gap-[5px]">
            <span className="flex-shrink-0 text-text-faint">/</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(segPath);
              }}
              className={`truncate transition-colors hover:text-text-primary ${
                isLast ? "text-text-primary" : "text-text-secondary"
              }`}
            >
              {seg}
            </button>
          </span>
        );
      })}
      <Pencil
        size={10}
        strokeWidth={2}
        className="ml-1 flex-shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function RemoteFooter({ entries, filtered }: { entries: FileEntry[]; filtered: number | null }) {
  const folders = entries.filter((e) => e.kind === "directory").length;
  const files = entries.filter((e) => e.kind !== "directory").length;
  const totalSize = entries.reduce((acc, e) => acc + (e.size ?? 0), 0);
  return (
    <div className="flex h-8 flex-none items-center border-t border-border-raised bg-surface-colheader px-3.5">
      <span className="font-mono text-[10.5px] text-text-tertiary">
        {folders} folder{folders !== 1 ? "s" : ""}, {files} file{files !== 1 ? "s" : ""}
        {totalSize > 0 ? `  |  ${formatSize(totalSize)}` : ""}
        {filtered !== null ? `  |  ${filtered.toString()} shown` : ""}
      </span>
    </div>
  );
}

// ── File list ─────────────────────────────────────────────────────────────────

function FileList({
  entries,
  selected,
  renamingPath,
  compact,
  gridCols,
  folderSizes,
  loadingFolderSizes,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onRenameCommit,
}: {
  entries: FileEntry[];
  selected: Set<string>;
  renamingPath: string | null;
  compact: boolean;
  gridCols: string;
  folderSizes: Record<string, number>;
  loadingFolderSizes: Set<string>;
  onRowClick: (e: React.MouseEvent, entry: FileEntry, idx: number) => void;
  onRowDoubleClick: (entry: FileEntry) => void;
  onRowContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onRenameCommit: (oldPath: string, newName: string) => void;
}) {
  return (
    <div>
      {entries.map((entry, idx) => (
        <FileRow
          key={entry.path}
          entry={entry}
          idx={idx}
          isSelected={selected.has(entry.path)}
          isRenaming={renamingPath === entry.path}
          compact={compact}
          gridCols={gridCols}
          folderSize={entry.kind === "directory" ? folderSizes[entry.path] : undefined}
          folderSizeLoading={entry.kind === "directory" ? loadingFolderSizes.has(entry.path) : false}
          onClick={onRowClick}
          onDoubleClick={onRowDoubleClick}
          onContextMenu={onRowContextMenu}
          onRenameCommit={onRenameCommit}
          onDragStart={(e) => {
            const paths = selected.has(entry.path) ? Array.from(selected) : [entry.path];
            e.dataTransfer.setData(HARBOR_REMOTE_MIME, JSON.stringify(paths));
            e.dataTransfer.effectAllowed = "copy";
          }}
        />
      ))}
    </div>
  );
}

function FileRow({
  entry,
  idx,
  isSelected,
  isRenaming,
  compact,
  gridCols,
  folderSize,
  folderSizeLoading,
  onClick,
  onDoubleClick,
  onContextMenu,
  onRenameCommit,
  onDragStart,
}: {
  entry: FileEntry;
  idx: number;
  isSelected: boolean;
  isRenaming: boolean;
  compact: boolean;
  gridCols: string;
  folderSize?: number;
  folderSizeLoading?: boolean;
  onClick: (e: React.MouseEvent, entry: FileEntry, idx: number) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onRenameCommit: (oldPath: string, newName: string) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const isDir = entry.kind === "directory";
  const { bg, fg, glyph } = fileIcon(entry.name, entry.kind);
  const renameRef = useRef<HTMLInputElement>(null);
  // Tracks Escape press so the subsequent onBlur doesn't commit the rename.
  const escapedRef = useRef(false);
  const typeLabel = fileTypeLabel(entry.name, entry.kind);

  return (
    <div
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e, entry, idx);
      }}
      onDoubleClick={() => {
        onDoubleClick(entry);
      }}
      onContextMenu={(e) => {
        onContextMenu(e, entry);
      }}
      className={`grid select-none items-center gap-3 border-b border-border-subtle px-3.5 transition-colors ${
        isDir ? "cursor-pointer" : "cursor-default"
      } ${isSelected ? "bg-accent/[0.09]" : "hover:bg-surface-hover"}`}
      style={{ height: "31px", gridTemplateColumns: gridCols }}
    >
      {/* Icon */}
      <div
        className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] font-mono text-[7px] font-bold"
        style={{ background: bg, color: fg }}
      >
        {glyph}
      </div>

      {/* Name / rename input */}
      {isRenaming ? (
        <input
          ref={renameRef}
          autoFocus
          defaultValue={entry.name}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onBlur={(e) => {
            if (escapedRef.current) {
              escapedRef.current = false;
              return;
            }
            onRenameCommit(entry.path, e.target.value.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = (e.target as HTMLInputElement).value.trim();
              onRenameCommit(entry.path, val);
            } else if (e.key === "Escape") {
              escapedRef.current = true;
              onRenameCommit(entry.path, "");
            }
          }}
          className="w-full rounded border border-accent bg-white px-1 font-mono text-[12.5px] text-text-primary outline-none"
        />
      ) : (
        <span
          className={`truncate text-[12.5px] text-text-primary ${isDir || entry.kind === "symlink" ? "font-semibold" : ""}`}
        >
          {entry.name}
        </span>
      )}

      {/* Type */}
      {!compact && (
        <span className="truncate font-mono text-[11px] text-text-tertiary">{typeLabel}</span>
      )}

      {/* Size — for folders, show the computed recursive size once available */}
      <span className="text-right font-mono text-[11.5px] text-text-tertiary">
        {entry.kind === "directory"
          ? folderSize !== undefined
            ? formatSize(folderSize)
            : folderSizeLoading
              ? <span className="animate-pulse text-text-faint">…</span>
              : "—"
          : formatSize(entry.size)}
      </span>

      {/* Modified */}
      <span className="font-mono text-[11.5px] text-text-tertiary">
        {formatDate(entry.modified)}
      </span>

      {/* Perms */}
      {!compact && (
        <span className="font-mono text-[10.5px] text-text-faint">{entry.permissions ?? "—"}</span>
      )}
    </div>
  );
}

// ── Sortable column header ────────────────────────────────────────────────────

function SortHeader({
  col,
  label,
  active,
  dir,
  onClick,
  align,
}: {
  col: SortColumn;
  label: string;
  active: SortColumn;
  dir: SortDir;
  onClick: (col: SortColumn) => void;
  align?: "left" | "right";
}) {
  const isActive = active === col;
  return (
    <button
      onClick={() => { onClick(col); }}
      className={`flex items-center gap-1 font-inherit text-inherit transition-colors hover:text-text-primary ${
        align === "right" ? "justify-end" : "justify-start"
      } ${isActive ? "text-text-primary" : ""}`}
    >
      {label}
      {isActive &&
        (dir === "asc" ? (
          <ChevronUp size={10} strokeWidth={2.4} />
        ) : (
          <ChevronDown size={10} strokeWidth={2.4} />
        ))}
    </button>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number | null): string {
  if (ts === null) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Path autocomplete dropdown ────────────────────────────────────────────────

function PathAutocomplete({
  items,
  activeIndex,
  onSelect,
}: {
  items: string[];
  activeIndex: number;
  onSelect: (p: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="absolute left-0 top-full z-50 mt-0.5 max-h-[240px] w-full overflow-auto rounded-[10px] border border-border-raised bg-surface-pane py-1 shadow-[0_4px_24px_rgba(0,0,0,0.14)]"
      onMouseDown={(e) => { e.preventDefault(); }}
    >
      {items.map((item, i) => (
        <button
          key={item}
          onMouseDown={() => { onSelect(item + "/"); }}
          className={`block w-full truncate px-3 py-[5px] text-left font-mono text-[12px] transition-colors ${
            i === activeIndex
              ? "bg-accent/[0.09] text-text-primary"
              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
