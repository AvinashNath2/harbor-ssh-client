import { AlertTriangle, Loader2, Lock, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { checkWritable } from "../../api";
import { formatBytes } from "../../utils/storageHealth";

/**
 * Two-step destructive-confirmation modal used by the Largest Items table.
 * Handles single-item and bulk delete in one shape, plus a permission
 * preflight and an optional sudo-elevation retry when regular delete fails.
 *
 * Flow:
 *   1. On open, probe writability of each item's parent directory (single
 *      batched SSH exec). While probing, show a subtle "Checking permissions…"
 *      strip in Step 1.
 *   2. If ANY item lacks write access, show an amber warning listing the
 *      privileged items — the user knows before they click Continue that
 *      those specific rows will need sudo.
 *   3. On Step 2, if some items were flagged in the preflight, offer a
 *      "Use sudo for privileged items" toggle. When enabled, each flagged
 *      path routes through `deletePathSudo` instead of the plain SFTP unlink.
 *   4. After the batch completes: successes drop out; failures are listed
 *      with their exact error message. If any failure was permission-denied
 *      and the user did NOT elect sudo, a "Retry failed with sudo" button
 *      appears — one click, no more confirmations, straight to the sudo run.
 */

export interface DeleteConfirmItem {
  path: string;
  sizeBytes: number;
  kind: "file" | "folder";
}

interface DeleteConfirmDialogProps {
  items: DeleteConfirmItem[];
  onCancel: () => void;
  /** Invoked per item. `useSudo` toggles the sudo-escalated backend call. */
  onDelete: (item: DeleteConfirmItem, useSudo: boolean) => Promise<void>;
  /** Called after the batch finishes — parent can update its own selection. */
  onFinished?: (result: { deleted: number; failed: FailedItem[] }) => void;
}

interface FailedItem {
  path: string;
  error: string;
  /** true when the error message hints at a permission problem — used to
   *  decide whether to surface the "Retry with sudo" button. */
  isPermission: boolean;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || "/";
}

/** Rust `AppError` comes back over Tauri as `{ code, message }` — plain object,
 *  not an Error instance. Fall back to Error.message or String(). */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  const s = String(e);
  return s === "[object Object]" ? "Delete failed (no message)" : s;
}

function looksLikePermissionError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("permission denied") ||
    m.includes("operation not permitted") ||
    m.includes("eacces") ||
    m.includes("eperm") ||
    m.includes("read-only")
  );
}

