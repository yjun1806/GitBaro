// ── Git operation strategy ──────────────────────────────────────────────────
// 읽기 전용 (status, diff): git2 (libgit2) — 성능 우선
// 쓰기 + hooks (commit, stash): GitCliEngine — hooks 실행 보장
// 리모트 (fetch, push, pull): GitCliEngine + AskpassScript — 인증

use crate::commands::auth::resolve_token;
use crate::error::AppError;
use crate::git::cli::GitCliEngine;
use crate::git::engine::GitRemoteEngine;
use crate::state::TokenStore;
use serde_json::{json, Value};

#[tauri::command]
pub async fn get_status(repo_path: String) -> Result<Vec<Value>, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true);
        let statuses = repo.statuses(Some(&mut opts))?;

        let workdir = repo.workdir()
            .map(|p| p.to_path_buf())
            .unwrap_or_default();

        let file_count = statuses.iter().count();
        const DIFF_STATS_THRESHOLD: usize = 300;

        // Build per-file diff stats if file count is within threshold
        let mut diff_stats: std::collections::HashMap<String, (usize, usize)> =
            std::collections::HashMap::new();

        if file_count <= DIFF_STATS_THRESHOLD {
            // Staged diff: tree-to-index
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            let staged_diff = repo.diff_tree_to_index(head_tree.as_ref(), None, None)?;

            for idx in 0..staged_diff.deltas().count() {
                if let Ok(patch) = git2::Patch::from_diff(&staged_diff, idx) {
                    if let Some(patch) = patch {
                        let path = patch.delta().new_file().path()
                            .or_else(|| patch.delta().old_file().path())
                            .map(|p| p.to_string_lossy().to_string());
                        if let (Some(path), Ok((_, ins, del))) = (path, patch.line_stats()) {
                            let entry = diff_stats.entry(path).or_insert((0, 0));
                            entry.0 += ins;
                            entry.1 += del;
                        }
                    }
                }
            }

            // Unstaged diff: index-to-workdir
            let mut unstaged_opts = git2::DiffOptions::new();
            unstaged_opts.include_untracked(true);
            let unstaged_diff = repo.diff_index_to_workdir(None, Some(&mut unstaged_opts))?;

            for idx in 0..unstaged_diff.deltas().count() {
                if let Ok(patch) = git2::Patch::from_diff(&unstaged_diff, idx) {
                    if let Some(patch) = patch {
                        let path = patch.delta().new_file().path()
                            .or_else(|| patch.delta().old_file().path())
                            .map(|p| p.to_string_lossy().to_string());
                        if let (Some(path), Ok((_, ins, del))) = (path, patch.line_stats()) {
                            let entry = diff_stats.entry(path).or_insert((0, 0));
                            entry.0 += ins;
                            entry.1 += del;
                        }
                    }
                }
            }
        }

        let entries: Vec<Value> = statuses
            .iter()
            .filter_map(|entry| {
                let path = entry.path()?.to_string();
                let status = entry.status();

                let staged = status.intersects(
                    git2::Status::INDEX_NEW
                        | git2::Status::INDEX_MODIFIED
                        | git2::Status::INDEX_DELETED
                        | git2::Status::INDEX_RENAMED
                        | git2::Status::INDEX_TYPECHANGE,
                );
                let unstaged = status.intersects(
                    git2::Status::WT_MODIFIED
                        | git2::Status::WT_DELETED
                        | git2::Status::WT_RENAMED
                        | git2::Status::WT_TYPECHANGE
                        | git2::Status::WT_NEW,
                );

                let index_status = if status.contains(git2::Status::INDEX_NEW) {
                    "added"
                } else if status.contains(git2::Status::INDEX_MODIFIED) {
                    "modified"
                } else if status.contains(git2::Status::INDEX_DELETED) {
                    "deleted"
                } else if status.contains(git2::Status::INDEX_RENAMED) {
                    "renamed"
                } else {
                    "unchanged"
                };

                let wt_status = if status.contains(git2::Status::WT_NEW) {
                    "untracked"
                } else if status.contains(git2::Status::WT_MODIFIED) {
                    "modified"
                } else if status.contains(git2::Status::WT_DELETED) {
                    "deleted"
                } else if status.contains(git2::Status::WT_RENAMED) {
                    "renamed"
                } else {
                    "unchanged"
                };

                // Filesystem metadata (null for deleted files)
                let is_deleted = status.contains(git2::Status::WT_DELETED)
                    || (status.contains(git2::Status::INDEX_DELETED) && !unstaged);
                let full_path = workdir.join(&path);
                let (modified_at, size_bytes) = if is_deleted || !full_path.exists() {
                    (Value::Null, Value::Null)
                } else {
                    match std::fs::metadata(&full_path) {
                        Ok(meta) => {
                            let mtime = meta.modified().ok().and_then(|t| {
                                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
                            });
                            let size = meta.len();
                            (
                                mtime.map(|s| json!(s)).unwrap_or(Value::Null),
                                json!(size),
                            )
                        }
                        Err(_) => (Value::Null, Value::Null),
                    }
                };

                // Diff stats (null if over threshold)
                let (insertions, deletions) = if file_count > DIFF_STATS_THRESHOLD {
                    (Value::Null, Value::Null)
                } else {
                    match diff_stats.get(&path) {
                        Some((ins, del)) => (json!(ins), json!(del)),
                        None => (json!(0), json!(0)),
                    }
                };

                Some(json!({
                    "path": path,
                    "staged": staged,
                    "unstaged": unstaged,
                    "indexStatus": index_status,
                    "worktreeStatus": wt_status,
                    "modifiedAt": modified_at,
                    "insertions": insertions,
                    "deletions": deletions,
                    "sizeBytes": size_bytes,
                }))
            })
            .collect();

        Ok::<_, AppError>(entries)
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn stage_files(repo_path: String, paths: Vec<String>) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut index = repo.index()?;
        let workdir = repo.workdir()
            .ok_or_else(|| AppError::Channel("bare repository".to_string()))?;

        for path in &paths {
            let full = workdir.join(path);
            if full.exists() {
                if full.is_dir() {
                    index.add_all(
                        [format!("{}/*", path)],
                        git2::IndexAddOption::DEFAULT,
                        None,
                    )?;
                } else {
                    index.add_path(std::path::Path::new(path))?;
                }
            } else {
                index.remove_path(std::path::Path::new(path))?;
            }
        }

        index.write()?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(())
}

