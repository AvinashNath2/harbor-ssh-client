import {
  AlertTriangle,
  ChevronRight,
  Coffee,
  RefreshCw,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JavaProcess, ProcessDetail } from "../api";
import type { ProcessLogEntry } from "../hooks/useProcessMonitor";
import { useProcessMonitor } from "../hooks/useProcessMonitor";
import { ConfirmDialog } from "./ConfirmDialog";

interface ProcessMonitorPageProps {
  host: string;
  username: string;
  onClose: () => void;
}

function fmtMem(kb: number): string {
  if (kb < 1024) return `${kb.toString()} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s.toString()}s ago`;
  return `${Math.floor(s / 60).toString()}m ago`;
}

// ── Thread dump modal ─────────────────────────────────────────────────────────

function ThreadDumpModal({
  pid,
  content,
  onClose,
}: {
  pid: number;
  content: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: "rgba(20,18,15,0.62)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[88vh] w-[80vw] max-w-[1100px] flex-col overflow-hidden rounded-modal border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 40px 100px -20px rgba(20,18,15,0.55)" }}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <TerminalSquare size={16} strokeWidth={2} className="text-warning flex-shrink-0" />
          <span className="flex-1 text-[13.5px] font-semibold text-text-primary">
            Thread Dump — PID {pid}
          </span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-[12px] leading-relaxed text-text-primary">
          {content || "No output captured."}
        </pre>
        <div className="flex justify-end border-t border-border px-5 py-2">
          <span className="text-[11px] text-text-faint">
            <kbd className="rounded border border-border-input px-1.5 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Force-kill countdown modal ────────────────────────────────────────────────

