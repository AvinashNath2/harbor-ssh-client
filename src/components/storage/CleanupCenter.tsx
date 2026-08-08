import {
  AlertCircle,
  AlertTriangle,
  Box,
  CheckCircle2,
  Eye,
  FileText,
  Info,
  Loader2,
  Package,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CleanupEstimate, CleanupItem, CleanupPreview, CleanupResult } from "../../api";
import { formatBytes } from "../../utils/storageHealth";

interface PresetDef {
  target: string;
  name: string;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
  Icon: React.ElementType;
  category: string;
  /** When set, user must type this exact string before countdown starts. */
  dangerConfirm?: string;
}

const PRESETS: PresetDef[] = [
  {
    target: "journal-vacuum",
    name: "Journal Logs",
    description: "Vacuum systemd journal to 100 MB — removes old log entries",
    risk: "low",
    Icon: ScrollText,
    category: "Logs",
  },
  {
    target: "apt-cache",
    name: "APT Package Cache",
    description: "Delete downloaded .deb packages from /var/cache/apt/archives",
    risk: "low",
    Icon: Package,
    category: "Packages",
  },
  {
    target: "dnf-cache",
    name: "DNF Package Cache",
    description: "Clean DNF/RPM package cache from /var/cache/dnf",
    risk: "low",
    Icon: Package,
    category: "Packages",
  },
  {
    target: "yum-cache",
    name: "YUM Package Cache",
    description: "Clean YUM package cache from /var/cache/yum",
    risk: "low",
    Icon: Package,
    category: "Packages",
  },
  {
    target: "docker-prune",
    name: "Docker Cleanup",
    description:
      "Remove stopped containers, dangling images, and unused networks. Volumes are NOT touched.",
    risk: "low",
    Icon: Box,
    category: "Docker",
  },
  {
    target: "docker-volumes-prune",
    name: "Docker Volumes (DANGER)",
    description:
      "Permanently delete ALL Docker volumes not attached to a running container. Data inside volumes cannot be recovered.",
    risk: "critical",
    Icon: Box,
    category: "Docker",
    dangerConfirm: "DELETE VOLUMES",
  },
  {
    target: "tmp-old",
    name: "Old /tmp Files",
    description: "Delete files in /tmp not accessed in 90+ days",
    risk: "low",
    Icon: Trash2,
    category: "Temporary",
  },
  {
    target: "coredumps",
    name: "Core Dumps",
    description: "Delete core dump files from /var/crash, /var/core, and /tmp",
    risk: "low",
    Icon: AlertCircle,
    category: "Crashes",
  },
  {
    target: "old-logs",
    name: "Rotated Logs",
    description: "Delete compressed and numbered log files from /var/log",
    risk: "medium",
    Icon: FileText,
    category: "Logs",
  },
];

const RISK_STYLE: Record<string, { label: string; cls: string }> = {
  low: { label: "Low Risk", cls: "bg-green-50 text-green-700 border-green-300" },
  medium: { label: "Medium Risk", cls: "bg-amber-50 text-amber-700 border-amber-300" },
  high: { label: "High Risk", cls: "bg-red-50 text-red-700 border-red-300" },
  critical: { label: "CRITICAL", cls: "bg-red-100 text-red-800 border-red-500 font-bold" },
};

interface CleanupCenterProps {
  sudoAvailable: boolean | null;
  onCheckSudo: () => void;
  onEstimate: (target: string) => Promise<CleanupEstimate | null>;
  onPreview: (target: string) => Promise<CleanupPreview | null>;
  onExecute: (target: string, sudoPassword?: string) => Promise<CleanupResult | null>;
}

