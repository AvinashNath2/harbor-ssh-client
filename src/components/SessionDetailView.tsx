import { ChevronDown, ChevronUp, Copy, Download, FolderSearch, TerminalSquare } from "lucide-react";
import type { CommandSource } from "../api";
import { useEffect, useState } from "react";
import { loadSession, type CommandRecord, type SessionRecord } from "../api";
import { fmtDuration, fmtSessionDuration } from "../utils/fmtDuration";
import { stripAnsi } from "../utils/oscParser";

interface SessionDetailViewProps {
  session: SessionRecord;
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n.toString()} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function SourceBadge({ source }: { source: CommandSource | null }) {
  if (!source) return null;
  const isTerminal = source === "terminal";
  return (
    <span
      className={`flex items-center gap-1 rounded-chip px-1.5 py-0.5 font-mono text-[9.5px] font-semibold ${
        isTerminal ? "bg-surface-chip text-text-secondary" : "bg-accent/10 text-accent-dark"
      }`}
    >
      {isTerminal ? (
        <TerminalSquare size={9} strokeWidth={2.2} />
      ) : (
        <FolderSearch size={9} strokeWidth={2.2} />
      )}
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

// ── Command text rendering ─────────────────────────────────────────────────────

const FILE_BROWSER_RE = /^\[([^\]]+)\]\s*(.*)/s;

function CommandText({ raw, source }: { raw: string; source: CommandRecord["source"] }) {
  if (source === "terminal") {
    const spaceIdx = raw.indexOf(" ");
    if (spaceIdx === -1) {
      return <span className="font-mono text-[13px] font-bold text-text-heading">$ {raw}</span>;
    }
    const cmd = raw.slice(0, spaceIdx);
    const args = raw.slice(spaceIdx);
    return (
      <span className="font-mono">
        <span className="text-[13px] font-bold text-text-heading">$ {cmd}</span>
        <span className="text-[12.5px] font-medium text-text-tertiary">{args}</span>
      </span>
    );
  }

  const match = FILE_BROWSER_RE.exec(raw);
  if (match) {
    const [, action, path] = match;
    return (
      <span className="flex flex-wrap items-center gap-1.5 font-mono">
        <span className="rounded-chip bg-surface-chip px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
          {action}
        </span>
        <span className="text-[12px] text-text-primary">{path}</span>
      </span>
    );
  }

  // Verb-path format from PreviewModal (open, cat, write) — bold verb, lighter path, no $ prefix
  const spaceIdx = raw.indexOf(" ");
  if (spaceIdx !== -1) {
    return (
      <span className="font-mono">
        <span className="text-[13px] font-bold text-text-heading">{raw.slice(0, spaceIdx)}</span>
        <span className="text-[12.5px] font-medium text-text-tertiary">{raw.slice(spaceIdx)}</span>
      </span>
    );
  }

  return <span className="font-mono text-[12.5px] font-semibold text-text-primary">{raw}</span>;
}

// ── Output display constants ───────────────────────────────────────────────────

const OUTPUT_DISPLAY_THRESHOLD = 3000;
const OUTPUT_DISPLAY_MAX = 500;

function CommandCard({ cmd }: { cmd: CommandRecord }) {
  const [expanded, setExpanded] = useState(false);

  // Strip any residual ANSI sequences from stored output (handles records captured before the fix).
  const cleanOutput = cmd.output ? stripAnsi(cmd.output) : null;

  function copyOutput() {
    void navigator.clipboard.writeText(cleanOutput ?? "");
  }
  // Compute display-time truncation (separate from storage truncation)
  const allLines = cleanOutput ? cleanOutput.split("\n") : [];
  const isDisplayLong = allLines.length > OUTPUT_DISPLAY_THRESHOLD;
  const displayText = isDisplayLong
    ? allLines.slice(0, OUTPUT_DISPLAY_MAX).join("\n")
    : (cleanOutput ?? "");
  const hiddenLineCount = isDisplayLong ? allLines.length - OUTPUT_DISPLAY_MAX : 0;

  return (
    <div className="border-b border-border-subtle last:border-0">
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
        }}
        className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        {/* Index */}
        <span className="mt-0.5 w-7 flex-shrink-0 font-mono text-[10.5px] text-text-faint">
          #{cmd.idx.toString()}
        </span>

        {/* Command text + source badge */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CommandText raw={cmd.raw} source={cmd.source} />
            <SourceBadge source={cmd.source} />
          </div>
          {/* Metadata row — secondary, lighter */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-text-faint">
            <span>{fmtTime(cmd.executedAt)}</span>
            <span className="text-text-faint/50">·</span>
            <span className="text-text-faint/70">{cmd.cwd}</span>
            <span className="text-text-faint/50">·</span>
            <ExitBadge code={cmd.exitCode} />
            {cmd.durationMs !== null && (
              <>
                <span className="text-text-faint/50">·</span>
                <span>{fmtDuration(cmd.durationMs)}</span>
              </>
            )}
          </div>
        </div>

        {/* Expand toggle — always shown so every row is visibly clickable */}
        <span className="flex-shrink-0 text-text-faint">
          {expanded ? (
            <ChevronUp size={13} strokeWidth={2} />
          ) : (
            <ChevronDown size={13} strokeWidth={2} />
          )}
        </span>
      </button>

      {/* Output — only when expanded */}
      {expanded && (
        <div className="border-t border-border-subtle bg-[#181a1f] px-5 py-3">
          {cleanOutput ? (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.5px] text-text-faint">
                  Output
                  {cmd.outputTruncated && (
                    <span className="ml-2 text-[#e0a53c]">
                      (stored: {fmtBytes(cmd.originalOutputBytes)})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyOutput();
                  }}
                  className="flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[10.5px] text-text-faint transition-colors hover:bg-surface-chip hover:text-text-primary"
                >
                  <Copy size={10} strokeWidth={2} />
                  Copy
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-[1.6] text-[#c8c5be]">
                {displayText}
              </pre>
              {/* Display-time line cap notice */}
              {isDisplayLong && (
                <div className="mt-2 font-mono text-[10.5px] text-[#e0a53c]">
                  [{hiddenLineCount.toLocaleString()} more lines hidden — use Export to see full
                  output]
                </div>
              )}
              {/* Storage truncation notice */}
              {cmd.outputTruncated && (
                <div className="mt-1 font-mono text-[10.5px] text-[#e0a53c]">
                  [OUTPUT TRUNCATED at capture — original: {fmtBytes(cmd.originalOutputBytes)}]
                </div>
              )}
            </>
          ) : (
            <span className="font-mono text-[11px] text-text-faint">No output captured.</span>
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
      .then((data) => {
        setCommands(data.commands);
      })
      .catch(() => undefined)
      .finally(() => {
        setLoading(false);
      });
  }, [session.id]);

  function handleExport() {
    // Build export as an array of Blob parts to avoid concatenating one giant string.
    const parts: string[] = [
      `HarborSCP Session Log\n`,
      `Session: ${session.username}@${session.host} (${session.ip})\n`,
      `Started:  ${new Date(session.startedAt).toISOString()}\n`,
      `Ended:    ${session.endedAt ? new Date(session.endedAt).toISOString() : "Active"}\n`,
      `Duration: ${fmtSessionDuration(session.startedAt, session.endedAt)}\n`,
      `Commands: ${session.cmdCount.toString()}\n\n`,
      `${"═".repeat(60)}\n\n`,
    ];
    for (const cmd of commands) {
      parts.push(`#${cmd.idx.toString()}  ${fmtTime(cmd.executedAt)}  ${cmd.cwd}\n`);
      parts.push(`$ ${cmd.raw}\n`);
      parts.push(
        `EXIT: ${cmd.exitCode?.toString() ?? "—"}  DURATION: ${fmtDuration(cmd.durationMs)}\n`,
      );
      if (cmd.output) {
        parts.push(cmd.output);
        if (cmd.outputTruncated) {
          parts.push(`\n[OUTPUT TRUNCATED — original: ${fmtBytes(cmd.originalOutputBytes)}]`);
        }
      }
      parts.push("\n\n");
    }
    const blob = new Blob(parts, { type: "text/plain" });
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
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {session.endedAt &&
                  ` – ${new Date(session.endedAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
              </span>
              <span>Duration: {fmtSessionDuration(session.startedAt, session.endedAt)}</span>
              <span>
                {session.cmdCount.toString()} command{session.cmdCount !== 1 ? "s" : ""}
              </span>
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
