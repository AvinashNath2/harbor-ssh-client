import { useEffect, useState } from "react";
import { formatEtaRemaining } from "../utils/formatEta";
import { InlineBanner } from "./InlineBanner";

interface StaleListingBannerProps {
  variant?: "cached" | "loading";
  loadedCount?: number;
  totalCount?: number;
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
  variant = "cached",
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

  const description = [progress, eta].filter(Boolean).join(" · ");
  const title = variant === "cached" ? "Showing cached listing — not latest" : "Loading directory…";

  return <InlineBanner variant="loading" title={title} description={description} />;
}
