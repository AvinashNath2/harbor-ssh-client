import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Key, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeTerminal,
  openTerminal,
  resizeTerminal,
  writeTerminal,
  type ConnectionProfile,
} from "../api";
import { OscParser, stripAnsi, type OscEvent } from "../utils/oscParser";
import type { PendingCommand } from "../hooks/useSessionLog";

interface TerminalTab {
  id: string;
  label: string;
  status: "opening" | "open" | "closed" | "dropped" | "error";
  error?: string;
  /** Snapshot of what this tab was opened with — used by the Reconnect
   *  button when the underlying SSH channel dies. Undefined means "the
   *  currently connected server at open-time" (no explicit profile). */
  profile?: ConnectionProfile;
  password?: string;
}

// Output capture limits (read from localStorage, defaulting to sensible values).
const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_BYTES = 100 * 1024; // 100 KB

function getOutputLimits(): { maxLines: number; maxBytes: number } {
  try {
    return {
      maxLines: parseInt(localStorage.getItem("harbor.log.maxLines") ?? "", 10) || DEFAULT_MAX_LINES,
      maxBytes: parseInt(localStorage.getItem("harbor.log.maxBytes") ?? "", 10) || DEFAULT_MAX_BYTES,
    };
  } catch {
    return { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES };
  }
}

interface TerminalPanelProps {
  serverLabel: string;
  profiles: ConnectionProfile[];
  currentHost: string;
  onClose: () => void;
  onCommandLogged?: (cmd: PendingCommand) => void;
}

