import type { FolderSize } from "../api";

export interface CategoryBucket {
  name: string;
  bytes: number;
  color: string;
  paths: string[];
}

// Ordered rules: first match wins. Each rule maps a path prefix to a category.
// More specific paths must come before broader ones (e.g. /var/lib/docker before /var/lib).
const RULES: { prefix: string; category: string }[] = [
  { prefix: "/var/lib/docker", category: "Docker" },
  { prefix: "/var/lib/mysql", category: "Databases" },
  { prefix: "/var/lib/postgresql", category: "Databases" },
  { prefix: "/var/lib/pgsql", category: "Databases" },
  { prefix: "/var/log", category: "Logs" },
  { prefix: "/var/cache", category: "Cache" },
  { prefix: "/var/tmp", category: "Temporary" },
  { prefix: "/var/lib", category: "System Libs" },
  { prefix: "/home", category: "User Files" },
  { prefix: "/root", category: "User Files" },
  { prefix: "/usr", category: "Applications" },
  { prefix: "/opt", category: "Applications" },
  { prefix: "/boot", category: "Boot" },
  { prefix: "/tmp", category: "Temporary" },
  { prefix: "/snap", category: "Applications" },
  { prefix: "/srv", category: "Services" },
  { prefix: "/data", category: "Data" },
  { prefix: "/backup", category: "Backups" },
  { prefix: "/backups", category: "Backups" },
];

export const CATEGORY_COLORS: Record<string, string> = {
  Docker: "#06b6d4",
  Databases: "#8b5cf6",
  Logs: "#f59e0b",
  Cache: "#6366f1",
  "Temporary": "#94a3b8",
  "System Libs": "#64748b",
  "User Files": "#22c55e",
  Applications: "#3b82f6",
  Boot: "#6b7280",
  Services: "#a78bfa",
  Data: "#14b8a6",
  Backups: "#f97316",
  Other: "#475569",
};

function classify(path: string): string {
  for (const rule of RULES) {
    if (path === rule.prefix || path.startsWith(rule.prefix + "/")) {
      return rule.category;
    }
  }
  return "Other";
}

export function computeCategories(sizes: FolderSize[]): CategoryBucket[] {
  const buckets = new Map<string, CategoryBucket>();

  for (const entry of sizes) {
    const cat = classify(entry.path);
    if (!buckets.has(cat)) {
      buckets.set(cat, {
        name: cat,
        bytes: 0,
        color: CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other,
        paths: [],
      });
    }
    const b = buckets.get(cat);
    if (!b) continue;
    b.bytes += entry.size_bytes;
    b.paths.push(entry.path);
  }

  return [...buckets.values()]
    .filter((b) => b.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}
