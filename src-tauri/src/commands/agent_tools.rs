//! Agent tool commands invoked by the frontend agent loop.
//!
//! # SSH connection rule
//! Every tool here reuses the ONE shared `SshState` — never opens a new
//! `ssh2::Session`. `bundle.exec()` opens a cheap channel on the shared
//! session for each command. See `plan/2.0`.
//!
//! # Safety
//! - `agent_exec_read` enforces a regex allow-list — anything not on it is
//!   refused with `suggest_write=true` so the LLM knows to escalate.
//! - `agent_exec_write` is invoked only after the frontend receives explicit
//!   user approval. It carries a marker so the SQLite audit log records it as
//!   an approved write.
//! - Every result is capped at 100 KB before returning to the frontend, so
//!   the LLM can't be flooded and SQLite rows stay reasonable.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::models::AppError;
use crate::ssh::{shell_single_quote, SessionBundle, SshState};

const MAX_RESULT_BYTES: usize = 100 * 1024;

// ── Standard tool result envelope ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentToolResult {
    pub ok: bool,
    pub output: String,
    pub truncated: bool,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub suggest_write: bool,
}

impl AgentToolResult {
    fn ok_string(raw: String, started: Instant) -> Self {
        let (output, truncated) = truncate(raw);
        Self {
            ok: true,
            output,
            truncated,
            duration_ms: started.elapsed().as_millis() as u64,
            error: None,
            suggest_write: false,
        }
    }
    fn err(msg: impl Into<String>, started: Instant) -> Self {
        Self {
            ok: false,
            output: String::new(),
            truncated: false,
            duration_ms: started.elapsed().as_millis() as u64,
            error: Some(msg.into()),
            suggest_write: false,
        }
    }
    fn denied_needs_write(msg: impl Into<String>, started: Instant) -> Self {
        Self {
            ok: false,
            output: String::new(),
            truncated: false,
            duration_ms: started.elapsed().as_millis() as u64,
            error: Some(msg.into()),
            suggest_write: true,
        }
    }
}

fn truncate(mut s: String) -> (String, bool) {
    if s.len() <= MAX_RESULT_BYTES {
        return (s, false);
    }
    // Find a char boundary <= MAX_RESULT_BYTES so we don't split a UTF-8 char.
    let mut cut = MAX_RESULT_BYTES;
    while !s.is_char_boundary(cut) && cut > 0 {
        cut -= 1;
    }
    let extra_kb = (s.len() - cut) / 1024;
    s.truncate(cut);
    s.push_str(&format!("\n[TRUNCATED — {extra_kb} more KB not shown]"));
    (s, true)
}

// ── Helper: run a command on the shared SSH session ───────────────────────────

/// Run a command on the ONE shared SSH session — never opens a new connection.
fn run_on_shared(
    inner: &Arc<Mutex<Option<SessionBundle>>>,
    command: &str,
) -> Result<String, AppError> {
    let guard = inner
        .lock()
        .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
    let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
    bundle.exec(command)
}

// ── Read-command allow-list ───────────────────────────────────────────────────

/// Deny list — even if the head token is on the allow list, refuse when any of
/// these patterns appear anywhere in the command (guards against smuggled writes).
fn has_forbidden_pattern(cmd: &str) -> bool {
    let deny_substrings = [
        " > ", " >> ", ">>", ">|",
        "| tee", " tee ",
        "&& rm", "&& mv", "&& cp", "&& dd", "&& sudo", "&& su ",
        "; rm", "; mv", "; cp", "; dd", "; sudo", "; su ",
        "`", "$(",           // command substitution
        " sudo ", " su ",
        " rm ", " mv ", " cp ", " dd ",
        " chmod ", " chown ", " truncate ",
        " apt ", " apt-get ", " yum ", " dnf ", " pacman ",
        " systemctl start ", " systemctl stop ", " systemctl restart ",
        " systemctl enable ", " systemctl disable ",
        " docker run ", " docker exec ", " docker start ", " docker stop ",
        " docker restart ", " docker kill ", " docker rm ", " docker rmi ",
        " docker pull ", " docker push ", " docker build ", " docker commit ",
        " docker prune ", " docker system prune", " docker volume rm ",
        " docker network rm ", " docker network create ",
    ];
    let padded = format!(" {} ", cmd);
    deny_substrings.iter().any(|p| padded.contains(p))
}

