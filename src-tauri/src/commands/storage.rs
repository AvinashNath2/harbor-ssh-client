use std::cmp::Reverse;
use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::models::AppError;
use crate::ssh::SshState;

/// Wrap a shell command so it runs at the lowest CPU and I/O priority and is
/// killed by the remote OS if it exceeds `timeout_secs` seconds.
///
/// - `nice -n 19`: lowest CPU scheduling class — scans yield to every other process.
/// - `ionice -c 3` (when available): idle I/O class — disk reads only happen when
///   nothing else needs the disk. Prevents `du`/`find` from hurting production I/O.
/// - `timeout <N>`: guarantees the remote `find`/`du` process is killed even if the
///   SSH channel closes unexpectedly, preventing orphaned heavy processes on prod.
/// - Running inside `sh -c` lets the pipe (`find … | head`) be managed by a single
///   shell process group, so SIGTERM from `timeout` propagates to all children.
///
/// Single quotes inside `cmd` are automatically escaped.
fn throttle(cmd: &str, timeout_secs: u32, has_ionice: bool) -> String {
    let escaped = cmd.replace('\'', "'\\''");
    let io_wrap = if has_ionice { "ionice -c 3 " } else { "" };
    format!("timeout {timeout_secs} nice -n 19 {io_wrap}sh -c '{escaped}'")
}

/// Convenience wrapper: probes `ionice` availability (cached per session) and
/// builds a throttled command in one call. Use this instead of raw `throttle()`
/// so every storage scan automatically picks up idle I/O priority when available.
fn throttled_cmd(bundle: &mut crate::ssh::SessionBundle, cmd: &str, timeout_secs: u32) -> String {
    throttle(cmd, timeout_secs, bundle.has_ionice())
}

#[derive(Debug, Serialize)]
pub struct DiskMount {
    pub fs: String,
    pub mount: String,
    pub total: u64,
    pub used: u64,
    pub avail: u64,
    pub use_pct: f64,
}

#[derive(Debug, Serialize)]
pub struct StorageSystemInfo {
    pub uptime: String,
    pub kernel: String,
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
}

#[derive(Debug, Serialize)]
pub struct FolderSize {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct AgeHistogram {
    pub last_24h_bytes: u64,
    pub last_7d_bytes: u64,
    pub last_30d_bytes: u64,
    pub last_90d_bytes: u64,
    pub older_bytes: u64,
    pub total_files: u64,
}

#[tauri::command]
pub async fn storage_overview(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<DiskMount>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        let output = bundle.exec("df -PB1 2>/dev/null")?;
        let mut mounts = Vec::new();

        for line in output.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 6 {
                continue;
            }
            let fs = cols[0].to_string();
            let total: u64 = cols[1].parse().unwrap_or(0);
            let used: u64 = cols[2].parse().unwrap_or(0);
            let avail: u64 = cols[3].parse().unwrap_or(0);
            let pct_str = cols[4].trim_end_matches('%');
            let use_pct: f64 = pct_str.parse().unwrap_or(0.0);
            let mount = cols[5].to_string();

            // Skip pseudo-filesystems
            if fs == "tmpfs"
                || fs == "devtmpfs"
                || fs == "udev"
                || fs == "none"
                || fs.starts_with("overlay")
                || fs.contains("shm")
                || fs.starts_with("cgroup")
                || fs.starts_with("proc")
                || fs.starts_with("sysfs")
            {
                continue;
            }

            mounts.push(DiskMount {
                fs,
                mount,
                total,
                used,
                avail,
                use_pct,
            });
        }

        Ok(mounts)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn storage_system_info(
    state: tauri::State<'_, SshState>,
) -> Result<StorageSystemInfo, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        let uptime = bundle
            .exec("uptime -p 2>/dev/null || uptime")
            .unwrap_or_else(|_| "unknown".to_string());

        let kernel = bundle
            .exec("uname -r 2>/dev/null")
            .unwrap_or_else(|_| "unknown".to_string());

        let hostname = bundle
            .exec("hostname 2>/dev/null")
            .unwrap_or_else(|_| "unknown".to_string());

        let os_raw = bundle
            .exec(
                "cat /etc/os-release 2>/dev/null \
                 || cat /etc/redhat-release 2>/dev/null \
                 || uname -s",
            )
            .unwrap_or_default();

