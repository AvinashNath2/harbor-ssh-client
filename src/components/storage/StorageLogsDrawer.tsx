import { X } from "lucide-react";
import { useState } from "react";
import type { StorageLogEntry } from "../../hooks/useStorageAnalyzer";

interface StorageLogsDrawerProps {
  logs: StorageLogEntry[];
  onClose: () => void;
}

const LEVEL_COLOR: Record<StorageLogEntry["level"], string> = {
  info: "#6b7280",
  warn: "#f59e0b",
  error: "#ef4444",
};

const LEVEL_BADGE: Record<StorageLogEntry["level"], string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERR ",
};

export function StorageLogsDrawer({ logs, onClose }: StorageLogsDrawerProps) {
  const [filter, setFilter] = useState<"all" | StorageLogEntry["level"]>("all");
  const [sourceFilter, setSourceFilter] = useState("");

  const sources = Array.from(new Set(logs.map((l) => l.source))).sort();

  const visible = logs.filter((l) => {
    if (filter !== "all" && l.level !== filter) return false;
    if (sourceFilter && l.source !== sourceFilter) return false;
    return true;
  });

  return (
    <div
      className="fixed inset-y-0 right-0 z-[60] flex w-[540px] flex-col border-l border-border-raised bg-surface-pane shadow-modal"
      style={{ top: 0 }}
    >
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border-raised px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-primary">Storage Analyzer Logs</span>
          <span className="rounded-full bg-surface-chip px-2 py-0.5 text-[11px] text-text-secondary">
            {logs.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border-raised px-4 py-2">
        {(["all", "info", "warn", "error"] as const).map((lvl) => (
          <button
            key={lvl}
            onClick={() => { setFilter(lvl); }}
            className={`rounded px-2 py-0.5 text-[11.5px] font-medium transition-colors ${
              filter === lvl
                ? "bg-surface-chip text-text-primary"
                : "text-text-faint hover:text-text-secondary"
            }`}
          >
            {lvl === "all" ? "All" : lvl.toUpperCase()}
          </button>
        ))}
        {sources.length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); }}
            className="ml-auto rounded border border-border-input bg-surface px-2 py-0.5 text-[11.5px] text-text-secondary focus:outline-none"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto font-mono">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-text-faint">
            No log entries
          </div>
        ) : (
          [...visible].reverse().map((entry) => (
            <div
              key={entry.id}
              className="border-b border-border-raised px-4 py-2 hover:bg-surface-chip"
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-px flex-shrink-0 text-[10.5px] font-semibold"
                  style={{ color: LEVEL_COLOR[entry.level] }}
                >
                  {LEVEL_BADGE[entry.level]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-text-faint">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                    <span className="rounded bg-surface-chip px-1 py-px text-[10px] text-text-faint">
                      {entry.source}
                    </span>
                  </div>
                  <p className="mt-0.5 break-all text-[11.5px] text-text-primary">
                    {entry.message}
                  </p>
                  {entry.detail && (
                    <p className="mt-0.5 break-all text-[11px] text-text-secondary">
                      {entry.detail}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