function ForceKillModal({
  process,
  onConfirm,
  onCancel,
}: {
  process: JavaProcess;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (count <= 0) {
      onConfirm();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, onConfirm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
      <div className="w-96 rounded-modal border border-border-raised bg-surface-pane p-6 shadow-xl">
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={16} strokeWidth={2} className="flex-shrink-0 text-danger" />
          <p className="text-[14px] font-semibold text-text-primary">Force Kill Process</p>
        </div>
        <p className="mt-2.5 text-[12.5px] text-text-secondary">
          Sending{" "}
          <code className="rounded bg-surface-chip px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
            SIGKILL
          </code>{" "}
          to{" "}
          <span className="font-semibold text-text-primary">{process.mainClass}</span> (PID{" "}
          {process.pid}). The process will be terminated immediately with no cleanup.
        </p>
        <div className="mt-4 rounded-[10px] border border-danger/20 bg-danger/5 px-4 py-2.5 font-mono text-[11.5px] text-text-secondary">
          kill -9 {process.pid}
        </div>
        <div className="mt-4 text-center text-[22px] font-bold text-danger">{count}</div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-input border border-border-input px-4 py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-input bg-danger px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Kill Now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Process detail side panel ─────────────────────────────────────────────────

function DetailPanel({
  detail,
  onClose,
}: {
  detail: ProcessDetail;
  onClose: () => void;
}) {
  return (
    <div className="flex w-[380px] flex-shrink-0 flex-col border-l border-border bg-surface-pane">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Coffee size={14} strokeWidth={2} className="flex-shrink-0 text-orange-500" />
        <span className="flex-1 truncate text-[13px] font-semibold text-text-primary">
          PID {detail.pid}
        </span>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Main Class */}
        <div className="mb-4">
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-text-tertiary">
            Main Class / JAR
          </p>
          <p className="text-[12.5px] font-semibold text-text-accent">{detail.mainClass}</p>
        </div>

        {/* Memory */}
        <div className="mb-4">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-text-tertiary">
            Memory
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-[8px] bg-surface-chip px-3 py-2">
              <p className="text-[10px] text-text-tertiary">RSS</p>
              <p className="text-[12.5px] font-semibold text-text-primary">
                {fmtMem(detail.vmRssKb)}
              </p>
            </div>
            <div className="rounded-[8px] bg-surface-chip px-3 py-2">
              <p className="text-[10px] text-text-tertiary">Virtual</p>
              <p className="text-[12.5px] font-semibold text-text-primary">
                {fmtMem(detail.vmSizeKb)}
              </p>
            </div>
            <div className="rounded-[8px] bg-surface-chip px-3 py-2">
              <p className="text-[10px] text-text-tertiary">Threads</p>
              <p className="text-[12.5px] font-semibold text-text-primary">
                {detail.threads.toString()}
              </p>
            </div>
          </div>
        </div>

        {/* JVM Flags */}
        {detail.jvmFlags.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-text-tertiary">
              JVM Flags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {detail.jvmFlags.map((f, i) => (
                <span
                  key={i}
                  className="rounded-chip bg-surface-chip px-2 py-0.5 font-mono text-[10.5px] text-text-secondary"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* System Props */}
        {detail.systemProps.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-text-tertiary">
              System Properties (-D)
            </p>
            <div className="flex flex-col gap-1">
              {detail.systemProps.map((p, i) => (
                <span
                  key={i}
                  className="rounded-chip bg-surface-chip px-2 py-1 font-mono text-[10.5px] text-text-secondary"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Full cmdline */}
        <div>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-text-tertiary">
            Full Command
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[8px] bg-surface-chip p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary">
            {detail.fullCmdline}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── Logs drawer ───────────────────────────────────────────────────────────────

function LogsDrawer({
  logs,
  onClose,
}: {
  logs: ProcessLogEntry[];
  onClose: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="flex w-[480px] flex-shrink-0 flex-col border-l border-border bg-surface-pane">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex-1 text-[12.5px] font-semibold text-text-primary">
          Commands ({logs.length})
        </span>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {logs.length === 0 && (
          <p className="text-center text-[12px] text-text-faint">No commands yet</p>
        )}
        {logs.map((log) => (
          <div key={log.id} className="mb-2 rounded-[8px] bg-surface-chip px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-semibold uppercase ${
                  log.level === "error"
                    ? "text-danger"
                    : log.level === "warn"
                      ? "text-warning"
                      : "text-success"
                }`}
              >
                {log.level}
              </span>
              <span className="text-[10px] text-text-tertiary">{log.source}</span>
              {log.durationMs != null && (
                <span className="ml-auto text-[10px] text-text-faint">
                  {log.durationMs.toString()}ms
                </span>
              )}
            </div>
            <p className="mt-0.5 font-mono text-[10.5px] text-text-secondary">{log.message}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProcessMonitorPage({ host, username, onClose }: ProcessMonitorPageProps) {
  const { state, refresh, fetchDetail, fetchThreadDump, killProcess, refreshInterval, setRefreshInterval } =
    useProcessMonitor();

  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [threadDump, setThreadDump] = useState<{ pid: number; content: string } | null>(null);

  // Confirm dialogs
  const [killConfirm, setKillConfirm] = useState<JavaProcess | null>(null);
  const [forceKillConfirm, setForceKillConfirm] = useState<JavaProcess | null>(null);
  const [threadDumpConfirm, setThreadDumpConfirm] = useState<JavaProcess | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSelectProcess = useCallback(
    async (p: JavaProcess) => {
      setSelectedPid(p.pid);
      const d = await fetchDetail(p.pid);
      setDetail(d);
    },
    [fetchDetail],
  );

  const handleKillConfirmed = useCallback(async () => {
    if (!killConfirm) return;
    setBusy(true);
    setKillConfirm(null);
    await killProcess(killConfirm.pid, false);
    if (selectedPid === killConfirm.pid) {
      setSelectedPid(null);
      setDetail(null);
    }
    setBusy(false);
  }, [killConfirm, killProcess, selectedPid]);

  const handleForceKillConfirmed = useCallback(async () => {
    if (!forceKillConfirm) return;
    setBusy(true);
    setForceKillConfirm(null);
    await killProcess(forceKillConfirm.pid, true);
    if (selectedPid === forceKillConfirm.pid) {
      setSelectedPid(null);
      setDetail(null);
    }
    setBusy(false);
  }, [forceKillConfirm, killProcess, selectedPid]);

  const handleThreadDumpConfirmed = useCallback(async () => {
    if (!threadDumpConfirm) return;
    const pid = threadDumpConfirm.pid;
    setThreadDumpConfirm(null);
    setBusy(true);
    const content = await fetchThreadDump(pid);
    setBusy(false);
    setThreadDump({ pid, content });
  }, [threadDumpConfirm, fetchThreadDump]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface">
      {/* Top Nav */}
      <div
        className="flex flex-none items-center gap-3 border-b border-border px-5 py-2.5"
        style={{ background: "#efede8" }}
      >
        {/* Logo + title */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[10px]"
            style={{ background: "linear-gradient(150deg, #f97316, #ea580c)" }}
          >
            <Coffee size={14} strokeWidth={2.2} className="text-white" />
          </div>
          <span className="text-[14px] font-semibold text-text-heading">Java Monitor</span>
        </div>

        {/* Host pill */}
        <div
          className="flex items-center gap-1.5 rounded-chip border px-2.5 py-1 text-[11.5px] font-medium"
          style={{
            background: "rgba(31,157,99,0.08)",
            borderColor: "rgba(31,157,99,0.25)",
            color: "#177a4c",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {username}@{host}
        </div>

        {/* Last refreshed */}
        {state.lastRefreshed && (
          <span className="text-[11.5px] text-text-tertiary">
            Refreshed {relativeTime(state.lastRefreshed)}
          </span>
        )}

        <div className="flex-1" />

        {/* Auto-refresh selector */}
        <div className="flex items-center gap-1 rounded-input border border-border-input bg-surface-chip px-1 py-0.5">
          {([10, 30, 0] as const).map((v) => (
            <button
              key={v}
              onClick={() => setRefreshInterval(v)}
              className={`rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                refreshInterval === v
                  ? "bg-white text-text-primary shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {v === 0 ? "Off" : `${v.toString()}s`}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          onClick={() => void refresh()}
          disabled={state.loading || busy}
          className="flex items-center gap-1.5 rounded-input border border-border-input bg-surface-pane px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            strokeWidth={2}
            className={state.loading ? "animate-spin" : ""}
          />
          Refresh
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Process table */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Column header */}
          <div
            className="grid flex-none select-none items-center gap-3 border-b border-border-raised px-4 font-mono text-[11px] font-medium tracking-[0.2px] text-text-tertiary"
            style={{
              height: "32px",
              background: "#ece9e3",
              gridTemplateColumns: "2fr 60px 60px 60px 60px 80px 100px 260px",
            }}
          >
            <span>App / JAR</span>
            <span>PID</span>
            <span>User</span>
            <span>CPU %</span>
            <span>Mem %</span>
            <span>Uptime</span>
            <span>Ports</span>
            <span>Actions</span>
          </div>

          {/* Rows */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Loading / error / empty */}
            {state.loading && state.processes.length === 0 && (
              <div className="flex h-full items-center justify-center gap-2 text-[13px] text-text-faint">
                <RefreshCw size={14} strokeWidth={2} className="animate-spin" />
                Scanning for Java processes…
              </div>
            )}

            {!state.loading && state.error && (
              <div className="flex h-full items-center justify-center text-[13px] text-danger">
                {state.error}
              </div>
            )}

            {!state.loading && !state.error && state.processes.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-text-faint">
                <Coffee size={32} strokeWidth={1.5} className="text-text-faint/40" />
                <p className="text-[13px]">No Java processes running</p>
                <p className="font-mono text-[11px] text-text-faint/70">
                  ps -eo args | grep java | grep -v grep
                </p>
              </div>
            )}

            {state.processes.map((p) => {
              const isSelected = p.pid === selectedPid;
              return (
                <div
                  key={p.pid}
                  onClick={() => void handleSelectProcess(p)}
                  className={`grid cursor-pointer items-center gap-3 border-b border-subtle px-4 py-2 transition-colors ${
                    isSelected
                      ? "bg-[rgba(47,107,219,0.07)]"
                      : "hover:bg-surface-hover"
                  }`}
                  style={{
                    gridTemplateColumns: "2fr 60px 60px 60px 60px 80px 100px 260px",
                  }}
                >
                  {/* App name */}
                  <div className="flex min-w-0 items-center gap-2">
                    {isSelected && (
                      <ChevronRight size={12} strokeWidth={2.5} className="flex-shrink-0 text-text-accent" />
                    )}
                    <span className="truncate text-[12.5px] font-medium text-text-primary">
                      {p.mainClass}
                    </span>
                  </div>

                  <span className="font-mono text-[11.5px] text-text-secondary">{p.pid}</span>
                  <span className="truncate text-[11.5px] text-text-secondary">{p.user}</span>
                  <span
                    className={`font-mono text-[11.5px] ${p.cpuPct > 80 ? "font-semibold text-danger" : p.cpuPct > 40 ? "text-warning" : "text-text-secondary"}`}
                  >
                    {p.cpuPct.toFixed(1)}
                  </span>
                  <span className="font-mono text-[11.5px] text-text-secondary">
                    {p.memPct.toFixed(1)}
                  </span>
                  <span className="font-mono text-[11px] text-text-tertiary">{p.etime}</span>
                  <span className="font-mono text-[11px] text-text-tertiary">
                    {p.ports.length > 0 ? p.ports.join(", ") : "—"}
                  </span>

                  {/* Action buttons */}
                  <div
                    className="flex items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Thread Dump */}
                    <button
                      onClick={() => setThreadDumpConfirm(p)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-chip border border-warning/60 px-2 py-0.5 text-[10.5px] font-medium text-warning transition-colors hover:bg-warning/10 disabled:opacity-40"
                      title="Capture thread dump"
                    >
                      <TerminalSquare size={10} strokeWidth={2} />
                      Thread Dump
                    </button>

                    {/* Kill (SIGTERM) */}
                    <button
                      onClick={() => setKillConfirm(p)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-chip border border-danger/60 px-2 py-0.5 text-[10.5px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
                      title="Graceful shutdown (SIGTERM)"
                    >
                      Kill
                    </button>

                    {/* Force Kill (SIGKILL) */}
                    <button
                      onClick={() => setForceKillConfirm(p)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-chip bg-danger px-2 py-0.5 text-[10.5px] font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                      title="Force kill (SIGKILL)"
                    >
                      <Zap size={10} strokeWidth={2.5} />
                      Force
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail side panel */}
        {selectedPid && detail && (
          <DetailPanel
            detail={detail}
            onClose={() => {
              setSelectedPid(null);
              setDetail(null);
            }}
          />
        )}

        {/* Logs drawer */}
        {showLogs && (
          <LogsDrawer logs={state.logs} onClose={() => setShowLogs(false)} />
        )}
      </div>

      {/* Floating commands pill */}
      <button
        onClick={() => setShowLogs((v) => !v)}
        className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-chip border border-border-raised bg-surface-chip px-2.5 py-1 text-[11px] text-text-secondary shadow-sm transition-colors hover:bg-surface-hover"
      >
        <TerminalSquare size={11} strokeWidth={2} />
        Commands ({state.logs.length})
      </button>

      {/* Confirmation dialogs */}
      {threadDumpConfirm && (
        <ConfirmDialog
          title={`Thread Dump — ${threadDumpConfirm.mainClass}`}
          message={`This sends SIGQUIT to PID ${threadDumpConfirm.pid.toString()} to capture a thread snapshot. The process will continue running normally.\n\nCommand: jstack ${threadDumpConfirm.pid.toString()}`}
          confirmLabel="Capture"
          onConfirm={() => void handleThreadDumpConfirmed()}
          onCancel={() => setThreadDumpConfirm(null)}
        />
      )}

      {killConfirm && (
        <ConfirmDialog
          title={`Kill — ${killConfirm.mainClass}`}
          message={`Send SIGTERM to PID ${killConfirm.pid.toString()} (${killConfirm.mainClass}). The process will have a chance to shut down gracefully.\n\nCommand: kill -15 ${killConfirm.pid.toString()}`}
          confirmLabel="Kill (SIGTERM)"
          onConfirm={() => void handleKillConfirmed()}
          onCancel={() => setKillConfirm(null)}
        />
      )}

      {forceKillConfirm && (
        <ForceKillModal
          process={forceKillConfirm}
          onConfirm={() => void handleForceKillConfirmed()}
          onCancel={() => setForceKillConfirm(null)}
        />
      )}

      {/* Thread dump output modal */}
      {threadDump && (
        <ThreadDumpModal
          pid={threadDump.pid}
          content={threadDump.content}
          onClose={() => setThreadDump(null)}
        />
      )}
    </div>
  );
}
