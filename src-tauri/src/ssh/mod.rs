use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ssh2::Session;

use crate::config::{
    SFTP_PREVIEW_CAP_BYTES, SFTP_TRANSFER_BUF_SIZE, SSH_CONNECT_TIMEOUT_SECS,
    SSH_KEEPALIVE_INTERVAL_SECS, SSH_READ_TIMEOUT_SECS,
};
use crate::models::{
    format_permissions, AppError, AuthMethod, ConnectResult, FileEntry, FileKind, StoredCreds,
};

// ── Terminal types ────────────────────────────────────────────────────────────

pub enum TerminalCmd {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct TerminalHandle {
    pub tx: std::sync::mpsc::SyncSender<TerminalCmd>,
}

// ── Port forward types ────────────────────────────────────────────────────────

pub struct PortForwardHandle {
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub stop_tx: std::sync::mpsc::Sender<()>,
}

// ── Session bundle ────────────────────────────────────────────────────────────

pub struct SessionBundle {
    pub session: Session,
    host: String,
    #[allow(dead_code)]
    port: u16,
    username: String,
    pub ip_addr: String,
    _stream: TcpStream,
    /// Cached SFTP handle — avoids re-initializing the SFTP subsystem on every call.
    sftp: Option<ssh2::Sftp>,
    /// Cached `command -v ionice` result — probed lazily on first storage scan,
    /// then reused for every throttled command in this session.
    ionice_available: Option<bool>,
}

impl SessionBundle {
    pub fn connect(
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
    ) -> Result<Self, AppError> {
        let addr = format!("{host}:{port}");
        let stream = TcpStream::connect(&addr).or_else(|_| {
            use std::net::ToSocketAddrs;
            let socket = addr
                .to_socket_addrs()
                .map_err(|e| AppError::connection_failed(format!("DNS lookup failed: {e}")))?
                .next()
                .ok_or_else(|| AppError::connection_failed("No addresses returned by DNS"))?;
            TcpStream::connect_timeout(&socket, Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS))
                .map_err(|e| AppError::connection_failed(format!("TCP connect failed: {e}")))
        })?;

        let ip_addr = stream
            .peer_addr()
            .map(|a| a.ip().to_string())
            .unwrap_or_else(|_| host.to_owned());

        stream
            .set_read_timeout(Some(Duration::from_secs(SSH_READ_TIMEOUT_SECS)))
            .map_err(|e| AppError::internal(e.to_string()))?;

        let mut session =
            Session::new().map_err(|e| AppError::internal(format!("ssh2 init failed: {e}")))?;

        let stream_clone = stream
            .try_clone()
            .map_err(|e| AppError::internal(format!("stream clone failed: {e}")))?;

        session.set_tcp_stream(stream);
        session
            .handshake()
            .map_err(|e| AppError::connection_failed(format!("SSH handshake failed: {e}")))?;

        match auth {
            AuthMethod::Password { password } => {
                session
                    .userauth_password(username, password)
                    .map_err(|e| AppError::auth_failed(format!("Password auth failed: {e}")))?;
            }
            AuthMethod::PublicKey {
                key_path,
                passphrase,
            } => {
                let expanded = shellexpand::tilde(key_path).into_owned();
                let key_file = Path::new(&expanded);
                session
                    .userauth_pubkey_file(username, None, key_file, passphrase.as_deref())
                    .map_err(|e| AppError::auth_failed(format!("Key auth failed: {e}")))?;
            }
        }

        if !session.authenticated() {
            return Err(AppError::auth_failed("Authentication rejected by server"));
        }

        // SSH-level keepalive: send an SSH ignore message every 30 seconds,
        // and expect the server to reply. If the pipe is dead (laptop slept,
        // network dropped, etc.), the next keepalive attempt fails and any
        // subsequent read/write on this session will error out instead of
        // hanging indefinitely. The `true` argument makes the server also
        // send replies, so we can detect one-way drops.
        session.set_keepalive(true, SSH_KEEPALIVE_INTERVAL_SECS);

