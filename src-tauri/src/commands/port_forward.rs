use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{mpsc, Arc};

use tauri::Emitter;

use crate::models::{AppError, StoredCreds};
use crate::ssh::{PortForwardHandle, SessionBundle, SshState};

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PfListeningEvent {
    id: String,
    local_port: u16,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PfErrorEvent {
    id: String,
    message: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardRecord {
    pub id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[tauri::command]
pub async fn start_port_forward(
    state: tauri::State<'_, SshState>,
    app: tauri::AppHandle,
    id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<(), AppError> {
    let creds = state
        .creds
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?
        .clone()
        .ok_or_else(AppError::not_connected)?;

    // Bind before spawning so port-in-use errors surface immediately.
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .map_err(|e| AppError::internal(format!("bind localhost:{local_port} failed: {e}")))?;

    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    {
        let mut guard = state
            .port_forwards
            .lock()
            .map_err(|_| AppError::internal("mutex poisoned"))?;
        guard.insert(
            id.clone(),
            PortForwardHandle {
                local_port,
                remote_host: remote_host.clone(),
                remote_port,
                stop_tx,
            },
        );
    }

    let port_forwards = Arc::clone(&state.port_forwards);
    let id2 = id.clone();
    let remote_host2 = remote_host.clone();

    std::thread::spawn(move || {
        let _ = app.emit("pf-listening", PfListeningEvent { id: id2.clone(), local_port });

        // Non-blocking accept loop so we can respond to the stop signal promptly.
        listener.set_nonblocking(true).ok();

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match listener.accept() {
                Ok((stream, _)) => {
                    let c = creds.clone();
                    let rh = remote_host2.clone();
                    let rp = remote_port;
                    let a = app.clone();
                    let id3 = id2.clone();
                    std::thread::spawn(move || {
                        if let Err(msg) = relay(stream, &c, &rh, rp) {
                            let _ = a.emit("pf-error", PfErrorEvent { id: id3, message: msg });
                        }
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }

        if let Ok(mut g) = port_forwards.lock() {
            g.remove(&id2);
        }
    });

    Ok(())
}

/// Bi-directional relay between a local TCP stream and an SSH direct-tcpip
/// channel. Returns `Ok(())` on normal close, `Err(message)` only for errors
/// that prevent the tunnel from being established at all.
fn relay(mut local: TcpStream, creds: &StoredCreds, remote_host: &str, remote_port: u16) -> Result<(), String> {
    let bundle = SessionBundle::connect(&creds.host, creds.port, &creds.username, &creds.auth)
        .map_err(|e| e.message.clone())?;

    let mut channel = bundle
        .session
        .channel_direct_tcpip(remote_host, remote_port, None)
        .map_err(|e| format!("cannot reach {remote_host}:{remote_port}: {e}"))?;

    local.set_nonblocking(true).map_err(|e| e.to_string())?;
    bundle.session.set_blocking(false);

    // Pending write buffers — needed because non-blocking writes may be partial.
    let mut l2s: Vec<u8> = Vec::new(); // buffered bytes waiting to go to SSH
    let mut s2l: Vec<u8> = Vec::new(); // buffered bytes waiting to go to local

    let mut local_buf = [0u8; 8192];
    let mut ssh_buf = [0u8; 8192];

    loop {
        let mut progress = false;

        // Flush SSH → local
        while !s2l.is_empty() {
            match local.write(&s2l) {
                Ok(n) if n > 0 => {
                    s2l.drain(..n);
                    progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => return Ok(()),
            }
        }

        // Flush local → SSH
        while !l2s.is_empty() {
            match channel.write(&l2s) {
                Ok(n) if n > 0 => {
                    l2s.drain(..n);
                    progress = true;
                }
                Ok(_) => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(_) => return Ok(()),
            }
        }

        // Read from local TCP
        match local.read(&mut local_buf) {
            Ok(0) => return Ok(()), // TCP connection closed by client
            Ok(n) => {
                l2s.extend_from_slice(&local_buf[..n]);
                progress = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Ok(()),
        }

        // Read from SSH channel
        match channel.read(&mut ssh_buf) {
            Ok(0) => {
                if channel.eof() {
                    return Ok(());
                }
            }
            Ok(n) => {
                s2l.extend_from_slice(&ssh_buf[..n]);
                progress = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Ok(()),
        }

        if !progress {
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
}

#[tauri::command]
pub fn stop_port_forward(
    state: tauri::State<'_, SshState>,
    id: String,
) -> Result<(), AppError> {
    let guard = state
        .port_forwards
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?;
    if let Some(handle) = guard.get(&id) {
        let _ = handle.stop_tx.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn list_port_forwards(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<PortForwardRecord>, AppError> {
    let guard = state
        .port_forwards
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?;
    Ok(guard
        .iter()
        .map(|(id, h)| PortForwardRecord {
            id: id.clone(),
            local_port: h.local_port,
            remote_host: h.remote_host.clone(),
            remote_port: h.remote_port,
        })
        .collect())
}

#[tauri::command]
pub fn stop_all_port_forwards(
    state: tauri::State<'_, SshState>,
) -> Result<(), AppError> {
    let guard = state
        .port_forwards
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?;
    for h in guard.values() {
        let _ = h.stop_tx.send(());
    }
    Ok(())
}
