/** Normalize a remote Unix path — always forward slashes, no duplicate separators. */
export function normalizeRemotePath(path: string): string {
  let p = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p || "/";
}

/** Split a remote path into segments (no empty parts). */
export function splitRemotePath(path: string): string[] {
  return normalizeRemotePath(path).split("/").filter(Boolean);
}

/** Join a remote directory and child name with `/`. */
export function joinRemotePath(base: string, name: string): string {
  const b = normalizeRemotePath(base);
  const n = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n) return b;
  return b === "/" ? `/${n}` : `${b}/${n}`;
}

/** Parent directory of a remote path. */
export function remotePathParent(path: string): string {
  const p = normalizeRemotePath(path);
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}
