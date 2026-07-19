import { Check, Eye, FileText, Folder, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chmodFile, getFileInfo, type FileEntry, type FileInfo } from "../api";
import type { PendingCommand } from "../hooks/useSessionLog";
import { PreviewModal } from "./PreviewModal";

function fmtSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes.toString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(ts: number | null): string {
  if (ts === null) return "—";
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function parseOctal(octal: string): boolean[][] {
  const digits = octal.slice(-3).split("").map(Number);
  return digits.map((d) => [!!(d & 4), !!(d & 2), !!(d & 1)]);
}

function toOctalStr(perms: boolean[][]): string {
  return perms.map(([r, w, x]) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0)).join("");
}

type Tab = "info" | "permissions";

interface FileDetailPanelProps {
  entry: FileEntry;
  width?: number;
  /** If true, immediately open the Permissions tab in edit mode. Used by the
   *  right-click → "Edit permissions" menu item. */
  editPermissionsOnOpen?: boolean;
  onClose: () => void;
  onCommandLogged?: (cmd: PendingCommand) => void;
}

export function FileDetailPanel({
  entry,
  width,
  editPermissionsOnOpen,
  onClose,
  onCommandLogged,
}: FileDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(editPermissionsOnOpen ? "permissions" : "info");
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [permsEditable, setPermsEditable] = useState<boolean>(editPermissionsOnOpen ?? false);

  useEffect(() => {
    setInfo(null);
    setInfoError(null);
    setShowPreviewModal(false); // close preview when a different file is selected
    setPermsEditable(editPermissionsOnOpen ?? false);
    if (editPermissionsOnOpen) setActiveTab("permissions");
    getFileInfo(entry.path)
      .then(setInfo)
      .catch((e: unknown) => {
        setInfoError(e instanceof Error ? e.message : String(e));
      });
  }, [entry.path, editPermissionsOnOpen]);

  const canPreview = entry.kind !== "directory";

  return (
    <div
      className="flex flex-shrink-0 flex-col border-l border-border-raised bg-surface-pane"
      style={{ width: width ?? 272 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[12.5px] font-semibold text-text-primary">
          {entry.kind === "directory" ? "Folder" : "File"} Info
        </span>
        <button
          onClick={onClose}
          className="text-text-faint transition-colors hover:text-text-secondary"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>

      {/* Icon + name */}
      <div className="flex flex-col items-center gap-2 px-4 pb-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-[14px] text-accent-dark"
          style={{ background: "rgba(63,123,224,0.12)", border: "1px solid rgba(63,123,224,0.2)" }}
        >
          {entry.kind === "directory" ? (
            <Folder size={26} strokeWidth={2} />
          ) : (
            <FileText size={26} strokeWidth={2} />
          )}
        </div>
        <div className="w-full text-center">
          <div className="truncate text-[13px] font-semibold text-text-primary">{entry.name}</div>
          <div className="text-[11px] text-text-faint capitalize">{entry.kind}</div>
        </div>
      </div>

      {/* Tab bar (Info | Permissions) */}
      <div className="flex border-b border-border-raised">
        {(["info", "permissions"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setActiveTab(t);
            }}
            className={`flex-1 py-2 text-[11px] font-medium capitalize transition-colors ${
              activeTab === t
                ? "border-b-2 border-accent-dark text-accent-dark"
                : "text-text-faint hover:text-text-secondary"
            }`}
            style={activeTab === t ? { marginBottom: "-1px" } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "info" && <InfoTab info={info} entry={entry} error={infoError} />}
        {activeTab === "permissions" && (
          <PermissionsTab
            info={info}
            entry={entry}
            editable={permsEditable}
            onRequestEdit={() => {
              setPermsEditable(true);
            }}
            onDoneEditing={() => {
              setPermsEditable(false);
            }}
            onRefresh={() => {
              getFileInfo(entry.path)
                .then(setInfo)
                .catch(() => undefined);
            }}
          />
        )}
      </div>

      {/* Preview button (fixed at bottom) — opens standalone modal so file
          content is rendered at a comfortable size instead of cramped in the
          272px panel */}
      {canPreview && (
        <div className="border-t border-border-raised px-3 py-3">
          <button
            onClick={() => {
              setShowPreviewModal(true);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-input border border-border-input bg-surface-chip py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-hover hover:text-accent-dark"
          >
            <Eye size={13} strokeWidth={2} />
            Show Preview
          </button>
        </div>
      )}

      {showPreviewModal && (
        <PreviewModal
          onCommandLogged={onCommandLogged}
          entry={entry}
          onClose={() => {
            setShowPreviewModal(false);
          }}
        />
      )}
    </div>
  );
}

// ── Info tab ──────────────────────────────────────────────────────────────────

function InfoTab({
  info,
  error,
}: {
  info: FileInfo | null;
  entry: FileEntry;
  error: string | null;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (error) {
    return <div className="px-4 py-6 text-center text-[12px] text-danger">{error}</div>;
  }
  if (!info) {
    return <div className="px-4 py-6 text-center text-[12px] text-text-faint">Loading…</div>;
  }

  const rows: [string, string][] = [
    ["Path", info.path],
    ["Size", fmtSize(info.size)],
    ["Modified", fmtDate(info.modified)],
    ["Owner", info.owner ?? "—"],
    ["Group", info.group ?? "—"],
    ["Permissions", info.permissions ?? "—"],
    ["Octal", info.permOctal ?? "—"],
  ];

  function handleCopy(label: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedLabel(label);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopiedLabel(null);
      }, 1500);
    });
  }

  return (
    <div className="flex flex-col gap-0 px-4 py-3">
      {rows.map(([label, value]) => (
        <div key={label} className="border-b border-border py-2.5 last:border-0">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[1px] text-text-faint">
              {label}
            </span>
            {copiedLabel === label && (
              <span className="flex items-center gap-0.5 font-mono text-[9px] text-success">
                <Check size={9} strokeWidth={2.5} /> Copied
              </span>
            )}
          </div>
          <input
            readOnly
            value={value}
            onClick={(e) => {
              (e.target as HTMLInputElement).select();
              handleCopy(label, value);
            }}
            className="w-full cursor-pointer rounded border border-border-input bg-surface-colheader px-2 py-1 font-mono text-[11.5px] text-text-primary outline-none focus:border-accent-dark"
            title="Click to copy"
          />
        </div>
      ))}
    </div>
  );
}

// ── Permissions tab ───────────────────────────────────────────────────────────

function PermissionsTab({
  info,
  entry,
  editable,
  onRequestEdit,
  onDoneEditing,
  onRefresh,
}: {
  info: FileInfo | null;
  entry: FileEntry;
  editable: boolean;
  onRequestEdit: () => void;
  onDoneEditing: () => void;
  onRefresh: () => void;
}) {
  const octal = info?.permOctal ?? "0644";
  const [perms, setPerms] = useState<boolean[][]>(() => parseOctal(octal));
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (info?.permOctal) setPerms(parseOctal(info.permOctal));
  }, [info?.permOctal]);

  if (!info) {
    return <div className="px-4 py-6 text-center text-[12px] text-text-faint">Loading…</div>;
  }

  const LABELS = ["Owner", "Group", "Other"];
  const BITS = ["Read", "Write", "Exec"];

  async function apply() {
    const modeStr = toOctalStr(perms);
    const bits = parseInt(modeStr, 8);
    setApplying(true);
    setMsg(null);
    try {
      await chmodFile(entry.path, bits);
      setMsg({ ok: true, text: `Mode set to ${modeStr}` });
      onDoneEditing();
      // Refresh after leaving edit mode so the UI reflects the confirmed value.
      onRefresh();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setApplying(false);
    }
  }

  function cancel() {
    // Discard local edits and go back to read-only view.
    if (info?.permOctal) setPerms(parseOctal(info.permOctal));
    setMsg(null);
    onDoneEditing();
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-3 font-mono text-[11px] text-text-faint">
        Current: <span className="text-text-primary">{info.permissions ?? "—"}</span>
        <span
          className="ml-2 text-text-faint cursor-help"
          title="Octal notation: digits represent Owner / Group / Other. Each digit sums Read(4) + Write(2) + Execute(1). e.g. 755 = owner rwx, group r-x, other r-x"
        >
          ({toOctalStr(perms)})
        </span>
        {!editable && (
          <span className="ml-2 rounded-chip bg-surface-chip px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.5px] text-text-secondary">
            Read-only
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-input border border-border-raised">
        {/* Header */}
        <div className="grid grid-cols-4 border-b border-border-raised bg-surface-colheader px-3 py-1.5">
          <div />
          {BITS.map((b) => (
            <div
              key={b}
              className="text-center font-mono text-[10px] font-semibold text-text-faint"
            >
              {b}
            </div>
          ))}
        </div>

        {LABELS.map((label, gi) => (
          <div
            key={label}
            className="grid grid-cols-4 border-b border-border-raised px-3 py-2.5 last:border-0"
          >
            <div className="text-[12px] font-medium text-text-secondary">{label}</div>
            {[0, 1, 2].map((bi) => (
              <div key={bi} className="flex justify-center">
                <input
                  type="checkbox"
                  checked={perms[gi]?.[bi] ?? false}
                  disabled={!editable}
                  onChange={(e) => {
                    setPerms((prev) => {
                      const next = prev.map((row) => [...row]);
                      if (next[gi]) next[gi][bi] = e.target.checked;
                      return next;
                    });
                    setMsg(null);
                  }}
                  className="h-3.5 w-3.5 accent-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {msg && (
        <div
          className={`mt-3 rounded-input px-3 py-2 text-[11.5px] ${
            msg.ok ? "bg-success/10 text-[#177a4c]" : "bg-danger/10 text-danger"
          }`}
        >
          {msg.text}
        </div>
      )}

      {editable ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={cancel}
            disabled={applying}
            className="flex-1 rounded-input border border-border-input bg-surface-chip py-2 text-[12.5px] font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void apply();
            }}
            disabled={applying}
            className="flex-1 rounded-input py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
          >
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      ) : (
        <button
          onClick={onRequestEdit}
          className="mt-3 w-full rounded-input border border-border-input bg-surface-chip py-2 text-[12.5px] font-medium text-text-primary transition-colors hover:bg-surface-hover hover:text-accent-dark"
        >
          ✎ Edit permissions
        </button>
      )}
    </div>
  );
}

// Preview rendering now lives in PreviewModal.tsx — a full-screen dialog so
// content is comfortably readable instead of cramped inside the 272px side
// panel.
