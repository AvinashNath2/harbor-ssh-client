import { invoke } from "@tauri-apps/api/core";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface AppError {
  code:
    | "CONNECTION_FAILED"
    | "AUTH_FAILED"
    | "NOT_CONNECTED"
    | "PERMISSION_DENIED"
    | "TRANSFER_ERROR"
    | "INTERNAL";
  message: string;
}

// ── Phase 0 ───────────────────────────────────────────────────────────────────

export interface PingResponse {
  message: string;
  version: string;
}

export async function ping(): Promise<PingResponse> {
  return invoke<PingResponse>("ping");
}

// ── Phase 1 ───────────────────────────────────────────────────────────────────

export type AuthMethod =
  | { type: "password"; password: string }
  | { type: "publicKey"; key_path: string; passphrase?: string };

export interface ConnectArgs {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
}

export interface ConnectResult {
  host: string;
  port: number;
  username: string;
  whoami: string;
  homeDir: string;
  osInfo: string;
  ipAddr: string;
}

export interface ConnectionStatus {
  connected: boolean;
  host: string | null;
  username: string | null;
}

export async function connect({
  host,
  port,
  username,
  authMethod,
}: ConnectArgs): Promise<ConnectResult> {
  return invoke<ConnectResult>("connect", { host, port, username, authMethod });
}

export async function testConnection({
  host,
  port,
  username,
  authMethod,
}: ConnectArgs): Promise<void> {
  await invoke("test_connection", { host, port, username, authMethod });
}

export async function reconnect(): Promise<ConnectResult> {
  return invoke<ConnectResult>("reconnect");
}

/** Lightweight liveness probe against the current SSH session. Throws with a
 *  connection error kind if the pipe is dead. */
export async function pingConnection(): Promise<void> {
  await invoke("ping_connection");
}

export async function disconnect(): Promise<void> {
  await invoke("disconnect");
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("connection_status");
}

// ── Connection profiles ───────────────────────────────────────────────────────

export type ProfileAuthType = "password" | "publicKey";

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: ProfileAuthType;
  keyPath?: string;
  folder?: string;
  favorite?: boolean;
  lastConnected?: number;
}

export async function listProfiles(): Promise<ConnectionProfile[]> {
  return invoke<ConnectionProfile[]>("list_profiles");
}

export async function saveProfile(profile: ConnectionProfile): Promise<void> {
  await invoke("save_profile", { profile });
}

export async function deleteProfile(id: string): Promise<void> {
  await invoke("delete_profile", { id });
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

export type FileKind = "file" | "directory" | "symlink" | "other";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number | null;
  permissions: string | null;
  /** Unix timestamp in seconds */
  modified: number | null;
}

export async function listFolder(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_folder", { path });
}

// ── Phase 3 — File operations ─────────────────────────────────────────────────

export async function createFolder(path: string): Promise<void> {
  await invoke("create_folder", { path });
}

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await invoke("rename_path", { oldPath, newPath });
}

export async function deletePath(path: string): Promise<void> {
  await invoke("delete_path", { path });
}

export async function downloadFile(remotePath: string, localPath: string): Promise<number> {
  return invoke<number>("download_file", { remotePath, localPath });
}

export async function uploadFile(localPath: string, remotePath: string): Promise<number> {
  return invoke<number>("upload_file", { localPath, remotePath });
}

// ── Phase 4 — Local filesystem ────────────────────────────────────────────────

export interface LocalFileEntry {
  name: string;
  path: string;
  kind: string; // "file" | "directory" | "symlink"
  size: number | null;
  modified: number | null;
}

export async function getLocalHome(): Promise<string> {
  return invoke<string>("get_local_home");
}

export async function listLocalFolder(path: string): Promise<LocalFileEntry[]> {
  return invoke<LocalFileEntry[]>("list_local_folder", { path });
}

export async function renameLocalPath(oldPath: string, newName: string): Promise<void> {
  await invoke("rename_local_path", { oldPath, newName });
}

export async function deleteLocalPath(path: string): Promise<void> {
  await invoke("delete_local_path", { path });
}

export async function revealInFinder(path: string): Promise<void> {
  await invoke("reveal_in_finder", { path });
}

// ── Phase 5 — Terminal ────────────────────────────────────────────────────────

export async function openTerminal(
  terminalId: string,
  creds?: {
    host: string;
    port: number;
    username: string;
    authMethod: AuthMethod;
  },
): Promise<void> {
  await invoke("open_terminal", {
    terminalId,
    host: creds?.host,
    port: creds?.port,
    username: creds?.username,
    authMethod: creds?.authMethod,
  });
}

export async function writeTerminal(terminalId: string, data: number[]): Promise<void> {
  await invoke("write_terminal", { terminalId, data });
}

export async function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke("resize_terminal", { terminalId, cols, rows });
}

export async function closeTerminal(terminalId: string): Promise<void> {
  await invoke("close_terminal", { terminalId });
}

