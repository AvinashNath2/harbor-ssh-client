use crate::models::AppError;
use crate::ssh::SshState;

#[tauri::command]
pub fn disconnect(state: tauri::State<'_, SshState>) -> Result<(), AppError> {
    // 1. Take and drop the main SSH session.
    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        if let Some(session) = guard.take() {
            session.disconnect();
        }
    }

    // 2. Do NOT close terminals here — each terminal owns its own independent
    //    SSH session. They stay alive across a file-browser disconnect so a
    //    user can have terminals to multiple VMs simultaneously.

    // 3. Clear cached credentials so the terminal can't reconnect after disconnect.
    if let Ok(mut creds) = state.creds.lock() {
        *creds = None;
    }

    // 4. Clear any cancelled transfer IDs (they're meaningless after disconnect).
    if let Ok(mut cancelled) = state.cancelled_transfers.lock() {
        cancelled.clear();
    }

    Ok(())
}
