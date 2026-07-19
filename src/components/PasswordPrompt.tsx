import { useState } from "react";
import type { ConnectionProfile } from "../api";

/**
 * Small centered modal that asks for the SSH password of a saved
 * password-auth profile. Used for the "click to connect directly" flow.
 */
export function PasswordPrompt({
  profile,
  isLoading,
  error,
  onSubmit,
  onCancel,
}: {
  profile: ConnectionProfile;
  isLoading: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(200,196,188,0.55)", backdropFilter: "blur(3px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-[380px] overflow-hidden rounded-modal border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 40px 100px -20px rgba(60,55,45,0.35)" }}
      >
        <div className="border-b border-border px-5 py-4">
          <div className="text-[14px] font-semibold text-text-primary">
            Connect to {profile.name}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-text-secondary">
            {profile.username}@{profile.host}:{profile.port.toString()}
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!isLoading) onSubmit(password);
          }}
          className="flex flex-col gap-3 px-5 py-4"
        >
          {error && (
            <div className="rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            placeholder="Password"
            className="h-9 rounded-input border border-border-input bg-surface-pane px-3 text-[13px] text-text-primary outline-none focus:border-accent-dark"
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-input px-3 py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !password}
              className="flex-1 rounded-input py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
            >
              {isLoading ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
