export type SortColumn = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

interface SortableEntry {
  name: string;
  path: string;
  kind: string;
  size: number | null;
  modified: number | null;
}

interface SortMessage {
  id: number;
  entries: SortableEntry[];
  search: string;
  sortCol: SortColumn;
  sortDir: SortDir;
  folderSizes?: Record<string, number>;
}

interface SortResult {
  id: number;
  indices: number[];
}

function fileTypeLabel(name: string, kind: string): string {
  if (kind === "directory") return "Folder";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "File";
  return name.slice(dot + 1).toUpperCase() || "File";
}

function compare(
  a: SortableEntry,
  b: SortableEntry,
  sortCol: SortColumn,
  dirMul: number,
  folderSizes?: Record<string, number>,
): number {
  const aDir = a.kind === "directory";
  const bDir = b.kind === "directory";
  if (aDir !== bDir) return aDir ? -1 : 1;

  switch (sortCol) {
    case "size": {
      const as = aDir ? (folderSizes?.[a.path] ?? -1) : (a.size ?? 0);
      const bs = bDir ? (folderSizes?.[b.path] ?? -1) : (b.size ?? 0);
      return dirMul * (as - bs);
    }
    case "modified":
      return dirMul * ((a.modified ?? 0) - (b.modified ?? 0));
    case "type":
      return dirMul * fileTypeLabel(a.name, a.kind).localeCompare(fileTypeLabel(b.name, b.kind));
    case "name":
    default:
      return dirMul * a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  }
}

self.onmessage = (ev: MessageEvent<SortMessage>) => {
  const { id, entries, search, sortCol, sortDir, folderSizes } = ev.data;
  const q = search.trim().toLowerCase();
  const dirMul = sortDir === "asc" ? 1 : -1;

  let indices = entries.map((_, i) => i);
  if (q) {
    indices = indices.filter((i) => entries[i].name.toLowerCase().includes(q));
  }

  indices.sort((ia, ib) => compare(entries[ia], entries[ib], sortCol, dirMul, folderSizes));

  const result: SortResult = { id, indices };
  self.postMessage(result);
};
