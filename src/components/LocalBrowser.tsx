import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteLocalPath, renameLocalPath, revealInFinder, type LocalFileEntry } from "../api";
import { useElementWidth } from "../hooks/useElementWidth";
import type { LocalTab } from "../hooks/useLocalFiles";
import { fileIcon, fileTypeLabel } from "../utils/fileType";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

const HARBOR_LOCAL_MIME = "application/x-harbor-local";
const HARBOR_REMOTE_MIME = "application/x-harbor-remote";
const COMPACT_THRESHOLD = 500;
const GRID_WIDE = "16px minmax(0,1fr) 110px 78px 118px";
const GRID_COMPACT = "16px minmax(0,1fr) 70px 110px";

type SortCol = "name" | "size" | "modified" | "type";
type SortDir = "asc" | "desc";

interface CtxMenu {
  x: number;
  y: number;
  paths: string[];
  entry: LocalFileEntry;
}

interface LocalBrowserProps {
  tab: LocalTab;
  selected: Set<string>;
  onNavigate: (path: string) => void;
  onSelectionChange: (paths: Set<string>) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onReload: () => void;
  onTransferToRemote: (paths: string[]) => void;
  onReceiveRemoteDrop: (remotePaths: string[]) => void;
}

export function LocalBrowser({
  tab,
  selected,
  onNavigate,
  onSelectionChange,
  onGoBack,
  onGoForward,
  canGoBack,
  canGoForward,
  onReload,
  onTransferToRemote,
  onReceiveRemoteDrop,
}: LocalBrowserProps) {
  const [containerRef, containerWidth] = useElementWidth();
  const compact = containerWidth > 0 && containerWidth < COMPACT_THRESHOLD;
  const gridCols = compact ? GRID_COMPACT : GRID_WIDE;

  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const pathInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const [pendingDelete, setPendingDelete] = useState<string[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Last clicked index for shift-click range selection.
  const lastClickedIndexRef = useRef<number>(-1);

  // Reset search when navigating.
  useEffect(() => {
    setSearch("");
    setRenameError(null);
  }, [tab.path]);

  // ⌘L focuses the path bar.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "l") {
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

  function commitPath(e: React.SyntheticEvent) {
    e.preventDefault();
    const p = pathInput.trim();
    if (p) onNavigate(p);
    setEditingPath(false);
    setPathInput("");
  }

  function goUp() {
    if (!tab.path || tab.path === "/") return;
    const parent = tab.path.replace(/\/[^/]+\/?$/, "") || "/";
    onSelectionChange(new Set());
    onNavigate(parent);
  }

  // Sort + filter.
  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? tab.entries.filter((e) => e.name.toLowerCase().includes(q))
      : tab.entries;

    const mul = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aDir = a.kind === "directory";
      const bDir = b.kind === "directory";
      if (aDir !== bDir) return aDir ? -1 : 1;
      switch (sortCol) {
        case "size":
          return mul * ((a.size ?? 0) - (b.size ?? 0));
        case "modified":
          return mul * ((a.modified ?? 0) - (b.modified ?? 0));
        case "type":
          return mul * fileTypeLabel(a.name, a.kind).localeCompare(fileTypeLabel(b.name, b.kind));
        case "name":
        default:
          return mul * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
    });
  }, [tab.entries, search, sortCol, sortDir]);

  function toggleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  // Click / shift-click selection.
  function handleRowClick(e: React.MouseEvent, entry: LocalFileEntry, idx: number) {
    if (e.shiftKey && lastClickedIndexRef.current >= 0) {
      const lo = Math.min(idx, lastClickedIndexRef.current);
      const hi = Math.max(idx, lastClickedIndexRef.current);
      const range = new Set(visibleEntries.slice(lo, hi + 1).map((en) => en.path));
      onSelectionChange(range);
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (meta) {
      const next = new Set(selected);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      onSelectionChange(next);
    } else {
      onSelectionChange(new Set([entry.path]));
    }
    lastClickedIndexRef.current = idx;
  }

  function handleRowDoubleClick(entry: LocalFileEntry) {
    if (entry.kind === "directory") {
      onSelectionChange(new Set());
      onNavigate(entry.path);
    } else {
      // Open files with the system default application.
      void revealInFinder(entry.path);
    }
  }

  function handleRowContextMenu(e: React.MouseEvent, entry: LocalFileEntry) {
    e.preventDefault();
    if (!selected.has(entry.path)) onSelectionChange(new Set([entry.path]));
    const paths = selected.has(entry.path) ? [...selected] : [entry.path];
    setCtxMenu({ x: e.clientX, y: e.clientY, paths, entry });
  }

  function buildMenuItems(ctx: CtxMenu): ContextMenuItem[] {
    const single = ctx.paths.length === 1;
    return [
      {
        label: "Reveal in Finder",
        icon: <ExternalLink size={12} strokeWidth={2} />,
        disabled: !single,
        onClick: () => { void revealInFinder(ctx.entry.path); },
      },
      { label: "---", onClick: () => undefined },
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
        onClick: () => { setRenamingPath(ctx.paths[0] ?? null); },
      },
      { label: "---", onClick: () => undefined },
      {
        label: "Upload to remote",
        icon: <span className="font-mono text-[10px]">↑</span>,
        disabled: ctx.paths.every((p) => {
          const en = tab.entries.find((e) => e.path === p);
          return en?.kind === "directory";
        }),
        onClick: () => {
          const filePaths = ctx.paths.filter((p) => {
            const en = tab.entries.find((e) => e.path === p);
            return en?.kind !== "directory";
          });
          if (filePaths.length > 0) onTransferToRemote(filePaths);
        },
      },
      { label: "---", onClick: () => undefined },
      {
        label: ctx.paths.length > 1 ? `Delete ${ctx.paths.length.toString()} items` : "Delete",
        icon: <Trash2 size={13} strokeWidth={2} />,
        danger: true,
        onClick: () => {
          setPendingDelete(ctx.paths);
          setShowDeleteConfirm(true);
        },
      },
    ];
  }

  async function commitDelete(paths: string[]) {
    for (const p of paths) {
      await deleteLocalPath(p).catch(() => undefined);
    }
    onSelectionChange(new Set());
    onReload();
  }

  async function handleRename(oldPath: string, newName: string) {
    if (!newName) return;
    setRenameError(null);
    try {
      await renameLocalPath(oldPath, newName);
      onReload();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    }
  }

  // Drag-and-drop.
  const [isDropTarget, setIsDropTarget] = useState(false);
  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(HARBOR_REMOTE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDropTarget(true);
    }
  }
  function handleDragLeave() { setIsDropTarget(false); }
  function handleDrop(e: React.DragEvent) {
    setIsDropTarget(false);
    const raw = e.dataTransfer.getData(HARBOR_REMOTE_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      const paths: unknown = JSON.parse(raw);
      if (Array.isArray(paths))
        onReceiveRemoteDrop(paths.filter((p): p is string => typeof p === "string"));
    } catch { /* ignore */ }
  }

  const folders = tab.entries.filter((e) => e.kind === "directory").length;
  const files = tab.entries.filter((e) => e.kind !== "directory").length;
  const totalSize = tab.entries.reduce((acc, e) => acc + (e.size ?? 0), 0);

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
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border-raised bg-surface-toolbar px-3.5">
        <span
          className="flex-shrink-0 rounded-[5px] px-[7px] py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[1px]"
          style={{ background: "rgba(130,90,30,0.10)", color: "#8a6020" }}
        >
          LOCAL
        </span>

        {/* History navigation */}
        <button onClick={onGoBack} disabled={!canGoBack} title="Back"
          className="text-text-faint transition-colors hover:text-text-secondary disabled:opacity-30">
          <ArrowLeft size={13} strokeWidth={2} />
        </button>
        <button onClick={onGoForward} disabled={!canGoForward} title="Forward"
          className="text-text-faint transition-colors hover:text-text-secondary disabled:opacity-30">
          <ArrowRight size={13} strokeWidth={2} />
        </button>

        {/* Path bar — click anywhere to edit (matches remote behaviour) */}
        {editingPath ? (
          <form onSubmit={commitPath} className="flex flex-1 items-center gap-2">
            <input
              ref={pathInputRef}
              type="text"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); }}
              onBlur={() => { setEditingPath(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setEditingPath(false); }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 bg-transparent font-mono text-[12px] text-text-primary outline-none"
            />
          </form>
        ) : (
          <LocalBreadcrumb
            path={tab.path}
            onNavigate={onNavigate}
            onEdit={() => { setPathInput(tab.path); setEditingPath(true); }}
          />
        )}

        <div className="flex-1" />

        {/* Inline search */}
        <div className="flex h-7 items-center gap-1.5 rounded-input border border-border-input bg-surface-pane px-2">
          <Search size={11} strokeWidth={2} className="text-text-faint" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSearch(""); (e.target as HTMLInputElement).blur(); }
            }}
            placeholder="Filter…"
            className="w-[100px] bg-transparent text-[11.5px] text-text-primary outline-none placeholder:text-text-faint"
          />
          {search && (
            <button onClick={() => { setSearch(""); }} title="Clear filter"
              className="flex h-4 w-4 items-center justify-center text-text-faint hover:text-text-secondary">
              <X size={10} strokeWidth={2.4} />
            </button>
          )}
        </div>

        <button onClick={onReload} title="Reload (⌘R)"
          className="text-text-faint transition-colors hover:text-text-secondary">
          <RefreshCw size={13} strokeWidth={2} />
        </button>
      </div>

      {/* Column headers */}
      <div
        className="grid flex-none select-none items-center gap-3 border-b border-border-raised bg-surface-colheader px-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.5px] text-text-tertiary"
        style={{ height: "28px", gridTemplateColumns: gridCols }}
      >
        <span />
        <SortHeader col="name" label="Name" active={sortCol} dir={sortDir} onClick={toggleSort} />
        {!compact && <SortHeader col="type" label="Type" active={sortCol} dir={sortDir} onClick={toggleSort} />}
        <SortHeader col="size" label="Size" active={sortCol} dir={sortDir} onClick={toggleSort} align="right" />
        <SortHeader col="modified" label="Modified" active={sortCol} dir={sortDir} onClick={toggleSort} />
      </div>

      {/* Content */}
      <div
        className="min-h-0 flex-1 overflow-auto"
        onClick={() => { onSelectionChange(new Set()); }}
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
              <button onClick={onReload} className="mt-3 text-[12px] text-accent-dark hover:underline">
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
                <button onClick={() => { setRenameError(null); }}
                  className="text-[11px] text-danger/60 hover:text-danger">✕</button>
              </div>
            )}

            {/* ".." parent row */}
            {tab.path && tab.path !== "/" && (
              <div
                onDoubleClick={goUp}
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
              </div>
            )}

            {visibleEntries.map((entry, idx) => (
              <LocalRow
                key={entry.path}
                entry={entry}
                isSelected={selected.has(entry.path)}
                isRenaming={renamingPath === entry.path}
                compact={compact}
                gridCols={gridCols}
                onClick={(e) => { handleRowClick(e, entry, idx); }}
                onDoubleClick={() => { handleRowDoubleClick(entry); }}
                onContextMenu={(e) => { handleRowContextMenu(e, entry); }}
                onRenameCommit={(oldPath, newName) => {
                  setRenamingPath(null);
                  if (newName) void handleRename(oldPath, newName);
                }}
                onDragStart={(e) => {
                  const paths = selected.has(entry.path) ? Array.from(selected) : [entry.path];
                  e.dataTransfer.setData(HARBOR_LOCAL_MIME, JSON.stringify(paths));
                  e.dataTransfer.effectAllowed = "copy";
                }}
              />
            ))}

            {tab.entries.length === 0 && !search && (
              <div className="flex h-20 items-center justify-center text-[13px] text-text-faint">
                Empty directory
              </div>
            )}

            {tab.entries.length > 0 && visibleEntries.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-text-faint">
                <span>No matches for &ldquo;{search}&rdquo;</span>
                <button onClick={() => { setSearch(""); }}
                  className="text-[11.5px] text-accent-dark hover:underline">
                  Clear filter
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildMenuItems(ctxMenu)}
          onClose={closeCtxMenu}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.length.toString()} item${pendingDelete.length !== 1 ? "s" : ""}?`}
          message="This permanently deletes from your local disk and cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            void commitDelete(pendingDelete);
            setPendingDelete([]);
          }}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setPendingDelete([]);
          }}
        />
      )}

      {/* Footer */}
      {tab.status === "ready" && (
        <div className="flex h-8 flex-none items-center justify-between border-t border-border-raised bg-surface-colheader px-3.5">
          <span className="font-mono text-[10.5px] text-text-tertiary">
            {folders} folder{folders !== 1 ? "s" : ""}, {files} file{files !== 1 ? "s" : ""}
            {totalSize > 0 ? `  |  ${formatSize(totalSize)}` : ""}
            {search && visibleEntries.length !== tab.entries.length
              ? `  |  ${visibleEntries.length.toString()} shown`
              : ""}
          </span>
          {selected.size > 0 && (
            <button
              onClick={() => { onTransferToRemote([...selected]); }}
              className="rounded-[6px] px-2.5 py-[3px] text-[11px] font-semibold text-white transition-colors"
              style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
            >
              Upload →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function LocalBreadcrumb({
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
      title="Click to type a path  (⌘L)"
      className="group flex min-w-0 flex-1 cursor-text items-center gap-[5px] font-mono text-[12px]"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onNavigate("/"); }}
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
              onClick={(e) => { e.stopPropagation(); onNavigate(segPath); }}
              className={`truncate transition-colors hover:text-text-primary ${
                isLast ? "text-text-primary" : "text-text-secondary"
              }`}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}

// ── Sort column header ────────────────────────────────────────────────────────

function SortHeader({
  col,
  label,
  active,
  dir,
  onClick,
  align,
}: {
  col: SortCol;
  label: string;
  active: SortCol;
  dir: SortDir;
  onClick: (c: SortCol) => void;
  align?: "right";
}) {
  const isActive = col === active;
  return (
    <button
      onClick={() => { onClick(col); }}
      className={`flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.5px] transition-colors hover:text-text-secondary ${
        isActive ? "text-accent-dark" : "text-text-tertiary"
      } ${align === "right" ? "justify-end" : ""}`}
    >
      {label}
      {isActive && (
        dir === "asc"
          ? <ChevronUp size={9} strokeWidth={2.5} />
          : <ChevronDown size={9} strokeWidth={2.5} />
      )}
    </button>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function LocalRow({
  entry,
  isSelected,
  isRenaming,
  compact,
  gridCols,
  onClick,
  onDoubleClick,
  onContextMenu,
  onRenameCommit,
  onDragStart,
}: {
  entry: LocalFileEntry;
  isSelected: boolean;
  isRenaming: boolean;
  compact: boolean;
  gridCols: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCommit: (oldPath: string, newName: string) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const isDir = entry.kind === "directory";
  const { bg, fg, glyph } = fileIcon(entry.name, entry.kind);
  const typeLabel = fileTypeLabel(entry.name, entry.kind);
  const renameRef = useRef<HTMLInputElement>(null);
  const escapedRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [isRenaming]);

  return (
    <div
      draggable={!isRenaming}
      onDragStart={onDragStart}
      onClick={(e) => { e.stopPropagation(); if (!isRenaming) onClick(e); }}
      onDoubleClick={() => { if (!isRenaming) onDoubleClick(); }}
      onContextMenu={(e) => { if (!isRenaming) onContextMenu(e); }}
      className={`grid select-none items-center gap-3 border-b border-border-subtle px-3.5 transition-colors ${
        isDir && !isRenaming ? "cursor-pointer" : "cursor-default"
      } ${isSelected ? "bg-accent/[0.09]" : "hover:bg-surface-hover"}`}
      style={{ height: "31px", gridTemplateColumns: gridCols }}
    >
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
          defaultValue={entry.name}
          onClick={(e) => { e.stopPropagation(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRenameCommit(entry.path, (e.target as HTMLInputElement).value.trim());
            }
            if (e.key === "Escape") {
              escapedRef.current = true;
              onRenameCommit(entry.path, "");
            }
          }}
          onBlur={(e) => {
            if (!escapedRef.current) {
              const val = e.target.value.trim();
              onRenameCommit(entry.path, val);
            }
            escapedRef.current = false;
          }}
          className="flex-1 rounded border border-accent-dark bg-surface-pane px-1 font-mono text-[12.5px] text-text-primary outline-none"
          style={{ height: "22px" }}
        />
      ) : (
        <span className={`truncate text-[12.5px] text-text-primary ${isDir ? "font-semibold" : ""}`}>
          {entry.name}
        </span>
      )}

      {!compact && (
        <span className="truncate font-mono text-[11px] text-text-tertiary">{typeLabel}</span>
      )}
      <span className="text-right font-mono text-[11.5px] text-text-tertiary">
        {isDir ? "—" : formatSize(entry.size)}
      </span>
      <span className="font-mono text-[11.5px] text-text-tertiary">
        {formatDate(entry.modified)}
      </span>
    </div>
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
    month: "short", day: "numeric", year: "numeric",
  });
}