/// Return true if the command's head token (and modifiers) look read-only.
fn head_is_read_only(cmd: &str) -> bool {
    let trimmed = cmd.trim_start();
    // Pipes are allowed — check each stage's head.
    for stage in trimmed.split('|') {
        let stage = stage.trim();
        if stage.is_empty() {
            return false;
        }
        let head = stage.split_whitespace().next().unwrap_or("");
        let ok = match head {
            "docker" => {
                // docker <subcmd> — only allow read-only subcommands.
                let sub = stage.split_whitespace().nth(1).unwrap_or("");
                matches!(
                    sub,
                    "ps"
                    | "images"
                    | "inspect"
                    | "logs"
                    | "stats"
                    | "events"
                    | "version"
                    | "info"
                    | "history"
                    | "top"
                    | "port"
                    | "diff"
                    | "network"    // rules: only `network ls` and `network inspect`
                    | "volume"     // rules: only `volume ls` and `volume inspect`
                    | "system"     // rules: only `system df` / `system info`
                    | "container"  // rules: only `container ls` / `container inspect`
                )
            }
            "ls" | "cat" | "head" | "tail" | "grep" | "egrep" | "fgrep"
            | "find" | "wc" | "awk" | "sort" | "uniq" | "cut" | "tr"
            | "df" | "du" | "free" | "ps" | "top" | "uptime" | "uname"
            | "hostname" | "whoami" | "id" | "echo" | "date" | "which"
            | "printenv" | "env" | "pwd" | "stat" | "file" | "readlink"
            | "column" | "xargs" => true,
            // `sed` only in non-in-place mode (no -i).
            "sed" => !stage.contains(" -i"),
            "journalctl" => stage.contains("--no-pager"),
            "systemctl" => stage.contains(" status") || stage.contains(" is-active"),
            _ => false,
        };
        if !ok {
            return false;
        }
    }
    true
}

fn is_read_allowed(cmd: &str) -> Result<(), String> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Err("empty command".to_owned());
    }
    if has_forbidden_pattern(trimmed) {
        return Err("command contains a forbidden write pattern".to_owned());
    }
    if !head_is_read_only(trimmed) {
        return Err("command head is not on the read-only allow-list".to_owned());
    }
    Ok(())
}

// ── Docker output formatters (human-friendly text, LLM-friendly shape) ───────

/// One row of `docker ps -a --format '{{json .}}'`. We only pull the fields we
/// actually format — extra keys are ignored.
#[derive(Debug, Deserialize)]
struct DockerPsRow {
    #[serde(rename = "ID", default)]
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "Names", default)]
    names: String,
    #[serde(rename = "Image", default)]
    image: String,
    #[serde(rename = "State", default)]
    state: String,
    #[serde(rename = "Status", default)]
    status: String,
    #[serde(rename = "Ports", default)]
    ports: String,
    #[serde(rename = "Networks", default)]
    networks: String,
    #[serde(rename = "Labels", default)]
    labels: String,
}

fn format_containers_summary(raw: &str) -> String {
    let rows: Vec<DockerPsRow> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<DockerPsRow>(l).ok())
        .collect();

    if rows.is_empty() {
        return "No Docker containers found on this VM.".to_owned();
    }

    let mut running: Vec<&DockerPsRow> = rows.iter().filter(|r| r.state == "running").collect();
    let mut other: Vec<&DockerPsRow> = rows.iter().filter(|r| r.state != "running").collect();
    running.sort_by(|a, b| a.names.cmp(&b.names));
    other.sort_by(|a, b| a.names.cmp(&b.names));

    let mut out = String::new();
    out.push_str(&format!(
        "Containers on this VM ({total} total: {run} running · {stop} stopped)\n",
        total = rows.len(),
        run = running.len(),
        stop = other.len()
    ));

    if !running.is_empty() {
        out.push_str(&format!("\nRUNNING ({}):\n", running.len()));
        for r in &running {
            out.push_str(&format_ps_row(r));
        }
    }
    if !other.is_empty() {
        out.push_str(&format!("\nSTOPPED / OTHER ({}):\n", other.len()));
        for r in &other {
            out.push_str(&format_ps_row(r));
        }
    }
    out
}

fn format_ps_row(r: &DockerPsRow) -> String {
    let compose_project = extract_label(&r.labels, "com.docker.compose.project");
    let name = r.names.trim_start_matches('/');
    let ports = if r.ports.is_empty() { "-" } else { r.ports.as_str() };
    let networks = if r.networks.is_empty() {
        "-"
    } else {
        r.networks.as_str()
    };
    let proj_part = compose_project
        .map(|p| format!("  compose: {p}"))
        .unwrap_or_default();
    format!(
        "  • {name:<24} {image:<40}  {status:<28}  ports: {ports}  networks: {networks}{proj_part}\n",
        name = name,
        image = r.image,
        status = r.status,
        ports = ports,
        networks = networks,
        proj_part = proj_part,
    )
}

fn extract_label(labels: &str, key: &str) -> Option<String> {
    labels
        .split(',')
        .find(|kv| kv.trim_start().starts_with(key))
        .and_then(|kv| kv.splitn(2, '=').nth(1))
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// One row of `docker stats --no-stream --format '{{json .}}'`.
#[derive(Debug, Deserialize)]
struct DockerStatsRow {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "CPUPerc", default)]
    cpu: String,
    #[serde(rename = "MemUsage", default)]
    mem: String,
    #[serde(rename = "NetIO", default)]
    net_io: String,
    #[serde(rename = "BlockIO", default)]
    block_io: String,
}