        Ok(SessionBundle {
            session,
            host: host.to_owned(),
            port,
            username: username.to_owned(),
            ip_addr,
            _stream: stream_clone,
            sftp: None,
            ionice_available: None,
        })
    }

    fn get_sftp(&mut self) -> Result<&ssh2::Sftp, AppError> {
        if self.sftp.is_none() {
            self.sftp = Some(
                self.session
                    .sftp()
                    .map_err(|e| AppError::internal(format!("SFTP subsystem failed: {e}")))?,
            );
        }
        Ok(self.sftp.as_ref().expect("sftp was just initialised above"))
    }

    /// Cheap existence check via SFTP stat — used by path-bar validation instead
    /// of listing an entire directory.
    pub fn path_exists(&mut self, path: &str) -> Result<bool, AppError> {
        let sftp = self.get_sftp()?;
        let expanded = shellexpand::tilde(path).into_owned().replace('\\', "/");
        match sftp.stat(Path::new(&expanded)) {
            Ok(_) => Ok(true),
            Err(e) => {
                let msg = e.message().to_lowercase();
                if msg.contains("no such file") || msg.contains("not found") {
                    Ok(false)
                } else {
                    Err(AppError::internal(format!(
                        "Cannot stat {path}: {}",
                        e.message()
                    )))
                }
            }
        }
    }

    pub fn exec(&self, command: &str) -> Result<String, AppError> {
        let mut channel = self
            .session
            .channel_session()
            .map_err(|e| AppError::internal(format!("channel open failed: {e}")))?;

        channel
            .exec(command)
            .map_err(|e| AppError::internal(format!("exec failed: {e}")))?;

        let mut output = String::new();
        channel
            .read_to_string(&mut output)
            .map_err(|e| AppError::internal(format!("read failed: {e}")))?;

        channel
            .wait_close()
            .map_err(|e| AppError::internal(format!("channel close failed: {e}")))?;

        Ok(output.trim().to_owned())
    }

