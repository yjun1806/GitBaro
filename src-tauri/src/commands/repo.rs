use crate::commands::auth::resolve_token;
use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::engine::GitRemoteEngine;
use crate::state::TokenStore;
use serde_json::{json, Value};

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

    let remote_names: Vec<String> = repo
        .remotes()
        .map(|r| {
            r.iter()
                .filter_map(|name| name.map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let remotes: Vec<Value> = remote_names
        .iter()
        .filter_map(|name| {
            repo.find_remote(name).ok().map(|remote| {
                json!({
                    "name": name,
                    "url": remote.url().unwrap_or(""),
                })
            })
        })
        .collect();

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
    account_id: Option<String>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Value, AppError> {
    let token = if let Some(ref id) = account_id {
        Some(resolve_token(&token_store, id).await?)
    } else {
        None
    };

    // Use GIT_ASKPASS for secure credential passing (no token in URL/process args)
    let path_clone = path.clone();
    if let Some(ref tok) = token {
        let engine = GitCliEngine::new(std::path::Path::new(&path));
        engine.clone_repo(&url, std::path::Path::new(&path), tok).await?;
    } else {
        let output = tokio::process::Command::new("git")
            .args(["clone", &url, &path])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
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
    }

    let result = tokio::task::spawn_blocking(move || repo_info_from_path(&path_clone))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Cloned repository from {} to {}", url, result["path"]);
    Ok(result)
}

#[tauri::command]
pub async fn search_github_repos(
    account_id: String,
    query: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Value, AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let client = crate::github::client::GitHubClient::new();
    let repos = client.list_repos(&token, 1).await?;

    let query_lower = query.to_lowercase();
    let filtered: Vec<Value> = repos
        .into_iter()
        .filter(|repo| {
            if query_lower.is_empty() {
                return true;
            }
            let full_name = repo["full_name"].as_str().unwrap_or("").to_lowercase();
            full_name.contains(&query_lower)
        })
        .map(|repo| {
            json!({
                "fullName": repo["full_name"].as_str().unwrap_or(""),
                "cloneUrl": repo["clone_url"].as_str().unwrap_or(""),
                "description": repo["description"].as_str(),
                "isPrivate": repo["private"].as_bool().unwrap_or(false),
                "isFork": repo["fork"].as_bool().unwrap_or(false),
            })
        })
        .collect();

    Ok(json!(filtered))
}

#[tauri::command]
pub async fn get_repo_visibility(
    repo_path: String,
    account_id: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Value, AppError> {
    // 1. Get remote origin URL
    let rp = repo_path.clone();
    let origin_url = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let remote = repo.find_remote("origin").map_err(|e| {
            AppError::RepoNotFound(format!("No origin remote: {}", e))
        })?;
        Ok::<String, AppError>(remote.url().unwrap_or("").to_string())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    // 2. Parse owner/repo from URL
    let (owner, repo_name) = crate::git::remote::parse_github_url(&origin_url)
        .ok_or_else(|| AppError::RepoNotFound("Not a GitHub repository URL".to_string()))?;

    // 3. Resolve token for the linked account
    let token = crate::commands::auth::resolve_token(&token_store, &account_id).await?;

    // 4. Call GitHub API
    let client = crate::github::client::GitHubClient::new();
    let repo_info = client.get_repo(&token, &owner, &repo_name).await?;

    let is_private = repo_info["private"].as_bool().unwrap_or(false);
    let is_fork = repo_info["fork"].as_bool().unwrap_or(false);
    let is_archived = repo_info["archived"].as_bool().unwrap_or(false);
    let owner_type = repo_info["owner"]["type"]
        .as_str()
        .unwrap_or("User")
        .to_string();

    Ok(json!({
        "isPrivate": is_private,
        "isFork": is_fork,
        "isArchived": is_archived,
        "ownerType": owner_type,
    }))
}

/// Check if a GitHub owner (user/org name) is an Organization or User.
#[tauri::command]
pub async fn get_owner_type(
    owner: String,
    account_id: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Value, AppError> {
    let token = crate::commands::auth::resolve_token(&token_store, &account_id).await?;

    let client = crate::github::client::GitHubClient::new();
    let user_info = client.get_user_by_login(&token, &owner).await?;

    let owner_type = user_info["type"]
        .as_str()
        .unwrap_or("User")
        .to_string();

    Ok(json!({ "ownerType": owner_type }))
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
