use tauri_plugin_dialog::DialogExt;

use crate::models::{AppError, LocalFileEntry};

#[tauri::command]
pub fn get_local_home() -> Result<String, AppError> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| AppError::internal("Cannot determine home directory"))
}

#[tauri::command]
pub fn stat_local_path(path: String) -> Result<bool, AppError> {
    Ok(std::path::Path::new(&path).exists())
}

#[tauri::command]
pub fn list_local_folder(path: String) -> Result<Vec<LocalFileEntry>, AppError> {
    let iter = std::fs::read_dir(&path)
        .map_err(|e| AppError::internal(format!("Cannot read directory: {e}")))?;

    let mut entries: Vec<LocalFileEntry> = iter
        .filter_map(|r| r.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let path = e.path().to_string_lossy().into_owned();
            let meta = e.metadata().ok();
            let kind = match &meta {
                Some(m) if m.is_dir() => "directory",
                Some(m) if m.is_symlink() => "symlink",
                _ => "file",
            };
            let size = meta.as_ref().filter(|m| m.is_file()).map(|m| m.len());
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            LocalFileEntry {
                name,
                path,
                kind: kind.to_owned(),
                size,
                modified,
            }
        })
        .collect();

    entries.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
        ("directory", "directory") => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        ("directory", _) => std::cmp::Ordering::Less,
        (_, "directory") => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub fn rename_local_path(old_path: String, new_name: String) -> Result<(), AppError> {
    let old = std::path::Path::new(&old_path);
    let parent = old
        .parent()
        .ok_or_else(|| AppError::internal("Cannot determine parent directory"))?;
    let new = parent.join(&new_name);
    std::fs::rename(old, &new).map_err(|e| AppError::internal(format!("Failed to rename: {e}")))
}

#[tauri::command]
pub fn delete_local_path(path: String) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p)
            .map_err(|e| AppError::internal(format!("Failed to delete directory: {e}")))
    } else {
        std::fs::remove_file(p)
            .map_err(|e| AppError::internal(format!("Failed to delete file: {e}")))
    }
}

#[tauri::command]
pub async fn export_profiles_json(json: String, app: tauri::AppHandle) -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let file_path = app
            .dialog()
            .file()
            .set_file_name("harbor-connections.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file();

        match file_path {
            Some(fp) => {
                let path = fp
                    .into_path()
                    .map_err(|e| AppError::internal(format!("Invalid path: {e}")))?;
                std::fs::write(&path, json.as_bytes())
                    .map_err(|e| AppError::internal(format!("Failed to write file: {e}")))?;
                Ok(true)
            }
            None => Ok(false),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn import_profiles_json(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let file_path = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file();

        match file_path {
            Some(fp) => {
                let path = fp
                    .into_path()
                    .map_err(|e| AppError::internal(format!("Invalid path: {e}")))?;
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| AppError::internal(format!("Failed to read file: {e}")))?;
                Ok(Some(content))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("task join error: {e}")))?
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal in Finder: {e}")))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal in Explorer: {e}")))?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .unwrap_or(std::path::Path::new("/"));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal in file manager: {e}")))?;
    }
    Ok(())
}
