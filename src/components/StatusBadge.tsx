interface StatusBadgeProps {
  status: "ok" | "error" | "loading" | "idle";
  label: string;
}

const variantClasses: Record<StatusBadgeProps["status"], string> = {
  ok: "bg-success/20 text-success border-success/40",
  error: "bg-error/20 text-error border-error/40",
  loading: "bg-accent/20 text-accent border-accent/40 animate-pulse",
  idle: "bg-surface-overlay text-text-muted border-surface-overlay",
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${variantClasses[status]}`}
    >
      {label}
    </span>
  );
}