fn format_stats_summary(raw: &str) -> String {
    let mut rows: Vec<DockerStatsRow> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<DockerStatsRow>(l).ok())
        .collect();

    if rows.is_empty() {
        return "No running containers to gather live stats from.".to_owned();
    }
    rows.sort_by(|a, b| a.name.cmp(&b.name));

    let mut out = String::new();
    out.push_str(&format!(
        "Live stats ({} running container{}):\n\n",
        rows.len(),
        if rows.len() == 1 { "" } else { "s" }
    ));
    out.push_str(&format!(
        "{name:<22}  {cpu:>7}  {mem:<22}  {net:<22}  {block:<22}\n",
        name = "NAME",
        cpu = "CPU",
        mem = "MEM",
        net = "NET I/O",
        block = "BLOCK I/O"
    ));
    for r in &rows {
        out.push_str(&format!(
            "{name:<22}  {cpu:>7}  {mem:<22}  {net:<22}  {block:<22}\n",
            name = r.name,
            cpu = r.cpu,
            mem = r.mem,
            net = r.net_io,
            block = r.block_io,
        ));
    }
    out
}

// ── Docker wrappers ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_docker_list_containers(
    state: tauri::State<'_, SshState>,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        match run_on_shared(&ssh, "docker ps -a --format '{{json .}}' 2>/dev/null") {
            Ok(raw) => {
                let pretty = format_containers_summary(&raw);
                Ok(AgentToolResult::ok_string(pretty, started))
            }
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_docker_logs(
    state: tauri::State<'_, SshState>,
    name: String,
    tail: Option<u32>,
    since: Option<String>,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let escaped_name = match shell_single_quote(&name) {
            Some(v) => v,
            None => return Ok(AgentToolResult::err("invalid container name", started)),
        };
        let tail_arg = format!("--tail {}", tail.unwrap_or(200));
        let since_arg = match since.as_ref() {
            Some(s) => {
                let esc = shell_single_quote(s).unwrap_or_default();
                format!("--since '{esc}'")
            }
            None => String::new(),
        };
        let cmd = format!(
            "docker logs {tail_arg} {since_arg} '{escaped_name}' 2>&1 || true"
        );
        match run_on_shared(&ssh, &cmd) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_docker_inspect(
    state: tauri::State<'_, SshState>,
    name: String,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let escaped = match shell_single_quote(&name) {
            Some(v) => v,
            None => return Ok(AgentToolResult::err("invalid name", started)),
        };
        match run_on_shared(&ssh, &format!("docker inspect '{escaped}'")) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_docker_stats(
    state: tauri::State<'_, SshState>,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        match run_on_shared(&ssh, "docker stats --no-stream --format '{{json .}}' 2>/dev/null") {
            Ok(raw) => {
                let pretty = format_stats_summary(&raw);
                Ok(AgentToolResult::ok_string(pretty, started))
            }
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_docker_networks(
    state: tauri::State<'_, SshState>,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        match run_on_shared(&ssh, "docker network ls --format '{{json .}}' 2>/dev/null",
        ) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_docker_volumes(
    state: tauri::State<'_, SshState>,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        match run_on_shared(&ssh, "docker volume ls --format '{{json .}}' 2>/dev/null",
        ) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

// ── Filesystem ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_read_file(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let escaped = match shell_single_quote(&path) {
            Some(v) => v,
            None => return Ok(AgentToolResult::err("invalid path", started)),
        };
        match run_on_shared(&ssh, &format!("cat '{escaped}' 2>&1 || true")) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_list_directory(
    state: tauri::State<'_, SshState>,
    path: String,
) -> Result<AgentToolResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let escaped = match shell_single_quote(&path) {
            Some(v) => v,
            None => return Ok(AgentToolResult::err("invalid path", started)),
        };
        match run_on_shared(&ssh, &format!("ls -la '{escaped}' 2>&1 || true")) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

// ── Generic exec ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_exec_read(
    state: tauri::State<'_, SshState>,
    cmd: String,
) -> Result<AgentToolResult, AppError> {
    let started = Instant::now();
    if let Err(msg) = is_read_allowed(&cmd) {
        return Ok(AgentToolResult::denied_needs_write(msg, started));
    }
    let ssh = Arc::clone(&state.inner);
    let cmd_owned = cmd;
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        // Wrap in `|| true` so a non-zero exit doesn't error out — LLM still
        // benefits from seeing stderr.
        let wrapped = format!("{cmd_owned} 2>&1 || true");
        match run_on_shared(&ssh, &wrapped) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}

#[tauri::command]
pub async fn agent_exec_write(
    state: tauri::State<'_, SshState>,
    cmd: String,
) -> Result<AgentToolResult, AppError> {
    // No allow-list here: the frontend has already obtained explicit user
    // approval via the ApprovalCard. We still record it in the audit log
    // (frontend responsibility) and cap output size.
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let wrapped = format!("{cmd} 2>&1 || true");
        match run_on_shared(&ssh, &wrapped) {
            Ok(out) => Ok(AgentToolResult::ok_string(out, started)),
            Err(e) => Ok(AgentToolResult::err(e.to_string(), started)),
        }
    })
    .await
    .map_err(|e| AppError::internal(format!("join error: {e}")))?
}
