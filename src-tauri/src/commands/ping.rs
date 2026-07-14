use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PingResponse {
    pub message: String,
    pub version: String,
}

/// Phase-0 smoke-test: proves the Rust↔Frontend IPC bridge is wired correctly.
#[tauri::command]
pub fn ping() -> PingResponse {
    PingResponse {
        message: String::from("pong"),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
