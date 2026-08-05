import { Save } from "lucide-react";
import { useState } from "react";

const THRESHOLDS_KEY = "harbor.storage.thresholds";

interface StorageThresholds {
  mountWarn: number;
  mountDanger: number;
  mountCrit: number;
  folderWarn: number;
  folderDanger: number;
  folderCrit: number;
}

const DEFAULTS: StorageThresholds = {
  mountWarn: 70,
  mountDanger: 85,
  mountCrit: 95,
  folderWarn: 5,
  folderDanger: 15,
  folderCrit: 40,
};

function loadThresholds(): StorageThresholds {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<StorageThresholds>) };
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULTS };
}

export function SettingsTab() {
  const [thresholds, setThresholds] = useState<StorageThresholds>(loadThresholds);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof StorageThresholds, value: number) => {
    setSaved(false);
    setThresholds((t) => ({ ...t, [key]: value }));
  };

  const save = () => {
    localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(thresholds));
    setSaved(true);
  };

  const reset = () => {
    setThresholds({ ...DEFAULTS });
    setSaved(false);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-[13px] font-semibold text-text-primary">Storage Settings</h2>
        <p className="mt-0.5 text-[11.5px] text-text-faint">
          Customize health thresholds. Changes apply when the Storage Analyzer is next opened.
        </p>
      </div>

      {/* Mount fullness thresholds */}
      <Section
        title="Disk Mount Health Thresholds"
        description="Triggered by % used on each mounted filesystem (df)"
      >
        <ThresholdRow
          label="Warning"
          color="#f59e0b"
          value={thresholds.mountWarn}
          unit="%"
          min={50}
          max={94}
          onChange={(v) => {
            set("mountWarn", v);
          }}
        />
        <ThresholdRow
          label="Danger"
          color="#f97316"
          value={thresholds.mountDanger}
          unit="%"
          min={51}
          max={94}
          onChange={(v) => {
            set("mountDanger", v);
          }}
        />
        <ThresholdRow
          label="Critical"
          color="#ef4444"
          value={thresholds.mountCrit}
          unit="%"
          min={52}
          max={99}
          onChange={(v) => {
            set("mountCrit", v);
          }}
        />
      </Section>

      {/* Folder share thresholds */}
      <Section
        title="Folder Size Share Thresholds"
        description="Triggered by a folder's % of total disk (treemap & explorer)"
      >
        <ThresholdRow
          label="Warning"
          color="#f59e0b"
          value={thresholds.folderWarn}
          unit="% of disk"
          min={1}
          max={39}
          onChange={(v) => {
            set("folderWarn", v);
          }}
        />
        <ThresholdRow
          label="Danger"
          color="#f97316"
          value={thresholds.folderDanger}
          unit="% of disk"
          min={2}
          max={39}
          onChange={(v) => {
            set("folderDanger", v);
          }}
        />
        <ThresholdRow
          label="Critical"
          color="#ef4444"
          value={thresholds.folderCrit}
          unit="% of disk"
          min={3}
          max={90}
          onChange={(v) => {
            set("folderCrit", v);
          }}
        />
      </Section>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#3f7be0,#2f6bdb)" }}
        >
          <Save size={13} />
          Save Settings
        </button>
        <button
          onClick={reset}
          className="rounded-lg border border-border-input px-4 py-2 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-chip"
        >
          Reset to Defaults
        </button>
        {saved && (
          <span className="text-[12px] text-green-400">Saved — reopen the analyzer to apply</span>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-pane p-5">
      <h3 className="text-[12.5px] font-semibold text-text-primary">{title}</h3>
      <p className="mb-4 mt-0.5 text-[11px] text-text-faint">{description}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function ThresholdRow({
  label,
  color,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  color: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex w-20 items-center gap-2">
        <div className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: color }} />
        <span className="text-[12px] text-text-secondary">{label}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
        className="flex-1 accent-[#3f7be0]"
      />
      <div className="w-24 text-right">
        <span className="font-semibold tabular-nums text-text-primary" style={{ fontSize: 12 }}>
          {value}
        </span>
        <span className="ml-1 text-[11px] text-text-faint">{unit}</span>
      </div>
    </div>
  );
}