#[tauri::command]
pub async fn unstage_files(repo_path: String, paths: Vec<String>) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;

        // Try to get HEAD commit for resetting; if no commits yet, remove from index directly
        let head_result = repo.head();
        match head_result {
            Ok(head) => {
                let head_commit = head.peel_to_commit()?;
                repo.reset_default(
                    Some(head_commit.as_object()),
                    paths.iter().map(|s| s.as_str()),
                )?;
            }
            Err(_) => {
                // No commits yet — remove from index
                let mut index = repo.index()?;
                for path in &paths {
                    index.remove_path(std::path::Path::new(path))?;
                }
                index.write()?;
            }
        }

        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(())
}

#[tauri::command]
pub async fn create_commit(
    repo_path: String,
    message: String,
    amend: bool,
    account_id: Option<String>,
) -> Result<String, AppError> {
    // If an account is provided, look up its name/email for the commit signature
    let account_info: Option<(String, String)> = if let Some(ref id) = account_id {
        let cache = crate::commands::auth::load_accounts_cache()
            .await
            .unwrap_or_default();
        cache.iter().find(|a| a["id"].as_str() == Some(id.as_str())).map(|a| {
            let name = a["username"].as_str().unwrap_or("Unknown").to_string();
            let email = a["email"].as_str().unwrap_or("").to_string();
            (name, email)
        })
    } else {
        None
    };

    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    let author = account_info.as_ref().map(|(n, e)| (n.as_str(), e.as_str()));
    let oid = engine.commit(&message, amend, author).await?;
    tracing::info!("Committed {}", oid);
    Ok(oid)
}

#[tauri::command]
pub async fn get_diff(repo_path: String, staged: bool) -> Result<Value, AppError> {
    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let diff = if staged {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, None)?
        } else {
            repo.diff_index_to_workdir(None, None)?
        };

        let stats = diff.stats()?;
        let mut files: Vec<Value> = Vec::new();

        diff.foreach(
            &mut |delta, _progress| {
                let old_path = delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());
                let new_path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());

                files.push(json!({
                    "oldPath": old_path,
                    "newPath": new_path,
                    "status": format!("{:?}", delta.status()),
                }));
                true
            },
            None,
            None,
            None,
        )?;

        Ok::<_, AppError>(json!({
            "filesChanged": stats.files_changed(),
            "insertions": stats.insertions(),
            "deletions": stats.deletions(),
            "files": files,
        }))
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(result)
}

