import { AlertCircle, AlertTriangle, CheckCircle, Info, Loader2 } from "lucide-react";

export type BannerVariant = "loading" | "info" | "warning" | "error" | "success";

interface InlineBannerProps {
  variant?: BannerVariant;
  title: string;
  description?: string;
  /** Replace the default variant icon with a custom node */
  icon?: React.ReactNode;
}

const VARIANT_STYLES: Record<
  BannerVariant,
  {
    bg: string;
    border: string;
    iconColor: string;
    titleColor: string;
    descColor: string;
    DefaultIcon: React.ElementType;
  }
> = {
  loading: {
    bg: "bg-blue-100",
    border: "border-blue-200",
    iconColor: "text-blue-600",
    titleColor: "text-blue-900",
    descColor: "text-blue-700",
    DefaultIcon: Loader2,
  },
  info: {
    bg: "bg-blue-100",
    border: "border-blue-200",
    iconColor: "text-blue-600",
    titleColor: "text-blue-900",
    descColor: "text-blue-700",
    DefaultIcon: Info,
  },
  warning: {
    bg: "bg-amber-100",
    border: "border-amber-200",
    iconColor: "text-amber-600",
    titleColor: "text-amber-900",
    descColor: "text-amber-700",
    DefaultIcon: AlertTriangle,
  },
  error: {
    bg: "bg-red-100",
    border: "border-red-200",
    iconColor: "text-red-600",
    titleColor: "text-red-900",
    descColor: "text-red-700",
    DefaultIcon: AlertCircle,
  },
  success: {
    bg: "bg-green-100",
    border: "border-green-200",
    iconColor: "text-green-600",
    titleColor: "text-green-900",
    descColor: "text-green-700",
    DefaultIcon: CheckCircle,
  },
};

export function InlineBanner({ variant = "info", title, description, icon }: InlineBannerProps) {
  const s = VARIANT_STYLES[variant];
  const isLoading = variant === "loading";

  return (
    <div
      className={`flex flex-none items-center gap-2 border-b px-3.5 py-1.5 ${s.bg} ${s.border}`}
    >
      {icon ?? (
        <s.DefaultIcon
          size={13}
          strokeWidth={2.2}
          className={`flex-shrink-0 ${s.iconColor} ${isLoading ? "animate-spin" : ""}`}
        />
      )}
      <span className={`text-[11.5px] font-medium ${s.titleColor}`}>
        {title}
        {description && (
          <span className={`ml-1.5 font-mono text-[10.5px] font-normal ${s.descColor}`}>
            {description}
          </span>
        )}
      </span>
    </div>
  );
}
