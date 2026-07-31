import {
  AlertCircle,
  AlertTriangle,
  Box,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CleanupEstimate, CleanupResult } from "../../api";
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
  onExecute: (target: string, sudoPassword?: string) => Promise<CleanupResult | null>;
}

export function CleanupCenter({
  sudoAvailable,
  onCheckSudo,
  onEstimate,
  onExecute,
}: CleanupCenterProps) {
  const [estimates, setEstimates] = useState<Record<string, CleanupEstimate>>({});
  const [estimating, setEstimating] = useState<Record<string, boolean>>({});
  const [selectedPreset, setSelectedPreset] = useState<PresetDef | null>(null);
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
          {estimatingAll ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
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
          <ShieldAlert
            size={13}
            className={sudoAvailable ? "text-green-400" : "text-amber-400"}
          />
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
                      onClick={() => { void estimateOne(preset.target); }}
                      className="rounded-lg border border-border-input px-2.5 py-1 text-[11.5px] text-text-secondary hover:bg-surface-chip"
                    >
                      Estimate
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedPreset(preset); }}
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
          onClose={() => { setSelectedPreset(null); }}
        />
      )}
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

  const needsPassword =
    (estimate?.sudo_required ?? false) && sudoAvailable === false;
  const needsDangerConfirm = !!preset.dangerConfirm;
  const dangerConfirmed =
    !needsDangerConfirm || dangerInput === preset.dangerConfirm;

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
      <div
        className="w-full max-w-lg rounded-2xl border border-border-raised bg-surface-pane shadow-2xl"
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 border-b border-border px-5 py-4"
        >
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
            <button onClick={cancel} className="ml-1 rounded-lg p-1 text-text-faint hover:text-text-primary">
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
                <code
                  className="block rounded-lg px-3 py-2.5 font-mono text-[11.5px] text-text-primary bg-surface-colheader"
                >
                  {estimate?.command_preview ?? preset.target}
                  {estimate?.sudo_required && (
                    <span className="ml-1 text-amber-400"> [sudo]</span>
                  )}
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
                    This action will permanently delete Docker volumes. Database data stored
                    in volumes will be lost and cannot be recovered.
                  </p>
                  <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-widest text-red-600">
                    Type <span className="font-mono">{preset.dangerConfirm}</span> to unlock
                  </label>
                  <input
                    type="text"
                    value={dangerInput}
                    onChange={(e) => { setDangerInput(e.target.value); }}
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
                    onChange={(e) => { setSudoPassword(e.target.value); }}
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
        <div
          className="flex items-center justify-between border-t border-border px-5 py-4"
        >
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
                    Running in{" "}
                    <span className="font-semibold text-amber-300">{countdown}s</span>…
                  </span>
                )}
                {!dangerConfirmed && (
                  <span className="text-[12px] text-red-500">
                    Type the confirmation phrase to unlock
                  </span>
                )}
                <button
                  onClick={() => { void execute(); }}
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
