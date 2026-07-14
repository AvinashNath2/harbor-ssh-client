use std::path::PathBuf;

use tauri::Manager;

use crate::models::{AppError, ConnectionProfile};

fn profiles_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::internal(e.to_string()))?;
    Ok(dir.join("connections.json"))
}

fn read_all(path: &PathBuf) -> Result<Vec<ConnectionProfile>, AppError> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = std::fs::read_to_string(path).map_err(|e| AppError::internal(e.to_string()))?;
    serde_json::from_str(&json).map_err(|e| AppError::internal(e.to_string()))
}

fn write_all(path: &PathBuf, profiles: &[ConnectionProfile]) -> Result<(), AppError> {
    let json =
        serde_json::to_string_pretty(profiles).map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::write(path, json).map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ConnectionProfile>, AppError> {
    read_all(&profiles_path(&app)?)
}

#[tauri::command]
pub fn save_profile(app: tauri::AppHandle, profile: ConnectionProfile) -> Result<(), AppError> {
    let path = profiles_path(&app)?;
    let mut profiles = read_all(&path)?;
    match profiles.iter().position(|p| p.id == profile.id) {
        Some(idx) => profiles[idx] = profile,
        None => profiles.push(profile),
    }
    write_all(&path, &profiles)
}

#[tauri::command]
pub fn delete_profile(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    let path = profiles_path(&app)?;
    let mut profiles = read_all(&path)?;
    profiles.retain(|p| p.id != id);
    write_all(&path, &profiles)
}
