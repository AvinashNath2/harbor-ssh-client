import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Box,
  FilePlus2,
  FolderPlus,
  History,
  LogOut,
  PanelBottom,
  RefreshCw,
  SplitSquareHorizontal,
  Trash2,
  Upload as UploadIcon,
  Download as DownloadIcon,
} from "lucide-react";
import type { ConnectResult } from "../api";

interface ToolbarProps {
  result: ConnectResult;
  selected: Set<string>;
  busy: boolean;
  dualPane: boolean;
  showTerminal: boolean;
  showTunnels: boolean;
  showDocker: boolean;
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
  onShowLog: () => void;
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
  onShowLog,
}: ToolbarProps) {
  const hasSelection = selected.size > 0;

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
          title={showTunnels ? "Hide tunnels" : "SSH tunnels / port forwarding"}
          active={showTunnels}
          onClick={onToggleTunnels}
        >
          <ArrowLeftRight size={ICON_SIZE} strokeWidth={ICON_STROKE} />
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
      </div>

      <div className="mx-1 h-4 w-px bg-border" />

      {/* Session Log — labeled button so it's easy to find */}
      <button
        onClick={onShowLog}
        title="Session activity log"
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