        let mut os_name = String::from("Linux");
        let mut os_version = String::new();

        for line in os_raw.lines() {
            if line.starts_with("NAME=") {
                os_name = line
                    .trim_start_matches("NAME=")
                    .trim_matches('"')
                    .to_string();
            } else if line.starts_with("VERSION_ID=") {
                os_version = line
                    .trim_start_matches("VERSION_ID=")
                    .trim_matches('"')
                    .to_string();
            } else if line.starts_with("VERSION=") && os_version.is_empty() {
                os_version = line
                    .trim_start_matches("VERSION=")
                    .trim_matches('"')
                    .to_string();
            }
        }

        Ok(StorageSystemInfo {
            uptime: uptime.trim().to_string(),
            kernel: kernel.trim().to_string(),
            os_name,
            os_version,
            hostname: hostname.trim().to_string(),
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn storage_scan_root(
    depth: Option<u8>,
    state: tauri::State<'_, SshState>,
) -> Result<Vec<FolderSize>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        let d = depth.unwrap_or(1);
        let cmd = throttled_cmd(bundle, &format!("du -x -B1 -d {d} / 2>/dev/null"), 180);
        let output = bundle.exec(&cmd)?;

        let mut folders: Vec<FolderSize> = output
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(2, '\t');
                let size: u64 = parts.next()?.parse().ok()?;
                let path = parts.next()?.trim().to_string();
                Some(FolderSize {
                    path,
                    size_bytes: size,
                })
            })
            .collect();

        // Sort largest first
        folders.sort_by_key(|f| Reverse(f.size_bytes));
        Ok(folders)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn storage_age_histogram(
    path: String,
    state: tauri::State<'_, SshState>,
) -> Result<AgeHistogram, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        // -xdev stays on the same filesystem; head -c 4 MB caps output and forces
        // SIGPIPE to find faster than a line count does.
        let inner =
            format!("find {path} -xdev -type f -printf '%T@ %s\\n' 2>/dev/null | head -c 4194304");
        let cmd = throttled_cmd(bundle, &inner, 120);
        let output = bundle.exec(&cmd)?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        const DAY: f64 = 86400.0;
        let mut last_24h: u64 = 0;
        let mut last_7d: u64 = 0;
        let mut last_30d: u64 = 0;
        let mut last_90d: u64 = 0;
        let mut older: u64 = 0;
        let mut total_files: u64 = 0;

        for line in output.lines() {
            let mut parts = line.splitn(2, ' ');
            let mtime: f64 = match parts.next().and_then(|s| s.parse().ok()) {
                Some(v) => v,
                None => continue,
            };
            let size: u64 = match parts.next().and_then(|s| s.trim().parse().ok()) {
                Some(v) => v,
                None => continue,
            };

            total_files += 1;
            let age_days = (now - mtime) / DAY;

            if age_days < 1.0 {
                last_24h += size;
            } else if age_days < 7.0 {
                last_7d += size;
            } else if age_days < 30.0 {
                last_30d += size;
            } else if age_days < 90.0 {
                last_90d += size;
            } else {
                older += size;
            }
        }

        Ok(AgeHistogram {
            last_24h_bytes: last_24h,
            last_7d_bytes: last_7d,
            last_30d_bytes: last_30d,
            last_90d_bytes: last_90d,
            older_bytes: older,
            total_files,
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

/// Scan one directory at the given depth and return folder sizes, sorted largest-first.
/// Each tree-node expansion calls this; depth 1 is fast on any directory.
#[tauri::command]
pub async fn storage_scan_path(
    path: String,
    depth: Option<u8>,
    state: tauri::State<'_, SshState>,
) -> Result<Vec<FolderSize>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        let d = depth.unwrap_or(1);
        let cmd = throttled_cmd(
            bundle,
            &format!("du -x -B1 -d {d} -- {path} 2>/dev/null"),
            60,
        );
        let output = bundle.exec(&cmd)?;

        let mut folders: Vec<FolderSize> = output
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(2, '\t');
                let size: u64 = parts.next()?.parse().ok()?;
                let p = parts.next()?.trim().to_string();
                // Skip the summary line (same as requested path)
                if p == path {
                    return None;
                }
                Some(FolderSize {
                    path: p,
                    size_bytes: size,
                })
            })
            .collect();

