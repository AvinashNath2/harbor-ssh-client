import { useCallback, useEffect, useRef, useState } from "react";
import {
  processDetail,
  processKill,
  processListJava,
  processThreadDump,
  type JavaProcess,
  type ProcessDetail,
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
    const cmd =
      "ps -eo pid,user,pcpu,pmem,etime,args --no-headers | grep java | grep -v grep";
    addLog({ level: "info", source: "cmd", message: cmd });

    try {
      const processes = await processListJava();
      const dur = Date.now() - t0;
      addLog({
        level: "info",
        source: "fetch",
        message: `Found ${processes.length.toString()} Java process(es)`,
        durationMs: dur,
      });
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          loading: false,
          error: null,
          processes,
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

  const fetchThreadDump = useCallback(
    async (pid: number): Promise<string> => {
      const t0 = Date.now();
      addLog({
        level: "info",
        source: "cmd",
        message: `jstack ${pid.toString()} 2>/dev/null || kill -3 ${pid.toString()}`,
      });
      try {
        const dump = await processThreadDump(pid);
        addLog({
          level: "info",
          source: "thread-dump",
          message: `Thread dump captured for PID ${pid.toString()} (${dump.length.toString()} bytes)`,
          durationMs: Date.now() - t0,
        });
        return dump;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog({ level: "error", source: "thread-dump", message: msg });
        return `Error: ${msg}`;
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
        // Refresh after kill
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
    fetchThreadDump,
    killProcess,
    refreshInterval,
    setRefreshInterval,
  };
}
