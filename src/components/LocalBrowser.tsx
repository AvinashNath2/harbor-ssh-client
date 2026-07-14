import { ArrowLeft, ArrowRight, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { LocalFileEntry } from "../api";
import { useElementWidth } from "../hooks/useElementWidth";
import type { LocalTab } from "../hooks/useLocalFiles";
import { fileIcon, fileTypeLabel } from "../utils/fileType";

const HARBOR_LOCAL_MIME = "application/x-harbor-local";
const HARBOR_REMOTE_MIME = "application/x-harbor-remote";
const COMPACT_THRESHOLD = 500;
const GRID_WIDE = "16px minmax(0,1fr) 110px 78px 118px";
const GRID_COMPACT = "16px minmax(0,1fr) 70px 110px";

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

  function commitPath(e: React.SyntheticEvent) {
    e.preventDefault();
    const p = pathInput.trim();
    if (p) onNavigate(p);
    setEditingPath(false);
    setPathInput("");
  }

  const folders = tab.entries.filter((e) => e.kind === "directory").length;
  const files = tab.entries.filter((e) => e.kind !== "directory").length;
  const totalSize = tab.entries.reduce((acc, e) => acc + (e.size ?? 0), 0);

  function handleRowClick(e: React.MouseEvent, entry: LocalFileEntry) {
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
  }

  function handleRowDoubleClick(entry: LocalFileEntry) {
    if (entry.kind === "directory") {
      onSelectionChange(new Set());
      onNavigate(entry.path);
    }
  }

  // ".." row navigates to parent
  function goUp() {
    if (!tab.path || tab.path === "/") return;
    const parent = tab.path.replace(/\/[^/]+\/?$/, "") || "/";
    onSelectionChange(new Set());
    onNavigate(parent);
  }

  // Drag-and-drop: accept remote paths dropped here → download to current dir
  const [isDropTarget, setIsDropTarget] = useState(false);
  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(HARBOR_REMOTE_MIME)) {
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
    const raw = e.dataTransfer.getData(HARBOR_REMOTE_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      const paths: unknown = JSON.parse(raw);
      if (Array.isArray(paths)) onReceiveRemoteDrop(paths.filter((p): p is string => typeof p === "string"));
    } catch { /* ignore */ }
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
      <div className="flex h-10 flex-none items-center gap-2 border-b border-border-raised bg-surface-toolbar px-3.5">
        <span
          className="flex-shrink-0 rounded-[5px] px-[7px] py-[3px] font-mono text-[9.5px] font-semibold uppercase tracking-[1px]"
          style={{ background: "rgba(130,90,30,0.10)", color: "#8a6020" }}
        >
          LOCAL
        </span>

        {/* History navigation */}
        <button
          onClick={onGoBack}
          disabled={!canGoBack}
          title="Back"
          className="text-text-faint transition-colors hover:text-text-secondary disabled:opacity-30"
        >
          <ArrowLeft size={13} strokeWidth={2} />
        </button>
        <button
          onClick={onGoForward}
          disabled={!canGoForward}
          title="Forward"
          className="text-text-faint transition-colors hover:text-text-secondary disabled:opacity-30"
        >
          <ArrowRight size={13} strokeWidth={2} />
        </button>

        {/* Breadcrumb / path editor */}
        {editingPath ? (
          <form onSubmit={commitPath} className="flex flex-1 items-center gap-2">
            <input
              autoFocus
              type="text"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); }}
              onBlur={() => { setEditingPath(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setEditingPath(false); }}
              placeholder={tab.path}
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
        <span>Name</span>
        {!compact && <span>Type</span>}
        <span className="text-right">Size</span>
        <span>Modified</span>
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
              <button onClick={onReload} className="mt-3 text-[12px] text-accent-dark hover:underline">
                Try again
              </button>
            </div>
          </div>
        )}

        {tab.status === "ready" && (
          <>
            {/* ".." parent row */}
            {tab.path && tab.path !== "/" && (
              <div
                onDoubleClick={goUp}
                className="grid cursor-pointer select-none items-center gap-3 border-b border-border-subtle px-3.5 transition-colors hover:bg-surface-hover"
                style={{ height: "31px", gridTemplateColumns: gridCols }}
              >
                <div
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] font-mono text-[7px] font-semibold"
                  style={{ background: "#e0a53c", border: "1px solid #c8922a", color: "transparent" }}
                />
                <span className="truncate font-semibold text-[12.5px] text-text-secondary">..</span>
                {!compact && <span className="font-mono text-[11.5px] text-text-faint">Folder</span>}
                <span className="text-right font-mono text-[11.5px] text-text-tertiary">—</span>
                <span className="font-mono text-[11.5px] text-text-tertiary" />
              </div>
            )}

            {tab.entries.map((entry) => (
              <LocalRow
                key={entry.path}
                entry={entry}
                isSelected={selected.has(entry.path)}
                compact={compact}
                gridCols={gridCols}
                onClick={handleRowClick}
                onDoubleClick={handleRowDoubleClick}
                onDragStart={(e) => {
                  const paths = selected.has(entry.path)
                    ? Array.from(selected)
                    : [entry.path];
                  e.dataTransfer.setData(HARBOR_LOCAL_MIME, JSON.stringify(paths));
                  e.dataTransfer.effectAllowed = "copy";
                }}
              />
            ))}

            {tab.entries.length === 0 && (
              <div className="flex h-20 items-center justify-center text-[13px] text-text-faint">
                Empty directory
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {tab.status === "ready" && (
        <div className="flex h-8 flex-none items-center justify-between border-t border-border-raised bg-surface-colheader px-3.5">
          <span className="font-mono text-[10.5px] text-text-tertiary">
            {folders} folder{folders !== 1 ? "s" : ""}, {files} file{files !== 1 ? "s" : ""}
            {totalSize > 0 ? `  |  ${formatSize(totalSize)}` : ""}
          </span>
          {selected.size > 0 && (
            <button
              onClick={() => {
                onTransferToRemote([...selected]);
              }}
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
      onDoubleClick={onEdit}
      className="group flex min-w-0 flex-1 items-center gap-[5px] font-mono text-[12px]"
      title="Double-click to type path"
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
      <button
        onClick={onEdit}
        title="Edit path"
        className="ml-1 flex-shrink-0 text-text-faint opacity-0 transition-opacity hover:text-accent-dark group-hover:opacity-100"
      >
        <Pencil size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function LocalRow({
  entry,
  isSelected,
  compact,
  gridCols,
  onClick,
  onDoubleClick,
  onDragStart,
}: {
  entry: LocalFileEntry;
  isSelected: boolean;
  compact: boolean;
  gridCols: string;
  onClick: (e: React.MouseEvent, entry: LocalFileEntry) => void;
  onDoubleClick: (entry: LocalFileEntry) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const isDir = entry.kind === "directory";
  const { bg, fg, glyph } = fileIcon(entry.name, entry.kind);
  const typeLabel = fileTypeLabel(entry.name, entry.kind);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e, entry);
      }}
      onDoubleClick={() => {
        onDoubleClick(entry);
      }}
      className={`grid select-none items-center gap-3 border-b border-border-subtle px-3.5 transition-colors ${
        isDir ? "cursor-pointer" : "cursor-default"
      } ${isSelected ? "bg-accent/[0.09]" : "hover:bg-surface-hover"}`}
      style={{ height: "31px", gridTemplateColumns: gridCols }}
    >
      <div
        className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] font-mono text-[7px] font-bold"
        style={{ background: bg, color: fg }}
      >
        {glyph}
      </div>
      <span
        className={`truncate text-[12.5px] text-text-primary ${isDir ? "font-semibold" : ""}`}
      >
        {entry.name}
      </span>
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
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
