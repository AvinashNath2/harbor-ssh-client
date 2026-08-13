import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes } from "../../utils/storageHealth";

/**
 * Two-step destructive-confirmation modal used by the Largest Items table.
 *
 * Step 1 asks "delete this file?" with the item's details.
 * Step 2 asks "are you absolutely sure? this is permanent."
 *
 * Both steps require an explicit click on a red-tinted button — the user
 * cannot delete by accident from a single misclick. Any keyboard Enter/Space
 * on the modal backdrop is a no-op; the danger action must be clicked.
 */

interface DeleteConfirmDialogProps {
  path: string;
  sizeBytes: number;
  kind: "file" | "folder";
  onCancel: () => void;
  /** Resolves on successful delete. Reject to keep the dialog open and show
   *  the error message in the footer. */
  onConfirm: () => Promise<void>;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || "/";
}

export function DeleteConfirmDialog({
  path,
  sizeBytes,
  kind,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = basename(path);

  // Esc closes only while not busy. Deliberately does NOT accept Enter as
  // confirm — that would defeat the double-click safety.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  async function handleFinalConfirm() {
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
      // Parent unmounts us on success — no local cleanup needed.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div
        className="w-[440px] max-w-[90vw] overflow-hidden rounded-2xl border border-border-raised bg-surface-pane shadow-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border-subtle bg-red-50/60 px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle size={18} strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="delete-confirm-title"
              className="text-[14px] font-semibold text-text-primary"
            >
              {step === 1 ? `Delete this ${kind}?` : "Are you absolutely sure?"}
            </h3>
            <p className="text-[11.5px] text-text-tertiary">
              {step === 1
                ? "You'll be asked to confirm once more before it's deleted."
                : "This action is permanent and cannot be undone."}
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-chip hover:text-text-primary disabled:opacity-40"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-chip/40 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] font-medium text-text-primary" title={name}>
                {name}
              </span>
              <span className="flex-shrink-0 tabular-nums text-[11.5px] text-text-tertiary">
                {formatBytes(sizeBytes)}
              </span>
            </div>
            <div className="break-all font-mono text-[10.5px] text-text-tertiary">{path}</div>
          </div>

          {step === 2 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-900">
              This will run <code className="rounded bg-red-100 px-1 font-mono text-[11px]">rm</code>{" "}
              on the remote server. The {kind} <span className="font-semibold">cannot be recovered</span>{" "}
              from HarborSCP.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[11.5px] font-medium text-red-800">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-surface-chip/30 px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border-input bg-surface-pane px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
          >
            Cancel
          </button>
          {step === 1 ? (
            <button
              onClick={() => {
                setStep(2);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-red-700"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => void handleFinalConfirm()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 size={12} strokeWidth={2.2} />
                  Delete permanently
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
