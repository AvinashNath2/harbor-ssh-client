import { ArrowLeft, ChevronRight, Terminal } from "lucide-react";
import { useState } from "react";
import type { SessionRecord } from "../api";
import { SessionDetailView } from "./SessionDetailView";
import { SessionListView } from "./SessionListView";

interface SessionLogPageProps {
  onClose: () => void;
}

type View = { kind: "list" } | { kind: "detail"; session: SessionRecord };

export function SessionLogPage({ onClose }: SessionLogPageProps) {
  const [view, setView] = useState<View>({ kind: "list" });

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-surface-pane">
      {/* Top bar */}
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border-raised bg-surface-toolbar px-4">
        {/* Back / close */}
        {view.kind === "detail" ? (
          <button
            onClick={() => { setView({ kind: "list" }); }}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft size={14} strokeWidth={2.2} />
            Sessions
          </button>
        ) : (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft size={14} strokeWidth={2.2} />
            Harbor
          </button>
        )}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-text-faint">
          <ChevronRight size={13} strokeWidth={2} />
          <div className="flex items-center gap-2">
            <Terminal size={13} strokeWidth={2} />
            <span className="text-[13px] font-semibold text-text-primary">
              {view.kind === "list"
                ? "Session Log"
                : `${view.session.username}@${view.session.host}`}
            </span>
            {view.kind === "list" && (
              <span className="font-mono text-[10.5px] text-text-faint">
                — all sessions across all servers
              </span>
            )}
          </div>
          {view.kind === "detail" && (
            <>
              <ChevronRight size={13} strokeWidth={2} />
              <span className="text-[12px] text-text-secondary">
                {new Date(view.session.startedAt).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1">
        {view.kind === "list" && (
          <SessionListView
            onOpen={(session) => { setView({ kind: "detail", session }); }}
          />
        )}
        {view.kind === "detail" && (
          <SessionDetailView session={view.session} />
        )}
      </div>
    </div>
  );
}
