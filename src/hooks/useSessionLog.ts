import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendCommand,
  closeSession,
  createSession,
  type CommandSource,
  type ConnectResult,
  type ConnectionProfile,
} from "../api";

export interface PendingCommand {
  executedAt: number;
  cwd: string;
  raw: string;
  exitCode: number | null;
  durationMs: number | null;
  output: string | null;
  outputTruncated: boolean;
  originalOutputBytes: number;
  source: CommandSource;
}

export function useSessionLog(
  isConnected: boolean,
  connectResult: ConnectResult | null,
  activeProfile: ConnectionProfile | null = null,
) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Use a ref so logCommand closure is always stable and sees the current id.
  const sessionIdRef = useRef<string | null>(null);
  // Per-session command counter (reset each new session).
  const cmdIdxRef = useRef(0);

  useEffect(() => {
    if (!isConnected || !connectResult) {
      if (sessionIdRef.current) {
        closeSession(sessionIdRef.current, Date.now()).catch(() => undefined);
        sessionIdRef.current = null;
        setSessionId(null);
        cmdIdxRef.current = 0;
      }
      return;
    }

    let cancelled = false;
    createSession(
      connectResult.host,
      connectResult.ipAddr,
      connectResult.username,
      activeProfile?.id ?? null,
      activeProfile?.name ?? null,
    )
      .then((id) => {
        if (cancelled) {
          closeSession(id, Date.now()).catch(() => undefined);
          return;
        }
        sessionIdRef.current = id;
        cmdIdxRef.current = 0;
        setSessionId(id);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (sessionIdRef.current) {
        closeSession(sessionIdRef.current, Date.now()).catch(() => undefined);
        sessionIdRef.current = null;
        setSessionId(null);
        cmdIdxRef.current = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, connectResult?.host]);

  const logCommand = useCallback((cmd: PendingCommand) => {
    const sid = sessionIdRef.current;
    if (!sid || !cmd.raw.trim()) return;
    const idx = ++cmdIdxRef.current;
    appendCommand({ sessionId: sid, idx, ...cmd }).catch(() => undefined);
  }, []);

  return { sessionId, logCommand };
}
