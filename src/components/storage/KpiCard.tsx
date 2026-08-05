interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}

export function KpiCard({ label, value, sub, color, icon }: KpiCardProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border border-border-raised bg-surface-pane p-4"
      style={{ minWidth: 0 }}
    >
      <div className="flex items-center gap-2">
        {icon && (
          <span style={{ color: color ?? "#6b7280" }} className="flex-shrink-0">
            {icon}
          </span>
        )}
        <span className="truncate text-[11px] font-medium uppercase tracking-widest text-text-faint">
          {label}
        </span>
      </div>
      <span
        className="mt-1 truncate text-[22px] font-bold leading-tight text-text-primary"
        style={{ color: color ?? undefined }}
      >
        {value}
      </span>
      {sub && <span className="truncate text-[11.5px] text-text-secondary">{sub}</span>}
    </div>
  );
}