    /// Check whether the `ionice` utility is available on the remote server.
    /// Result is cached for the lifetime of this session — probes at most once.
    pub fn has_ionice(&mut self) -> bool {
        if let Some(v) = self.ionice_available {
            return v;
        }
        let out = self
            .exec("command -v ionice >/dev/null 2>&1 && echo __YES__ || echo __NO__")
            .unwrap_or_default();
        let v = out.contains("__YES__");
        self.ionice_available = Some(v);
        v
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    #[allow(dead_code)]
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn username(&self) -> &str {
        &self.username
    }

    pub fn disconnect(self) {
        let _ = self.session.disconnect(None, "User disconnected", None);
    }

    pub fn list_dir(&mut self, path: &str) -> Result<Vec<FileEntry>, AppError> {
        let sftp = self.get_sftp()?;

        let expanded = shellexpand::tilde(path).into_owned().replace('\\', "/");

        let raw = sftp.readdir(std::path::Path::new(&expanded)).map_err(|e| {
            let msg = e.message().to_owned();
            if msg.to_lowercase().contains("permission") {
                AppError::permission_denied(format!("Permission denied: {path}"))
            } else {
                AppError::internal(format!("Cannot list {path}: {msg}"))
            }
        })?;

        let mut entries: Vec<FileEntry> = raw
            .into_iter()
            .filter_map(|(entry_path, stat)| {
                let name = entry_path.file_name()?.to_string_lossy().to_string();
                if name == "." || name == ".." {
                    return None;
                }
                Some(FileEntry {
                    name,
                    path: entry_path.to_string_lossy().replace('\\', "/"),
                    kind: FileKind::from_perm(stat.perm),
                    size: stat.size,
                    permissions: stat.perm.map(format_permissions),
                    modified: stat.mtime,
                })
            })
            .collect();

        entries.sort_by(|a, b| match (&a.kind, &b.kind) {
            (FileKind::Directory, FileKind::Directory) => {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
            (FileKind::Directory, _) => std::cmp::Ordering::Less,
            (_, FileKind::Directory) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    }

    /// Read a directory incrementally via SFTP opendir/readdir. Checks
    /// `is_cancelled` before each entry so navigation can abandon in-flight
    /// listings without waiting for the full directory read.
    pub fn list_dir_stream<C, F>(
        &mut self,
        path: &str,
        chunk_size: usize,
        mut is_cancelled: F,
        mut emit: C,
    ) -> Result<usize, AppError>
    where
        C: FnMut(Vec<FileEntry>, usize),
        F: FnMut() -> bool,
    {
        let sftp = self.get_sftp()?;
        let expanded = shellexpand::tilde(path).into_owned().replace('\\', "/");
        let dir_path = Path::new(&expanded);

        let mut dir = sftp
            .opendir(dir_path)
            .map_err(|e| map_list_dir_error(e, path))?;

        let mut batch: Vec<FileEntry> = Vec::with_capacity(chunk_size);
        let mut offset = 0usize;
        let mut total = 0usize;

        loop {
            if is_cancelled() {
                return Ok(total);
            }

            match dir.readdir() {
                Ok((filename, stat)) => {
                    let name = filename.to_string_lossy().to_string();
                    if name == "." || name == ".." {
                        continue;
                    }

                    batch.push(FileEntry {
                        name,
                        path: dir_path
                            .join(&filename)
                            .to_string_lossy()
                            .replace('\\', "/"),
                        kind: FileKind::from_perm(stat.perm),
                        size: stat.size,
                        permissions: stat.perm.map(format_permissions),
                        modified: stat.mtime,
                    });

                    if batch.len() >= chunk_size {
                        let len = batch.len();
                        emit(batch, offset);
                        offset += len;
                        total += len;
                        batch = Vec::with_capacity(chunk_size);
                    }
                }
                Err(e) if is_readdir_eof(&e) => break,
                Err(e) => return Err(map_list_dir_error(e, path)),
            }
        }

        if !batch.is_empty() {
            let len = batch.len();
            emit(batch, offset);
            total += len;
        }

        Ok(total)
    }

    pub fn create_dir(&mut self, path: &str) -> Result<(), AppError> {
        let sftp = self.get_sftp()?;
        sftp.mkdir(Path::new(path), 0o755).map_err(AppError::from)
    }

    pub fn rename_entry(&mut self, old_path: &str, new_path: &str) -> Result<(), AppError> {
        let sftp = self.get_sftp()?;
        sftp.rename(Path::new(old_path), Path::new(new_path), None)
            .map_err(AppError::from)
    }

    pub fn delete_entry(&mut self, path: &str) -> Result<(), AppError> {
        let sftp = self.get_sftp()?;
        sftp_delete_recursive(sftp, Path::new(path))
    }

    /// Recursively sum the sizes of every file under `path`. Symlinks are
    /// counted by their target size (`stat`, not `lstat`). Errors on
    /// individual subdirectories don't abort the whole walk — they're just
    /// skipped, since a real user with mixed permissions still expects a
    /// best-effort total.
    pub fn compute_folder_size(&mut self, path: &str) -> Result<u64, AppError> {
        let sftp = self.get_sftp()?;
        Ok(sftp_folder_size(sftp, Path::new(path)))
    }

    pub fn download(&mut self, remote_path: &str, local_path: &str) -> Result<u64, AppError> {
        let sftp = self.get_sftp()?;
        let mut src = sftp.open(Path::new(remote_path)).map_err(AppError::from)?;
        let mut dst = std::fs::File::create(local_path)
            .map_err(|e| AppError::internal(format!("Cannot create file: {e}")))?;
        std::io::copy(&mut src, &mut dst)
            .map_err(|e| AppError::internal(format!("Download failed: {e}")))
    }

    pub fn upload(&mut self, local_path: &str, remote_path: &str) -> Result<u64, AppError> {
        let sftp = self.get_sftp()?;
        let mut src = std::fs::File::open(local_path)
            .map_err(|e| AppError::internal(format!("Cannot open file: {e}")))?;
        let mut dst = sftp
            .create(Path::new(remote_path))
            .map_err(AppError::from)?;
        let bytes = std::io::copy(&mut src, &mut dst)
            .map_err(|e| AppError::internal(format!("Upload failed: {e}")))?;
        dst.flush()
            .map_err(|e| AppError::internal(format!("Flush failed: {e}")))?;
        Ok(bytes)
    }

    /// Download with chunked progress events. Used by Phase 6 queued transfers.
    pub fn download_with_progress(
        &mut self,
        remote_path: &str,
        local_path: &str,
        cancelled: &Arc<Mutex<HashSet<String>>>,
        transfer_id: &str,
        mut on_progress: impl FnMut(u64, u64),
    ) -> Result<u64, AppError> {
        let sftp = self.get_sftp()?;
        let stat = sftp.stat(Path::new(remote_path)).map_err(AppError::from)?;
        let total = stat.size.unwrap_or(0);

        let mut src = sftp.open(Path::new(remote_path)).map_err(AppError::from)?;
        let mut dst = std::fs::File::create(local_path)
            .map_err(|e| AppError::internal(format!("Cannot create file: {e}")))?;

        let mut buf = [0u8; SFTP_TRANSFER_BUF_SIZE];
        let mut transferred = 0u64;

        loop {
            if cancelled
                .lock()
                .map(|g| g.contains(transfer_id))
                .unwrap_or(false)
            {
                return Err(AppError::internal("Transfer cancelled"));
            }

            let n = src
                .read(&mut buf)
                .map_err(|e| AppError::internal(format!("Read failed: {e}")))?;
            if n == 0 {
                break;
            }

            dst.write_all(&buf[..n])
                .map_err(|e| AppError::internal(format!("Write failed: {e}")))?;

            transferred += n as u64;
            on_progress(transferred, total);
        }

        Ok(transferred)
    }

    /// Upload with chunked progress events.
    pub fn upload_with_progress(
        &mut self,
        local_path: &str,
        remote_path: &str,
        cancelled: &Arc<Mutex<HashSet<String>>>,
        transfer_id: &str,
        mut on_progress: impl FnMut(u64, u64),
    ) -> Result<u64, AppError> {
        let total = std::fs::metadata(local_path).map(|m| m.len()).unwrap_or(0);

        let sftp = self.get_sftp()?;
        let mut src = std::fs::File::open(local_path)
            .map_err(|e| AppError::internal(format!("Cannot open file: {e}")))?;
        let mut dst = sftp
            .create(Path::new(remote_path))
            .map_err(AppError::from)?;

        let mut buf = [0u8; SFTP_TRANSFER_BUF_SIZE];
        let mut transferred = 0u64;

        loop {
            if cancelled
                .lock()
                .map(|g| g.contains(transfer_id))
                .unwrap_or(false)
            {
                return Err(AppError::internal("Transfer cancelled"));
            }

            let n = src
                .read(&mut buf)
                .map_err(|e| AppError::internal(format!("Read failed: {e}")))?;
            if n == 0 {
                break;
            }

            dst.write_all(&buf[..n])
                .map_err(|e| AppError::internal(format!("Write failed: {e}")))?;

            transferred += n as u64;
            on_progress(transferred, total);
        }

        dst.flush()
            .map_err(|e| AppError::internal(format!("Flush failed: {e}")))?;
        Ok(transferred)
    }

    pub fn connect_and_verify(
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
    ) -> Result<(Self, ConnectResult), AppError> {
        let bundle = Self::connect(host, port, username, auth)?;

        let whoami = bundle
            .exec("whoami")
            .unwrap_or_else(|_| username.to_owned());
        let home_dir = bundle
            .exec("echo $HOME")
            .unwrap_or_else(|_| String::from("/"));
        let os_info = bundle.exec("uname -sr").unwrap_or_default();
        let ip_addr = bundle.ip_addr.clone();

        let result = ConnectResult {
            host: host.to_owned(),
            port,
            username: username.to_owned(),
            whoami,
            home_dir,
            os_info,
            ip_addr,
        };

        Ok((bundle, result))
    }

    pub fn get_file_info(&mut self, path: &str) -> Result<crate::models::FileInfo, AppError> {
        use crate::models::FileInfo;
        let sftp = self.get_sftp()?;
        let stat = sftp.lstat(Path::new(path)).map_err(AppError::from)?;

        let perm_str = stat.perm.map(format_permissions);
        let perm_octal = stat.perm.map(|p| format!("{:04o}", p & 0o7777));

        // SECURITY-CRITICAL: `path` is interpolated into a shell command below,
        // so it MUST be wrapped in single quotes AND every embedded single
        // quote must be replaced with the four-char sequence `'\''`.
        // `shell_single_quote` does exactly that; do not reach for `format!`
        // directly here in a future refactor without preserving this contract.
        let escaped = shell_single_quote(path).ok_or_else(|| {
            AppError::internal("Path contains a NUL byte and cannot be passed to a shell")
        })?;
        let owner_group = self
            .exec(&format!(
                "stat -c '%U %G' '{escaped}' 2>/dev/null || \
                 stat -f '%Su %Sg' '{escaped}' 2>/dev/null || \
                 echo 'unknown unknown'",
            ))
            .unwrap_or_else(|_| "unknown unknown".into());

        let mut parts = owner_group.split_whitespace();
        let owner = parts.next().map(String::from).filter(|s| s != "unknown");
        let group = parts.next().map(String::from).filter(|s| s != "unknown");

        let name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let kind = match stat.perm.map(|p| p & 0o170000) {
            Some(0o040000) => "directory",
            Some(0o100000) => "file",
            Some(0o120000) => "symlink",
            _ => "other",
        }
        .to_string();

        Ok(FileInfo {
            path: path.to_owned(),
            name,
            kind,
            size: stat.size,
            modified: stat.mtime,
            permissions: perm_str,
            perm_octal,
            owner,
            group,
        })
    }

    pub fn chmod_file(&mut self, path: &str, perm_bits: u32) -> Result<(), AppError> {
        let sftp = self.get_sftp()?;
        let current = sftp.lstat(Path::new(path)).map_err(AppError::from)?;
        let new_perm = (current.perm.unwrap_or(0) & 0o170000) | (perm_bits & 0o7777);
        sftp.setstat(
            Path::new(path),
            ssh2::FileStat {
                size: None,
                uid: None,
                gid: None,
                perm: Some(new_perm),
                atime: None,
                mtime: None,
            },
        )
        .map_err(AppError::from)
    }

    pub fn read_file_preview(&mut self, path: &str, max_bytes: usize) -> Result<String, AppError> {
        let sftp = self.get_sftp()?;
        let mut file = sftp.open(Path::new(path)).map_err(AppError::from)?;
        let cap = max_bytes.min(SFTP_PREVIEW_CAP_BYTES);
        let mut buf = vec![0u8; cap];
        let n = Read::read(&mut file, &mut buf)
            .map_err(|e| AppError::internal(format!("Read failed: {e}")))?;
        Ok(base64_encode(&buf[..n]))
    }

    /// Read the last `max_bytes` bytes of a file. Used by the preview modal's
    /// "Show last 2 MB" button for large log files. `SeekFrom::End` is a
    /// single SFTP roundtrip; the actual bytes are then streamed back in one
    /// bounded read.
    pub fn read_file_preview_tail(
        &mut self,
        path: &str,
        max_bytes: usize,
    ) -> Result<String, AppError> {
        let sftp = self.get_sftp()?;
        let mut file = sftp.open(Path::new(path)).map_err(AppError::from)?;
        let cap = max_bytes.min(SFTP_PREVIEW_CAP_BYTES);
        // Seek from END: negative offset = read the tail. If the file is
        // smaller than `cap`, seek to the start instead so we don't over-read.
        let end = file
            .seek(SeekFrom::End(0))
            .map_err(|e| AppError::internal(format!("Seek(End) failed: {e}")))?;
        let offset = end.saturating_sub(cap as u64);
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| AppError::internal(format!("Seek(Start) failed: {e}")))?;
        let mut buf = vec![0u8; cap];
        let n = Read::read(&mut file, &mut buf)
            .map_err(|e| AppError::internal(format!("Read failed: {e}")))?;
        Ok(base64_encode(&buf[..n]))
    }

    /// Overwrite a remote file with the given UTF-8 text. SFTP `create` opens
    /// the file with O_WRONLY|O_CREAT|O_TRUNC so previous contents are wiped.
    pub fn write_file_text(&mut self, path: &str, content: &str) -> Result<(), AppError> {
        let sftp = self.get_sftp()?;
        let mut file = sftp.create(Path::new(path)).map_err(AppError::from)?;
        Write::write_all(&mut file, content.as_bytes())
            .map_err(|e| AppError::internal(format!("Write failed: {e}")))?;
        Write::flush(&mut file).map_err(|e| AppError::internal(format!("Flush failed: {e}")))?;
        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Escape a string so it can be safely wrapped in single quotes in a shell
/// command. Returns `None` if the string contains a NUL byte (which a shell
/// can't represent) — callers should reject the operation rather than pass
/// truncated data to the server.
///
/// The output is meant to be interpolated INSIDE literal single quotes:
///   `format!("stat '{}' …", shell_single_quote(path).unwrap())`
/// Do not use for anything other than single-quoted contexts.
///
/// SECURITY-CRITICAL — if you change this, every `format!(... '{escaped}' ...)`
/// call site in this file needs to be re-audited.
pub(crate) fn shell_single_quote(input: &str) -> Option<String> {
    if input.contains('\0') {
        return None;
    }
    // A literal `'` closes the outer quoting, so replace each with
    // `'\''` — close, escaped-single-quote, reopen.
    Some(input.replace('\'', r"'\''"))
}

pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        let _ = out.write_char(TABLE[((n >> 18) & 63) as usize] as char);
        let _ = out.write_char(TABLE[((n >> 12) & 63) as usize] as char);
        let _ = out.write_char(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        let _ = out.write_char(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn is_readdir_eof(e: &ssh2::Error) -> bool {
    // LIBSSH2_ERROR_FILE (-16) — end of directory listing (ssh2 File::readdir).
    matches!(e.code(), ssh2::ErrorCode::Session(-16)) || e.message() == "no more files"
}

fn map_list_dir_error(e: ssh2::Error, path: &str) -> AppError {
    let msg = e.message().to_owned();
    if msg.to_lowercase().contains("permission") {
        AppError::permission_denied(format!("Permission denied: {path}"))
    } else {
        AppError::internal(format!("Cannot list {path}: {msg}"))
    }
}

fn sftp_delete_recursive(sftp: &ssh2::Sftp, path: &Path) -> Result<(), AppError> {
    use crate::models::FileKind;
    let stat = sftp.lstat(path).map_err(AppError::from)?;
    if FileKind::from_perm(stat.perm) == FileKind::Directory {
        for (entry_path, _) in sftp.readdir(path).map_err(AppError::from)? {
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name != "." && name != ".." {
                sftp_delete_recursive(sftp, &entry_path)?;
            }
        }
        sftp.rmdir(path).map_err(AppError::from)?;
    } else {
        sftp.unlink(path).map_err(AppError::from)?;
    }
    Ok(())
}

/// Recursive size computation, best-effort. Any subdirectory that can't be
/// read (permission denied, symlink cycles, transient errors) is skipped and
/// contributes 0 rather than failing the whole call.
fn sftp_folder_size(sftp: &ssh2::Sftp, path: &Path) -> u64 {
    use crate::models::FileKind;
    let entries = match sftp.readdir(path) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut total: u64 = 0;
    for (entry_path, stat) in entries {
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name == "." || name == ".." {
            continue;
        }
        match FileKind::from_perm(stat.perm) {
            FileKind::Directory => {
                total = total.saturating_add(sftp_folder_size(sftp, &entry_path));
            }
            FileKind::File | FileKind::Symlink | FileKind::Other => {
                total = total.saturating_add(stat.size.unwrap_or(0));
            }
        }
    }
    total
}

// ── Managed application state ─────────────────────────────────────────────────

pub struct SshState {
    pub inner: Arc<Mutex<Option<SessionBundle>>>,
    /// Credentials stored after a successful connect so the terminal can open its own session.
    pub creds: Arc<Mutex<Option<StoredCreds>>>,
    /// Active terminal threads indexed by terminal_id.
    pub terminals: Arc<Mutex<HashMap<String, TerminalHandle>>>,
    /// Transfer IDs that have been cancelled by the user.
    pub cancelled_transfers: Arc<Mutex<HashSet<String>>>,
    /// Directory listing stream IDs cancelled by navigation or reload.
    pub cancelled_lists: Arc<Mutex<HashSet<String>>>,
    /// Active port forward listeners indexed by forward_id.
    pub port_forwards: Arc<Mutex<HashMap<String, PortForwardHandle>>>,
}

impl SshState {
    pub fn new() -> Self {
        SshState {
            inner: Arc::new(Mutex::new(None)),
            creds: Arc::new(Mutex::new(None)),
            terminals: Arc::new(Mutex::new(HashMap::new())),
            cancelled_transfers: Arc::new(Mutex::new(HashSet::new())),
            cancelled_lists: Arc::new(Mutex::new(HashSet::new())),
            port_forwards: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SshState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::shell_single_quote;

    #[test]
    fn shell_quote_ordinary_path_unchanged() {
        assert_eq!(
            shell_single_quote("/home/ubuntu/foo.txt").unwrap(),
            "/home/ubuntu/foo.txt"
        );
    }

    #[test]
    fn shell_quote_single_quote_is_escaped() {
        // O'Brien.txt → O'\''Brien.txt so the outer 'O'\''Brien.txt' shell-quotes
        // reconstruct the literal name.
        assert_eq!(
            shell_single_quote("O'Brien.txt").unwrap(),
            "O'\\''Brien.txt"
        );
    }

    #[test]
    fn shell_quote_backslash_left_alone() {
        // Backslashes are literal inside shell single quotes; nothing to do.
        assert_eq!(shell_single_quote(r"a\b\c").unwrap(), r"a\b\c");
    }

    #[test]
    fn shell_quote_semicolon_and_dollar_safe_because_of_outer_quotes() {
        // These characters are shell metachars but the caller wraps the
        // output in single quotes, so they are inert.
        assert_eq!(shell_single_quote("; rm -rf /").unwrap(), "; rm -rf /");
        assert_eq!(shell_single_quote("$(whoami)").unwrap(), "$(whoami)");
    }

    #[test]
    fn shell_quote_nul_byte_rejected() {
        assert!(shell_single_quote("bad\0path").is_none());
    }

    #[test]
    fn shell_quote_multiple_quotes() {
        // Two adjacent single quotes → each becomes '\''; check output length.
        let out = shell_single_quote("''").unwrap();
        assert_eq!(out, "'\\'''\\''");
    }
}
