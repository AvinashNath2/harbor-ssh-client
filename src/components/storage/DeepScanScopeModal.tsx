import { AlertTriangle, HardDrive, Zap } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  /** Suggested initial directory — the profile's pinned defaultPath if set,
   *  else the user's home dir. */
  defaultPath: string;
  onCancel: () => void;
  onStart: (root: string) => void;
}

type Mode = "directory" | "full";

const QUICK_CHIPS = ["/var/log", "/var/lib/docker", "/home", "/tmp", "~"];

export function DeepScanScopeModal({ defaultPath, onCancel, onStart }: Props) {
  const [mode, setMode] = useState<Mode>("directory");
  const [path, setPath] = useState(defaultPath || "~");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  function handleStart(e: React.SyntheticEvent) {
    e.preventDefault();
    if (mode === "full") {
      onStart("/");
      return;
    }
    const trimmed = path.trim();
    if (!trimmed) return;
    onStart(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={handleStart}
        className="w-[560px] max-w-[92vw] rounded-modal border border-border-raised bg-surface-pane shadow-xl"
      >
        {/* Header */}
        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-[#3f7be0]" />
            <h2 className="text-[14px] font-semibold text-text-primary">Deep Scan — pick scope</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-text-faint">
            Deep Scan walks the filesystem to compute folder sizes and a file-age histogram. On a
            production server, prefer scanning a specific directory — it&rsquo;s faster, lighter,
            and easier to reason about.
          </p>
        </div>

        {/* Options */}
        <div className="space-y-2.5 px-5 py-4">
          {/* Directory option (recommended) */}
          <label
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${
              mode === "directory"
                ? "border-accent-dark bg-[rgba(47,107,219,0.06)]"
                : "border-border-input hover:bg-surface-chip"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="radio"
                name="scope"
                value="directory"
                checked={mode === "directory"}
                onChange={() => {
                  setMode("directory");
                }}
                className="mt-0.5 accent-accent"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <HardDrive size={12} className="text-accent-dark" />
                  <span className="text-[12.5px] font-semibold text-text-primary">
                    Scan a specific directory
                  </span>
                  <span className="rounded-sm bg-success/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#177a4c]">
                    Recommended
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-text-faint">
                  Scans only the folder you pick. Typical run time: seconds. Cancel is instant.
                </p>
              </div>
            </div>

            {mode === "directory" && (
              <div className="ml-6 space-y-2">
                <input
                  autoFocus
                  type="text"
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="/var/log"
                  className="w-full rounded-input border border-border-input bg-transparent px-3 py-1.5 font-mono text-[12px] text-text-primary outline-none focus:border-accent"
                />
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setPath(chip);
                      }}
                      className={`rounded-chip border px-2 py-0.5 font-mono text-[10.5px] transition-colors ${
                        path === chip
                          ? "border-accent-dark bg-accent/10 text-accent-dark"
                          : "border-border-input bg-surface-chip text-text-tertiary hover:text-text-primary"
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </label>

          {/* Full-filesystem option */}
          <label
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${
              mode === "full"
                ? "border-amber-400 bg-amber-50/60"
                : "border-border-input hover:bg-surface-chip"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="radio"
                name="scope"
                value="full"
                checked={mode === "full"}
                onChange={() => {
                  setMode("full");
                }}
                className="mt-0.5 accent-amber-500"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] font-bold text-text-primary">/</span>
                  <span className="text-[12.5px] font-semibold text-text-primary">
                    Scan the entire filesystem
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-text-faint">
                  Full-machine folder sizes, age histogram, AND category breakdown. Slower — minutes
                  on large servers.
                </p>
              </div>
            </div>
            {mode === "full" && (
              <div className="ml-6 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/70 px-3 py-2 text-[11px] text-amber-900">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>
                  Runs with idle CPU + IO priority so it yields to production workload, but still
                  reads every folder&rsquo;s size. Cancel is instant — clicking Cancel kills the
                  remote <span className="font-mono">du</span>/
                  <span className="font-mono">find</span> process within ~1 second.
                </span>
              </div>
            )}
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-input border border-border-input px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-chip"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mode === "directory" && !path.trim()}
            className="flex items-center gap-1.5 rounded-input px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,#3f7be0,#2f6bdb)" }}
          >
            <Zap size={11} />
            Start scan
          </button>
        </div>
      </form>
    </div>
  );
}