        folders.sort_by_key(|f| Reverse(f.size_bytes));
        Ok(folders)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[derive(Debug, Serialize)]
pub struct LargestFile {
    pub path: String,
    pub size_bytes: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LargestKind {
    Files,
    Folders,
}

/// Quick targeted sizes for category bucketing — runs `du -B1 -s` on known paths.
/// Much faster than a deep scan because it only summarises specific directories.
#[tauri::command]
pub async fn storage_category_sizes(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<FolderSize>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        let inner = "du -B1 -s \
            /home /root \
            /usr /opt \
            /var/log \
            /var/cache \
            /var/lib/docker \
            /var/lib/mysql /var/lib/postgresql /var/lib/pgsql \
            /var/lib \
            /var/tmp /tmp \
            /boot /boot/efi \
            /srv \
            /snap \
            /data /backup /backups \
            2>/dev/null";

        let cmd = throttled_cmd(bundle, inner, 60);
        let output = bundle.exec(&cmd)?;

        Ok(output
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(2, '\t');
                let size: u64 = parts.next()?.parse().ok()?;
                let path = parts.next()?.trim().to_string();
                Some(FolderSize {
                    path,
                    size_bytes: size,
                })
            })
            .collect())
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

// ── Phase 4: Cleanup Center + Duplicates ─────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CleanupEstimate {
    pub target: String,
    pub estimated_bytes: u64,
    pub command_preview: String,
    pub sudo_required: bool,
    pub available: bool,
}

