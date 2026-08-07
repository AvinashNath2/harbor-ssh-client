import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import {
  exportProfilesJson,
  importProfilesJson,
  reconnect as reconnectApi,
  revealInFinder,
  stopAllPortForwards,
  type ConnectArgs,
  type ConnectResult,
  type ConnectionProfile,
  type FileEntry,
} from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { DockerExplorerPage } from "./components/DockerExplorerPage";
import { DockerPreflight } from "./components/DockerPreflight";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageContextProvider } from "./context/PageContext";
import { askChat } from "./lib/terminalBus";
import { DownloadHistoryPanel } from "./components/DownloadHistoryPanel";
import { PortForwardPanel } from "./components/PortForwardPanel";
import { PreviewModal } from "./components/PreviewModal";
import { openToolWindow } from "./utils/toolWindow";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { FileDetailPanel } from "./components/FileDetailPanel";
import { FileBrowser } from "./components/FileBrowser";
import { LocalBrowser } from "./components/LocalBrowser";
import { NewSessionModal } from "./components/NewSessionModal";
import { PasswordPrompt } from "./components/PasswordPrompt";
import { ReconnectingBanner } from "./components/ReconnectingBanner";
import { ResizeHandle } from "./components/ResizeHandle";
import { Sidebar } from "./components/Sidebar";
import { SshConfigImportModal } from "./components/SshConfigImportModal";
import { StatusBar } from "./components/StatusBar";
import { TerminalPanel } from "./components/TerminalPanel";
import { TextPromptDialog } from "./components/TextPromptDialog";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { TransferPanel } from "./components/TransferPanel";
import { useSessionLog, type PendingCommand } from "./hooks/useSessionLog";
import { useConnection } from "./hooks/useConnection";
import { useConnectionWatchdog } from "./hooks/useConnectionWatchdog";
import { useFileOps } from "./hooks/useFileOps";
import { useLocalFiles } from "./hooks/useLocalFiles";
import { useNotifications } from "./hooks/useNotifications";
import { useDownloadHistory } from "./hooks/useDownloadHistory";
import { usePortForwards } from "./hooks/usePortForwards";
import { useProfiles } from "./hooks/useProfiles";
import { useResizable } from "./hooks/useResizable";
import { useTabs } from "./hooks/useTabs";
import { makeRemoteCacheScope } from "./cache/dirCache";
import {
  mergeCredentialsIntoProfile,
  keyPassphraseForProfile,
  passwordForProfile,
  type ConnectCredentialOptions,
} from "./utils/profileCredentials";
import { useTransferQueue } from "./hooks/useTransferQueue";
import { FEATURES } from "./lib/features";

