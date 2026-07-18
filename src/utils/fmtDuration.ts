/** Formats a command duration (milliseconds) into a human-readable string. */
export function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms.toString()}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (m < 60) return `${m.toString()}m ${s.toString()}s`;
  return `${Math.floor(m / 60).toString()}h ${(m % 60).toString()}m`;
}

/** Formats the total duration of a session. */
export function fmtSessionDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return "Active";
  const s = Math.floor((endMs - startMs) / 1000);
  if (s < 60) return `${s.toString()}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m.toString()}m`;
  return `${Math.floor(m / 60).toString()}h ${(m % 60).toString()}m`;
}
