import { useCallback, useState } from "react";

export interface AppNotification {
  id: string;
  type: "transfer-done" | "transfer-error" | "connection-lost" | "op-error";
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const add = useCallback((n: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    setNotifications((prev) =>
      [{ id: crypto.randomUUID(), timestamp: Date.now(), read: false, ...n }, ...prev].slice(0, 50),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, add, markAllRead, clear, unreadCount };
}
