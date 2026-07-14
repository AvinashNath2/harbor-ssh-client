import { ChevronDown, ChevronUp, Copy, Download, FolderSearch, TerminalSquare } from "lucide-react";
import type { CommandSource } from "../api";
import { useEffect, useState } from "react";
import { loadSession, type CommandRecord, type SessionRecord } from "../api";

interface SessionDetailViewProps {
  session: SessionRecord;
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms.toString()}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000).toString()}m ${Math.floor((ms % 60000) / 1000).toString()}s`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n.toString()} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtSessionDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return "Active";
  const s = Math.floor((endMs - startMs) / 1000);
  if (s < 60) return `${s.toString()}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m.toString()}m`;
  return `${Math.floor(m / 60).toString()}h ${(m % 60).toString()}m`;
}

function SourceBadge({ source }: { source: CommandSource | null }) {
  if (!source) return null;
  const isTerminal = source === "terminal";
  return (
    <span
      className={`flex items-center gap-1 rounded-chip px-1.5 py-0.5 font-mono text-[9.5px] font-semibold ${
        isTerminal
          ? "bg-surface-chip text-text-secondary"
          : "bg-accent/10 text-accent-dark"
      }`}
    >
      {isTerminal
        ? <TerminalSquare size={9} strokeWidth={2.2} />
        : <FolderSearch size={9} strokeWidth={2.2} />}
      {isTerminal ? "Terminal" : "File Browser"}
    </span>
  );
}

function ExitBadge({ code }: { code: number | null }) {
  if (code === null) return <span className="font-mono text-[10.5px] text-text-faint">—</span>;
  const ok = code === 0;
  return (
    <span
      className={`rounded-chip px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
        ok ? "bg-success/10 text-[#177a4c]" : "bg-danger/10 text-danger"
      }`}
    >
      EXIT {code.toString()}
    </span>
  );
}

function CommandCard({ cmd }: { cmd: CommandRecord }) {
  const [expanded, setExpanded] = useState(false);

  function copyOutput() {
    void navigator.clipboard.writeText(cmd.output ?? "");
  }

  return (
    <div className="border-b border-border-subtle last:border-0">
      {/* Header row — always visible */}
      <button
        onClick={() => { setExpanded((v) => !v); }}
        className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        {/* Index */}
        <span className="mt-0.5 w-7 flex-shrink-0 font-mono text-[10.5px] text-text-faint">
          #{cmd.idx.toString()}
        </span>

        {/* Command text */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12.5px] font-semibold text-text-primary">
              $ {cmd.raw}
            </span>
            <SourceBadge source={cmd.source} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-text-faint">
            <span>{fmtTime(cmd.executedAt)}</span>
            <span className="text-text-faint/60">·</span>
            <span>{cmd.cwd}</span>
            <span className="text-text-faint/60">·</span>
            <ExitBadge code={cmd.exitCode} />
            <span className="text-text-faint/60">·</span>
            <span>{fmtDuration(cmd.durationMs)}</span>
          </div>
        </div>

        {/* Expand toggle */}
        {cmd.output !== null && (
          <span className="flex-shrink-0 text-text-faint">
            {expanded ? <ChevronUp size={13} strokeWidth={2} /> : <ChevronDown size={13} strokeWidth={2} />}
          </span>
        )}
      </button>

      {/* Output — only when expanded */}
      {expanded && cmd.output !== null && (
        <div className="border-t border-border-subtle bg-[#181a1f] px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.5px] text-text-faint">
              Output
              {cmd.outputTruncated && (
                <span className="ml-2 text-[#e0a53c]">
                  (truncated — original {fmtBytes(cmd.originalOutputBytes)})
                </span>
              )}
            </span>
            <button
              onClick={copyOutput}
              className="flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10.5px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-primary"
            >
              <Copy size={10} strokeWidth={2} />
              Copy
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-[1.6] text-[#c8c5be]">
            {cmd.output}
          </pre>
          {cmd.outputTruncated && (
            <div className="mt-2 font-mono text-[10.5px] text-[#e0a53c]">
              [OUTPUT TRUNCATED — original: {fmtBytes(cmd.originalOutputBytes)}]
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionDetailView({ session }: SessionDetailViewProps) {
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadSession(session.id)
      .then((data) => { setCommands(data.commands); })
      .catch(() => undefined)
      .finally(() => { setLoading(false); });
  }, [session.id]);

  function handleExport() {
    const lines: string[] = [
      `Harbor Session Log`,
      `Session: ${session.username}@${session.host} (${session.ip})`,
      `Started:  ${new Date(session.startedAt).toISOString()}`,
      `Ended:    ${session.endedAt ? new Date(session.endedAt).toISOString() : "Active"}`,
      `Duration: ${fmtSessionDuration(session.startedAt, session.endedAt)}`,
      `Commands: ${session.cmdCount.toString()}`,
      "",
      "═".repeat(60),
      "",
    ];
    for (const cmd of commands) {
      lines.push(`#${cmd.idx.toString()}  ${fmtTime(cmd.executedAt)}  ${cmd.cwd}`);
      lines.push(`$ ${cmd.raw}`);
      lines.push(`EXIT: ${cmd.exitCode?.toString() ?? "—"}  DURATION: ${fmtDuration(cmd.durationMs)}`);
      if (cmd.output) {
        lines.push(cmd.output);
        if (cmd.outputTruncated) {
          lines.push(`[OUTPUT TRUNCATED — original: ${fmtBytes(cmd.originalOutputBytes)}]`);
        }
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date(session.startedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `harbor-session-${session.host}-${dateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Session header */}
      <div className="flex-none border-b border-border-raised bg-surface-colheader px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-text-primary">
                {session.username}@{session.host}
              </span>
              {session.endedAt === null && (
                <span className="rounded-chip bg-success/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.5px] text-[#177a4c]">
                  Active
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-text-faint">
              <span>IP: {session.ip}</span>
              <span>
                {new Date(session.startedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit", minute: "2-digit",
                })}
                {session.endedAt &&
                  ` – ${new Date(session.endedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit", minute: "2-digit",
                  })}`}
              </span>
              <span>Duration: {fmtSessionDuration(session.startedAt, session.endedAt)}</span>
              <span>{session.cmdCount.toString()} command{session.cmdCount !== 1 ? "s" : ""}</span>
            </div>
          </div>

          <button
            onClick={handleExport}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-input border border-border-input bg-surface-chip px-3 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
          >
            <Download size={12} strokeWidth={2} />
            Export
          </button>
        </div>
      </div>

      {/* Command list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
            Loading commands…
          </div>
        )}
        {!loading && commands.length === 0 && (
          <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
            No commands recorded in this session.
          </div>
        )}
        {!loading && commands.map((cmd) => <CommandCard key={cmd.id} cmd={cmd} />)}
      </div>
    </div>
  );
}