export function CleanupCenter({
  sudoAvailable,
  onCheckSudo,
  onEstimate,
  onPreview,
  onExecute,
}: CleanupCenterProps) {
  const [estimates, setEstimates] = useState<Record<string, CleanupEstimate>>({});
  const [estimating, setEstimating] = useState<Record<string, boolean>>({});
  const [selectedPreset, setSelectedPreset] = useState<PresetDef | null>(null);
  // Preview modal state
  const [previewPreset, setPreviewPreset] = useState<PresetDef | null>(null);
  const [previewData, setPreviewData] = useState<CleanupPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const openPreview = useCallback(
    async (preset: PresetDef) => {
      setPreviewPreset(preset);
      setPreviewData(null);
      setPreviewLoading(true);
      const p = await onPreview(preset.target);
      setPreviewData(p);
      setPreviewLoading(false);
    },
    [onPreview],
  );
  const [estimatingAll, setEstimatingAll] = useState(false);

  const estimateOne = useCallback(
    async (target: string) => {
      setEstimating((e) => ({ ...e, [target]: true }));
      const result = await onEstimate(target);
      setEstimating((e) => ({ ...e, [target]: false }));
      if (result) {
        setEstimates((prev) => ({ ...prev, [target]: result }));
      }
    },
    [onEstimate],
  );

  const estimateAll = useCallback(async () => {
    setEstimatingAll(true);
    await Promise.all(PRESETS.map((p) => estimateOne(p.target)));
    setEstimatingAll(false);
  }, [estimateOne]);

  useEffect(() => {
    if (sudoAvailable === null) {
      onCheckSudo();
    }
  }, [sudoAvailable, onCheckSudo]);

  const estimate = (target: string) => estimates[target];
  const isEstimating = (target: string) => estimating[target] ?? false;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-text-primary">Cleanup Center</h2>
          <p className="text-[11.5px] text-text-faint">
            Run targeted cleanup presets — each action shows a 5-second confirmation before
            executing
          </p>
        </div>
        <button
          onClick={estimateAll}
          disabled={estimatingAll}
          className="flex items-center gap-1.5 rounded-lg border border-border-input px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-chip disabled:opacity-50"
        >
          {estimatingAll ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Estimate All
        </button>
      </div>

      {/* Sudo status */}
      {sudoAvailable !== null && (
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]"
          style={{
            borderColor: sudoAvailable ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)",
            background: sudoAvailable ? "rgba(34,197,94,0.05)" : "rgba(245,158,11,0.05)",
          }}
        >
          <ShieldAlert size={13} className={sudoAvailable ? "text-green-400" : "text-amber-400"} />
          <span className={sudoAvailable ? "text-green-700" : "text-amber-700"}>
            {sudoAvailable
              ? "Passwordless sudo available — sudo presets will run without a password prompt"
              : "No passwordless sudo — you will be prompted for a sudo password for elevated presets"}
          </span>
        </div>
      )}

      {/* Preset grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PRESETS.map((preset) => {
          const est = estimate(preset.target);
          const loading = isEstimating(preset.target);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          const notAvail = est && !est.available;
          const risk = RISK_STYLE[preset.risk];

          return (
            <div
              key={preset.target}
              className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors bg-surface-pane ${
                notAvail ? "opacity-50" : "hover:border-border-raised"
              }`}
              style={{ borderColor: "#dedad3" }}
            >
              {/* Card header */}
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(47,107,219,0.10)]">
                  <preset.Icon size={14} className="text-[#3f7be0]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">
                      {preset.name}
                    </span>
                    <span
                      className={`rounded-sm border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide ${risk.cls}`}
                    >
                      {risk.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-text-faint">{preset.description}</p>
                </div>
              </div>

              {/* Estimate row */}
              <div className="flex items-center justify-between">
                <div className="text-[12px]">
                  {loading ? (
                    <span className="flex items-center gap-1.5 text-text-faint">
                      <Loader2 size={11} className="animate-spin" />
                      Estimating…
                    </span>
                  ) : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                  est ? (
                    notAvail ? (
                      <span className="text-text-faint">Not available on this server</span>
                    ) : (
                      <span className="font-semibold text-text-accent">
                        ~{formatBytes(est.estimated_bytes)} reclaimable
                      </span>
                    )
                  ) : (
                    <span className="text-text-faint">Click Estimate to check</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
                  {!est && !loading && (
                    <button
                      onClick={() => {
                        void estimateOne(preset.target);
                      }}
                      className="rounded-lg border border-border-input px-2.5 py-1 text-[11.5px] text-text-secondary hover:bg-surface-chip"
                    >
                      Estimate
                    </button>
                  )}
                  <button
                    onClick={() => {
                      void openPreview(preset);
                    }}
                    disabled={notAvail}
                    className="flex items-center gap-1 rounded-lg border border-border-input px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary disabled:opacity-40"
                    title="See exactly which files / items this preset would remove"
                  >
                    <Eye size={11} strokeWidth={2} />
                    Preview
                  </button>
                  <button
                    onClick={() => {
                      setSelectedPreset(preset);
                    }}
                    disabled={notAvail}
                    className="rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg,#3f7be0,#2f6bdb)" }}
                  >
                    Clean
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirmation modal */}
      {selectedPreset && (
        <CleanupModal
          preset={selectedPreset}
          estimate={estimates[selectedPreset.target] ?? null}
          sudoAvailable={sudoAvailable}
          onExecute={onExecute}
          onClose={() => {
            setSelectedPreset(null);
          }}
        />
      )}

      {/* Preview modal — descriptive list of items that would be removed */}
      {previewPreset && (
        <PreviewModal
          preset={previewPreset}
          data={previewData}
          loading={previewLoading}
          onClose={() => {
            setPreviewPreset(null);
            setPreviewData(null);
          }}
          onClean={() => {
            const p = previewPreset;
            setPreviewPreset(null);
            setPreviewData(null);
            setSelectedPreset(p);
          }}
        />
      )}
    </div>
  );
}

