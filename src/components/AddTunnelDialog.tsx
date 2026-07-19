import { useState } from "react";

const PRESETS = [
  { label: "PostgreSQL", host: "localhost", port: 5432 },
  { label: "MySQL", host: "localhost", port: 3306 },
  { label: "Redis", host: "localhost", port: 6379 },
  { label: "HTTP", host: "localhost", port: 8080 },
];

interface Props {
  onAdd: (localPort: number, remoteHost: string, remotePort: number) => void;
  onClose: () => void;
}

export function AddTunnelDialog({ onAdd, onClose }: Props) {
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("localhost");
  const [remotePort, setRemotePort] = useState("");

  function applyPreset(p: (typeof PRESETS)[0]) {
    setRemoteHost(p.host);
    setRemotePort(String(p.port));
    setLocalPort(String(p.port));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    if (!lp || !rp || !remoteHost.trim()) return;
    onAdd(lp, remoteHost.trim(), rp);
    onClose();
  }

  const inputClass =
    "w-full rounded-[8px] border border-border-raised bg-surface-input px-3 py-2 font-mono text-[12px] text-text-primary outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        className="w-[340px] rounded-[14px] border border-border-raised bg-surface-pane p-5 shadow-xl"
      >
        <h2 className="mb-4 text-[13px] font-semibold text-text-primary">New Tunnel</h2>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => { applyPreset(p); }}
              className="rounded-[6px] bg-surface-chip px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-[11px] text-text-faint">Local Port</label>
        <input
          value={localPort}
          onChange={(e) => { setLocalPort(e.target.value); }}
          type="number"
          min={1024}
          max={65535}
          required
          placeholder="5432"
          className={`mb-3 ${inputClass}`}
        />

        <label className="mb-1 block text-[11px] text-text-faint">Remote Host</label>
        <input
          value={remoteHost}
          onChange={(e) => { setRemoteHost(e.target.value); }}
          required
          placeholder="localhost"
          className={`mb-3 ${inputClass}`}
        />

        <label className="mb-1 block text-[11px] text-text-faint">Remote Port</label>
        <input
          value={remotePort}
          onChange={(e) => { setRemotePort(e.target.value); }}
          type="number"
          min={1}
          max={65535}
          required
          placeholder="5432"
          className={`mb-5 ${inputClass}`}
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12px] text-text-secondary hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-[8px] bg-accent px-4 py-2 text-[12px] font-medium text-white hover:opacity-90"
          >
            Add Tunnel
          </button>
        </div>
      </form>
    </div>
  );
}
