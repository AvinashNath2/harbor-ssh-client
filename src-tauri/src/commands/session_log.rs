use crate::db::Db;

// ── Data models ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub host: String,
    pub ip: String,
    pub username: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub cmd_count: i64,
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub id: String,
    pub session_id: String,
    pub idx: i64,
    pub executed_at: i64,
    pub cwd: String,
    pub raw: String,
    pub exit_code: Option<i64>,
    pub duration_ms: Option<i64>,
    pub output: Option<String>,
    pub output_truncated: bool,
    pub original_output_bytes: i64,
    pub source: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWithCommands {
    #[serde(flatten)]
    pub session: SessionRecord,
    pub commands: Vec<CommandRecord>,
}

// ── Tiny ID generator (no external crate needed) ──────────────────────────────

fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:x}{:x}", epoch, nanos)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_session(
    state: tauri::State<'_, Db>,
    host: String,
    ip: String,
    username: String,
    profile_id: Option<String>,
    profile_name: Option<String>,
) -> Result<String, String> {
    let id = new_id();
    let started_at = now_ms();
    state
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "INSERT INTO sessions (id, host, ip, username, started_at, profile_id, profile_name)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![id, host, ip, username, started_at, profile_id, profile_name],
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn close_session(
    state: tauri::State<'_, Db>,
    session_id: String,
    ended_at: i64,
) -> Result<(), String> {
    state
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "UPDATE sessions SET ended_at=?1 WHERE id=?2",
            rusqlite::params![ended_at, session_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn append_command(
    state: tauri::State<'_, Db>,
    session_id: String,
    idx: i64,
    executed_at: i64,
    cwd: String,
    raw: String,
    exit_code: Option<i64>,
    duration_ms: Option<i64>,
    output: Option<String>,
    output_truncated: bool,
    original_output_bytes: i64,
    source: Option<String>,
) -> Result<(), String> {
    let id = new_id();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO commands
         (id,session_id,idx,executed_at,cwd,raw,exit_code,duration_ms,output,output_truncated,original_output_bytes,source)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        rusqlite::params![
            id, session_id, idx, executed_at, cwd, raw,
            exit_code, duration_ms, output,
            output_truncated as i64, original_output_bytes,
            source
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sessions SET cmd_count=cmd_count+1 WHERE id=?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_sessions(state: tauri::State<'_, Db>) -> Result<Vec<SessionRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id,host,ip,username,started_at,ended_at,cmd_count,profile_id,profile_name
             FROM sessions ORDER BY started_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                host: row.get(1)?,
                ip: row.get(2)?,
                username: row.get(3)?,
                started_at: row.get(4)?,
                ended_at: row.get(5)?,
                cmd_count: row.get(6)?,
                profile_id: row.get(7)?,
                profile_name: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_session(
    state: tauri::State<'_, Db>,
    session_id: String,
) -> Result<SessionWithCommands, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let session = conn
        .query_row(
            "SELECT id,host,ip,username,started_at,ended_at,cmd_count,profile_id,profile_name
             FROM sessions WHERE id=?1",
            rusqlite::params![session_id],
            |row| {
                Ok(SessionRecord {
                    id: row.get(0)?,
                    host: row.get(1)?,
                    ip: row.get(2)?,
                    username: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                    cmd_count: row.get(6)?,
                    profile_id: row.get(7)?,
                    profile_name: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id,session_id,idx,executed_at,cwd,raw,exit_code,duration_ms,
                    output,output_truncated,original_output_bytes,source
             FROM commands WHERE session_id=?1 ORDER BY idx ASC",
        )
        .map_err(|e| e.to_string())?;

    let commands = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(CommandRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                idx: row.get(2)?,
                executed_at: row.get(3)?,
                cwd: row.get(4)?,
                raw: row.get(5)?,
                exit_code: row.get(6)?,
                duration_ms: row.get(7)?,
                output: row.get(8)?,
                output_truncated: {
                    let v: i64 = row.get(9)?;
                    v != 0
                },
                original_output_bytes: row.get(10)?,
                source: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(SessionWithCommands { session, commands })
}

#[tauri::command]
pub fn delete_session(
    state: tauri::State<'_, Db>,
    session_id: String,
) -> Result<(), String> {
    state
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "DELETE FROM sessions WHERE id=?1",
            rusqlite::params![session_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_sessions_before(
    state: tauri::State<'_, Db>,
    before_ms: i64,
) -> Result<(), String> {
    state
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "DELETE FROM sessions WHERE started_at<?1 AND ended_at IS NOT NULL",
            rusqlite::params![before_ms],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
