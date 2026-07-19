use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn open(app_data_dir: PathBuf) -> rusqlite::Result<Self> {
        std::fs::create_dir_all(&app_data_dir).ok();
        let conn = Connection::open(app_data_dir.join("sessions.db"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS sessions (
               id           TEXT PRIMARY KEY,
               host         TEXT NOT NULL,
               ip           TEXT NOT NULL,
               username     TEXT NOT NULL,
               started_at   INTEGER NOT NULL,
               ended_at     INTEGER,
               cmd_count    INTEGER NOT NULL DEFAULT 0,
               profile_id   TEXT,
               profile_name TEXT
             );
             CREATE TABLE IF NOT EXISTS commands (
               id                    TEXT PRIMARY KEY,
               session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
               idx                   INTEGER NOT NULL,
               executed_at           INTEGER NOT NULL,
               cwd                   TEXT NOT NULL,
               raw                   TEXT NOT NULL,
               exit_code             INTEGER,
               duration_ms           INTEGER,
               output                TEXT,
               output_truncated      INTEGER NOT NULL DEFAULT 0,
               original_output_bytes INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(started_at DESC);
             CREATE INDEX IF NOT EXISTS idx_cmds_sess ON commands(session_id, idx);",
        )?;
        // Migrate existing DBs that were created before profile columns were added.
        let has_profile: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='profile_name'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if has_profile == 0 {
            conn.execute_batch(
                "ALTER TABLE sessions ADD COLUMN profile_id TEXT;
                 ALTER TABLE sessions ADD COLUMN profile_name TEXT;",
            )?;
        }

        // Migrate commands table to add source column.
        let has_source: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('commands') WHERE name='source'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if has_source == 0 {
            conn.execute_batch("ALTER TABLE commands ADD COLUMN source TEXT;")?;
        }

        // Close orphaned sessions from previous runs (app was killed/crashed before cleanup ran).
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "UPDATE sessions SET ended_at = ?1 WHERE ended_at IS NULL",
            rusqlite::params![now_ms],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}