// ── Preview modal — shows what a preset would actually delete ─────────────────

function iconForKind(kind: CleanupItem["kind"]) {
  switch (kind) {
    case "container":
      return <Box size={12} className="text-blue-600" />;
    case "image":
      return <Package size={12} className="text-purple-600" />;
    case "network":
      return <RefreshCw size={12} className="text-cyan-600" />;
    case "volume":
      return <Package size={12} className="text-orange-600" />;
    case "info":
      return <Info size={12} className="text-text-faint" />;
    default:
      return <FileText size={12} className="text-text-faint" />;
  }
}

function PreviewModal({
  preset,
  data,
  loading,
  onClose,
  onClean,
}: {
  preset: PresetDef;
  data: CleanupPreview | null;
  loading: boolean;
  onClose: () => void;
  onClean: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-modal border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 40px 100px -20px rgba(20,18,15,0.55)" }}
      >
        {/* Header */}
        <div className="flex flex-none items-start gap-3 border-b border-border px-5 py-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(47,107,219,0.10)]">
            <preset.Icon size={16} className="text-[#3f7be0]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-text-primary">
                Preview: {preset.name}
              </span>
              <span
                className={`rounded-sm border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide ${RISK_STYLE[preset.risk].cls}`}
              >
                {RISK_STYLE[preset.risk].label}
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-text-faint">
              Nothing has been deleted yet — this is what the Clean button would remove.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
            title="Close"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-text-faint">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-[12px]">Listing items on the server…</span>
            </div>
          )}

          {!loading && !data && (
            <div className="py-16 text-center text-[13px] text-danger">
              Failed to load preview — check the Storage Logs drawer for details.
            </div>
          )}

          {!loading && data && (
            <div className="space-y-4">
              {/* Descriptive header */}
              <div className="rounded-lg bg-surface-chip px-3 py-2.5 text-[12px] leading-relaxed text-text-secondary">
                {data.description}
              </div>

              {/* Notes / warnings */}
              {data.notes.length > 0 && (
                <div className="space-y-1.5">
                  {data.notes.map((note, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800"
                    >
                      <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Summary strip */}
              <div className="flex items-center gap-4 rounded-lg border border-border-input bg-surface-colheader px-3 py-2 text-[12px]">
                <span>
                  <span className="font-mono font-semibold text-text-primary">
                    {data.itemCount.toLocaleString()}
                  </span>{" "}
                  <span className="text-text-faint">item{data.itemCount === 1 ? "" : "s"}</span>
                </span>
                <span className="text-text-faint">·</span>
                <span>
                  <span className="font-mono font-semibold text-text-primary">
                    {formatBytes(data.totalBytes)}
                  </span>{" "}
                  <span className="text-text-faint">total</span>
                </span>
                {data.truncated && (
                  <>
                    <span className="text-text-faint">·</span>
                    <span className="text-amber-700">
                      Listing capped at {data.itemCount.toLocaleString()} — more items may exist
                    </span>
                  </>
                )}
              </div>

              {/* Items list */}
              {data.items.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-text-faint">
                  Nothing to remove — the preset would run but find no matching items.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border-input">
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr
                        className="border-b text-left"
                        style={{ borderColor: "#dedad3", background: "#ece9e3" }}
                      >
                        <th className="w-8 px-2 py-2"></th>
                        <th className="px-3 py-2 font-semibold uppercase tracking-wide text-[10px] text-text-faint">
                          Item
                        </th>
                        <th className="w-24 px-3 py-2 text-right font-semibold uppercase tracking-wide text-[10px] text-text-faint">
                          Size
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item, idx) => (
                        <tr
                          key={`${item.kind}-${item.path}-${idx.toString()}`}
                          className="border-b transition-colors hover:bg-surface-chip"
                          style={{ borderColor: "#e5e2db" }}
                        >
                          <td className="px-2 py-1.5 text-center">{iconForKind(item.kind)}</td>
                          <td className="px-3 py-1.5">
                            <div className="break-all font-mono text-text-primary">{item.path}</div>
                            {item.note && (
                              <div className="mt-0.5 text-[10.5px] text-text-tertiary">
                                {item.note}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">
                            {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-none items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[11.5px] text-text-faint">
            Preview is read-only — clicking Clean opens a countdown confirmation.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border-input px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-chip"
            >
              Close
            </button>
            <button
              onClick={onClean}
              disabled={!data || data.itemCount === 0}
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#3f7be0,#2f6bdb)" }}
            >
              Clean now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Countdown confirmation modal ──────────────────────────────────────────────

interface CleanupModalProps {
  preset: PresetDef;
  estimate: CleanupEstimate | null;
  sudoAvailable: boolean | null;
  onExecute: (target: string, sudoPassword?: string) => Promise<CleanupResult | null>;
  onClose: () => void;
}

type ModalPhase = "confirm" | "running" | "done" | "error";

function CleanupModal({ preset, estimate, sudoAvailable, onExecute, onClose }: CleanupModalProps) {
  const [phase, setPhase] = useState<ModalPhase>("confirm");
  const [countdown, setCountdown] = useState(5);
  const [sudoPassword, setSudoPassword] = useState("");
  const [dangerInput, setDangerInput] = useState("");
  const [result, setResult] = useState<CleanupResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortedRef = useRef(false);

  const needsPassword = (estimate?.sudo_required ?? false) && sudoAvailable === false;
  const needsDangerConfirm = !!preset.dangerConfirm;
  const dangerConfirmed = !needsDangerConfirm || dangerInput === preset.dangerConfirm;

  const startCountdown = useCallback(() => {
    timerRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  }, []);

  // When countdown hits 0, auto-execute
  useEffect(() => {
    if (countdown === 0 && phase === "confirm") {
      void execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, phase]);

  // Start countdown when modal opens — blocked by password prompt or danger confirm
  useEffect(() => {
    if (!needsPassword && !needsDangerConfirm) {
      startCountdown();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const execute = useCallback(async () => {
    if (abortedRef.current || phase !== "confirm") return;
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase("running");
    const res = await onExecute(preset.target, sudoPassword || undefined);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (abortedRef.current) return;
    setResult(res);
    setPhase(res?.exit_code === 0 ? "done" : "error");
  }, [onExecute, phase, preset.target, sudoPassword]);

  const cancel = () => {
    abortedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    onClose();
  };

  const risk = RISK_STYLE[preset.risk];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border-raised bg-surface-pane shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgba(47,107,219,0.10)]">
            <preset.Icon size={16} className="text-[#3f7be0]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-text-primary">{preset.name}</span>
              <span
                className={`rounded-sm border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide ${risk.cls}`}
              >
                {risk.label}
              </span>
            </div>
            <p className="text-[11.5px] text-text-faint">{preset.description}</p>
          </div>
          {phase === "confirm" && (
            <button
              onClick={cancel}
              className="ml-1 rounded-lg p-1 text-text-faint hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-5">
          {phase === "confirm" && (
            <>
              {/* Command preview */}
              <div>
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-text-faint">
                  Command to run
                </p>
                <code className="block rounded-lg px-3 py-2.5 font-mono text-[11.5px] text-text-primary bg-surface-colheader">
                  {estimate?.command_preview ?? preset.target}
                  {estimate?.sudo_required && <span className="ml-1 text-amber-400"> [sudo]</span>}
                </code>
              </div>

              {/* Estimate */}
              {estimate && estimate.estimated_bytes > 0 && (
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="text-text-faint">Estimated reclaimable:</span>
                  <span className="font-semibold text-text-accent">
                    ~{formatBytes(estimate.estimated_bytes)}
                  </span>
                </div>
              )}

              {/* Danger confirmation gate for critical presets */}
              {needsDangerConfirm && (
                <div className="rounded-lg border border-red-400 bg-red-50 p-3">
                  <p className="mb-2 text-[11.5px] font-semibold text-red-700">
                    This action will permanently delete Docker volumes. Database data stored in
                    volumes will be lost and cannot be recovered.
                  </p>
                  <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-widest text-red-600">
                    Type <span className="font-mono">{preset.dangerConfirm}</span> to unlock
                  </label>
                  <input
                    type="text"
                    value={dangerInput}
                    onChange={(e) => {
                      setDangerInput(e.target.value);
                    }}
                    placeholder={preset.dangerConfirm}
                    className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 font-mono text-[12.5px] text-red-800 outline-none focus:border-red-500"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && dangerConfirmed && !needsPassword) {
                        startCountdown();
                      }
                    }}
                  />
                  {dangerConfirmed && !needsPassword && countdown === 5 && (
                    <button
                      onClick={startCountdown}
                      className="mt-2 text-[11.5px] text-red-600 hover:underline"
                    >
                      Confirmed → start countdown
                    </button>
                  )}
                </div>
              )}

              {/* Sudo password input */}
              {needsPassword && (
                <div>
                  <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-widest text-amber-400">
                    Sudo password required
                  </label>
                  <input
                    type="password"
                    value={sudoPassword}
                    onChange={(e) => {
                      setSudoPassword(e.target.value);
                    }}
                    placeholder="Enter sudo password…"
                    className="w-full rounded-lg border border-border-input bg-surface-chip px-3 py-2 font-mono text-[12.5px] text-text-primary outline-none focus:border-[#3f7be0]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && sudoPassword && dangerConfirmed) {
                        startCountdown();
                      }
                    }}
                  />
                  {sudoPassword && dangerConfirmed && countdown === 5 && (
                    <button
                      onClick={startCountdown}
                      className="mt-2 text-[11.5px] text-text-accent hover:underline"
                    >
                      Confirm → start countdown
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {phase === "running" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Loader2 size={28} className="animate-spin text-[#3f7be0]" />
              <p className="text-[13px] font-semibold text-text-primary">Running cleanup…</p>
              <p className="text-[12px] text-text-faint">This may take a few seconds</p>
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 size={28} className="text-green-400" />
              <p className="text-[13px] font-semibold text-green-300">Cleanup complete</p>
              {result && (
                <p className="text-[12px] text-text-faint">
                  Completed in {(result.duration_ms / 1000).toFixed(1)}s
                  {estimate && estimate.estimated_bytes > 0
                    ? ` · ~${formatBytes(estimate.estimated_bytes)} freed`
                    : ""}
                </p>
              )}
              {result?.stderr && (
                <pre
                  className="w-full overflow-auto rounded-lg px-3 py-2.5 text-left font-mono text-[10.5px] text-text-faint"
                  style={{ background: "#ece9e3", maxHeight: 120 }}
                >
                  {result.stderr.slice(0, 500)}
                </pre>
              )}
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertTriangle size={28} className="text-red-400" />
              <p className="text-[13px] font-semibold text-red-300">
                Cleanup failed (exit {result?.exit_code ?? "?"})
              </p>
              {result?.stderr && (
                <pre
                  className="w-full overflow-auto rounded-lg px-3 py-2.5 text-left font-mono text-[10.5px] text-red-300/80"
                  style={{ background: "#ece9e3", maxHeight: 140 }}
                >
                  {result.stderr.slice(0, 600)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          {phase === "confirm" ? (
            <>
              <button
                onClick={cancel}
                className="rounded-lg border border-border-input px-4 py-2 text-[12.5px] font-medium text-text-secondary hover:bg-surface-chip"
              >
                Cancel
              </button>

              <div className="flex items-center gap-3">
                {dangerConfirmed && !needsPassword && countdown > 0 && (
                  <span className="text-[12px] text-text-faint">
                    Running in <span className="font-semibold text-amber-300">{countdown}s</span>…
                  </span>
                )}
                {!dangerConfirmed && (
                  <span className="text-[12px] text-red-500">
                    Type the confirmation phrase to unlock
                  </span>
                )}
                <button
                  onClick={() => {
                    void execute();
                  }}
                  disabled={(needsPassword && !sudoPassword) || !dangerConfirmed}
                  className="rounded-lg px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)" }}
                >
                  Run Now
                </button>
              </div>
            </>
          ) : (
            <div className="flex w-full justify-end">
              <button
                onClick={onClose}
                disabled={phase === "running"}
                className="rounded-lg border border-border-input px-4 py-2 text-[12.5px] font-medium text-text-secondary hover:bg-surface-chip disabled:opacity-50"
              >
                {phase === "running" ? "Please wait…" : "Close"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
