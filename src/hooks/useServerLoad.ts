import { useEffect, useRef, useState } from "react";
import { storageSystemLoad, type SystemLoad } from "../api";

export interface ServerLoadSample extends SystemLoad {
  /** Wall-clock time when the sample was taken (client-side). */
  ts: number;
}

export interface ServerLoadState {
  latest: ServerLoadSample | null;
  history: ServerLoadSample[];
  /** True if a poll has been in-flight for longer than `stallThresholdMs`.
   *  Almost always means the SSH mutex is held by a scan; the UI can dim itself. */
  stalled: boolean;
  error: string | null;
}

interface Options {
  /** Poll cadence in milliseconds. Default 5000. */
  intervalMs?: number;
  /** How many samples to keep in `history` (for sparklines). Default 30. */
  historySize?: number;
  /** After a poll takes longer than this, mark `stalled = true`. Default 3000. */
  stallThresholdMs?: number;
}

/**
 * Polls the remote server for CPU load + RAM every `intervalMs` while `enabled`
 * is true. Skips scheduling entirely when disabled.
 *
 * Caveat: `storage_system_load` shares the same SSH mutex as any running scan,
 * so if a heavy scan is in flight the poll will block until it finishes. The
 * `stalled` flag lets the UI show a "sampling…" hint in that window instead
 * of pretending everything is fine.
 */
export function useServerLoad(enabled: boolean, options: Options = {}): ServerLoadState {
  const intervalMs = options.intervalMs ?? 5000;
  const historySize = options.historySize ?? 30;
  const stallThresholdMs = options.stallThresholdMs ?? 3000;

  const [latest, setLatest] = useState<ServerLoadSample | null>(null);
  const [history, setHistory] = useState<ServerLoadSample[]>([]);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    cancelledRef.current = false;

    let timer: number | undefined;
    let stallTimer: number | undefined;

    async function poll() {
      stallTimer = window.setTimeout(() => {
        if (!cancelledRef.current) setStalled(true);
      }, stallThresholdMs);

      try {
        const load = await storageSystemLoad();
        if (cancelledRef.current) return;
        const sample: ServerLoadSample = { ...load, ts: Date.now() };
        setLatest(sample);
        setHistory((prev) => {
          const next = [...prev, sample];
          if (next.length > historySize) next.splice(0, next.length - historySize);
          return next;
        });
        setStalled(false);
        setError(null);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        window.clearTimeout(stallTimer);
        if (!cancelledRef.current) {
          timer = window.setTimeout(() => {
            void poll();
          }, intervalMs);
        }
      }
    }

    void poll();

    return () => {
      cancelledRef.current = true;
      window.clearTimeout(timer);
      window.clearTimeout(stallTimer);
    };
  }, [enabled, intervalMs, historySize, stallThresholdMs]);

  return { latest, history, stalled, error };
}
