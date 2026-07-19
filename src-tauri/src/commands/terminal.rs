use std::io::{Read, Write};
use std::sync::Arc;

use tauri::Emitter;

use crate::models::{AppError, AuthMethod, StoredCreds};
use crate::ssh::{SshState, TerminalCmd};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalData {
    id: String,
    data: String, // base64-encoded bytes
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalClosed {
    id: String,
}

#[tauri::command]
pub async fn open_terminal(
    state: tauri::State<'_, SshState>,
    app: tauri::AppHandle,
    terminal_id: String,
    // Optional explicit credentials — used when opening a terminal for a
    // server that is NOT the currently connected one. If any of these are
    // missing, we fall back to the cached credentials of the current session.
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    auth_method: Option<AuthMethod>,
) -> Result<(), AppError> {
    let creds = match (host, port, username, auth_method) {
        (Some(h), Some(p), Some(u), Some(a)) => StoredCreds {
            host: h,
            port: p,
            username: u,
            auth: a,
        },
        _ => state
            .creds
            .lock()
            .map_err(|_| AppError::internal("mutex poisoned"))?
            .clone()
            .ok_or_else(AppError::not_connected)?,
    };

    let terminals = Arc::clone(&state.terminals);
    let tid = terminal_id.clone();

    // One-shot channel to get the connection result back from the thread.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), AppError>>();

    std::thread::spawn(move || {
        use crate::ssh::SessionBundle;
        use crate::ssh::TerminalHandle;
        use std::sync::mpsc;

        // Build the session inside this thread — Session is !Send so it must
        // never cross a thread boundary, but creating it here is fine.
        let bundle = match SessionBundle::connect(&creds.host, creds.port, &creds.username, &creds.auth)
        {
            Ok(b) => b,
            Err(e) => {
                let _ = ready_tx.send(Err(e));
                return;
            }
        };

        // Request a PTY and start a shell, then go non-blocking.
        let mut channel = match bundle.session.channel_session() {
            Ok(c) => c,
            Err(e) => {
                let _ = ready_tx.send(Err(AppError::internal(format!("channel: {e}"))));
                return;
            }
        };
        if let Err(e) = channel.request_pty("xterm-256color", None, Some((120, 40, 0, 0))) {
            let _ = ready_tx.send(Err(AppError::internal(format!("pty: {e}"))));
            return;
        }
        if let Err(e) = channel.shell() {
            let _ = ready_tx.send(Err(AppError::internal(format!("shell: {e}"))));
            return;
        }

        // Register the tx handle so callers can send commands.
        let (tx, rx) = mpsc::sync_channel::<TerminalCmd>(128);
        {
            let mut guard = match terminals.lock() {
                Ok(g) => g,
                Err(_) => {
                    let _ = ready_tx.send(Err(AppError::internal("mutex poisoned")));
                    return;
                }
            };
            guard.insert(tid.clone(), TerminalHandle { tx });
        }

        // Signal success; the Tauri command can now return.
        let _ = ready_tx.send(Ok(()));

        // Give the frontend time to render <XTermView> and attach its
        // `terminal-data` listener before we start emitting. Without this,
        // the shell's initial MOTD / PS1 output would be dropped because no
        // one is listening yet.
        std::thread::sleep(std::time::Duration::from_millis(250));

        // Inject Harbor shell integration (silent — echo disabled during setup).
        // Defines __hb_pre / __hb_pst hooks for bash and zsh that emit OSC 9001
        // markers the frontend parses to capture every command + its output.
        {
            use std::io::Write as _;
            let _ = channel.write_all(b"stty -echo 2>/dev/null\n");
            std::thread::sleep(std::time::Duration::from_millis(80));
            // Single-line script — raw string avoids Rust escape ambiguity.
            // The \e and \a inside are literal two-char sequences that the
            // remote shell's printf will expand to ESC and BEL respectively.
            // zsh: preexec / precmd hooks (native).
            // bash: DEBUG trap fires once per user command (flag-guarded to
            //       skip sub-commands and PROMPT_COMMAND internals).
            let script = "__hb_pre(){ __hb_t=$(date +%s%3N);printf '\\e]9001;start;cmd=%s;cwd=%s\\a' \"$(printf '%s' \"$1\"|base64 2>/dev/null|tr -d '\\n')\" \"$(printf '%s' \"$PWD\"|base64 2>/dev/null|tr -d '\\n')\"; };__hb_pst(){ local r=$?;printf '\\e]9001;end;exit=%d;dur=%d\\a' \"$r\" \"$(($(date +%s%3N)-${__hb_t:-0}))\"; };if [ -n \"$ZSH_VERSION\" ];then autoload -U add-zsh-hook 2>/dev/null;add-zsh-hook preexec __hb_pre 2>/dev/null;add-zsh-hook precmd __hb_pst 2>/dev/null;elif [ -n \"$BASH_VERSION\" ];then __hb_trap(){ local c=\"$BASH_COMMAND\";[ -n \"$__hb_ran\" ]&&return;[ \"$c\" = \"__hb_pst\" ]&&return;__hb_ran=1;__hb_pre \"$c\"; };trap '__hb_trap' DEBUG;PROMPT_COMMAND=\"unset __hb_ran;__hb_pst${PROMPT_COMMAND:+;$PROMPT_COMMAND}\";fi\n";
            let _ = channel.write_all(script.as_bytes());
            std::thread::sleep(std::time::Duration::from_millis(80));
            let _ = channel.write_all(b"stty echo 2>/dev/null\n");
            std::thread::sleep(std::time::Duration::from_millis(80));
        }

        // Switch to non-blocking so we can drain setup artifacts first.
        bundle.session.set_blocking(false);

        // Drain and discard all PTY output buffered during setup. The 'stty -echo'
        // command is itself echoed by the PTY (because echo was still on when it was
        // sent), so without this drain it would appear verbatim in the terminal.
        {
            use std::io::Read as _;
            std::thread::sleep(std::time::Duration::from_millis(60));
            let mut drain = [0u8; 8192];
            loop {
                match channel.read(&mut drain) {
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            // Trigger a fresh shell prompt so the user starts with a clean terminal.
            let _ = channel.write_all(b"\n");
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // ── Read/write loop ────────────────────────────────────────────────────
        let mut read_buf = [0u8; 4096];
        loop {
            // Read from SSH channel → emit event to frontend.
            match channel.read(&mut read_buf) {
                Ok(0) => {
                    if channel.eof() {
                        break;
                    }
                }
                Ok(n) => {
                    let data = crate::ssh::base64_encode(&read_buf[..n]);
                    let _ = app.emit("terminal-data", TerminalData { id: tid.clone(), data });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => break,
            }

            // Process commands from the frontend.
            match rx.try_recv() {
                Ok(TerminalCmd::Data(bytes)) => {
                    // The session is non-blocking, so `write_all` would give
                    // up on the first `WouldBlock` and silently discard the
                    // rest of the buffer — that's what caused fast typing /
                    // paste to lose characters. Retry with a short back-off
                    // until every byte lands or the channel truly errors.
                    let mut written = 0;
                    while written < bytes.len() {
                        match channel.write(&bytes[written..]) {
                            Ok(0) => {
                                // Rare "no progress" case: yield briefly and
                                // try again rather than spinning.
                                std::thread::sleep(std::time::Duration::from_millis(1));
                            }
                            Ok(n) => {
                                written += n;
                            }
                            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                std::thread::sleep(std::time::Duration::from_millis(1));
                            }
                            Err(_) => break, // channel died — leave the read loop's error path to notice
                        }
                    }
                }
                Ok(TerminalCmd::Resize { cols, rows }) => {
                    let _ = channel.request_pty_size(cols, rows, None, None);
                }
                Ok(TerminalCmd::Close) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
            }

            std::thread::sleep(std::time::Duration::from_millis(5));
        }

        // Cleanup
        let _ = channel.close();
        if let Ok(mut g) = terminals.lock() {
            g.remove(&tid);
        }
        let _ = app.emit("terminal-closed", TerminalClosed { id: tid });
    });

    ready_rx
        .recv()
        .map_err(|_| AppError::internal("terminal thread crashed before signalling"))?
}

#[tauri::command]
pub fn write_terminal(
    state: tauri::State<'_, SshState>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), AppError> {
    let guard = state
        .terminals
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?;
    let handle = guard
        .get(&terminal_id)
        .ok_or_else(|| AppError::internal("terminal not found"))?;
    handle
        .tx
        .send(TerminalCmd::Data(data))
        .map_err(|_| AppError::internal("terminal closed"))
}

#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<'_, SshState>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let guard = state
        .terminals
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?;
    let handle = guard
        .get(&terminal_id)
        .ok_or_else(|| AppError::internal("terminal not found"))?;
    handle
        .tx
        .send(TerminalCmd::Resize { cols, rows })
        .map_err(|_| AppError::internal("terminal closed"))
}

#[tauri::command]
pub fn close_terminal(
    state: tauri::State<'_, SshState>,
    terminal_id: String,
) -> Result<(), AppError> {
    let guard = state
        .terminals
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?;
    if let Some(handle) = guard.get(&terminal_id) {
        let _ = handle.tx.send(TerminalCmd::Close);
    }
    Ok(())
}

