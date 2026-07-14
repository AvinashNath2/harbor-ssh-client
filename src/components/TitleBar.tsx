import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Plus,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "../hooks/useNotifications";
import type { Tab } from "../hooks/useTabs";

interface TitleBarProps {
  tabs: Tab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewSession: () => void;
  connected: boolean;
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
}

export function TitleBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNewSession,
  connected,
  notifications,
  unreadCount,
  onMarkAllRead,
  onClearNotifications,
}: TitleBarProps) {
  return (
    <div
      className="flex h-[46px] flex-none items-center gap-3.5 border-b border-border bg-surface-titlebar px-3.5"
      data-tauri-drag-region
    >
      {/* Logo */}
      <div className="flex flex-none items-center gap-2.5">
        <div
          className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] text-[13px] font-bold text-white"
          style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
        >
          H
        </div>
        <span className="text-[14px] font-semibold tracking-[0.2px] text-text-primary">Harbor</span>
      </div>

      {/* Divider */}
      <div className="h-5 w-px flex-none bg-border" />

      {/* Tabs */}
      <div className="flex flex-1 items-center gap-1.5">
        {connected &&
          tabs.map((tab) => (
            <TitleBarTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeId}
              onActivate={() => { onActivate(tab.id); }}
              onClose={() => { onClose(tab.id); }}
              canClose={tabs.length > 1}
            />
          ))}
        <button
          onClick={onNewSession}
          title="New session"
          className="flex h-6 w-6 items-center justify-center rounded text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        >
          <Plus size={15} strokeWidth={1.9} />
        </button>
      </div>

      {/* Notifications bell */}
      <NotificationBell
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={onMarkAllRead}
        onClear={onClearNotifications}
      />
    </div>
  );
}

// ── Notification bell + dropdown ──────────────────────────────────────────────

const NOTIF_ICON_COMPONENT: Record<AppNotification["type"], typeof CheckCircle2> = {
  "transfer-done": CheckCircle2,
  "transfer-error": XCircle,
  "connection-lost": Zap,
  "op-error": AlertTriangle,
};

const NOTIF_COLORS: Record<AppNotification["type"], string> = {
  "transfer-done": "#1f9d63",
  "transfer-error": "#e5534b",
  "connection-lost": "#e0a53c",
  "op-error": "#e0a53c",
};

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60).toString()}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600).toString()}h ago`;
  return `${Math.floor(diff / 86400).toString()}d ago`;
}

function NotificationBell({
  notifications,
  unreadCount,
  onMarkAllRead,
  onClear,
}: {
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => { document.removeEventListener("mousedown", handleOutside); };
  }, [open]);

  function toggle() {
    if (!open && unreadCount > 0) onMarkAllRead();
    setOpen((v) => !v);
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={toggle}
        className="relative flex h-7 w-7 items-center justify-center rounded-[7px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-secondary"
        title="Notifications"
      >
        <Bell size={16} strokeWidth={1.9} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px] font-mono text-[9px] font-bold text-white"
            style={{ background: "#e5534b" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount.toString()}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[300px] overflow-hidden rounded-[12px] border border-border-raised bg-surface-pane"
          style={{ boxShadow: "0 16px 40px -8px rgba(20,18,15,0.4)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-[13px] font-semibold text-text-primary">Notifications</span>
            <button
              onClick={onClear}
              className="text-[11px] text-text-faint transition-colors hover:text-text-secondary"
            >
              Clear all
            </button>
          </div>

          {/* List */}
          <div className="max-h-[320px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-text-faint">
                No notifications
              </div>
            ) : (
              notifications.slice(0, 20).map((n) => {
                const Icon = NOTIF_ICON_COMPONENT[n.type];
                return (
                  <div
                    key={n.id}
                    className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0"
                  >
                    <div
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-white"
                      style={{ background: NOTIF_COLORS[n.type] }}
                    >
                      <Icon size={13} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-text-primary">{n.title}</div>
                      <div className="mt-0.5 truncate text-[11.5px] text-text-faint">{n.body}</div>
                    </div>
                    <div className="flex-shrink-0 font-mono text-[10px] text-text-faint">
                      {relativeTime(n.timestamp)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

interface TitleBarTabProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  canClose: boolean;
}

function TitleBarTab({ tab, isActive, onActivate, onClose, canClose }: TitleBarTabProps) {
  const label = tab.path.split("/").filter(Boolean).pop() ?? "/";

  return (
    <div
      onClick={onActivate}
      className={`group flex h-8 cursor-pointer items-center gap-2 rounded-t px-3 text-[12.5px] transition-colors ${
        isActive
          ? "border border-b-[2px] border-border-input border-b-accent-dark bg-surface font-medium text-text-primary"
          : "text-text-tertiary hover:text-text-secondary"
      }`}
    >
      {isActive && <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-success" />}
      <span className="max-w-[140px] truncate">{label}</span>
      {canClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-0.5 flex h-4 w-4 items-center justify-center text-text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-secondary"
        >
          <X size={12} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
