import {
  Activity,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Box,
  Coffee,
  FilePlus2,
  FolderPlus,
  HardDrive,
  History,
  Lock,
  LogOut,
  MessageSquare,
  PanelBottom,
  Pin,
  PinOff,
  RefreshCw,
  SplitSquareHorizontal,
  Trash2,
  Upload as UploadIcon,
  Download as DownloadIcon,
} from "lucide-react";
import type { ConnectResult } from "../api";
import { FEATURES } from "../lib/features";
import { openToolWindow } from "../utils/toolWindow";
import { Menu } from "./ui/Menu";

interface ToolbarProps {
  result: ConnectResult;
  selected: Set<string>;
  busy: boolean;
  dualPane: boolean;
  showTerminal: boolean;
  showTunnels: boolean;
  showDocker: boolean;
  showChat: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onCreateFolder: () => void;
  onCreateFile: () => void;
  onDelete: () => void;
  onDisconnect: () => void;
  onToggleDualPane: () => void;
  onToggleTerminal: () => void;
  onToggleTunnels: () => void;
  onToggleDocker: () => void;
  onToggleChat: () => void;
  currentPath: string;
  pinnedPath?: string;
  canPin: boolean;
  onTogglePinnedPath: () => void;
}

const ICON_SIZE = 16;
const ICON_STROKE = 2;

