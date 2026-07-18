import { Bookmark, Clock, Search, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteSession, listSessions, type SessionRecord } from "../api";
import { fmtSessionDuration } from "../utils/fmtDuration";

interface SessionListViewProps {
  onOpen: (session: SessionRecord) => void;
}

function groupByDate(sessions: SessionRecord[]): { label: string; items: SessionRecord[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;

  const buckets = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let label: string;
    if (day >= today) label = "Today";
    else if (day >= yesterday) label = "Yesterday";
    else label = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const existing = buckets.get(label) ?? [];
    existing.push(s);
    buckets.set(label, existing);
  }
  return Array.from(buckets.entries()).map(([label, items]) => ({ label, items }));
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}


export function SessionListView({ onOpen }: SessionListViewProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  function reload() {
    setLoading(true);
    listSessions()
      .then(setSessions)
      .catch(() => undefined)
      .finally(() => { setLoading(false); });
  }

  useEffect(() => { reload(); }, []);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteSession(id).catch(() => undefined);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  const filtered = query.trim()
    ? sessions.filter((s) => {
        const q = query.toLowerCase();
        return (
          s.host.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q) ||
          s.ip.toLowerCase().includes(q) ||
          (s.profileName?.toLowerCase().includes(q) ?? false)
        );
      })
    : sessions;

  const groups = groupByDate(filtered);

  return (
    <div className="flex h-full flex-col">
      {/* Search bar */}
      <div className="flex-none border-b border-border-raised px-5 py-3">
        <div className="flex h-9 items-center gap-2.5 rounded-input border border-border-input bg-surface-colheader px-3">
          <Search size={13} strokeWidth={2} className="flex-shrink-0 text-text-faint" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Search sessions by host, user, or IP…"
            className="flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
            Loading…
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-surface-chip text-text-faint">
              <Terminal size={22} strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-text-primary">No sessions recorded yet</p>
              <p className="mt-1 text-[12px] text-text-secondary">
                Open a terminal and run some commands — they&apos;ll appear here.
              </p>
            </div>
          </div>
        )}

        {!loading && sessions.length > 0 && filtered.length === 0 && (
          <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
            No sessions match &ldquo;{query}&rdquo;
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            {/* Date group header */}
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border-raised bg-surface-colheader px-5 py-2">
              <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[1px] text-text-faint">
                {label}
              </span>
              <div className="flex-1 border-t border-border-raised" />
            </div>

            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => { onOpen(s); }}
                className="flex w-full items-center gap-4 border-b border-border-subtle px-5 py-3.5 text-left transition-colors hover:bg-surface-hover"
              >
                {/* Status dot */}
                <span
                  className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${
                    s.endedAt === null ? "bg-success" : "bg-border-raised"
                  }`}
                />

                {/* Main info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">
                      {s.username}@{s.host}
                    </span>
                    {s.profileName && (
                      <span className="flex items-center gap-1 rounded-chip bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent-dark">
                        <Bookmark size={9} strokeWidth={2.2} />
                        {s.profileName}
                      </span>
                    )}
                    {s.endedAt === null && (
                      <span className="rounded-chip bg-success/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.5px] text-[#177a4c]">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 font-mono text-[11px] text-text-faint">
                    <span>{s.ip}</span>
                    <span>·</span>
                    <span>{s.cmdCount.toString()} command{s.cmdCount !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} strokeWidth={2} />
                      {fmtTime(s.startedAt)}
                      {s.endedAt && ` – ${fmtTime(s.endedAt)}`}
                    </span>
                    <span>·</span>
                    <span>{fmtSessionDuration(s.startedAt, s.endedAt)}</span>
                  </div>
                </div>

                {/* Delete */}
                <button
                  onClick={(e) => { void handleDelete(s.id, e); }}
                  className="flex-shrink-0 rounded-[6px] p-1.5 text-text-faint opacity-0 transition-all hover:bg-red-50 hover:text-danger group-hover:opacity-100"
                  title="Delete session"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
