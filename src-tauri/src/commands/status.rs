use std::sync::Arc;

use crate::models::{AppError, ConnectionStatus};
use crate::ssh::SshState;

#[tauri::command]
pub fn connection_status(state: tauri::State<'_, SshState>) -> Result<ConnectionStatus, AppError> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;

    Ok(match &*guard {
        Some(bundle) => ConnectionStatus {
            connected: true,
            host: Some(bundle.host().to_owned()),
            username: Some(bundle.username().to_owned()),
        },
        None => ConnectionStatus {
            connected: false,
            host: None,
            username: None,
        },
    })
}

/// Verify that the current SSH session can still speak SFTP. Used by the
/// frontend connection watchdog — cheap enough to run on every window focus
/// and on a 30s interval. Returns Ok only if the pipe is truly alive.
#[tauri::command]
pub async fn ping_connection(state: tauri::State<'_, SshState>) -> Result<(), AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let sftp = bundle
            .session
            .sftp()
            .map_err(|e| AppError::connection_failed(format!("SFTP down: {e}")))?;
        sftp.stat(std::path::Path::new("/"))
            .map(|_| ())
            .map_err(|e| AppError::connection_failed(format!("Ping failed: {e}")))
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}