export function Toolbar({
  result,
  selected,
  busy,
  dualPane,
  showTerminal,
  showTunnels,
  showDocker,
  showChat,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
  onUpload,
  onDownload,
  onCreateFolder,
  onCreateFile,
  onDelete,
  onDisconnect,
  onToggleDualPane,
  onToggleTerminal,
  onToggleTunnels,
  onToggleDocker,
  onToggleChat,
  currentPath,
  pinnedPath,
  canPin,
  onTogglePinnedPath,
}: ToolbarProps) {
  const hasSelection = selected.size > 0;
  const isPinnedHere = !!pinnedPath && pinnedPath === currentPath;
  const pinTitle = !canPin
    ? "Save this connection as a profile to pin a landing folder"
    : isPinnedHere
      ? "This folder is your default landing folder on connect — click to unpin"
      : pinnedPath
        ? `Pin as landing folder (currently: ${pinnedPath})`
        : "Pin this folder as the default landing folder on connect";

  return (
    <div className="flex h-10 flex-none items-center gap-1 border-b border-border-raised bg-surface-toolbar px-3">
      {/* Connection status chip */}
      <div
        className="flex items-center gap-1.5 rounded-[8px] px-[10px] py-[4px]"
        style={{
          background: "rgba(31,157,99,0.09)",
          border: "1px solid rgba(31,157,99,0.24)",
        }}
      >
        <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full bg-success" />
        <span className="font-mono text-[11.5px] text-[#177a4c]">
          {result.username}@{result.host}
        </span>
      </div>

      {/* Divider */}
      <div className="mx-1 h-4 w-px bg-border" />

      {/* Nav buttons */}
      <div className="flex gap-1">
        <ToolBtn title="Go back" onClick={onGoBack} disabled={!canGoBack}>
          <ArrowLeft size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn title="Go forward" onClick={onGoForward} disabled={!canGoForward}>
          <ArrowRight size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
      </div>

      {/* Divider */}
      <div className="mx-1 h-4 w-px bg-border" />

      {/* Action buttons */}
      <div className="flex gap-1">
        <ToolBtn title="Reload" onClick={onReload} disabled={busy}>
          <RefreshCw size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn title="Upload file(s)" onClick={onUpload} disabled={busy}>
          <UploadIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn
          title={hasSelection ? "Download selected" : "Download (select a file first)"}
          onClick={onDownload}
          disabled={busy || !hasSelection}
        >
          <DownloadIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn title="New folder" onClick={onCreateFolder} disabled={busy}>
          <FolderPlus size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn title="New file" onClick={onCreateFile} disabled={busy}>
          <FilePlus2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn
          title={
            hasSelection
              ? `Delete ${selected.size.toString()} item(s)`
              : "Delete (select items first)"
          }
          onClick={onDelete}
          disabled={busy || !hasSelection}
          danger
        >
          <Trash2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
      </div>

      {/* Divider */}
      <div className="mx-1 h-4 w-px bg-border" />

      {/* Pin current folder as default landing folder for this connection */}
      <button
        onClick={onTogglePinnedPath}
        disabled={!canPin}
        title={pinTitle}
        className={`flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
          isPinnedHere
            ? "bg-accent/[0.12] text-accent-dark hover:bg-accent/[0.18]"
            : "text-text-tertiary hover:bg-surface-chip hover:text-text-primary"
        }`}
      >
        {isPinnedHere ? (
          <Pin size={ICON_SIZE} strokeWidth={ICON_STROKE} fill="currentColor" />
        ) : (
          <PinOff size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        )}
      </button>

      {busy && (
        <div className="flex items-center gap-1.5 rounded-[7px] border border-accent-dark/30 bg-accent/10 px-2.5 py-1">
          <span
            className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2"
            style={{ borderColor: "#3f7be0", borderTopColor: "transparent" }}
          />
          <span className="font-mono text-[11px] font-medium text-accent-dark">Working…</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Monitor Tasks dropdown — opens tool pages in separate windows.
          Data Profiler was pulled out to a standalone toolbar icon next to
          Docker Infrastructure so it's one click away without opening the menu. */}
      <Menu
        icon={<Activity size={13} strokeWidth={ICON_STROKE} />}
        title="Monitor tasks"
        items={[
          {
            icon: <Coffee size={12} strokeWidth={ICON_STROKE} />,
            label: "Java Process Monitor",
            onClick: () =>
              void openToolWindow("javaMonitor", {
                host: result.host,
                username: result.username,
              }),
          },
          {
            icon: <ArrowLeftRight size={12} strokeWidth={ICON_STROKE} />,
            label: showTunnels ? "Hide Port Forwarding" : "Show Port Forwarding",
            onClick: onToggleTunnels,
          },
        ]}
      />

      <div className="mx-1 h-4 w-px bg-border" />

      {/* View toggles */}
      <div className="flex gap-1">
        <ToggleBtn
          title={dualPane ? "Single pane" : "Dual pane"}
          active={dualPane}
          onClick={onToggleDualPane}
        >
          <SplitSquareHorizontal size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToggleBtn>
        <ToggleBtn
          title={showTerminal ? "Hide terminal" : "Show terminal"}
          active={showTerminal}
          onClick={onToggleTerminal}
        >
          <PanelBottom size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToggleBtn>
        <ToggleBtn
          title={showDocker ? "Hide Docker Explorer" : "Docker Infrastructure"}
          active={showDocker}
          onClick={onToggleDocker}
        >
          <Box size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToggleBtn>
        {/* Data Profiler — icon-only launcher; opens the tool page in its own
            window. Sits next to Docker Infrastructure so it reads as another
            "workspace" the user can jump into with one click. */}
        <ToolBtn
          title="Data Profiler — disk usage, largest items, cleanup"
          onClick={() =>
            void openToolWindow("dataProfiler", {
              host: result.host,
              username: result.username,
              osInfo: result.osInfo,
              defaultPath: pinnedPath,
            })
          }
        >
          <HardDrive size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        {FEATURES.AI ? (
          <ToggleBtn
            title={showChat ? "Hide AI Chat" : "Show AI Chat"}
            active={showChat}
            onClick={onToggleChat}
          >
            <MessageSquare size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </ToggleBtn>
        ) : (
          <div className="relative" title="AI Chat — Coming Soon">
            <div className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-input text-text-faint opacity-50">
              <MessageSquare size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            </div>
            <Lock size={8} className="absolute -right-0.5 -top-0.5 text-text-faint" />
          </div>
        )}
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Session Log — labeled button, opens in a separate window */}
      <button
        onClick={() => {
          void openToolWindow("sessionLog");
        }}
        title="Session activity log (opens in a new window)"
        className="flex items-center gap-1.5 rounded-input border border-border-input bg-surface-chip px-3 py-1.5 text-[11.5px] font-medium text-text-secondary transition-colors hover:border-accent-dark/40 hover:bg-surface-hover hover:text-accent-dark"
      >
        <History size={13} strokeWidth={ICON_STROKE} />
        Session Log
      </button>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Disconnect */}
      <button
        onClick={onDisconnect}
        className="flex items-center gap-1.5 rounded-input border border-border-input px-3 py-1.5 text-[11.5px] text-text-secondary transition-colors hover:border-danger/40 hover:text-danger"
      >
        <LogOut size={13} strokeWidth={ICON_STROKE} />
        Disconnect
      </button>
    </div>
  );
}

function ToolBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors disabled:opacity-35 ${
        danger
          ? "text-danger/70 hover:bg-red-50 hover:text-danger"
          : "text-text-tertiary hover:bg-surface-chip hover:text-text-primary"
      } disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary`}
    >
      {children}
    </button>
  );
}

function ToggleBtn({
  children,
  title,
  active,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors ${
        active
          ? "bg-accent/[0.12] text-accent-dark"
          : "text-text-tertiary hover:bg-surface-chip hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
