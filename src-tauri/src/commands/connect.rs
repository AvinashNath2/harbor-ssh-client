use std::sync::Arc;

use crate::models::{AppError, AuthMethod, ConnectResult, StoredCreds};
use crate::ssh::SshState;

/// Authenticate against a target server and immediately disconnect.
/// Used by the "Test Connection" button in the New Session modal — does not
/// touch the active SshState in any way, so the user's current session is
/// preserved.
#[tauri::command]
pub async fn test_connection(
    host: String,
    port: u16,
    username: String,
    auth_method: AuthMethod,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = crate::ssh::SessionBundle::connect(&host, port, &username, &auth_method)?;
        bundle.disconnect();
        Ok(())
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// Rebuild the main SSH session using cached credentials from the previous
/// connect. Used to auto-recover from network drops.
#[tauri::command]
pub async fn reconnect(
    state: tauri::State<'_, SshState>,
) -> Result<ConnectResult, AppError> {
    let creds = state
        .creds
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?
        .clone()
        .ok_or_else(AppError::not_connected)?;

    let ssh = Arc::clone(&state.inner);

    tauri::async_runtime::spawn_blocking(move || {
        let (bundle, result) = crate::ssh::SessionBundle::connect_and_verify(
            &creds.host,
            creds.port,
            &creds.username,
            &creds.auth,
        )?;

        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        if let Some(old) = guard.take() {
            old.disconnect();
        }
        *guard = Some(bundle);

        Ok(result)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, SshState>,
    host: String,
    port: u16,
    username: String,
    auth_method: AuthMethod,
) -> Result<ConnectResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    let creds_store = Arc::clone(&state.creds);
    let terminals = Arc::clone(&state.terminals);

    tauri::async_runtime::spawn_blocking(move || {
        // Disconnect existing session and close all terminals.
        {
            let mut guard = ssh
                .lock()
                .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
            if let Some(old) = guard.take() {
                old.disconnect();
            }
        }
        if let Ok(mut t) = terminals.lock() {
            t.clear();
        }

        let (bundle, result) =
            crate::ssh::SessionBundle::connect_and_verify(&host, port, &username, &auth_method)?;

        // Cache credentials for terminal sessions.
        if let Ok(mut c) = creds_store.lock() {
            *c = Some(StoredCreds {
                host,
                port,
                username,
                auth: auth_method,
            });
        }

        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        *guard = Some(bundle);

        Ok(result)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}
