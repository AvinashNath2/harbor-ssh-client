use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::models::AppError;
use crate::ssh::SshState;

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerContainer {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Names")]
    pub name: String,
    #[serde(rename = "Image")]
    pub image: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
    #[serde(rename = "Ports")]
    pub ports: String,
    #[serde(rename = "Labels")]
    pub labels: String,
}

#[derive(Debug, Serialize)]
pub struct DockerContainerParsed {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub created_at: String,
    pub ports: String,
    pub compose_project: Option<String>,
    pub compose_service: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerImage {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Repository")]
    pub repository: String,
    #[serde(rename = "Tag")]
    pub tag: String,
    #[serde(rename = "Size")]
    pub size: String,
    #[serde(rename = "CreatedAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerNetwork {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Driver")]
    pub driver: String,
    #[serde(rename = "Scope")]
    pub scope: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerVolume {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Driver")]
    pub driver: String,
    #[serde(rename = "Mountpoint")]
    pub mountpoint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComposeProject {
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "Status", default)]
    pub status: Option<String>,
    #[serde(rename = "ConfigFiles", default)]
    pub config_files: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ContainerStats {
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "CPUPerc", default)]
    pub cpu_perc: String,
    #[serde(rename = "MemUsage", default)]
    pub mem_usage: String,
    #[serde(rename = "NetIO", default)]
    pub net_io: String,
    #[serde(rename = "BlockIO", default)]
    pub block_io: String,
}

fn extract_label(labels: &str, key: &str) -> Option<String> {
    labels
        .split(',')
        .find(|kv| kv.trim_start().starts_with(key))
        .and_then(|kv| kv.splitn(2, '=').nth(1))
        .map(|v| v.to_owned())
}

#[tauri::command]
pub async fn docker_available(state: tauri::State<'_, SshState>) -> Result<bool, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let output = bundle.exec("docker --version 2>&1").unwrap_or_default();
        Ok(output.starts_with("Docker"))
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn list_docker_containers(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<DockerContainerParsed>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let output = bundle.exec("docker ps -a --format '{{json .}}'")?;
        let items: Vec<DockerContainerParsed> = output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<DockerContainer>(l).ok())
            .map(|c| DockerContainerParsed {
                compose_project: extract_label(
                    &c.labels,
                    "com.docker.compose.project",
                ),
                compose_service: extract_label(
                    &c.labels,
                    "com.docker.compose.service",
                ),
                id: c.id,
                name: c.name,
                image: c.image,
                status: c.status,
                state: c.state,
                created_at: c.created_at,
                ports: c.ports,
            })
            .collect();
        Ok(items)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn list_docker_images(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<DockerImage>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let output = bundle.exec("docker images --format '{{json .}}'")?;
        let items: Vec<DockerImage> = output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        Ok(items)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn list_docker_networks(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<DockerNetwork>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let output = bundle.exec("docker network ls --format '{{json .}}'")?;
        let items: Vec<DockerNetwork> = output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        Ok(items)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn list_docker_volumes(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<DockerVolume>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let output = bundle.exec("docker volume ls --format '{{json .}}'")?;
        let items: Vec<DockerVolume> = output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        Ok(items)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn list_compose_projects(
    state: tauri::State<'_, SshState>,
) -> Result<Vec<ComposeProject>, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let output = bundle
            .exec("docker compose ls --format json 2>/dev/null || echo '[]'")?;
        let items: Vec<ComposeProject> =
            serde_json::from_str(&output).unwrap_or_default();
        Ok(items)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn docker_container_inspect(
    state: tauri::State<'_, SshState>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let escaped = crate::ssh::shell_single_quote(&id)
            .ok_or_else(|| AppError::internal("Container ID contains invalid characters"))?;
        let output = bundle.exec(&format!("docker inspect '{escaped}'"))?;
        serde_json::from_str(&output)
            .map_err(|e| AppError::internal(format!("JSON parse error: {e}")))
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn docker_container_logs(
    state: tauri::State<'_, SshState>,
    id: String,
) -> Result<String, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let escaped = crate::ssh::shell_single_quote(&id)
            .ok_or_else(|| AppError::internal("Container ID contains invalid characters"))?;
        bundle.exec(&format!(
            "docker logs --tail 200 --timestamps '{escaped}' 2>&1"
        ))
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn docker_container_stats(
    state: tauri::State<'_, SshState>,
    id: String,
) -> Result<ContainerStats, AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let escaped = crate::ssh::shell_single_quote(&id)
            .ok_or_else(|| AppError::internal("Container ID contains invalid characters"))?;
        let output = bundle
            .exec(&format!(
                "docker stats --no-stream --format '{{{{json .}}}}' '{escaped}'"
            ))
            .unwrap_or_default();
        let stats: ContainerStats = output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .find_map(|l| serde_json::from_str(l).ok())
            .unwrap_or_default();
        Ok(stats)
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn docker_container_action(
    state: tauri::State<'_, SshState>,
    id: String,
    action: String,
) -> Result<(), AppError> {
    let valid_actions = ["start", "stop", "restart", "kill", "rm"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(AppError::internal(format!(
            "Unknown container action: {action}"
        )));
    }
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let escaped = crate::ssh::shell_single_quote(&id)
            .ok_or_else(|| AppError::internal("Container ID contains invalid characters"))?;
        bundle.exec(&format!("docker {action} '{escaped}'"))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn docker_image_action(
    state: tauri::State<'_, SshState>,
    id: String,
    action: String,
) -> Result<(), AppError> {
    let ssh = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || {
        let guard = ssh
            .lock()
            .map_err(|_| AppError::internal("SSH state mutex poisoned"))?;
        let bundle = guard.as_ref().ok_or_else(AppError::not_connected)?;
        let escaped = crate::ssh::shell_single_quote(&id)
            .ok_or_else(|| AppError::internal("Image ID contains invalid characters"))?;
        let cmd = match action.as_str() {
            "pull" => format!("docker pull '{escaped}'"),
            "rmi" => format!("docker rmi '{escaped}'"),
            other => {
                return Err(AppError::internal(format!(
                    "Unknown image action: {other}"
                )))
            }
        };
        bundle.exec(&cmd)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::internal(format!("Task join error: {e}")))?
}
