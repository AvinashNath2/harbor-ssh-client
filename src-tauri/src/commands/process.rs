use std::sync::Arc;

use serde::Serialize;

use crate::models::AppError;
use crate::ssh::SshState;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JavaProcess {
    pub pid: u32,
    pub user: String,
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub etime: String,
    pub main_class: String,
    pub jvm_args: String,
    pub ports: Vec<u16>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetail {
    pub pid: u32,
    pub main_class: String,
    pub jvm_flags: Vec<String>,
    pub system_props: Vec<String>,
    pub full_cmdline: String,
    pub vm_rss_kb: u64,
    pub vm_size_kb: u64,
    pub threads: u32,
}

fn parse_main_class(args: &str) -> String {
    let parts: Vec<&str> = args.split_whitespace().collect();
    let mut skip_next = false;
    for part in parts.iter().skip(1) {
        if skip_next {
            skip_next = false;
            continue;
        }
        if part.starts_with('-') {
            if *part == "-cp"
                || *part == "-classpath"
                || *part == "--module-path"
                || *part == "-mp"
                || *part == "--class-path"
            {
                skip_next = true;
            }
            continue;
        }
        if part.ends_with(".jar") {
            return part.split('/').last().unwrap_or(part).to_string();
        }
        return part.to_string();
    }
    "java".to_string()
}

#[tauri::command]
pub async fn process_list_java(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<JavaProcess>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let ps_out = bundle
            .exec("ps -eo pid,user,pcpu,pmem,etime,args --no-headers 2>/dev/null | grep java | grep -v grep")
            .unwrap_or_default();

        let mut processes: Vec<JavaProcess> = Vec::new();

        for line in ps_out.lines() {
            // ps columns are whitespace-separated; args may contain spaces — split into 6 fields max
            let mut cols = line.splitn(6, ' ').map(str::trim).filter(|s| !s.is_empty());
            let pid: u32 = match cols.next().and_then(|v| v.parse().ok()) {
                Some(v) => v,
                None => continue,
            };
            let user = cols.next().unwrap_or("").to_string();
            let cpu_pct: f32 = cols.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
            let mem_pct: f32 = cols.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
            let etime = cols.next().unwrap_or("").to_string();
            let args = cols.next().unwrap_or("").trim();

            if !args.contains("java") {
                continue;
            }

            let main_class = parse_main_class(args);

            let ports = bundle
                .exec(&format!(
                    "ss -tlnp 2>/dev/null | grep 'pid={pid},' | awk '{{print $4}}' | awk -F: '{{print $NF}}'"
                ))
                .unwrap_or_default()
                .lines()
                .filter_map(|l| l.trim().parse::<u16>().ok())
                .collect();

            processes.push(JavaProcess {
                pid,
                user,
                cpu_pct,
                mem_pct,
                etime,
                main_class,
                jvm_args: args.to_string(),
                ports,
            });
        }

        Ok(processes)
    })
    .await
    .map_err(|e| AppError::internal(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn process_detail(
    pid: u32,
    state: tauri::State<'_, SshState>,
) -> Result<ProcessDetail, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let cmdline_raw = bundle
            .exec(&format!(
                "cat /proc/{pid}/cmdline 2>/dev/null | tr '\\0' ' '"
            ))
            .unwrap_or_default();

        let full_cmdline = cmdline_raw.trim().to_string();
        let main_class = parse_main_class(&full_cmdline);

        let mut jvm_flags: Vec<String> = Vec::new();
        let mut system_props: Vec<String> = Vec::new();
        for part in full_cmdline.split_whitespace().skip(1) {
            if part.starts_with("-D") {
                system_props.push(part.to_string());
            } else if part.starts_with('-') {
                jvm_flags.push(part.to_string());
            }
        }

        let status = bundle
            .exec(&format!("cat /proc/{pid}/status 2>/dev/null"))
            .unwrap_or_default();

        let mut vm_rss_kb: u64 = 0;
        let mut vm_size_kb: u64 = 0;
        let mut threads: u32 = 0;

        for line in status.lines() {
            if let Some((key, val)) = line.split_once(':') {
                let val = val.trim();
                match key.trim() {
                    "VmRSS" => {
                        vm_rss_kb = val
                            .split_whitespace()
                            .next()
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0);
                    }
                    "VmSize" => {
                        vm_size_kb = val
                            .split_whitespace()
                            .next()
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(0);
                    }
                    "Threads" => {
                        threads = val.parse().unwrap_or(0);
                    }
                    _ => {}
                }
            }
        }

        Ok(ProcessDetail {
            pid,
            main_class,
            jvm_flags,
            system_props,
            full_cmdline,
            vm_rss_kb,
            vm_size_kb,
            threads,
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn process_thread_dump(
    pid: u32,
    state: tauri::State<'_, SshState>,
) -> Result<String, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let out = bundle
            .exec(&format!("jstack {pid} 2>/dev/null"))
            .unwrap_or_default();

        if !out.trim().is_empty() {
            return Ok(out);
        }

        // Fallback: SIGQUIT
        let _ = bundle.exec(&format!("kill -3 {pid} 2>/dev/null"));
        let _ = bundle.exec("sleep 0.5");
        let fallback = bundle
            .exec(&format!("cat /proc/{pid}/fd/1 2>/dev/null"))
            .unwrap_or_else(|_| {
                "Thread dump sent via SIGQUIT — check the process stdout/log for output.".into()
            });

        Ok(if fallback.trim().is_empty() {
            "Thread dump sent via SIGQUIT — check the process stdout/log for output.".into()
        } else {
            fallback
        })
    })
    .await
    .map_err(|e| AppError::internal(format!("task join error: {e}")))?
}

#[tauri::command]
pub async fn process_kill(
    pid: u32,
    force: bool,
    state: tauri::State<'_, SshState>,
) -> Result<(), AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;

        let sig = if force { "9" } else { "15" };
        let out = bundle
            .exec(&format!("kill -{sig} {pid} 2>&1"))
            .unwrap_or_default();

        if out.contains("No such process") {
            return Err(AppError::internal(format!("Process {pid} not found")));
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError::internal(format!("task join error: {e}")))?
}
