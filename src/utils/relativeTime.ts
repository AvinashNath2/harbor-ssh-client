/**
 * Human-friendly relative timestamp: "just now", "5m ago", "2h ago", "yesterday",
 * "3d ago", or an absolute short date once older than a week.
 */
export function relativeTime(ts: number | undefined): string {
  if (ts == null) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);

  if (diffSec < 45) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60).toString()}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600).toString()}h ago`;
  if (diffSec < 172800) return "yesterday";
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400).toString()}d ago`;

  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