export function DeleteConfirmDialog({
  items,
  onCancel,
  onDelete,
  onFinished,
}: DeleteConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<FailedItem[]>([]);
  const [batchDone, setBatchDone] = useState<{ deleted: number; failed: FailedItem[] } | null>(null);

  /** Paths flagged by the preflight probe as NOT writable by current user.
   *  null while the probe is in-flight; empty set once the probe finishes
   *  and everything is fine. */
  const [needsSudoPaths, setNeedsSudoPaths] = useState<Set<string> | null>(null);
  /** User toggled the "use sudo for privileged items" checkbox on Step 2. */
  const [useSudoForFlagged, setUseSudoForFlagged] = useState(true);
  /** Set after the batch, if we've already tried sudo on this dialog session.
   *  Prevents an infinite "retry with sudo → still fails → retry with sudo"
   *  loop. Once sudo is exhausted, no more retry offered. */
  const sudoAttemptedRef = useRef(false);

  const single = items.length === 1;
  const totalBytes = items.reduce((s, i) => s + i.sizeBytes, 0);
  const kindsInBatch = new Set(items.map((i) => i.kind));
  const batchLabel =
    kindsInBatch.size === 1
      ? kindsInBatch.has("file")
        ? single
          ? "file"
          : "files"
        : single
          ? "folder"
          : "folders"
      : "items";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onCancel]);

  // Preflight — probe writability once, when the dialog opens.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      try {
        const paths = items.map((i) => i.path);
        const results = await checkWritable(paths);
        if (cancelledRef.current) return;
        // Anything the probe returned true for is writable; everything else
        // (false OR missing) is flagged as needing sudo, since a missing
        // result shouldn't happen but is safer to warn about than silently
        // skip.
        const bad = new Set<string>();
        paths.forEach((p, i) => {
          if (!results[i]) bad.add(p);
        });
        setNeedsSudoPaths(bad);
      } catch {
        // If the probe fails (no active connection, timeout), fall back to
        // "everything looks fine" — the actual delete will fail with a real
        // error we can surface then.
        if (!cancelledRef.current) setNeedsSudoPaths(new Set());
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [items]);

  async function runBatch(sudoFallbackOnly: boolean) {
    setBusy(true);
    setProgress(0);
    setFailures([]);
    const failedItems: FailedItem[] = [];
    let deleted = 0;
    const toRun = sudoFallbackOnly
      ? // Retry mode: only run the previously-failed permission items, with sudo.
        (batchDone?.failed ?? []).map((f) => {
          const original = items.find((it) => it.path === f.path);
          return original ?? { path: f.path, sizeBytes: 0, kind: "file" as const };
        })
      : items;

    for (const [i, it] of toRun.entries()) {
      setProgress(i);
      const useSudo = sudoFallbackOnly
        ? true
        : (needsSudoPaths?.has(it.path) ?? false) && useSudoForFlagged;
      try {
        await onDelete(it, useSudo);
        deleted++;
      } catch (e) {
        const msg = extractErrorMessage(e);
        failedItems.push({ path: it.path, error: msg, isPermission: looksLikePermissionError(msg) });
      }
    }
    setProgress(toRun.length);
    setBusy(false);
    setFailures(failedItems);
    if (sudoFallbackOnly) sudoAttemptedRef.current = true;
    const result = { deleted, failed: failedItems };
    setBatchDone(result);
    onFinished?.(result);
    if (failedItems.length === 0) {
      window.setTimeout(onCancel, 600);
    }
  }

  const totalCount = items.length;
  const flaggedCount = needsSudoPaths ? needsSudoPaths.size : 0;
  const hasPermissionFailures = batchDone?.failed.some((f) => f.isPermission) ?? false;
  const showSudoRetry = hasPermissionFailures && !sudoAttemptedRef.current;

  const headerTitle = batchDone
    ? failures.length === 0
      ? "Deleted"
      : `Deleted ${String(batchDone.deleted)} of ${String(totalCount)}`
    : step === 1
      ? single
        ? `Delete this ${items[0]?.kind ?? "item"}?`
        : `Delete ${String(totalCount)} ${batchLabel}?`
      : "Are you absolutely sure?";

  const headerSub = batchDone
    ? failures.length === 0
      ? "All items removed from the server."
      : showSudoRetry
        ? "Some items were owned by root — try again with sudo to override."
        : "Some items could not be deleted — see below."
    : step === 1
      ? "You'll be asked to confirm once more before anything is deleted."
      : "This action is permanent and cannot be undone.";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div
        className="w-[500px] max-w-[92vw] overflow-hidden rounded-2xl border border-border-raised bg-surface-pane shadow-modal"
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
            <h3 id="delete-confirm-title" className="text-[14px] font-semibold text-text-primary">
              {headerTitle}
            </h3>
            <p className="text-[11.5px] text-text-tertiary">{headerSub}</p>
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
        <div className="flex max-h-[440px] flex-col gap-3 overflow-y-auto px-5 py-4">
          {/* Item list — single card for one, compact list for many */}
          {!batchDone && single && items[0] && (
            <ItemCard item={items[0]} flagged={needsSudoPaths?.has(items[0].path) ?? false} />
          )}
          {!batchDone && !single && (
            <>
              <div className="flex items-baseline justify-between text-[11.5px] text-text-tertiary">
                <span>
                  <span className="font-semibold text-text-primary">{totalCount}</span> {batchLabel}{" "}
                  selected
                </span>
                <span className="tabular-nums">Total: {formatBytes(totalBytes)}</span>
              </div>
              <div className="max-h-[180px] overflow-y-auto rounded-lg border border-border-subtle bg-surface-chip/40 py-1">
                {items.map((it) => {
                  const flagged = needsSudoPaths?.has(it.path) ?? false;
                  return (
                    <div
                      key={it.path}
                      className="flex items-baseline justify-between gap-3 px-3 py-1"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {flagged && (
                          <Lock size={10} strokeWidth={2.2} className="flex-shrink-0 text-amber-600" />
                        )}
                        <span className="truncate text-[12px] text-text-primary" title={it.path}>
                          {basename(it.path)}
                        </span>
                      </div>
                      <span className="flex-shrink-0 tabular-nums text-[11px] text-text-tertiary">
                        {formatBytes(it.sizeBytes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Preflight status while probing */}
          {!batchDone && needsSudoPaths === null && (
            <div className="flex items-center gap-2 text-[11.5px] text-text-tertiary">
              <Loader2 size={11} className="animate-spin" />
              Checking permissions…
            </div>
          )}

          {/* Preflight warning — some items need sudo */}
          {!batchDone && needsSudoPaths && flaggedCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
              <ShieldAlert
                size={14}
                strokeWidth={2}
                className="mt-0.5 flex-shrink-0 text-amber-700"
              />
              <div className="min-w-0">
                <div className="font-semibold">
                  {flaggedCount === totalCount
                    ? "You don't have permission to delete these"
                    : `${String(flaggedCount)} of ${String(totalCount)} items need elevated permission`}
                </div>
                <div className="mt-0.5 text-[11.5px]">
                  {flaggedCount === totalCount ? (
                    <>
                      The parent directories are owned by another user (usually root). Deleting
                      these will need{" "}
                    </>
                  ) : (
                    <>
                      Items marked{" "}
                      <Lock size={9} className="inline text-amber-700" strokeWidth={2.2} /> will
                      need{" "}
                    </>
                  )}
                  <code className="rounded bg-amber-100 px-1 font-mono text-[10.5px]">sudo</code>
                  {" — enable the option in the next step to try."}
                </div>
              </div>
            </div>
          )}

          {step === 2 && !batchDone && (
            <>
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-900">
                This will run{" "}
                <code className="rounded bg-red-100 px-1 font-mono text-[11px]">rm</code> on the
                remote server. {single ? `The ${items[0]?.kind ?? "item"} ` : "These items "}
                <span className="font-semibold">cannot be recovered</span> from HarborSCP.
              </div>

              {flaggedCount > 0 && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border-subtle bg-surface-chip/40 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={useSudoForFlagged}
                    onChange={(e) => {
                      setUseSudoForFlagged(e.target.checked);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-red-600"
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-text-primary">
                      Use{" "}
                      <code className="rounded bg-surface-chip px-1 font-mono text-[11px]">
                        sudo
                      </code>{" "}
                      for the {flaggedCount} privileged{" "}
                      {flaggedCount === 1 ? "item" : "items"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-tertiary">
                      Runs{" "}
                      <code className="rounded bg-surface-chip px-1 font-mono text-[10.5px]">
                        sudo -n rm -rf
                      </code>{" "}
                      on the control channel. Requires passwordless sudo for the SSH user.
                    </div>
                  </div>
                </label>
              )}
            </>
          )}

          {busy && !single && (
            <div className="flex items-center gap-2 rounded-lg bg-surface-chip/40 px-3 py-2 text-[11.5px] text-text-secondary">
              <Loader2 size={12} className="animate-spin text-text-tertiary" />
              Deleting {progress + 1} of {sudoAttemptedRef.current ? batchDone?.failed.length ?? totalCount : totalCount}…
            </div>
          )}

          {/* Post-batch failure list */}
          {batchDone && failures.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/60">
              <div className="border-b border-red-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-red-700">
                {failures.length} failed
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {failures.map((f) => (
                  <div key={f.path} className="border-b border-red-100 px-3 py-1.5 last:border-0">
                    <div className="truncate font-mono text-[11px] text-red-900" title={f.path}>
                      {basename(f.path)}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-red-700">{f.error}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-surface-chip/30 px-5 py-3">
          {batchDone ? (
            <>
              {showSudoRetry && (
                <button
                  onClick={() => void runBatch(true)}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Retrying with sudo…
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={12} strokeWidth={2.2} />
                      Retry {failures.length} failed with sudo
                    </>
                  )}
                </button>
              )}
              <button
                onClick={onCancel}
                disabled={busy}
                className="rounded-lg border border-border-input bg-surface-pane px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
              >
                Close
              </button>
            </>
          ) : (
            <>
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
                  disabled={needsSudoPaths === null}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue
                </button>
              ) : (
                <button
                  onClick={() => void runBatch(false)}
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
                      {single ? "Delete permanently" : `Delete ${String(totalCount)} ${batchLabel}`}
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemCard({ item, flagged }: { item: DeleteConfirmItem; flagged: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-chip/40 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {flagged && (
            <Lock size={11} strokeWidth={2.2} className="flex-shrink-0 text-amber-600" />
          )}
          <span
            className="truncate text-[13px] font-medium text-text-primary"
            title={basename(item.path)}
          >
            {basename(item.path)}
          </span>
        </div>
        <span className="flex-shrink-0 tabular-nums text-[11.5px] text-text-tertiary">
          {formatBytes(item.sizeBytes)}
        </span>
      </div>
      <div className="break-all font-mono text-[10.5px] text-text-tertiary">{item.path}</div>
    </div>
  );
}
