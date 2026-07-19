import { ArrowLeftRight, Plus, X } from "lucide-react";
import { useState } from "react";
import type { PortForward } from "../api";
import { AddTunnelDialog } from "./AddTunnelDialog";

interface Props {
  tunnels: PortForward[];
  tunnelError: string | null;
  onAdd: (localPort: number, remoteHost: string, remotePort: number) => void;
  onRemove: (id: string) => void;
  onClearError: () => void;
}

export function PortForwardPanel({ tunnels, tunnelError, onAdd, onRemove, onClearError }: Props) {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <div className="flex h-full flex-col bg-surface-pane">
      {/* Header */}
      <div className="flex h-[36px] flex-shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <ArrowLeftRight size={13} strokeWidth={1.9} className="text-text-faint" />
        <span className="text-[12px] font-medium text-text-secondary">Tunnels</span>
        <div className="flex-1" />
        <button
          onClick={() => { setShowDialog(true); }}
          className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-text-faint hover:bg-surface-chip hover:text-text-secondary"
        >
          <Plus size={11} strokeWidth={2} />
          New
        </button>
      </div>

      {/* Error banner */}
      {tunnelError && (
        <div className="flex items-center gap-2 border-b border-danger/20 bg-danger/[0.06] px-3 py-2">
          <span className="flex-1 text-[11px] text-danger">{tunnelError}</span>
          <button onClick={onClearError} className="text-danger/70 hover:text-danger">
            <X size={11} />
          </button>
        </div>
      )}

      {/* Tunnel list */}
      <div className="flex-1 overflow-auto py-1">
        {tunnels.length === 0 && (
          <p className="mt-8 text-center text-[12px] text-text-faint">No active tunnels</p>
        )}
        {tunnels.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 px-3 py-[7px] hover:bg-surface-hover"
          >
            <span className="font-mono text-[12px] font-medium text-text-primary">
              :{t.localPort}
            </span>
            <ArrowLeftRight size={10} strokeWidth={2} className="flex-shrink-0 text-text-faint" />
            <span className="flex-1 truncate font-mono text-[12px] text-text-secondary">
              {t.remoteHost}:{t.remotePort}
            </span>
            <span className="flex-shrink-0 rounded-full bg-success/[0.12] px-2 py-0.5 text-[10px] font-medium text-success">
              active
            </span>
            <button
              onClick={() => { void onRemove(t.id); }}
              className="ml-0.5 flex-shrink-0 rounded p-0.5 text-text-faint hover:bg-surface-chip hover:text-danger"
              title="Stop tunnel"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      {showDialog && (
        <AddTunnelDialog
          onAdd={onAdd}
          onClose={() => { setShowDialog(false); }}
        />
      )}
    </div>
  );
}
