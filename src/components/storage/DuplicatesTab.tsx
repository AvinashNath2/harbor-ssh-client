import { ChevronDown, ChevronRight, Copy, Loader2, Search } from "lucide-react";
import { useState } from "react";
import type { DuplicateGroup } from "../../api";
import { formatBytes } from "../../utils/storageHealth";

interface DuplicatesTabProps {
  duplicates: DuplicateGroup[];
  loading: boolean;
  onScan: (root: string, minSizeBytes: number, maxDepth: number) => void;
  onBrowse?: (path: string) => void;
}

export function DuplicatesTab({ duplicates, loading, onScan, onBrowse }: DuplicatesTabProps) {
  const [root, setRoot] = useState("/home");
  const [minMb, setMinMb] = useState(10);
  const [maxDepth, setMaxDepth] = useState(5);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const totalRecoverable = duplicates.reduce((s, g) => s + g.size_bytes * (g.files.length - 1), 0);

  const toggleGroup = (hash: string) => {
    setExpanded((e) => ({ ...e, [hash]: !e[hash] }));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Search form */}
      <div className="rounded-xl border border-border bg-surface-pane p-5">
        <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-widest text-text-faint">
          Duplicate Scanner
        </h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-40">
            <label className="mb-1.5 block text-[11px] font-medium text-text-faint">
              Root folder
            </label>
            <input
              type="text"
              value={root}
              onChange={(e) => {
                setRoot(e.target.value);
              }}
              className="w-full rounded-lg border border-border-input bg-surface-chip px-3 py-2 font-mono text-[12.5px] text-text-primary outline-none focus:border-[#3f7be0]"
              placeholder="/home"
            />
          </div>

          <div className="w-36">
            <label className="mb-1.5 block text-[11px] font-medium text-text-faint">
              Min file size
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={minMb}
                min={1}
                max={1000}
                onChange={(e) => {
                  setMinMb(Math.max(1, Number(e.target.value)));
                }}
                className="w-full rounded-lg border border-border-input bg-surface-chip px-3 py-2 text-[12.5px] text-text-primary outline-none focus:border-[#3f7be0]"
              />
              <span className="text-[12px] text-text-faint">MB</span>
            </div>
          </div>

          <div className="w-28">
            <label className="mb-1.5 block text-[11px] font-medium text-text-faint">
              Max depth
            </label>
            <input
              type="number"
              value={maxDepth}
              min={1}
              max={10}
              onChange={(e) => {
                setMaxDepth(Math.max(1, Math.min(10, Number(e.target.value))));
              }}
              className="w-full rounded-lg border border-border-input bg-surface-chip px-3 py-2 text-[12.5px] text-text-primary outline-none focus:border-[#3f7be0]"
            />
          </div>

          <button
            onClick={() => {
              onScan(root, minMb * 1_048_576, maxDepth);
            }}
            disabled={loading || !root.trim()}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#3f7be0,#2f6bdb)" }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            Find Duplicates
          </button>
        </div>

        <p className="mt-3 text-[11px] text-text-faint">
          Groups files by exact byte size — no file content is read, so this is safe to run on
          production servers. Results are labeled as possible duplicates; verify before deleting.
        </p>
      </div>

      {/* Results */}
      {loading && (
        <div className="flex items-center gap-2 py-10 text-center justify-center text-[12px] text-text-faint">
          <Loader2 size={14} className="animate-spin" />
          Scanning file metadata — reads sizes only, no file content…
        </div>
      )}

      {!loading && duplicates.length === 0 && (
        <div className="py-16 text-center">
          <Copy size={32} className="mx-auto mb-3 text-text-faint opacity-30" />
          <p className="text-[13px] text-text-secondary">No duplicates found</p>
          <p className="mt-1 text-[11.5px] text-text-faint">
            Try widening the root folder or reducing the minimum file size
          </p>
        </div>
      )}

      {!loading && duplicates.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[13px] font-semibold text-text-primary">
                {duplicates.length} possible duplicate group{duplicates.length !== 1 ? "s" : ""}
              </span>
              <span className="ml-2 text-[12px] text-text-faint">
                (same file size) — ~{formatBytes(totalRecoverable)} potentially recoverable
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            {duplicates.map((group, idx) => {
              const isOpen = expanded[group.hash] ?? false;
              const recoverable = group.size_bytes * (group.files.length - 1);
              return (
                <div key={group.hash} className="border-b" style={{ borderColor: "#e5e2db" }}>
                  {/* Group header */}
                  <button
                    onClick={() => {
                      toggleGroup(group.hash);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-chip"
                  >
                    <span className="w-6 flex-shrink-0 text-center text-[11px] font-semibold text-text-faint">
                      {idx + 1}
                    </span>
                    {isOpen ? (
                      <ChevronDown size={13} className="flex-shrink-0 text-text-faint" />
                    ) : (
                      <ChevronRight size={13} className="flex-shrink-0 text-text-faint" />
                    )}
                    <span className="flex-1 font-mono text-[11.5px] text-text-secondary truncate">
                      {group.files[0]?.path ?? ""}
                      {group.files.length > 1 && (
                        <span className="ml-1.5 text-text-faint">
                          +{group.files.length - 1} more
                        </span>
                      )}
                    </span>
                    <span className="ml-auto flex-shrink-0 text-right">
                      <span className="block text-[12.5px] font-semibold text-text-primary">
                        {formatBytes(group.size_bytes)} × {group.files.length}
                      </span>
                      <span className="block text-[10.5px] text-text-accent">
                        ~{formatBytes(recoverable)} recoverable
                      </span>
                    </span>
                  </button>

                  {/* Expanded file list */}
                  {isOpen && (
                    <div className="border-t bg-surface" style={{ borderColor: "#e5e2db" }}>
                      {group.files.map((file, fi) => (
                        <div
                          key={file.path}
                          className="flex items-center gap-3 border-b px-4 py-2.5 text-[11.5px]"
                          style={{ borderColor: "#e5e2db" }}
                        >
                          <span className="w-5 flex-shrink-0 text-center text-[10px] text-text-faint">
                            {fi + 1}
                          </span>
                          <span className="flex-1 truncate font-mono text-text-secondary">
                            {file.path}
                          </span>
                          <span className="flex-shrink-0 tabular-nums text-text-faint">
                            {formatBytes(file.size_bytes)}
                          </span>
                          {file.modified && (
                            <span className="w-28 flex-shrink-0 text-right tabular-nums text-text-faint">
                              {new Date(file.modified * 1000).toLocaleDateString()}
                            </span>
                          )}
                          {onBrowse && (
                            <button
                              onClick={() => {
                                onBrowse(file.path.replace(/\/[^/]+$/, "") || "/");
                              }}
                              className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-text-accent hover:bg-[rgba(47,107,219,0.10)]"
                            >
                              Browse
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
