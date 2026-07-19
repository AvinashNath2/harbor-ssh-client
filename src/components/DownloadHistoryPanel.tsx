import { AlertCircle, Download, FolderOpen, Trash2, X } from "lucide-react";
import type { DownloadRecord } from "../api";

function fmtSize(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  records: DownloadRecord[];
  onClose: () => void;
  onReveal: (localPath: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

export function DownloadHistoryPanel({ records, onClose, onReveal, onRemove, onClearAll }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[520px] w-[560px] flex-col rounded-[14px] border border-border-raised bg-surface-pane shadow-xl">
        {/* Header */}
        <div className="flex h-[44px] flex-none items-center justify-between border-b border-border-raised px-4">
          <div className="flex items-center gap-2">
            <Download size={13} strokeWidth={2} className="text-text-faint" />
            <span className="text-[13px] font-semibold text-text-primary">Downloads</span>
            {records.length > 0 && (
              <span className="rounded-full bg-surface-chip px-2 py-0.5 text-[10px] font-medium text-text-tertiary">
                {records.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {records.length > 0 && (
              <button
                onClick={onClearAll}
                className="text-[11px] text-text-tertiary transition-colors hover:text-danger"
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              className="text-text-faint transition-colors hover:text-text-secondary"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-auto">
          {records.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-text-faint">
              <Download size={28} strokeWidth={1.4} />
              <span className="text-[13px]">No downloads yet</span>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {records.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover"
                >
                  {/* File icon */}
                  <div className="flex-shrink-0">
                    {r.available ? (
                      <Download size={15} strokeWidth={1.8} className="text-accent" />
                    ) : (
                      <AlertCircle size={15} strokeWidth={1.8} className="text-danger" />
                    )}
                  </div>

                  {/* Name + meta */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-text-primary">{r.name}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {r.available ? (
                        <span className="truncate font-mono text-[10px] text-text-faint">
                          {r.localPath}
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-danger">
                          File no longer available
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-faint">
                      <span>{fmtDate(r.downloadedAt)}</span>
                      <span>·</span>
                      <span>{fmtSize(r.fileSize)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {r.available && (
                      <button
                        onClick={() => {
                          onReveal(r.localPath);
                        }}
                        title="Show in Finder"
                        className="rounded p-1.5 text-text-faint transition-colors hover:bg-surface-chip hover:text-accent"
                      >
                        <FolderOpen size={13} strokeWidth={1.9} />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onRemove(r.id);
                      }}
                      title="Remove from history"
                      className="rounded p-1.5 text-text-faint transition-colors hover:bg-surface-chip hover:text-danger"
                    >
                      <Trash2 size={13} strokeWidth={1.9} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
