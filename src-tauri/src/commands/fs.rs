use std::sync::Arc;

use tauri::Emitter;

use crate::config::SFTP_LIST_CHUNK_SIZE;
use crate::models::{
    AppError, FileEntry, FileInfo, FolderListChunk, FolderListDone, FolderListError,
    TransferProgress,
};
use crate::ssh::SshState;

macro_rules! sftp_op {
    ($state:expr, |$bundle:ident| $body:expr) => {{
        let ssh = Arc::clone(&$state.inner);
        tauri::async_runtime::spawn_blocking(move || {
            let mut guard = ssh
                .lock()
                .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
            let $bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;
            $body
        })
        .await
        .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
    }};
}

#[tauri::command]
pub async fn stat_path(state: tauri::State<'_, SshState>, path: String) -> Result<bool, AppError> {
    sftp_op!(state, |bundle| bundle.path_exists(&path))
}

#[tauri::command]
pub async fn list_folder(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<Vec<FileEntry>, AppError> {
    sftp_op!(state, |bundle| bundle.list_dir(&path))
}

#[tauri::command]
pub async fn list_folder_stream(
    state: tauri::State<'_, SshState>,
    app: tauri::AppHandle,
    path: String,
    list_id: String,
) -> Result<(), AppError> {
    {
        let mut cancelled = state
            .cancelled_lists
            .lock()
            .map_err(|_| AppError::internal("mutex poisoned"))?;
        cancelled.remove(&list_id);
    }

    let ssh = Arc::clone(&state.inner);
    let cancelled_lists = Arc::clone(&state.cancelled_lists);
    let cancelled_lists3 = Arc::clone(&cancelled_lists);
    let path2 = path.clone();
    let list_id2 = list_id.clone();
    let list_id4 = list_id.clone();
    let app2 = app.clone();

    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut guard = ssh
                .lock()
                .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
            let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

            let cancelled_lists2 = Arc::clone(&cancelled_lists);
            let list_id3 = list_id2.clone();
            let mut is_cancelled = move || {
                cancelled_lists2
                    .lock()
                    .ok()
                    .is_some_and(|s| s.contains(&list_id3))
            };

            let total = bundle.list_dir_stream(
                &path2,
                SFTP_LIST_CHUNK_SIZE,
                &mut is_cancelled,
                |entries, offset| {
                    let _ = app2.emit(
                        "folder-list-chunk",
                        FolderListChunk {
                            list_id: list_id2.clone(),
                            entries,
                            offset,
                        },
                    );
                },
            )?;

            Ok::<usize, AppError>(total)
        })
        .await;

        match result {
            Ok(Ok(total)) => {
                let was_cancelled = cancelled_lists3
                    .lock()
                    .ok()
                    .is_some_and(|s| s.contains(&list_id4));
                if was_cancelled {
                    let _ = cancelled_lists3.lock().map(|mut s| s.remove(&list_id4));
                    return;
                }
                let _ = app.emit("folder-list-done", FolderListDone { list_id, total });
            }
            Ok(Err(e)) => {
                let _ = app.emit(
                    "folder-list-error",
                    FolderListError {
                        list_id,
                        message: e.message,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "folder-list-error",
                    FolderListError {
                        list_id,
                        message: e.to_string(),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_folder_list(
    state: tauri::State<'_, SshState>,
    list_id: String,
) -> Result<(), AppError> {
    state
        .cancelled_lists
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?
        .insert(list_id);
    Ok(())
}

#[tauri::command]
pub async fn create_folder(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<(), AppError> {
    sftp_op!(state, |bundle| bundle.create_dir(&path))
}

#[tauri::command]
pub async fn rename_path(
    state: tauri::State<'_, SshState>,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    sftp_op!(state, |bundle| bundle.rename_entry(&old_path, &new_path))
}

#[tauri::command]
pub async fn delete_path(state: tauri::State<'_, SshState>, path: String) -> Result<(), AppError> {
    sftp_op!(state, |bundle| bundle.delete_entry(&path))
}

#[tauri::command]
pub async fn download_file(
    state: tauri::State<'_, SshState>,
    remote_path: String,
    local_path: String,
) -> Result<u64, AppError> {
    sftp_op!(state, |bundle| bundle.download(&remote_path, &local_path))
}

#[tauri::command]
pub async fn upload_file(
    state: tauri::State<'_, SshState>,
    local_path: String,
    remote_path: String,
) -> Result<u64, AppError> {
    sftp_op!(state, |bundle| bundle.upload(&local_path, &remote_path))
}

// ── Phase 6 — Queued transfers with progress ──────────────────────────────────

#[tauri::command]
pub async fn download_file_queued(
    state: tauri::State<'_, SshState>,
    app: tauri::AppHandle,
    transfer_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), AppError> {
    let ssh = Arc::clone(&state.inner);
    let cancelled = Arc::clone(&state.cancelled_transfers);

    tauri::async_runtime::spawn(async move {
        let ssh2 = Arc::clone(&ssh);
        let cancelled2 = Arc::clone(&cancelled);
        let tid = transfer_id.clone();
        let app2 = app.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut guard = ssh2
                .lock()
                .map_err(|_| AppError::internal("mutex poisoned"))?;
            let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

            let tid_inner = tid.clone();
            let app_inner = app2.clone();

            bundle.download_with_progress(
                &remote_path,
                &local_path,
                &cancelled2,
                &tid,
                move |transferred, total| {
                    let _ = app_inner.emit(
                        "transfer-progress",
                        TransferProgress {
                            id: tid_inner.clone(),
                            transferred,
                            total,
                            finished: false,
                            error: None,
                        },
                    );
                },
            )
        })
        .await;

        let err_msg = match result {
            Ok(Ok(_)) => None,
            Ok(Err(e)) => Some(e.message),
            Err(e) => Some(e.to_string()),
        };

        let _ = app.emit(
            "transfer-progress",
            TransferProgress {
                id: transfer_id,
                transferred: 0,
                total: 0,
                finished: true,
                error: err_msg,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn upload_file_queued(
    state: tauri::State<'_, SshState>,
    app: tauri::AppHandle,
    transfer_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), AppError> {
    let ssh = Arc::clone(&state.inner);
    let cancelled = Arc::clone(&state.cancelled_transfers);

    tauri::async_runtime::spawn(async move {
        let ssh2 = Arc::clone(&ssh);
        let cancelled2 = Arc::clone(&cancelled);
        let tid = transfer_id.clone();
        let app2 = app.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            let mut guard = ssh2
                .lock()
                .map_err(|_| AppError::internal("mutex poisoned"))?;
            let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

            let tid_inner = tid.clone();
            let app_inner = app2.clone();

            bundle.upload_with_progress(
                &local_path,
                &remote_path,
                &cancelled2,
                &tid,
                move |transferred, total| {
                    let _ = app_inner.emit(
                        "transfer-progress",
                        TransferProgress {
                            id: tid_inner.clone(),
                            transferred,
                            total,
                            finished: false,
                            error: None,
                        },
                    );
                },
            )
        })
        .await;

        let err_msg = match result {
            Ok(Ok(_)) => None,
            Ok(Err(e)) => Some(e.message),
            Err(e) => Some(e.to_string()),
        };

        let _ = app.emit(
            "transfer-progress",
            TransferProgress {
                id: transfer_id,
                transferred: 0,
                total: 0,
                finished: true,
                error: err_msg,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_transfer(
    state: tauri::State<'_, SshState>,
    transfer_id: String,
) -> Result<(), AppError> {
    state
        .cancelled_transfers
        .lock()
        .map_err(|_| AppError::internal("mutex poisoned"))?
        .insert(transfer_id);
    Ok(())
}

// ── Phase 7 — File detail ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_file_info(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<FileInfo, AppError> {
    sftp_op!(state, |bundle| bundle.get_file_info(&path))
}

#[tauri::command]
pub async fn chmod_file(
    state: tauri::State<'_, SshState>,
    path: String,
    perm_bits: u32,
) -> Result<(), AppError> {
    sftp_op!(state, |bundle| bundle.chmod_file(&path, perm_bits))
}

#[tauri::command]
pub async fn read_file_preview(
    state: tauri::State<'_, SshState>,
    path: String,
    max_bytes: usize,
) -> Result<String, AppError> {
    sftp_op!(state, |bundle| bundle.read_file_preview(&path, max_bytes))
}

#[tauri::command]
pub async fn read_file_preview_tail(
    state: tauri::State<'_, SshState>,
    path: String,
    max_bytes: usize,
) -> Result<String, AppError> {
    sftp_op!(state, |bundle| bundle
        .read_file_preview_tail(&path, max_bytes))
}

/// Overwrite a remote file with the given UTF-8 text content. Used by the
/// preview modal's "Save" button after inline editing.
#[tauri::command]
pub async fn write_file_text(
    state: tauri::State<'_, SshState>,
    path: String,
    content: String,
) -> Result<(), AppError> {
    sftp_op!(state, |bundle| bundle.write_file_text(&path, &content))
}

/// Recursively sum the sizes of everything under `path`. Best-effort — a
/// subtree that can't be read (perm denied, symlink cycle) contributes 0.
#[tauri::command]
pub async fn compute_folder_size(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<u64, AppError> {
    sftp_op!(state, |bundle| bundle.compute_folder_size(&path))
}
