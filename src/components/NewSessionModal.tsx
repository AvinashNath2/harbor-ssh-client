import { AlertTriangle, Check, ChevronDown, FolderOpen, Key, Plus, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { testConnection, type ConnectArgs, type ConnectionProfile } from "../api";

interface NewSessionModalProps {
  onConnect: (args: ConnectArgs, profile: ConnectionProfile | null) => void;
  onSave: (profile: ConnectionProfile) => Promise<void> | void;
  onClose: () => void;
  isLoading: boolean;
  error: string | null;
  existingFolders: string[];
  initialProfile?: ConnectionProfile | null;
  initialFolder?: string;
  currentlyConnectedHost?: string | null;
}

type AuthMode = "password" | "publicKey";

export function NewSessionModal({
  onConnect,
  onSave,
  onClose,
  isLoading,
  error,
  existingFolders,
  initialProfile,
  initialFolder,
  currentlyConnectedHost,
}: NewSessionModalProps) {
  const [sessionName, setSessionName] = useState(initialProfile?.name ?? "");
  const [host, setHost] = useState(initialProfile?.host ?? "");
  const [port, setPort] = useState(initialProfile?.port.toString() ?? "22");
  const [username, setUsername] = useState(initialProfile?.username ?? "");
  const [authMode, setAuthMode] = useState<AuthMode>(initialProfile?.authType ?? "password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState(initialProfile?.keyPath ?? "~/.ssh/id_rsa");
  const [passphrase, setPassphrase] = useState("");
  const [saveToFolder, setSaveToFolder] = useState(
    initialProfile?.folder ?? initialFolder ?? "",
  );
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [willSave, setWillSave] = useState(initialProfile != null || initialFolder != null);
  const [testState, setTestState] = useState<
    { status: "idle" } | { status: "testing" } | { status: "ok" } | { status: "error"; msg: string }
  >({ status: "idle" });
  const [saving, setSaving] = useState(false);

  const allFolders = Array.from(new Set([...existingFolders, "General"]));

  // "Dirty" = current form values differ from the initialProfile snapshot.
  // For new sessions (no initialProfile) we treat any non-empty host as dirty.
  const isDirty = initialProfile
    ? sessionName.trim() !== initialProfile.name ||
      host.trim() !== initialProfile.host ||
      parseInt(port, 10) !== initialProfile.port ||
      username.trim() !== initialProfile.username ||
      authMode !== initialProfile.authType ||
      (authMode === "publicKey" && keyPath !== (initialProfile.keyPath ?? "~/.ssh/id_rsa")) ||
      saveToFolder !== (initialProfile.folder ?? "")
    : host.trim().length > 0;

  const canConnect =
    host.trim() !== "" &&
    username.trim() !== "" &&
    (authMode === "password" ? password !== "" : keyPath !== "");

  function buildConnectArgs(): ConnectArgs {
    const authMethod: ConnectArgs["authMethod"] =
      authMode === "password"
        ? { type: "password", password }
        : { type: "publicKey", key_path: keyPath, passphrase: passphrase || undefined };

    return {
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      authMethod,
    };
  }

  function buildProfile(): ConnectionProfile | null {
    if (!willSave || !host.trim()) return null;
    return {
      id: initialProfile?.id ?? crypto.randomUUID(),
      name: sessionName.trim() || host.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      authType: authMode,
      keyPath: authMode === "publicKey" ? keyPath : undefined,
      folder: saveToFolder || "General",
      favorite: initialProfile?.favorite,
      lastConnected: initialProfile?.lastConnected,
    };
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    onConnect(buildConnectArgs(), buildProfile());
  }

  async function handleSaveOnly() {
    const profile = buildProfile();
    if (!profile) return;
    setSaving(true);
    try { await onSave(profile); } finally { setSaving(false); }
  }

  async function handleTest() {
    setTestState({ status: "testing" });
    try {
      await testConnection(buildConnectArgs());
      setTestState({ status: "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string }).message ?? String(e);
      setTestState({ status: "error", msg });
    }
  }

  function handleCreateFolder() {
    const name = newFolderName.trim();
    if (name) {
      setSaveToFolder(name);
      setCreatingFolder(false);
      setNewFolderName("");
      setFolderDropdownOpen(false);
      setWillSave(true);
    }
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(200,196,188,0.55)", backdropFilter: "blur(3px)" }}
    >
      <div
        className="w-[600px] overflow-hidden rounded-modal border border-border-raised bg-surface-pane"
        style={{ boxShadow: "0 40px 100px -20px rgba(60,55,45,0.35)" }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border px-6 py-5">
          <div
            className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[11px] text-accent-dark"
            style={{
              background: "rgba(47,107,219,0.10)",
              border: "1px solid rgba(47,107,219,0.25)",
            }}
          >
            <Plus size={16} strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-semibold text-text-primary">
              {initialProfile != null ? "Edit Session" : "New Session"}
            </div>
            <div className="mt-0.5 text-[12.5px] text-text-secondary">
              Configure a connection and save it to a folder
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
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4 px-6 py-5">
            {error && (
              <div className="rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
                {error}
              </div>
            )}

            {currentlyConnectedHost && (
              <div className="flex items-start gap-2 rounded-input border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-[#8a6020]">
                <span className="mt-0.5 leading-none">
                  <AlertTriangle size={12} strokeWidth={2} />
                </span>
                <div>
                  <div className="font-semibold">Heads up — only one active connection at a time</div>
                  <div className="mt-0.5 text-[11.5px] opacity-90">
                    Connecting to a new server will disconnect you from{" "}
                    <span className="font-mono">{currentlyConnectedHost}</span>. Terminal
                    sessions on the current server will also close.
                  </div>
                </div>
              </div>
            )}

            {/* Session Name */}
            <div>
              <FieldLabel>Session Name</FieldLabel>
              <input
                value={sessionName}
                onChange={(e) => {
                  setSessionName(e.target.value);
                }}
                placeholder={host || "my-server"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={80}
                className={fieldClass}
              />
            </div>

            {/* Host + Port */}
            <div className="flex gap-3">
              <div className="flex-1">
                <FieldLabel>Host / Address</FieldLabel>
                <input
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                  }}
                  placeholder="192.168.1.100"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={253}
                  className={`${fieldClass} font-mono`}
                />
              </div>
              <div className="w-24">
                <FieldLabel>Port</FieldLabel>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value);
                  }}
                  min={1}
                  max={65535}
                  required
                  className={`${fieldClass} font-mono`}
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <FieldLabel>Username</FieldLabel>
              <input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                }}
                placeholder="ubuntu"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                maxLength={64}
                className={`${fieldClass} font-mono`}
              />
            </div>

            {/* Auth toggle */}
            <div>
              <FieldLabel>Authentication</FieldLabel>
              <SegmentedControl
                options={[
                  { value: "password", label: "Password" },
                  { value: "publicKey", label: "SSH Key" },
                ]}
                value={authMode}
                onChange={(v) => {
                  setAuthMode(v as AuthMode);
                }}
              />
            </div>

            {/* Auth fields */}
            {authMode === "password" ? (
              <div>
                <FieldLabel>Password</FieldLabel>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  placeholder="••••••••"
                  required
                  className={fieldClass}
                />
              </div>
            ) : (
              <div>
                <FieldLabel>Private Key</FieldLabel>
                <div className="flex items-center gap-2.5 rounded-input border border-border-input bg-surface-pane px-3 py-0 h-[38px]">
                  <span className="text-success">
                    <Key size={12} strokeWidth={2} />
                  </span>
                  <input
                    value={keyPath}
                    onChange={(e) => {
                      setKeyPath(e.target.value);
                    }}
                    placeholder="~/.ssh/id_rsa"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={512}
                    className="flex-1 bg-transparent font-mono text-[12px] text-text-primary outline-none placeholder:text-text-faint"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void openDialog({ multiple: false, directory: false }).then((path) => {
                        if (typeof path === "string") setKeyPath(path);
                      });
                    }}
                    className="flex items-center gap-1 rounded-chip bg-surface-chip px-[11px] py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                  >
                    <FolderOpen size={10} strokeWidth={2} />
                    Browse…
                  </button>
                </div>
                <div className="mt-2">
                  <FieldLabel>Passphrase (optional)</FieldLabel>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => {
                      setPassphrase(e.target.value);
                    }}
                    placeholder="leave blank if none"
                    className={fieldClass}
                  />
                </div>
              </div>
            )}

            {/* Save to folder */}
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <FieldLabel noMargin>Save to Folder</FieldLabel>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-faint">
                  <input
                    type="checkbox"
                    checked={willSave}
                    onChange={(e) => {
                      setWillSave(e.target.checked);
                    }}
                    className="h-3 w-3 accent-accent-dark"
                  />
                  save this connection
                </label>
              </div>

              {willSave && (
                <div
                  className="overflow-hidden rounded-input border border-accent-dark bg-surface-pane"
                  style={{ boxShadow: "0 0 0 3px rgba(47,107,219,0.10)" }}
                >
                  {/* Selected row */}
                  <button
                    type="button"
                    onClick={() => {
                      setFolderDropdownOpen(!folderDropdownOpen);
                    }}
                    className="flex h-[38px] w-full items-center gap-2.5 border-b border-border px-3"
                  >
                    <span className="h-3.5 w-3.5 flex-shrink-0 rounded-[3px] bg-warning" />
                    <span className="flex-1 text-left text-[13px] font-medium text-text-primary">
                      {saveToFolder || "Select folder…"}
                    </span>
                    <span
                      className="text-accent-dark transition-transform"
                      style={{ transform: folderDropdownOpen ? "rotate(180deg)" : "rotate(0)" }}
                    >
                      <ChevronDown size={10} strokeWidth={2} />
                    </span>
                  </button>

                  {folderDropdownOpen && (
                    <>
                      {allFolders.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => {
                            setSaveToFolder(f);
                            setFolderDropdownOpen(false);
                          }}
                          className={`flex h-9 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-surface-hover ${
                            saveToFolder === f ? "bg-[rgba(47,107,219,0.08)]" : ""
                          }`}
                        >
                          <span className="h-3.5 w-3.5 flex-shrink-0 rounded-[3px] bg-warning" />
                          <span className="flex-1 text-[13px] text-text-primary">{f}</span>
                          {saveToFolder === f && (
                            <span className="text-accent-dark">
                              <Check size={12} strokeWidth={2} />
                            </span>
                          )}
                        </button>
                      ))}
                      <div className="border-t border-border">
                        {creatingFolder ? (
                          <div className="flex items-center gap-2 px-3 py-2">
                            <input
                              autoFocus
                              value={newFolderName}
                              onChange={(e) => {
                                setNewFolderName(e.target.value);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreateFolder();
                                if (e.key === "Escape") {
                                  setCreatingFolder(false);
                                }
                              }}
                              placeholder="Folder name…"
                              className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-faint"
                            />
                            <button
                              type="button"
                              onClick={handleCreateFolder}
                              className="text-[12px] font-semibold text-accent-dark"
                            >
                              Add
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setCreatingFolder(true);
                            }}
                            className="flex h-10 w-full items-center gap-2.5 px-3 transition-colors hover:bg-surface-hover"
                          >
                            <span
                              className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[4px] text-accent-dark"
                              style={{ border: "1px dashed #2f6bdb" }}
                            >
                              <Plus size={10} strokeWidth={2.2} />
                            </span>
                            <span className="text-[13px] font-medium text-accent-dark">
                              New folder…
                            </span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-col gap-2 border-t border-border px-6 py-4">
            {/* Test result strip */}
            {testState.status !== "idle" && (
              <div
                className="rounded-input px-3 py-2 text-[12px]"
                style={
                  testState.status === "ok"
                    ? { background: "rgba(31,157,99,0.10)", color: "#177a4c", border: "1px solid rgba(31,157,99,0.28)" }
                    : testState.status === "error"
                      ? { background: "rgba(229,83,75,0.10)", color: "#b33c34", border: "1px solid rgba(229,83,75,0.3)" }
                      : { background: "rgba(63,123,224,0.10)", color: "#2f6bdb", border: "1px solid rgba(63,123,224,0.28)" }
                }
              >
                {testState.status === "testing" && "Testing connection…"}
                {testState.status === "ok" && (
                  <span className="inline-flex items-center gap-1.5">
                    <Check size={12} strokeWidth={2} /> Connection succeeded
                  </span>
                )}
                {testState.status === "error" && (
                  <span className="inline-flex items-center gap-1.5">
                    <X size={12} strokeWidth={2.2} /> {testState.msg}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { void handleTest(); }}
                disabled={!canConnect || testState.status === "testing" || isLoading}
                className="rounded-input border border-border-input bg-surface-chip px-3 py-2 text-[12.5px] font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testState.status === "testing" ? "Testing…" : "Test connection"}
              </button>

              <div className="flex-1" />

              <button
                type="button"
                onClick={() => {
                  if (isDirty && !window.confirm("Discard unsaved changes?")) return;
                  onClose();
                }}
                className="rounded-input px-4 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
              >
                Cancel
              </button>

              {willSave && (
                <button
                  type="button"
                  onClick={() => { void handleSaveOnly(); }}
                  disabled={!isDirty || saving || !host.trim()}
                  className="rounded-input border border-accent-dark px-4 py-2 text-[13px] font-semibold text-accent-dark transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  title={isDirty ? "Save changes" : "No changes to save"}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              )}

              <button
                type="submit"
                disabled={isLoading || !canConnect}
                className="rounded-input px-[18px] py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: "linear-gradient(150deg, #3f7be0, #2f6bdb)",
                  boxShadow: "0 4px 14px -4px rgba(47,107,219,0.5)",
                }}
              >
                {isLoading ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldLabel({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div
      className={`font-mono text-[10px] font-semibold uppercase tracking-[1px] text-text-secondary ${noMargin ? "" : "mb-1.5"}`}
    >
      {children}
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-input border border-border-input bg-surface-colheader p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => {
            onChange(opt.value);
          }}
          className={`flex-1 rounded-chip py-[7px] text-[12px] font-medium transition-colors ${
            value === opt.value
              ? "font-semibold text-white"
              : "text-text-secondary hover:text-text-primary"
          }`}
          style={
            value === opt.value
              ? { background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }
              : undefined
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const fieldClass =
  "w-full h-[38px] rounded-input border border-border-input bg-surface-pane px-3 text-[13px] text-text-primary placeholder:text-text-faint outline-none focus:border-accent-dark focus:shadow-[0_0_0_3px_rgba(47,107,219,0.10)]";
