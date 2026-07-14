use serde::Serialize;

use crate::models::AppError;

/// One resolved host block from ~/.ssh/config.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub name: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
}

#[tauri::command]
pub fn parse_ssh_config() -> Result<Vec<SshConfigHost>, AppError> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| AppError::internal("Cannot determine home directory"))?;
    let path = std::path::Path::new(&home).join(".ssh").join("config");

    if !path.exists() {
        return Ok(Vec::new());
    }

    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::internal(format!("Cannot read ~/.ssh/config: {e}")))?;

    Ok(parse(&text))
}

/// Parse the config text into a flat list of host blocks.
/// Wildcard patterns and `Match` blocks are skipped. Multiple values on a single
/// `Host` line create separate blocks (each sharing the same properties).
fn parse(text: &str) -> Vec<SshConfigHost> {
    let mut out: Vec<SshConfigHost> = Vec::new();
    let mut current: Vec<SshConfigHost> = Vec::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Split into keyword + value; separator can be spaces or an `=`.
        let (kw, val) = match split_kv(line) {
            Some(t) => t,
            None => continue,
        };
        let kw_lower = kw.to_lowercase();

        if kw_lower == "host" {
            // Flush any accumulated blocks.
            out.append(&mut current);
            // Start new blocks for each name that isn't a wildcard.
            for name in val.split_whitespace() {
                if name.contains('*') || name.contains('?') || name == "!" {
                    continue;
                }
                current.push(SshConfigHost {
                    name: name.to_string(),
                    host_name: None,
                    user: None,
                    port: None,
                    identity_file: None,
                });
            }
            continue;
        }

        if kw_lower == "match" {
            // Bail on Match blocks; too complex for this importer.
            out.append(&mut current);
            continue;
        }

        // Apply the setting to every host in the current block.
        for host in &mut current {
            match kw_lower.as_str() {
                "hostname" => host.host_name = Some(val.to_string()),
                "user" => host.user = Some(val.to_string()),
                "port" => host.port = val.parse::<u16>().ok(),
                "identityfile" => host.identity_file = Some(val.to_string()),
                _ => {}
            }
        }
    }

    out.append(&mut current);
    out
}

fn split_kv(line: &str) -> Option<(&str, &str)> {
    // Try `key = value` first.
    if let Some(eq) = line.find('=') {
        let (k, v) = line.split_at(eq);
        let k = k.trim();
        let v = v[1..].trim();
        if !k.is_empty() && !v.is_empty() {
            return Some((k, v));
        }
    }
    // Fall back to whitespace-separated `key value`.
    let mut parts = line.splitn(2, char::is_whitespace);
    let k = parts.next()?.trim();
    let v = parts.next()?.trim();
    if k.is_empty() || v.is_empty() {
        return None;
    }
    Some((k, v))
}
