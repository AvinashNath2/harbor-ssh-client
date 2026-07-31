import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatEtaRemaining } from "../utils/formatEta";

interface StaleListingBannerProps {
  loadedCount?: number;
  totalCount?: number;
  /** Last full load duration from cache (ms) — basis for ETA when total unknown. */
  estimatedLoadMs?: number;
  refreshStartedAt?: number;
}

function computeRemainingMs(
  loadedCount: number,
  totalCount: number | undefined,
  estimatedLoadMs: number | undefined,
  elapsedMs: number,
): number | null {
  if (totalCount != null && totalCount > 0 && loadedCount > 0 && elapsedMs > 500) {
    const rate = loadedCount / elapsedMs;
    if (rate > 0) return (totalCount - loadedCount) / rate;
  }
  if (estimatedLoadMs != null && estimatedLoadMs > 0) {
    const total = totalCount ?? loadedCount;
    if (total > 0 && loadedCount > 0) {
      const progress = Math.min(loadedCount / total, 0.99);
      return estimatedLoadMs * (1 - progress) - elapsedMs;
    }
    return estimatedLoadMs - elapsedMs;
  }
  return null;
}

export function StaleListingBanner({
  loadedCount = 0,
  totalCount,
  estimatedLoadMs,
  refreshStartedAt,
}: StaleListingBannerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  const elapsedMs = refreshStartedAt != null ? now - refreshStartedAt : 0;
  const remainingMs = computeRemainingMs(loadedCount, totalCount, estimatedLoadMs, elapsedMs);
  const eta = remainingMs != null ? formatEtaRemaining(remainingMs) : "";

  const progress =
    totalCount != null && totalCount > 0
      ? `Updating… ${loadedCount.toLocaleString()} / ${totalCount.toLocaleString()}`
      : loadedCount > 0
        ? `Updating… ${loadedCount.toLocaleString()} loaded`
        : "Updating…";

  const suffix = [progress, eta].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-none items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-3.5 py-1.5">
      <Loader2 size={13} strokeWidth={2.2} className="flex-shrink-0 animate-spin text-amber-600" />
      <AlertCircle size={13} strokeWidth={2.2} className="flex-shrink-0 text-amber-600" />
      <span className="text-[11.5px] text-amber-800 dark:text-amber-200">
        Showing cached listing — not latest
        <span className="ml-1.5 font-mono text-[10.5px] opacity-80">{suffix}</span>
      </span>
    </div>
  );
}
