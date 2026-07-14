import {
  ArrowLeft,
  ArrowRight,
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
  onShowLog: () => void;
}

const ICON_SIZE = 15;
const ICON_STROKE = 1.9;

export function Toolbar({
  result,
  selected,
  busy,
  dualPane,
  showTerminal,
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
  onShowLog,
}: ToolbarProps) {
  const hasSelection = selected.size > 0;

  return (
    <div className="flex h-11 flex-none items-center gap-2.5 border-b border-border-raised bg-surface-toolbar px-3.5">
      {/* Connection status chip */}
      <div
        className="flex items-center gap-2 rounded-[8px] px-[11px] py-[5px]"
        style={{
          background: "rgba(31,157,99,0.10)",
          border: "1px solid rgba(31,157,99,0.28)",
        }}
      >
        <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full bg-success" />
        <span className="font-mono text-[11.5px] text-[#177a4c]">
          {result.username}@{result.host}
        </span>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border-raised" />

      {/* Nav buttons */}
      <div className="flex gap-0.5">
        <ToolBtn title="Go back" onClick={onGoBack} disabled={!canGoBack}>
          <ArrowLeft size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
        <ToolBtn title="Go forward" onClick={onGoForward} disabled={!canGoForward}>
          <ArrowRight size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </ToolBtn>
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border-raised" />

      {/* Action buttons */}
      <div className="flex gap-0.5">
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
        <span className="animate-pulse font-mono text-[11px] text-text-tertiary">Working…</span>
      )}

      <div className="flex-1" />

      {/* View toggles */}
      <div className="flex gap-0.5">
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
      </div>

      <div className="h-5 w-px bg-border-raised" />

      {/* Session Log — labeled button so it's easy to find */}
      <button
        onClick={onShowLog}
        title="Session activity log"
        className="flex items-center gap-1.5 rounded-input border border-border-input bg-surface-chip px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent-dark/40 hover:bg-surface-hover hover:text-accent-dark"
      >
        <History size={13} strokeWidth={ICON_STROKE} />
        Session Log
      </button>

      <div className="h-5 w-px bg-border-raised" />

      {/* Disconnect */}
      <button
        onClick={onDisconnect}
        className="flex items-center gap-1.5 rounded-input border border-border-input px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:border-danger/40 hover:text-danger"
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
      className={`flex h-[30px] w-8 items-center justify-center rounded-[7px] transition-colors disabled:opacity-35 ${
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
      className={`flex h-[30px] w-8 items-center justify-center rounded-[7px] transition-colors ${
        active
          ? "bg-accent/[0.12] text-accent-dark"
          : "text-text-tertiary hover:bg-surface-chip hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
