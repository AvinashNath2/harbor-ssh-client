import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./App.css";
import { reconnect as reconnectApi, stopAllPortForwards, type ConnectArgs, type ConnectResult, type ConnectionProfile, type FileEntry } from "./api";
import { PortForwardPanel } from "./components/PortForwardPanel";
import { PreviewModal } from "./components/PreviewModal";
import { SessionLogPage } from "./components/SessionLogPage";
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
import { usePortForwards } from "./hooks/usePortForwards";
import { useProfiles } from "./hooks/useProfiles";
import { useResizable } from "./hooks/useResizable";
import { useTabs } from "./hooks/useTabs";
import { useTransferQueue } from "./hooks/useTransferQueue";

export default function App() {
  const { state, connect, disconnect } = useConnection();
  const { profiles, save, remove } = useProfiles();
  const [showModal, setShowModal] = useState(false);
  const [showSessionLog, setShowSessionLog] = useState(false);
  const [prefillProfile, setPrefillProfile] = useState<ConnectionProfile | null>(null);
  const [prefillFolder, setPrefillFolder] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    try { return localStorage.getItem("harbor.sidebarHidden") === "1"; } catch { return false; }
  });
  const [pwPromptFor, setPwPromptFor] = useState<ConnectionProfile | null>(null);
  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(null);

  // Kill the WebKit default context menu ("Inspect Element", "Reload", etc).
  useEffect(() => {
    function block(e: MouseEvent) { e.preventDefault(); }
    document.addEventListener("contextmenu", block);
    return () => { document.removeEventListener("contextmenu", block); };
  }, []);

  const [reconnectStatus, setReconnectStatus] = useState<
    | { kind: "idle" }
    | { kind: "reconnecting"; attempt: number; max: number; host: string }
    | { kind: "failed"; host: string; reason?: string }
  >({ kind: "idle" });
  const reconnectRunRef = useRef<Promise<boolean> | null>(null);

  function toggleSidebar(next: boolean) {
    setSidebarHidden(next);
    try { localStorage.setItem("harbor.sidebarHidden", next ? "1" : "0"); } catch { /* ignore */ }
  }

  const isConnected = state.status === "connected";
  const isConnecting = state.status === "connecting";
  const activeHost = isConnected ? state.result.host : null;

  const existingFolders = Array.from(
    new Set(profiles.map((p) => p.folder).filter(Boolean)),
  ) as string[];

  async function handleConnect(args: ConnectArgs, profile: ConnectionProfile | null) {
    if (profile) await save({ ...profile, lastConnected: Date.now() });
    setActiveProfile(profile);
    void connect(args);
  }

  /**
   * Click-to-connect for saved sidebar profiles:
   * - key-auth: connect immediately with saved keyPath
   * - password-auth: show the compact password prompt
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
        },
      };
      void handleConnect(args, profile);
    } else {
      setPwPromptFor(profile);
    }
  }

  function submitPasswordPrompt(password: string) {
    const p = pwPromptFor;
    if (!p) return;
    const args: ConnectArgs = {
      host: p.host,
      port: p.port,
      username: p.username,
      authMethod: { type: "password", password },
    };
    void handleConnect(args, p);
    // We keep the prompt open — it will be closed by the useEffect below when
    // connection succeeds; on error the modal shows the error and stays open.
  }

  // Auto-close the password prompt once connection succeeds.
  useEffect(() => {
    if (pwPromptFor && state.status === "connected") setPwPromptFor(null);
  }, [pwPromptFor, state.status]);

  async function handleStarProfile(profile: ConnectionProfile) {
    await save({ ...profile, favorite: !profile.favorite });
  }

  async function handleImportProfiles(imported: ConnectionProfile[]) {
    for (const p of imported) await save(p);
    setShowImport(false);
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
  useConnectionWatchdog(isConnected, () => { void handleConnectionLost(); });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {showSessionLog && (
        <SessionLogPage onClose={() => { setShowSessionLog(false); }} />
      )}
      {showImport && (
        <SshConfigImportModal
          existingProfiles={profiles}
          onImport={(imp) => { void handleImportProfiles(imp); }}
          onClose={() => { setShowImport(false); }}
        />
      )}
      {pwPromptFor && (
        <PasswordPrompt
          profile={pwPromptFor}
          isLoading={isConnecting}
          error={state.status === "error" ? state.error.message : null}
          onSubmit={submitPasswordPrompt}
          onCancel={() => { setPwPromptFor(null); }}
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
          onDismiss={() => { setReconnectStatus({ kind: "idle" }); }}
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
          onConnect={(args) => {
            void connect(args);
          }}
          onSaveProfile={save}
          onDeleteProfile={remove}
          onSelectProfile={directConnectProfile}
          onEditProfile={openModal}
          onStarProfile={(p) => {
            void handleStarProfile(p);
          }}
          onImportSshConfig={() => { setShowImport(true); }}
          sidebarHidden={sidebarHidden}
          onToggleSidebar={toggleSidebar}
          onShowLog={() => { setShowSessionLog(true); }}
        />
      ) : (
        <DisconnectedApp
          profiles={profiles}
          activeHost={null}
          existingFolders={existingFolders}
          showModal={showModal || state.status !== "idle"}
          prefillProfile={prefillProfile}
          prefillFolder={prefillFolder}
          isLoading={isConnecting}
          error={state.status === "error" ? state.error.message : null}
          onConnect={(args, profile) => {
            void handleConnect(args, profile);
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
          onImportSshConfig={() => { setShowImport(true); }}
          sidebarHidden={sidebarHidden}
          onToggleSidebar={toggleSidebar}
          onShowLog={() => { setShowSessionLog(true); }}
        />
      )}
    </div>
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
  onConnect: (args: ConnectArgs, profile: ConnectionProfile | null) => void;
  onSaveProfile: (p: ConnectionProfile) => Promise<void>;
  onCloseModal: () => void;
  onOpenModal: () => void;
  onDeleteProfile: (id: string) => void;
  onSelectProfile: (profile: ConnectionProfile) => void;
  onEditProfile: (profile: ConnectionProfile) => void;
  onStarProfile: (profile: ConnectionProfile) => void;
  onNewSessionInFolder: (folder: string) => void;
  onImportSshConfig: () => void;
  sidebarHidden: boolean;
  onToggleSidebar: (next: boolean) => void;
  onShowLog: () => void;
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
  sidebarHidden,
  onToggleSidebar,
  onShowLog,
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
      />
      <div className="flex min-h-0 flex-1">
        {sidebarHidden ? (
          <SidebarPeek onShow={() => { onToggleSidebar(false); }} />
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
            onHide={() => { onToggleSidebar(true); }}
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
            <p className="text-[14px] font-semibold text-text-primary">Harbor</p>
            <p className="mt-1 text-[12.5px] text-text-secondary">
              Select a saved session or create a new one
            </p>
            <button
              onClick={onOpenModal}
              className="mt-4 rounded-input px-4 py-2 text-[13px] font-semibold text-white"
              style={{ background: "linear-gradient(150deg, #3f7be0, #2f6bdb)" }}
            >
              ＋ New Session
            </button>
            <button
              onClick={onShowLog}
              className="mt-2 rounded-input border border-border-input px-4 py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:bg-surface-chip hover:text-text-primary"
            >
              Session Log
            </button>
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
  onConnect: (args: ConnectArgs) => void;
  onSaveProfile: (p: ConnectionProfile) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onSelectProfile: (p: ConnectionProfile) => void;
  onEditProfile: (p: ConnectionProfile) => void;
  onStarProfile: (p: ConnectionProfile) => void;
  onImportSshConfig: () => void;
  sidebarHidden: boolean;
  onToggleSidebar: (next: boolean) => void;
  onShowLog: () => void;
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
  onEditProfile,
  onStarProfile,
  onImportSshConfig,
  sidebarHidden,
  onToggleSidebar,
  onShowLog,
}: ConnectedAppProps) {
  const { tabs, activeId, activeTab, activateTab, navigateTo, goBack, goForward, closeTab, reload } =
    useTabs(result.homeDir, onConnectionLost);

  // Phase 4 — Local filesystem
  const localFiles = useLocalFiles();
  const [dualPane, setDualPane] = useState(false);

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

  // Resizable panels (persisted per user in localStorage)
  const [sidebarWidth, startSidebarResize] = useResizable(250, "x", {
    min: 200, max: 400, persistKey: "harbor.sidebarWidth",
  });
  const [terminalHeight, startTerminalResize] = useResizable(340, "y", {
    min: 160, max: 700, invert: true, persistKey: "harbor.terminalHeight",
  });
  const [detailPanelWidth, startDetailResize] = useResizable(272, "x", {
    min: 240, max: 500, invert: true, persistKey: "harbor.detailPanelWidth",
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
    return () => { window.removeEventListener("keydown", handler); };
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

  // File selection — cleared whenever the active tab changes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const fileOps = useFileOps(activeTab.path, reload, queue, logFileOp);

  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionPrefill, setNewSessionPrefill] = useState<ConnectionProfile | null>(null);
  const [newSessionFolder, setNewSessionFolder] = useState<string | null>(null);

  async function handleNewConnect(args: ConnectArgs, profile: ConnectionProfile | null) {
    // Use the onSaveProfile prop from the outer App component so the *single*
    // useProfiles() instance is updated. Previously this component called
    // useProfiles() on its own, which produced a divergent profiles state:
    // the outer Sidebar would silently show stale data after inline edits.
    if (profile) await onSaveProfile({ ...profile, lastConnected: Date.now() });
    onConnect(args);
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
          onClose={() => { setPreviewEntry(null); }}
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
      />

      <Toolbar
        result={result}
        selected={selected}
        busy={fileOps.busy}
        dualPane={dualPane}
        showTerminal={showTerminal}
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
        onDisconnect={() => { void stopAllPortForwards(); onDisconnect(); }}
        onToggleDualPane={() => {
          setDualPane((v) => !v);
        }}
        onToggleTunnels={() => { setShowTunnels((v) => !v); }}
        onToggleTerminal={() => {
          setShowTerminal((v) => {
            if (!v) setTerminalEverShown(true);
            return !v;
          });
        }}
        showTunnels={showTunnels}
        onShowLog={onShowLog}
      />

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {sidebarHidden ? (
          <SidebarPeek onShow={() => { onToggleSidebar(false); }} />
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
                onEditProfile(p);
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
              onHide={() => { onToggleSidebar(true); }}
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
                onOpenDetail={(path) => { setDetailPanelPath(path); }}
                onEditPermissions={(path) => {
                  setDetailPanelPath(path);
                  setEditPermsForPath(path);
                }}
                onShowPreview={(entry) => { setPreviewEntry(entry); }}
                homeDir={result.homeDir}
              />
              {detailPanelPath !== null && (() => {
                const entry = activeTab.entries.find((e) => e.path === detailPanelPath);
                return entry ? (
                  <>
                    <ResizeHandle axis="x" onMouseDown={startDetailResize} title="Resize detail panel" />
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
                onAdd={(lp, rh, rp) => { void portForwards.addTunnel(lp, rh, rp); }}
                onRemove={(id) => { void portForwards.removeTunnel(id); }}
                onClearError={portForwards.clearTunnelError}
              />
            </div>
          )}

          {/* Bottom panels — visible when terminal is shown or there are transfers */}
          {(showTerminal || queue.transfers.length > 0) && (
            <ResizeHandle axis="y" onMouseDown={startTerminalResize} title="Resize terminal" />
          )}
          {(showTerminal || queue.transfers.length > 0) && (
            <div className="flex flex-none" style={{ height: terminalHeight, background: "#1e2127" }}>
              {/* Transfer panel */}
              {queue.transfers.length > 0 && (
                <div className="w-64 flex-shrink-0 border-r border-border-raised">
                  <TransferPanel
                    transfers={queue.transfers}
                    onCancel={queue.cancel}
                    onClearCompleted={queue.clearCompleted}
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
                    onClose={() => { setShowTerminal(false); }}
                    onCommandLogged={logCommand}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

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

      {/* Modal for opening a new session while already connected */}
      {showNewSession && (
        <NewSessionModal
          key={newSessionPrefill?.id ?? newSessionFolder ?? prefillProfile?.id ?? "new-connected"}
          initialProfile={newSessionPrefill ?? prefillProfile}
          initialFolder={newSessionFolder ?? undefined}
          currentlyConnectedHost={`${result.username}@${result.host}`}
          onConnect={(args, profile) => {
            void handleNewConnect(args, profile);
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
          onNavigate={(path) => { navigateTo(activeId, path); }}
          onSelectProfile={(p) => { onSelectProfile(p); }}
          onClose={() => { setShowCommandPalette(false); }}
        />
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
