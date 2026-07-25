import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  Loader2,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  dockerAvailable,
  listDockerContainers,
  listDockerNetworks,
  listDockerVolumes,
} from "../api";

interface DockerPreflightProps {
  onProceed: () => void;
  onCancel: () => void;
}

type CheckStatus = "pending" | "running" | "ok" | "warn" | "fail";

interface Check {
  key: string;
  label: string;
  detail?: string;
  status: CheckStatus;
  critical: boolean;
}

const INITIAL_CHECKS: Check[] = [
  {
    key: "ssh",
    label: "SSH session is connected",
    status: "pending",
    critical: true,
  },
  {
    key: "docker",
    label: "Docker CLI is installed on the host",
    status: "pending",
    critical: true,
  },
  {
    key: "daemon",
    label: "Docker daemon is responding",
    status: "pending",
    critical: true,
  },
  {
    key: "resources",
    label: "Resources are available to display",
    status: "pending",
    critical: false,
  },
];

export function DockerPreflight({ onProceed, onCancel }: DockerPreflightProps) {
  const [checks, setChecks] = useState<Check[]>(INITIAL_CHECKS);
  const [running, setRunning] = useState(false);
  const [autoProceeded, setAutoProceeded] = useState(false);

  const updateCheck = useCallback((key: string, patch: Partial<Omit<Check, "key">>) => {
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  const runChecks = useCallback(async () => {
    setRunning(true);
    setChecks(INITIAL_CHECKS.map((c) => ({ ...c })));

    // Check 1 — SSH session. If dockerAvailable throws NOT_CONNECTED we know it's dead.
    updateCheck("ssh", { status: "running" });

    // Check 2 — Docker CLI + daemon (combined via `docker info`).
    updateCheck("docker", { status: "running" });
    let dockerOk = false;
    try {
      dockerOk = await dockerAvailable();
      updateCheck("ssh", { status: "ok", detail: "connected" });
      updateCheck("docker", {
        status: dockerOk ? "ok" : "fail",
        detail: dockerOk ? "installed" : "docker command not found on host",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const notConnected = msg.toLowerCase().includes("not connected");
      updateCheck("ssh", {
        status: notConnected ? "fail" : "warn",
        detail: notConnected ? "SSH session is not connected" : msg,
      });
      updateCheck("docker", {
        status: "fail",
        detail: "Could not run docker on the host",
      });
      updateCheck("daemon", { status: "fail", detail: "skipped" });
      updateCheck("resources", { status: "fail", detail: "skipped" });
      setRunning(false);
      return;
    }

    // Check 3 — daemon responds (docker command already used daemon, so if Ok we mark Ok).
    if (dockerOk) {
      updateCheck("daemon", { status: "ok", detail: "responding to `docker info`" });
    } else {
      updateCheck("daemon", { status: "fail", detail: "cannot reach daemon" });
      updateCheck("resources", { status: "fail", detail: "skipped" });
      setRunning(false);
      return;
    }

    // Check 4 — list containers/networks/volumes; empty is warn, not fail.
    updateCheck("resources", { status: "running" });
    try {
      const [cs, ns, vs] = await Promise.all([
        listDockerContainers(),
        listDockerNetworks(),
        listDockerVolumes(),
      ]);
      const total = cs.length + ns.length + vs.length;
      updateCheck("resources", {
        status: total > 0 ? "ok" : "warn",
        detail:
          total > 0
            ? `${String(cs.length)} container${cs.length === 1 ? "" : "s"} · ${String(ns.length)} network${ns.length === 1 ? "" : "s"} · ${String(vs.length)} volume${vs.length === 1 ? "" : "s"}`
            : "no containers, networks or volumes yet (Docker Explorer will still open)",
      });
    } catch (e) {
      updateCheck("resources", {
        status: "warn",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    setRunning(false);
  }, [updateCheck]);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const criticalFail = checks.some((c) => c.critical && c.status === "fail");
  const anyRunning = checks.some((c) => c.status === "running" || c.status === "pending");
  const canProceed = !criticalFail && !anyRunning;

  // Auto-proceed after a short delay if all critical checks pass — saves the
  // extra click for the common case.
  useEffect(() => {
    if (canProceed && !autoProceeded) {
      const t = setTimeout(() => {
        setAutoProceeded(true);
        onProceed();
      }, 700);
      return () => {
        clearTimeout(t);
      };
    }
    return undefined;
  }, [canProceed, autoProceeded, onProceed]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-[440px] overflow-hidden rounded-modal bg-surface-pane shadow-modal">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Box size={16} className="text-accent-dark" />
            <div>
              <h2 className="text-[13.5px] font-semibold text-text-primary">
                Preparing Docker Infrastructure
              </h2>
              <p className="text-[10.5px] text-text-tertiary">
                Running a quick pre-flight before opening the dashboard.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="rounded-chip p-1 text-text-secondary hover:bg-surface-chip hover:text-text-primary"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3">
          <ul className="flex flex-col gap-1.5">
            {checks.map((c) => (
              <CheckRow key={c.key} check={c} />
            ))}
          </ul>

          {criticalFail && (
            <div className="mt-3 rounded-input border border-danger/30 bg-danger/5 p-3">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-danger">
                <AlertTriangle size={12} />
                Cannot open Docker Explorer
              </p>
              <p className="mt-1 text-[11px] text-text-secondary">
                One or more required checks failed. Fix the issues above on the remote host, then
                click <span className="font-semibold">Retry</span>.
              </p>
              <div className="mt-2 rounded-input bg-surface-input px-2.5 py-1.5 font-mono text-[10.5px] text-text-secondary">
                <span className="font-semibold text-text-primary"># quick fixes:</span>
                {"\n"}sudo systemctl start docker
                {"\n"}sudo usermod -aG docker $USER # then re-login
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface-toolbar px-4 py-2.5">
          <button
            onClick={() => {
              void runChecks();
            }}
            disabled={running}
            className="flex items-center gap-1.5 rounded-input border border-border-input px-3 py-1.5 text-[11.5px] font-medium text-text-secondary hover:bg-surface-chip disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={11} className={running ? "animate-spin" : ""} />
            Retry
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onCancel}
              className="rounded-input px-3 py-1.5 text-[11.5px] font-medium text-text-secondary hover:bg-surface-chip hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={onProceed}
              disabled={!canProceed}
              className="flex items-center gap-1.5 rounded-input bg-accent-dark px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open Explorer
              <ArrowRight size={11} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  return (
    <li className="flex items-start gap-2 rounded-input border border-border-subtle px-2.5 py-1.5">
      <div className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center">
        {check.status === "ok" ? (
          <Check size={12} className="text-success" />
        ) : check.status === "fail" ? (
          <X size={12} className="text-danger" />
        ) : check.status === "warn" ? (
          <AlertTriangle size={11} className="text-warning" />
        ) : check.status === "running" ? (
          <Loader2 size={12} className="animate-spin text-accent-dark" />
        ) : (
          <ChevronRight size={12} className="text-text-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11.5px] font-medium ${
            check.status === "fail"
              ? "text-danger"
              : check.status === "warn"
                ? "text-warning"
                : "text-text-primary"
          }`}
        >
          {check.label}
        </p>
        {check.detail && <p className="mt-0.5 text-[10.5px] text-text-tertiary">{check.detail}</p>}
      </div>
      <Server size={0} className="hidden" />
    </li>
  );
}
