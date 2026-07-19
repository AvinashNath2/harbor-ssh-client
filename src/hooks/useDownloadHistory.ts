import { useCallback, useState } from "react";
import {
  clearDownloadHistory,
  deleteDownload,
  listDownloads,
  saveDownload,
  type DownloadRecord,
} from "../api";

export function useDownloadHistory() {
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const data = await listDownloads();
    setRecords(data);
  }, []);

  const openPanel = useCallback(async () => {
    await refresh();
    setOpen(true);
  }, [refresh]);

  const record = useCallback(
    async (id: string, name: string, localPath: string, remotePath: string, fileSize: number) => {
      await saveDownload(id, name, localPath, remotePath, fileSize);
      // Prepend optimistically so the panel updates instantly if it's open.
      const now = Date.now();
      setRecords((prev) => [
        {
          id,
          name,
          localPath,
          remotePath,
          downloadedAt: now,
          fileSize,
          available: true,
        },
        ...prev.filter((r) => r.id !== id),
      ]);
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    await deleteDownload(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearAll = useCallback(async () => {
    await clearDownloadHistory();
    setRecords([]);
  }, []);

  const unavailableCount = records.filter((r) => !r.available).length;

  return { records, open, setOpen, openPanel, record, remove, clearAll, unavailableCount };
}
