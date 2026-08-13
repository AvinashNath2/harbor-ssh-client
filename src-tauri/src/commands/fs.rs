use std::sync::Arc;

use tauri::Emitter;

use crate::config::SFTP_LIST_CHUNK_SIZE;
use crate::models::{
    AppError, FileEntry, FileInfo, FolderListChunk, FolderListDone, FolderListError,
    TransferProgress,
};
use crate::ssh::SshState;

const SUDO_RC_MARKER: &str = "__HARBORSCP_SUDO_RC__=";

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

/// Batch-probe whether the connected user can delete each of the given paths.
/// "Can delete" == write permission on the parent directory (which is what the
/// `rm`/`unlink` syscall actually cares about, regardless of the file's own
/// mode). Groups by unique parent dir so we don't run duplicate `test` calls
/// when many paths share the same folder.
///
/// Returns a same-length vector of bools aligned with the input paths.
/// A probe failure (e.g. parent doesn't exist) is reported as `false`.
#[tauri::command]
pub async fn check_writable(
    state: tauri::State<'_, SshState>,
    paths: Vec<String>,
) -> Result<Vec<bool>, AppError> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        // Collect unique parent directories to probe.
        let parents: std::collections::BTreeSet<String> = paths
            .iter()
            .map(|p| parent_of(p).to_string())
            .collect();

        // Build one shell command that emits `Y <parent>` or `N <parent>` per
        // line. We escape single quotes to survive the outer sh -c wrap.
        let mut cmd = String::from("(");
        for (i, parent) in parents.iter().enumerate() {
            if i > 0 {
                cmd.push_str("; ");
            }
            let escaped = parent.replace('\'', "'\\''");
            // Note: emit the raw path AFTER the Y/N marker with a single space
            // — parents may contain arbitrary characters but never a newline.
            cmd.push_str(&format!(
                "if [ -w '{escaped}' ]; then printf 'Y %s\\n' '{escaped}'; else printf 'N %s\\n' '{escaped}'; fi"
            ));
        }
        cmd.push_str(") 2>/dev/null");

        // Route through the CONTROL channel so this probe isn't blocked by any
        // long-running scan on the primary channel.
        let output = bundle.exec_control(&cmd).unwrap_or_default();

        let mut writable_parents = std::collections::HashSet::new();
        for line in output.lines() {
            if let Some(rest) = line.strip_prefix("Y ") {
                writable_parents.insert(rest.to_string());
            }
        }

        Ok(paths
            .iter()
            .map(|p| writable_parents.contains(parent_of(p)))
            .collect())
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// Delete a path via `sudo -n rm -rf -- <path>` on the control channel.
///
/// `-n` (non-interactive) means sudo fails immediately if a password would be
/// prompted, so the caller sees a clean error rather than a hung SSH channel.
/// `--` guards against paths that start with `-`. `rm -rf` handles files and
/// directories uniformly.
///
/// Runs on the CONTROL channel so it doesn't compete with a running scan.
///
/// The remote command wraps the real `sudo rm` and prints a sentinel marker
/// with the exit code because `channel_session` returns the merged stdout+
/// stderr as `Ok(String)` regardless of exit code — we can't rely on the
/// Result to signal failure.
#[tauri::command]
pub async fn delete_path_sudo(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<(), AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let escaped = path.replace('\'', "'\\''");
        let cmd = format!(
            "OUT=$(sudo -n rm -rf -- '{escaped}' 2>&1); RC=$?; printf '%s\\n{SUDO_RC_MARKER}%d' \"$OUT\" \"$RC\""
        );
        let raw = bundle
            .exec_control(&cmd)
            .map_err(|e| AppError::permission_denied(e.to_string()))?;

        // Split off the trailing rc marker.
        let (body, rc_str) = match raw.rfind(SUDO_RC_MARKER) {
            Some(idx) => (&raw[..idx], &raw[idx + SUDO_RC_MARKER.len()..]),
            None => {
                return Err(AppError::internal(format!(
                    "sudo delete: no rc marker in output: {raw}"
                )));
            }
        };
        let rc: i32 = rc_str.trim().parse().unwrap_or(-1);
        if rc == 0 {
            return Ok(());
        }

        // Non-zero — translate common sudo failure modes into human-readable
        // messages. `body` is what sudo/rm wrote to stderr.
        let trimmed = body.trim();
        let msg = if trimmed.contains("password is required")
            || trimmed.contains("a password is required")
        {
            "sudo requires a password on this server — passwordless sudo is not configured for this user".to_string()
        } else if trimmed.contains("no tty present") || trimmed.contains("a terminal is required") {
            "sudo requires a terminal on this server (defaults requiretty is enabled)".to_string()
        } else if trimmed.contains("not allowed to execute") || trimmed.contains("not in the sudoers") {
            "user is not permitted to run sudo on this server".to_string()
        } else if trimmed.is_empty() {
            format!("sudo rm exited {rc} (no stderr)")
        } else {
            trimmed.to_string()
        };
        Err(AppError::permission_denied(msg))
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// POSIX-y parent extraction: same rules as `dirname(1)`. Used only for
/// grouping in `check_writable`, so exotic edge cases don't matter — the
/// worst outcome is a false negative that shows the "may need sudo" warning
/// when it wasn't strictly needed.
fn parent_of(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/";
    }
    match trimmed.rfind('/') {
        Some(0) => "/",
        Some(i) => &trimmed[..i],
        None => ".",
    }
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
