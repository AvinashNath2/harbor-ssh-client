//! Application-wide constants — all magic numbers live here.

// ── SSH timeouts ──────────────────────────────────────────────────────────────
pub const SSH_CONNECT_TIMEOUT_SECS: u64 = 10;
pub const SSH_READ_TIMEOUT_SECS: u64 = 30;
pub const SSH_KEEPALIVE_INTERVAL_SECS: u32 = 30;

// ── SFTP buffers ──────────────────────────────────────────────────────────────
pub const SFTP_TRANSFER_BUF_SIZE: usize = 65_536; // 64 KB — download/upload chunk
pub const SFTP_PREVIEW_CAP_BYTES: usize = 131_072; // 128 KB — max file preview read

// ── PTY / terminal ────────────────────────────────────────────────────────────
pub const PTY_TERM_TYPE: &str = "xterm-256color";
pub const PTY_INITIAL_COLS: u32 = 120;
pub const PTY_INITIAL_ROWS: u32 = 40;
pub const PTY_READ_BUF_SIZE: usize = 4_096;

// ── Port forward relay ────────────────────────────────────────────────────────
pub const PORT_FORWARD_BUF_SIZE: usize = 8_192;
pub const PORT_FORWARD_POLL_MS: u64 = 50;

// ── SFTP directory listing ────────────────────────────────────────────────────
pub const SFTP_LIST_CHUNK_SIZE: usize = 500;

// ── Terminal timing ───────────────────────────────────────────────────────────
pub const TERMINAL_STARTUP_DELAY_MS: u64 = 400;
pub const TERMINAL_IDLE_MAX_BACKOFF_MS: u64 = 16;
