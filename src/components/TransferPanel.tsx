import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { Transfer } from "../hooks/useTransferQueue";

interface TransferPanelProps {
  transfers: Transfer[];
  onCancel: (id: string) => void;
  onClearCompleted: () => void;
}

export function TransferPanel({ transfers, onCancel, onClearCompleted }: TransferPanelProps) {
  const active = transfers.filter((t) => t.status === "active" || t.status === "pending");
  const done = transfers.filter(
    (t) => t.status === "done" || t.status === "error" || t.status === "cancelled",
  );

  const hasCompleted = done.length > 0;

  return (
    <div className="flex min-h-0 flex-col border-t border-border-raised bg-surface-pane">
      {/* Header */}
      <div className="flex h-9 flex-none items-center justify-between border-b border-border-raised bg-surface-toolbar px-3.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.5px] text-text-tertiary">
            Transfers
          </span>
          {active.length > 0 && (
            <span
              className="rounded-full px-[7px] py-[1px] font-mono text-[10px] font-semibold text-white"
              style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
            >
              {active.length}
            </span>
          )}
        </div>
        {hasCompleted && (
          <button
            onClick={onClearCompleted}
            className="text-[11px] text-text-tertiary transition-colors hover:text-text-secondary"
          >
            Clear completed
          </button>
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-auto">
        {transfers.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12.5px] text-text-faint">
            No transfers
          </div>
        )}
        {transfers.map((t) => (
          <TransferRow key={t.id} transfer={t} onCancel={onCancel} />
        ))}
      </div>
    </div>
  );
}

function TransferRow({
  transfer: t,
  onCancel,
}: {
  transfer: Transfer;
  onCancel: (id: string) => void;
}) {
  const pct =
    t.total > 0
      ? Math.min(100, Math.round((t.transferred / t.total) * 100))
      : t.status === "done"
        ? 100
        : 0;

  const statusColor =
    t.status === "done"
      ? "#1f9d63"
      : t.status === "error"
        ? "#e5534b"
        : t.status === "cancelled"
          ? "#8a8578"
          : undefined;

  const statusLabel =
    t.status === "done"
      ? "Done"
      : t.status === "error"
        ? (t.error ?? "Error")
        : t.status === "cancelled"
          ? "Cancelled"
          : t.status === "active"
            ? `${pct.toString()}%`
            : "Queued";

  return (
    <div className="border-b border-border-subtle px-3.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-shrink-0 text-text-faint">
            {t.direction === "upload" ? (
              <ArrowUp size={13} strokeWidth={2} />
            ) : (
              <ArrowDown size={13} strokeWidth={2} />
            )}
          </span>
          <span className="truncate font-mono text-[12px] text-text-primary">{t.name}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className="font-mono text-[11px]"
            style={{ color: statusColor ?? "var(--color-text-tertiary)" }}
          >
            {statusLabel}
          </span>
          {(t.status === "active" || t.status === "pending") && (
            <button
              onClick={() => {
                onCancel(t.id);
              }}
              title="Cancel"
              className="text-text-faint transition-colors hover:text-danger"
            >
              <X size={12} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(t.status === "active" || t.status === "done") && (
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-border-raised">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct.toString()}%`,
              background:
                t.status === "done" ? "#1f9d63" : "linear-gradient(90deg, #3f7be0, #2f6bdb)",
            }}
          />
        </div>
      )}
    </div>
  );
}
