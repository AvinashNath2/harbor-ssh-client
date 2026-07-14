import { useEffect, useRef } from "react";
import { pingConnection } from "../api";

const IDLE_PING_INTERVAL_MS = 30_000; // background heartbeat when idle
const FOCUS_DEBOUNCE_MS = 200; // avoid flooding on rapid tab switches

/**
 * Proactively detects when the SSH session has dropped underneath the UI
 * (laptop sleep, network switch, server killed, etc). Runs cheap SFTP pings
 * on window focus, tab visibility change, and every 30 s while connected.
 *
 * On a failing ping we call `onDrop()` — the app's existing `handleConnectionLost`
 * flow, which shows the amber reconnecting banner and attempts recovery.
 *
 * @param enabled  true while a session is live; set false to disable
 * @param onDrop   invoked when a ping call fails
 */
export function useConnectionWatchdog(enabled: boolean, onDrop: () => void) {
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // Single flight — never run two overlapping pings.
  const inflightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let lastFocusPingAt = 0;
    let cancelled = false;

    async function ping() {
      if (inflightRef.current) return;
      inflightRef.current = true;
      try {
        await pingConnection();
      } catch {
        if (!cancelled) onDropRef.current();
      } finally {
        inflightRef.current = false;
      }
    }

    function pingIfDueToFocus() {
      const now = Date.now();
      if (now - lastFocusPingAt < FOCUS_DEBOUNCE_MS) return;
      lastFocusPingAt = now;
      void ping();
    }

    function onFocus() { pingIfDueToFocus(); }
    function onVisibility() {
      if (document.visibilityState === "visible") pingIfDueToFocus();
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => { void ping(); }, IDLE_PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [enabled]);
}
