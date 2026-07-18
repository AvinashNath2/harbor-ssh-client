import { CornerDownLeft, FileText, Folder, Search, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConnectionProfile, FileEntry } from "../api";

type PaletteResult =
  | { type: "file"; entry: FileEntry }
  | { type: "session"; profile: ConnectionProfile };

interface CommandPaletteProps {
  entries: FileEntry[];
  profiles: ConnectionProfile[];
  onNavigate: (path: string) => void;
  onSelectProfile: (profile: ConnectionProfile) => void;
  onClose: () => void;
}

export function CommandPalette({
  entries,
  profiles,
  onNavigate,
  onSelectProfile,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.toLowerCase();

  const fileResults: PaletteResult[] = q
    ? entries
        .filter((e) => e.name.toLowerCase().includes(q))
        .sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          return aStarts - bStarts || a.name.localeCompare(b.name);
        })
        .slice(0, 6)
        .map((entry) => ({ type: "file", entry }))
    : [];

  const sessionResults: PaletteResult[] = q
    ? profiles
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.host.toLowerCase().includes(q),
        )
        .sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(q) || a.host.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.name.toLowerCase().startsWith(q) || b.host.toLowerCase().startsWith(q) ? 0 : 1;
          return aStarts - bStarts;
        })
        .slice(0, 5)
        .map((profile) => ({ type: "session", profile }))
    : [];

  const recentResults: PaletteResult[] =
    q === ""
      ? profiles
          .filter((p) => p.lastConnected != null)
          .sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0))
          .slice(0, 4)
          .map((profile) => ({ type: "session", profile }))
      : [];

  const allResults = [...fileResults, ...sessionResults, ...recentResults];
  const clampedIdx = Math.min(selectedIdx, Math.max(0, allResults.length - 1));

  function activate(r: PaletteResult) {
    if (r.type === "file") {
      onNavigate(r.entry.path);
    } else {
      onSelectProfile(r.profile);
    }
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, allResults.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      const r = allResults.at(clampedIdx);
      if (r) activate(r);
    }
  }

  // Build flat result list with section headers for rendering
  const sections: { header: string; results: PaletteResult[] }[] = [];
  if (fileResults.length > 0) sections.push({ header: "Current Directory", results: fileResults });
  if (sessionResults.length > 0) sections.push({ header: "Sessions", results: sessionResults });
  if (recentResults.length > 0) sections.push({ header: "Recent", results: recentResults });

  let globalIdx = 0;

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center pt-[14vh]"
      style={{ background: "rgba(20,18,15,0.6)", backdropFilter: "blur(5px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[580px] overflow-hidden rounded-[14px] border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 32px 80px -12px rgba(20,18,15,0.55)" }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <span className="flex-shrink-0 text-text-faint">
            <Search size={17} strokeWidth={2} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKey}
            placeholder="Search files, sessions…"
            className="flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-faint"
          />
          <kbd className="flex-shrink-0 rounded border border-border-input px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto py-1">
          {allResults.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-text-faint">
              {query ? `No results for "${query}"` : "Start typing to search…"}
            </div>
          )}

          {sections.map(({ header, results }) => (
            <div key={header}>
              <div className="px-4 pb-1 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[1.2px] text-text-faint">
                {header}
              </div>
              {results.map((r) => {
                const idx = globalIdx++;
                const isActive = idx === clampedIdx;
                const key = r.type === "file" ? r.entry.path : r.profile.id;
                const label = r.type === "file" ? r.entry.name : r.profile.name;
                const sub =
                  r.type === "file"
                    ? r.entry.path
                    : `${r.profile.username}@${r.profile.host}`;
                const icon = r.type === "file"
                  ? r.entry.kind === "directory"
                    ? <Folder size={14} strokeWidth={2} />
                    : <FileText size={14} strokeWidth={2} />
                  : <Server size={14} strokeWidth={2} />;

                return (
                  <div
                    key={key}
                    onMouseEnter={() => { setSelectedIdx(idx); }}
                    onClick={() => { activate(r); }}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                      isActive ? "bg-[rgba(47,107,219,0.10)]" : "hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex-shrink-0 text-text-secondary">{icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-text-primary">{label}</div>
                      <div className="truncate font-mono text-[10.5px] text-text-faint">{sub}</div>
                    </div>
                    {isActive && (
                      <span className="flex flex-shrink-0 items-center rounded border border-border-input px-1.5 py-0.5 text-text-faint">
                        <CornerDownLeft size={11} strokeWidth={2} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2">
          {[["↑↓", "navigate"], ["↵", "open"], ["esc", "close"]].map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <kbd className="rounded border border-border-input px-1.5 py-0.5 font-mono text-[10px]">
                {key}
              </kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
