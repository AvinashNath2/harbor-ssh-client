import { AlertTriangle } from "lucide-react";

interface ReconnectingBannerProps {
  status: "reconnecting" | "failed";
  host: string;
  attempt: number;
  maxAttempts: number;
  reason?: string | null;
  onDismiss?: () => void;
}

/**
 * Bottom-centered pill shown while Harbor tries to re-establish a dropped
 * SSH session using cached credentials.
 */
export function ReconnectingBanner({
  status,
  host,
  attempt,
  maxAttempts,
  reason,
  onDismiss,
}: ReconnectingBannerProps) {
  const isFailure = status === "failed";
  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-center gap-3 rounded-[12px] border px-4 py-2.5 shadow-lg"
        style={
          isFailure
            ? {
                background: "#fef1f0",
                borderColor: "rgba(229,83,75,0.32)",
                boxShadow: "0 12px 32px -6px rgba(60,55,45,0.25)",
              }
            : {
                background: "#fff9e6",
                borderColor: "rgba(224,165,60,0.35)",
                boxShadow: "0 12px 32px -6px rgba(60,55,45,0.25)",
              }
        }
      >
        {!isFailure && (
          <span
            className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "#e0a53c", borderTopColor: "transparent" }}
            aria-hidden
          />
        )}
        {isFailure && (
          <span className="text-danger">
            <AlertTriangle size={14} strokeWidth={2} />
          </span>
        )}
        <div className="flex flex-col">
          <span className="text-[12.5px] font-medium text-text-primary">
            {isFailure
              ? `Could not reconnect to ${host}`
              : `Connection to ${host} lost — reconnecting…`}
          </span>
          {!isFailure && (
            <span className="mt-0.5 font-mono text-[10.5px] text-text-tertiary">
              Attempt {attempt.toString()} of {maxAttempts.toString()}
            </span>
          )}
          {isFailure && reason && (
            <span className="mt-0.5 font-mono text-[10.5px] text-danger/70">
              {reason}
            </span>
          )}
        </div>
        {isFailure && onDismiss && (
          <button
            onClick={onDismiss}
            className="ml-2 text-[12px] text-text-tertiary transition-colors hover:text-text-primary"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
