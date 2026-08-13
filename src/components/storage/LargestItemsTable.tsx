import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { LargestFile } from "../../api";
import { formatBytes } from "../../utils/storageHealth";
import { DeleteConfirmDialog, type DeleteConfirmItem } from "./DeleteConfirmDialog";

/** Extract the trailing filename / folder name from a POSIX path. */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || "/";
}

type SortKey = "path" | "size_bytes" | "modified";
type SortDir = "asc" | "desc";
type Kind = "files" | "folders";

interface LargestItemsTableProps {
  files: LargestFile[];
  folders: LargestFile[];
  loading: boolean;
  onBrowse?: (path: string) => void;
  onRefresh: (root: string) => void;
  root: string;
  /** Optional destructive action — when provided, each row shows a red Trash
   *  button AND rows become selectable for bulk deletion. The `useSudo` flag
   *  is set by the dialog when the user opts to elevate a specific item. */
  onDelete?: (path: string, kind: "file" | "folder", useSudo: boolean) => Promise<void>;
}

export function LargestItemsTable({
  files,
  folders,
  loading,
  onBrowse,
  onRefresh,
  root,
  onDelete,
}: LargestItemsTableProps) {
  const [kind, setKind] = useState<Kind>("files");
  const [sortKey, setSortKey] = useState<SortKey>("size_bytes");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  /** Paths currently selected via checkbox. Cleared when the user switches
   *  between the Files and Folders tabs (they show different data). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** When set, the delete dialog is open. `pendingBatch` carries the exact
   *  items and their kind (files vs folders) at the moment the user clicked
   *  Delete — so switching tabs while the dialog is up can't corrupt what's
   *  about to be deleted. */
  const [pendingBatch, setPendingBatch] = useState<DeleteConfirmItem[] | null>(null);

  function copyPath(path: string) {
    void navigator.clipboard.writeText(path);
    setCopiedPath(path);
    window.setTimeout(() => {
      setCopiedPath((cur) => (cur === path ? null : cur));
    }, 2500);
  }

  const data = kind === "files" ? files : folders;
  const rowKind: "file" | "folder" = kind === "files" ? "file" : "folder";

  const sorted = useMemo(() => {
    const copy = [...data];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "size_bytes") cmp = a.size_bytes - b.size_bytes;
      else if (sortKey === "path") cmp = a.path.localeCompare(b.path);
      else cmp = (a.modified ?? 0) - (b.modified ?? 0);
      return sortDir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function toggleSelected(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.path));
  const someVisibleSelected = sorted.some((r) => selected.has(r.path));

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        // Deselect every visible row; keep any selections outside current view (there aren't any today, but future-proof)
        const next = new Set(prev);
        for (const r of sorted) next.delete(r.path);
        return next;
      }
      const next = new Set(prev);
      for (const r of sorted) next.add(r.path);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function switchKind(k: Kind) {
    setKind(k);
    // Selection is per-view: switching tabs shows different data, so any
    // selection would be meaningless in the new list.
    clearSelection();
  }

  function openBulkDelete() {
    const items: DeleteConfirmItem[] = sorted
      .filter((r) => selected.has(r.path))
      .map((r) => ({ path: r.path, sizeBytes: r.size_bytes, kind: rowKind }));
    if (items.length === 0) return;
    setPendingBatch(items);
  }

  function openSingleDelete(item: LargestFile) {
    setPendingBatch([{ path: item.path, sizeBytes: item.size_bytes, kind: rowKind }]);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === "desc" ? (
      <ArrowDown size={10} className="inline ml-1 opacity-60" />
    ) : (
      <ArrowUp size={10} className="inline ml-1 opacity-60" />
    );
  }

  const hasData = data.length > 0;
  const selectedCount = selected.size;
  const selectedTotalBytes = sorted
    .filter((r) => selected.has(r.path))
    .reduce((s, r) => s + r.size_bytes, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Controls row */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-border-input overflow-hidden">
          {(["files", "folders"] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                switchKind(k);
              }}
              className={`px-4 py-1.5 text-[12px] font-medium transition-colors capitalize ${
                kind === k
                  ? "bg-[rgba(47,107,219,0.10)] text-text-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <span className="text-[11.5px] text-text-faint">
          {hasData ? `${String(sorted.length)} items` : "no data yet"}
        </span>

        <div className="flex-1" />

        <button
          onClick={() => {
            onRefresh(root);
          }}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border-input px-3 py-1.5 text-[12px] font-medium text-text-secondary hover:bg-surface-chip hover:text-text-primary disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Bulk-selection action bar — appears only when at least one row is picked */}
      {onDelete && selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2">
          <span className="text-[12px] font-medium text-accent-dark">
            {selectedCount} selected
          </span>
          <span className="text-[11.5px] text-text-tertiary">
            · {formatBytes(selectedTotalBytes)} total
          </span>
          <div className="flex-1" />
          <button
            onClick={clearSelection}
            className="rounded-md border border-border-input bg-surface-pane px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            Clear
          </button>
          <button
            onClick={openBulkDelete}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 text-[11.5px] font-semibold text-white transition-colors hover:bg-red-700"
          >
            <Trash2 size={11} strokeWidth={2.2} />
            Delete selected
          </button>
        </div>
      )}

      {/* Empty / loading state */}
      {!hasData && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          {loading ? (
            <p className="text-[13px] text-text-faint">Scanning…</p>
          ) : (
            <>
              <p className="text-[13px] text-text-secondary">No data yet</p>
              <p className="text-[11.5px] text-text-faint">
                Click <span className="font-semibold text-text-accent">Refresh</span> to scan
              </p>
            </>
          )}
        </div>
      )}

      {/* Table */}
      {hasData && (
        <div className="overflow-hidden rounded-xl border border-border-raised">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr
                className="border-b text-left"
                style={{ borderColor: "#dedad3", background: "#ece9e3" }}
              >
                {onDelete && (
                  <th className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={toggleSelectAll}
                      title={allVisibleSelected ? "Deselect all" : "Select all"}
                      className="h-3.5 w-3.5 cursor-pointer accent-red-600"
                    />
                  </th>
                )}
                <th className="w-10 px-3 py-2.5 text-center text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                  #
                </th>
                <th
                  className="cursor-pointer px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint hover:text-text-primary"
                  onClick={() => {
                    toggleSort("path");
                  }}
                >
                  Name <SortIcon col="path" />
                </th>
                <th
                  className="cursor-pointer px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-widest text-text-faint hover:text-text-primary"
                  onClick={() => {
                    toggleSort("size_bytes");
                  }}
                >
                  Size <SortIcon col="size_bytes" />
                </th>
                {kind === "files" && (
                  <th
                    className="cursor-pointer px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-widest text-text-faint hover:text-text-primary"
                    onClick={() => {
                      toggleSort("modified");
                    }}
                  >
                    Modified <SortIcon col="modified" />
                  </th>
                )}
                <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, idx) => {
                const dir =
                  kind === "folders"
                    ? item.path
                    : item.path.split("/").slice(0, -1).join("/") || "/";
                const isSelected = selected.has(item.path);

                return (
                  <tr
                    key={item.path}
                    className={`border-b transition-colors ${
                      isSelected ? "bg-red-50/40" : "hover:bg-surface-chip"
                    }`}
                    style={{ borderColor: "#e5e2db" }}
                  >
                    {onDelete && (
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            toggleSelected(item.path);
                          }}
                          className="h-3.5 w-3.5 cursor-pointer accent-red-600"
                          aria-label={`Select ${basename(item.path)}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 text-center text-[11px] font-medium text-text-faint">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-[11.5px] font-medium text-text-primary"
                          title={item.path}
                        >
                          {basename(item.path)}
                        </span>
                        <button
                          onClick={() => {
                            copyPath(item.path);
                          }}
                          className={`flex flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors ${
                            copiedPath === item.path
                              ? "bg-success/10 text-[#177a4c]"
                              : "text-text-faint hover:bg-surface-chip hover:text-text-primary"
                          }`}
                          title="Copy full path to clipboard"
                        >
                          {copiedPath === item.path ? (
                            <>
                              <Check size={10} strokeWidth={2.2} />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy size={10} strokeWidth={2} />
                              Copy path
                            </>
                          )}
                        </button>
                      </div>
                      {copiedPath === item.path && (
                        <div className="mt-1 break-all font-mono text-[10.5px] text-text-tertiary">
                          {item.path}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                      {formatBytes(item.size_bytes)}
                    </td>
                    {kind === "files" && (
                      <td className="px-4 py-2 text-right text-[11px] text-text-faint">
                        {item.modified ? new Date(item.modified * 1000).toLocaleDateString() : "—"}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        {onBrowse && (
                          <button
                            onClick={() => {
                              onBrowse(dir);
                            }}
                            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-accent"
                            title={`Browse ${dir}`}
                          >
                            <ExternalLink size={10} />
                            Browse
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => {
                              openSingleDelete(item);
                            }}
                            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-red-500/80 transition-colors hover:bg-red-50 hover:text-red-600"
                            title={`Delete this ${rowKind}`}
                          >
                            <Trash2 size={10} strokeWidth={2.1} />
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingBatch && onDelete && (
        <DeleteConfirmDialog
          items={pendingBatch}
          onCancel={() => {
            setPendingBatch(null);
          }}
          onDelete={async (item, useSudo) => {
            await onDelete(item.path, item.kind, useSudo);
          }}
          onFinished={(result) => {
            // Any successfully-deleted paths drop out of selection automatically
            // via the hook's optimistic filter. Clear the leftover selection
            // (only the failed paths would remain).
            if (result.deleted > 0) {
              setSelected((prev) => {
                const next = new Set(prev);
                for (const it of pendingBatch) {
                  const stillPresentAsFailure = result.failed.some((f) => f.path === it.path);
                  if (!stillPresentAsFailure) next.delete(it.path);
                }
                return next;
              });
            }
          }}
        />
      )}
    </div>
  );
}
