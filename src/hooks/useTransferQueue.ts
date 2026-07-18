import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelTransfer,
  downloadFileQueued,
  uploadFileQueued,
  type TransferProgress,
} from "../api";

export type TransferDirection = "upload" | "download";
export type TransferStatus = "pending" | "active" | "done" | "error" | "cancelled";

export interface Transfer {
  id: string;
  name: string;
  direction: TransferDirection;
  status: TransferStatus;
  transferred: number;
  total: number;
  error: string | null;
  localPath: string;
  remotePath: string;
}

interface QueuedItem {
  transfer: Transfer;
  start: () => Promise<void>;
}

const MAX_CONCURRENT = 2;

export function useTransferQueue() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const queueRef = useRef<QueuedItem[]>([]);
  const activeCountRef = useRef(0);

  function startNextFromQueue() {
    while (activeCountRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      activeCountRef.current++;
      setTransfers((prev) =>
        prev.map((t) => (t.id === next.transfer.id ? { ...t, status: "active" } : t)),
      );
      void next.start();
    }
  }

  // Listen to progress events from Rust.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<TransferProgress>("transfer-progress", (event) => {
      const p = event.payload;

      // Update activeCountRef and decide whether to start the next queued item
      // BEFORE calling setTransfers, so the ref is correct when startNextFromQueue runs.
      if (p.finished) {
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      }

      setTransfers((prev) =>
        prev.map((t) => {
          if (t.id !== p.id) return t;
          if (p.finished) {
            const isCancelledMsg = p.error === "Transfer cancelled";
            return {
              ...t,
              transferred: p.error ? t.transferred : t.total,
              // If Rust reports "Transfer cancelled", use our "cancelled" status
              // (the frontend may have already set it, this just ensures consistency)
              status: isCancelledMsg ? "cancelled" : p.error ? "error" : "done",
              error: isCancelledMsg ? null : (p.error ?? null),
            };
          }
          return {
            ...t,
            transferred: p.transferred,
            total: p.total,
            status: "active",
          };
        }),
      );

      // Start next item after the state update is scheduled (not inside the updater).
      if (p.finished) {
        startNextFromQueue();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  function enqueue(item: QueuedItem) {
    setTransfers((prev) => [...prev, item.transfer]);
    if (activeCountRef.current < MAX_CONCURRENT) {
      activeCountRef.current++;
      setTransfers((prev) =>
        prev.map((t) => (t.id === item.transfer.id ? { ...t, status: "active" } : t)),
      );
      void item.start();
    } else {
      queueRef.current.push(item);
    }
  }

  const enqueueDownload = useCallback(
    (remotePath: string, localPath: string, name: string) => {
      const id = crypto.randomUUID();
      const transfer: Transfer = {
        id,
        name,
        direction: "download",
        status: "pending",
        transferred: 0,
        total: 0,
        error: null,
        localPath,
        remotePath,
      };
      enqueue({
        transfer,
        start: () => downloadFileQueued(id, remotePath, localPath),
      });
    },
    [],
  );

  const enqueueUpload = useCallback(
    (localPath: string, remotePath: string, name: string) => {
      const id = crypto.randomUUID();
      const transfer: Transfer = {
        id,
        name,
        direction: "upload",
        status: "pending",
        transferred: 0,
        total: 0,
        error: null,
        localPath,
        remotePath,
      };
      enqueue({
        transfer,
        start: () => uploadFileQueued(id, localPath, remotePath),
      });
    },
    [],
  );

  const cancel = useCallback((id: string) => {
    // Remove from the waiting queue immediately.
    queueRef.current = queueRef.current.filter((q) => q.transfer.id !== id);
    // Mark as cancelled in state regardless of current status — if it's active,
    // the Rust side will emit a finish event with error "Transfer cancelled" which
    // the listener will map back to "cancelled" status.
    setTransfers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: "cancelled", error: null } : t)),
    );
    void cancelTransfer(id);
  }, []);

  const clearCompleted = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === "pending" || t.status === "active"));
  }, []);

  const activeCount = transfers.filter((t) => t.status === "active").length;
  const pendingCount = transfers.filter((t) => t.status === "pending").length;

  // Auto-clear completed/cancelled/error transfers 5 seconds after all activity stops.
  useEffect(() => {
    const hasCompleted = transfers.some(
      (t) => t.status === "done" || t.status === "error" || t.status === "cancelled",
    );
    if (!hasCompleted || activeCount > 0 || pendingCount > 0) return;
    const timer = setTimeout(() => {
      setTransfers((prev) => prev.filter((t) => t.status === "pending" || t.status === "active"));
    }, 5000);
    return () => { clearTimeout(timer); };
  }, [transfers, activeCount, pendingCount]);

  return {
    transfers,
    enqueueDownload,
    enqueueUpload,
    cancel,
    clearCompleted,
    activeCount,
    pendingCount,
  };
}
