import { useEffect, useMemo, useRef, useState } from "react";
import type { SortColumn, SortDir } from "../workers/sortEntries.worker";
import { SORT_WORKER_THRESHOLD } from "../config";

interface SortableEntry {
  name: string;
  path: string;
  kind: string;
  size: number | null;
  modified: number | null;
}

let sharedWorker: Worker | null = null;
let nextSortId = 0;

function getWorker(): Worker {
  sharedWorker ??= new Worker(new URL("../workers/sortEntries.worker.ts", import.meta.url), {
    type: "module",
  });
  return sharedWorker;
}

export function useSortedEntries<T extends SortableEntry>(
  entries: T[],
  search: string,
  sortCol: SortColumn,
  sortDir: SortDir,
  folderSizes?: Record<string, number>,
) {
  const q = search.trim().toLowerCase();
  const isDefaultSort = sortCol === "name" && sortDir === "asc" && !q;
  const useWorker = !isDefaultSort || entries.length > SORT_WORKER_THRESHOLD;

  const [sortedIndices, setSortedIndices] = useState<number[]>(() => entries.map((_, i) => i));
  const [isSorting, setIsSorting] = useState(false);
  const sortIdRef = useRef(0);

  useEffect(() => {
    if (!useWorker) {
      setSortedIndices(entries.map((_, i) => i));
      setIsSorting(false);
      return;
    }

    const sortId = ++nextSortId;
    sortIdRef.current = sortId;
    setIsSorting(true);

    const worker = getWorker();

    function onMessage(ev: MessageEvent<{ id: number; indices: number[] }>) {
      if (ev.data.id !== sortId) return;
      setSortedIndices(ev.data.indices);
      setIsSorting(false);
    }

    worker.addEventListener("message", onMessage);
    worker.postMessage({
      id: sortId,
      entries,
      search,
      sortCol,
      sortDir,
      folderSizes: sortCol === "size" ? folderSizes : undefined,
    });

    return () => {
      worker.removeEventListener("message", onMessage);
    };
  }, [entries, search, sortCol, sortDir, folderSizes, useWorker]);

  const visibleEntries = useMemo(() => {
    if (isDefaultSort && !useWorker) return entries;
    return sortedIndices.map((i) => entries[i]).filter(Boolean);
  }, [entries, sortedIndices, isDefaultSort, useWorker]);

  return { visibleEntries, isSorting };
}
