import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { parseSshConfig, type ConnectionProfile, type SshConfigHost } from "../api";

interface SshConfigImportModalProps {
  existingProfiles: ConnectionProfile[];
  onImport: (profiles: ConnectionProfile[]) => void;
  onClose: () => void;
}

export function SshConfigImportModal({
  existingProfiles,
  onImport,
  onClose,
}: SshConfigImportModalProps) {
  const [hosts, setHosts] = useState<SshConfigHost[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState("Imported");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    parseSshConfig()
      .then((h) => {
        // Skip hosts that are missing a hostname — nothing to connect to.
        const usable = h.filter((entry) => (entry.hostName ?? entry.name) !== "");
        setHosts(usable);
        // Preselect entries that aren't already in the profile list.
        const existingHosts = new Set(existingProfiles.map((p) => p.host.toLowerCase()));
        const preselect = new Set(
          usable
            .filter((entry) => !existingHosts.has((entry.hostName ?? entry.name).toLowerCase()))
            .map((entry) => entry.name),
        );
        setSelected(preselect);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
  }, [existingProfiles]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === hosts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(hosts.map((h) => h.name)));
    }
  }

  function handleImport() {
    const selectedHosts = hosts.filter((h) => selected.has(h.name));
    const profiles: ConnectionProfile[] = selectedHosts.map((h) => ({
      id: crypto.randomUUID(),
      name: h.name,
      host: h.hostName ?? h.name,
      port: h.port ?? 22,
      username: h.user ?? "",
      authType: h.identityFile ? "publicKey" : "password",
      keyPath: h.identityFile ?? undefined,
      folder: folder.trim() || "Imported",
    }));
    onImport(profiles);
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(200,196,188,0.55)", backdropFilter: "blur(3px)" }}
    >
      <div
        className="w-[560px] overflow-hidden rounded-modal border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 40px 100px -20px rgba(60,55,45,0.35)" }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-6 py-5">
          <div
            className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[11px] text-[16px] text-accent-dark"
            style={{ background: "rgba(47,107,219,0.10)", border: "1px solid rgba(47,107,219,0.25)" }}
          >
            ⌘
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-semibold text-text-primary">Import from ~/.ssh/config</div>
            <div className="mt-0.5 text-[12.5px] text-text-secondary">
              Select hosts to import as saved sessions
            </div>
          </div>
          <button
            onClick={onClose}
            className="leading-none text-text-faint transition-colors hover:text-text-secondary"
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[420px] overflow-y-auto">
          {status === "loading" && (
            <div className="px-6 py-10 text-center text-[13px] text-text-faint">Reading config…</div>
          )}

          {status === "error" && (
            <div className="px-6 py-10 text-center text-[13px] text-danger">{error}</div>
          )}

          {status === "ready" && hosts.length === 0 && (
            <div className="px-6 py-10 text-center text-[13px] text-text-faint">
              No hosts found in ~/.ssh/config.
              <br />
              (File may not exist, or only contains wildcard blocks.)
            </div>
          )}

          {status === "ready" && hosts.length > 0 && (
            <>
              <div className="flex items-center justify-between border-b border-border px-6 py-2 text-[11px] font-mono uppercase tracking-[1px] text-text-faint">
                <button onClick={toggleAll} className="hover:text-accent-dark">
                  {selected.size === hosts.length ? "Clear all" : "Select all"}
                </button>
                <span>{selected.size} / {hosts.length}</span>
              </div>
              {hosts.map((h) => {
                const isSelected = selected.has(h.name);
                const displayHost = h.hostName ?? h.name;
                const displayUser = h.user ? `${h.user}@` : "";
                return (
                  <label
                    key={h.name}
                    className="flex cursor-pointer items-center gap-3 border-b border-border px-6 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => { toggle(h.name); }}
                      className="h-3.5 w-3.5 flex-shrink-0 accent-accent-dark"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-text-primary">
                        {h.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-text-tertiary">
                        {displayUser}{displayHost}
                        {h.port ? `:${h.port.toString()}` : ""}
                        {h.identityFile ? `  ·  key: ${h.identityFile}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[1px] text-text-faint">
              Folder
            </label>
            <input
              value={folder}
              onChange={(e) => { setFolder(e.target.value); }}
              className="h-8 w-[140px] rounded-input border border-border-input bg-surface-pane px-2 text-[12.5px] text-text-primary outline-none focus:border-accent-dark"
            />
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-input px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={selected.size === 0}
            className="rounded-input px-[18px] py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: "linear-gradient(150deg, #3f7be0, #2f6bdb)",
              boxShadow: "0 4px 14px -4px rgba(47,107,219,0.5)",
            }}
          >
            Import {selected.size > 0 ? `(${selected.size.toString()})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
