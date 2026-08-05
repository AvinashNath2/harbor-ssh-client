// Health thresholds — editable in Settings tab (Phase 4).
// Values are percentage thresholds for disk-mount fullness.
export interface StorageThresholds {
  mountWarn: number; // orange starts here
  mountDanger: number; // red starts here
  mountCrit: number; // critical starts here
  folderWarn: number; // folder ratio warn
  folderDanger: number;
  folderCrit: number;
}

export const DEFAULT_THRESHOLDS: StorageThresholds = {
  mountWarn: 70,
  mountDanger: 85,
  mountCrit: 95,
  folderWarn: 5,
  folderDanger: 15,
  folderCrit: 40,
};

export type HealthTier = "ok" | "warn" | "danger" | "crit";

export function mountHealth(usePct: number, t = DEFAULT_THRESHOLDS): HealthTier {
  if (usePct >= t.mountCrit) return "crit";
  if (usePct >= t.mountDanger) return "danger";
  if (usePct >= t.mountWarn) return "warn";
  return "ok";
}

export function folderHealth(ratio: number, t = DEFAULT_THRESHOLDS): HealthTier {
  if (ratio >= t.folderCrit) return "crit";
  if (ratio >= t.folderDanger) return "danger";
  if (ratio >= t.folderWarn) return "warn";
  return "ok";
}

export const HEALTH_COLOR: Record<HealthTier, string> = {
  ok: "#22c55e",
  warn: "#f59e0b",
  danger: "#f97316",
  crit: "#ef4444",
};

export const HEALTH_BG: Record<HealthTier, string> = {
  ok: "rgba(34,197,94,0.12)",
  warn: "rgba(245,158,11,0.12)",
  danger: "rgba(249,115,22,0.12)",
  crit: "rgba(239,68,68,0.12)",
};

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log2(bytes) / 10);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