#[derive(Debug, Serialize)]
pub struct CleanupResult {
    pub bytes_freed: u64,
    pub duration_ms: u64,
    pub exit_code: i32,
    pub stderr: String,
    pub command_run: String,
    pub sudo_used: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct DuplicateFile {
    pub path: String,
    pub size_bytes: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size_bytes: u64,
    pub files: Vec<DuplicateFile>,
}

fn check_avail(bundle: &crate::ssh::SessionBundle, check: &str) -> bool {
    if check.is_empty() {
        return true;
    }
    let cmd = format!(
        "{{ {}; }} >/dev/null 2>&1 && echo __YES__ || echo __NO__",
        check
    );
    bundle
        .exec(&cmd)
        .map(|out| out.contains("__YES__"))
        .unwrap_or(false)
}

/// Check whether passwordless sudo is available on the remote server.
#[tauri::command]
pub async fn storage_check_sudo(state: tauri::State<'_, SshState>) -> Result<bool, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;
        let out = bundle.exec("sudo -n true >/dev/null 2>&1 && echo __YES__ || echo __NO__")?;
        Ok(out.contains("__YES__"))
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// Estimate reclaimable bytes for a cleanup preset without executing it.
#[tauri::command]
pub async fn storage_cleanup_estimate(
    target: String,
    state: tauri::State<'_, SshState>,
) -> Result<CleanupEstimate, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh.lock().map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let (avail_check, estimate_cmd, execute_preview, sudo_req): (&str, &str, &str, bool) =
            match target.as_str() {
                "journal-vacuum" => (
                    "command -v journalctl",
                    "du -sb /var/log/journal/ /run/log/journal/ 2>/dev/null | awk '{s+=$1} END{print s+0}'",
                    "journalctl --vacuum-size=100M",
                    false,
                ),
                "apt-cache" => (
                    "command -v apt-get",
                    "du -sb /var/cache/apt/archives/ 2>/dev/null | awk '{print $1+0}'",
                    "apt-get clean -y",
                    true,
                ),
                "dnf-cache" => (
                    "command -v dnf",
                    "du -sb /var/cache/dnf/ 2>/dev/null | awk '{print $1+0}'",
                    "dnf clean all -y",
                    true,
                ),
                "yum-cache" => (
                    "command -v yum",
                    "du -sb /var/cache/yum/ 2>/dev/null | awk '{print $1+0}'",
                    "yum clean all -y",
                    true,
                ),
                "docker-prune" => (
                    "command -v docker",
                    "du -sb /var/lib/docker/overlay2/ /var/lib/docker/tmp/ 2>/dev/null | awk '{s+=$1} END{print s+0}'",
                    "docker system prune -af",
                    false,
                ),
                "docker-volumes-prune" => (
                    "command -v docker",
                    "du -sb /var/lib/docker/volumes/ 2>/dev/null | awk '{print $1+0}'",
                    "docker system prune -af --volumes",
                    false,
                ),
                "tmp-old" => (
                    "",
                    "find /tmp -maxdepth 3 -type f -atime +90 2>/dev/null | xargs -d '\\n' du -sb 2>/dev/null | awk '{s+=$1} END{print s+0}'",
                    "find /tmp -maxdepth 3 -type f -atime +90 -delete",
                    false,
                ),
                "coredumps" => (
                    "",
                    "find /var/crash /var/core /tmp -maxdepth 3 -type f \\( -name 'core.*' -o -name '*.crash' -o -name '*.core' \\) 2>/dev/null | xargs -d '\\n' du -sb 2>/dev/null | awk '{s+=$1} END{print s+0}'",
                    "find /var/crash /var/core /tmp -maxdepth 3 -type f \\( -name 'core.*' -o -name '*.crash' -o -name '*.core' \\) -delete",
                    false,
                ),
                "old-logs" => (
                    "",
                    "find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.[0-9][0-9]' \\) 2>/dev/null | xargs -d '\\n' du -sb 2>/dev/null | awk '{s+=$1} END{print s+0}'",
                    "find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.[0-9][0-9]' \\) -delete",
                    true,
                ),
                _ => return Err(AppError::internal(format!("Unknown cleanup target: {target}"))),
            };

        let available = check_avail(bundle, avail_check);

        let estimated_bytes = if available {
            bundle
                .exec(estimate_cmd)
                .ok()
                .and_then(|out| out.trim().parse::<u64>().ok())
                .unwrap_or(0)
        } else {
            0
        };

        Ok(CleanupEstimate {
            target,
            estimated_bytes,
            command_preview: execute_preview.to_string(),
            sudo_required: sudo_req,
            available,
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// Execute a cleanup preset with optional sudo password.
#[tauri::command]
pub async fn storage_cleanup_execute(
    target: String,
    sudo_password: Option<String>,
    state: tauri::State<'_, SshState>,
) -> Result<CleanupResult, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh.lock().map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let (execute_cmd, sudo_required): (&str, bool) = match target.as_str() {
            "journal-vacuum" => ("journalctl --vacuum-size=100M", false),
            "apt-cache" => ("apt-get clean -y", true),
            "dnf-cache" => ("dnf clean all -y", true),
            "yum-cache" => ("yum clean all -y", true),
            "docker-prune" => ("docker system prune -af", false),
            "docker-volumes-prune" => ("docker system prune -af --volumes", false),
            "tmp-old" => ("find /tmp -maxdepth 3 -type f -atime +90 -delete", false),
            "coredumps" => (
                "find /var/crash /var/core /tmp -maxdepth 3 -type f \\( -name 'core.*' -o -name '*.crash' -o -name '*.core' \\) -delete",
                false,
            ),
            "old-logs" => (
                "find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.[0-9][0-9]' \\) -delete",
                true,
            ),
            _ => return Err(AppError::internal(format!("Unknown cleanup target: {target}"))),
        };

        let command_run = if sudo_required {
            match sudo_password.as_deref().filter(|p| !p.is_empty()) {
                Some(pw) => {
                    let escaped = pw.replace('\'', "'\\''");
                    format!("printf '%s\\n' '{}' | sudo -S {}", escaped, execute_cmd)
                }
                None => format!("sudo -n {}", execute_cmd),
            }
        } else {
            execute_cmd.to_string()
        };

        // Wrap with exit code capture; stderr goes to stdout
        let wrapped = format!("{} 2>&1; echo '__EXITCODE__:'$?", command_run);

        let t0 = std::time::Instant::now();
        let raw_out = bundle.exec(&wrapped).unwrap_or_default();
        let duration_ms = t0.elapsed().as_millis() as u64;

        let (output_body, exit_code) = if let Some(pos) = raw_out.rfind("__EXITCODE__:") {
            let code: i32 = raw_out[pos + 13..].trim().parse().unwrap_or(-1);
            let body = raw_out[..pos].trim_end().to_string();
            (body, code)
        } else {
            (raw_out, 0)
        };

        Ok(CleanupResult {
            bytes_freed: 0,
            duration_ms,
            exit_code,
            stderr: output_body,
            command_run: execute_cmd.to_string(),
            sudo_used: sudo_required,
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

// ── Cleanup preview — list what a preset would actually delete ────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub path: String,
    pub size_bytes: u64,
    /// "file" | "container" | "image" | "network" | "volume" | "info"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreview {
    pub target: String,
    pub description: String,
    pub items: Vec<CleanupItem>,
    pub total_bytes: u64,
    pub item_count: usize,
    pub truncated: bool,
    pub notes: Vec<String>,
}

const PREVIEW_ITEM_CAP: usize = 500;

fn parse_size_path_lines(out: &str) -> Vec<CleanupItem> {
    out.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let size: u64 = parts.next()?.trim().parse().ok()?;
            let path = parts.next()?.trim().to_string();
            if path.is_empty() {
                return None;
            }
            Some(CleanupItem {
                path,
                size_bytes: size,
                kind: "file".to_string(),
                note: None,
            })
        })
        .collect()
}

/// List the exact files / docker objects a cleanup preset would remove — WITHOUT
/// removing anything. Used by the Preview button in the Cleanup Center.
#[tauri::command]
pub async fn storage_cleanup_preview(
    target: String,
    state: tauri::State<'_, SshState>,
) -> Result<CleanupPreview, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let (description, notes, items): (String, Vec<String>, Vec<CleanupItem>) = match target
            .as_str()
        {
            "journal-vacuum" => {
                let desc = "Trims systemd's binary journal down to 100 MB by deleting the oldest archived journal files. Active journals (currently being written) are never touched, so no live logs are lost.".to_string();
                let out = bundle.exec(
                    "find /var/log/journal /run/log/journal -type f \\
                        \\( -name '*.journal~' -o -name 'system@*.journal' -o -name 'user-*@*.journal' \\) \
                        -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -500",
                ).unwrap_or_default();
                let mut items = parse_size_path_lines(&out);
                for it in &mut items {
                    it.note = Some("archived journal — safe to remove".to_string());
                }
                let notes = vec![
                    "Only archived / rotated journals are listed. The currently-active journal is kept.".to_string(),
                ];
                (desc, notes, items)
            }
            "apt-cache" => {
                let desc = "Removes every downloaded .deb package cached in /var/cache/apt/archives. APT re-downloads what it needs next time you install something.".to_string();
                let out = bundle.exec(
                    "find /var/cache/apt/archives -maxdepth 1 -type f -name '*.deb' \
                        -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -500",
                ).unwrap_or_default();
                let items = parse_size_path_lines(&out);
                (desc, Vec::new(), items)
            }
            "dnf-cache" | "yum-cache" => {
                let root = if target == "dnf-cache" { "/var/cache/dnf" } else { "/var/cache/yum" };
                let desc = format!(
                    "Deletes all cached package metadata and downloaded RPMs under {root}. The package manager rebuilds its cache on next use."
                );
                let out = bundle.exec(&format!(
                    "find {root} -type f -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -500"
                )).unwrap_or_default();
                let items = parse_size_path_lines(&out);
                (desc, Vec::new(), items)
            }
            "docker-prune" => {
                let desc = "Runs `docker system prune -af` which removes: (1) all stopped containers, (2) unused container images (both dangling and unreferenced), (3) unused networks, (4) the build cache. Named volumes are NOT touched by this preset.".to_string();
                let mut items = Vec::new();
                let mut notes = Vec::new();

                // Stopped containers
                let containers = bundle.exec(
                    "docker ps -a --filter status=exited --filter status=created --filter status=dead \
                        --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Size}}' 2>/dev/null"
                ).unwrap_or_default();
                for line in containers.lines() {
                    let cols: Vec<&str> = line.split('\t').collect();
                    if cols.len() < 5 { continue; }
                    items.push(CleanupItem {
                        path: format!("container: {}", cols[1]),
                        size_bytes: 0,
                        kind: "container".to_string(),
                        note: Some(format!("{} — {} — size {}", cols[2], cols[3], cols[4])),
                    });
                }

                // Dangling + unreferenced images
                let images = bundle.exec(
                    "docker images -a --format '{{.ID}}\\t{{.Repository}}:{{.Tag}}\\t{{.Size}}' 2>/dev/null"
                ).unwrap_or_default();
                let used = bundle.exec(
                    "docker ps -a --format '{{.Image}}' 2>/dev/null | sort -u"
                ).unwrap_or_default();
                let used_set: std::collections::HashSet<String> = used.lines().map(|s| s.trim().to_string()).collect();
                for line in images.lines() {
                    let cols: Vec<&str> = line.split('\t').collect();
                    if cols.len() < 3 { continue; }
                    let repo_tag = cols[1];
                    let is_dangling = repo_tag == "<none>:<none>";
                    if !is_dangling && used_set.contains(repo_tag) { continue; }
                    items.push(CleanupItem {
                        path: format!("image: {}", repo_tag),
                        size_bytes: 0,
                        kind: "image".to_string(),
                        note: Some(format!("id {} — {} — {}", cols[0], cols[2], if is_dangling { "dangling" } else { "unreferenced" })),
                    });
                }

                // Unused networks (skip default bridge/host/none)
                let networks = bundle.exec(
                    "docker network ls --format '{{.ID}}\\t{{.Name}}\\t{{.Driver}}' 2>/dev/null"
                ).unwrap_or_default();
                for line in networks.lines() {
                    let cols: Vec<&str> = line.split('\t').collect();
                    if cols.len() < 3 { continue; }
                    let name = cols[1];
                    if matches!(name, "bridge" | "host" | "none") { continue; }
                    items.push(CleanupItem {
                        path: format!("network: {name}"),
                        size_bytes: 0,
                        kind: "network".to_string(),
                        note: Some(format!("id {} — driver {}", cols[0], cols[2])),
                    });
                }

                // Build cache summary (single line, docker doesn't expose per-item easily)
                if let Ok(bc) = bundle.exec("docker builder du 2>/dev/null | tail -1") {
                    let bc = bc.trim();
                    if !bc.is_empty() {
                        notes.push(format!("Build cache: {bc}"));
                    }
                }
                notes.push("Named volumes are NOT deleted by this preset. Use \"Docker prune + volumes\" if you want those included.".to_string());
                (desc, notes, items)
            }
            "docker-volumes-prune" => {
                let desc = "Same as `Docker prune`, PLUS deletes every named volume that is not currently attached to a container. This can permanently erase database data, persistent app state, etc. — review carefully.".to_string();
                let mut items = Vec::new();
                let mut notes = vec![
                    "⚠ Volumes contain persistent data (databases, uploaded files, config). Once deleted, they are gone. Verify each entry.".to_string(),
                ];

                let volumes = bundle.exec(
                    "docker volume ls -f dangling=true --format '{{.Name}}\\t{{.Driver}}' 2>/dev/null"
                ).unwrap_or_default();
                for line in volumes.lines() {
                    let cols: Vec<&str> = line.split('\t').collect();
                    if cols.is_empty() { continue; }
                    let name = cols[0];
                    if name.is_empty() { continue; }
                    let driver = cols.get(1).unwrap_or(&"local");
                    // Try to get size — /var/lib/docker/volumes/<name>/_data
                    let size = bundle.exec(&format!(
                        "du -sb /var/lib/docker/volumes/{name}/_data 2>/dev/null | awk '{{print $1+0}}'"
                    )).ok().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
                    items.push(CleanupItem {
                        path: format!("volume: {name}"),
                        size_bytes: size,
                        kind: "volume".to_string(),
                        note: Some(format!("driver {driver} — unattached")),
                    });
                }

                if items.is_empty() {
                    notes.push("No dangling volumes found — only the standard `docker system prune -af` items will be removed.".to_string());
                }
                (desc, notes, items)
            }
            "tmp-old" => {
                let desc = "Deletes files in /tmp that haven't been accessed in the last 90 days (atime > 90). Recent tmp files, sockets, and active session data are untouched.".to_string();
                let out = bundle.exec(
                    "find /tmp -maxdepth 3 -type f -atime +90 -printf '%s\\t%p\\n' 2>/dev/null \
                        | sort -rn | head -500",
                ).unwrap_or_default();
                let items = parse_size_path_lines(&out);
                (desc, Vec::new(), items)
            }
            "coredumps" => {
                let desc = "Removes crash dump files matching core.*, *.crash, and *.core under /var/crash, /var/core, and /tmp. These are diagnostic artefacts left behind by crashed processes.".to_string();
                let out = bundle.exec(
                    "find /var/crash /var/core /tmp -maxdepth 3 -type f \
                        \\( -name 'core.*' -o -name '*.crash' -o -name '*.core' \\) \
                        -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -500",
                ).unwrap_or_default();
                let items = parse_size_path_lines(&out);
                (desc, Vec::new(), items)
            }
            "old-logs" => {
                let desc = "Removes rotated log files under /var/log (compressed .gz, and numbered rollovers like syslog.1, auth.log.4.gz). Active log files being written to right now are untouched.".to_string();
                let out = bundle.exec(
                    "find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.[0-9][0-9]' \\) \
                        -printf '%s\\t%p\\n' 2>/dev/null | sort -rn | head -500",
                ).unwrap_or_default();
                let items = parse_size_path_lines(&out);
                (desc, Vec::new(), items)
            }
            _ => return Err(AppError::internal(format!("Unknown cleanup target: {target}"))),
        };

        let total_bytes: u64 = items.iter().map(|i| i.size_bytes).sum();
        let item_count = items.len();
        let truncated = item_count >= PREVIEW_ITEM_CAP;

        Ok(CleanupPreview {
            target,
            description,
            items,
            total_bytes,
            item_count,
            truncated,
            notes,
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// Find duplicate candidates under root by grouping files with identical byte sizes.
///
/// This is a zero-byte-read algorithm — it only reads filesystem metadata (inode size
/// field), never file content. False positives are possible (two different files with
/// the same size) but extremely rare above 1 MB. Use the "Verify" action in the UI to
/// confirm specific groups before deleting anything.
///
/// The `hash` field in DuplicateGroup is set to the file size in bytes as a string
/// (the grouping key); it is not a cryptographic hash.
#[tauri::command]
pub async fn storage_find_duplicates(
    root: String,
    min_size_bytes: u64,
    max_depth: u32,
    state: tauri::State<'_, SshState>,
) -> Result<Vec<DuplicateGroup>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        // Single pass: size + mtime + path — pure metadata, no file content read.
        // Capped at 1500 entries; head -c 1 MB bounds memory on Rust side.
        let inner = format!(
            "find {root} -maxdepth {max_depth} -type f -size +{min_size_bytes}c \
             -printf '%s\\t%T@\\t%p\\n' 2>/dev/null | sort -rn | head -1500"
        );
        let cmd = throttled_cmd(bundle, &inner, 90);
        let meta_out = bundle.exec(&cmd).unwrap_or_default();

        // Group by exact byte size in Rust.
        let mut by_size: HashMap<u64, Vec<DuplicateFile>> = HashMap::new();
        for line in meta_out.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let mut parts = line.splitn(3, '\t');
            let size: u64 = match parts.next().and_then(|s| s.parse().ok()) {
                Some(v) if v > 0 => v,
                _ => continue,
            };
            let modified: Option<u64> = parts
                .next()
                .and_then(|s| s.parse::<f64>().ok())
                .map(|f| f as u64);
            let path = match parts.next() {
                Some(p) if !p.trim().is_empty() => p.trim().to_string(),
                _ => continue,
            };
            by_size.entry(size).or_default().push(DuplicateFile {
                path,
                size_bytes: size,
                modified,
            });
        }

        // Keep only size groups that have 2+ files (actual duplicate candidates).
        let mut groups: Vec<DuplicateGroup> = by_size
            .into_iter()
            .filter(|(_, files)| files.len() >= 2)
            .map(|(size, files)| DuplicateGroup {
                // Use size as the group identifier — not a hash, just the grouping key.
                hash: size.to_string(),
                size_bytes: size,
                files,
            })
            .collect();

        // Sort by recoverable bytes (size × number of extras), largest first.
        groups.sort_by_key(|g| {
            Reverse(
                g.size_bytes
                    .saturating_mul(g.files.len().saturating_sub(1) as u64),
            )
        });
        groups.truncate(200);

        Ok(groups)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

/// Return the `limit` largest files or folders under `root`, sorted by size desc.
#[tauri::command]
pub async fn storage_largest_items(
    root: String,
    kind: LargestKind,
    limit: Option<u32>,
    state: tauri::State<'_, SshState>,
) -> Result<Vec<LargestFile>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_mut().ok_or_else(AppError::not_connected)?;

        let n = limit.unwrap_or(200);

        let output = match kind {
            LargestKind::Files => {
                let inner = format!(
                    "find {root} -xdev -type f -printf '%s %T@ %P\\n' 2>/dev/null \
                     | sort -rn | head -{n}"
                );
                let cmd = throttled_cmd(bundle, &inner, 120);
                bundle.exec(&cmd)?
            }
            LargestKind::Folders => {
                // depth 3 is a safer default than 5 on large trees
                let inner =
                    format!("du -x -B1 --max-depth=3 {root} 2>/dev/null | sort -rn | head -{n}");
                let cmd = throttled_cmd(bundle, &inner, 120);
                bundle.exec(&cmd)?
            }
        };

        let items: Vec<LargestFile> = match kind {
            LargestKind::Files => output
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|line| {
                    let mut parts = line.splitn(3, ' ');
                    let size: u64 = parts.next()?.parse().ok()?;
                    let mtime_f: f64 = parts.next()?.parse().ok()?;
                    let rel_path = parts.next()?.trim();
                    let full_path = if root.ends_with('/') {
                        format!("{root}{rel_path}")
                    } else {
                        format!("{root}/{rel_path}")
                    };
                    Some(LargestFile {
                        path: full_path,
                        size_bytes: size,
                        modified: Some(mtime_f as u64),
                    })
                })
                .collect(),
            LargestKind::Folders => output
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|line| {
                    let mut parts = line.splitn(2, '\t');
                    let size: u64 = parts.next()?.parse().ok()?;
                    let path = parts.next()?.trim().to_string();
                    Some(LargestFile {
                        path,
                        size_bytes: size,
                        modified: None,
                    })
                })
                .collect(),
        };

        Ok(items)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

// ── Live server load (for the "Server Load" popup during scans) ───────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLoad {
    pub load_one_m: f32,
    pub load_five_m: f32,
    pub cpu_cores: u32,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
}

/// Cheap live-load snapshot for the server-load popup shown during scans.
/// Reads three /proc / free files in a single exec — ~30–50 ms per call.
#[tauri::command]
pub async fn storage_system_load(
    state: tauri::State<'_, SshState>,
) -> Result<SystemLoad, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        // Batch three trivial reads into one round-trip. Section headers let us
        // find each block regardless of ordering / warnings on stderr.
        let out = bundle.exec(
            "printf 'LOAD:'; cat /proc/loadavg 2>/dev/null; \
             printf '\\nMEM:'; free -b 2>/dev/null | awk 'NR==2{print $3, $2}'; \
             printf '\\nCORES:'; nproc 2>/dev/null || echo 1",
        )?;

        let mut load_one_m: f32 = 0.0;
        let mut load_five_m: f32 = 0.0;
        let mut mem_used_bytes: u64 = 0;
        let mut mem_total_bytes: u64 = 0;
        let mut cpu_cores: u32 = 1;

        for line in out.lines() {
            if let Some(rest) = line.strip_prefix("LOAD:") {
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if parts.len() >= 2 {
                    load_one_m = parts[0].parse().unwrap_or(0.0);
                    load_five_m = parts[1].parse().unwrap_or(0.0);
                }
            } else if let Some(rest) = line.strip_prefix("MEM:") {
                let parts: Vec<&str> = rest.split_whitespace().collect();
                if parts.len() >= 2 {
                    mem_used_bytes = parts[0].parse().unwrap_or(0);
                    mem_total_bytes = parts[1].parse().unwrap_or(0);
                }
            } else if let Some(rest) = line.strip_prefix("CORES:") {
                cpu_cores = rest.trim().parse().unwrap_or(1);
            }
        }

        Ok(SystemLoad {
            load_one_m,
            load_five_m,
            cpu_cores,
            mem_used_bytes,
            mem_total_bytes,
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}
