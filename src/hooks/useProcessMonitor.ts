import { useCallback, useEffect, useRef, useState } from "react";
import {
  processDetail,
  processKill,
  processListJava,
  processVmMemory,
  type JavaProcess,
  type ProcessDetail,
  type VmMemory,
} from "../api";

export interface ProcessLogEntry {
  id: number;
  ts: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  durationMs?: number;
}

export interface ProcessMonitorState {
  loading: boolean;
  error: string | null;
  processes: JavaProcess[];
  vmMemory: VmMemory | null;
  logs: ProcessLogEntry[];
  lastRefreshed: number | null;
}

const MAX_LOGS = 200;
let _logId = 0;

export function useProcessMonitor() {
  const [state, setState] = useState<ProcessMonitorState>({
    loading: true,
    error: null,
    processes: [],
    vmMemory: null,
    logs: [],
    lastRefreshed: null,
  });

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<10 | 30 | 0>(10);

  const addLog = useCallback(
    (entry: Omit<ProcessLogEntry, "id" | "ts">) => {
      const log: ProcessLogEntry = { id: ++_logId, ts: Date.now(), ...entry };
      setState((s) => ({
        ...s,
        logs: [...s.logs.slice(-(MAX_LOGS - 1)), log],
      }));
    },
    [],
  );

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const t0 = Date.now();
    addLog({
      level: "info",
      source: "cmd",
      message: "ps -eo pid,user,pcpu,pmem,rss,etime,args 2>/dev/null | grep java | grep -v grep",
    });

    try {
      const [processes, vmMemory] = await Promise.all([
        processListJava(),
        processVmMemory(),
      ]);
      const dur = Date.now() - t0;
      addLog({
        level: "info",
        source: "fetch",
        message: `Found ${processes.length.toString()} Java process(es)`,
        durationMs: dur,
      });
      addLog({
        level: "info",
        source: "memory",
        message: `free -b | awk 'NR==2{print $2,$3,$7}' → total=${vmMemory.totalBytes.toString()} used=${vmMemory.usedBytes.toString()} avail=${vmMemory.availableBytes.toString()} javaRss=${vmMemory.javaRssBytes.toString()}`,
      });
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: null,
          processes,
          vmMemory,
          lastRefreshed: Date.now(),
        }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog({ level: "error", source: "fetch", message: msg });
      if (mountedRef.current) {
        setState((s) => ({ ...s, loading: false, error: msg }));
      }
    }
  }, [addLog]);

  // Auto-refresh
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => void refresh(), refreshInterval * 1000);
    }
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh, refreshInterval]);

  const fetchDetail = useCallback(
    async (pid: number): Promise<ProcessDetail | null> => {
      const t0 = Date.now();
      addLog({
        level: "info",
        source: "cmd",
        message: `cat /proc/${pid.toString()}/cmdline | tr '\\0' ' ' && cat /proc/${pid.toString()}/status`,
      });
      try {
        const detail = await processDetail(pid);
        addLog({
          level: "info",
          source: "detail",
          message: `PID ${pid.toString()} detail loaded`,
          durationMs: Date.now() - t0,
        });
        return detail;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog({ level: "error", source: "detail", message: msg });
        return null;
      }
    },
    [addLog],
  );

  const killProcess = useCallback(
    async (pid: number, force: boolean): Promise<boolean> => {
      const sig = force ? "kill -9" : "kill -15";
      const t0 = Date.now();
      addLog({ level: "warn", source: "cmd", message: `${sig} ${pid.toString()}` });
      try {
        await processKill(pid, force);
        addLog({
          level: "info",
          source: "kill",
          message: `PID ${pid.toString()} killed (${force ? "SIGKILL" : "SIGTERM"})`,
          durationMs: Date.now() - t0,
        });
        await refresh();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog({ level: "error", source: "kill", message: msg });
        return false;
      }
    },
    [addLog, refresh],
  );

  return {
    state,
    refresh,
    fetchDetail,
    killProcess,
    refreshInterval,
    setRefreshInterval,
  };
}