#[tauri::command]
pub async fn discard_changes(repo_path: String, paths: Vec<String>) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&repo_path)?;
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.force();
        for path in &paths {
            checkout_opts.path(path);
        }
        repo.checkout_index(None, Some(&mut checkout_opts))?;
        Ok::<_, AppError>(())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))??;

    Ok(())
}

/// Check if a git CLI error is an authentication failure.
fn is_auth_error(err: &AppError) -> bool {
    match err {
        AppError::GitCli { message, .. } => {
            let msg = message.to_lowercase();
            msg.contains("authentication failed")
                || msg.contains("could not read username")
                || msg.contains("invalid credentials")
                || msg.contains("401")
                || msg.contains("403")
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn git_fetch(
    repo_path: String,
    account_id: String,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));

    match engine.fetch("origin", &token).await {
        Ok(()) => {
            tracing::info!("Fetched origin for {}", repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Fetch auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.fetch("origin", &new_token).await?;
            tracing::info!("Fetched origin for {} (after token refresh)", repo_path);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Resolve the current HEAD branch name. Returns error if HEAD is detached.
async fn resolve_head_branch(repo_path: &str) -> Result<String, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let head = repo.head()?;
        head.shorthand()
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::GitCli {
                message: "HEAD is detached".to_string(),
                exit_code: None,
            })
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

/// Resolve the upstream remote branch name for the current HEAD.
/// Returns error with "no_upstream:<branch>" prefix if no upstream is configured.
async fn resolve_upstream_branch(repo_path: &str) -> Result<String, AppError> {
    let rp = repo_path.to_string();
    tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::open(&rp)?;
        let head = repo.head()?;
        let local_name = head
            .shorthand()
            .ok_or_else(|| AppError::GitCli {
                message: "HEAD is detached".to_string(),
                exit_code: None,
            })?
            .to_string();
        let branch = repo.find_branch(&local_name, git2::BranchType::Local)?;
        let upstream = branch.upstream().map_err(|_| AppError::GitCli {
            message: format!("no_upstream:{}", local_name),
            exit_code: None,
        })?;
        let name = upstream
            .name()?
            .unwrap_or("")
            .to_string();
        Ok(name
            .strip_prefix("origin/")
            .unwrap_or(&name)
            .to_string())
    })
    .await
    .map_err(|e| AppError::Channel(e.to_string()))?
}

#[tauri::command]
pub async fn git_push(
    repo_path: String,
    account_id: String,
    force: Option<bool>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let branch = resolve_head_branch(&repo_path).await?;

    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    let force_flag = force.unwrap_or(false);

    match engine.push("origin", &branch, &token, force_flag).await {
        Ok(()) => {
            tracing::info!("Pushed {} to origin for {}", branch, repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Push auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.push("origin", &branch, &new_token, force_flag).await?;
            tracing::info!("Pushed {} to origin for {} (after token refresh)", branch, repo_path);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn git_pull(
    repo_path: String,
    account_id: String,
    rebase: Option<bool>,
    token_store: tauri::State<'_, TokenStore>,
) -> Result<(), AppError> {
    let token = resolve_token(&token_store, &account_id).await?;
    let branch = resolve_upstream_branch(&repo_path).await?;

    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    let rebase_flag = rebase.unwrap_or(false);

    match engine.pull("origin", &branch, &token, rebase_flag).await {
        Ok(()) => {
            tracing::info!("Pulled {} from origin for {}", branch, repo_path);
            Ok(())
        }
        Err(e) if is_auth_error(&e) => {
            tracing::warn!("Pull auth failed, refreshing token for {}", account_id);
            let new_token = token_store.refresh_token(&account_id).await?;
            engine.pull("origin", &branch, &new_token, rebase_flag).await?;
            tracing::info!("Pulled {} from origin for {} (after token refresh)", branch, repo_path);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn stash_push(repo_path: String, message: Option<String>) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.stash_save(message.as_deref()).await?;
    tracing::info!("Stash saved");
    Ok(())
}

#[tauri::command]
pub async fn stash_pop(repo_path: String) -> Result<(), AppError> {
    let engine = GitCliEngine::new(std::path::Path::new(&repo_path));
    engine.stash_pop().await?;
    tracing::info!("Stash popped");
    Ok(())
}
