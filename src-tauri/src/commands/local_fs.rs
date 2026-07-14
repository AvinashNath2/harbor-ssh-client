use crate::models::{AppError, LocalFileEntry};

#[tauri::command]
pub fn get_local_home() -> Result<String, AppError> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| AppError::internal("Cannot determine home directory"))
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