export function TerminalPanel({ serverLabel, profiles, currentHost, onClose, onCommandLogged }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [passwordPromptFor, setPasswordPromptFor] = useState<ConnectionProfile | null>(null);
  // Keep ref to tabs so event handlers don't hold stale closures.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Open one terminal on mount (for the currently connected server).
  useEffect(() => {
    void openNewTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for terminal-closed events from Rust. Fires when the terminal
  // thread's read loop exits (session dropped, remote logout, etc). Flip the
  // tab into the "dropped" state so the user sees a Reconnect button instead
  // of a silently dead pane.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ id: string }>("terminal-closed", (event) => {
      const droppedId = event.payload.id;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === droppedId && (t.status === "open" || t.status === "opening")
            ? { ...t, status: "dropped" }
            : t,
        ),
      );
    })
      .then((fn) => { unlisten = fn; })
      .catch(() => undefined);
    return () => { unlisten?.(); };
  }, []);

  async function openNewTab(profile?: ConnectionProfile, password?: string) {
    const id = crypto.randomUUID();
    const label = profile ? `${profile.username}@${profile.host}` : serverLabel;
    setTabs((prev) => [...prev, { id, label, status: "opening", profile, password }]);
    setActiveTabId(id);
    try {
      if (profile) {
        const authMethod =
          profile.authType === "password"
            ? ({ type: "password" as const, password: password ?? "" })
            : ({ type: "publicKey" as const, key_path: profile.keyPath ?? "~/.ssh/id_rsa" });
        await openTerminal(id, {
          host: profile.host,
          port: profile.port,
          username: profile.username,
          authMethod,
        });
      } else {
        await openTerminal(id);
      }
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, status: "open" } : t)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "error", error: msg } : t)),
      );
    }
  }

  /** Replace a dropped tab with a fresh terminal on the same server. */
  async function reconnectTab(oldTabId: string) {
    const tab = tabsRef.current.find((t) => t.id === oldTabId);
    if (!tab) return;
    // Remove the dropped tab and immediately open a fresh one — preserves
    // tab order roughly and avoids stale xterm state.
    setTabs((prev) => prev.filter((t) => t.id !== oldTabId));
    await openNewTab(tab.profile, tab.password);
  }

  function handlePickProfile(profile: ConnectionProfile) {
    setShowPicker(false);
    if (profile.authType === "password") {
      setPasswordPromptFor(profile);
    } else {
      void openNewTab(profile);
    }
  }

  const otherProfiles = profiles.filter((p) => p.host !== currentHost);

  function handleCloseTab(id: string) {
    void closeTerminal(id);

    const currentTabs = tabsRef.current;
    const remaining = currentTabs.filter((t) => t.id !== id);

    if (remaining.length === 0) {
      // Last tab closed — remove all state then close the panel.
      setTabs([]);
      setActiveTabId(null);
      onClose();
      return;
    }

    setTabs(remaining);

    // If the active tab was closed, activate the tab before it (or first remaining).
    if (activeTabId === id) {
      const closedIdx = currentTabs.findIndex((t) => t.id === id);
      // .at() returns T | undefined so the optional chain is valid.
      setActiveTabId(remaining.at(Math.max(0, closedIdx - 1))?.id ?? null);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col border-t border-border-raised"
      style={{ background: "#1e2127" }}
    >
      {/* Tab bar */}
      <div
        className="flex h-8 flex-none items-center gap-0 overflow-x-auto"
        style={{ background: "#111214", borderBottom: "1px solid #2a2b2e" }}
      >
        {tabs.map((tab) => (
          <TerminalTabBtn
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={() => {
              setActiveTabId(tab.id);
            }}
            onClose={() => {
              handleCloseTab(tab.id);
            }}
          />
        ))}
        <div className="relative">
          <button
            onClick={() => {
              if (otherProfiles.length === 0) {
                void openNewTab();
              } else {
                setShowPicker((v) => !v);
              }
            }}
            className="flex h-full w-9 flex-shrink-0 items-center justify-center gap-0.5 text-gray-500 transition-colors hover:text-gray-300"
            title={otherProfiles.length === 0 ? "New terminal" : "New terminal…"}
          >
            <Plus size={14} strokeWidth={2.2} />
            {otherProfiles.length > 0 && <ChevronDown size={10} strokeWidth={2} />}
          </button>

          {showPicker && (
            <TerminalPicker
              currentLabel={serverLabel}
              otherProfiles={otherProfiles}
              onPickCurrent={() => { setShowPicker(false); void openNewTab(); }}
              onPickProfile={handlePickProfile}
              onClose={() => { setShowPicker(false); }}
            />
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:text-gray-300"
          title="Close terminal panel"
        >
          <X size={12} strokeWidth={2.2} />
        </button>
      </div>

      {/* Terminal views */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: "absolute",
              inset: 0,
              display: tab.id === activeTabId ? "block" : "none",
            }}
          >
            {tab.status === "opening" && (
              <div className="absolute inset-0 flex items-center justify-center text-[13px] text-gray-500">
                Connecting…
              </div>
            )}
            {tab.status === "error" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-[13px] text-red-400">Terminal error</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-500">{tab.error}</p>
                </div>
              </div>
            )}
            {(tab.status === "open" || tab.status === "closed" || tab.status === "dropped") && (
              <XTermView
                terminalId={tab.id}
                active={tab.id === activeTabId}
                onCommandLogged={onCommandLogged}
              />
            )}
            {tab.status === "dropped" && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: "rgba(20,18,15,0.75)", backdropFilter: "blur(2px)" }}
              >
                <div className="rounded-[10px] border border-border-raised bg-surface-pane px-5 py-4 text-center shadow-lg">
                  <div className="text-[13px] font-semibold text-text-primary">
                    Session dropped
                  </div>
                  <div className="mt-1 text-[11.5px] text-text-secondary">
                    The SSH connection to {tab.label} was lost.
                  </div>
                  <button
                    onClick={() => { void reconnectTab(tab.id); }}
                    className="mt-3 rounded-input px-4 py-1.5 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{
                      background: "linear-gradient(150deg, #3f7be0, #2f6bdb)",
                      boxShadow: "0 4px 12px -4px rgba(47,107,219,0.5)",
                    }}
                  >
                    Reconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {passwordPromptFor && (
        <TerminalPasswordPrompt
          profile={passwordPromptFor}
          onSubmit={(password) => {
            const p = passwordPromptFor;
            setPasswordPromptFor(null);
            void openNewTab(p, password);
          }}
          onCancel={() => { setPasswordPromptFor(null); }}
        />
      )}
    </div>
  );
}

// ── Terminal picker popover ───────────────────────────────────────────────────

