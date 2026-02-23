use crate::error::AppError;
use serde_json::{json, Value};
use std::process::Stdio;

fn repo_info_from_path(repo_path: &str) -> Result<Value, AppError> {
    let repo = git2::Repository::open(repo_path)?;
    let path = repo_path.to_string();

    let name = std::path::Path::new(repo_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let current_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let is_dirty = {
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(false).exclude_submodules(true);
        repo.statuses(Some(&mut opts))
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    };

    let remotes: Vec<String> = repo
        .remotes()
        .map(|r| {
            r.iter()
                .filter_map(|name| name.map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "path": path,
        "name": name,
        "currentBranch": current_branch,
        "isDirty": is_dirty,
        "remotes": remotes,
        "accountId": null,
    }))
}

#[tauri::command]
pub async fn open_repository(path: String) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        repo_info_from_path(&path)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Opened repository: {}", result["path"]);
    Ok(result)
}

#[tauri::command]
pub async fn clone_repository(
    url: String,
    path: String,
    token: Option<String>,
) -> Result<Value, AppError> {
    let clone_url = if let Some(ref tok) = token {
        // Embed token in URL for HTTPS authentication
        if let Some(stripped) = url.strip_prefix("https://") {
            format!("https://{}@{}", tok, stripped)
        } else {
            url.clone()
        }
    } else {
        url.clone()
    };

    let path_clone = path.clone();
    let output = tokio::process::Command::new("git")
        .args(["clone", &clone_url, &path])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|_| AppError::GitCliNotFound)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::GitCli {
            message: stderr,
            exit_code: output.status.code(),
        });
    }

    let result = tokio::task::spawn_blocking(move || repo_info_from_path(&path_clone))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Cloned repository from {} to {}", url, result["path"]);
    Ok(result)
}

#[tauri::command]
pub async fn get_open_repos() -> Result<Vec<Value>, AppError> {
    // This returns an empty list as a stub — real state management would track open repos
    // The actual state is managed by the frontend or a state module
    tracing::info!("get_open_repos called (stub)");
    Ok(vec![])
}

#[tauri::command]
pub async fn close_repository(path: String) -> Result<(), AppError> {
    tracing::info!("close_repository: {}", path);
    // Real state tracking would remove this from the active repos list
    Ok(())
}

#[tauri::command]
pub async fn add_local_repository(path: String) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || repo_info_from_path(&path))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Added local repository: {}", result["path"]);
    Ok(result)
}
