/** Cache directories only when they contain more than this many entries. */
export const CACHE_MIN_ENTRIES = 21;

const MAX_CACHED_DIRS = 20;
const MAX_TOTAL_ENTRIES = 200_000;

interface CachedDir<T> {
  entries: T[];
  fetchedAt: number;
  /** How long the last successful full load took (ms). Used for refresh ETA. */
  loadDurationMs: number;
}

export interface CachedDirMeta<T> {
  entries: T[];
  loadDurationMs: number;
}

class DirCacheStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store = new Map<string, CachedDir<any>>();
  private totalEntries = 0;

  private key(scope: string, path: string): string {
    return `${scope}:${path}`;
  }

  getWithMeta<T>(scope: string, path: string): CachedDirMeta<T> | null {
    const cached = this.store.get(this.key(scope, path)) as CachedDir<T> | undefined;
    if (!cached || cached.entries.length < CACHE_MIN_ENTRIES) return null;
    cached.fetchedAt = Date.now();
    return { entries: cached.entries, loadDurationMs: cached.loadDurationMs };
  }

  /** @deprecated Prefer getWithMeta — returns entries only. */
  get(scope: string, path: string): unknown[] | null {
    return this.getWithMeta(scope, path)?.entries ?? null;
  }

  set(scope: string, path: string, entries: unknown[], loadDurationMs: number): void {
    if (entries.length < CACHE_MIN_ENTRIES) return;
    const k = this.key(scope, path);
    const existing = this.store.get(k) as CachedDir<unknown> | undefined;
    if (existing) this.totalEntries -= existing.entries.length;

    this.evictIfNeeded(entries.length);
    this.store.set(k, {
      entries,
      fetchedAt: Date.now(),
      loadDurationMs: Math.max(loadDurationMs, 500),
    });
    this.totalEntries += entries.length;
  }

  invalidate(scope: string, path: string): void {
    const k = this.key(scope, path);
    const existing = this.store.get(k);
    if (existing) {
      this.totalEntries -= existing.entries.length;
      this.store.delete(k);
    }
  }

  invalidateParent(scope: string, path: string): void {
    const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
    this.invalidate(scope, parent);
    this.invalidate(scope, path);
  }

  private evictIfNeeded(incoming: number): void {
    while (
      (this.store.size >= MAX_CACHED_DIRS || this.totalEntries + incoming > MAX_TOTAL_ENTRIES) &&
      this.store.size > 0
    ) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.store) {
        if (v.fetchedAt < oldestTime) {
          oldestTime = v.fetchedAt;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      const evicted = this.store.get(oldestKey);
      if (evicted) this.totalEntries -= evicted.entries.length;
      this.store.delete(oldestKey);
    }
  }
}

export const dirCache = new DirCacheStore();

export function makeRemoteCacheScope(host: string, username: string): string {
  return `${host}:${username}`;
}

export const LOCAL_CACHE_SCOPE = "local";