// ── Phase 6 — Queued transfers ────────────────────────────────────────────────

export interface TransferProgress {
  id: string;
  transferred: number;
  total: number;
  finished: boolean;
  error: string | null;
}

export async function downloadFileQueued(
  transferId: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  await invoke("download_file_queued", { transferId, remotePath, localPath });
}

export async function uploadFileQueued(
  transferId: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  await invoke("upload_file_queued", { transferId, localPath, remotePath });
}

export async function cancelTransfer(transferId: string): Promise<void> {
  await invoke("cancel_transfer", { transferId });
}

// ── Phase 7 — File detail ─────────────────────────────────────────────────────

export interface FileInfo {
  path: string;
  name: string;
  kind: string;
  size: number | null;
  modified: number | null;
  permissions: string | null;
  permOctal: string | null;
  owner: string | null;
  group: string | null;
}

export async function getFileInfo(path: string): Promise<FileInfo> {
  return invoke<FileInfo>("get_file_info", { path });
}

export async function chmodFile(path: string, permBits: number): Promise<void> {
  await invoke("chmod_file", { path, permBits });
}

export async function readFilePreview(path: string, maxBytes: number): Promise<string> {
  return invoke<string>("read_file_preview", { path, maxBytes });
}

export async function writeFileText(path: string, content: string): Promise<void> {
  await invoke("write_file_text", { path, content });
}

export async function computeFolderSize(path: string): Promise<number> {
  return invoke<number>("compute_folder_size", { path });
}

// ── Session log ───────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string;
  host: string;
  ip: string;
  username: string;
  startedAt: number;
  endedAt: number | null;
  cmdCount: number;
  profileId: string | null;
  profileName: string | null;
}

export type CommandSource = "terminal" | "file_browser";

export interface CommandRecord {
  id: string;
  sessionId: string;
  idx: number;
  executedAt: number;
  cwd: string;
  raw: string;
  exitCode: number | null;
  durationMs: number | null;
  output: string | null;
  outputTruncated: boolean;
  originalOutputBytes: number;
  source: CommandSource | null;
}

export interface SessionWithCommands extends SessionRecord {
  commands: CommandRecord[];
}

export async function createSession(
  host: string,
  ip: string,
  username: string,
  profileId: string | null,
  profileName: string | null,
): Promise<string> {
  return invoke<string>("create_session", { host, ip, username, profileId, profileName });
}

export async function closeSession(sessionId: string, endedAt: number): Promise<void> {
  await invoke("close_session", { sessionId, endedAt });
}

export async function appendCommand(args: {
  sessionId: string;
  idx: number;
  executedAt: number;
  cwd: string;
  raw: string;
  exitCode: number | null;
  durationMs: number | null;
  output: string | null;
  outputTruncated: boolean;
  originalOutputBytes: number;
  source: CommandSource | null;
}): Promise<void> {
  await invoke("append_command", args);
}

export async function listSessions(): Promise<SessionRecord[]> {
  return invoke<SessionRecord[]>("list_sessions");
}

export async function loadSession(sessionId: string): Promise<SessionWithCommands> {
  return invoke<SessionWithCommands>("load_session", { sessionId });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await invoke("delete_session", { sessionId });
}

export async function deleteSessionsBefore(beforeMs: number): Promise<void> {
  await invoke("delete_sessions_before", { beforeMs });
}

// ── Port forwarding ───────────────────────────────────────────────────────────

export interface PortForward {
  id: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export async function startPortForward(
  id: string,
  localPort: number,
  remoteHost: string,
  remotePort: number,
): Promise<void> {
  await invoke("start_port_forward", { id, localPort, remoteHost, remotePort });
}

export async function stopPortForward(id: string): Promise<void> {
  await invoke("stop_port_forward", { id });
}

export async function listPortForwards(): Promise<PortForward[]> {
  return invoke<PortForward[]>("list_port_forwards");
}

export async function stopAllPortForwards(): Promise<void> {
  await invoke("stop_all_port_forwards");
}

// ── SSH config import ─────────────────────────────────────────────────────────

export interface SshConfigHost {
  name: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
  identityFile: string | null;
}

export async function parseSshConfig(): Promise<SshConfigHost[]> {
  return invoke<SshConfigHost[]>("parse_ssh_config");
}

// ── Download history ──────────────────────────────────────────────────────────

export interface DownloadRecord {
  id: string;
  name: string;
  localPath: string;
  remotePath: string;
  downloadedAt: number;
  fileSize: number;
  available: boolean;
}

export async function saveDownload(
  id: string,
  name: string,
  localPath: string,
  remotePath: string,
  fileSize: number,
): Promise<void> {
  await invoke("save_download", { id, name, localPath, remotePath, fileSize });
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  return invoke<DownloadRecord[]>("list_downloads");
}

export async function deleteDownload(id: string): Promise<void> {
  await invoke("delete_download", { id });
}

export async function clearDownloadHistory(): Promise<void> {
  await invoke("clear_download_history");
}
