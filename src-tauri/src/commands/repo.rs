use crate::commands::auth::resolve_token;
use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::engine::GitRemoteEngine;
use crate::git::libgit::is_working_tree_dirty;
use crate::state::TokenStore;
use serde_json::{json, Value};

/// Open the repository at exactly `repo_path` (a path the app already knows
/// as a repo root) and describe it.
fn repo_info_from_path(repo_path: &str) -> Result<Value, AppError> {
    let repo = git2::Repository::open(repo_path)?;
    repo_info(&repo, repo_path.to_string())
}

/// Find the repository containing `path` (the folder the user picked may be a
/// subfolder) and describe it under its working-tree root.
fn repo_info_from_discovered(path: &str) -> Result<Value, AppError> {
    let repo = git2::Repository::discover(path)?;
    let root = repo
        .workdir()
        .map(workdir_to_string)
        .ok_or_else(|| AppError::BareRepository(path.to_string()))?;
    repo_info(&repo, root)
}

/// git2 reports the working directory with a trailing slash; the app keys
/// repositories by the plain path.
fn workdir_to_string(workdir: &std::path::Path) -> String {
    let s = workdir.to_string_lossy();
    let trimmed = s.trim_end_matches('/');
    if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() }
}

fn repo_info(repo: &git2::Repository, path: String) -> Result<Value, AppError> {
    // A bare repository has no working tree — status, staging and commits
    // would all fail, so it cannot be used here.
    if repo.is_bare() {
        return Err(AppError::BareRepository(path));
    }

    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let current_branch = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let is_dirty = is_working_tree_dirty(repo);

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

    let is_worktree = repo.is_worktree();

    Ok(json!({
        "path": path,
        "name": name,
        "currentBranch": current_branch,
        "isDirty": is_dirty,
        "remotes": remotes,
        "accountId": null,
        "isWorktree": is_worktree,
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
    app_handle: tauri::AppHandle,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<Value, AppError> {
    // Reject dangerous transports (ext::, file://, -flag) before clone.
    crate::git::remote::validate_clone_url(&url)?;

    let token = if let Some(ref id) = account_id {
        Some(resolve_token(&token_store, id).await?)
    } else {
        None
    };

    // Use GIT_ASKPASS for secure credential passing (no token in URL/process args)
    let path_clone = path.clone();
    if let Some(ref tok) = token {
        let engine = GitCliEngine::with_app_handle(std::path::Path::new(&path), app_handle);
        engine.clone_repo(&url, std::path::Path::new(&path), tok).await?;
    } else {
        tracing::info!("[git] git clone {} {} (no auth)", url, path);
        // `--` separates options from positional args; `protocol.ext.allow=never`
        // is defense-in-depth against the ext:: remote helper.
        let output = tokio::process::Command::new("git")
            .args([
                "-c",
                "protocol.ext.allow=never",
                "clone",
                "--",
                &url,
                &path,
            ])
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|_| AppError::GitCliNotFound)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::GitCli {
                message: crate::git::cli::parse_git_error(&stderr),
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
    let client = crate::github::client::GitHubClient::new();

    // Paginate through the user's repositories (100 per page). Stops at a partial
    // page or a safety cap so users with >100 repos can still find clone targets.
    const MAX_PAGES: u32 = 10;
    let mut repos: Vec<Value> = Vec::new();
    for page in 1..=MAX_PAGES {
        let batch = crate::commands::auth::call_with_token_retry(&token_store, &account_id, |token| {
            let client = &client;
            async move { client.list_repos(&token, page).await }
        })
        .await?;
        let batch_len = batch.len();
        repos.extend(batch);
        if batch_len < 100 {
            break;
        }
    }

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
    let (owner, repo_name) = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let remote = repo.find_remote("origin").map_err(|e| {
            AppError::RepoNotFound(format!("No origin remote: {}", e))
        })?;
        let url = remote.url().unwrap_or("").to_string();
        // 2. Parse owner/repo. This may run `ssh -G` for a host alias, so it
        // stays inside spawn_blocking.
        crate::git::remote::parse_github_url(&url)
            .ok_or_else(|| AppError::RepoNotFound("Not a GitHub repository URL".to_string()))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    // 3. Call GitHub API with the linked account's token
    let client = crate::github::client::GitHubClient::new();
    let repo_info = crate::commands::auth::call_with_token_retry(&token_store, &account_id, |token| {
        let (client, owner, repo_name) = (&client, &owner, &repo_name);
        async move { client.get_repo(&token, owner, repo_name).await }
    })
    .await?;

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
    let client = crate::github::client::GitHubClient::new();
    let user_info = crate::commands::auth::call_with_token_retry(&token_store, &account_id, |token| {
        let (client, owner) = (&client, &owner);
        async move { client.get_user_by_login(&token, owner).await }
    })
    .await?;

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
    let result = tokio::task::spawn_blocking(move || repo_info_from_discovered(&path))
        .await
        .map_err(|e| AppError::Channel(e.to_string()))??;

    tracing::info!("Added local repository: {}", result["path"]);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .expect("git 실행 실패");
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!("gitbaro-repo-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        // git2 reports resolved paths (/private/var/... on macOS).
        std::fs::canonicalize(&tmp).unwrap()
    }

    /// 하위 폴더를 골라도 저장소 루트로 추가되어야 한다 (B18).
    #[tokio::test]
    async fn adding_a_subfolder_adds_the_repository_root() {
        let root = temp_dir("subfolder");
        git(&root, &["init", "-q", "-b", "main"]);
        let sub = root.join("src").join("deep");
        std::fs::create_dir_all(&sub).unwrap();

        let info = add_local_repository(sub.to_string_lossy().to_string()).await.unwrap();

        assert_eq!(info["path"], root.to_string_lossy().as_ref());
        assert_eq!(info["name"], root.file_name().unwrap().to_string_lossy().as_ref());
    }

    #[tokio::test]
    async fn adding_the_root_keeps_the_root() {
        let root = temp_dir("root");
        git(&root, &["init", "-q", "-b", "main"]);

        let info = add_local_repository(root.to_string_lossy().to_string()).await.unwrap();

        assert_eq!(info["path"], root.to_string_lossy().as_ref());
    }

    #[tokio::test]
    async fn a_bare_repository_is_rejected() {
        let bare = temp_dir("bare");
        git(&bare, &["init", "-q", "--bare"]);
        let path = bare.to_string_lossy().to_string();

        let added = add_local_repository(path.clone()).await;
        assert!(matches!(added, Err(AppError::BareRepository(_))), "{added:?}");

        let opened = open_repository(path).await;
        assert!(matches!(opened, Err(AppError::BareRepository(_))), "{opened:?}");
    }

    #[test]
    fn workdir_trailing_slash_is_trimmed() {
        assert_eq!(workdir_to_string(Path::new("/a/b/")), "/a/b");
        assert_eq!(workdir_to_string(Path::new("/a/b")), "/a/b");
    }
}
