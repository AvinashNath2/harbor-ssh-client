/** Format milliseconds as a human-readable ETA, e.g. "~45 sec remaining". */
export function formatEtaRemaining(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return "";
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `~${sec.toString()} sec remaining`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `~${min.toString()} min remaining`;
  return `~${Math.ceil(min / 60).toString()} hr remaining`;
}