function TerminalPicker({
  currentLabel,
  otherProfiles,
  onPickCurrent,
  onPickProfile,
  onClose,
}: {
  currentLabel: string;
  otherProfiles: ConnectionProfile[];
  onPickCurrent: () => void;
  onPickProfile: (p: ConnectionProfile) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-[10px] border border-border-raised"
      style={{ background: "#1e2127", boxShadow: "0 12px 32px -6px rgba(0,0,0,0.5)" }}
    >
      <div className="px-3 pb-1 pt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[1px] text-gray-500">
        New terminal
      </div>

      {/* Current server */}
      <button
        onClick={onPickCurrent}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(63,123,224,0.15)]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        <span className="flex-1 truncate font-mono text-[11.5px] text-[#e0ddd8]">
          {currentLabel}
        </span>
        <span className="font-mono text-[9.5px] text-gray-500">current</span>
      </button>

      {otherProfiles.length > 0 && (
        <>
          <div className="border-t border-[#2a2b2e] px-3 pb-1 pt-2 font-mono text-[9.5px] font-semibold uppercase tracking-[1px] text-gray-500">
            Other saved servers
          </div>
          {otherProfiles.map((p) => (
            <button
              key={p.id}
              onClick={() => { onPickProfile(p); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[rgba(63,123,224,0.15)]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#8a8578]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-[#e0ddd8]">{p.name}</div>
                <div className="truncate font-mono text-[10px] text-gray-500">
                  {p.username}@{p.host}
                </div>
              </div>
              {p.authType === "password" && (
                <span className="text-[#e0a53c]" title="Password required">
                  <Key size={12} strokeWidth={2} />
                </span>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── Password prompt ───────────────────────────────────────────────────────────

function TerminalPasswordPrompt({
  profile,
  onSubmit,
  onCancel,
}: {
  profile: ConnectionProfile;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="w-[340px] overflow-hidden rounded-[12px] border border-border-raised"
        style={{ background: "#1e2127" }}
      >
        <div className="border-b border-[#2a2b2e] px-4 py-3">
          <div className="text-[13px] font-semibold text-[#e0ddd8]">Password required</div>
          <div className="mt-0.5 font-mono text-[11px] text-gray-500">
            {profile.username}@{profile.host}
          </div>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(password); }}
          className="flex flex-col gap-3 px-4 py-3"
        >
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); }}
            placeholder="Password"
            className="h-9 rounded-[7px] border border-[#2a2b2e] bg-[#111214] px-3 text-[13px] text-[#e0ddd8] outline-none focus:border-accent-dark"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-[7px] py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-[rgba(255,255,255,0.05)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-[7px] py-1.5 text-[12px] font-semibold text-white"
              style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
            >
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TerminalTabBtn({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: TerminalTab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onActivate}
      className="flex h-full cursor-pointer select-none items-center gap-2 px-3 transition-colors"
      style={{
        background: isActive ? "#1e2127" : "transparent",
        borderRight: "1px solid #2a2b2e",
        minWidth: "120px",
      }}
    >
      <span
        className="flex-1 truncate font-mono text-[11.5px]"
        style={{ color: isActive ? "#e0ddd8" : "#8a8578" }}
      >
        {tab.label}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="flex-shrink-0 text-gray-600 transition-colors hover:text-gray-300"
      >
        <X size={11} strokeWidth={2.2} />
      </button>
    </div>
  );
}

// ── xterm.js view ─────────────────────────────────────────────────────────────

function XTermView({
  terminalId,
  active,
  onCommandLogged,
}: {
  terminalId: string;
  active: boolean;
  onCommandLogged?: (cmd: PendingCommand) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // OSC parser state (persists across chunks within a single terminal lifetime).
  const oscParserRef = useRef(new OscParser());
  // Pending command being captured (between start and end OSC events).
  const pendingRef = useRef<{
    raw: string;
    cwd: string;
    executedAt: number;
    outputLines: string[];
    outputBytes: number;
    truncated: boolean;
    originalBytes: number;
  } | null>(null);
  // Keep a stable ref to the callback so the data listener closure is stable.
  const onCommandLoggedRef = useRef(onCommandLogged);
  onCommandLoggedRef.current = onCommandLogged;

  function handleOscEvent(ev: OscEvent) {
    if (ev.type === "start") {
      pendingRef.current = {
        raw: ev.cmd,
        cwd: ev.cwd,
        executedAt: ev.executedAt,
        outputLines: [],
        outputBytes: 0,
        truncated: false,
        originalBytes: 0,
      };
    } else if (pendingRef.current) {
      const p = pendingRef.current;
      pendingRef.current = null;
      if (!p.raw.trim()) return;

      const output = p.outputLines.join("\n") || null;
      onCommandLoggedRef.current?.({
        executedAt: p.executedAt,
        cwd: p.cwd,
        raw: p.raw.trim(),
        exitCode: ev.exitCode,
        durationMs: ev.durationMs,
        output,
        outputTruncated: p.truncated,
        originalOutputBytes: p.originalBytes,
        source: "terminal",
      });
    }
  }

  function captureOutputBytes(bytes: Uint8Array) {
    const p = pendingRef.current;
    if (!p || p.truncated) return;
    const limits = getOutputLimits();

    const text = stripAnsi(new TextDecoder().decode(bytes));
    p.originalBytes += bytes.length;

    for (const line of text.split("\n")) {
      if (p.outputBytes + line.length > limits.maxBytes || p.outputLines.length >= limits.maxLines) {
        p.truncated = true;
        break;
      }
      p.outputLines.push(line);
      p.outputBytes += line.length + 1;
    }
  }

  // Initialise xterm once.
  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      // Colours based on One Dark — a widely-used, well-tested palette.
      // IMPORTANT: `black` MUST NOT equal `background` or any character the
      // shell writes in ANSI black will be invisible.
      theme: {
        background: "#1e2127",
        foreground: "#dcdfe4",
        cursor: "#61afef",
        cursorAccent: "#1e2127",
        selectionBackground: "#3e4451",
        black: "#3f4451",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#dcdfe4",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
      convertEol: true, // treat \n as \r\n for shells that only send LF
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Subscribe to server output FIRST so we don't lose any initial bytes.
    let unlisten: (() => void) | undefined;
    listen<{ id: string; data: string }>("terminal-data", (event) => {
      if (event.payload.id !== terminalId) return;
      const binary = atob(event.payload.data);
      const raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        raw[i] = binary.charCodeAt(i);
      }
      // Process segments in order: bytes then event.
      // This ensures output bytes are captured BEFORE the end event clears
      // pendingRef — even when output and end arrive in the same PTY chunk.
      for (const { bytes, event: ev } of oscParserRef.current.feed(raw)) {
        if (bytes.length > 0) {
          if (pendingRef.current) captureOutputBytes(bytes);
          term.write(bytes);
        }
        if (ev) handleOscEvent(ev);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    // Send user keystrokes to Rust.
    term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      void writeTerminal(terminalId, bytes);
    });

    if (containerRef.current) {
      term.open(containerRef.current);
      term.focus();
      // Retry the fit a few times over the first ~500ms in case the container
      // is still settling into its final layout size (e.g. flex parents doing
      // one more pass after fonts load). Skip pushing bogus tiny sizes.
      const attempts = [0, 50, 150, 350, 700];
      const timers: number[] = [];
      for (const delay of attempts) {
        const id = window.setTimeout(() => {
          try {
            fitAddon.fit();
            if (term.cols >= 20 && term.rows >= 3) {
              void resizeTerminal(terminalId, term.cols, term.rows);
            }
          } catch { /* ignore fit errors */ }
        }, delay);
        timers.push(id);
      }
      // Store timers on the fit addon so cleanup can clear them.
      (fitAddon as unknown as { _initialTimers?: number[] })._initialTimers = timers;
    }

    return () => {
      unlisten?.();
      const timers = (fitAddon as unknown as { _initialTimers?: number[] })._initialTimers;
      if (timers) for (const t of timers) clearTimeout(t);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize when panel becomes active or the container resizes.
  const fit = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current) return;
    try {
      fitAddonRef.current.fit();
      const { cols, rows } = termRef.current;
      if (cols >= 20 && rows >= 3) {
        void resizeTerminal(terminalId, cols, rows);
      }
    } catch {
      // ignore fit errors during rapid resize
    }
  }, [terminalId]);

  useEffect(() => {
    if (active) {
      const t = setTimeout(fit, 50);
      return () => {
        clearTimeout(t);
      };
    }
  }, [active, fit]);

  useEffect(() => {
    const obs = new ResizeObserver(fit);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => {
      obs.disconnect();
    };
  }, [fit]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        background: "#1e2127",
        padding: "4px 6px",
        boxSizing: "border-box",
      }}
    />
  );
}
