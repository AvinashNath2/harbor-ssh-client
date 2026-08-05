import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { useState, useMemo } from "react";
import type { LargestFile } from "../../api";
import { formatBytes } from "../../utils/storageHealth";

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
}

export function LargestItemsTable({
  files,
  folders,
  loading,
  onBrowse,
  onRefresh,
  root,
}: LargestItemsTableProps) {
  const [kind, setKind] = useState<Kind>("files");
  const [sortKey, setSortKey] = useState<SortKey>("size_bytes");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const data = kind === "files" ? files : folders;

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

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === "desc" ? (
      <ArrowDown size={10} className="inline ml-1 opacity-60" />
    ) : (
      <ArrowUp size={10} className="inline ml-1 opacity-60" />
    );
  }

  const hasData = data.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Controls row */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-border-input overflow-hidden">
          {(["files", "folders"] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
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
                <th className="w-10 px-3 py-2.5 text-center text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                  #
                </th>
                <th
                  className="cursor-pointer px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint hover:text-text-primary"
                  onClick={() => {
                    toggleSort("path");
                  }}
                >
                  Path <SortIcon col="path" />
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

                return (
                  <tr
                    key={item.path}
                    className="border-b transition-colors hover:bg-surface-chip"
                    style={{ borderColor: "#e5e2db" }}
                  >
                    <td className="px-3 py-2 text-center text-[11px] font-medium text-text-faint">
                      {idx + 1}
                    </td>
                    <td className="max-w-0 px-4 py-2">
                      <span
                        className="block truncate font-mono text-[11.5px] text-text-primary"
                        title={item.path}
                      >
                        {item.path}
                      </span>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