export default function App() {
  const { state, connect, disconnect } = useConnection();
  const { profiles, save, remove } = useProfiles();
  const [showModal, setShowModal] = useState(false);
  const [prefillProfile, setPrefillProfile] = useState<ConnectionProfile | null>(null);
  const [prefillFolder, setPrefillFolder] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem("harbor.sidebarHidden") === "1";
    } catch {
      return false;
    }
  });
  const [pwPromptFor, setPwPromptFor] = useState<ConnectionProfile | null>(null);
  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(null);
  // Tracks a direct-click profile connect (key-auth) so we can show a
  // connecting overlay instead of the full new-session modal.
  const [connectingProfile, setConnectingProfile] = useState<ConnectionProfile | null>(null);
  const pendingCredSaveRef = useRef<{
    profile: ConnectionProfile;
    creds: ConnectCredentialOptions;
  } | null>(null);

  // Kill the WebKit default context menu ("Inspect Element", "Reload", etc).
  // Allow xterm's own context-menu / selection behaviour inside terminals.
  useEffect(() => {
    function block(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".xterm")) return;
      e.preventDefault();
    }
    document.addEventListener("contextmenu", block);
    return () => {
      document.removeEventListener("contextmenu", block);
    };
  }, []);

  const [reconnectStatus, setReconnectStatus] = useState<
    | { kind: "idle" }
    | { kind: "reconnecting"; attempt: number; max: number; host: string }
    | { kind: "failed"; host: string; reason?: string }
  >({ kind: "idle" });
  const reconnectRunRef = useRef<Promise<boolean> | null>(null);

  function toggleSidebar(next: boolean) {
    setSidebarHidden(next);
    try {
      localStorage.setItem("harbor.sidebarHidden", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const isConnected = state.status === "connected";
  const isConnecting = state.status === "connecting";
  const activeHost = isConnected ? state.result.host : null;

  const existingFolders = Array.from(
    new Set(profiles.map((p) => p.folder).filter(Boolean)),
  ) as string[];

  async function handleConnect(
    args: ConnectArgs,
    profile: ConnectionProfile | null,
    creds?: ConnectCredentialOptions,
  ) {
    if (profile) {
      pendingCredSaveRef.current = creds ? { profile, creds } : null;
      await save({ ...profile, lastConnected: Date.now() });
    } else {
      pendingCredSaveRef.current = null;
    }
    setActiveProfile(profile);
    void connect(args);
  }

  // Persist password/passphrase to the saved profile after a successful connect.
  useEffect(() => {
    if (state.status !== "connected" || !pendingCredSaveRef.current) return;
    const { profile, creds } = pendingCredSaveRef.current;
    pendingCredSaveRef.current = null;
    void save(mergeCredentialsIntoProfile({ ...profile, lastConnected: Date.now() }, creds));
  }, [state.status, save]);

  /**
   * Click-to-connect for saved sidebar profiles:
   * - key-auth: connect immediately (uses saved passphrase if any)
   * - password-auth with saved password: connect immediately
   * - password-auth without saved password: show password prompt
   */
  function directConnectProfile(profile: ConnectionProfile) {
    if (profile.authType === "publicKey") {
      const args: ConnectArgs = {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authMethod: {
          type: "publicKey",
          key_path: profile.keyPath ?? "~/.ssh/id_rsa",
          passphrase: keyPassphraseForProfile(profile),
        },
      };
      setConnectingProfile(profile);
      void handleConnect(args, profile, {
        keyPassphrase: keyPassphraseForProfile(profile),
        saveKeyPassphrase: true,
      });
      return;
    }

    const savedPw = passwordForProfile(profile);
    if (savedPw) {
      const args: ConnectArgs = {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authMethod: { type: "password", password: savedPw },
      };
      setConnectingProfile(profile);
      void handleConnect(args, profile);
      return;
    }

    setPwPromptFor(profile);
  }

  function submitPasswordPrompt(password: string, savePassword: boolean) {
    const p = pwPromptFor;
    if (!p) return;
    const args: ConnectArgs = {
      host: p.host,
      port: p.port,
      username: p.username,
      authMethod: { type: "password", password },
    };
    void handleConnect(args, p, { password, savePassword });
  }

  // Auto-close the password prompt once connection succeeds.
  useEffect(() => {
    if (pwPromptFor && state.status === "connected") setPwPromptFor(null);
  }, [pwPromptFor, state.status]);

  // Clear connecting overlay when connection succeeds.
  useEffect(() => {
    if (connectingProfile && state.status === "connected") setConnectingProfile(null);
  }, [connectingProfile, state.status]);

  async function handleStarProfile(profile: ConnectionProfile) {
    await save({ ...profile, favorite: !profile.favorite });
  }

  async function handleImportProfiles(imported: ConnectionProfile[]) {
    for (const p of imported) await save(p);
    setShowImport(false);
  }

  async function handleExportJson() {
    const json = JSON.stringify(profiles, null, 2);
    await exportProfilesJson(json);
  }

  async function handleImportJson() {
    const content = await importProfilesJson();
    if (!content) return;
    try {
      const imported = JSON.parse(content) as ConnectionProfile[];
      if (!Array.isArray(imported)) throw new Error("Expected a JSON array");
      for (const p of imported) {
        await save({ ...p, id: crypto.randomUUID() });
      }
    } catch (e) {
      console.error("Failed to parse imported profiles JSON:", e);
    }
  }

  async function handleRenameFolder(oldName: string, newName: string) {
    const toUpdate = profiles.filter((p) => (p.folder ?? "General") === oldName);
    for (const p of toUpdate) {
      await save({ ...p, folder: newName === "General" ? undefined : newName });
    }
  }

  async function handleMoveToFolder(profileId: string, newFolder: string) {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    await save({ ...profile, folder: newFolder === "General" ? undefined : newFolder });
  }

  function openModal(profile: ConnectionProfile | null = null) {
    setPrefillProfile(profile);
    setPrefillFolder(null);
    setShowModal(true);
  }

  function openModalForFolder(folder: string) {
    setPrefillProfile(null);
    setPrefillFolder(folder);
    setShowModal(true);
  }

  function closeModal() {
    if (!isConnecting) {
      setShowModal(false);
      setPrefillProfile(null);
      setPrefillFolder(null);
    }
  }

  /**
   * Called when a file-op catches a connection error. Tries to auto-reconnect
   * up to 3 times with backoff. Returns true if the session is healthy again
   * (caller can retry the failing op); false if we gave up and are falling
   * back to the disconnect+modal flow.
   */
  async function handleConnectionLost(): Promise<boolean> {
    if (reconnectRunRef.current) return reconnectRunRef.current;
    const runningHost = state.status === "connected" ? state.result.host : "server";
    // (session log handles per-command tracking; no-op here)
    const run = (async () => {
      const MAX = 3;
      let lastError: string | undefined;
      for (let i = 0; i < MAX; i++) {
        setReconnectStatus({
          kind: "reconnecting",
          attempt: i + 1,
          max: MAX,
          host: runningHost,
        });
        if (i > 0) {
          const delayMs = Math.min(8000, 1000 * 2 ** (i - 1));
          await new Promise((r) => setTimeout(r, delayMs));
        }
        try {
          await reconnectApi();
          setReconnectStatus({ kind: "idle" });
          return true;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      // All attempts failed — fall back to the previous behavior.
      setReconnectStatus({ kind: "failed", host: runningHost, reason: lastError });
      void disconnect();
      openModal(null);
      return false;
    })();
    reconnectRunRef.current = run;
    try {
      return await run;
    } finally {
      reconnectRunRef.current = null;
    }
  }

  // Proactively poke the SSH pipe when the user comes back to the window,
  // when the tab becomes visible again, and every 30s while idle. When the
  // ping fails, the same reconnect flow that fires from file-op errors kicks
  // in — showing the amber banner and attempting recovery — BEFORE the user
  // clicks anything.
  useConnectionWatchdog(isConnected, () => {
    void handleConnectionLost();
  });

  return (
    <PageContextProvider>
      <div className="flex h-full flex-col overflow-hidden">
        {showImport && (
          <SshConfigImportModal
            existingProfiles={profiles}
            onImport={(imp) => {
              void handleImportProfiles(imp);
            }}
            onClose={() => {
              setShowImport(false);
            }}
          />
        )}
        {connectingProfile && !isConnected && !pwPromptFor && (
          <ConnectingOverlay
            profile={connectingProfile}
            isLoading={isConnecting}
            error={state.status === "error" ? state.error.message : null}
            onCancel={() => {
              void disconnect();
              setConnectingProfile(null);
            }}
            onRetry={() => {
              directConnectProfile(connectingProfile);
            }}
          />
        )}
        {pwPromptFor && (
          <PasswordPrompt
            profile={pwPromptFor}
            isLoading={isConnecting}
            error={state.status === "error" ? state.error.message : null}
            onSubmit={submitPasswordPrompt}
            onCancel={() => {
              setPwPromptFor(null);
            }}
          />
        )}
        {reconnectStatus.kind === "reconnecting" && (
          <ReconnectingBanner
            status="reconnecting"
            host={reconnectStatus.host}
            attempt={reconnectStatus.attempt}
            maxAttempts={reconnectStatus.max}
          />
        )}
        {reconnectStatus.kind === "failed" && (
          <ReconnectingBanner
            status="failed"
            host={reconnectStatus.host}
            attempt={0}
            maxAttempts={0}
            reason={reconnectStatus.reason}
            onDismiss={() => {
              setReconnectStatus({ kind: "idle" });
            }}
          />
        )}
        {isConnected ? (
          <ConnectedApp
            result={state.result}
            profiles={profiles}
            activeProfile={activeProfile}
            activeHost={activeHost}
            existingFolders={existingFolders}
            prefillProfile={prefillProfile}
            onDisconnect={() => {
              void disconnect();
              openModal(null);
            }}
            onConnectionLost={handleConnectionLost}
            onConnect={(args, profile, creds) => {
              void handleConnect(args, profile ?? null, creds);
            }}
            onSaveProfile={save}
            onDeleteProfile={remove}
            onSelectProfile={directConnectProfile}
            onStarProfile={(p) => {
              void handleStarProfile(p);
            }}
            onImportSshConfig={() => {
              setShowImport(true);
            }}
            onExportJson={() => {
              void handleExportJson();
            }}
            onImportJson={() => {
              void handleImportJson();
            }}
            onRenameFolder={(old, next) => {
              void handleRenameFolder(old, next);
            }}
            onMoveToFolder={(id, folder) => {
              void handleMoveToFolder(id, folder);
            }}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={toggleSidebar}
          />
        ) : (
          <DisconnectedApp
            profiles={profiles}
            activeHost={null}
            existingFolders={existingFolders}
            showModal={showModal}
            prefillProfile={prefillProfile}
            prefillFolder={prefillFolder}
            isLoading={isConnecting}
            error={state.status === "error" ? state.error.message : null}
            onConnect={(args, profile, creds) => {
              void handleConnect(args, profile, creds);
            }}
            onSaveProfile={save}
            onCloseModal={closeModal}
            onOpenModal={() => {
              openModal(null);
            }}
            onDeleteProfile={(id) => {
              void remove(id);
            }}
            onSelectProfile={directConnectProfile}
            onEditProfile={openModal}
            onStarProfile={(p) => {
              void handleStarProfile(p);
            }}
            onNewSessionInFolder={openModalForFolder}
            onImportSshConfig={() => {
              setShowImport(true);
            }}
            onExportJson={() => {
              void handleExportJson();
            }}
            onImportJson={() => {
              void handleImportJson();
            }}
            onRenameFolder={(old, next) => {
              void handleRenameFolder(old, next);
            }}
            onMoveToFolder={(id, folder) => {
              void handleMoveToFolder(id, folder);
            }}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={toggleSidebar}
          />
        )}
      </div>
    </PageContextProvider>
  );
}

// ── Disconnected layout ───────────────────────────────────────────────────────

interface DisconnectedAppProps {
  profiles: ConnectionProfile[];
  activeHost: string | null;
  existingFolders: string[];
  showModal: boolean;
  prefillProfile: ConnectionProfile | null;
  prefillFolder: string | null;
  isLoading: boolean;
  error: string | null;
  onConnect: (
    args: ConnectArgs,
    profile: ConnectionProfile | null,
    creds?: ConnectCredentialOptions,
  ) => void;
  onSaveProfile: (p: ConnectionProfile) => Promise<void>;
  onCloseModal: () => void;
  onOpenModal: () => void;
  onDeleteProfile: (id: string) => void;
  onSelectProfile: (profile: ConnectionProfile) => void;
  onEditProfile: (profile: ConnectionProfile) => void;
  onStarProfile: (profile: ConnectionProfile) => void;
  onNewSessionInFolder: (folder: string) => void;
  onImportSshConfig: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onMoveToFolder: (profileId: string, newFolder: string) => void;
  sidebarHidden: boolean;
  onToggleSidebar: (next: boolean) => void;
}

function DisconnectedApp({
  profiles,
  activeHost,
  existingFolders,
  showModal,
  prefillProfile,
  prefillFolder,
  isLoading,
  error,
  onConnect,
  onSaveProfile,
  onCloseModal,
  onOpenModal,
  onDeleteProfile,
  onSelectProfile,
  onEditProfile,
  onStarProfile,
  onNewSessionInFolder,
  onImportSshConfig,
  onExportJson,
  onImportJson,
  onRenameFolder,
  onMoveToFolder,
  sidebarHidden,
  onToggleSidebar,
}: DisconnectedAppProps) {
  return (
    <div className="relative flex h-full flex-col">
      <TitleBar
        tabs={[]}
        activeId=""
        onActivate={() => undefined}
        onClose={() => undefined}
        onNewSession={onOpenModal}
        connected={false}
        notifications={[]}
        unreadCount={0}
        onMarkAllRead={() => undefined}
        onClearNotifications={() => undefined}
        downloadCount={0}
        onShowDownloads={() => undefined}
      />
      <div className="flex min-h-0 flex-1">
        {sidebarHidden ? (
          <SidebarPeek
            onShow={() => {
              onToggleSidebar(false);
            }}
          />
        ) : (
          <Sidebar
            profiles={profiles}
            activeHost={activeHost}
            onSelectProfile={onSelectProfile}
            onEditProfile={onEditProfile}
            onNewSession={onOpenModal}
            onDeleteProfile={onDeleteProfile}
            onStarProfile={onStarProfile}
            onNewSessionInFolder={onNewSessionInFolder}
            onImportSshConfig={onImportSshConfig}
            onExportJson={onExportJson}
            onImportJson={onImportJson}
            onRenameFolder={onRenameFolder}
            onMoveToFolder={onMoveToFolder}
            onHide={() => {
              onToggleSidebar(true);
            }}
          />
        )}
        <main className="flex flex-1 items-center justify-center bg-surface">
          <div className="text-center">
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[14px] text-2xl font-bold text-white"
              style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
            >
              H
            </div>
            <p className="text-[14px] font-semibold text-text-primary">HarborSCP</p>
            <p className="mt-1 text-[12.5px] text-text-secondary">
              Select a saved session or create a new one
            </p>
            <div className="mt-4 flex flex-col items-center gap-2">
              <button
                onClick={onOpenModal}
                className="w-full rounded-input px-4 py-2 text-[13px] font-semibold text-white"
                style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
              >
                ＋ New Session
              </button>
              <button
                onClick={() => {
                  void openToolWindow("sessionLog");
                }}
                className="w-full rounded-input border border-border-input px-4 py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
              >
                Session Log
              </button>
            </div>
          </div>
        </main>
      </div>

      {showModal && (
        <NewSessionModal
          key={prefillProfile?.id ?? prefillFolder ?? "new"}
          initialProfile={prefillProfile}
          initialFolder={prefillFolder ?? undefined}
          onConnect={onConnect}
          onSave={onSaveProfile}
          onClose={onCloseModal}
          isLoading={isLoading}
          error={error}
          existingFolders={existingFolders}
        />
      )}
    </div>
  );
}

// ── Connected layout ──────────────────────────────────────────────────────────

interface ConnectedAppProps {
  result: ConnectResult;
  profiles: ConnectionProfile[];
  activeProfile: ConnectionProfile | null;
  activeHost: string | null;
  existingFolders: string[];
  prefillProfile: ConnectionProfile | null;
  onDisconnect: () => void;
  onConnectionLost: () => Promise<boolean>;
  onConnect: (
    args: ConnectArgs,
    profile?: ConnectionProfile | null,
    creds?: ConnectCredentialOptions,
  ) => void;
  onSaveProfile: (p: ConnectionProfile) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onSelectProfile: (p: ConnectionProfile) => void;
  onStarProfile: (p: ConnectionProfile) => void;
  onImportSshConfig: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
  onRenameFolder: (oldName: string, newName: string) => void;
  onMoveToFolder: (profileId: string, newFolder: string) => void;
  sidebarHidden: boolean;
  onToggleSidebar: (next: boolean) => void;
}

function ConnectedApp({
  result,
  profiles,
  activeProfile,
  activeHost,
  existingFolders,
  prefillProfile,
  onDisconnect,
  onConnectionLost,
  onConnect,
  onSaveProfile,
  onDeleteProfile,
  onSelectProfile,
  onStarProfile,
  onImportSshConfig,
  onExportJson,
  onImportJson,
  onRenameFolder,
  onMoveToFolder,
  sidebarHidden,
  onToggleSidebar,
}: ConnectedAppProps) {
  const [refreshToast, setRefreshToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    tabs,
    activeId,
    activeTab,
    activateTab,
    navigateTo,
    goBack,
    goForward,
    closeTab,
    reload,
    invalidatePathCache,
  } = useTabs(result.homeDir, activeProfile?.name ?? result.host, onConnectionLost, {
    cacheScope: makeRemoteCacheScope(result.host, result.username),
    onFreshEntries: (entries) => {
      const valid = new Set(entries.map((e) => e.path));
      setSelected((prev) => {
        const next = new Set([...prev].filter((p) => valid.has(p)));
        return next.size === prev.size ? prev : next;
      });
    },
    onRefreshFailed: (message) => {
      setRefreshToast(`Could not refresh folder: ${message}`);
    },
  });

  // Phase 4 — Local filesystem
  const localFiles = useLocalFiles();
  const [dualPane, setDualPane] = useState(false);

  // Docker Explorer
  const [showDocker, setShowDocker] = useState(false);
  // Preflight modal — shown when user clicks Docker toggle, decides whether Explorer opens
  const [showDockerPreflight, setShowDockerPreflight] = useState(false);

  // AI Chat panel (global — usable from any page)
  const [showChat, setShowChat] = useState<boolean>(() => {
    try {
      return localStorage.getItem("harbor.chatOpen") === "1";
    } catch {
      return false;
    }
  });
  function toggleChat(next?: boolean) {
    setShowChat((v) => {
      const nv = next ?? !v;
      try {
        localStorage.setItem("harbor.chatOpen", nv ? "1" : "0");
      } catch {
        /* ignore */
      }
      return nv;
    });
  }

  // Facebook-Messenger-style minimize: header stays visible, body collapses.
  const [chatMinimized, setChatMinimizedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("harbor.chatMinimized") === "1";
    } catch {
      return false;
    }
  });
  function setChatMinimized(next: boolean) {
    setChatMinimizedState(next);
    try {
      localStorage.setItem("harbor.chatMinimized", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  // Resizable chat width (drag the LEFT edge — invert so drag-left = grow).
  const [chatWidth, startChatResize] = useResizable(320, "x", {
    min: 300,
    max: 640,
    invert: true,
    persistKey: "harbor.chatWidth",
  });

  // Phase 5 — Terminal
  // Auto-open on connect so the user sees the shell alongside the file browser.
  // Once mounted, keep it alive (hide with CSS) so SSH sessions survive toggle.
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalEverShown, setTerminalEverShown] = useState(true);

  // Port forwarding
  const portForwards = usePortForwards();
  const [showTunnels, setShowTunnels] = useState(false);

  // Phase 6 — Transfer queue
  const queue = useTransferQueue();

  // Download history (persisted in SQLite)
  const dlHistory = useDownloadHistory();
  const prevTransfersRef = useRef(queue.transfers);
  useEffect(() => {
    const prev = prevTransfersRef.current;
    for (const t of queue.transfers) {
      if (t.direction === "download" && t.status === "done") {
        const wasDone = prev.some((p) => p.id === t.id && p.status === "done");
        if (!wasDone) {
          void dlHistory.record(t.id, t.name, t.localPath, t.remotePath, t.total);
        }
      }
    }
    prevTransfersRef.current = queue.transfers;
  }, [queue.transfers, dlHistory]);

  // Resizable panels (persisted per user in localStorage)
  const [sidebarWidth, startSidebarResize] = useResizable(250, "x", {
    min: 200,
    max: 400,
    persistKey: "harbor.sidebarWidth",
  });
  const [terminalHeight, startTerminalResize] = useResizable(340, "y", {
    min: 160,
    max: 700,
    invert: true,
    persistKey: "harbor.terminalHeight",
  });
  const [detailPanelWidth, startDetailResize] = useResizable(272, "x", {
    min: 240,
    max: 500,
    invert: true,
    persistKey: "harbor.detailPanelWidth",
  });

  // Session log — creates a DB session on mount, closes it on unmount.
  const { logCommand } = useSessionLog(true, result, activeProfile);

  // Direct file preview (right-click → Show content)
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);

  // Phase 7/10/12 — notifications, command palette, file detail
  const notifications = useNotifications();
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // ⌘K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  // Fire a notification when a transfer finishes
  const notifiedTransferIds = useRef<Set<string>>(new Set());
  const addNotification = notifications.add;
  useEffect(() => {
    for (const t of queue.transfers) {
      if (notifiedTransferIds.current.has(t.id)) continue;
      if (t.status === "done" || t.status === "error") {
        notifiedTransferIds.current.add(t.id);
        if (t.status === "done") {
          addNotification({
            type: "transfer-done",
            title: `${t.direction === "upload" ? "Upload" : "Download"} complete`,
            body: t.name,
          });
        } else {
          addNotification({
            type: "transfer-error",
            title: `${t.direction === "upload" ? "Upload" : "Download"} failed`,
            body: t.error ?? t.name,
          });
        }
      }
    }
  }, [queue.transfers, addNotification]);

  // detailPanelPath — the path whose FileDetailPanel is open. Only set via
  // explicit right-click actions (Properties / Edit permissions); never auto-
  // opened on click.
  const [detailPanelPath, setDetailPanelPath] = useState<string | null>(null);
  const [editPermsForPath, setEditPermsForPath] = useState<string | null>(null);
  useEffect(() => {
    setSelected(new Set());
    setDetailPanelPath(null);
    setEditPermsForPath(null);
  }, [activeId]);

  // Local pane selection — separate from remote selection.
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());

  // Dialog visibility
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[]>([]);

  function logFileOp(action: string, details: string) {
    const cmd: PendingCommand = {
      executedAt: Date.now(),
      cwd: activeTab.path,
      raw: `[${action}] ${details}`,
      exitCode: action.includes("failed") ? 1 : 0,
      durationMs: null,
      output: null,
      outputTruncated: false,
      originalOutputBytes: 0,
      source: "file_browser",
    };
    logCommand(cmd);
  }

  const fileOps = useFileOps(
    activeTab.path,
    () => {
      invalidatePathCache(activeTab.path);
      reload();
    },
    queue,
    logFileOp,
  );

  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionPrefill, setNewSessionPrefill] = useState<ConnectionProfile | null>(null);
  const [newSessionFolder, setNewSessionFolder] = useState<string | null>(null);

  function handleNewConnect(
    args: ConnectArgs,
    profile: ConnectionProfile | null,
    creds?: ConnectCredentialOptions,
  ) {
    onConnect(args, profile, creds);
    setShowNewSession(false);
    setNewSessionFolder(null);
  }

  function openNewSession(p: ConnectionProfile | null = null) {
    setNewSessionPrefill(p);
    setNewSessionFolder(null);
    setShowNewSession(true);
  }

  function openNewSessionInFolder(folder: string) {
    setNewSessionPrefill(null);
    setNewSessionFolder(folder);
    setShowNewSession(true);
  }

  function requestDelete(paths: string[]) {
    if (paths.length === 0) return;
    setPendingDelete(paths);
    setShowDeleteConfirm(true);
  }

  function confirmDelete() {
    setShowDeleteConfirm(false);
    void fileOps.deletePaths(pendingDelete);
    setSelected(new Set());
    setPendingDelete([]);
  }

  // Transfer from local pane → remote
  function handleTransferToRemote(localPaths: string[]) {
    for (const lp of localPaths) {
      const name = lp.split(/[/\\]/).pop() ?? "file";
      const remotePath = activeTab.path.replace(/\/$/, "") + "/" + name;
      queue.enqueueUpload(lp, remotePath, name);
      logFileOp("upload queued", `${lp} → ${remotePath}`);
    }
  }

  // Drop from remote pane → local pane's current directory
  function handleTransferToLocal(remotePaths: string[]) {
    const localDir = localFiles.tab.path;
    if (!localDir) return;
    for (const rp of remotePaths) {
      const name = rp.split("/").pop() ?? "file";
      const localPath = localDir.replace(/\/$/, "") + "/" + name;
      queue.enqueueDownload(rp, localPath, name);
      logFileOp("download queued", `${rp} → ${localPath}`);
    }
  }

  const serverLabel = `${result.username}@${result.host}`;

  return (
    <div className="relative flex h-full flex-col">
      {previewEntry && (
        <PreviewModal
          entry={previewEntry}
          onClose={() => {
            setPreviewEntry(null);
          }}
          onCommandLogged={logCommand}
        />
      )}
      <TitleBar
        tabs={tabs}
        activeId={activeId}
        onActivate={activateTab}
        onClose={closeTab}
        onNewSession={() => {
          openNewSession(null);
        }}
        connected={true}
        notifications={notifications.notifications}
        unreadCount={notifications.unreadCount}
        onMarkAllRead={notifications.markAllRead}
        onClearNotifications={notifications.clear}
        downloadCount={dlHistory.records.length}
        onShowDownloads={() => {
          void dlHistory.openPanel();
        }}
      />

      <Toolbar
        result={result}
        selected={selected}
        busy={fileOps.busy}
        dualPane={dualPane}
        showTerminal={showTerminal}
        showTunnels={showTunnels}
        showDocker={showDocker}
        canGoBack={activeTab.historyIndex > 0}
        canGoForward={activeTab.historyIndex < activeTab.history.length - 1}
        onGoBack={() => {
          goBack(activeId);
        }}
        onGoForward={() => {
          goForward(activeId);
        }}
        onReload={reload}
        onUpload={() => {
          void fileOps.upload();
        }}
        onDownload={() => {
          void fileOps.download([...selected]);
        }}
        onCreateFolder={() => {
          setShowNewFolder(true);
        }}
        onCreateFile={() => {
          setShowNewFile(true);
        }}
        onDelete={() => {
          requestDelete([...selected]);
        }}
        onDisconnect={() => {
          void stopAllPortForwards();
          onDisconnect();
        }}
        onToggleDualPane={() => {
          setDualPane((v) => !v);
        }}
        onToggleTunnels={() => {
          setShowTunnels((v) => !v);
        }}
        onToggleTerminal={() => {
          setShowTerminal((v) => {
            if (!v) setTerminalEverShown(true);
            return !v;
          });
        }}
        onToggleDocker={() => {
          if (showDocker) {
            // Currently open → close it
            setShowDocker(false);
          } else {
            // Not open → show preflight first
            setShowDockerPreflight(true);
          }
        }}
        showChat={showChat}
        onToggleChat={() => {
          toggleChat();
        }}
      />

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {sidebarHidden ? (
          <SidebarPeek
            onShow={() => {
              onToggleSidebar(false);
            }}
          />
        ) : (
          <>
            <Sidebar
              profiles={profiles}
              activeHost={activeHost}
              activeProfileId={activeProfile?.id ?? null}
              width={sidebarWidth}
              onSelectProfile={(p) => {
                onSelectProfile(p);
              }}
              onEditProfile={(p) => {
                openNewSession(p);
              }}
              onNewSession={() => {
                openNewSession(null);
              }}
              onDeleteProfile={(id) => {
                void onDeleteProfile(id);
              }}
              onStarProfile={onStarProfile}
              onNewSessionInFolder={openNewSessionInFolder}
              onImportSshConfig={onImportSshConfig}
              onExportJson={onExportJson}
              onImportJson={onImportJson}
              onRenameFolder={onRenameFolder}
              onMoveToFolder={onMoveToFolder}
              onHide={() => {
                onToggleSidebar(true);
              }}
            />
            <ResizeHandle axis="x" onMouseDown={startSidebarResize} title="Resize sidebar" />
          </>
        )}

        {/* Panes + bottom panels column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* File panes row */}
          <div className="flex min-h-0 flex-1">
            {/* Local pane (dual pane mode) */}
            {dualPane && (
              <>
                <div className="flex min-w-0 flex-1">
                  <LocalBrowser
                    tab={localFiles.tab}
                    selected={localSelected}
                    onNavigate={localFiles.navigateTo}
                    onSelectionChange={setLocalSelected}
                    onGoBack={localFiles.goBack}
                    onGoForward={localFiles.goForward}
                    canGoBack={localFiles.canGoBack}
                    canGoForward={localFiles.canGoForward}
                    onReload={localFiles.reload}
                    onTransferToRemote={handleTransferToRemote}
                    onReceiveRemoteDrop={handleTransferToLocal}
                    homeDir={localFiles.homeDir}
                  />
                </div>

                {/* Center divider */}
                <div className="flex w-8 flex-shrink-0 items-center justify-center border-x border-border-raised bg-surface-toolbar">
                  <span className="text-[11px] text-text-faint">⇔</span>
                </div>
              </>
            )}

            {/* Remote pane + optional detail panel */}
            <div className="flex min-w-0 flex-1">
              <FileBrowser
                tab={activeTab}
                selected={selected}
                onNavigate={(path) => {
                  navigateTo(activeId, path);
                }}
                onReload={reload}
                onSelectionChange={(next) => {
                  setSelected(next);
                  if (detailPanelPath && !next.has(detailPanelPath)) {
                    setDetailPanelPath(null);
                  }
                  if (!editPermsForPath || !next.has(editPermsForPath)) {
                    setEditPermsForPath(null);
                  }
                }}
                onRename={(oldPath, newName) => fileOps.rename(oldPath, newName)}
                onDelete={(paths) => {
                  requestDelete(paths);
                }}
                onDownload={(paths) => {
                  void fileOps.download(paths);
                }}
                onReceiveLocalDrop={handleTransferToRemote}
                onOpenDetail={(path) => {
                  setDetailPanelPath(path);
                }}
                onEditPermissions={(path) => {
                  setDetailPanelPath(path);
                  setEditPermsForPath(path);
                }}
                onShowPreview={(entry) => {
                  setPreviewEntry(entry);
                }}
                homeDir={result.homeDir}
              />
              {detailPanelPath !== null &&
                (() => {
                  const entry = activeTab.entries.find((e) => e.path === detailPanelPath);
                  return entry ? (
                    <>
                      <ResizeHandle
                        axis="x"
                        onMouseDown={startDetailResize}
                        title="Resize detail panel"
                      />
                      <FileDetailPanel
                        entry={entry}
                        width={detailPanelWidth}
                        editPermissionsOnOpen={editPermsForPath === entry.path}
                        onClose={() => {
                          setDetailPanelPath(null);
                          setEditPermsForPath(null);
                        }}
                        onCommandLogged={logCommand}
                      />
                    </>
                  ) : null;
                })()}
            </div>
          </div>

          {/* Tunnels panel — sits above the terminal area, full width */}
          {showTunnels && (
            <div className="flex-none border-t border-border-raised" style={{ height: 220 }}>
              <PortForwardPanel
                tunnels={portForwards.tunnels}
                tunnelError={portForwards.tunnelError}
                onAdd={(lp, rh, rp) => {
                  void portForwards.addTunnel(lp, rh, rp);
                }}
                onRemove={(id) => {
                  void portForwards.removeTunnel(id);
                }}
                onClearError={portForwards.clearTunnelError}
              />
            </div>
          )}

          {/* Bottom panels — visible when terminal is shown or there are transfers */}
          {(showTerminal || queue.transfers.length > 0) && (
            <ResizeHandle axis="y" onMouseDown={startTerminalResize} title="Resize terminal" />
          )}
          {(showTerminal || queue.transfers.length > 0) && (
            <div
              className="flex flex-none"
              style={{ height: terminalHeight, background: "#1e2127" }}
            >
              {/* Transfer panel */}
              {queue.transfers.length > 0 && (
                <div className="w-64 flex-shrink-0 border-r border-border-raised">
                  <TransferPanel
                    transfers={queue.transfers}
                    onCancel={queue.cancel}
                    onClearCompleted={queue.clearCompleted}
                    onReveal={(path) => {
                      void revealInFinder(path);
                    }}
                  />
                </div>
              )}

              {/* Terminal — mount once and keep alive; hide/show with CSS so sessions persist */}
              {terminalEverShown && (
                <div
                  className="flex min-w-0 flex-1 flex-col"
                  style={{ display: showTerminal ? "flex" : "none" }}
                >
                  <TerminalPanel
                    serverLabel={serverLabel}
                    profiles={profiles}
                    currentHost={result.host}
                    onClose={() => {
                      setShowTerminal(false);
                    }}
                    onCommandLogged={logCommand}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Global AI Chat sidebar — gated on FEATURES.AI */}
      {FEATURES.AI && showChat && (
        <div
          className="fixed z-[60] flex shadow-modal"
          style={{
            right: 0,
            bottom: 0,
            top: chatMinimized ? "auto" : 0,
            width: chatWidth,
            height: chatMinimized ? 44 : undefined,
            pointerEvents: "auto",
          }}
        >
          {!chatMinimized && (
            <ResizeHandle axis="x" onMouseDown={startChatResize} title="Drag to resize chat" />
          )}
          <div className="flex min-w-0 flex-1">
            <ChatPanel
              host={`${result.username}@${result.host}`}
              minimized={chatMinimized}
              onToggleMinimize={() => {
                setChatMinimized(!chatMinimized);
              }}
              onClose={() => {
                toggleChat(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Status bar */}
      <StatusBar
        host={result.host}
        ipAddr={result.ipAddr}
        osInfo={result.osInfo}
        activeTransfers={queue.transfers.filter((t) => t.status === "active").length}
      />

      {/* New folder dialog */}
      {showNewFolder && (
        <TextPromptDialog
          title="New Folder"
          placeholder="folder-name"
          confirmLabel="Create"
          onConfirm={(name) => {
            setShowNewFolder(false);
            void fileOps.createFolder(name);
          }}
          onCancel={() => {
            setShowNewFolder(false);
          }}
        />
      )}

      {/* New file dialog */}
      {showNewFile && (
        <TextPromptDialog
          title="New File"
          placeholder="file-name.txt"
          confirmLabel="Create"
          onConfirm={(name) => {
            setShowNewFile(false);
            void fileOps.createFile(name);
          }}
          onCancel={() => {
            setShowNewFile(false);
          }}
        />
      )}

      {/* Download history panel */}
      {dlHistory.open && (
        <DownloadHistoryPanel
          records={dlHistory.records}
          onClose={() => {
            dlHistory.setOpen(false);
          }}
          onReveal={(path) => {
            void revealInFinder(path);
          }}
          onRemove={(id) => {
            void dlHistory.remove(id);
          }}
          onClearAll={() => {
            void dlHistory.clearAll();
          }}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.length.toString()} item${pendingDelete.length !== 1 ? "s" : ""}?`}
          message="This cannot be undone. Directories will be deleted recursively."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setPendingDelete([]);
          }}
        />
      )}

      {/* Operation error toast */}
      {fileOps.opError != null && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[10px] border border-danger/30 bg-white px-4 py-2.5 shadow-lg">
          <p className="text-[12.5px] text-danger">{fileOps.opError}</p>
          <button
            onClick={fileOps.clearError}
            className="mt-1 text-[11px] text-text-tertiary hover:text-text-primary"
          >
            Dismiss
          </button>
        </div>
      )}

      {refreshToast != null && (
        <div className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-[10px] border border-amber-500/30 bg-white px-4 py-2.5 shadow-lg">
          <p className="text-[12.5px] text-amber-800">{refreshToast}</p>
          <button
            onClick={() => {
              setRefreshToast(null);
            }}
            className="mt-1 text-[11px] text-text-tertiary hover:text-text-primary"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Modal for opening a new session while already connected */}
      {showNewSession && (
        <NewSessionModal
          key={newSessionPrefill?.id ?? newSessionFolder ?? prefillProfile?.id ?? "new-connected"}
          initialProfile={newSessionPrefill ?? prefillProfile}
          initialFolder={newSessionFolder ?? undefined}
          currentlyConnectedHost={`${result.username}@${result.host}`}
          onConnect={(args, profile, creds) => {
            handleNewConnect(args, profile, creds);
          }}
          onSave={onSaveProfile}
          onClose={() => {
            setShowNewSession(false);
            setNewSessionPrefill(null);
            setNewSessionFolder(null);
          }}
          isLoading={false}
          error={null}
          existingFolders={existingFolders}
        />
      )}

      {/* ⌘K Command Palette */}
      {showCommandPalette && (
        <CommandPalette
          entries={activeTab.entries}
          profiles={profiles}
          onNavigate={(path) => {
            navigateTo(activeId, path);
          }}
          onSelectProfile={(p) => {
            onSelectProfile(p);
          }}
          onClose={() => {
            setShowCommandPalette(false);
          }}
        />
      )}

      {showDockerPreflight && (
        <DockerPreflight
          onProceed={() => {
            setShowDockerPreflight(false);
            setShowDocker(true);
          }}
          onCancel={() => {
            setShowDockerPreflight(false);
          }}
        />
      )}

      {showDocker && (
        <ErrorBoundary>
          <DockerExplorerPage
            host={`${result.username}@${result.host}`}
            onClose={() => {
              setShowDocker(false);
            }}
            onNodeAutoMessage={
              FEATURES.AI
                ? (msg) => {
                    if (showChat) {
                      askChat(msg, "auto");
                    }
                  }
                : undefined
            }
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

// ── Peek button shown on the left edge when the sidebar is hidden ──────────────

function SidebarPeek({ onShow }: { onShow: () => void }) {
  return (
    <div className="flex w-8 flex-none flex-col items-center border-r border-border bg-surface-sidebar">
      <button
        onClick={onShow}
        title="Show sidebar"
        className="mt-3 flex h-8 w-8 items-center justify-center text-text-faint transition-colors hover:bg-surface-sidebarHover hover:text-accent-dark"
      >
        <ChevronRight size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}

// ── Connecting overlay (shown when directly clicking a key-auth saved profile) ─

interface ConnectingOverlayProps {
  profile: ConnectionProfile;
  isLoading: boolean;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
}

function ConnectingOverlay({
  profile,
  isLoading,
  error,
  onCancel,
  onRetry,
}: ConnectingOverlayProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" />

      {/* Card */}
      <div
        className="relative w-[340px] overflow-hidden rounded-2xl border border-border bg-surface-pane shadow-2xl"
        style={{ boxShadow: "0 24px 64px -12px rgba(0,0,0,0.30), 0 0 0 1px rgba(0,0,0,0.06)" }}
      >
        {/* Top accent bar */}
        <div
          className="h-1 w-full"
          style={{
            background: error
              ? "linear-gradient(90deg, #e5534b, #d64545)"
              : "linear-gradient(90deg, #3f7be0, #2f6bdb)",
          }}
        />

        <div className="px-6 py-5">
          {!error ? (
            <>
              {/* Spinner + title */}
              <div className="mb-4 flex flex-col items-center gap-3">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-[16px] text-white"
                  style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
                >
                  {/* Animated SSH key / server icon */}
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-[15px] font-semibold text-text-primary">Connecting…</p>
                  <p className="mt-0.5 text-[12px] text-text-tertiary">
                    {profile.name || profile.host}
                  </p>
                </div>
              </div>

              {/* Connection details */}
              <div className="mb-4 rounded-xl border border-border-subtle bg-surface px-4 py-3">
                <div className="grid grid-cols-[72px_1fr] gap-y-1.5 text-[11.5px]">
                  <span className="font-medium text-text-tertiary">Host</span>
                  <span className="truncate font-mono text-text-primary">
                    {profile.host}:{String(profile.port)}
                  </span>
                  <span className="font-medium text-text-tertiary">User</span>
                  <span className="font-mono text-text-primary">{profile.username}</span>
                  <span className="font-medium text-text-tertiary">Auth</span>
                  <span className="text-text-secondary">
                    {profile.authType === "publicKey" ? "SSH key" : "Password"}
                  </span>
                </div>
              </div>

              {/* Progress dots */}
              <div className="mb-4 flex items-center justify-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                    style={{
                      animation: `pulse 1.2s ease-in-out ${String(i * 0.2)}s infinite`,
                      opacity: 0.4,
                    }}
                  />
                ))}
              </div>

              <button
                onClick={onCancel}
                className="w-full rounded-xl border border-border py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {/* Error state */}
              <div className="mb-4 flex flex-col items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#e5534b"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-danger">Connection failed</p>
                  <p className="mt-0.5 text-[11.5px] text-text-tertiary">
                    {profile.name || profile.host}
                  </p>
                </div>
              </div>

              {/* Error message */}
              <div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2.5">
                <p className="break-words text-[11.5px] leading-relaxed text-danger">{error}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 rounded-xl border border-border py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={onRetry}
                  disabled={isLoading}
                  className="flex-1 rounded-xl py-2 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-60"
                  style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
                >
                  {isLoading ? "Retrying…" : "Retry"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
