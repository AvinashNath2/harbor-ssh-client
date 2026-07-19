use tauri::State;

use crate::db::Db;
use crate::models::AppError;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub name: String,
    pub local_path: String,
    pub remote_path: String,
    pub downloaded_at: i64,
    pub file_size: i64,
    /// false when the file no longer exists on disk
    pub available: bool,
}

#[tauri::command]
pub fn save_download(
    db: State<'_, Db>,
    id: String,
    name: String,
    local_path: String,
    remote_path: String,
    file_size: i64,
) -> Result<(), AppError> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::internal("db mutex poisoned"))?;
    conn.execute(
        "INSERT OR REPLACE INTO downloads (id, name, local_path, remote_path, downloaded_at, file_size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, name, local_path, remote_path, now_ms, file_size],
    )
    .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn list_downloads(db: State<'_, Db>) -> Result<Vec<DownloadRecord>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::internal("db mutex poisoned"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, local_path, remote_path, downloaded_at, file_size
             FROM downloads ORDER BY downloaded_at DESC",
        )
        .map_err(|e| AppError::internal(e.to_string()))?;

    let rows = stmt
        .query_map([], |row| {
            let local_path: String = row.get(2)?;
            Ok(DownloadRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                local_path: local_path.clone(),
                remote_path: row.get(3)?,
                downloaded_at: row.get(4)?,
                file_size: row.get(5)?,
                available: std::path::Path::new(&local_path).exists(),
            })
        })
        .map_err(|e| AppError::internal(e.to_string()))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub fn delete_download(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::internal("db mutex poisoned"))?;
    conn.execute("DELETE FROM downloads WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn clear_download_history(db: State<'_, Db>) -> Result<(), AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|_| AppError::internal("db mutex poisoned"))?;
    conn.execute("DELETE FROM downloads", [])
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(())
}
