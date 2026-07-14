#![allow(dead_code)] // variants and helpers added for Phase 2+

use serde::{Deserialize, Serialize};

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    ConnectionFailed,
    AuthFailed,
    NotConnected,
    PermissionDenied,
    TransferError,
    Internal,
}

impl AppError {
    pub fn connection_failed(msg: impl Into<String>) -> Self {
        AppError {
            code: ErrorCode::ConnectionFailed,
            message: msg.into(),
        }
    }

    pub fn auth_failed(msg: impl Into<String>) -> Self {
        AppError {
            code: ErrorCode::AuthFailed,
            message: msg.into(),
        }
    }

    pub fn not_connected() -> Self {
        AppError {
            code: ErrorCode::NotConnected,
            message: "No active SSH session".into(),
        }
    }

    pub fn permission_denied(msg: impl Into<String>) -> Self {
        AppError {
            code: ErrorCode::PermissionDenied,
            message: msg.into(),
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        AppError {
            code: ErrorCode::Internal,
            message: msg.into(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<ssh2::Error> for AppError {
    fn from(e: ssh2::Error) -> Self {
        let msg = e.message().to_owned();
        match e.code() {
            ssh2::ErrorCode::Session(-18) => AppError::auth_failed(msg),
            _ => AppError::connection_failed(msg),
        }
    }
}

// ── Auth method (sent from JS) ────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum AuthMethod {
    #[serde(rename = "password")]
    Password { password: String },

    #[serde(rename = "publicKey")]
    PublicKey {
        key_path: String,
        passphrase: Option<String>,
    },
}

/// Credentials cached after a successful connect so the terminal can open its own session.
#[derive(Debug, Clone)]
pub struct StoredCreds {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
}

// ── Transfer events ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: String,
    pub transferred: u64,
    pub total: u64,
    pub finished: bool,
    pub error: Option<String>,
}

// ── Local filesystem (Phase 4) ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

// ── File detail (Phase 7) ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    pub permissions: Option<String>,
    pub perm_octal: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

// ── Connection result types ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub whoami: String,
    pub home_dir: String,
    pub os_info: String,
    pub ip_addr: String,
}

#[derive(Debug, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub host: Option<String>,
    pub username: Option<String>,
}

// ── Connection profiles ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProfileAuthType {
    Password,
    PublicKey,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: ProfileAuthType,
    pub key_path: Option<String>,
    pub folder: Option<String>,
    pub favorite: Option<bool>,
    pub last_connected: Option<u64>,
}

// ── Filesystem types (Phase 2) ────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    File,
    Directory,
    Symlink,
    Other,
}

impl FileKind {
    /// Derive kind from the Unix permission bits stored in FileStat.perm.
    pub fn from_perm(perm: Option<u32>) -> Self {
        match perm.map(|p| p & 0o170000) {
            Some(0o040000) => FileKind::Directory,
            Some(0o100000) => FileKind::File,
            Some(0o120000) => FileKind::Symlink,
            _ => FileKind::Other,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: Option<u64>,
    pub permissions: Option<String>,
    /// Unix timestamp (seconds since epoch). Sent as-is; JS converts to a date.
    pub modified: Option<u64>,
}

/// Format Unix permission bits as a ls-style string, e.g. `drwxr-xr-x`.
pub fn format_permissions(perm: u32) -> String {
    let type_char = match perm & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        _ => '-',
    };
    let bits: String = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ]
    .iter()
    .map(|(mask, ch)| if perm & mask != 0 { *ch } else { '-' })
    .collect();
    format!("{type_char}{bits}")
}
